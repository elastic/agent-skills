# Workflow YAML Reference

Elastic Workflows are YAML documents executed by Kibana. They have metadata, triggers, optional constants and outputs,
and an ordered `steps` array. Manual inputs belong on the manual trigger.

## Root Structure

```yaml
version: "1"
name: Workflow Name
description: What this workflow does
enabled: true
tags: ["tag1", "tag2"]

consts:
  index: "logs-*"

triggers:
  - type: manual
    inputs:
      properties:
        severity:
          type: string
          description: Alert severity to process
          default: "critical"

steps:
  - name: first_step
    type: console
    with:
      message: "Workflow started"
```

## Triggers

### Manual

Use manual triggers for demos, testing, and user-initiated runs.

```yaml
triggers:
  - type: manual
    inputs:
      properties:
        severities:
          type: array
          items:
            type: string
          default: ["low", "high"]
```

Manual input definitions use JSON Schema. Arrays need an `items` schema; objects should declare their `properties`.

Manual runs do not have alert event context. If a workflow can run manually and from alerts, guard alert-only branches.

### Scheduled — interval

Use scheduled triggers for recurring checks or reports.

```yaml
triggers:
  - type: scheduled
    with:
      every: "1h" # units: s, m, h, d (minimum 1 minute)
```

### Scheduled — RRule

For calendar-aligned schedules (specific weekdays, month days, hours), use an RRule instead of `every`.

```yaml
triggers:
  - type: scheduled
    with:
      rrule:
        freq: DAILY # DAILY | WEEKLY | MONTHLY
        interval: 1
        tzid: UTC
        dtstart: "2026-01-01T09:00:00Z"
        byhour: [9, 17]
        byminute: [0]
        byweekday: [MO, TU, WE, TH, FR]
        bymonthday: [1, 15]
```

### Alert

Use alert triggers when a Kibana rule or Security detection should dispatch to the workflow.

```yaml
triggers:
  - type: alert
```

Alert runtime data is available under `event`:

- `{{ event.alerts }}` — array of alert documents
- `{{ event.alerts[0]._id }}` — alert ID
- `{{ event.alerts[0]._index }}` — alert index
- `{{ event.alerts[0]["@timestamp"] }}` — alert timestamp
- `{{ event.rule.name }}` — rule name
- `{{ event.spaceId }}` — Kibana space

For Security detection rule alerts, `event.alerts[0]` carries the alert document. Document fields depend on the rule and
solution; verify them against a representative alert. Common Security alert fields include:

```yaml
event.alerts[0]._id # alert document _id
event.alerts[0].kibana.alert.rule.name # detection rule name on a Security alert
event.alerts[0].host.name # affected host
event.alerts[0].host.ip # host IP(s)
event.alerts[0].user.name # affected user
event.alerts[0].kibana.alert.severity # alert severity
event.alerts[0].elastic.agent.id # Elastic Agent ID
event.alerts[0].process.name # process that triggered the alert
```

Never use `triggers.event`, `trigger.event`, or `triggers.event.*`.

#### Dual-trigger pattern (manual + alert)

When a workflow has both `manual` and `alert` triggers, alert event context is unavailable for manual runs. Keep alert
references out of the manual path; do not rely on a compound condition to make an unsafe event dereference harmless.

Split into two guarded branches: use `condition: "event: *"` for the alert path, and `condition: "inputs.<field>: *"`
for the manual path. Never mix `event` references into the manual path or vice versa.

```yaml
triggers:
  - type: manual
    inputs:
      properties:
        target_hash:
          type: string
  - type: alert

steps:
  - name: alert_path
    type: if
    condition: "event: *"
    steps:
      - name: process_alert
        type: console
        with:
          message: "Alert: {{ event.alerts[0].kibana.alert.rule.name }}"

  - name: manual_path
    type: if
    condition: "inputs.target_hash: *"
    steps:
      - name: process_manual
        type: console
        with:
          message: "Manual run for {{ inputs.target_hash }}"
```

## Inputs And Constants

Use `consts` for fixed workflow configuration. Declare runtime inputs on a manual trigger.

```yaml
consts:
  target_index: "logs-*"

triggers:
  - type: manual
    inputs:
      properties:
        service_name:
          type: string
          description: Service to inspect
```

Reference them with Liquid:

```yaml
with:
  message: "Checking {{ inputs.service_name }} in {{ consts.target_index }}"
```

`data.set` creates per-execution values under `variables`; it is not durable storage.

## Step Fields

Every step has:

- `name`: unique within the workflow
- `type`: step type ID or connector type
- `with`: input parameters when the selected step type defines them

Common optional fields, when the selected step's strict schema allows them:

- `connector-id`: connector instance ID for connector steps
- `if`: skip this step unless the expression is truthy
- `timeout`: step timeout
- `on-failure`: retry, fallback, and continuation behavior

Step config fields outside `with` depend on the step type:

- `if` step: `condition`, `steps`, `else`
- `foreach` step: `foreach`, `steps`

## Common Step Types

| Step type                  | Description                                |
| -------------------------- | ------------------------------------------ |
| `console`                  | Log a message for debugging or demo output |
| `elasticsearch.search`     | Execute Elasticsearch Query DSL            |
| `elasticsearch.esql.query` | Execute ES\|QL                             |
| `elasticsearch.bulk`       | Bulk index documents                       |
| `data.set`                 | Store values in workflow context           |
| `if`                       | Branch by KQL condition                    |
| `foreach`                  | Iterate over a collection                  |
| `while`                    | Repeat a body with do-while semantics      |
| `switch`                   | Select one of several branches             |
| `parallel`                 | Run branches concurrently                  |
| `wait`                     | Pause execution                            |
| `workflow.execute`         | Run another saved workflow                 |

`console`, `http`, `elasticsearch.*`, `kibana.*`, connector actions, and extension actions are also available when
registered on the target. Treat `GET kbn:/api/workflows/schema?loose=false` as the source of truth rather than this
summary.

## Connector Steps

Connector steps use the connector type as the step type and require a connector instance ID.

```yaml
- name: send_slack
  type: slack2.sendMessage
  connector-id: my-slack-connector
  with:
    channel: C0123456789
    text: "Workflow completed"
```

The example action ID and fields are verified by current Kibana eval fixtures, but connector definitions evolve. Query
the strict schema for the exact action ID and `with` shape, and query the connectors endpoint for a real instance ID.
Use generic `http` only when no purpose-built action exists or the user requests a custom HTTP API call.

## Liquid Templating

Use `{{ ... }}` to render text. Use `${{ ... }}` when the whole scalar is an expression and its native type (array,
object, number, boolean, or string) must be preserved:

```yaml
{{ inputs.input_name }}
{{ consts.constant_name }}
{{ steps.step_name.output.field }}
{{ foreach.item }}
{{ event }}
${{ steps.search.output.hits.hits }}
```

Common filters:

| Filter                                    | Example                                                 |
| ----------------------------------------- | ------------------------------------------------------- |
| `json`                                    | `{{ object \| json }}` — convert to JSON string         |
| `json:2`                                  | `{{ object \| json:2 }}` — pretty-printed JSON          |
| `json_parse`                              | `{{ string \| json_parse }}` — parse JSON to object     |
| `size`                                    | `{{ array \| size }}` — array length                    |
| `first` / `last`                          | `{{ items \| first }}`                                  |
| `map`                                     | `{{ users \| map: "name" }}`                            |
| `where`                                   | `{{ items \| where: "status", "active" }}`              |
| `where_exp`                               | `{{ items \| where_exp: "item", "item.price > 100" }}`  |
| `join`                                    | `{{ tags \| join: ", " }}`                              |
| `split`                                   | `{{ csv \| split: "," }}`                               |
| `default`                                 | `{{ name \| default: "Unknown" }}`                      |
| `upcase` / `downcase`                     | `{{ text \| upcase }}`                                  |
| `date`                                    | `{{ "now" \| date: "%Y-%m-%d" }}`                       |
| `base64_encode` / `base64_decode`         | `{{ text \| base64_encode }}`                           |
| `url_encode` / `url_decode`               | `{{ query \| url_encode }}`                             |
| `plus` / `minus` / `times` / `divided_by` | `{{ count \| plus: 1 }}`                                |
| `sort`                                    | `{{ items \| sort: "name" }}`                           |
| `entries`                                 | `{{ object \| entries }}` — emit `{ key, value }` pairs |
| `pick`                                    | `{{ object \| pick: "a", "b.c" }}` — retain fields      |

Only step outputs are addressable through `steps.<name>.output`. Step input parameters are not addressable through
`steps.<name>.with.*`. A `data.set` step also merges its key-value output into `variables`; later steps can use
`{{ variables.key }}` or `${{ variables.key }}`.

## Error Handling

Use `on-failure` for retries and fallback steps. Processing order is retry → fallback → continue.

### Step-level

```yaml
- name: call_service
  type: http
  with:
    method: GET
    url: "https://example.com/status"
  on-failure:
    retry:
      max-attempts: 3
      delay: "10s"
    fallback:
      - name: log_failure
        type: console
        with:
          message: "HTTP call failed"
```

### Workflow-level default

Set a workflow-wide `on-failure` block under `settings` to apply the same defaults to every step. Step-level
`on-failure` overrides the workflow default.

```yaml
settings:
  on-failure:
    retry:
      max-attempts: 2
      delay: "1s"
```

## Lifecycle

The fast loop, using the operations from [SKILL.md](../SKILL.md#operations):

1. Write YAML to a file.
2. If every step is read-only or authorized, `POST kbn:/api/workflows/test` with `{ workflowYaml, inputs }`. Otherwise
   test a console-stubbed copy because this endpoint executes the graph.
3. Fix validation or runtime errors surfaced by the execution and logs endpoints.
4. Restore action steps and `POST kbn:/api/workflows/workflow` with `{ yaml, id? }`; keep it disabled if the restored
   side effects have not been executed and approved.
5. Enable and `POST kbn:/api/workflows/workflow/{id}/run` with `{ inputs }` only when authorized.
6. Poll `GET kbn:/api/workflows/executions/{executionId}` and pull
   `GET kbn:/api/workflows/executions/{executionId}/logs` for step output.
