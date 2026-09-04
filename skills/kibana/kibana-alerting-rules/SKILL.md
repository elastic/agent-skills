---
name: kibana-alerting-rules
description: >
  Create and manage Kibana alerting rules. Use when creating, updating, or managing
  rule lifecycle (enable, disable, mute, snooze), choosing metric threshold rule types
  and params, or read-only find/list with tag filters.
metadata:
  author: elastic
  version: 0.3.0
  universal: true
compatibility: Kibana 8.x or 9.x with matching Elasticsearch, self-managed, Elastic
  Cloud Hosted, or Elastic Cloud Serverless; some rule types and features are version-
  or license-gated (for example, rule-level flapping is GA in 9.3). Requires the `elastic`
  CLI ≥ 0.2 with `stack kb` support.
---

# Kibana Alerting Rules

Create, inspect, update, and manage Kibana alerting rules: choose the right rule type, encode threshold and grouping
semantics, attach actions only when requested, and list or filter rules read-only when the user asks to discover
existing coverage.

<!-- begin-partial: preamble -->

## Environment Configuration

This skill executes Elasticsearch operations through the `elastic` CLI. If the
[`elastic` CLI](https://github.com/elastic/cli#configuration) is not installed, tell the user what it is needed for. Do
not guess credentials, call the HTTP API directly, or attempt other workarounds.

This skill references operations in HTTP-shorthand form (e.g., `GET /`, `GET /_cat/indices`, `GET /{index}/_mapping`,
`GET /{index}/_settings/index.mode`, `POST /_query`). The [Operations](#operations) table at the end of this document
maps each shorthand to the equivalent `elastic` CLI command — always use the CLI rather than calling the HTTP API
directly.

<!-- end-partial: preamble -->

## Core concepts

A rule has three parts: **conditions** (`params` + `rule_type_id`), **schedule** (how often conditions are checked), and
**actions** (optional connectors run when alerts fire). When conditions are met, the rule creates **alerts**; actions
deliver notifications through **connectors**. Do not create connectors or actions unless the user explicitly asks for
notification wiring — many tasks require only the rule definition.

Required privileges: `all` on the owning Kibana feature (Stack Rules, Observability, Security, etc.) and `all` on Rules
Settings. Managing connectors needs `all` on Actions and Connectors; `read` is sufficient to attach existing connectors
as rule actions.

**On-premises prerequisite:** configure a stable `xpack.encryptedSavedObjects.encryptionKey` in `kibana.yml` before
creating rules — it encrypts rule API keys and connector secrets. If it is unset, each restart regenerates it and breaks
existing rules; all Kibana nodes in a cluster must share the same key.

## Process

1. **Classify the task.** Decide whether the user needs to **create** a rule, **find/list** rules (read-only),
   **update** an existing rule, or perform a **lifecycle** change (enable, disable, mute, snooze, delete). If the user
   only asks to show or list rules, treat the request as read-only — do not create, update, enable, or delete anything.

2. **For find/list tasks, filter and page sensibly.** Call `GET kbn:/api/alerting/rules/_find` with query parameters
   that narrow results instead of dumping every rule:
   - **By tag:** `filter=alert.attributes.tags:"production"` (KQL on saved-object attributes).
   - **By text:** `search` with `search_fields` and `default_search_operator` as needed.
   - **Paging:** set `per_page` and iterate `page` when results may exceed one page.
   - **Sort:** `sort_field=name` and `sort_order=asc` for stable listings.

   Enumerate matching rule ids and names. If no rules match, say so plainly — do not invent results. Query alerting
   rules specifically, not connectors or streams.

3. **For create tasks, choose the rule type before writing params.** Match the user's intent to a metric/threshold rule
   type — not log, anomaly, or unrelated types:
   - **Numeric metric over a time window, optionally per host/service** → `.index-threshold` with
     `consumer: "stackAlerts"`.
   - **Document count or Query DSL condition** → `.es-query` with `consumer: "stackAlerts"`.
   - **Observability metric in the metrics app** → `metrics.alert.threshold` with `consumer: "metrics"` or
     `"infrastructure"`.

   Read [rule-types-reference.md](references/rule-types-reference.md) for param schemas, valid consumers, and action
   groups. When the user specifies an index, field, threshold, duration, and grouping field, encode all four explicitly
   in `params` — do not substitute a connector or action for the condition.

4. **Encode threshold, duration, and grouping correctly.** These three dimensions are independent:
   - **Threshold:** set `threshold` and `thresholdComparator` on the aggregated value. Match field scale — ECS
     `system.cpu.total.pct` is typically fractional (`0.9` for 90%); use `90` only when the field is on a 0–100 scale.
   - **"For N minutes" semantics:** set `timeWindowSize` and `timeWindowUnit` in `params` (lookback evaluated each run).
     Align `schedule.interval` with that window (e.g., both five minutes) so a brief spike does not fire on a mismatched
     cadence. Add `alert_delay: {"active": N}` only when the user wants N **consecutive** matching runs, not a single
     lookback window.
   - **Per-host / per-entity grouping:** for `.index-threshold`, set `groupBy: "top"`, `termField` to the grouping field
     (e.g., `host.name`), and a `termSize` large enough to cover all entities ("any host"). Without grouping, the rule
     aggregates globally and will not alert per host.

5. **Build the create payload.** Required fields: `name`, `rule_type_id`, `consumer`, `schedule`, `params`. Optional:
   `tags`, `enabled`, `actions`, `alert_delay`, `flapping`. Use the user-supplied rule id in the URL when given;
   otherwise let Kibana generate one.

   **Example params — CPU > 90% on any host for 5 minutes on `eval-alert-metrics`:**

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

6. **Create and confirm.** Call `POST kbn:/api/alerting/rule/{id}` with the payload. On **409 Conflict**, the id already
   exists — call `GET kbn:/api/alerting/rule/{id}` to inspect or choose a different id. After a successful create, call
   `GET kbn:/api/alerting/rule/{id}` and confirm success to the user with the live rule id, name, and enabled state — do
   not claim success without verifying on Kibana.

7. **For update tasks, read then replace.** `rule_type_id` and `consumer` are immutable. Call
   `GET kbn:/api/alerting/rule/{id}`, merge intended changes, then `PUT kbn:/api/alerting/rule/{id}` with the
   **complete** rule body. On **409 Conflict**, another user changed the rule — re-fetch and retry. Set per-action
   `frequency` objects; rule-level `notify_when` and `throttle` are deprecated.

8. **For lifecycle tasks, call the narrowest endpoint.** Disable temporarily with
   `POST kbn:/api/alerting/rule/{id}/_disable` (rule retains config); re-enable with
   `POST kbn:/api/alerting/rule/{id}/_enable`. Mute all alerts with `POST kbn:/api/alerting/rule/{id}/_mute_all`;
   restore with `POST kbn:/api/alerting/rule/{id}/_unmute_all`. Mute a single active alert with
   `POST kbn:/api/alerting/rule/{rule_id}/alert/{alert_id}/_mute`; unmute with
   `POST kbn:/api/alerting/rule/{rule_id}/alert/{alert_id}/_unmute`. Schedule snoozes with
   `POST kbn:/api/alerting/rule/{id}/snooze_schedule`; remove with
   `DELETE kbn:/api/alerting/rule/{ruleId}/snooze_schedule/{scheduleId}`. Delete permanently with
   `DELETE kbn:/api/alerting/rule/{id}`. When a rule fails due to API key ownership, call
   `POST kbn:/api/alerting/rule/{id}/_update_api_key`.

## Examples

### Create a threshold alert

User: "Alert me when CPU exceeds 90% on any host for 5 minutes. Query `eval-alert-metrics` (`system.cpu.total.pct`,
grouped by `host.name`). Create the rule with id `eval-cpu-rule`."

1. Choose `.index-threshold` / `stackAlerts`.
2. Encode fractional threshold `[0.9]`, five-minute `timeWindowSize`/`timeWindowUnit`, and `groupBy`/`termField` for
   `host.name`.
3. `POST kbn:/api/alerting/rule/eval-cpu-rule` with `schedule.interval: "5m"`. Omit actions.
4. `GET kbn:/api/alerting/rule/eval-cpu-rule` and confirm to the user.

### Find rules by tag (read-only)

User: "Show me all production alerting rules."

1. `GET kbn:/api/alerting/rules/_find` with `filter=alert.attributes.tags:"production"`, sensible `per_page`, and
   `sort_field=name`.
2. Page through results if `total` exceeds `per_page`.
3. Report ids and names only — no mutations.

### Pause a rule temporarily

User: "Disable rule `abc123` until next Monday."

1. `POST kbn:/api/alerting/rule/abc123/_disable`.
2. Re-enable later with `POST kbn:/api/alerting/rule/abc123/_enable`.

For planned downtime spanning multiple rules, prefer a maintenance window over disabling or snoozing each rule
individually.

## Guidelines

- Set `frequency` inside each action object — rule-level `notify_when` and `throttle` are deprecated.
- `rule_type_id` and `consumer` are immutable after creation; delete and recreate to change them.
- Prefix paths with `kbn:/s/<space_id>/api/alerting/` for non-default Kibana Spaces (connectors are space-scoped too).
- A rule action cannot reference a connector from a different space — the rule and its connectors must share one Space.
- Pair active notification actions with a **Recovered** action for PagerDuty, Jira, and ServiceNow.
- Use `alert_delay` to require consecutive matches; use flapping settings to suppress unstable alerts. Per-rule tuning
  via the `flapping` object is GA since 9.3; earlier versions support only space-level flapping settings.
- Debug action templates with `{{{.}}}` in any template field — it renders the whole variable context as JSON, which
  helps discover correct paths like `{{context.reason}}` or `{{alert.flapping}}`.
- Do **not** use this skill for Security detection rules: `consumer: "securitySolution"`/`"siem"` belongs to the
  dedicated Security Detections API (`/api/detection_engine/rules`), which has different rule type ids and lifecycle.
- Tag rules consistently (`production`, `staging`, team names) for find API filtering.
- Minimum recommended check interval is `1m`; expensive rules are cancelled after the server run timeout (default `5m`).

## Common pitfalls

1. **Wrong rule type** — using a log or ML rule for a metric threshold condition.
2. **Missing per-entity grouping** — global aggregation when the user asked for "any host" or "per service".
3. **Threshold scale mismatch** — `90` vs `0.9` on fractional CPU fields.
4. **Duration conflated with schedule** — a one-minute schedule with a five-minute window behaves differently from both
   set to five minutes.
5. **Unrequested actions** — attaching connectors when the user only asked to create the rule.
6. **Read-only violations** — creating or mutating rules when the user asked only to list or filter.
7. **Concurrent update conflicts** — PUT without a fresh GET returns 409.
8. **Import/export** — saved-object import disables rules and strips connector secrets.

## References

- [rule-types-reference.md](references/rule-types-reference.md) — Rule types, params, consumers, action groups
- [connectors-actions-terraform.md](references/connectors-actions-terraform.md) — Actions, workflows, Terraform
- [Kibana Alerting API](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-alerting)
- [Alerting concepts](https://www.elastic.co/docs/explore-analyze/alerting/alerts)
- [Rule action variables](https://www.elastic.co/docs/explore-analyze/alerting/alerts/rule-action-variables)
- [Alerting production considerations](https://www.elastic.co/docs/deploy-manage/production-guidance/kibana-alerting-production-considerations)

## Operations

| HTTP API (shorthand)                                                  | `elastic` CLI command                                                                                                                                                                                            |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET kbn:/api/alerting/rules/_find`                                   | `elastic kb alerting get-alerting-rules-find [--filter '<kql>'] [--search '<q>'] [--per-page <n>] [--page <n>] [--sort-field <field>] [--sort-order asc\|desc]`                                                  |
| `POST kbn:/api/alerting/rule/{id}`                                    | `elastic kb alerting post-alerting-rule-id --id '<id>' --name '<name>' --rule-type-id '<type>' --consumer '<consumer>' --schedule '<json>' --params '<json>' [--tags '<json>'] [--actions '<json>'] [--enabled]` |
| `GET kbn:/api/alerting/rule/{id}`                                     | `elastic kb alerting get-alerting-rule-id --id '<id>'`                                                                                                                                                           |
| `PUT kbn:/api/alerting/rule/{id}`                                     | `elastic kb alerting put-alerting-rule-id --id '<id>' --name '<name>' --schedule '<json>' --params '<json>' [--tags '<json>'] [--actions '<json>']`                                                              |
| `DELETE kbn:/api/alerting/rule/{id}`                                  | `elastic kb alerting delete-alerting-rule-id --id '<id>'`                                                                                                                                                        |
| `POST kbn:/api/alerting/rule/{id}/_enable`                            | `elastic kb alerting post-alerting-rule-id-enable --id '<id>'`                                                                                                                                                   |
| `POST kbn:/api/alerting/rule/{id}/_disable`                           | `elastic kb alerting post-alerting-rule-id-disable --id '<id>' [--untrack]`                                                                                                                                      |
| `POST kbn:/api/alerting/rule/{id}/_mute_all`                          | `elastic kb alerting post-alerting-rule-id-mute-all --id '<id>'`                                                                                                                                                 |
| `POST kbn:/api/alerting/rule/{id}/_unmute_all`                        | `elastic kb alerting post-alerting-rule-id-unmute-all --id '<id>'`                                                                                                                                               |
| `POST kbn:/api/alerting/rule/{id}/_update_api_key`                    | `elastic kb alerting post-alerting-rule-id-update-api-key --id '<id>'`                                                                                                                                           |
| `POST kbn:/api/alerting/rule/{rule_id}/alert/{alert_id}/_mute`        | `elastic kb alerting post-alerting-rule-rule-id-alert-alert-id-mute --rule-id '<rule_id>' --alert-id '<alert_id>'`                                                                                               |
| `POST kbn:/api/alerting/rule/{rule_id}/alert/{alert_id}/_unmute`      | `elastic kb alerting post-alerting-rule-rule-id-alert-alert-id-unmute --rule-id '<rule_id>' --alert-id '<alert_id>'`                                                                                             |
| `POST kbn:/api/alerting/rule/{id}/snooze_schedule`                    | `elastic kb alerting post-alerting-rule-id-snooze-schedule --id '<id>' --schedule '<json>'`                                                                                                                      |
| `DELETE kbn:/api/alerting/rule/{ruleId}/snooze_schedule/{scheduleId}` | `elastic kb alerting delete-alerting-rule-ruleid-snooze-schedule-scheduleid --rule-id '<ruleId>' --schedule-id '<scheduleId>'`                                                                                   |
