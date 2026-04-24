---
name: kibana-connectors
description: >
  Create and manage Kibana connectors for Slack, PagerDuty, Jira, webhooks, and more
  via REST API or Terraform. Use when configuring third-party integrations or managing
  connectors as code.
metadata:
  author: elastic
  version: 0.1.1
---

# Kibana Connectors

## Core Concepts

Connectors store connection information for Elastic services and third-party systems. Alerting rules use connectors to
route **actions** (notifications) when rule conditions are met. Connectors are managed per **Kibana Space** and can be
shared across all rules within that space.

### Connector Categories

| Category                    | Connector Types                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LLM Providers**           | OpenAI, Google Gemini, Amazon Bedrock, Elastic Managed LLMs, AI Connector, MCP (Preview, 9.3+)                                                                       |
| **Incident Management**     | PagerDuty, Opsgenie, ServiceNow (ITSM, SecOps, ITOM), Jira, Jira Service Management (9.2+), IBM Resilient, Swimlane, Torq, Tines, D3 Security, XSOAR (9.1+), TheHive |
| **Endpoint Security**       | CrowdStrike, SentinelOne, Microsoft Defender for Endpoint                                                                                                            |
| **Messaging**               | Slack (API / Webhook), Microsoft Teams, Email                                                                                                                        |
| **Logging & Observability** | Server log, Index, Observability AI Assistant                                                                                                                        |
| **Webhook**                 | Webhook, Webhook - Case Management, xMatters                                                                                                                         |
| **Elastic**                 | Cases                                                                                                                                                                |

## Authentication

All connector API calls require API key auth or Basic auth. Every mutating request must include the `kbn-xsrf` header.

```http
kbn-xsrf: true
```

## Required Privileges

Access to connectors is granted based on your privileges to alerting-enabled features. You need `all` privileges for
Actions and Connectors in Stack Management.

## API Reference

Base path: `<kibana_url>/api/actions` (or `/s/<space_id>/api/actions` for non-default spaces).

| Operation           | Method | Endpoint                               |
| ------------------- | ------ | -------------------------------------- |
| Create connector    | POST   | `/api/actions/connector/{id}`          |
| Update connector    | PUT    | `/api/actions/connector/{id}`          |
| Get connector       | GET    | `/api/actions/connector/{id}`          |
| Delete connector    | DELETE | `/api/actions/connector/{id}`          |
| Get all connectors  | GET    | `/api/actions/connectors`              |
| Get connector types | GET    | `/api/actions/connector_types`         |
| Run connector       | POST   | `/api/actions/connector/{id}/_execute` |

## Creating a Connector

### Required Fields

| Field               | Type   | Description                                                                      |
| ------------------- | ------ | -------------------------------------------------------------------------------- |
| `name`              | string | Display name for the connector                                                   |
| `connector_type_id` | string | The connector type (e.g., `.slack`, `.email`, `.webhook`, `.pagerduty`, `.jira`) |
| `config`            | object | Type-specific configuration (non-secret settings)                                |
| `secrets`           | object | Type-specific secrets (API keys, passwords, tokens)                              |

### Example: Create a Slack Connector (Webhook)

```bash
curl -X POST "https://my-kibana:5601/api/actions/connector/my-slack-connector" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -H "Authorization: ApiKey <your-api-key>" \
  -d '{
    "name": "Production Slack Alerts",
    "connector_type_id": ".slack",
    "config": {},
    "secrets": {
      "webhookUrl": "https://hooks.slack.com/services/T00/B00/XXXX"
    }
  }'
```

All connector types share the same request structure — only `connector_type_id`, `config`, and `secrets` differ. See the
[Common Connector Type IDs](#common-connector-type-ids) table for available types and their required fields.

### Example: Create a PagerDuty Connector

```bash
curl -X POST "https://my-kibana:5601/api/actions/connector/my-pagerduty" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -H "Authorization: ApiKey <your-api-key>" \
  -d '{
    "name": "PagerDuty Incidents",
    "connector_type_id": ".pagerduty",
    "config": {
      "apiUrl": "https://events.pagerduty.com/v2/enqueue"
    },
    "secrets": {
      "routingKey": "your-pagerduty-integration-key"
    }
  }'
```

## Updating a Connector

`PUT /api/actions/connector/{id}` replaces the full configuration. `connector_type_id` is immutable — delete and
recreate to change it.

## Listing and Discovering Connectors

```bash
# Get all connectors in the current space
curl -X GET "https://my-kibana:5601/api/actions/connectors" \
  -H "Authorization: ApiKey <your-api-key>"

# Get available connector types
curl -X GET "https://my-kibana:5601/api/actions/connector_types" \
  -H "Authorization: ApiKey <your-api-key>"

# Filter connector types by feature (e.g., only those supporting alerting)
curl -X GET "https://my-kibana:5601/api/actions/connector_types?feature_id=alerting" \
  -H "Authorization: ApiKey <your-api-key>"
```

The `GET /api/actions/connectors` response includes `referenced_by_count` showing how many rules use each connector.
Always check this before deleting.

## Running a Connector (Test)

Execute a connector action directly, useful for testing connectivity.

```bash
curl -X POST "https://my-kibana:5601/api/actions/connector/my-slack-connector/_execute" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -H "Authorization: ApiKey <your-api-key>" \
  -d '{
    "params": {
      "message": "Test alert from API"
    }
  }'
```

## Deleting a Connector

```bash
curl -X DELETE "https://my-kibana:5601/api/actions/connector/my-slack-connector" \
  -H "kbn-xsrf: true" \
  -H "Authorization: ApiKey <your-api-key>"
```

**Warning:** Deleting a connector that is referenced by rules will cause those rule actions to fail silently. Check
`referenced_by_count` first.

## Terraform Provider

Use the `elasticstack` provider resource `elasticstack_kibana_action_connector`.

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

resource "elasticstack_kibana_action_connector" "slack" {
  name              = "Production Slack Alerts"
  connector_type_id = ".slack"

  config = jsonencode({})

  secrets = jsonencode({
    webhookUrl = "https://hooks.slack.com/services/T00/B00/XXXX"
  })
}

resource "elasticstack_kibana_action_connector" "index" {
  name              = "Alert Index Writer"
  connector_type_id = ".index"

  config = jsonencode({
    index              = "alert-history"
    executionTimeField = "@timestamp"
  })

  secrets = jsonencode({})
}
```

**Key Terraform notes:**

- `config` and `secrets` must be JSON-encoded strings via `jsonencode()`
- Secrets are stored in Terraform state; use a remote backend with encryption and restrict state file access
- Import existing connectors:
  `terraform import elasticstack_kibana_action_connector.my_connector <space_id>/<connector_id>` (use `default` for the
  default space)
- After import, secrets are not populated in state; you must supply them in config

## Preconfigured Connectors (On-Prem)

For self-managed Kibana, connectors can be preconfigured in `kibana.yml` so they are available at startup without manual
creation:

```yaml
xpack.actions.preconfigured:
  my-slack-connector:
    name: "Production Slack"
    actionTypeId: .slack
    secrets:
      webhookUrl: "https://hooks.slack.com/services/T00/B00/XXXX"
  my-webhook:
    name: "Custom Webhook"
    actionTypeId: .webhook
    config:
      url: "https://api.example.com/alerts"
      method: post
      hasAuth: true
    secrets:
      user: "alert-user"
      password: "secret-password"
```

Preconfigured connectors cannot be edited or deleted via the API or UI. They show `is_preconfigured: true` and omit
`config` and `is_missing_secrets` from API responses.

## Networking Configuration

Customize connector networking (proxies, TLS, certificates) via `kibana.yml`:

```yaml
# Global proxy for all connectors
xpack.actions.proxyUrl: "https://proxy.example.com:8443"

# Per-host TLS settings
xpack.actions.customHostSettings:
  - url: "https://api.example.com"
    ssl:
      verificationMode: full
      certificateAuthoritiesFiles: ["/path/to/ca.pem"]
```

## Connectors in Kibana Workflows

Connectors serve as the integration layer across multiple Kibana workflows, not just alerting notifications:

| Workflow                  | Connector Types                       | Key Pattern                                                                    |
| ------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| **ITSM ticketing**        | ServiceNow, Jira, IBM Resilient       | Create ticket on active, close on `Recovered`                                  |
| **On-call escalation**    | PagerDuty, Opsgenie                   | `trigger` on active, `resolve` on `Recovered`; always set a deduplication key  |
| **Case management**       | Cases (system action)                 | UI-only; groups alerts into investigation Cases; can auto-push to ITSM         |
| **Messaging / awareness** | Slack, Teams, Email                   | `onActionGroupChange` for incident channels; summaries for monitoring channels |
| **Audit logging**         | Index                                 | `onActiveAlert` to write full alert time-series to Elasticsearch               |
| **AI workflows**          | OpenAI, Bedrock, Gemini, AI Connector | Powers Elastic AI Assistant and Attack Discovery; system-managed               |
| **Custom integrations**   | Webhook                               | Generic HTTP outbound with Mustache-templated JSON body                        |

For detailed patterns, examples, and decision guidance for each workflow, see [workflows.md](references/workflows.md).

## Best Practices

1. **Use preconfigured connectors for production on-prem.** They eliminate secret sprawl, survive Saved Object imports,
   and cannot be accidentally deleted. Reserve API-created connectors for dynamic or user-managed scenarios.

2. **Test connectors before attaching to rules.** Use the `_execute` endpoint to verify connectivity. A misconfigured
   connector causes silent action failures that only appear in the rule's execution history.

3. **Check `referenced_by_count` before deleting.** Deleting a connector used by active rules causes those actions to
   fail. List connectors and verify zero references, or reassign rules to a new connector first.

4. **Use the Email domain allowlist.** The `xpack.actions.email.domain_allowlist` setting restricts which email domains
   connectors can send to. If you update this list, existing email connectors with recipients outside the new list will
   start failing.

5. **Secure secrets in Terraform.** Connector secrets (API keys, passwords, webhook URLs) are stored in Terraform state.
   Use encrypted remote backends (S3+KMS, Azure Blob+encryption, GCS+CMEK) and restrict access to state files. Use
   `sensitive = true` on variables.

6. **One connector per service, not per rule.** Create a single Slack connector and reference it from multiple rules.
   This centralizes secret rotation and reduces duplication.

7. **Use Spaces for multi-tenant isolation.** Connectors are scoped to a Kibana Space. Create separate spaces for
   different teams or environments and configure connectors per space.

8. **Monitor connector health.** Failed connector executions are logged in the event log index (`.kibana-event-log-*`).
   Connector failures report as successful to Task Manager but fail silently for alert delivery. Check the
   [Event Log Index](https://www.elastic.co/docs/explore-analyze/alerting/alerts/event-log-index) for true failure
   rates.

9. **Always configure a recovery action alongside the active action.** Connectors for ITSM and on-call tools
   (ServiceNow, Jira, PagerDuty, Opsgenie) support a close/resolve operation. Without a recovery action, incidents
   remain open forever.

10. **Use deduplication keys for on-call connectors.** Set `dedupKey` (PagerDuty) or `alias` (Opsgenie) to
    `{{rule.id}}-{{alert.id}}` to ensure the resolve event closes exactly the right incident. Without this, a new
    incident is created every time the alert re-fires.

11. **Prefer the Cases connector for investigation workflows.** When an alert requires investigation with comments,
    attachments, and assignees, use Cases rather than a direct Jira/ServiceNow connector. Cases gives you a native
    investigation UI and can still push to ITSM via the Case's external connection.

12. **Use the Index connector for durable audit trails.** The Index connector writes to Elasticsearch, making alert
    history searchable and dashboardable. Pair it with an ILM policy on the target index to control retention.

13. **Restrict connector access via Action settings.** Use `xpack.actions.enabledActionTypes` to allowlist only the
    connector types your organization needs, and `xpack.actions.allowedHosts` to restrict outbound connections to known
    endpoints.

## Common Pitfalls

1. **Missing `kbn-xsrf` header.** All POST, PUT, DELETE requests require `kbn-xsrf: true`. Omitting it returns a 400
   error.

2. **Wrong `connector_type_id`.** Use the exact string including the leading dot (e.g., `.slack`, not `slack`). Discover
   valid types via `GET /api/actions/connector_types`.

3. **Empty `secrets` object required.** Even for connectors without secrets (e.g., `.index`, `.server-log`), you must
   provide `"secrets": {}` in the create request.

4. **Connector type is immutable.** You cannot change the `connector_type_id` after creation. Delete and recreate
   instead.

5. **Secrets lost on export/import.** Exporting connectors via Saved Objects strips secrets. After import, connectors
   show `is_missing_secrets: true` and a "Fix" button appears in the UI. You must re-enter secrets manually or via API.

6. **Preconfigured connectors cannot be modified via API.** Attempting to update or delete a preconfigured connector
   returns 400. Manage them exclusively in `kibana.yml`.

7. **Rate limits from third-party services.** Connectors that send high volumes of notifications (e.g., one per alert
   every minute) can hit Slack, PagerDuty, or email provider rate limits. Use alert summaries and action frequency
   controls on the rule side to reduce volume.

8. **Connector networking failures.** Kibana must be able to reach the connector's target URL. Verify firewall rules,
   proxy settings, and DNS resolution. Use `xpack.actions.customHostSettings` for TLS issues.

9. **License requirements.** Some connector types require a Gold, Platinum, or Enterprise license. Check the
   `minimum_license_required` field from `GET /api/actions/connector_types`. A connector that is
   `enabled_in_config: true` but `enabled_in_license: false` cannot be used.

10. **Terraform import does not restore secrets.** When importing an existing connector into Terraform, the secrets are
    not read back from Kibana. You must provide them in your Terraform configuration, or the next `terraform apply` will
    overwrite them with empty values.

## Common Connector Type IDs

| Type ID                        | Name                            | License    |
| ------------------------------ | ------------------------------- | ---------- |
| `.email`                       | Email                           | Gold       |
| `.slack`                       | Slack (Webhook)                 | Gold       |
| `.slack_api`                   | Slack (API)                     | Gold       |
| `.pagerduty`                   | PagerDuty                       | Gold       |
| `.jira`                        | Jira                            | Gold       |
| `.servicenow`                  | ServiceNow ITSM                 | Platinum   |
| `.servicenow-sir`              | ServiceNow SecOps               | Platinum   |
| `.servicenow-itom`             | ServiceNow ITOM                 | Platinum   |
| `.webhook`                     | Webhook                         | Gold       |
| `.index`                       | Index                           | Basic      |
| `.server-log`                  | Server log                      | Basic      |
| `.opsgenie`                    | Opsgenie                        | Gold       |
| `.teams`                       | Microsoft Teams                 | Gold       |
| `.gen-ai`                      | OpenAI                          | Enterprise |
| `.bedrock`                     | Amazon Bedrock                  | Enterprise |
| `.gemini`                      | Google Gemini                   | Enterprise |
| `.cases`                       | Cases                           | Platinum   |
| `.crowdstrike`                 | CrowdStrike                     | Enterprise |
| `.sentinelone`                 | SentinelOne                     | Enterprise |
| `.microsoft_defender_endpoint` | Microsoft Defender for Endpoint | Enterprise |
| `.thehive`                     | TheHive                         | Gold       |

> **Note:** Use `GET /api/actions/connector_types` to discover all available types on your deployment along with their
> exact `minimum_license_required` values. Connector types for XSOAR, Jira Service Management, and MCP are available but
> may not appear in older API spec versions.

## Examples

**Create a Slack connector:** "Set up Slack notifications for our alerts." `POST /api/actions/connector` with
`connector_type_id: ".slack"` and `secrets.webhookUrl`. Use the returned connector `id` in rule actions.

**Test a connector before attaching to rules:** "Verify the PagerDuty connector works."
`POST /api/actions/connector/{id}/_execute` with a minimal params object to confirm connectivity before adding to any
rule.

**Audit connector usage before deletion:** "Remove the old email connector." `GET /api/actions/connectors`, inspect
`referenced_by_count` — if non-zero, reassign the referencing rules first, then `DELETE /api/actions/connector/{id}`.

## Guidelines

- Include `kbn-xsrf: true` on every POST, PUT, and DELETE; omitting it returns 400.
- `connector_type_id` is immutable — delete and recreate to change connector type.
- Always pass `"secrets": {}` even for connectors with no secrets (e.g., `.index`, `.server-log`).
- Check `referenced_by_count` before deleting; a deleted connector silently breaks all referencing rule actions.
- Connectors are space-scoped; prefix paths with `/s/<space_id>/api/actions/` for non-default Kibana Spaces.
- Secrets are write-only: not returned by GET and stripped on Saved Object export/import; always re-supply after import.
- Test every new connector with `_execute` before attaching to rules; connector failures in production are silent.

## Additional Resources

- [Kibana Connectors API Reference](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-connectors)
- [Connectors Overview](https://www.elastic.co/docs/reference/kibana/connectors-kibana)
- [Preconfigured Connectors](https://www.elastic.co/docs/reference/kibana/connectors-kibana/pre-configured-connectors)
- [Alerting Settings (Action Config)](https://www.elastic.co/docs/reference/kibana/configuration-reference/alerting-settings#action-settings)
- [Terraform: elasticstack_kibana_action_connector](https://registry.terraform.io/providers/elastic/elasticstack/latest/docs/resources/kibana_action_connector)
- [Terraform: Managing Kibana Rule and Connector Resources](https://registry.terraform.io/providers/elastic/elasticstack/latest/docs/guides/elasticstack-kibana-rule)
