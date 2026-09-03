# Connectors in Kibana Workflows

> **Preview feature** — Kibana Workflows is available from Elastic Stack 9.3 and Elastic Cloud Serverless. APIs and
> behaviour may change.

Connectors serve as the integration layer across several Kibana workflows beyond basic alerting.

## Workflow 0: Alerting Rules as Workflow Triggers

Kibana Workflows can be driven directly by alerting rules. When a rule fires, the workflow receives the full alert
payload and can act on it using steps.

### Alert trigger YAML definition

```yaml
name: Alert Response Workflow
description: Automated triage and response for alerting rules
enabled: true
triggers:
  - type: alert
steps:
  - name: log_alert
    type: console
    with:
      message: "Rule '{{ event.alerts[0].kibana.alert.rule.name }}' fired"
      details: "{{ event | json:2 }}"
```

### Available alert context fields

All alert data is accessible via `{{ event.alerts[N] }}` in workflow step parameters:

| Field                                        | Description                           |
| -------------------------------------------- | ------------------------------------- |
| `event.alerts[0].kibana.alert.rule.name`     | Name of the rule that fired           |
| `event.alerts[0].kibana.alert.rule.uuid`     | UUID of the rule                      |
| `event.alerts[0].kibana.alert.rule.category` | Rule category                         |
| `event.alerts[0].kibana.alert.reason`        | Human-readable reason the alert fired |
| `event.alerts[0].kibana.alert.status`        | `active` or `recovered`               |
| `event.alerts[0].kibana.alert.severity`      | Severity value (where applicable)     |
| `event.alerts[0].kibana.alert.start`         | ISO timestamp when alert started      |
| `event.alerts[0].kibana.alert.uuid`          | Unique ID for the alert instance      |
| `event.alerts[0].host.name`                  | Host entity (where present)           |
| `event.alerts[0].elastic.agent.id`           | Elastic Agent ID (security alerts)    |
| `event.alerts[0].kibana.space_ids`           | Space the rule lives in               |
| `{{ event \| json:2 }}`                      | Full alert payload as formatted JSON  |

For summary-frequency actions (multiple alerts), iterate:

```yaml
message: "{{ event.alerts | size }} alerts fired"
```

### Three-step alert response pattern

```yaml
name: Alert Triage
enabled: true
triggers:
  - type: alert
steps:
  - name: enrich
    type: ai.prompt
    with:
      connectorId: "<llm-connector-id>"
      prompt: |
        Summarise this security alert and suggest next steps:
        Rule: {{ event.alerts[0].kibana.alert.rule.name }}
        Reason: {{ event.alerts[0].kibana.alert.reason }}
        Host: {{ event.alerts[0].host.name }}

  - name: create_case
    type: kibana.createCaseDefaultSpace
    with:
      title: "{{ event.alerts[0].kibana.alert.rule.name }}"
      description: "{{ steps.enrich.output }}"
      tags: ["automated", "workflow"]
      severity: "critical"
      connector:
        id: "none"
        name: "none"
        type: ".none"

  - name: mute_alert
    type: kibana.request
    with:
      method: POST
      path:
        /api/alerting/rule/{{ event.alerts[0].kibana.alert.rule.uuid }}/alert/{{ event.alerts[0].kibana.alert.uuid
        }}/_mute
```

### Pitfalls specific to alert triggers

- **Only enabled workflows appear in the rule action picker.** Workflows must be set to `enabled: true` in YAML before
  they are selectable from a rule.
- **Threshold detection rules have limited source field access.** Original event fields from the matching documents are
  not always available in `event.alerts[0]`. Use ES Query rules if you need source document fields in the workflow.
- **`params: {}` is valid.** Unlike connector-based actions, workflow actions do not need params populated from the rule
  side — context flows automatically through the `event` object in the workflow definition.
- **Workflows run under the API key of the user who saved the rule action.** If that user's permissions change, the
  workflow may fail. Re-save the rule action to refresh the associated key.

## Workflow 1: Alert → Incident Ticket (ITSM)

Use ServiceNow ITSM, Jira, or IBM Resilient connectors to automatically open tickets when a rule fires and close them on
recovery.

**Pattern:**

- Active action group → connector creates a ticket (Jira issue, ServiceNow incident)
- `Recovered` action group → connector transitions the ticket to resolved/closed

**Tips:**

- Use `{{alert.id}}` as the deduplication key to avoid duplicate tickets for the same alert instance.
- Set `notify_when: onActionGroupChange` on both actions so tickets are created and closed exactly once per alert
  lifecycle.
- ServiceNow ITSM supports `correlation_id` to link Kibana alerts to existing incidents — use `{{rule.id}}-{{alert.id}}`
  as the correlation ID.

## Workflow 2: Alert → On-Call Escalation (PagerDuty / Opsgenie)

Use PagerDuty or Opsgenie connectors to trigger and resolve incidents in your on-call platform.

**PagerDuty deduplication key:** Set `dedupKey` to `{{rule.id}}-{{alert.id}}` so PagerDuty groups multiple trigger
events for the same alert into one incident, and the resolve event closes the right one.

```json
{
  "group": "threshold met",
  "params": {
    "eventAction": "trigger",
    "dedupKey": "{{rule.id}}-{{alert.id}}",
    "severity": "critical",
    "summary": "{{context.reason}}"
  }
}
```

```json
{
  "group": "recovered",
  "params": {
    "eventAction": "resolve",
    "dedupKey": "{{rule.id}}-{{alert.id}}"
  }
}
```

For Opsgenie, use `alias` instead of `dedupKey`. The `close` event action (not `resolve`) closes Opsgenie alerts.

## Workflow 3: Alert → Kibana Case (Case Management)

The **Cases connector** creates Kibana Cases from alerts. It is a system action — it cannot be created, edited, or
deleted via the API or UI. It is only available when creating a rule in the Kibana UI.

**Key behaviors:**

- All alerts from a rule attach to the same Case by default; use a grouping field (e.g., `host.name`) to create one Case
  per alert group.
- A 7-day time window prevents duplicate Cases; alerts within the window are attached to the existing Case.
- If the Case is connected to an external ITSM (ServiceNow, Jira), enable **Auto-push** to sync the Case to that system
  automatically.
- Enable **Re-open closed cases** if you want re-activated alerts to reopen their associated Case.
- Set a **maximum case count** to limit Case creation if the rule can fire for many distinct entities simultaneously.

**Use Cases connector when:** you want a full investigation workflow with comments, attachments, SLA timers, and
assignees — rather than just a point notification.

**Do not use Cases connector when:** you need low-latency paging or automated ticket creation via API/Terraform (Cases
connector is UI-only).

## Workflow 4: Alert → Messaging (Slack / Teams / Email)

Use messaging connectors for awareness notifications that don't require a formal incident response.

**Best message template pattern (Slack example):**

```mustache
:red_circle: *{{rule.name}}* fired
*Reason:* {{context.reason}}
*Time:* {{#FormatDate}} {{{date}}} ; America/New_York {{/FormatDate}}
*Details:* {{{rule.url}}}
```

**Alert summary for busy rules:**

```json
{
  "frequency": {
    "summary": true,
    "notify_when": "onThrottleInterval",
    "throttle": "15m"
  },
  "params": {
    "message": "{{alerts.new.count}} new, {{alerts.ongoing.count}} ongoing, {{alerts.recovered.count}} recovered alerts for rule *{{rule.name}}*"
  }
}
```

**Channel strategy:**

- `#incidents` channel → `onActionGroupChange`, per-alert, no summaries (low noise, high signal)
- `#monitoring` channel → summary every 15–30m (`onThrottleInterval`, `summary: true`)
- On-call (PagerDuty/Opsgenie) → `onActionGroupChange`, always with recovery action

**Email-specific:** Set `server.publicBaseUrl` in `kibana.yml` so `{{{rule.url}}}` generates a valid deep link in email
footers. Without this, email links are empty strings.

## Workflow 5: Alert → Audit Log (Index Connector)

Use the Index connector to write every alert occurrence to an Elasticsearch index for dashboards, SLA tracking, and
audit trails.

```json
{
  "group": "threshold met",
  "params": {
    "documents": [
      {
        "rule_name": "{{rule.name}}",
        "rule_id": "{{rule.id}}",
        "alert_id": "{{alert.id}}",
        "alert_group": "{{alert.actionGroup}}",
        "value": "{{context.value}}",
        "reason": "{{context.reason}}",
        "timestamp": "{{date}}"
      }
    ]
  },
  "frequency": { "summary": false, "notify_when": "onActiveAlert" }
}
```

Set `notify_when: onActiveAlert` so every rule run that finds the condition active writes a record — giving a complete
time-series of the alert, not just the first occurrence. Pair the target index with an ILM policy to control retention
separately from the 90-day event log default.

## Workflow 6: Connectors in AI / LLM Workflows

LLM connectors (OpenAI, Amazon Bedrock, Google Gemini) power the **Elastic AI Assistant** and **Attack Discovery**
features in Security and Observability. These are system connectors used internally by Kibana's AI features.

**Setup recommendations:**

- Use the **AI Connector** type (`.gen-ai`) for flexibility across providers; it supports switching between
  OpenAI-compatible APIs without recreating the connector.
- Only one LLM connector can be active at a time per Kibana Space for the AI Assistant. Configure it in **Stack
  Management > AI Assistants**.
- Restrict LLM connector access to the relevant features via Space privilege settings. Prevent general users from
  executing LLM connectors directly.
- Rotate LLM API keys regularly — they are high-value, rate-limited credentials.
- Monitor token usage and rate limits via the external provider's dashboard; Kibana does not currently expose
  per-connector token consumption metrics.

## Workflow 7: Webhook for Custom Integrations

Use the generic Webhook connector when no first-party connector exists for your target system.

**Best practices:**

- Use `{{#ParseHjson}}` to build the JSON payload cleanly without strict JSON escaping:

  ```mustache
  {{#ParseHjson}}
  {
    ruleId:   "{{rule.id}}"
    ruleName: "{{rule.name}}"
    alertId:  "{{alert.id}}"
    reason:   "{{context.reason}}"
  }
  {{/ParseHjson}}
  ```

- Use triple braces `{{{variable}}}` only when you are certain the value is already properly escaped for the target
  system (e.g., a URL). For JSON payloads, double braces are safe because Kibana escapes JSON-unsafe characters
  automatically.
- Set `hasAuth: true` in the connector config and provide credentials in `secrets` rather than embedding tokens in the
  URL or body.
- Add a `Content-Type: application/json` header in the connector config so the target system parses the body correctly.
