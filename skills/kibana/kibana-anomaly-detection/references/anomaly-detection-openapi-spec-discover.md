## ML API Spec Discovery

The `.kibana_ai_openapi_spec_elasticsearch` index, if present, contains one document per API endpoint. Document shape:

```json
{
  "description": "Forecasts are not supported for jobs that perform population analysis; an\nerror occurs if you try to create a forecast for a job that has an\n`over_field_name` in its configuration. Forecasts predict future behavior\nbased on historical data.\n\n## Required authorization\n\n* Cluster privileges: `manage_ml`\n",
  "endpoint": "POST /_ml/anomaly_detectors/{job_id}/_forecast",
  "method": "post",
  "operationId": "ml-forecast",
  "path": "/_ml/anomaly_detectors/{job_id}/_forecast",
  "path.keyword": "/_ml/anomaly_detectors/{job_id}/_forecast",
  "summary": "Predict future behavior of a time series",
  "tags": "ml anomaly"
}
```

Use this to make informed API requests.

`summary` and `description` are **semantic text fields** — use `MATCH()` for natural-language lookup.

### Step 1 — Confirm index exists

```text
platform.core.list_indices  →  check for .kibana_ai_openapi_spec_elasticsearch
```

or use ES|QL query

```esql
FROM .kibana_ai_openapi_spec_elasticsearch
```

If index missing or error, fall back to researching the official documentation:
[Elastic ML API docs](https://www.elastic.co/docs/api/doc/elasticsearch/group/endpoint-ml) and
[Elastic ML Anomaly API docs](https://www.elastic.co/docs/api/doc/elasticsearch/group/endpoint-ml-anomaly).

### Step 2 — List all ML endpoints

```esql
FROM .kibana_ai_openapi_spec_elasticsearch
| WHERE tags == "ml"
| SORT endpoint ASC
| LIMIT 100
```

### Step 3 — Look up a specific endpoint by path

```esql
FROM .kibana_ai_openapi_spec_elasticsearch
| WHERE path LIKE "/_ml/calendars*"
| SORT endpoint ASC
```

### Step 4 — Semantic search when you know the intent, not the path

```esql
FROM .kibana_ai_openapi_spec_elasticsearch
| WHERE tags == "ml" AND MATCH(summary, "model memory limit")
| LIMIT 10
```

```esql
FROM .kibana_ai_openapi_spec_elasticsearch
| WHERE tags == "ml" AND MATCH(description, "revert snapshot")
| KEEP method, endpoint, summary, description
| LIMIT 5
```

**When to use this:**

- A workflow tool returns 400/404 and you suspect a wrong path or missing required field
- You want to discover optional parameters not covered by the current tool definition
- You're adding a new `ad_*` workflow tool and need the exact endpoint and request body schema
