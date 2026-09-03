# Connectors and Actions in Rules: Design Reference

## Action Structure

Each action in a rule references a connector and has its own `frequency` configuration:

```json
{
  "id": "<connector-id>",
  "group": "query matched",
  "params": { "message": "{{rule.name}} fired: {{context.reason}}" },
  "frequency": {
    "summary": false,
    "notify_when": "onActionGroupChange",
    "throttle": null
  }
}
```

- `group`: The action group (e.g., `"query matched"`, `"threshold met"`, `"Recovered"`). Each rule type defines its
  valid groups. Discover them via `GET /api/alerting/rule_types`.
- `frequency.summary`: `true` for a summary of all alerts; `false` to run per-alert.
- `frequency.notify_when`: `onActionGroupChange` | `onActiveAlert` | `onThrottleInterval`.
- `frequency.throttle`: Minimum interval between repeated notifications (e.g., `"10m"`). Only applies when `notify_when`
  is `onThrottleInterval`.

> **Deprecated:** Do not set `notify_when` or `throttle` at the rule level. These are deprecated in favour of per-action
> `frequency` objects and will be auto-converted if the rule is edited in the Kibana UI.

## Action Variables (Mustache Templates)

Action `params` use [Mustache](https://mustache.github.io/mustache.5.html) syntax to inject rule and alert values at
runtime.

### Common variables (all rule types)

| Variable            | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| `{{rule.id}}`       | Rule identifier                                               |
| `{{rule.name}}`     | Rule name                                                     |
| `{{rule.tags}}`     | Rule tags                                                     |
| `{{rule.url}}`      | Deep link to rule in Kibana (requires `server.publicBaseUrl`) |
| `{{date}}`          | ISO timestamp when the action was scheduled                   |
| `{{kibanaBaseUrl}}` | Kibana base URL                                               |

### Per-alert variables (`summary: false`)

| Variable                       | Description                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `{{alert.id}}`                 | Alert instance ID (e.g., the grouped value like a host name)                 |
| `{{alert.uuid}}`               | Stable UUID for the alert lifecycle                                          |
| `{{alert.actionGroup}}`        | Action group that triggered the action                                       |
| `{{alert.flapping}}`           | Whether the alert is flapping                                                |
| `{{alert.consecutiveMatches}}` | Number of consecutive rule runs that matched                                 |
| `{{context.*}}`                | Rule-type-specific context (e.g., `{{context.reason}}`, `{{context.value}}`) |

### Summary variables (`summary: true`)

| Variable                     | Description                |
| ---------------------------- | -------------------------- |
| `{{alerts.new.count}}`       | Count of new alerts        |
| `{{alerts.ongoing.count}}`   | Count of ongoing alerts    |
| `{{alerts.recovered.count}}` | Count of recovered alerts  |
| `{{alerts.all.count}}`       | Total count                |
| `{{alerts.new.data}}`        | Array of new alert objects |

### Iterating over arrays

For rule types that return multiple hits (e.g., ES Query rules):

```mustache
{{#context.hits}} - {{_source.message}} ({{_source.@timestamp}})
{{/context.hits}}
```

### Debugging templates

Use `{{{.}}}` in any action body to dump the entire variable context as a JSON object. Remove before enabling the rule
in production.

## Mustache Lambdas

Kibana provides built-in lambdas for advanced template rendering:

```mustache
# Round a numeric value
{{#EvalMath}} round(context.value, 2) {{/EvalMath}}

# Format a date in a specific timezone
{{#FormatDate}} {{{date}}} ; America/New_York ; YYYY-MM-DD HH:mm {{/FormatDate}}

# Render numbers with locale formatting
{{#FormatNumber}} {{{context.value}}} ; en-US ; maximumFractionDigits: 2 {{/FormatNumber}}

# Build clean JSON from Hjson for Webhook connectors
{{#ParseHjson}}
{
  ruleId:   "{{rule.id}}"
  ruleName: "{{rule.name}}"
  value:    "{{context.value}}"
}
{{/ParseHjson}}
```

`ParseHjson` is especially useful with Webhook connectors — it allows comments, unquoted keys, and trailing commas,
avoiding strict JSON escaping issues.

## Recovery Actions

Always configure a recovery action alongside the active action to close incidents automatically. Use the `Recovered`
action group:

```json
{
  "actions": [
    {
      "id": "my-pagerduty",
      "group": "threshold met",
      "params": { "eventAction": "trigger", "dedupKey": "{{rule.id}}-{{alert.id}}", "summary": "{{rule.name}} firing" },
      "frequency": { "summary": false, "notify_when": "onActionGroupChange" }
    },
    {
      "id": "my-pagerduty",
      "group": "recovered",
      "params": {
        "eventAction": "resolve",
        "dedupKey": "{{rule.id}}-{{alert.id}}",
        "summary": "{{rule.name}} resolved"
      },
      "frequency": { "summary": false, "notify_when": "onActionGroupChange" }
    }
  ]
}
```

PagerDuty and Opsgenie have dedicated `resolve`/`close` event actions for recovery. ServiceNow and Jira connectors have
a `Close alert` sub-action. Without a recovery action, incidents remain open indefinitely.

## Multi-Channel Action Design

Attach multiple actions to a single rule to route to different channels based on purpose:

```json
{
  "actions": [
    {
      "id": "slack-connector",
      "group": "query matched",
      "params": { "message": ":warning: *{{rule.name}}* fired\n> {{context.reason}}" },
      "frequency": { "summary": false, "notify_when": "onActionGroupChange" }
    },
    {
      "id": "pagerduty-connector",
      "group": "query matched",
      "params": {
        "eventAction": "trigger",
        "severity": "critical",
        "summary": "{{rule.name}}",
        "dedupKey": "{{rule.id}}-{{alert.id}}"
      },
      "frequency": { "summary": false, "notify_when": "onActionGroupChange" }
    },
    {
      "id": "index-connector",
      "group": "query matched",
      "params": { "documents": [{ "rule": "{{rule.name}}", "ts": "{{date}}", "value": "{{context.value}}" }] },
      "frequency": { "summary": false, "notify_when": "onActiveAlert" }
    }
  ]
}
```

**Pattern:** Slack + PagerDuty fire once on status change (`onActionGroupChange`). Index connector fires every check
interval (`onActiveAlert`) to build a complete time-series audit log.

## Choosing `notify_when` per Channel

| Channel type                  | Recommended `notify_when`              | Reasoning                                        |
| ----------------------------- | -------------------------------------- | ------------------------------------------------ |
| PagerDuty / Opsgenie          | `onActionGroupChange`                  | Page once, resolve once — no duplicate incidents |
| Jira / ServiceNow             | `onActionGroupChange`                  | Create one ticket, close it on recovery          |
| Kibana Cases                  | N/A (Cases connector handles dedup)    | —                                                |
| Slack `#incidents`            | `onActionGroupChange`                  | Low noise, high signal                           |
| Slack `#monitoring` (summary) | `onThrottleInterval` + `summary: true` | Periodic digest, not per-alert spam              |
| Email                         | `onActionGroupChange` or throttled     | Avoid flooding inboxes                           |
| Index (audit log)             | `onActiveAlert`                        | Full history, every occurrence                   |
| Server log                    | `onActiveAlert`                        | Verbose logging for debugging                    |
