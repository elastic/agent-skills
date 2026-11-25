# Workflow Patterns

Common natural-language requests and the workflow shapes they imply.

## Manual Demo Workflow

User says:

- "Create a simple workflow"
- "Make a workflow that logs hello"
- "Show me the fastest end-to-end workflow"

Use:

```yaml
version: "1"
name: Manual Hello Workflow
enabled: true
triggers:
  - type: manual
steps:
  - name: log_hello
    type: console
    with:
      message: "Hello from workflow"
```

This is the best first smoke test because it has no external dependencies.

## Scheduled Report

User says:

- "Every hour, check..."
- "Run daily and summarize..."
- "Generate a periodic report..."

Use:

```yaml
version: "1"
name: Scheduled Health Report
enabled: true
triggers:
  - type: scheduled
    with:
      every: "1h"
steps:
  - name: query_data
    type: elasticsearch.esql.query
    with:
      query: "FROM logs-* | WHERE @timestamp > NOW() - 1 hour | STATS count = COUNT(*)"
  - name: log_summary
    type: console
    with:
      message: "Query result: {{ steps.query_data.output | json }}"
```

Validate index names and field names before relying on this in a real environment.

## Alert Triage

User says:

- "When a critical alert fires..."
- "For each alert, enrich it..."
- "Create a case from alerts..."

Use an alert trigger and `event.alerts`:

```yaml
version: "1"
name: Alert Triage Workflow
enabled: true
triggers:
  - type: alert
steps:
  - name: log_alerts
    type: console
    with:
      message: "Received {{ event.alerts | size }} alerts from {{ event.rule.name }}"
  - name: process_alerts
    type: foreach
    foreach: "${{ event.alerts }}"
    steps:
      - name: log_alert
        type: console
        with:
          message: "Alert {{ foreach.item._id }} in {{ foreach.item._index }}"
```

If the same workflow must also run manually, add inputs or guard alert-only branches because manual runs do not have
`event.alerts`.

## Connector Notification

User says:

- "Send to Slack"
- "Create a Jira ticket"
- "Email the summary"

Use a connector step and require a connector ID:

```yaml
version: "1"
name: Notify Slack Workflow
enabled: true
triggers:
  - type: manual
steps:
  - name: send_slack
    type: slack2.sendMessage
    connector-id: my-slack-connector
    with:
      channel: C0123456789
      text: "Workflow completed"
```

This action shape comes from current Kibana eval fixtures. Confirm the exact type and fields with the target's strict
workflow schema. If the connector ID is unknown, do not invent a real one. Ask or use a placeholder in a disabled draft.

## Query Then Branch

User says:

- "If there are any errors..."
- "Only notify when count is greater than..."
- "Create a case when the query returns results..."

Use a query, compute a simple value, then branch:

```yaml
version: "1"
name: Query Then Branch
enabled: true
triggers:
  - type: manual
steps:
  - name: find_errors
    type: elasticsearch.esql.query
    with:
      query: 'FROM logs-* | WHERE @timestamp > NOW() - 1 hour | WHERE log.level == "error" | STATS errors = COUNT(*)'
  - name: set_error_count
    type: data.set
    with:
      count: "${{ steps.find_errors.output.values[0][0] | default: 0 }}"
  - name: has_errors
    type: if
    condition: "${{ variables.count > 0 }}"
    steps:
      - name: log_errors
        type: console
        with:
          message: "Errors found: {{ variables.count }}"
    else:
      - name: log_clean
        type: console
        with:
          message: "No errors found"
```

Output shape for query steps can vary by step implementation. Test-run before depending on an exact path.

## Local Test Cycle

For any pattern, first prove a safe version:

1. Replace side-effecting connector or HTTP steps with `console` steps.
2. Call `POST kbn:/api/workflows/test` with the safe copy.
3. Inspect output/logs.
4. Restore the side-effecting step once the control flow is correct.
