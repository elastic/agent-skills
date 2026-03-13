---
name: kibana-alerting-rules
description: >
  Create and manage Kibana alerting rules via REST API or Terraform. Use when creating,
  updating, or managing rule lifecycle (enable, disable, mute, snooze) or rules-as-code
  workflows.
metadata:
  author: elastic
  version: 0.1.0
---

# Kibana Alerting Rules

## Core Concepts

A rule has three parts: **conditions** (what to detect), **schedule** (how often to check), and **actions** (what
happens when conditions are met). When conditions are met, the rule creates **alerts**, which trigger **actions** via
**connectors**.

## Authentication

All alerting API calls require either API key auth or Basic auth. Every mutating request must include the `kbn-xsrf`
header.

```http
kbn-xsrf: true
```

## Required Privileges

- `all` privileges for the appropriate Kibana feature (e.g., Stack Rules, Observability, Security)
- `read` privileges for Actions and Connectors (to attach actions to rules)

## API Reference

Base path: `<kibana_url>/api/alerting` (or `/s/<space_id>/api/alerting` for non-default spaces).

| Operation         | Method | Endpoint                                                   |
| ----------------- | ------ | ---------------------------------------------------------- |
| Create rule       | POST   | `/api/alerting/rule/{id}`                                  |
| Update rule       | PUT    | `/api/alerting/rule/{id}`                                  |
| Get rule          | GET    | `/api/alerting/rule/{id}`                                  |
| Delete rule       | DELETE | `/api/alerting/rule/{id}`                                  |
| Find rules        | GET    | `/api/alerting/rules/_find`                                |
| List rule types   | GET    | `/api/alerting/rule_types`                                 |
| Enable rule       | POST   | `/api/alerting/rule/{id}/_enable`                          |
| Disable rule      | POST   | `/api/alerting/rule/{id}/_disable`                         |
| Mute all alerts   | POST   | `/api/alerting/rule/{id}/_mute_all`                        |
| Unmute all alerts | POST   | `/api/alerting/rule/{id}/_unmute_all`                      |
| Mute alert        | POST   | `/api/alerting/rule/{rule_id}/alert/{alert_id}/_mute`      |
| Unmute alert      | POST   | `/api/alerting/rule/{rule_id}/alert/{alert_id}/_unmute`    |
| Update API key    | POST   | `/api/alerting/rule/{id}/_update_api_key`                  |
| Create snooze     | POST   | `/api/alerting/rule/{id}/snooze_schedule`                  |
| Delete snooze     | DELETE | `/api/alerting/rule/{ruleId}/snooze_schedule/{scheduleId}` |
| Health check      | GET    | `/api/alerting/_health`                                    |

## Creating a Rule

### Required Fields

| Field          | Type   | Description                                                                                                                                           |
| -------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`         | string | Display name (does not need to be unique)                                                                                                             |
| `rule_type_id` | string | The rule type (e.g., `.es-query`, `.index-threshold`)                                                                                                 |
| `consumer`     | string | Owning app: `alerts`, `apm`, `discover`, `infrastructure`, `logs`, `metrics`, `ml`, `monitoring`, `securitySolution`, `siem`, `stackAlerts`, `uptime` |
| `params`       | object | Rule-type-specific parameters                                                                                                                         |
| `schedule`     | object | Check interval, e.g., `{"interval": "5m"}`                                                                                                            |

### Optional Fields

| Field         | Type        | Description                                                                                         |
| ------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `actions`     | array       | Actions to run when conditions are met (each references a connector)                                |
| `tags`        | array       | Tags for organizing rules                                                                           |
| `enabled`     | boolean     | Whether the rule runs immediately (default: true)                                                   |
| `notify_when` | string      | `onActionGroupChange`, `onActiveAlert`, or `onThrottleInterval` (prefer setting per-action instead) |
| `alert_delay` | object      | Alert only after N consecutive matches, e.g., `{"active": 3}`                                       |
| `flapping`    | object/null | Override flapping detection settings                                                                |

### Example: Create an Elasticsearch Query Rule

```bash
curl -X POST "https://my-kibana:5601/api/alerting/rule/my-rule-id" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -H "Authorization: ApiKey <your-api-key>" \
  -d '{
    "name": "High error rate",
    "rule_type_id": ".es-query",
    "consumer": "stackAlerts",
    "schedule": { "interval": "5m" },
    "params": {
      "index": ["logs-*"],
      "timeField": "@timestamp",
      "esQuery": "{\"query\":{\"match\":{\"log.level\":\"error\"}}}",
      "threshold": [100],
      "thresholdComparator": ">",
      "timeWindowSize": 5,
      "timeWindowUnit": "m",
      "size": 100
    },
    "actions": [
      {
        "id": "my-slack-connector-id",
        "group": "query matched",
        "params": {
          "message": "Alert: {{rule.name}} - {{context.hits}} hits detected"
        },
        "frequency": {
          "summary": false,
          "notify_when": "onActionGroupChange"
        }
      }
    ],
    "tags": ["production", "errors"]
  }'
```

The same structure applies to other rule types — set the appropriate `rule_type_id` (e.g., `.index-threshold`,
`.es-query`) and provide the matching `params` object. Use `GET /api/alerting/rule_types` to discover params schemas.

## Updating a Rule

`PUT /api/alerting/rule/{id}` — send the complete rule body. `rule_type_id` and `consumer` are immutable after creation.
Returns **409 Conflict** if another user updated the rule concurrently; re-fetch and retry.

## Finding Rules

```bash
curl -X GET "https://my-kibana:5601/api/alerting/rules/_find?per_page=20&page=1&search=cpu&sort_field=name&sort_order=asc" \
  -H "Authorization: ApiKey <your-api-key>"
```

Query parameters: `per_page`, `page`, `search`, `default_search_operator`, `search_fields`, `sort_field`, `sort_order`,
`has_reference`, `fields`, `filter`, `filter_consumers`.

Use the `filter` parameter with KQL syntax for advanced queries:

```text
filter=alert.attributes.tags:"production"
```

## Lifecycle Operations

```bash
# Enable
curl -X POST ".../api/alerting/rule/{id}/_enable" -H "kbn-xsrf: true"

# Disable
curl -X POST ".../api/alerting/rule/{id}/_disable" -H "kbn-xsrf: true"

# Mute all alerts
curl -X POST ".../api/alerting/rule/{id}/_mute_all" -H "kbn-xsrf: true"

# Mute specific alert
curl -X POST ".../api/alerting/rule/{rule_id}/alert/{alert_id}/_mute" -H "kbn-xsrf: true"

# Delete
curl -X DELETE ".../api/alerting/rule/{id}" -H "kbn-xsrf: true"
```

## Terraform Provider

Use the `elasticstack` provider resource `elasticstack_kibana_alerting_rule`.

```hcl
terraform {
  required_providers {
    elasticstack = {
      source  = "elastic/elasticstack"
    }
  }
}

provider "elasticstack" {
  kibana {
    endpoints = ["https://my-kibana:5601"]
    api_key   = var.kibana_api_key
  }
}

resource "elasticstack_kibana_alerting_rule" "cpu_alert" {
  name         = "CPU usage critical"
  consumer     = "stackAlerts"
  rule_type_id = ".index-threshold"
  interval     = "1m"
  enabled      = true

  params = jsonencode({
    index              = ["metrics-*"]
    timeField          = "@timestamp"
    aggType            = "avg"
    aggField           = "system.cpu.total.pct"
    groupBy            = "top"
    termField          = "host.name"
    termSize           = 10
    threshold          = [0.9]
    thresholdComparator = ">"
    timeWindowSize     = 5
    timeWindowUnit     = "m"
  })

  tags = ["infrastructure", "production"]
}
```

**Key Terraform notes:**

- `params` must be passed as a JSON-encoded string via `jsonencode()`
- Use `elasticstack_kibana_action_connector` data source or resource to reference connector IDs in actions
- Import existing rules: `terraform import elasticstack_kibana_alerting_rule.my_rule <space_id>/<rule_id>` (use
  `default` for the default space)

## Triggering Kibana Workflows from Rules

> **Preview feature** — available from Elastic Stack 9.3 and Elastic Cloud Serverless. APIs may change.

Attach a workflow as a rule action using the workflow ID as the connector ID. Set `params: {}` — alert context flows
automatically through the `event` object inside the workflow.

```bash
curl -X PUT "https://my-kibana:5601/api/alerting/rule/my-rule-id" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -H "Authorization: ApiKey <your-api-key>" \
  -d '{
    "name": "High error rate",
    "schedule": { "interval": "5m" },
    "params": { ... },
    "actions": [
      {
        "id": "<workflow-id>",
        "group": "query matched",
        "params": {},
        "frequency": { "summary": false, "notify_when": "onActionGroupChange" }
      }
    ]
  }'
```

In the UI: **Stack Management > Rules > Actions > Workflows**. Only `enabled: true` workflows appear in the picker.

For workflow YAML structure, `{{ event }}` context fields, step types, and patterns, refer to the `kibana-connectors`
skill if available.

## Connectors and Actions in Rules

Each action references a connector by ID, an action `group`, action `params` (using Mustache templates), and a
per-action `frequency` object. Key fields:

- `group` — which trigger state fires this action (e.g., `"query matched"`, `"Recovered"`). Discover valid groups via
  `GET /api/alerting/rule_types`.
- `frequency.summary` — `true` for a digest of all alerts; `false` for per-alert.
- `frequency.notify_when` — `onActionGroupChange` | `onActiveAlert` | `onThrottleInterval`.
- `frequency.throttle` — minimum repeat interval (e.g., `"10m"`); only applies with `onThrottleInterval`.

For full reference on action structure, Mustache variables (`{{rule.name}}`, `{{context.*}}`, `{{alerts.new.count}}`),
Mustache lambdas (`EvalMath`, `FormatDate`, `ParseHjson`), recovery actions, and multi-channel patterns, refer to the
`kibana-connectors` skill if available.

## Best Practices

1. **Set action frequency per action, not per rule.** The `notify_when` field at the rule level is deprecated in favor
   of per-action `frequency` objects. If you set it at the rule level and later edit the rule in the Kibana UI, it is
   automatically converted to action-level values.

2. **Use alert summaries to reduce notification noise.** Instead of sending one notification per alert, configure
   actions to send periodic summaries at a custom interval. Use `"summary": true` and set a `throttle` interval. This is
   especially valuable for rules that monitor many hosts or documents.

3. **Choose the right action frequency for each channel.** Use `onActionGroupChange` for paging/ticketing systems (fire
   once, resolve once). Use `onActiveAlert` for audit logging to an Index connector. Use `onThrottleInterval` with a
   throttle like `"30m"` for dashboards or lower-priority notifications.

4. **Always add a recovery action.** Rules without a recovery action leave incidents open in PagerDuty, Jira, and
   ServiceNow indefinitely. Use the connector's native close/resolve event action (e.g., `eventAction: "resolve"` for
   PagerDuty) in the `Recovered` action group.

5. **Set a reasonable check interval.** The minimum recommended interval is `1m`. Very short intervals across many rules
   clog Task Manager throughput and increase schedule drift. The server setting
   `xpack.alerting.rules.minimumScheduleInterval.value` enforces this.

6. **Use `alert_delay` to suppress transient spikes.** Setting `{"active": 3}` means the alert only fires after 3
   consecutive runs match the condition, filtering out brief anomalies.

7. **Enable flapping detection.** Alerts that rapidly switch between active and recovered are marked as "flapping" and
   notifications are suppressed. This is on by default but can be tuned per-rule with the `flapping` object.

8. **Use `server.publicBaseUrl` for deep links.** Set `server.publicBaseUrl` in `kibana.yml` so that `{{rule.url}}` and
   `{{kibanaBaseUrl}}` variables resolve to valid URLs in notifications.

9. **Tag rules consistently.** Use tags like `production`, `staging`, `team-platform` for filtering and organization in
   the Find API and UI.

10. **Use Kibana Spaces** to isolate rules by team or environment. Prefix API paths with `/s/<space_id>/` for
    non-default spaces. Connectors are also space-scoped, so create matching connectors in each space.

## Common Pitfalls

1. **Missing `kbn-xsrf` header.** All POST, PUT, DELETE requests require `kbn-xsrf: true` or any truthy value. Omitting
   it returns a 400 error.

2. **Wrong `consumer` value.** Using an invalid consumer (e.g., `observability` instead of `infrastructure`) causes a
   400 error. Check the rule type's supported consumers via `GET /api/alerting/rule_types`.

3. **Immutable fields on update.** You cannot change `rule_type_id` or `consumer` with PUT. You must delete and recreate
   the rule.

4. **Rule-level `notify_when` and `throttle` are deprecated.** Setting these at the rule level still works but conflicts
   with action-level frequency settings. Always use `frequency` inside each action object.

5. **Rule ID conflicts.** POST to `/api/alerting/rule/{id}` with an existing ID returns 409. Either omit the ID to
   auto-generate, or check existence first.

6. **API key ownership.** Rules run using the API key of the user who created or last updated them. If that user's
   permissions change or the user is deleted, the rule may fail silently. Use `_update_api_key` to re-associate.

7. **Too many actions per rule.** Rules generating thousands of alerts with multiple actions can clog Task Manager. The
   server setting `xpack.alerting.rules.run.actions.max` (default varies) limits actions per run. Design rules to use
   alert summaries or limit term sizes.

8. **Long-running rules.** Rules that run expensive queries are cancelled after `xpack.alerting.rules.run.timeout`
   (default `5m`). When cancelled, all alerts and actions from that run are discarded. Optimize queries or increase the
   timeout for specific rule types.

9. **Concurrent update conflicts.** PUT returns 409 if the rule was modified by another user since you last read it.
   Always GET the latest version before updating.

10. **Import/export loses secrets.** Rules exported via Saved Objects are disabled on import. Connectors lose their
    secrets and must be re-configured.

## Examples

**Create a threshold alert:** "Alert me when CPU exceeds 90% on any host for 5 minutes." Use
`rule_type_id: ".index-threshold"`, `aggField: "system.cpu.total.pct"`, `threshold: [0.9]`, and `timeWindowSize: 5`.
Attach a PagerDuty action on `"threshold met"` and a matching `Recovered` action to auto-close incidents.

**Find rules by tag:** "Show all production alerting rules." `GET /api/alerting/rules/_find` with
`filter=alert.attributes.tags:"production"` and `sort_field=name` to page through results.

**Pause a rule temporarily:** "Disable rule abc123 until next Monday." `POST /api/alerting/rule/abc123/_disable`.
Re-enable with `_enable` when ready; the rule retains all configuration while disabled.

## Guidelines

- Include `kbn-xsrf: true` on every POST, PUT, and DELETE; omitting it returns 400.
- Set `frequency` inside each action object — rule-level `notify_when` and `throttle` are deprecated.
- `rule_type_id` and `consumer` are immutable after creation; delete and recreate the rule to change them.
- Prefix paths with `/s/<space_id>/api/alerting/` for non-default Kibana Spaces.
- Always pair an active action with a `Recovered` action to auto-close PagerDuty, Jira, and ServiceNow incidents.
- Run `GET /api/alerting/rule_types` first to discover valid `consumer` values and action group names.
- Use `alert_delay` to suppress transient spikes; use the `flapping` object to reduce noise from unstable conditions.

## Additional Resources

- [Kibana Alerting API Reference](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-alerting)
- [Alerting Concepts](https://www.elastic.co/docs/explore-analyze/alerting/alerts)
- [Create and Manage Rules (UI)](https://www.elastic.co/docs/explore-analyze/alerting/alerts/create-manage-rules)
- [Rule Action Variables](https://www.elastic.co/docs/explore-analyze/alerting/alerts/rule-action-variables)
- [Alerting Production Considerations](https://www.elastic.co/docs/deploy-manage/production-guidance/kibana-alerting-production-considerations)
- [Terraform: elasticstack_kibana_alerting_rule](https://registry.terraform.io/providers/elastic/elasticstack/latest/docs/resources/kibana_alerting_rule)
- [Terraform: Managing Kibana Rule and Connector Resources](https://registry.terraform.io/providers/elastic/elasticstack/latest/docs/guides/elasticstack-kibana-rule)
