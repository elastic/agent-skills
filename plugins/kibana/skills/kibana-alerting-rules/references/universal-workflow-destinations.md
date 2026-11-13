# Workflow Destinations

Action policies deliver notifications by scheduling Kibana Workflows. Each destination is
`{ "type": "workflow", "id": "<workflow_id>" }`, and the workflow's steps reach external systems through connectors.

## Contents

- [Destination requirements](#destination-requirements)
- [Access and ownership](#access-and-ownership)
- [Use an existing workflow](#use-an-existing-workflow)
- [Create a new workflow](#create-a-new-workflow)
- [Dispatch payload](#dispatch-payload-inputspayload)
- [Destination workflow template](#destination-workflow-template)
- [Dry run before saving](#dry-run-before-saving)

## Destination requirements

The action policy API accepts any workflow id without checking it, so a broken destination surfaces only at dispatch
time, as a lost notification. Every destination, new or existing, must meet these requirements:

| Requirement                                                                                                                                                                         | What breaks without it                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exists in the policy's space, with `enabled` and `valid` `true`                                                                                                                     | The dispatcher skips a missing or disabled workflow. Kibana saves a workflow that fails validation as disabled.                                                                                                                                                                                    |
| `definition.triggers` has exactly one `manual` trigger whose `inputs` declare `payload` with `$ref: '#/kibana/definitions/alertingV2NotificationGroup'` and require no other inputs | Policies schedule the workflow with `{ payload }` as its inputs; a declaration that rejects it fails the run. The `$ref` also lets the Workflows editor flag `inputs.payload.*` references that do not exist; saving does not run that check, so a `valid` workflow can still render empty fields. |
| `permissions.execute` is `true` for the user who will own the policy                                                                                                                | The owner cannot schedule the workflow (see [Access and ownership](#access-and-ownership)).                                                                                                                                                                                                        |
| Every `connector-id` in its steps resolves for that user with `GET kbn:/api/actions/connector/{id}`                                                                                 | Connector steps run as the owner and fail with `Unauthorized to execute`.                                                                                                                                                                                                                          |
| No top-level `workflow.execute` or `workflow.executeAsync` step without an `if` uses `run-as-mode: inherit` while `definition.settings.run_as` is unset                             | The workflow can run only under a parent workflow, so scheduling it from a policy is refused.                                                                                                                                                                                                      |

Make steps idempotent: delivery is at-least-once, so the same group can be dispatched more than once.

## Access and ownership

Create, upsert (`PUT`), update (`PATCH`, even a description-only change), and key rotation (`_update_api_key`,
`_bulk_update_api_key`) all make the caller the policy's API key owner. At dispatch time, workflows are fetched and
scheduled as that owner, and the workflow's own access control decides what the owner can do. The `permissions` object
in `GET kbn:/api/workflows/workflow/{id}` reports this for the caller, so check it as the user who will own the policy:

- A public workflow (the default) can be read and run by the owner.
- A private workflow can be read only when the owner is its creator or holds a viewer, executor, or editor entry, and
  run only as creator, executor, or editor. A workflow the owner cannot read is skipped as not found; one the owner can
  read but not run fails to schedule.

Workflow steps also run as the owner. Connector steps need **Read** on the **Actions and Connectors** feature in the
policy's space.

## Use an existing workflow

For a workflow the user names, or one already on the policy (for key rotation, read the policy first with
`GET kbn:/api/alerting/v2/action_policies/{id}` to get its destinations), make these calls for each destination before
any policy write:

1. **Read the workflow** with `GET kbn:/api/workflows/workflow/{id}` and check the response: `enabled` and `valid` are
   `true`; `definition.triggers` has exactly one `manual` trigger whose `payload` input references
   `#/kibana/definitions/alertingV2NotificationGroup`; `permissions.execute` is `true`; and no top-level
   `workflow.execute` or `workflow.executeAsync` step without an `if` uses `run-as-mode: inherit` while
   `definition.settings.run_as` is unset.
2. **Check each connector** the workflow uses: for every `connector-id` in its steps, call
   `GET kbn:/api/actions/connector/{id}` as the user who will own the policy. A connector that does not resolve for that
   user makes the step fail at dispatch time.
3. **Stop if any check fails.** Ask the user for the correct workflow or the missing privilege or share, or create a new
   workflow. Never write a policy that points at a workflow that does not meet the requirements.

These checks do not cover Liquid references; when the user wants proof that the template renders, dry-run the workflow's
YAML with each notifying step replaced by a `type: console` step (see [Dry run before saving](#dry-run-before-saving)).

Changing what an existing workflow sends is workflow authoring; leave it to the `kibana-workflows` skill and re-check
the requirements before the next policy write.

## Create a new workflow

Create a dedicated workflow when the user names none. The message depends on the policy's rules and their query columns.

1. **Find a connector** of the requested type with `GET kbn:/api/workflows/connectors`. If none fits, stop and tell the
   user a connector must be configured first.
2. **Draft the workflow** with its notification as a `type: console` step, using the `kibana-workflows` skill or, if
   that skill is not available, the [template](#destination-workflow-template). Keep one `manual` trigger whose
   `payload` input references `#/kibana/definitions/alertingV2NotificationGroup`, and read only `inputs.payload.*`
   fields and `data.*` columns that the matched rules' queries return (read them with
   `GET kbn:/api/alerting/v2/rules/{id}`, or for a routing tag, `GET kbn:/api/alerting/v2/rules` with
   `filter=metadata.routing_tags:"<tag>"`). The console step prints every templated field the connector step will send,
   such as an email's subject and body. Name the workflow `Notify: <policy name>`.
3. **Dry-run the console draft** with `POST kbn:/api/workflows/test` (see
   [Dry run before saving](#dry-run-before-saving)). Fix validation errors, input errors, and empty rendered fields, and
   re-run until the output is right. If the caller lacks the Workflows **Execute** privilege (403), skip the dry run and
   say so.
4. **Swap in the connector step.** Replace the `console` step with the connector's step: its `type`, `connector-id`, and
   `with` fields from `GET kbn:/api/workflows/schema`. Move the tested Liquid text into the matching `with` fields
   unchanged; if a template has to change, dry-run the console version again first. Do not dry-run the result, because
   it would send a real notification.
5. **Save it enabled** with `POST kbn:/api/workflows/workflow` and confirm `valid: true` and `enabled: true` in the
   response. Save it enabled even though the `kibana-workflows` skill saves new side-effecting workflows disabled: a
   disabled destination drops every notification. An invalid workflow is still saved, disabled; correct it with
   `PUT kbn:/api/workflows/workflow/{id}`, whose response lists `validationErrors`. The caller created the workflow and
   took its connector from their own connector list, so the ownership and connector requirements already hold.

## Dispatch payload (`inputs.payload`)

| Field      | Type     | Description                                                                 |
| ---------- | -------- | --------------------------------------------------------------------------- |
| `id`       | string   | Notification group identifier                                               |
| `policyId` | string   | Id of the action policy that dispatched the group                           |
| `groupKey` | object   | Grouping key (shape depends on the grouping mode)                           |
| `alerts`   | object[] | Alerts in the group                                                         |
| `rules`    | object   | Rule metadata keyed by rule id; read names with `rules[alert.rule_id].name` |

Each entry in `alerts`:

| Field                  | Type         | Description                                           |
| ---------------------- | ------------ | ----------------------------------------------------- |
| `alert_id`             | string       | Alert identifier                                      |
| `alert_status`         | string       | `inactive`, `pending`, `active`, or `recovering`      |
| `alert_url`            | string       | Absolute URL of the alert details page                |
| `group_hash`           | string       | Hash of the rule's grouping values                    |
| `last_event_timestamp` | string       | Timestamp of the most recent event                    |
| `rule_id`              | string, null | Rule that produced the alert                          |
| `source`               | string       | Origin of the alert events                            |
| `space_id`             | string       | Space of the alert                                    |
| `severity`             | string       | Optional: `info`, `low`, `medium`, `high`, `critical` |
| `data`                 | object       | Optional: the rule's ES\|QL output row                |

Liquid usage:

- Top-level fields: `{{ inputs.payload.policyId }}`.
- Iterate alerts: `{% for alert in inputs.payload.alerts %}…{% endfor %}`.
- Rule name: `{{ inputs.payload.rules[alert.rule_id].name }}`.
- Query columns use nested paths (`alert.data.host.name`). `data` can be empty for recovering or inactive alerts, so
  guard with `| default: "n/a"` or `{% if alert.data %}`.
- Include `{{ alert.alert_url }}` in every notification so recipients can open the alert.

When one workflow serves policies that match several rules, keep the template generic (rule name, status, URL, guarded
`data` fields). Use separate workflows when rules need different message shapes.

## Destination workflow template

Email workflow for a rule whose query ends with `STATS error_count = COUNT(*) BY host.name`. Only the `triggers` block
carries over unchanged to every destination. For other channels (for example Slack or PagerDuty), replace the whole
step: the step type, `connector-id`, and `with` fields all differ per connector, and `GET kbn:/api/workflows/schema`
lists them for the connectors in the space. Replace the `alert.data.*` fields with the columns the matched rules return.

```yaml
version: "1"
name: "Notify: payments errors"
enabled: true
triggers:
  - type: manual
    inputs:
      properties:
        payload:
          $ref: "#/kibana/definitions/alertingV2NotificationGroup"
steps:
  - name: send_email
    type: email
    connector-id: <email-connector-id>
    with:
      to:
        - oncall@example.com
      subject: "Alert: {{ inputs.payload.alerts | size }} alert(s)"
      message: |
        {% for alert in inputs.payload.alerts %}
        - Rule: {{ inputs.payload.rules[alert.rule_id].name | default: "unknown" }}
          Host: {{ alert.data.host.name | default: "unknown" }}
          Errors: {{ alert.data.error_count | default: "n/a" }}
          Status: {{ alert.alert_status }}
          View alert: {{ alert.alert_url }}
        {% endfor %}
```

Save it with `POST kbn:/api/workflows/workflow` and the body `{ "yaml": "<workflow YAML>" }`. The response includes
`valid` and `enabled`; a `PUT kbn:/api/workflows/workflow/{id}` with `{ "yaml": "<workflow YAML>" }` also returns
`validationErrors` for an invalid definition.

## Dry run before saving

`POST kbn:/api/workflows/test` runs every step, even in test mode. Draft the notifying step as `console` first, printing
every templated field the connector step will send, and dry-run that draft. Send the draft as `workflowYaml`, without
`workflowId` (nothing is saved). Replace it with the connector step from the template above only after the output is
right, moving the tested text into its `with` fields unchanged:

```yaml
steps:
  - name: send_email
    type: console
    with:
      message: |
        Alert: {{ inputs.payload.alerts | size }} alert(s)
        {% for alert in inputs.payload.alerts %}
        - Rule: {{ inputs.payload.rules[alert.rule_id].name | default: "unknown" }}
          Host: {{ alert.data.host.name | default: "unknown" }}
        {% endfor %}
```

Send it with a sample notification group shaped like a real dispatch:

```json
{
  "workflowYaml": "<YAML with console steps>",
  "inputs": {
    "payload": {
      "id": "sample-group",
      "policyId": "sample-policy",
      "groupKey": {},
      "alerts": [
        {
          "alert_id": "sample-alert",
          "alert_status": "active",
          "alert_url": "https://kibana.example.com/app/alerts/sample-alert",
          "group_hash": "sample-hash",
          "last_event_timestamp": "2026-01-01T00:00:00.000Z",
          "rule_id": "sample-rule",
          "source": "internal",
          "space_id": "default",
          "severity": "critical",
          "data": { "host": { "name": "web-01" }, "error_count": 12 }
        }
      ],
      "rules": { "sample-rule": { "name": "Payments errors" } }
    }
  }
}
```

Read the outcome with `GET kbn:/api/workflows/executions/{executionId}` and
`GET kbn:/api/workflows/executions/{executionId}/logs`
([API reference](https://www.elastic.co/docs/api/doc/kibana/operation/operation-post-workflows-test)). What it means for
a policy destination:

- An input validation error means the trigger inputs reject `{ payload }`.
- `unknown` or `n/a` in the console output means a Liquid path does not exist in the payload or in the rule's columns.

The dry run needs the Workflows **Execute** privilege. It runs as the caller, so it does not prove the policy owner's
connector access.
