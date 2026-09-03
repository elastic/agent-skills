# Troubleshoot mode — tool reference

ES|QL and workflow tool parameters, REST fallbacks, and decision trees for the **Troubleshoot** mode of the parent
[SKILL.md](../SKILL.md).

## ES|QL Tools (8)

### `ad_get_available_metadata`

Discover all jobs and metadata. **Call first.**

```esql
FROM .ml-config
| WHERE job_type == "anomaly_detector"
| STATS job_count = COUNT(*), job_ids = VALUES(job_id),
        functions = VALUES(`analysis_config.detectors.function`),
        bucket_spans = VALUES(`analysis_config.bucket_span`)
```

_No parameters._

---

### `ad_get_jobs`

List all jobs with config, memory limit, and state context.

```esql
FROM .ml-config
| WHERE job_type == "anomaly_detector"
| KEEP job_id, `analysis_config.bucket_span`, `analysis_config.detectors.function`,
       `analysis_config.detectors.partition_field_name`,
       `analysis_config.detectors.by_field_name`,
       `analysis_limits.model_memory_limit`, groups, description
| SORT job_id ASC | LIMIT 100
```

_No parameters._

---

### `ad_get_job_messages`

All notifications from `.ml-notifications-*`: datafeed warnings, delayed data, memory limits, lifecycle events, errors.

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `job_id`  | text | Job ID      |

```esql
FROM .ml-notifications-*
| WHERE job_id == ?job_id
| SORT timestamp DESC
| KEEP timestamp, level, message, node_name, job_id
| LIMIT 50
```

---

### `ad_get_model_snapshots`

Available model snapshots. Review before using `ad_revert_model_snapshot`.

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `job_id`  | text | Job ID      |

```esql
FROM .ml-anomalies-*
| WHERE result_type == "model_snapshot" AND job_id == ?job_id
| SORT timestamp DESC
| KEEP job_id, timestamp, description, snapshot_doc_count
| LIMIT 20
```

---

### `ad_ts_model_memory_health`

Memory status time series. `limit=1` for current snapshot; `limit=500` for trend and trajectory.

**Interpretation:** `hard_limit` = CRITICAL (job blind to new entities). `soft_limit` = WARNING (pruning).
`model_bytes / model_bytes_memory_limit > 0.8` = APPROACHING LIMIT.

| Parameter | Type    | Description                   |
| --------- | ------- | ----------------------------- |
| `job_id`  | text    | Job ID                        |
| `limit`   | integer | 1 = current, 500 = full trend |

```esql
FROM .ml-anomalies-*
| WHERE result_type == "model_size_stats" AND job_id == ?job_id
| SORT timestamp DESC
| KEEP job_id, timestamp, model_bytes, peak_model_bytes, model_bytes_memory_limit,
       model_bytes_exceeded, memory_status,
       total_by_field_count, total_over_field_count, total_partition_field_count,
       bucket_allocation_failures_count
| LIMIT ?limit
```

---

### `ad_ts_ingest_latency_estimate`

Measure actual ingest latency via `event.ingested`. If P95 > `query_delay` → data is being lost.

| Parameter      | Type | Description                       |
| -------------- | ---- | --------------------------------- |
| `source_index` | text | LIKE pattern from datafeed config |
| `start_time`   | text | ISO 8601                          |
| `end_time`     | text | ISO 8601                          |

```esql
FROM * METADATA _index
| WHERE _index LIKE ?source_index
  AND @timestamp >= ?start_time AND @timestamp <= ?end_time
  AND event.ingested IS NOT NULL
| EVAL latency_seconds = DATE_DIFF("second", @timestamp, event.ingested)
| STATS p50_latency = PERCENTILE(latency_seconds, 50),
        p95_latency = PERCENTILE(latency_seconds, 95),
        p99_latency = PERCENTILE(latency_seconds, 99),
        max_latency = MAX(latency_seconds), doc_count = COUNT(*)
| LIMIT 1
```

---

### `ad_ts_bucket_event_gaps`

Buckets with zero or low event counts. Correlate with delayed data annotations to confirm false positives from missing
data.

| Parameter    | Type | Description |
| ------------ | ---- | ----------- |
| `job_id`     | text | Job ID      |
| `start_time` | text | ISO 8601    |
| `end_time`   | text | ISO 8601    |

```esql
FROM .ml-anomalies-*
| WHERE result_type == "bucket"
  AND job_id == ?job_id
  AND timestamp >= ?start_time AND timestamp <= ?end_time
| SORT timestamp ASC
| KEEP timestamp, event_count, anomaly_score, bucket_span, is_interim
| LIMIT 500
```

---

### `ad_ts_delayed_data_annotations`

Delayed data annotations — starting point for any missing documents investigation.

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `job_id`  | text | Job ID      |

```esql
FROM .ml-annotations-*
| WHERE job_id == ?job_id AND event == "delayed_data"
| SORT timestamp DESC
| KEEP job_id, timestamp, end_timestamp, annotation
| LIMIT 100
```

---

## Workflow Tools (15)

### `ad_get_job_datafeed_config`

Full job + datafeed config: `bucket_span`, `query_delay`, `delayed_data_check_config`, source indices. Essential for all
troubleshooting and memory estimation.

| Parameter | Type   | Required |
| --------- | ------ | -------- |
| `job_id`  | string | yes      |

```text
Step 1: GET _ml/anomaly_detectors/{job_id}
Step 2: GET _ml/anomaly_detectors/{job_id}/_stats
```

---

### `ad_manage_datafeed`

Start or stop a datafeed via `POST _ml/datafeeds/{datafeed_id}/{_start|_stop}`. For preview, use
`ad_preview_datafeed_with_latency` (`GET _ml/datafeeds/{datafeed_id}/_preview`).

| Parameter     | Type   | Required | Description                 |
| ------------- | ------ | -------- | --------------------------- |
| `datafeed_id` | string | yes      | Usually `datafeed-{job_id}` |
| `action`      | string | yes      | `_start` or `_stop` only    |

```text
POST _ml/datafeeds/{datafeed_id}/{action}
```

---

### `ad_preview_datafeed_with_latency`

Preview datafeed payload and measure effective latency before tuning query_delay.

| Parameter     | Type   | Required |
| ------------- | ------ | -------- |
| `datafeed_id` | string | yes      |

```text
GET _ml/datafeeds/{datafeed_id}/_preview
```

---

### `ad_update_datafeed_query_delay`

Update `query_delay`. **Stop datafeed first.** Set to P95 ingest latency + buffer.

| Parameter         | Type   | Required | Description       |
| ----------------- | ------ | -------- | ----------------- |
| `datafeed_id`     | string | yes      |                   |
| `new_query_delay` | string | yes      | e.g. `3m`, `120s` |

```text
POST _ml/datafeeds/{datafeed_id}/_update
Body: { "query_delay": "{new_query_delay}" }
```

---

### `ad_update_delayed_data_check_config`

Enable/disable delayed data checks or adjust `check_window`.

| Parameter      | Type    | Required | Description                                                           |
| -------------- | ------- | -------- | --------------------------------------------------------------------- |
| `job_id`       | string  | yes      |                                                                       |
| `enabled`      | boolean | yes      |                                                                       |
| `check_window` | string  | no       | e.g. `2h`; omitted from the update body when empty or whitespace-only |

```text
Step 1: data.parseJson — build update body (enabled as JSON boolean; check_window only if non-blank after trim)
Step 2: POST _ml/anomaly_detectors/{job_id}/_update with that body
```

---

### `ad_update_model_memory_limit`

Update `model_memory_limit`. **Cannot decrease below current `model_bytes`** — clone job to shrink. Requires
stop/close/update/open/start sequence.

| Parameter   | Type   | Required | Description         |
| ----------- | ------ | -------- | ------------------- |
| `job_id`    | string | yes      |                     |
| `new_limit` | string | yes      | e.g. `256mb`, `1gb` |

```text
POST _ml/anomaly_detectors/{job_id}/_update
Body: { "analysis_limits": { "model_memory_limit": "{new_limit}" } }
```

---

### `ad_estimate_memory_requirement`

**Best practice for memory sizing.** Auto-samples cardinality from source → calls
`POST _ml/anomaly_detectors/_estimate_model_memory`. More accurate than `peak_model_bytes * 1.3`.

| Parameter      | Type   | Required | Description                       |
| -------------- | ------ | -------- | --------------------------------- |
| `job_id`       | string | yes      |                                   |
| `sample_start` | string | no       | ISO 8601, defaults to 30 days ago |
| `sample_end`   | string | no       | ISO 8601, defaults to now         |

```text
Step 1: GET _ml/anomaly_detectors/{job_id}
Step 2: Extract split fields and pure influencers
Step 3: POST {datafeed_indices}/_search?size=0  → overall_cardinality per field
Step 4: POST {datafeed_indices}/_search?size=0  → max_bucket_cardinality
Step 5: POST _ml/anomaly_detectors/_estimate_model_memory
Step 6: Compare estimate vs model_memory_limit vs model_bytes
Step 7: Recommend (increase / reduce data / restructure)
```

---

### `ad_wf_ts_field_cardinality`

Cardinality of a split field in **source** data. If source cardinality >> the model's `total_*_count` from
`ad_ts_model_memory_health`, entities may be dropped.

This is a **workflow** (not an ES|QL Agent Builder tool): it runs `POST /_query` and **splices** `split_field_esql` into
the query text as the `COUNT_DISTINCT` column. ES|QL `?` parameters bind **literals only**, so field names cannot be
passed as `?` parameters.

| Parameter          | Type   | Required | Description                                                                                      |
| ------------------ | ------ | -------- | ------------------------------------------------------------------------------------------------ |
| `source_index`     | string | yes      | LIKE pattern from datafeed config                                                                |
| `split_field_esql` | string | yes      | Column expression for `COUNT_DISTINCT` (for example `service.keyword`); from job analysis config |
| `start_time`       | string | yes      | ISO 8601                                                                                         |
| `end_time`         | string | yes      | ISO 8601                                                                                         |

```text
POST /_query
Body includes "query" with COUNT_DISTINCT(<split_field_esql>) and "params" for ?source_index, ?start_time, ?end_time
```

---

### `ad_validate_ml_tool_permissions`

Preflight check on core `.ml-*` indices (`read` + `view_index_metadata` on `.ml-anomalies-*`, `.ml-config`,
`.ml-annotations-*`, `.ml-notifications-*`). Does **not** assert privileges on job source data indices — check those
before previews or `ad_rca_source_evidence`.

_No parameters._

```text
Step 1: GET _security/_authenticate
Step 2: POST _security/user/_has_privileges
        (.ml-anomalies-*, .ml-config, .ml-annotations-*, .ml-notifications-*)
```

---

### `ad_ts_ccs_diagnostics`

Cross-cluster search diagnostics: remote cluster connectivity, latency, error rates.

_No parameters._

```text
Step 1: GET _remote/info
Step 2: GET _cluster/health
```

---

### `ad_revert_model_snapshot`

Revert to a previous model snapshot to "unlearn" bad data. Job must be **closed** first. After reverting, reopen and
restart datafeed from the snapshot timestamp.

| Parameter     | Type   | Required |
| ------------- | ------ | -------- |
| `job_id`      | string | yes      |
| `snapshot_id` | string | yes      |

```text
POST _ml/anomaly_detectors/{job_id}/model_snapshots/{snapshot_id}/_revert
```

---

### `ad_get_calendar_events`

Get scheduled events from a calendar (maintenance windows, holidays).

| Parameter     | Type   | Required |
| ------------- | ------ | -------- |
| `calendar_id` | string | yes      |

```text
GET _ml/calendars/{calendar_id}/events
```

---

### `ad_create_calendar_event`

Add a scheduled event to suppress false positives during known downtime.

| Parameter     | Type   | Required | Description                       |
| ------------- | ------ | -------- | --------------------------------- |
| `calendar_id` | string | yes      |                                   |
| `description` | string | yes      | e.g. `Planned maintenance window` |
| `start_time`  | string | yes      | ISO 8601 or epoch_millis          |
| `end_time`    | string | yes      | ISO 8601 or epoch_millis          |

```text
POST _ml/calendars/{calendar_id}/events
Body: { "events": [{ "description": ..., "start_time": ..., "end_time": ... }] }
```

---

### `ad_wf_troubleshoot_query_delay`

Full automated decision tree for missing documents diagnosis.

| Parameter | Type   | Required |
| --------- | ------ | -------- |
| `job_id`  | string | yes      |

Decision tree:

1. Retrieve config + `memory_status`.
2. **Gate:** Categorization job + `memory_status == hard_limit` → EXIT EARLY. Missing-doc warning is a false alarm from
   memory exhaustion. Fix memory first.
3. `ad_ts_delayed_data_annotations` — frequency, severity, affected ranges.
4. `ad_ts_bucket_event_gaps` — zero/low event count buckets.
5. `ad_ts_ingest_latency_estimate` — P50/P95/P99. If P95 > `query_delay` → data lost.
6. Recommend `query_delay` = P95 + buffer.
7. Additional remediation: add ingest pipeline, use ingest timestamp as `time_field`, revert snapshot + backfill.

---

### `ad_wf_troubleshoot_memory_limit`

Full automated decision tree for memory limit diagnosis.

| Parameter | Type   | Required |
| --------- | ------ | -------- |
| `job_id`  | string | yes      |

Decision tree:

1. `ad_ts_model_memory_health` (limit=1): classify as `ok` / `soft_limit` / `hard_limit`.
2. If `hard_limit`: check notifications for "missed documents" warnings — these are SYMPTOMS of hard_limit, not ingest
   lag.
3. `ad_ts_model_memory_health` (limit=500): stable / linear / exponential growth. Predict time-to-limit.
4. Inspect `model_size_stats`: `total_by_field_count > 100K`, `total_partition_field_count > 10K`,
   `total_category_count > 10K` → identify dominant driver.
5. `ad_estimate_memory_requirement`: principled sizing.
6. Recommend: **A** — Increase limit; **B** — Reduce data (filter datafeed, reduce influencers); **C** — Multi-GB
   architectural restructuring.

---
