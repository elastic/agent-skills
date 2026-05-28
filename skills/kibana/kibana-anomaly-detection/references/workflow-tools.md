# Workflow Tools Reference

Full documentation for all workflow tools. Most call Elasticsearch ML HTTP APIs (REST) via the Kibana Agent Builder. A
few run ES|QL via `POST /_query` when a column identifier must be spliced into the query text (ES|QL `?` parameters bind
literals only, not field names).

> For ES|QL read tools, see the skill SKILL.md files. For permissions required, see
> [permissions-matrix.md](permissions-matrix.md).

---

## Availability Note

Workflow tools require **Kibana Elastic Agent Workflows** to be enabled. Not all deployments have this feature. If a
workflow tool is unavailable, the description includes a manual fallback — prefer ES|QL queries first, then REST API
calls if ES|QL cannot express the operation.

---

## Job & Datafeed Configuration

### `ad_get_job_datafeed_config`

Fetch complete job and datafeed configuration in one call.

| Parameter | Type   | Required | Description                  |
| --------- | ------ | -------- | ---------------------------- |
| `job_id`  | string | yes      | The anomaly detection job ID |

**API calls:**

```text
GET _ml/anomaly_detectors/{job_id}
GET _ml/anomaly_detectors/{job_id}/_stats
```

**Returns:** `analysis_config` (detectors, by/over/partition fields, bucket_span, frequency), `datafeed_config` (source
indices, query, query_delay, delayed_data_check_config), and runtime stats (memory_status, model_bytes, data_counts,
state).

**When to use:** Required before calling `ad_rca_source_evidence` (to get the source index). Also used in
troubleshooting workflows to inspect query_delay, bucket_span, and custom_rules.

---

### `ad_discover_jobs_by_datafeed_index`

Given a job of interest, find all other jobs whose datafeed reads from the same source indices.

| Parameter | Type   | Required | Description                              |
| --------- | ------ | -------- | ---------------------------------------- |
| `job_id`  | string | yes      | The job ID whose source indices to match |

**API calls:**

```text
GET _ml/anomaly_detectors/{job_id}        ← get target job's datafeed_config.indices
GET .ml-config/_search                    ← find all other jobs with overlapping indices
```

**Returns:** Jobs grouped by shared index pattern, with match count per group.

**When to use:** Step 2 of every investigation. Jobs reading from the same source index monitor the same underlying
system — strongest config-level relatedness signal.

\*\*Fallback if unavailable: Use ESQL to find get target job's datafeed_config.indices then all other jobs with
overlapping indices

```esql
FROM .ml-config
| WHERE job_type == "anomaly_detector"
```

---

## Datafeed Lifecycle

### `ad_manage_datafeed`

Start or stop a datafeed (`POST _ml/datafeeds/{datafeed_id}/_start` or `/_stop`). Preview uses a separate GET endpoint;
use `ad_preview_datafeed_with_latency` instead of `_preview` on this workflow.

| Parameter     | Type   | Required | Description                   |
| ------------- | ------ | -------- | ----------------------------- |
| `datafeed_id` | string | yes      | Typically `datafeed-{job_id}` |
| `action`      | string | yes      | `_start` or `_stop` only      |

**API call:**

```text
POST _ml/datafeeds/{datafeed_id}/{action}
```

**When to use:** Required as part of remediation sequences:

- Stop datafeed before updating `query_delay` or `model_memory_limit`
- Restart datafeed after updating job config
- To preview extracted rows before starting, call `ad_preview_datafeed_with_latency`
  (`GET _ml/datafeeds/{datafeed_id}/_preview`)

---

### `ad_preview_datafeed_with_latency`

Preview a datafeed's output to inspect data quality and measure effective latency.

| Parameter     | Type   | Required | Description                |
| ------------- | ------ | -------- | -------------------------- |
| `datafeed_id` | string | yes      | The datafeed ID to preview |

**API call:**

```text
GET _ml/datafeeds/{datafeed_id}/_preview
```

**Returns:** Sample documents that the datafeed would extract, including field values and timestamps. Use to verify: Is
`event.ingested` available? Are all expected fields present? What does the data look like at query time?

**When to use:** Before tuning `query_delay` — understand what data the datafeed sees and which timestamp fields are
available for latency measurement.

---

### `ad_update_datafeed_query_delay`

Update the `query_delay` on a datafeed to capture more late-arriving data.

| Parameter         | Type   | Required | Description                               |
| ----------------- | ------ | -------- | ----------------------------------------- |
| `datafeed_id`     | string | yes      | The datafeed ID                           |
| `new_query_delay` | string | yes      | New delay value, e.g., `3m`, `120s`, `5m` |

**API call:**

```text
POST _ml/datafeeds/{datafeed_id}/_update
Body: {"query_delay": "{new_query_delay}"}
```

**Prerequisites:** Datafeed must be stopped first (`ad_manage_datafeed` with `_stop`).

**Trade-off:** Larger `query_delay` = more late-arriving data captured = slower anomaly alerts. Set to P95 ingest
latency + a buffer (e.g., if P95 latency is 90s, set to `2m`).

---

### `ad_update_delayed_data_check_config`

Control how aggressively delayed data is detected and annotated.

| Parameter      | Type    | Required | Description                                                                                              |
| -------------- | ------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `job_id`       | string  | yes      | The anomaly detection job ID                                                                             |
| `enabled`      | boolean | yes      | Enable or disable delayed data checks                                                                    |
| `check_window` | string  | no       | Time window to scan for delayed data, e.g., `2h`; omitted from the request when empty or whitespace-only |

**API call:**

```text
Step 1: data.parseJson — build JSON (enabled as boolean; check_window only when non-blank after trim)
Step 2: POST _ml/anomaly_detectors/{job_id}/_update
Body (example with window): {"analysis_config": {"delayed_data_check_config": {"enabled": true, "check_window": "2h"}}}
Body (example without window): {"analysis_config": {"delayed_data_check_config": {"enabled": true}}}
```

**When to use:** Disable if delayed data checks are generating false positives. Increase `check_window` if late-arriving
data is coming in very late (>1h after event time).

---

## Memory Management

### `ad_estimate_memory_requirement`

Compute a principled `model_memory_limit` estimate using the same algorithm Elasticsearch uses internally.

| Parameter      | Type   | Required | Description                                                               |
| -------------- | ------ | -------- | ------------------------------------------------------------------------- |
| `job_id`       | string | yes      | The anomaly detection job ID                                              |
| `sample_start` | string | no       | Start of cardinality sampling period (ISO 8601). Defaults to 30 days ago. |
| `sample_end`   | string | no       | End of cardinality sampling period (ISO 8601). Defaults to now.           |

**API calls (7 steps):**

```text
1. GET _ml/anomaly_detectors/{job_id}             ← get config
2. [identify cardinality fields]
3. POST {indices}/_search?size=0                   ← overall_cardinality (aggs)
4. POST {indices}/_search?size=0                   ← max_bucket_cardinality (date_histogram)
5. POST _ml/anomaly_detectors/_estimate_model_memory  ← official estimate
6. [compare estimate vs current limit vs actual usage]
7. [produce recommendation]
```

**Returns:** Estimated memory requirement, comparison against current `model_memory_limit` and `peak_model_bytes`, and a
recommendation (increase / current is appropriate / reduce data).

**When to use:** Before increasing `model_memory_limit`. Much more accurate than `peak_model_bytes * 1.3` because it
uses the actual cardinality of your data.

---

### `ad_wf_ts_field_cardinality`

Approximate **distinct value count** for a split field (`partition_field`, `by_field`, or `over_field`) in **source**
data over a time window via ES|QL `POST /_query`. `source_index`, `start_time`, and `end_time` are sent as **named
literal** `params` for `?` placeholders; `split_field_esql` is **interpolated** into the query as the `COUNT_DISTINCT`
column (for example `service.keyword` or `` `host.name.keyword` `` from `ad_get_job_datafeed_config`). If source
cardinality is much larger than `total_*_count` from `ad_ts_model_memory_health`, entities may be dropped. For CCS, run
per cluster and sum. Prefer `ad_estimate_memory_requirement` for full sizing.

#### Parameters

- `source_index` (string, required): index name or LIKE pattern from the datafeed config (same filter as
  `FROM * METADATA _index`).
- `split_field_esql` (string, required): valid ES|QL column expression for `COUNT_DISTINCT` — not a string literal; use
  values from job analysis config only.
- `start_time` (string, required): ISO 8601 start of window.
- `end_time` (string, required): ISO 8601 end of window.

**API call:**

```text
POST /_query
Body: { "query": "... COUNT_DISTINCT(<split_field_esql>) ...", "params": { "source_index": "...", "start_time": "...", "end_time": "..." } }
```

**When to use:** After `ad_ts_model_memory_health` shows memory pressure or `total_*_count` lower than expected — check
whether the source still has more distinct split values than the model retains.

---

### `ad_update_model_memory_limit`

Update the `model_memory_limit` on a job.

| Parameter   | Type   | Required | Description                           |
| ----------- | ------ | -------- | ------------------------------------- |
| `job_id`    | string | yes      | The anomaly detection job ID          |
| `new_limit` | string | yes      | New limit value, e.g., `256mb`, `1gb` |

**API call:**

```text
POST _ml/anomaly_detectors/{job_id}/_update
Body: {"analysis_limits": {"model_memory_limit": "{new_limit}"}}
```

**Prerequisites:** Job must be closed first. Full remediation sequence:

1. `ad_manage_datafeed` with `_stop`
2. `POST _ml/anomaly_detectors/{job_id}/_close`
3. `ad_update_model_memory_limit`
4. `POST _ml/anomaly_detectors/{job_id}/_open`
5. `ad_manage_datafeed` with `_start`

**Constraint:** Cannot decrease below current `model_bytes`. To shrink, clone the job with a lower limit.

---

## Model Snapshots

### `ad_revert_model_snapshot`

Revert a job's model to a previous snapshot to "unlearn" bad data.

| Parameter     | Type   | Required | Description                                                  |
| ------------- | ------ | -------- | ------------------------------------------------------------ |
| `job_id`      | string | yes      | The anomaly detection job ID                                 |
| `snapshot_id` | string | yes      | The snapshot ID to revert to (from `ad_get_model_snapshots`) |

**API call:**

```text
POST _ml/anomaly_detectors/{job_id}/model_snapshots/{snapshot_id}/_revert
```

**Prerequisites:** Job must be closed before reverting.

**Post-revert steps:**

1. Reopen the job: `POST _ml/anomaly_detectors/{job_id}/_open`
2. Restart datafeed from the snapshot timestamp to reprocess data (prevents gap in analysis)

**When to use:** When bad/anomalous training data has corrupted the model — e.g., a 2-week outage that the model
"learned" as normal. Revert to a snapshot from before the bad data, then reprocess.

---

## Calendar Management

### `ad_get_calendar_events`

Retrieve scheduled events from a calendar.

| Parameter     | Type   | Required | Description     |
| ------------- | ------ | -------- | --------------- |
| `calendar_id` | string | yes      | The calendar ID |

**API call:**

```text
GET _ml/calendars/{calendar_id}/events
```

**Returns:** List of events with `description`, `start_time`, `end_time`.

**When to use:** Before adding a new event, verify what's already scheduled. Also use to audit whether a score anomaly
was suppressed by an existing calendar event.

---

### `ad_create_calendar_event`

Add a scheduled event to suppress false positives during known downtime.

| Parameter     | Type   | Required | Description                                                    |
| ------------- | ------ | -------- | -------------------------------------------------------------- |
| `calendar_id` | string | yes      | The calendar ID (must already exist)                           |
| `description` | string | yes      | Human-readable description, e.g., `Planned maintenance window` |
| `start_time`  | string | yes      | ISO 8601 or epoch_millis                                       |
| `end_time`    | string | yes      | ISO 8601 or epoch_millis                                       |

**API call:**

```text
POST _ml/calendars/{calendar_id}/events
Body: {"events": [{"description": "...", "start_time": "...", "end_time": "..."}]}
```

**Effect:** During the event window, the ML model does not produce anomaly results — it continues learning but
suppresses output. Results resume normally after the window ends.

**When to use:** Planned maintenance, deployments, known data pipeline downtime, holidays with predictable traffic
changes.

---

## Job Creation

Workflows `ad_validate_job_spec`, `ad_create_job`, and `ad_create_datafeed` accept JSON **text** inputs (`job_body`,
`datafeed_body`). Each step uses Liquid `json_parse` with typed `${{ }}` interpolation so Elasticsearch receives a
structured JSON object in the HTTP body, not a JSON value that is itself a quoted string.

### `ad_validate_job_spec`

Validate a job configuration before create.

| Parameter  | Type   | Required | Description                                                                 |
| ---------- | ------ | -------- | --------------------------------------------------------------------------- |
| `job_body` | string | yes      | Full job JSON text (PUT create shape); parsed to an object in the workflow. |

**API call:**

```text
POST _ml/anomaly_detectors/_validate
Body: {full job configuration JSON document}
```

### `ad_create_job`

Create a new anomaly detection job from a configuration.

| Parameter  | Type   | Required | Description                                              |
| ---------- | ------ | -------- | -------------------------------------------------------- |
| `job_id`   | string | yes      | The new job ID to create                                 |
| `job_body` | string | yes      | Full job JSON text; parsed to an object in the workflow. |

**API call:**

```text
PUT _ml/anomaly_detectors/{job_id}
Body: {full job configuration JSON document}
```

**When to use:** Advanced scenario — when the agent has explored the data and designed a job configuration. Requires a
complete `analysis_config` including detectors and `data_description`; create the datafeed with `ad_create_datafeed`
before open/start.

### `ad_create_datafeed`

Create or replace a datafeed.

| Parameter       | Type   | Required | Description                                                   |
| --------------- | ------ | -------- | ------------------------------------------------------------- |
| `datafeed_id`   | string | yes      | Typically `datafeed-{job_id}`                                 |
| `datafeed_body` | string | yes      | Full datafeed JSON text; parsed to an object in the workflow. |

**API call:**

```text
PUT _ml/datafeeds/{datafeed_id}
Body: {full datafeed configuration JSON document}
```

### `ad_open_job`

Open a job after configuration exists.

| Parameter | Type   | Required | Description    |
| --------- | ------ | -------- | -------------- |
| `job_id`  | string | yes      | Job ID to open |

**API call:**

```text
POST _ml/anomaly_detectors/{job_id}/_open
```

---

## Permissions & Diagnostics

### `ad_validate_ml_tool_permissions`

Preflight check for core `.ml-*` indices used by packaged tools (see workflow YAML for exact `_has_privileges` payload).
Does **not** cover job-specific source indices — validate those separately.

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| _(none)_  | —    | —        | —           |

**API calls:**

```text
GET _security/_authenticate                    ← identify current user/API key
POST _security/user/_has_privileges            ← check index permissions
Body: {
  "index": [
    {"names": [".ml-anomalies-*"], "privileges": ["read", "view_index_metadata"]},
    {"names": [".ml-config"], "privileges": ["read", "view_index_metadata"]},
    {"names": [".ml-annotations-*"], "privileges": ["read", "view_index_metadata"]},
    {"names": [".ml-notifications-*"], "privileges": ["read", "view_index_metadata"]}
  ]
}
```

**Returns:** Current identity and a boolean per index/privilege combination.

**When to use:** Early sanity check for `.ml-*` access; still verify source index privileges before datafeed preview or
evidence queries.

---

### `ad_ts_ccs_diagnostics`

Diagnose cross-cluster search (CCS) issues for datafeeds querying remote clusters.

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| _(none)_  | —    | —        | —           |

**API calls:**

```text
GET _remote/info          ← list configured remote clusters and connection status
GET _cluster/health       ← check local cluster health
```

**Returns:** Remote cluster connectivity status (connected/disconnected), latency, and error rates.

**When to use:** When datafeed source indices use CCS patterns (e.g., `remote1:logs-*`) and the job reports missing
documents or delayed data that can't be explained by local ingest latency.

---

## Troubleshooting Workflows (Decision Trees)

### `ad_wf_troubleshoot_anomaly_score`

Branching decision tree for unexpectedly high or low anomaly scores.

| Parameter          | Type   | Required | Description                                               |
| ------------------ | ------ | -------- | --------------------------------------------------------- |
| `job_id`           | string | yes      | The anomaly detection job ID                              |
| `record_timestamp` | string | no       | ISO 8601 timestamp of the specific anomaly to investigate |
| `entity_value`     | string | no       | Entity value to focus investigation on                    |

**Decision tree steps:**

1. **Gate checks**: sufficient training data? memory status ok? delayed data present?
2. **Score comparison**: compare `record_score` vs `initial_record_score` — large gap = renormalization
3. **Job config analysis**: `bucket_span`, detector function, `custom_rules`, `use_null`
4. **Model learning**: model plot (wide bounds = high variance), score reassessment for drift
5. **Score factor education**: explain each `anomaly_score_explanation` component

**Trigger phrases:** "Why is my score low?", "Expected anomaly not detected", "Score too high"

---

### `ad_wf_troubleshoot_memory_limit`

Branching decision tree for `soft_limit` / `hard_limit` memory issues.

| Parameter | Type   | Required | Description                                  |
| --------- | ------ | -------- | -------------------------------------------- |
| `job_id`  | string | yes      | The anomaly detection job ID to troubleshoot |

**Decision tree steps:**

1. **Memory status**: `model_bytes`, limit, `memory_status`, entity counts, allocation failures
2. **False alarm check**: if `hard_limit`, check for missing-doc warnings that are symptoms of memory (not ingest lag)
3. **Growth trend**: classify as stable plateau / linear growth / exponential growth
4. **Threshold inspection**: `total_by_field_count > 100K`? `total_partition_field_count > 10K`? Identify which field
   drives memory.
5. **Principled estimate**: `ad_estimate_memory_requirement` — compare vs current limit vs actual usage
6. **CCS check**: if datafeed uses CCS, account for cross-cluster cardinality
7. **Recommendation**: increase limit / reduce data (filter datafeed, exclude datasets, reduce influencers) /
   restructure job

**Trigger phrases:** "My job hit memory limit", "hard_limit", "soft_limit"

---

### `ad_wf_troubleshoot_query_delay`

Branching decision tree for missing documents and query_delay warnings.

| Parameter | Type   | Required | Description                                  |
| --------- | ------ | -------- | -------------------------------------------- |
| `job_id`  | string | yes      | The anomaly detection job ID to troubleshoot |

**Decision tree steps:**

1. **Hard_limit false alarm**: if job has `categorization_field_name` AND `memory_status == hard_limit` → fix memory
   first (missing docs = symptom, not cause)
2. **Delayed data annotations**: frequency, severity, affected time ranges
3. **Bucket event gaps**: buckets with zero or abnormally low event counts
4. **Ingest latency measurement**: if `event.ingested` available, use it; otherwise use date_histogram comparison
   fallback
5. **Recommend `query_delay`**: P95 latency + buffer; trade-off: larger delay = slower alerts
6. **Additional remediation**: add ingest pipeline timestamp, consider `event.ingested` as `time_field`, revert model
   snapshot if catastrophically late data

**Trigger phrases:** "Missing documents", "Datafeed has missed X documents", "query_delay"
