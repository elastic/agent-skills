# Tool Reference — Elastic Anomaly Detection Agent Builder

## ES|QL Tools (24) — read-only, query `.ml-anomalies-*` and `.ml-config`

### Discovery & Metadata

| Tool                        | Description                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ad_get_available_metadata` | Discover all jobs, fields, functions, entity fields, bucket_spans. **Call first** when jobs are unknown. Returns a single summary row from `.ml-config`. |
| `ad_get_jobs`               | List all jobs with full config: bucket_span, detectors, field names, memory limit, groups, description.                                                  |
| `ad_discover_related_jobs`  | Find groups of jobs sharing `partition_field_name`, `by_field_name`, or `over_field_name`.                                                               |

### Anomaly Records & Influencers

| Tool                        | Params                                          | Description                                                                                |
| --------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ad_query_anomaly_records`  | job_id_pattern, min_score, start_time, end_time | Search anomaly records cross-job or scoped. Use `*` for overview, exact ID for drill-down. |
| `ad_query_anomaly_timeline` | job_id_pattern, start_time, end_time            | Bucket timeline / composite signal across jobs.                                            |
| `ad_query_influencers`      | job_id_pattern, min_score, start_time, end_time | Find most anomalous entities. Filter `job_count > 1` for cross-job shared influencers.     |

### RCA Tools

| Tool                            | Description                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ad_rca_multi_job_entities`     | Entities anomalous in multiple jobs (min_job_count=2). Prime root-cause signal.                                             |
| `ad_rca_cross_job_entity_match` | All jobs where a specific entity value appears anomalous right now. Returns per-job first_anomaly timestamp for chronology. |
| `ad_rca_detector_fingerprint`   | Detector-level incident fingerprint — what aspects of the system are anomalous (CPU? latency?).                             |
| `ad_rca_correlation`            | Temporal correlation / cascade. Sort by timestamp — earliest anomaly for the entity hints at root cause.                    |
| `ad_rca_blast_radius`           | Blast radius across jobs for an entity/time window.                                                                         |
| `ad_rca_entity_profile`         | Complete dossier on a suspect entity.                                                                                       |
| `ad_rca_source_evidence`        | Raw source documents from the original data index. Get index from `ad_get_job_datafeed_config`.                             |
| `ad_rca_score_reassessment`     | Score drift (`score_drift = initial_record_score - record_score`). Quantify renormalization.                                |

### Log Categorization

| Tool                              | Description                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ad_get_categories`               | Category definitions (terms, regex, examples) for categorization jobs.                                  |
| `ad_search_log_category_examples` | Log samples for a category in a time window. Run twice (baseline + anomaly) and compare variable parts. |

### Model Insight

| Tool                      | Description                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `ad_get_model_plot`       | Model upper/lower/median bounds over time. Most visual explanation for non-technical users.                     |
| `ad_get_forecast_results` | Forecast predictions with upper/lower bounds for capacity planning.                                             |
| `ad_get_model_snapshots`  | Available model snapshots for a job. Used before `ad_revert_model_snapshot`.                                    |
| `ad_get_job_messages`     | All notifications from `.ml-notifications-*`: datafeed warnings, delayed data, memory limits, lifecycle events. |

### Time-Series Diagnostics

| Tool                             | Params                                | Description                                                                                               |
| -------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ad_ts_model_memory_health`      | job_id, limit (1=snapshot, 500=trend) | Memory status time series: model_bytes, limit, memory_status, entity counts.                              |
| `ad_ts_ingest_latency_estimate`  | source_index, start_time, end_time    | P50/P95/P99 ingest latency. Requires `event.ingested` field. If P95 > query_delay → data will be lost.    |
| `ad_ts_bucket_event_gaps`        | job_id, start_time, end_time          | Buckets with zero or low event counts. Correlate with delayed data annotations.                           |
| `ad_ts_delayed_data_annotations` | job_id                                | All delayed data annotations from `.ml-annotations-*`. Starting point for missing-document investigation. |

---

## Workflow Tools (23 YAML files) — REST API + YAML, management and remediation

### Discovery & Config

| Tool                                 | Description                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `ad_discover_jobs_by_datafeed_index` | Jobs sharing datafeed source indices — strongest related-job signal. Iterates job's indices, queries `.ml-config`.  |
| `ad_get_job_datafeed_config`         | Full job + datafeed config: detectors, fields, bucket_span, query_delay, delayed_data_check_config, source indices. |

### Datafeed Operations

| Tool                               | Description                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `ad_manage_datafeed`               | Start or stop a datafeed (`_start` / `_stop`). Preview: `ad_preview_datafeed_with_latency`. |
| `ad_preview_datafeed_with_latency` | Preview datafeed source payload and measure effective latency before tuning query_delay.    |

### Config Updates

| Tool                                  | Description                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ad_update_datafeed_query_delay`      | Update `query_delay`. Stop datafeed first. Set to P95 ingest latency + buffer.                                          |
| `ad_update_delayed_data_check_config` | Enable/disable delayed data checks or adjust `check_window`.                                                            |
| `ad_update_model_memory_limit`        | Update `model_memory_limit`. Requires stop/close/update/open/start sequence. Cannot decrease below current model_bytes. |

### Sizing & Estimation

| Tool                             | Description                                                                                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ad_wf_ts_field_cardinality`     | ES                                                                                                                                                                            | QL `POST /_query`: COUNT_DISTINCT on a source split field; column name is spliced into the query (`?` params are literals only). Use values from job analysis config only. |
| `ad_estimate_memory_requirement` | Principled memory sizing: auto-samples cardinality from source data → calls Estimate Model Memory API. Better than `peak_model_bytes * 1.3` (ignores pure influencer memory). |

### Permissions & CCS

| Tool                              | Description                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ad_validate_ml_tool_permissions` | Preflight: read + view_index_metadata on `.ml-anomalies-*`, `.ml-config`, `.ml-annotations-*`, `.ml-notifications-*`. |
| `ad_ts_ccs_diagnostics`           | CCS diagnostics: remote cluster connectivity, latency, error rates for cross-cluster datafeeds.                       |

### Lifecycle & Recovery

| Tool                       | Description                                                    |
| -------------------------- | -------------------------------------------------------------- |
| `ad_revert_model_snapshot` | Revert to a previous model snapshot. Job must be closed first. |
| `ad_validate_job_spec`     | POST `/_ml/anomaly_detectors/_validate` — validate job JSON    |
| `ad_create_job`            | PUT `/_ml/anomaly_detectors/{job_id}` — create job             |
| `ad_create_datafeed`       | PUT `/_ml/datafeeds/{datafeed_id}` — create datafeed           |
| `ad_open_job`              | POST `/_ml/anomaly_detectors/{job_id}/_open`                   |

### Calendars

| Tool                       | Description                                                              |
| -------------------------- | ------------------------------------------------------------------------ |
| `ad_get_calendar_events`   | Get scheduled events from calendars (maintenance windows, holidays).     |
| `ad_create_calendar_event` | Add a scheduled event to suppress false positives during known downtime. |

### Stored Troubleshooting Workflows (decision trees from support runbooks)

| Tool                               | Trigger                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `ad_wf_troubleshoot_anomaly_score` | "Why is my score low?", "Expected anomaly not detected", "Score too high/low" |
| `ad_wf_troubleshoot_query_delay`   | "My job reports missing documents", "Datafeed has missed X documents"         |
| `ad_wf_troubleshoot_memory_limit`  | "My job hit memory limit", "hard_limit", "soft_limit"                         |

---

## Key System Indices

| Index                 | `result_type` values                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `.ml-anomalies-*`     | `bucket`, `record`, `influencer`, `model_size_stats`, `model_plot`, `model_forecast`, `model_snapshot`, `category_definition` |
| `.ml-annotations-*`   | delayed data (`event == "delayed_data"`)                                                                                      |
| `.ml-notifications-*` | job messages (datafeed warnings, memory limits, lifecycle)                                                                    |
| `.ml-config`          | job/datafeed documents (used for discovery — all jobs visible, even never-run)                                                |

## Registration

Requires Node.js 18+. Defaults to `elastic`/`changeme` when no credentials supplied.

```bash
cd skills/kibana/kibana-anomaly-detection
node scripts/kibana-agent-builder.mjs all register --kibana-url http://localhost:5601
```

Workflow tools are skipped automatically until Elastic Workflows (preview) is enabled. Configure exclusions in
`scripts/agent_builder_constants.json`.
