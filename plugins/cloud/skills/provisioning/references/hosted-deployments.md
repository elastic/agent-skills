# Elastic Cloud Hosted Deployments — API Reference

Reference for provisioning and operating Elastic Cloud Hosted deployments through the Cloud API. Base URL:
`https://api.elastic-cloud.com`. All requests require an Elastic Cloud API key in the `Authorization: ApiKey <key>`
header, supplied by the `elastic` CLI Cloud context.

Hosted deployments are full stack deployments (Elasticsearch, Kibana, and optionally APM/Integrations Server and
Enterprise Search) sized from a **deployment template**, distinct from Serverless projects.

## Endpoints

| Method | Path                                 | Description                      |
| ------ | ------------------------------------ | -------------------------------- |
| `GET`  | `/api/v1/deployments`                | List deployments                 |
| `POST` | `/api/v1/deployments`                | Create a deployment              |
| `GET`  | `/api/v1/deployments/{id}`           | Get a deployment                 |
| `PUT`  | `/api/v1/deployments/{id}`           | Update (resize/upgrade/reconfig) |
| `POST` | `/api/v1/deployments/{id}/_shutdown` | Shut down a deployment           |
| `POST` | `/api/v1/deployments/{id}/_restore`  | Restore a shut-down deployment   |
| `GET`  | `/api/v1/deployments/templates`      | List deployment templates        |
| `GET`  | `/api/v1/deployments/templates/{id}` | Get a deployment template        |

## Deployment templates

A template pre-fills the `resources` block for a region and use case (for example, general purpose, vector search,
CPU-optimized). List templates for the target region first, then either reference the template by `id` on creation or
copy its `deployment_template` resource block and adjust sizing.

```text
GET /api/v1/deployments/templates?region=us-east-1
```

Each template exposes an `id`, `name`, `description`, and a `deployment_template` resource definition. Region is a
required query parameter for the templates listing.

## Create a deployment

```text
POST /api/v1/deployments
```

Minimal request using a template, with per-resource sizing overrides:

```json
{
  "name": "my-hosted-deployment",
  "region": "us-east-1",
  "version": "8.15.0",
  "resources": {
    "elasticsearch": [
      {
        "region": "us-east-1",
        "ref_id": "main-elasticsearch",
        "plan": {
          "cluster_topology": [
            {
              "zone_count": 2,
              "size": { "value": 4096, "resource": "memory" },
              "instance_configuration_id": "aws.es.datahot"
            }
          ],
          "elasticsearch": { "version": "8.15.0" }
        }
      }
    ],
    "kibana": [
      {
        "region": "us-east-1",
        "ref_id": "main-kibana",
        "elasticsearch_cluster_ref_id": "main-elasticsearch",
        "plan": {
          "cluster_topology": [{ "zone_count": 1, "size": { "value": 1024, "resource": "memory" } }],
          "kibana": { "version": "8.15.0" }
        }
      }
    ]
  }
}
```

Alternatively pass a `template_id`; any resources supplied in the request override the template's defaults (no merging
is performed for a given resource kind that is present in the request).

| Field       | Type   | Required | Description                                                        |
| ----------- | ------ | -------- | ------------------------------------------------------------------ |
| `name`      | string | Yes      | Human-readable deployment name                                     |
| `region`    | string | Yes      | Region ID (for example, `us-east-1`, `gcp-us-central1`); permanent |
| `version`   | string | No       | Elastic Stack version (defaults to latest for the region)          |
| `resources` | object | Yes\*    | Resource definitions; \*not required when `template_id` is used    |

### Creation response

The response includes the deployment `id`, the created resources, and — **once** — the `elastic` user credentials:

```json
{
  "id": "abc123def456...",
  "name": "my-hosted-deployment",
  "resources": [
    {
      "kind": "elasticsearch",
      "ref_id": "main-elasticsearch",
      "credentials": { "username": "elastic", "password": "REDACTED" }
    }
  ]
}
```

Persist the credentials into a CLI context (OS keychain) — never echo the password in chat. The `elastic` bootstrap user
is for mining a scoped Elasticsearch API key (`POST /_security/api_key`); use that key for ongoing data-plane work.

## Update, shut down, restore

- **Update** (`PUT /api/v1/deployments/{id}`) resizes topology, upgrades the stack version, or reconfigures resources.
  Send the full intended plan for the resources being changed.
- **Shut down** (`POST /api/v1/deployments/{id}/_shutdown`) stops all resources; data is retained per snapshot policy.
  Optional `skip_snapshot` and (admin-only) `hide` query parameters apply.
- **Restore** (`POST /api/v1/deployments/{id}/_restore`) brings a shut-down deployment back; `restore_snapshot` controls
  whether a snapshot is restored for eligible resources.

## Traffic-filter rulesets (hosted)

Hosted deployments use **traffic-filter rulesets**, managed separately from Serverless traffic filters:

| Method   | Path                                               | Description                           |
| -------- | -------------------------------------------------- | ------------------------------------- |
| `GET`    | `/api/v1/deployments/traffic-filter/rulesets`      | List rulesets                         |
| `POST`   | `/api/v1/deployments/traffic-filter/rulesets`      | Create a ruleset                      |
| `GET`    | `/api/v1/deployments/traffic-filter/rulesets/{id}` | Get a ruleset                         |
| `PUT`    | `/api/v1/deployments/traffic-filter/rulesets/{id}` | Update a ruleset                      |
| `DELETE` | `/api/v1/deployments/traffic-filter/rulesets/{id}` | Delete a ruleset                      |
| `POST`   | `/api/v1/deployments/traffic-filter/associations`  | Associate a ruleset with a deployment |

Do not mix these with the Serverless `/api/v1/serverless/traffic-filters` endpoints — they are different APIs for
different products.
