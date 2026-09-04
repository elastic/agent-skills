# Lens Visualizations API Reference

The Visualizations API provides CRUD endpoints for standalone Lens library items (Kibana 9.4+).

## Endpoints

### List Visualizations

```http
GET kbn:/api/visualizations?query=&page=&per_page=
```

| Parameter  | Type   | Description                     |
| ---------- | ------ | ------------------------------- |
| `query`    | string | Search query                    |
| `page`     | number | Page number (default: 1)        |
| `per_page` | number | Results per page (default: 100) |

### Get Visualization

```http
GET kbn:/api/visualizations/{id}
```

### Create Visualization

```http
POST kbn:/api/visualizations
```

`POST` auto-generates an id. Send the definition without an id field.

### Update Visualization (Upsert)

```http
PUT kbn:/api/visualizations/{id}
```

`PUT` creates the visualization when the id does not exist.

### Delete Visualization

```http
DELETE kbn:/api/visualizations/{id}
```

## Response Envelope

Single-item responses wrap the definition:

```json
{
  "id": "uuid",
  "data": { "type": "metric", "data_source": { ... }, "metrics": [ ... ] },
  "meta": {
    "created_at": "ISO timestamp",
    "updated_at": "ISO timestamp",
    "managed": false
  }
}
```

List responses return `{ "data": [ ... ], "meta": { "page", "per_page", "total" } }`.

## Common Properties

| Property                | Type    | Description                               |
| ----------------------- | ------- | ----------------------------------------- |
| `type`                  | string  | Chart type (required)                     |
| `data_source`           | object  | Data source configuration (required)      |
| `title`                 | string  | Display title                             |
| `sampling`              | number  | Sampling rate 0–1 (default: 1)            |
| `ignore_global_filters` | boolean | Ignore dashboard filters (default: false) |

## Dataset Configuration

### ES|QL Dataset

Use when the user requests ES|QL. The API persists a Lens saved object backed by a text-based ES|QL datasource.

```json
{
  "data_source": {
    "type": "esql",
    "query": "FROM logs* | STATS count = COUNT()"
  }
}
```

Reference result columns with `{ "column": "count" }` on metrics or layer axes — not `operation: "count"`.

### Data View Dataset

```json
{
  "data_source": {
    "type": "data_view_reference",
    "ref_id": "90943e30-9a47-11e8-b64d-95841ca0b247"
  }
}
```

Use aggregation operations such as `count`, `average`, `sum`, `terms`, and `date_histogram` on metrics and axes.

### Index Pattern Dataset

```json
{
  "data_source": {
    "type": "data_view_spec",
    "index_pattern": "logs-*",
    "time_field": "@timestamp"
  }
}
```

## Metric Example (ES|QL)

```json
{
  "type": "metric",
  "title": "Total Requests",
  "data_source": {
    "type": "esql",
    "query": "FROM logs* | STATS count = COUNT()"
  },
  "metrics": [{ "type": "primary", "column": "count" }]
}
```

## Error Responses

| Code | Meaning                                   |
| ---- | ----------------------------------------- |
| 400  | Schema validation failure                 |
| 401  | Authentication required                   |
| 404  | Visualization not found                   |
| 409  | Conflict on create when id already exists |
