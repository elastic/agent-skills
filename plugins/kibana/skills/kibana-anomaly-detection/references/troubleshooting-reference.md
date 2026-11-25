# Troubleshooting reference

Lifecycle and health diagnostics via ML REST APIs and system indices. Apply **memory diagnosis before query_delay
tuning**.

## Memory status fields

From `GET /_ml/anomaly_detectors/{job_id}/_stats` → `model_size_stats`:

| Field                               | Meaning                                                 |
| ----------------------------------- | ------------------------------------------------------- |
| `model_bytes`                       | Current memory used                                     |
| `peak_model_bytes`                  | High-water mark since job opened                        |
| `model_bytes_memory_limit`          | Configured `model_memory_limit`                         |
| `memory_status`                     | `ok` / `soft_limit` (pruning) / `hard_limit` (critical) |
| `total_by_field_count > 100k`       | `by_field` cardinality too high — dominant driver       |
| `total_partition_field_count > 10k` | Partition explosion                                     |
| `total_category_count > 10k`        | Too many distinct log patterns                          |

### hard_limit diagnosis

When `memory_status` is `hard_limit` and `model_bytes == model_bytes_memory_limit`:

- The model hit its configured ceiling and **stops learning new entities**.
- Results degrade or stop; the datafeed may show `stopped` as a downstream symptom.
- **Restarting the datafeed alone does not fix hard_limit.**

Remediation (in order of preference):

1. **Raise `model_memory_limit`** via `POST /_ml/anomaly_detectors/{job_id}/_update` with
   `{"analysis_limits": {"model_memory_limit": "<new_limit>"}}` — requires close/reopen lifecycle.
2. **Reduce cardinality** — fewer partition/by/over values, split into multiple jobs, or narrow the datafeed query.
3. **Estimate sizing** — `POST /_ml/anomaly_detectors/_estimate_model_memory` with representative cardinality hints.

Prefer estimate API over heuristics like `peak_model_bytes * 1.3` — heuristics ignore influencer and categorizer memory.

## Config change lifecycle

Required sequence for memory limit or datafeed timing changes:

1. `POST /_ml/datafeeds/datafeed-{job_id}/_stop`
2. `POST /_ml/anomaly_detectors/{job_id}/_close`
3. Update job and/or datafeed config
4. `POST /_ml/anomaly_detectors/{job_id}/_open`
5. `POST /_ml/datafeeds/datafeed-{job_id}/_start`

Preview after changes: `POST /_ml/datafeeds/datafeed-{job_id}/_preview`.

Recover corrupted model periods: `POST /_ml/anomaly_detectors/{job_id}/model_snapshots/{snapshot_id}/_revert`.

## Missing documents / query timing

Inspect via `GET /_ml/datafeeds/datafeed-{job_id}`:

| Field                       | Role                                                            |
| --------------------------- | --------------------------------------------------------------- |
| `query_delay`               | How far behind real time the datafeed queries                   |
| `delayed_data_check_config` | How aggressively late data is checked                           |
| `frequency`                 | Poll interval (defaults to `min(query_delay, bucket_span / 2)`) |

Search delayed-data annotations:

```json
POST /.ml-annotations-*/_search
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "job_id": "{job_id}" } },
        { "term": { "event": "delayed_data" } }
      ]
    }
  }
}
```

Set `query_delay` to **P95 ingest latency + buffer** (typically `60s`–`120s`). Too small → missing docs; too large →
slower alerts. **Fix hard_limit before tuning query_delay** — memory corruption causes false missing-doc alarms.

## Job messages

Search notification index for errors and warnings:

```json
POST /.ml-notifications-*/_search
{
  "size": 20,
  "sort": [{ "timestamp": "desc" }],
  "query": {
    "bool": {
      "filter": [{ "term": { "job_id": "{job_id}" } } ]
    }
  }
}
```

## Datafeed state

`GET /_ml/datafeeds/datafeed-{job_id}/_stats` — check `state` (`started` / `stopped`), `timing_stats`, and
`running_state`. A stopped datafeed after hard_limit is expected until memory is fixed and the lifecycle sequence
completes.
