# Lens Visualizations API Reference

The Lens Visualizations API provides CRUD endpoints for managing Lens visualizations.

## Endpoints

### List Visualizations

```http
GET /api/visualizations?apiVersion=1&query=&page=&per_page=
Header: Elastic-Api-Version: 1
```

**Query Parameters:**

| Parameter      | Type   | Description                      |
| -------------- | ------ | -------------------------------- |
| `apiVersion`   | string | Required. Set to `1`             |
| `query`        | string | Search query                     |
| `searchFields` | string | Fields to search (e.g., `title`) |
| `page`         | number | Page number (default: 1)         |
| `per_page`     | number | Results per page (default: 100)  |

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "data": {
        /* visualization definition */
      },
      "meta": {
        /* metadata */
      }
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 100,
    "total": 42
  }
}
```

### Get Visualization

```http
GET /api/visualizations/:id?apiVersion=1
Header: Elastic-Api-Version: 1
```

**Response:**

```json
{
  "id": "3e11cd61-6da4-4f8e-ac2e-dc8731da1076",
  "data": {
    "type": "metric",
    "dataset": {
      "type": "esql",
      "query": "FROM kibana_sample_data_logs | STATS avg_of_bytes=AVG(bytes)"
    },
    "metrics": [
      {
        "type": "primary",
        "operation": "value",
        "column": "avg_of_bytes",
        "alignments": {
          "value": "right",
          "labels": "left"
        },
        "fit": false
      }
    ],
    "sampling": 1,
    "ignore_global_filters": false
  },
  "meta": {
    "created_at": "2025-09-30T18:49:20.957Z",
    "updated_at": "2025-09-30T18:49:20.957Z",
    "created_by": "user_id",
    "updated_by": "user_id",
    "managed": false
  }
}
```

### Create Visualization

```http
POST /api/visualizations?apiVersion=1
Header: Elastic-Api-Version: 1
```

**Request Body:** Visualization definition (minimal, without ID)

```json
{
  "type": "metric",
  "dataset": {
    "type": "esql",
    "query": "FROM kibana_sample_data_logs | STATS avg_of_bytes=AVG(bytes)"
  },
  "metrics": [{ "type": "primary", "operation": "value", "column": "avg_of_bytes" }]
}
```

**Response:** Full visualization with injected defaults and generated ID.

### Update Visualization

```http
PUT /api/visualizations/:id?apiVersion=1
Header: Elastic-Api-Version: 1
```

**Request Body:** Complete visualization definition

**Response:** Updated visualization with metadata.

### Delete Visualization

```http
DELETE /api/visualizations/:id?apiVersion=1
Header: Elastic-Api-Version: 1
```

**Response:** Empty on success, error details on failure.

## Response Envelope

All responses follow this structure:

### Single Item

```json
{
  "id": "uuid",
  "data": {
    /* visualization definition */
  },
  "meta": {
    "created_at": "ISO timestamp",
    "updated_at": "ISO timestamp",
    "created_by": "user_id",
    "updated_by": "user_id",
    "managed": false
  }
}
```

### Search Results

```json
{
  "data": [
    /* array of items */
  ],
  "meta": {
    "page": 1,
    "per_page": 100,
    "total": 42
  }
}
```

## Common Properties

These properties apply to all visualization types:

| Property                | Type    | Description                               |
| ----------------------- | ------- | ----------------------------------------- |
| `type`                  | string  | Chart type (required)                     |
| `dataset`               | object  | Data source configuration (required)      |
| `sampling`              | number  | Sampling rate 0-1 (default: 1)            |
| `ignore_global_filters` | boolean | Ignore dashboard filters (default: false) |

## Dataset Configuration

### ES|QL Dataset

```json
{
  "dataset": {
    "type": "esql",
    "query": "FROM index | STATS count = COUNT() BY field"
  }
}
```

### Index Pattern Dataset

```json
{
  "dataset": {
    "type": "index_pattern",
    "index": "logs-*",
    "timeField": "@timestamp"
  }
}
```

## Default Injection

The API injects sensible defaults for omitted properties. Clients can send minimal payloads:

**Request (minimal):**

```json
{
  "type": "metric",
  "dataset": {
    "type": "esql",
    "query": "FROM logs | STATS count = COUNT()"
  },
  "metrics": [{ "type": "primary", "operation": "value", "column": "count" }]
}
```

**Response (with defaults):**

```json
{
  "type": "metric",
  "dataset": {
    "type": "esql",
    "query": "FROM logs | STATS count = COUNT()"
  },
  "metrics": [
    {
      "type": "primary",
      "operation": "value",
      "column": "count",
      "alignments": {
        "value": "right",
        "labels": "left"
      },
      "fit": false
    }
  ],
  "sampling": 1,
  "ignore_global_filters": false
}
```

## Error Responses

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation error description"
}
```

Common error codes:

- `400` — Invalid request or schema validation failure
- `401` — Authentication required
- `403` — Insufficient permissions
- `404` — Visualization not found
- `409` — Conflict (e.g., ID already exists on create)

## Testing from Dev Tools

When testing from Kibana Dev Tools, prefix requests with `kbn:`:

```text
GET kbn:/api/visualizations?apiVersion=1
GET kbn:/api/visualizations/:id?apiVersion=1
POST kbn:/api/visualizations?apiVersion=1
PUT kbn:/api/visualizations/:id?apiVersion=1
DELETE kbn:/api/visualizations/:id?apiVersion=1
```
