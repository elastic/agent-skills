# Classic Alerting Rules

Use this reference for classic Kibana alerting rules (`kbn:/api/alerting/rule`). A classic rule has three parts:
**conditions** (`params` + `rule_type_id`), a **schedule** (how often conditions are checked), and optional **actions**
(connectors run when alerts fire).

Use classic rules only when the user names a classic rule type or edits an existing classic rule. Classic rules cannot
be migrated to Universal Alerting; edit them in place.

## Requirements

- **Privileges** — `all` on the owning Kibana feature (Stack Rules, Observability, Security, etc.) and `all` on Rules
  Settings. Managing connectors needs `all` on Actions and Connectors; `read` is sufficient to attach existing
  connectors as rule actions.
- **On-premises encryption key** — configure a stable `xpack.encryptedSavedObjects.encryptionKey` in `kibana.yml` before
  creating rules. It encrypts rule API keys and connector secrets. If it is unset, each restart regenerates it and
  breaks existing rules; all Kibana nodes in a cluster must share the same key.
- **Availability** — Kibana 8.x or 9.x, and every Elastic Cloud Serverless project.

## Find and list rules

Call `GET kbn:/api/alerting/rules/_find` with query parameters that narrow results instead of dumping every rule:

- **By tag:** `filter=alert.attributes.tags:"production"` (KQL on saved-object attributes).
- **By text:** `search` with `search_fields` and `default_search_operator` as needed.
- **Paging:** set `per_page` and iterate `page` when results may exceed one page.
- **Sort:** `sort_field=name` and `sort_order=asc` for stable listings.

Enumerate matching rule ids and names. Query alerting rules specifically, not connectors or streams.

## Create a rule

1. **Choose the rule type before writing params.** Match the user's intent to a metric or threshold rule type, not a
   log, anomaly, or unrelated type:
   - **Numeric metric over a time window, optionally per host or service** → `.index-threshold` with
     `consumer: "stackAlerts"`.
   - **Document count or Query DSL condition** → `.es-query` with `consumer: "stackAlerts"`.
   - **Observability metric in the metrics app** → `metrics.alert.threshold` with `consumer: "metrics"` or
     `"infrastructure"`.

   Read [classic-rule-types.md](classic-rule-types.md) for param schemas, valid consumers, and action groups. When the
   user specifies an index, field, threshold, duration, and grouping field, encode all of them explicitly in `params` —
   do not substitute a connector or action for the condition.

2. **Encode threshold, duration, and grouping correctly.** These three dimensions are independent:
   - **Threshold:** set `threshold` and `thresholdComparator` on the aggregated value. Match field scale — ECS
     `system.cpu.total.pct` is typically fractional (`0.9` for 90%); use `90` only when the field is on a 0–100 scale.
   - **"For N minutes" semantics:** set `timeWindowSize` and `timeWindowUnit` in `params` (lookback evaluated each run).
     Align `schedule.interval` with that window (for example, both five minutes) so a brief spike does not fire on a
     mismatched cadence. Add `alert_delay: {"active": N}` only when the user wants N **consecutive** matching runs, not
     a single lookback window.
   - **Per-host or per-entity grouping:** for `.index-threshold`, set `groupBy: "top"`, `termField` to the grouping
     field (for example, `host.name`), and a `termSize` large enough to cover all entities ("any host"). Without
     grouping, the rule aggregates globally and does not alert per host.

3. **Build the create payload.** Required fields: `name`, `rule_type_id`, `consumer`, `schedule`, `params`. Optional:
   `tags`, `enabled`, `actions`, `alert_delay`, `flapping`. Use the user-supplied rule id in the URL when given;
   otherwise let Kibana generate one.

   **Example — CPU > 90% on any host for 5 minutes on `eval-alert-metrics`:**

   ```json
   {
     "name": "CPU exceeds 90% for 5 minutes",
     "rule_type_id": ".index-threshold",
     "consumer": "stackAlerts",
     "schedule": { "interval": "5m" },
     "params": {
       "index": ["eval-alert-metrics"],
       "timeField": "@timestamp",
       "aggType": "avg",
       "aggField": "system.cpu.total.pct",
       "groupBy": "top",
       "termField": "host.name",
       "termSize": 1000,
       "threshold": [0.9],
       "thresholdComparator": ">",
       "timeWindowSize": 5,
       "timeWindowUnit": "m"
     },
     "tags": ["production"]
   }
   ```

   Omit `actions` when the user only asks to create the rule condition.

4. **Create and confirm.** Call `POST kbn:/api/alerting/rule/{id}` with the payload. On **409 Conflict**, the id already
   exists — call `GET kbn:/api/alerting/rule/{id}` to inspect it or choose a different id. After a successful create,
   call `GET kbn:/api/alerting/rule/{id}` and confirm the live rule id, name, and enabled state.

## Notify through connectors

Classic rules notify through inline `actions`, each referencing a connector, an action group, Mustache `params`, and a
per-action `frequency`. Attach actions only when the user asks for notifications. Read
[classic-actions-connectors-terraform.md](classic-actions-connectors-terraform.md) for the action object, Mustache
variables, workflow connectors, and Terraform.

- Set `frequency` inside each action object — rule-level `notify_when` and `throttle` are deprecated.
- A rule action cannot reference a connector from a different space — the rule and its connectors must share one space.
- Pair active notification actions with a **Recovered** action for PagerDuty, Jira, and ServiceNow so incidents close.
- Debug action templates with `{{{.}}}` in any template field — it renders the whole variable context as JSON, which
  helps discover correct paths like `{{context.reason}}` or `{{alert.flapping}}`.

## Update a rule

Read, then replace. Call `GET kbn:/api/alerting/rule/{id}`, merge the intended changes, then
`PUT kbn:/api/alerting/rule/{id}` with the **complete** rule body. On **409 Conflict**, another user changed the rule —
re-fetch and retry. `rule_type_id` and `consumer` are immutable; delete and recreate the rule to change them.

## Change lifecycle

Call the narrowest endpoint:

- **Disable / enable** — `POST kbn:/api/alerting/rule/{id}/_disable` (the rule keeps its config);
  `POST kbn:/api/alerting/rule/{id}/_enable`.
- **Mute all alerts** — `POST kbn:/api/alerting/rule/{id}/_mute_all`; restore with
  `POST kbn:/api/alerting/rule/{id}/_unmute_all`.
- **Mute one alert** — `POST kbn:/api/alerting/rule/{rule_id}/alert/{alert_id}/_mute`; unmute with
  `POST kbn:/api/alerting/rule/{rule_id}/alert/{alert_id}/_unmute`.
- **Snooze** — `POST kbn:/api/alerting/rule/{id}/snooze_schedule`; remove with
  `DELETE kbn:/api/alerting/rule/{ruleId}/snooze_schedule/{scheduleId}`.
- **Delete** — `DELETE kbn:/api/alerting/rule/{id}`.
- **API key ownership failure** — `POST kbn:/api/alerting/rule/{id}/_update_api_key`.

For planned downtime spanning multiple rules, prefer a maintenance window over disabling or snoozing each rule.

## Tuning

- `alert_delay: {"active": N}` requires N consecutive matching runs before an alert fires.
- The `flapping` object suppresses unstable alerts per rule (GA in 9.3; earlier versions support only space-level
  flapping settings).
- The minimum recommended check interval is `1m`; expensive rules are cancelled after the server run timeout (default
  `5m`).

## Common failure modes

1. **Wrong rule type** — using a log or ML rule for a metric threshold condition.
2. **Missing per-entity grouping** — global aggregation when the user asked for "any host" or "per service".
3. **Threshold scale mismatch** — `90` vs `0.9` on fractional CPU fields.
4. **Duration conflated with schedule** — a one-minute schedule with a five-minute window behaves differently from both
   set to five minutes.
5. **Concurrent update conflicts** — PUT without a fresh GET returns 409.
6. **Import/export** — saved-object import disables rules and strips connector secrets.
