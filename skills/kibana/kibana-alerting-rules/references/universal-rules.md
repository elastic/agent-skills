# Universal Alerting Rules

Use this reference for Universal Alerting rules (`kbn:/api/alerting/v2/rules`). A universal rule evaluates an ES|QL
query on a schedule. It carries no notification settings: alerts reach people through action policies (see
[universal-action-policies.md](universal-action-policies.md)).

## Requirements

- **Availability** — Kibana 9.6 or later, or an Elastic Cloud Serverless Observability project (versionless), with the
  `alerting:v2:enabled` advanced setting on (default). Serverless Security and Elasticsearch projects do not offer
  Universal Alerting.
- **Privileges** — the **Rules** feature (`alerting_v2_rules`): `read` to list and get, `all` to write.
- **Spaces** — rules are space-scoped. Prefix paths with `kbn:/s/<space_id>/` for a non-default space.

## Choose the rule kind

`kind` is the most important decision, and it is **immutable** after creation — the update API rejects a change.

| Kind     | Behavior                                                                                                                                 | Use when                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `alert`  | Creates an alert for each matching group and tracks it until it recovers. Alert statuses: `inactive`, `pending`, `active`, `recovering`. | The user wants to detect a problem and notify or automate a response. |
| `signal` | Stores each match as a rule event that can be queried. No alerts, no notifications.                                                      | The user wants to collect evidence or observe without being notified. |

Only `kind: alert` rules can notify. When the user wants notifications on an existing `signal` rule, explain that it
cannot be converted and offer to create a new `alert` rule with the same query and schedule.

## Rule fields

| Field                   | Required                  | Notes                                                                                  |
| ----------------------- | ------------------------- | -------------------------------------------------------------------------------------- |
| `kind`                  | yes                       | `alert` or `signal`; immutable                                                         |
| `metadata.name`         | yes                       | Unique within the space; max 256 characters                                            |
| `metadata.description`  | no                        | Max 1024 characters; send `null` on PATCH to clear                                     |
| `metadata.tags`         | no                        | 1–20 tags for filtering                                                                |
| `metadata.routing_tags` | no                        | 1–20 tags; the only tags action policies match with `matcher.tags`. `alert` rules only |
| `time_field`            | no (default `@timestamp`) | Date field used with `schedule.lookback` to time-filter the query                      |
| `schedule.every`        | yes                       | Execution interval, for example `1m`, `5m`                                             |
| `schedule.lookback`     | no                        | Lookback window for each run, for example `5m`                                         |
| `query.base`            | yes                       | ES\|QL with a `FROM` clause; max 10,000 characters                                     |
| `query.breach.segment`  | no                        | ES\|QL clause appended to `query.base`, for example `WHERE avg_cpu > 0.9`; no `FROM`   |
| `grouping.fields`       | no                        | 1–16 fields; one alert per group. Match the `BY` fields of the query                   |
| `recovery`              | `alert` only              | When an alert recovers; required for `alert`, rejected for `signal`                    |
| `no_data`               | `alert` only              | What happens when a group has no data; required for `alert`, rejected for `signal`     |
| `state_transition`      | no                        | Consecutive matches or duration before `active` or `inactive`; `alert` only            |
| `artifacts`             | no                        | Runbooks or dashboards attached to the rule (1–100 items; omit rather than send `[]`)  |

## Write the query

- Put the data and aggregation in `query.base`, and the threshold in `query.breach.segment`. Splitting them lets
  recovery and no-data strategies reuse `query.base`.
- Group with `STATS ... BY <field>` in `query.base` and list the same fields in `grouping.fields`, so each host or
  service gets its own alert.
- Match field scale: ECS `system.cpu.total.pct` is fractional (`0.9` for 90%).
- Add a `severity` column to set per-alert severity, which action policies can match:
  `| EVAL severity = CASE(avg_cpu > 0.95, "critical", avg_cpu > 0.8, "high", "medium")`. Valid values: `info`, `low`,
  `medium`, `high`, `critical`.

## Recovery, no-data, and state transition

**Recovery** (`recovery.strategy`):

- `no_breach` — recovers when the group no longer appears in the breach results.
- `condition` — recovers when `query.base` plus `recovery.segment` returns the group, for example
  `{ "strategy": "condition", "segment": "WHERE avg_cpu < 0.6" }`. Requires `query.breach`.
- `query` — recovers when a separate full ES|QL query (`recovery.query`) returns the group.
- `manual` — never recovers automatically. Omit `state_transition.recovering`, or clear it when switching an existing
  rule to manual recovery; the API rejects a rule that sets both.

**No data** (`no_data.strategy`):

- `ignore` — does not check whether a group still has data.
- `keep_last` — holds the alert's current status when a group has no data.
- `resolve` — closes the alert the first time a group has no data.

Any strategy other than `ignore` needs either `query.breach` or its own `no_data.query` presence query, so a group with
no data can be told apart from one that stopped breaching.

**State transition** delays status changes to reduce noise:

- `pending.count` — consecutive matches spent in `pending` before the alert becomes `active` on the next match (`0`
  opens it on the first match). `pending.timeframe` sets a duration instead; combine both with `pending.operator` (`and`
  or `or`).
- `recovering.count` / `recovering.timeframe` / `recovering.operator` — the same for closing a recovered alert.

## Create a rule

Example — CPU above 90% on any host over 5 minutes, routed to on-call:

```json
{
  "kind": "alert",
  "metadata": {
    "name": "Host CPU high",
    "description": "Alerts when average CPU usage exceeds 90%.",
    "tags": ["production", "infra"],
    "routing_tags": ["sre-oncall"]
  },
  "time_field": "@timestamp",
  "schedule": { "every": "1m", "lookback": "5m" },
  "query": {
    "base": "FROM metrics-* | STATS avg_cpu = AVG(system.cpu.total.pct) BY host.name",
    "breach": { "segment": "WHERE avg_cpu > 0.9" }
  },
  "grouping": { "fields": ["host.name"] },
  "recovery": { "strategy": "no_breach" },
  "no_data": { "strategy": "keep_last" },
  "state_transition": { "pending": { "count": 1 }, "recovering": { "count": 1 } }
}
```

- `POST kbn:/api/alerting/v2/rules` → server-generated id.
- `PUT kbn:/api/alerting/v2/rules/{id}` → client-supplied id; creates or replaces the rule.

When the user names an existing action policy or a team routing tag, set `metadata.routing_tags` at creation so the rule
is routed from its first alert; see
[universal-action-policies.md](universal-action-policies.md#link-rules-and-policies-with-routing-tags).

After the write, call `GET kbn:/api/alerting/v2/rules/{id}` and report the live id, name, kind, and enabled state.
Before creating, validate the ES|QL with `POST /_query` against a short time range when the index or fields are
uncertain.

## Find and read rules

Call `GET kbn:/api/alerting/v2/rules`:

- **Filter** with KQL, for example `filter=metadata.tags:"production"` or `filter=metadata.routing_tags:"sre-oncall"`.
- **Search** free text with `search`.
- **Page** with `page` and `per_page`; **sort** with `sort_field` and `sort_order`.

Read one rule with `GET kbn:/api/alerting/v2/rules/{id}`.

## Update a rule

Prefer `PATCH kbn:/api/alerting/v2/rules/{id}` for partial changes. `kind` cannot change. Arrays such as
`metadata.routing_tags` are replaced whole — re-send the existing values when adding one. `null` clears optional fields
such as `metadata.description` and `artifacts`. Use `PUT` only to replace the whole rule. On **409**, another caller
changed the rule — re-read it and retry.

## Change lifecycle

- **Disable / enable** — `POST kbn:/api/alerting/v2/rules/{id}/_disable`;
  `POST kbn:/api/alerting/v2/rules/{id}/_enable`.
- **Delete** — `DELETE kbn:/api/alerting/v2/rules/{id}`. Confirm with the user first.
- **Bulk** — send `{ "ids": [...] }` to `POST kbn:/api/alerting/v2/rules/_bulk_enable`, `_bulk_disable`, or
  `_bulk_delete`. The response is 200 even when some ids fail; report `affected_count` and every entry in `errors`.

Universal rules have no snooze or mute. To silence notifications for a time, snooze the action policies that match the
rule (see [universal-action-policies.md](universal-action-policies.md)).

## Common failure modes

1. **Signal rule when notifications are wanted** — `kind` cannot change later.
2. **Missing routing tags** — action policies only match tags in `metadata.routing_tags`.
3. **Threshold in `query.base` only** — leaves recovery and no-data strategies without a breach segment to reuse.
4. **Grouping mismatch** — `grouping.fields` that differ from the query's `BY` fields.
5. **Routing tags overwritten** — PATCH with only the new routing tag drops the existing ones.
