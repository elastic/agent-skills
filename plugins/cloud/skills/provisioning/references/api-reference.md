# Elastic Cloud Serverless API Reference

Reference for the Elastic Cloud Serverless project management API. Base URL: `https://api.elastic-cloud.com`.

All requests require an API key in the `Authorization` header:

```text
Authorization: ApiKey <your-api-key>
```

## Endpoints

### Projects

| Method   | Path                                                         | Description              |
| -------- | ------------------------------------------------------------ | ------------------------ |
| `POST`   | `/api/v1/serverless/projects/{type}`                         | Create a project         |
| `GET`    | `/api/v1/serverless/projects/{type}`                         | List projects            |
| `GET`    | `/api/v1/serverless/projects/{type}/{id}`                    | Get project details      |
| `PATCH`  | `/api/v1/serverless/projects/{type}/{id}`                    | Update a project         |
| `DELETE` | `/api/v1/serverless/projects/{type}/{id}`                    | Delete a project         |
| `GET`    | `/api/v1/serverless/projects/{type}/{id}/status`             | Get project status       |
| `POST`   | `/api/v1/serverless/projects/{type}/{id}/_reset-credentials` | Reset credentials        |
| `POST`   | `/api/v1/serverless/projects/{type}/{id}/_resume`            | Resume suspended project |
| `GET`    | `/api/v1/serverless/projects/{type}/{id}/roles`              | Get project roles        |

Where `{type}` is one of: `elasticsearch`, `observability`, `security`.

### Regions

| Method | Path                              | Description        |
| ------ | --------------------------------- | ------------------ |
| `GET`  | `/api/v1/serverless/regions`      | List all regions   |
| `GET`  | `/api/v1/serverless/regions/{id}` | Get region details |

### Traffic Filters

| Method   | Path                                      | Description             |
| -------- | ----------------------------------------- | ----------------------- |
| `POST`   | `/api/v1/serverless/traffic-filters`      | Create a traffic filter |
| `GET`    | `/api/v1/serverless/traffic-filters`      | List traffic filters    |
| `GET`    | `/api/v1/serverless/traffic-filters/{id}` | Get a traffic filter    |
| `PATCH`  | `/api/v1/serverless/traffic-filters/{id}` | Update a traffic filter |
| `DELETE` | `/api/v1/serverless/traffic-filters/{id}` | Delete a traffic filter |

## Create project request bodies

### Elasticsearch

```json
{
  "name": "my-es-project",
  "region_id": "gcp-us-central1",
  "optimized_for": "general_purpose",
  "search_lake": {
    "search_power": 100,
    "boost_window": 30
  }
}
```

| Field           | Type   | Required | Description                                          |
| --------------- | ------ | -------- | ---------------------------------------------------- |
| `name`          | string | Yes      | Project name (1–255 chars)                           |
| `region_id`     | string | Yes      | Region ID (for example, `gcp-us-central1`)           |
| `alias`         | string | No       | Custom domain label (RFC-1035, max 50 chars)         |
| `optimized_for` | string | No       | `general_purpose` (default) or `vector`              |
| `search_lake`   | object | No       | Search power (28–3000) and boost window (1–180 days) |

`optimized_for` options:

- `general_purpose` — suitable for full-text search, sparse vectors, compressed dense vectors. Default when creating
  from the UI.
- `vector` — for uncompressed dense vectors with high dimensionality. Impacts VCU consumption.

### Observability

```json
{
  "name": "my-obs-project",
  "region_id": "gcp-us-central1",
  "product_tier": "complete"
}
```

| Field          | Type   | Required | Description                               |
| -------------- | ------ | -------- | ----------------------------------------- |
| `name`         | string | Yes      | Project name                              |
| `region_id`    | string | Yes      | Region ID                                 |
| `alias`        | string | No       | Custom domain label                       |
| `product_tier` | string | No       | `complete` (default) or `logs_essentials` |

### Security

```json
{
  "name": "my-sec-project",
  "region_id": "gcp-us-central1",
  "product_types": [
    { "product_line": "security", "product_tier": "complete" },
    { "product_line": "cloud", "product_tier": "complete" },
    { "product_line": "endpoint", "product_tier": "complete" }
  ]
}
```

| Field                    | Type   | Required | Description                                         |
| ------------------------ | ------ | -------- | --------------------------------------------------- |
| `name`                   | string | Yes      | Project name                                        |
| `region_id`              | string | Yes      | Region ID                                           |
| `alias`                  | string | No       | Custom domain label                                 |
| `admin_features_package` | string | No       | `standard` or `enterprise` (BYOK, BYOIDP, CCS, CCR) |
| `product_types`          | array  | No       | Array of product line/tier pairs                    |
| `search_lake`            | object | No       | Data retention config                               |

Product lines: `security`, `cloud`, `endpoint`. Product tiers: `complete`, `essentials`.

## Creation response

All project types return the same response structure:

```json
{
  "id": "abc123def456abc123def456abc12345",
  "name": "my-project",
  "alias": "my-project-bdc0f7",
  "region_id": "gcp-us-central1",
  "cloud_id": "bXktcHJvamVjdDo...",
  "type": "elasticsearch",
  "metadata": {
    "created_at": "2025-01-15T10:30:00Z",
    "created_by": "1014289666002276",
    "organization_id": "198583657190"
  },
  "endpoints": {
    "elasticsearch": "https://my-project-bdc0f7.es.us-east-1.aws.elastic.cloud",
    "kibana": "https://my-project-bdc0f7.kb.us-east-1.aws.elastic.cloud"
  },
  "credentials": {
    "username": "admin",
    "password": "REDACTED"
  }
}
```

Observability projects also include `apm` and `ingest` endpoints. Security projects include an `ingest` endpoint.

The `credentials` block is only returned on creation and reset. Save the password immediately.

## Project status

```json
{
  "phase": "initializing"
}
```

Phases:

| Phase          | Description                               |
| -------------- | ----------------------------------------- |
| `initializing` | Project is being created, not ready yet   |
| `initialized`  | Project is ready for use                  |
| `suspending`   | Project is being suspended                |
| `suspended`    | Project is suspended (trial expired)      |
| `deleting`     | Project is being deleted                  |
| `deleted`      | Project has been deleted (terminal state) |

## Regions

Common regions for serverless projects:

### AWS

| Region ID          | Location        |
| ------------------ | --------------- |
| `aws-us-east-1`    | N. Virginia, US |
| `aws-us-east-2`    | Ohio, US        |
| `aws-us-west-2`    | Oregon, US      |
| `aws-eu-west-1`    | Ireland         |
| `aws-eu-central-1` | Frankfurt       |

### GCP

| Region ID          | Location |
| ------------------ | -------- |
| `gcp-us-central1`  | Iowa, US |
| `gcp-europe-west1` | Belgium  |

### Azure

| Region ID      | Location     |
| -------------- | ------------ |
| `azure-eastus` | Virginia, US |

Use `GET /api/v1/serverless/regions` for the complete, up-to-date list. Only regions with
`project_creation_enabled: true` accept new projects.

## Error responses

All errors follow this format:

```json
{
  "errors": [
    {
      "message": "Explanatory error message",
      "code": "code.error"
    }
  ]
}
```

| HTTP Code | Meaning              |
| --------- | -------------------- |
| 400       | Bad request          |
| 401       | Invalid API key      |
| 404       | Project not found    |
| 409       | Conflict             |
| 412       | Precondition failed  |
| 422       | Unprocessable entity |

## Traffic filters

Traffic filters restrict network access to projects. Attach them during creation or using PATCH:

```json
{
  "traffic_filters": [{ "id": "traffic-filter-id" }]
}
```

Filter types: `ip` (IP/CIDR rules) or `vpce` (VPC endpoint IDs).
