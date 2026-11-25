# Connectors, Actions, Terraform, and Workflows

## Actions in rules

Each action references a connector by ID, an action **group**, action **params** (Mustache templates), and a per-action
**frequency** object.

| Field                   | Purpose                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `id`                    | Connector ID (Slack, PagerDuty, Index, workflow, etc.)            |
| `group`                 | Trigger state (e.g., `"threshold met"`, `"Recovered"`)            |
| `params`                | Connector-specific payload with Mustache variables                |
| `frequency.summary`     | `true` for digest of all alerts; `false` for per-alert            |
| `frequency.notify_when` | `onActionGroupChange`, `onActiveAlert`, or `onThrottleInterval`   |
| `frequency.throttle`    | Minimum repeat interval (e.g., `"10m"`) with `onThrottleInterval` |

Mustache variables include `{{rule.name}}`, `{{context.*}}`, `{{alerts.new.count}}`, `{{rule.url}}`. For full connector
payloads and Mustache lambdas (`EvalMath`, `FormatDate`, `ParseHjson`), see the
[Kibana connectors API](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-actions).

**Best practice:** Always pair an active action with a **Recovered** action for PagerDuty, Jira, and ServiceNow so
incidents auto-close.

## Triggering Kibana Workflows from rules

> Preview feature — Elastic Stack 9.3+ and Elastic Cloud Serverless. APIs may change.

Attach a workflow as a rule action using the workflow ID as the connector ID. Set `params: {}` — alert context flows
through the `event` object inside the workflow. In the UI: **Stack Management → Rules → Actions → Workflows**. Only
`enabled: true` workflows appear in the picker.

Update the rule with `PUT kbn:/api/alerting/rule/{id}` and an `actions` array referencing the workflow connector.

## Terraform (rules-as-code)

Use the `elasticstack` provider resource `elasticstack_kibana_alerting_rule`.

```hcl
resource "elasticstack_kibana_alerting_rule" "cpu_alert" {
  name         = "CPU usage critical"
  consumer     = "stackAlerts"
  rule_type_id = ".index-threshold"
  interval     = "1m"
  enabled      = true

  params = jsonencode({
    index               = ["metrics-*"]
    timeField           = "@timestamp"
    aggType             = "avg"
    aggField            = "system.cpu.total.pct"
    groupBy             = "top"
    termField           = "host.name"
    termSize            = 10
    threshold           = [0.9]
    thresholdComparator = ">"
    timeWindowSize      = 5
    timeWindowUnit      = "m"
  })

  tags = ["infrastructure", "production"]
}
```

Notes:

- `params` must be JSON-encoded via `jsonencode()`.
- Reference connector IDs via `elasticstack_kibana_action_connector` data source or resource.
- Import: `terraform import elasticstack_kibana_alerting_rule.my_rule <space_id>/<rule_id>` (`default` for the default
  space).

See
[Terraform: elasticstack_kibana_alerting_rule](https://registry.terraform.io/providers/elastic/elasticstack/latest/docs/resources/kibana_alerting_rule).
