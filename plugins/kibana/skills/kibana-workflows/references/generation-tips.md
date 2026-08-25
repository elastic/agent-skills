# Workflow Generation Tips

Guidelines for translating natural language into valid Elastic Workflow YAML.

## Generation Process

1. **Classify the trigger.**
   - "Run this now", "on demand", "manual" -> `manual`
   - "Every hour", "daily", "periodically" -> `scheduled`
   - "When an alert fires", "from a detection rule" -> `alert`

2. **Identify inputs and constants.**
   - Values users provide at run time belong in `inputs` on a `manual` trigger.
   - Fixed values such as index patterns, thresholds, or connector names belong in `consts`.

3. **Choose the smallest step sequence.**
   - Start with `console` for simple demos.
   - Use `elasticsearch.search` or `elasticsearch.esql.query` for data lookup.
   - Use `data.set` before conditions when a computed value is needed.
   - Use connector steps for external systems.

4. **Write YAML with explicit data flow.**
   - Give each step a stable snake_case `name`.
   - Reference prior step outputs through `steps.<name>.output`; reference `data.set` values through `variables.<key>`.
   - Use `foreach.item` only inside `foreach` child steps.

5. **Test safely.**
   - Remember that `POST kbn:/api/workflows/test` executes the graph rather than only validating YAML.
   - Test the complete draft only when it is read-only or its side effects are authorized.
   - Otherwise test a console-stubbed copy, then restore the action steps and save the workflow disabled.

## Critical Syntax Rules

### State The Workflow Version

The schema defaults the optional version to `1`; include it explicitly for readable, portable drafts:

```yaml
version: "1"
```

### Use `event`, Not `triggers.event`

The `triggers` block configures activation. Runtime data is available as `event`.

```yaml
# WRONG
message: "{{ triggers.event.rule.name }}"

# CORRECT
message: "{{ event.rule.name }}"
```

### Step Outputs Use `.output`

```yaml
# WRONG
message: "{{ steps.search.with.query }}"

# CORRECT
message: "{{ steps.search.output.hits.total.value }}"
```

### Use A Supported Condition Form

Conditions accept KQL-style strings. Dynamic expression form `${{ ... }}` is also used for comparisons and native
values. Do not interpolate a rendered `{{ ... }}` string and then append an operator.

```yaml
# WRONG
- name: check
  type: if
  condition: "{{ steps.search.output.hits | size }} > 0"

# BETTER
- name: set_count
  type: data.set
  with:
    count: "${{ steps.search.output.hits.hits | size }}"
- name: check
  type: if
  condition: "${{ variables.count > 0 }}"
```

### Connector Steps Need `connector-id`

```yaml
- name: notify
  type: slack2.sendMessage
  connector-id: my-slack-connector
  with:
    channel: C0123456789
    text: "Done"
```

This is an example from current Kibana eval fixtures, not a universal connector contract. Get the exact action type and
its `with` fields from `GET kbn:/api/workflows/schema?loose=false`, and get instance IDs from
`GET kbn:/api/workflows/connectors`. If the connector ID is unknown, ask or use a clearly marked placeholder.

### Step Config Does Not Always Belong In `with`

For `if` and `foreach`, child steps and control fields are step-level config:

```yaml
- name: for_each_alert
  type: foreach
  foreach: "${{ event.alerts }}"
  steps:
    - name: log_alert
      type: console
      with:
        message: "{{ foreach.item._id }}"
```

## Validation Strategy

Prefer this loop:

1. Generate YAML and write it to `workflow.yaml`.
2. Run a draft test against `POST kbn:/api/workflows/test` only when the graph is safe to execute; otherwise test a
   console-stubbed copy.
3. If validation fails, address every reported issue before retrying.
4. If runtime fails, inspect the execution at `GET kbn:/api/workflows/executions/{executionId}` and its logs at
   `GET kbn:/api/workflows/executions/{executionId}/logs`, then fix the step that failed in isolation.

## Repair Heuristics

| Error shape                           | Likely fix                                                       |
| ------------------------------------- | ---------------------------------------------------------------- |
| Unknown step type                     | Inspect the target's strict schema; do not guess a replacement   |
| Missing required property             | Move the field into `with` or add required step config           |
| Liquid variable resolves empty        | Check `steps.<name>.output` path or `event` availability         |
| Manual run has no alert data          | Add inputs or guard alert-only branches                          |
| Connector step fails before execution | Add or correct `connector-id`                                    |
| Query step returns no useful data     | Loosen filters, validate index/field names, or use sample output |

## Safe Defaults

- Use `manual` trigger for the first draft.
- Use `console` output in demos before adding side effects.
- Prefer read-only Elasticsearch queries before writes.
- Keep unexecuted side-effecting workflows disabled until the user approves enabling them.
- Ask before creating workflows that send notifications, write documents, or call external services.
