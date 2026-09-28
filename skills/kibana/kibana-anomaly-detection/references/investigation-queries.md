# Investigation query reference

`POST /.ml-anomalies-*/_search` query patterns for Investigate mode. Replace `{job_id}`, `{start}`, `{end}`, and entity
values with the incident context.

## Bucket timeline (scope incident)

```json
{
  "size": 100,
  "sort": [{ "timestamp": "desc" }],
  "query": {
    "bool": {
      "filter": [
        { "term": { "result_type": "bucket" } },
        { "term": { "job_id": "{job_id}" } },
        { "range": { "timestamp": { "gte": "{start}", "lte": "{end}" } } },
        { "range": { "anomaly_score": { "gte": 25 } } }
      ]
    }
  }
}
```

For cross-job scope, replace the single `job_id` term with `terms: { job_id: ["job-a", "job-b"] }` or omit it to scan
all jobs (add a time range).

## Influencers (entity attribution — RCA)

**Critical:** sort by `influencer_score` descending. The top row is the primary suspect entity.

```json
{
  "size": 20,
  "sort": [{ "influencer_score": "desc" }],
  "query": {
    "bool": {
      "filter": [
        { "term": { "result_type": "influencer" } },
        { "term": { "job_id": "{job_id}" } },
        { "range": { "timestamp": { "gte": "{start}", "lte": "{end}" } } },
        { "range": { "influencer_score": { "gte": 25 } } }
      ]
    }
  }
}
```

## Records (drill-down)

```json
{
  "size": 50,
  "sort": [{ "record_score": "desc" }],
  "query": {
    "bool": {
      "filter": [
        { "term": { "result_type": "record" } },
        { "term": { "job_id": "{job_id}" } },
        { "range": { "timestamp": { "gte": "{start}", "lte": "{end}" } } },
        { "range": { "record_score": { "gte": 25 } } }
      ],
      "must": [{ "term": { "partition_field_value": "{entity}" } }]
    }
  }
}
```

Adjust entity filter field to `by_field_value` or `over_field_value` as configured on the job.

## Cross-job entity match

Find all jobs where a specific entity value appears in influencer results:

```json
{
  "size": 0,
  "query": {
    "bool": {
      "filter": [
        { "term": { "result_type": "influencer" } },
        { "term": { "influencer_field_value": "{entity}" } },
        { "range": { "timestamp": { "gte": "{start}", "lte": "{end}" } } }
      ]
    }
  },
  "aggs": {
    "by_job": {
      "terms": { "field": "job_id", "size": 20 },
      "aggs": { "max_score": { "max": { "field": "influencer_score" } } }
    }
  }
}
```

Entities appearing in 2+ jobs (`by_job.buckets.length ≥ 2`) are prime root-cause suspects.

## Model plot (bounds check)

Requires `model_plot_config.enabled` on the job.

```json
{
  "size": 100,
  "sort": [{ "timestamp": "asc" }],
  "query": {
    "bool": {
      "filter": [
        { "term": { "result_type": "model_plot" } },
        { "term": { "job_id": "{job_id}" } },
        { "range": { "timestamp": { "gte": "{start}", "lte": "{end}" } } }
      ]
    }
  }
}
```

## Category definitions (log categorization jobs)

```json
{
  "size": 50,
  "query": {
    "bool": {
      "filter": [{ "term": { "result_type": "category_definition" } }, { "term": { "job_id": "{job_id}" } }]
    }
  }
}
```

## Related job discovery

No single API returns "related jobs." Compare outputs of:

- `GET /_ml/datafeeds/datafeed-{job_id}` — shared `indices` imply shared infrastructure.
- `GET /_ml/anomaly_detectors/{job_id}` — shared `by_field_name` / `partition_field_name` imply shared entity
  dimensions.

List all jobs with `GET /_ml/anomaly_detectors` and filter by matching index patterns or entity fields.
