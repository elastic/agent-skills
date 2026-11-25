# Anomaly Detection Explainer — API Reference

This reference documents the HTTP API calls used to explain anomaly scores and model behavior.

**Two API layers are used:**

- **ML REST API** (`GET /_ml/anomaly_detectors/...`) — for job config and stats. Available everywhere.
- **Standard `_search` API** (`POST /.ml-anomalies-*/_search`) — for all result queries. Fully supported in Elastic
  Serverless. Used instead of the ML results REST endpoints (`/_ml/anomaly_detectors/{job_id}/results/...`) which return
  HTTP 410 in Elastic Serverless.

Requires `monitor_ml` cluster privilege.

## Endpoint summary

| Operation          | HTTP API (shorthand)                         | Layer       | Purpose                                                 |
| ------------------ | -------------------------------------------- | ----------- | ------------------------------------------------------- |
| List jobs          | `GET /_ml/anomaly_detectors`                 | ML REST API | All job IDs and basic config.                           |
| Job config         | `GET /_ml/anomaly_detectors/{job_id}`        | ML REST API | Full analysis_config, datafeed_config, analysis_limits. |
| Job stats          | `GET /_ml/anomaly_detectors/{job_id}/_stats` | ML REST API | State, memory_status, data_counts.                      |
| Anomaly records    | `POST /.ml-anomalies-*/_search`              | Search API  | Records filtered by job_id, result_type, time, score.   |
| Influencers        | `POST /.ml-anomalies-*/_search`              | Search API  | Influencer documents filtered by job_id, time, score.   |
| Model plot         | `POST /.ml-anomalies-*/_search`              | Search API  | model_plot documents with bounds and actual.            |
| Categories         | `POST /.ml-anomalies-*/_search`              | Search API  | category_definition documents for categorization jobs.  |
| Score reassessment | `POST /.ml-anomalies-*/_search` (+ client)   | Search API  | Records, then client-side drift computation.            |

## ML REST API calls

### List jobs

`GET /_ml/anomaly_detectors`

Returns all jobs. No `size` parameter; API always returns all. Response: `{ count, jobs: [...] }`.

Useful fields per job: `job_id`, `analysis_config.bucket_span`, `analysis_config.detectors`,
`analysis_limits.model_memory_limit`.

### Job config and stats

`GET /_ml/anomaly_detectors/{job_id}`

`GET /_ml/anomaly_detectors/{job_id}/_stats`

Config response: `analysis_config` (bucket_span, detectors with function, field_name, by/over/partition fields,
custom_rules, use_null), `datafeed_config` (indices, query, query_delay), `analysis_limits.model_memory_limit`.

Stats response: `state` (opened/closed/failed), `data_counts` (processed_record_count, etc.), `model_size_stats`
(memory_status, model_bytes, peak_model_bytes).

## Search API — result queries

All result queries use `POST /.ml-anomalies-*/_search` with a bool filter query. Every query includes
`{ "term": { "result_type": "<type>" } }` and `{ "term": { "job_id": "<job_id>" } }`.

### Anomaly records

```json
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "result_type": "record" } },
        { "term": { "job_id": "<job_id>" } },
        { "range": { "timestamp": { "gte": "<start>", "lt": "<end>" } } },
        { "range": { "record_score": { "gte": <min_score> } } }
      ]
    }
  },
  "sort": [{ "record_score": "desc" }],
  "from": 0,
  "size": 100
}
```

Key response fields per record: `job_id`, `timestamp`, `record_score`, `initial_record_score`, `actual`, `typical`,
`function`, `field_name`, `by_field_name`, `by_field_value`, `partition_field_name`, `partition_field_value`,
`over_field_name`, `over_field_value`, `multi_bucket_impact`, `anomaly_score_explanation`, `probability`,
`detector_index`.

`anomaly_score_explanation` sub-fields: `anomaly_length`, `single_bucket_impact`, `multi_bucket_impact`,
`anomaly_characteristics_impact`, `high_variance_penalty`, `incomplete_bucket_penalty`.

### Influencers

```json
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "result_type": "influencer" } },
        { "term": { "job_id": "<job_id>" } },
        { "range": { "timestamp": { "gte": "<start>", "lt": "<end>" } } }
      ]
    }
  },
  "sort": [{ "influencer_score": "desc" }],
  "from": 0,
  "size": 100
}
```

Key response fields: `timestamp`, `influencer_field_name`, `influencer_field_value`, `influencer_score`,
`initial_influencer_score`.

### Model plot

```json
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "result_type": "model_plot" } },
        { "term": { "job_id": "<job_id>" } },
        { "range": { "timestamp": { "gte": "<start>", "lt": "<end>" } } }
      ]
    }
  },
  "sort": [{ "timestamp": "asc" }],
  "from": 0,
  "size": 500
}
```

Key response fields: `timestamp`, `model_lower`, `model_upper`, `model_median`, `actual`, `partition_field_value`,
`by_field_value`.

Only returns data if the job was created or updated with `model_plot_config: { enabled: true }`. Empty result means
model plot is not enabled for the job.

### Categories

```json
{
  "query": {
    "bool": {
      "filter": [{ "term": { "result_type": "category_definition" } }, { "term": { "job_id": "<job_id>" } }]
    }
  },
  "from": 0,
  "size": 100
}
```

Key response fields: `category_id`, `terms`, `regex`, `examples`, `max_matching_length`.

Only relevant for jobs with a `categorization_field_name`. Anomaly records for categorization jobs use
`by_field_value = <category_id>`.

### Score reassessment (client-side)

There is no dedicated endpoint. The workflow:

1. Fetch records for the job and time range (sorted by timestamp ascending) via `POST /.ml-anomalies-*/_search`.
2. Compute `score_drift = initial_record_score - record_score` per record.
3. Filter to records where `|score_drift| >= min_drift` (default 20).

Large negative drift (initial >> record) means renormalization lowered the score after a more extreme anomaly appeared.
Large positive drift is rare and indicates the model reconsidered upward.

## Parameter conventions

| Parameter  | Type   | Notes                                                                           |
| ---------- | ------ | ------------------------------------------------------------------------------- |
| job_id     | string | Exact job ID (no wildcards). ML API and `_search` filter are per-job.           |
| start, end | string | ISO 8601 or epoch ms. Used in `range` filter on `timestamp`.                    |
| min_score  | number | Minimum `record_score` (0–100). 50 = significant, 75 = critical.                |
| min_drift  | number | Minimum abs(initial_record_score − record_score) for reassessment (default 20). |
| size       | number | `size` in the `_search` request. For list-jobs: API returns all jobs.           |
