---
name: kibana-alerting-rules
description: >
  Create and manage Kibana alerting rules and the action policies that notify on their
  alerts, for both Universal Alerting and classic alerting. Use when the user wants
  to be alerted or notified about conditions in their data, change where or how often
  alerts notify (including snoozing notifications), edit, enable, disable, or delete
  existing rules or action policies, or list existing alerting. Not for Security detection
  rules.
metadata:
  author: elastic
  version: 0.4.0
  universal: true
compatibility: 'Classic rules: Kibana 8.x or 9.x and every Elastic Cloud Serverless
  project. Universal Alerting: Kibana 9.6 or later, or Serverless Observability projects,
  with the `alerting:v2:enabled` advanced setting on (default); action policies need
  Kibana Workflows and an Enterprise or trial license. Self-managed, Elastic Cloud
  Hosted, or Serverless. Requires the `elastic` CLI with `stack kb` support.'
---

# Kibana Alerting

Turn a monitoring goal into working alerting and manage what already exists. Create Universal Alerting rules and action
policies by default; use classic alerting only when the user names a classic rule type or edits an existing classic
rule. Load only the chosen system's references before writing anything.

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

Kibana has two alerting systems that do not share rules, APIs, or notification wiring. Rules cannot move between them.

- **Universal Alerting** is the default for all new alerting. A rule evaluates an ES|QL query on a schedule and opens
  alerts. Notifications are managed independently of rules: **action policies** match alerts by the rule's routing tags
  or by alert content and dispatch them to workflows (Slack, email, PagerDuty, and other connectors). A policy can be
  created before, after, or together with the rules it matches. Available on Kibana 9.6 or later and in Serverless
  Observability projects; Serverless Security and Elasticsearch projects do not offer it.
- **Universal Alerting notifications need an Enterprise or trial license** (action policies and Workflows); rules work
  without one. Check `GET /_license` before promising them. Classic rule actions follow each connector's own license
  tier instead.
- **Classic alerting** covers the classic rule types (the job table in Process step 1). Its details live entirely in the
  classic references — do not load them for any other task.

## Process

1. **Identify the job.** Match the request to one or more rows below. A request can combine jobs — for example a new
   rule and its notifications — and they can be done in either order, because a shared routing tag links a Universal
   Alerting rule to its policies.

   | Job                                           | Example request                                                               | System                                                                                  | Read before writing                                                                                           |
   | --------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
   | Find or list                                  | "Show me all production alerting rules"                                       | Both systems, read-only — create, update, enable, or delete nothing                     | —                                                                                                             |
   | New rule with notifications                   | "Alert me / page on-call when CPU is above 90% on any host"                   | Universal Alerting                                                                      | `universal-rules.md`, `universal-action-policies.md`, `universal-workflow-destinations.md`                    |
   | New rule without notifications                | "Record every time checkout latency exceeds 2 seconds"                        | Universal Alerting                                                                      | `universal-rules.md`                                                                                          |
   | Notifications only                            | "Send payments alerts to Slack instead of email", "Snooze the on-call policy" | Universal Alerting — action policies only; rules change only if one needs a routing tag | `universal-action-policies.md`, plus `universal-workflow-destinations.md` when a destination changes          |
   | Edit an existing rule or change its lifecycle | "Disable rule `cpu-web`"                                                      | The system where step 2 finds the rule                                                  | That system's references                                                                                      |
   | New rule of a named classic type              | "Create an Elasticsearch query rule that…"                                    | Classic                                                                                 | `classic-rules.md`, `classic-rule-types.md`, plus `classic-actions-connectors-terraform.md` for notifications |

   Reference paths are relative to `references/` (see [References](#references)). Never mix systems: Universal Alerting
   rules have no rule-level actions or connectors, and classic rules have no action policies or routing tags.

2. **Find what the request refers to.** If the request does not identify which rules or policies it means — for example
   "the payments rules" or "my production alerts" with no tag, name, or ID — ask the user before making any API calls;
   do not search rule names to guess the set. When the user refers to an existing rule by ID, name, or tag, search both
   systems — Universal Alerting first, then classic — and use whichever returns a match. Run both searches even when the
   first one matches, so a rule with the same name or tag in the other system is not missed:

   | Given       | Universal Alerting                                                           | Classic alerting                                                                |
   | ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
   | ID          | `GET kbn:/api/alerting/v2/rules/{id}`                                        | `GET kbn:/api/alerting/rule/{id}`                                               |
   | Name        | `GET kbn:/api/alerting/v2/rules` with `search=<name>`                        | `GET kbn:/api/alerting/rules/_find` with `search=<name>&search_fields=name`     |
   | Tag         | `GET kbn:/api/alerting/v2/rules` with `filter=metadata.tags:"<tag>"`         | `GET kbn:/api/alerting/rules/_find` with `filter=alert.attributes.tags:"<tag>"` |
   | Routing tag | `GET kbn:/api/alerting/v2/rules` with `filter=metadata.routing_tags:"<tag>"` | — (classic rules have no routing tags)                                          |

   Skip one search only when the user's wording belongs to a single system:

   | User says                                                                                    | Search                  |
   | -------------------------------------------------------------------------------------------- | ----------------------- |
   | "routing tag", "action policy", "alert kind" or "signal kind", "universal rule"              | Universal Alerting only |
   | A classic rule type ("index threshold rule", "Elasticsearch query rule"), "connector action" | Classic only            |
   | "tag", "label", or a bare name or ID                                                         | Both systems            |

   "Snooze" and "mute" do not settle the system: classic rules are snoozed on the rule, while Universal Alerting
   notifications are snoozed on action policies.

   If only one system matches, use it. If both match, show both to the user and ask which they mean. If neither matches,
   say so — do not create a rule in its place. For a find or list request with no system named, report the results from
   both systems, labeled by system.

   Before editing or deleting a rule, confirm matches with user to ensure they're mutating the intended object. Do not
   assume without their confirmation unless a single result matches exactly.

   Action policies exist only in Universal Alerting; find them as described in
   [universal-action-policies.md](references/universal-action-policies.md), including every policy that can match a
   rule's alerts when the user changes where those alerts go.

3. **Check Universal Alerting before the first write to it.** Call `GET kbn:/api/alerting/v2/rules` with `per_page=1`.
   If the route is missing (404) or Universal Alerting is turned off, stop: tell the user Universal Alerting is
   unavailable on this deployment and ask whether to create a classic rule instead. Load the classic references only
   after the user agrees.

4. **Send notifications where the user wants them.** In Universal Alerting, a rule's `metadata.routing_tags` and a
   policy's `matcher.tags` link the two; for a classic rule, add rule actions. Use the destination the user names (a
   workflow, channel, or person). If they name none, write the rule and ask where notifications should go before
   creating the policy or actions — never skip notifications silently or invent a destination.

5. **Verify by reading back.** After every write, read the rule or policy again and report its live id, name, enabled
   state, and, for notifications, the matcher and destinations. Do not claim success without the read-back.

## Examples

### Notify on a new condition (Universal Alerting, default)

User: "Page the on-call workflow `wf-pagerduty` when CPU is above 90% on any host for 5 minutes."

1. Job: new rule with notifications → Universal Alerting. `GET kbn:/api/alerting/v2/rules` with `per_page=1` →
   available.
2. Read `universal-rules.md`; `POST kbn:/api/alerting/v2/rules` with an alert-kind rule grouped by `host.name` and a
   routing tag such as `notify-host-cpu-high`.
3. Read `universal-action-policies.md` and `universal-workflow-destinations.md`; check the license and `wf-pagerduty`,
   then `POST kbn:/api/alerting/v2/action_policies` matching that routing tag.
4. Read both back and confirm.

### Route an existing rule's alerts somewhere new (Universal Alerting)

User: "Send alerts from rules tagged `team-payments` to Slack workflow `wf-slack` instead of email."

The user wants to change where alerts are sent, not what triggers them, so edit action policies only and leave the rules
unchanged. Alerts can match several policies, so changing one policy may leave another still sending email:

1. Find the rules: `GET kbn:/api/alerting/v2/rules` with `filter=metadata.tags:"team-payments"`, and collect their
   `metadata.routing_tags`.
2. Read `universal-action-policies.md` and list every policy that can match those rules' alerts: policies whose
   `matcher.tags` include any of those routing tags, catch-all policies, and expression-only policies.
3. Show them with their destinations and confirm with the user which ones to change.
4. Verify `wf-slack`, then `PATCH` the `destinations` of each confirmed policy.

### Edit an existing rule of unknown system

User: "Snooze rule `cpu-web` for two hours."

1. `GET kbn:/api/alerting/v2/rules/cpu-web` → 404. `GET kbn:/api/alerting/rule/cpu-web` → found.
2. The rule is classic: read `classic-rules.md` and use its snooze call.

### Classic rule type named

User: "Create an Elasticsearch query rule that fires when more than 100 error logs arrive in 10 minutes."

The user named a classic rule type: read `classic-rules.md` and `classic-rule-types.md`, then create the classic rule
they describe.

## Guidelines

- Treat find and list requests as strictly read-only.
- Load classic references only for a named classic rule type or an existing classic rule; for every other job, use
  Universal Alerting references only.
- Prefix paths with `kbn:/s/<space_id>/` for non-default Kibana spaces. Rules, policies, connectors, and workflows are
  space-scoped and must share a space.
- Confirm with the user before deleting rules or policies.
- Do **not** migrate classic rules to Universal Alerting; it is not supported. Edit a classic rule in place.
- Do **not** use this skill for Security detection rules: `consumer: "securitySolution"`/`"siem"` and
  `/api/detection_engine/rules` belong to the Security Detections API.

## Common pitfalls

1. **Wrong system** — creating a classic rule for a new request that did not name a classic rule type, or editing an
   existing rule without looking it up in both systems.
2. **Mixed concepts** — rule-level actions or connectors in a Universal Alerting answer, or action policies and routing
   tags in a classic one.
3. **Wrong notification scope** — creating policies, workflows, or actions when the user only asked for a rule, or
   skipping notifications when the user asked to be alerted.
4. **Read-only violations** — creating or mutating anything when the user asked only to list or filter.
5. **Unverified success** — reporting success without reading the rule or policy back.

## References

- [universal-rules.md](references/universal-rules.md) — Universal rule kinds, fields, ES|QL query, recovery, no-data,
  lifecycle
- [universal-action-policies.md](references/universal-action-policies.md) — Action policy find, create, update,
  lifecycle, bulk, and ownership
- [universal-action-policy-api-fields.md](references/universal-action-policy-api-fields.md) — Action policy request and
  response fields, bounds, error codes
- [universal-matching-grouping-throttle.md](references/universal-matching-grouping-throttle.md) — Matcher fields,
  grouping modes, throttle strategies, dispatch flow
- [universal-workflow-destinations.md](references/universal-workflow-destinations.md) — Destination workflow
  requirements, dispatch payload, example workflow
- [classic-rules.md](references/classic-rules.md) — Classic only (Process step 1): find, create, update, lifecycle,
  tuning
- [classic-rule-types.md](references/classic-rule-types.md) — Classic only: rule types, params, consumers, action groups
- [classic-actions-connectors-terraform.md](references/classic-actions-connectors-terraform.md) — Classic only: rule
  actions, workflows as connectors, Terraform
- [Kibana Alerting API](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-alerting)
- [Kibana Universal Alerting API](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-alerting-v2)
- [Alerting concepts](https://www.elastic.co/docs/explore-analyze/alerting/alerts)
- [Kibana Workflows](https://www.elastic.co/docs/explore-analyze/workflows)

## Operations

`elastic kb` is shorthand for `elastic stack kb`. Universal Alerting and Workflows write commands take the JSON body
from `--input-file '<path.json>'`. Add `--space '<space_id>'` for a non-default space. If the CLI rejects a command name
from this table, run `elastic kb alerting-v2 --help` (or the matching command group) and use the listed name.

| HTTP API (shorthand)                                                  | `elastic` CLI command                                                                                                                                                                                            |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /_license`                                                       | `elastic es license get`                                                                                                                                                                                         |
| `POST /_query`                                                        | `elastic es esql query --query '<esql>'`                                                                                                                                                                         |
| `GET kbn:/api/alerting/v2/rules`                                      | `elastic kb alerting-v2 get-alerting-v2-rules [--filter '<kql>'] [--search '<q>'] [--page <n>] [--per-page <n>] [--sort-field <field>] [--sort-order asc\|desc]`                                                 |
| `POST kbn:/api/alerting/v2/rules`                                     | `elastic kb alerting-v2 post-alerting-v2-rules --input-file '<rule.json>'`                                                                                                                                       |
| `GET kbn:/api/alerting/v2/rules/{id}`                                 | `elastic kb alerting-v2 get-alerting-v2-rules-id --id '<id>'`                                                                                                                                                    |
| `PUT kbn:/api/alerting/v2/rules/{id}`                                 | `elastic kb alerting-v2 put-alerting-v2-rules-id --id '<id>' --input-file '<rule.json>'`                                                                                                                         |
| `PATCH kbn:/api/alerting/v2/rules/{id}`                               | `elastic kb alerting-v2 patch-alerting-v2-rules-id --id '<id>' --input-file '<patch.json>'`                                                                                                                      |
| `DELETE kbn:/api/alerting/v2/rules/{id}`                              | `elastic kb alerting-v2 delete-alerting-v2-rules-id --id '<id>'`                                                                                                                                                 |
| `POST kbn:/api/alerting/v2/rules/{id}/_enable`                        | `elastic kb alerting-v2 post-alerting-v2-rules-id-enable --id '<id>'`                                                                                                                                            |
| `POST kbn:/api/alerting/v2/rules/{id}/_disable`                       | `elastic kb alerting-v2 post-alerting-v2-rules-id-disable --id '<id>'`                                                                                                                                           |
| `POST kbn:/api/alerting/v2/rules/_bulk_enable`                        | `elastic kb alerting-v2 post-alerting-v2-rules-bulk-enable --input-file '<ids.json>'`                                                                                                                            |
| `POST kbn:/api/alerting/v2/rules/_bulk_disable`                       | `elastic kb alerting-v2 post-alerting-v2-rules-bulk-disable --input-file '<ids.json>'`                                                                                                                           |
| `POST kbn:/api/alerting/v2/rules/_bulk_delete`                        | `elastic kb alerting-v2 post-alerting-v2-rules-bulk-delete --input-file '<ids.json>'`                                                                                                                            |
| `GET kbn:/api/alerting/v2/action_policies`                            | `elastic kb alerting-v2 get-alerting-v2-action-policies [--filter '<kql>'] [--search '<q>'] [--page <n>] [--per-page <n>] [--sort-field <field>] [--sort-order asc\|desc]`                                       |
| `GET kbn:/api/alerting/v2/action_policies/{id}`                       | `elastic kb alerting-v2 get-alerting-v2-action-policies-id --id '<id>'`                                                                                                                                          |
| `POST kbn:/api/alerting/v2/action_policies`                           | `elastic kb alerting-v2 post-alerting-v2-action-policies --input-file '<policy.json>'`                                                                                                                           |
| `PUT kbn:/api/alerting/v2/action_policies/{id}`                       | `elastic kb alerting-v2 put-alerting-v2-action-policies-id --id '<id>' --input-file '<policy.json>'`                                                                                                             |
| `PATCH kbn:/api/alerting/v2/action_policies/{id}`                     | `elastic kb alerting-v2 patch-alerting-v2-action-policies-id --id '<id>' --input-file '<patch.json>'`                                                                                                            |
| `DELETE kbn:/api/alerting/v2/action_policies/{id}`                    | `elastic kb alerting-v2 delete-alerting-v2-action-policies-id --id '<id>'`                                                                                                                                       |
| `POST kbn:/api/alerting/v2/action_policies/{id}/_enable`              | `elastic kb alerting-v2 post-alerting-v2-action-policies-id-enable --id '<id>'`                                                                                                                                  |
| `POST kbn:/api/alerting/v2/action_policies/{id}/_disable`             | `elastic kb alerting-v2 post-alerting-v2-action-policies-id-disable --id '<id>'`                                                                                                                                 |
| `POST kbn:/api/alerting/v2/action_policies/{id}/_snooze`              | `elastic kb alerting-v2 post-alerting-v2-action-policies-id-snooze --id '<id>' --input-file '<snooze.json>'`                                                                                                     |
| `POST kbn:/api/alerting/v2/action_policies/{id}/_unsnooze`            | `elastic kb alerting-v2 post-alerting-v2-action-policies-id-unsnooze --id '<id>'`                                                                                                                                |
| `POST kbn:/api/alerting/v2/action_policies/{id}/_update_api_key`      | `elastic kb alerting-v2 post-alerting-v2-action-policies-id-update-api-key --id '<id>'`                                                                                                                          |
| `POST kbn:/api/alerting/v2/action_policies/_bulk_enable`              | `elastic kb alerting-v2 post-alerting-v2-action-policies-bulk-enable --input-file '<ids.json>'`                                                                                                                  |
| `POST kbn:/api/alerting/v2/action_policies/_bulk_disable`             | `elastic kb alerting-v2 post-alerting-v2-action-policies-bulk-disable --input-file '<ids.json>'`                                                                                                                 |
| `POST kbn:/api/alerting/v2/action_policies/_bulk_snooze`              | `elastic kb alerting-v2 post-alerting-v2-action-policies-bulk-snooze --input-file '<ids-and-snooze.json>'`                                                                                                       |
| `POST kbn:/api/alerting/v2/action_policies/_bulk_unsnooze`            | `elastic kb alerting-v2 post-alerting-v2-action-policies-bulk-unsnooze --input-file '<ids.json>'`                                                                                                                |
| `POST kbn:/api/alerting/v2/action_policies/_bulk_update_api_key`      | `elastic kb alerting-v2 post-alerting-v2-action-policies-bulk-update-api-key --input-file '<ids.json>'`                                                                                                          |
| `POST kbn:/api/alerting/v2/action_policies/_bulk_delete`              | `elastic kb alerting-v2 post-alerting-v2-action-policies-bulk-delete --input-file '<ids.json>'`                                                                                                                  |
| `GET kbn:/api/workflows/connectors`                                   | `elastic kb workflows get-workflows-connectors`                                                                                                                                                                  |
| `GET kbn:/api/workflows/schema`                                       | `elastic kb workflows get-workflows-schema --loose false`                                                                                                                                                        |
| `POST kbn:/api/workflows/test`                                        | `elastic kb workflows post-workflows-test --input-file '<test.json>'`                                                                                                                                            |
| `GET kbn:/api/workflows/executions/{executionId}`                     | `elastic kb workflows get-workflows-executions-executionid --execution-id '<id>'`                                                                                                                                |
| `GET kbn:/api/workflows/executions/{executionId}/logs`                | `elastic kb workflows get-workflows-executions-executionid-logs --execution-id '<id>'`                                                                                                                           |
| `GET kbn:/api/workflows/workflow/{id}`                                | `elastic kb workflows get-workflows-workflow-id --id '<id>'`                                                                                                                                                     |
| `POST kbn:/api/workflows/workflow`                                    | `elastic kb workflows post-workflows-workflow --input-file '<workflow.json>'`                                                                                                                                    |
| `PUT kbn:/api/workflows/workflow/{id}`                                | `elastic kb workflows put-workflows-workflow-id --id '<id>' --input-file '<workflow.json>'`                                                                                                                      |
| `GET kbn:/api/actions/connector/{id}`                                 | `elastic kb connectors get-actions-connector-id --id '<id>'`                                                                                                                                                     |
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
