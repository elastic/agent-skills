# Permissions Matrix

Maps each tool to the Elasticsearch and Kibana privileges it requires.

Run `ad_validate_ml_tool_permissions` as a preflight check on core `.ml-*` indices (see workflow description). Confirm
**source data index** privileges separately before previews, `ad_wf_ts_field_cardinality`, or `ad_rca_source_evidence`.

---

## Required Index Privileges

| Index                 | Privilege             | Purpose                                                                       |
| --------------------- | --------------------- | ----------------------------------------------------------------------------- |
| `.ml-anomalies-*`     | `read`                | Query anomaly records, buckets, influencers, category definitions             |
| `.ml-anomalies-*`     | `view_index_metadata` | ESQL `FROM` and metadata access on anomaly indices                            |
| `.ml-config`          | `read`                | Query job and datafeed configurations                                         |
| `.ml-config`          | `view_index_metadata` | ESQL `FROM` against the config index                                          |
| `.ml-annotations-*`   | `read`                | Query delayed data annotations                                                |
| `.ml-annotations-*`   | `view_index_metadata` | ESQL `FROM` and metadata access on annotation indices                         |
| `.ml-notifications-*` | `read`                | Query job messages and notifications                                          |
| `.ml-notifications-*` | `view_index_metadata` | ESQL `FROM` and metadata access on notification indices                       |
| Source data indices   | `read`                | `ad_rca_source_evidence`, `ad_search_log_category_examples`, cardinality aggs |
| Source data indices   | `view_index_metadata` | ESQL `FROM` with `METADATA _index` on source data                             |

---

## Tool → Permission Matrix

### ES|QL Tools (Read-only)

| Tool                              | `.ml-anomalies-*` | `.ml-config`    | `.ml-annotations-*` | Source indices  |
| --------------------------------- | ----------------- | --------------- | ------------------- | --------------- |
| `ad_get_available_metadata`       | —                 | read + metadata | —                   | —               |
| `ad_get_jobs`                     | —                 | read + metadata | —                   | —               |
| `ad_discover_related_jobs`        | —                 | read + metadata | —                   | —               |
| `ad_query_anomaly_records`        | read + metadata   | —               | —                   | —               |
| `ad_query_anomaly_timeline`       | read + metadata   | —               | —                   | —               |
| `ad_query_influencers`            | read + metadata   | —               | —                   | —               |
| `ad_rca_multi_job_entities`       | read + metadata   | —               | —                   | —               |
| `ad_rca_cross_job_entity_match`   | read + metadata   | —               | —                   | —               |
| `ad_rca_detector_fingerprint`     | read + metadata   | —               | —                   | —               |
| `ad_rca_correlation`              | read + metadata   | —               | —                   | —               |
| `ad_rca_blast_radius`             | read + metadata   | —               | —                   | —               |
| `ad_rca_entity_profile`           | read + metadata   | —               | —                   | —               |
| `ad_rca_source_evidence`          | —                 | —               | —                   | read + metadata |
| `ad_rca_score_reassessment`       | read + metadata   | —               | —                   | —               |
| `ad_get_categories`               | read + metadata   | —               | —                   | —               |
| `ad_search_log_category_examples` | —                 | —               | —                   | read + metadata |
| `ad_get_job_messages`             | —                 | —               | —                   | —               |
| `ad_get_model_snapshots`          | read + metadata   | —               | —                   | —               |
| `ad_get_model_plot`               | read + metadata   | —               | —                   | —               |
| `ad_get_forecast_results`         | read + metadata   | —               | —                   | —               |
| `ad_ts_delayed_data_annotations`  | —                 | —               | read + metadata     | —               |
| `ad_ts_bucket_event_gaps`         | read + metadata   | —               | —                   | —               |
| `ad_ts_ingest_latency_estimate`   | —                 | —               | —                   | read            |
| `ad_ts_model_memory_health`       | read + metadata   | —               | —                   | —               |

### Workflow Tools

| Tool                                  | ML API privilege           | Source indices | Notes                                                           |
| ------------------------------------- | -------------------------- | -------------- | --------------------------------------------------------------- |
| `ad_get_job_datafeed_config`          | `monitor_ml`               | —              | Reads job config and stats                                      |
| `ad_discover_jobs_by_datafeed_index`  | `monitor_ml`               | —              | Reads job config + .ml-config search                            |
| `ad_manage_datafeed`                  | `manage_ml`                | —              | Start/stop requires write privilege                             |
| `ad_preview_datafeed_with_latency`    | `monitor_ml`               | read           | Preview requires source index read                              |
| `ad_update_datafeed_query_delay`      | `manage_ml`                | —              | Write operation                                                 |
| `ad_update_delayed_data_check_config` | `manage_ml`                | —              | Write operation                                                 |
| `ad_estimate_memory_requirement`      | `monitor_ml`               | read           | Cardinality aggs on source indices                              |
| `ad_wf_ts_field_cardinality`          | `monitor_ml`               | read           | POST /\_query COUNT_DISTINCT on source split field              |
| `ad_update_model_memory_limit`        | `manage_ml`                | —              | Write operation; job must be closed                             |
| `ad_revert_model_snapshot`            | `manage_ml`                | —              | Write operation; job must be closed                             |
| `ad_get_calendar_events`              | `monitor_ml`               | —              | —                                                               |
| `ad_create_calendar_event`            | `manage_ml`                | —              | Write operation                                                 |
| `ad_create_job`                       | `manage_ml`                | —              | Write operation                                                 |
| `ad_validate_ml_tool_permissions`     | `monitor` (cluster)        | —              | Uses `_security` API                                            |
| `ad_ts_ccs_diagnostics`               | `monitor` (cluster)        | —              | Uses `_remote/info`, `_cluster/health`                          |
| `ad_wf_troubleshoot_anomaly_score`    | `monitor_ml`               | —              | Read-only workflow                                              |
| `ad_wf_troubleshoot_memory_limit`     | `monitor_ml` + `manage_ml` | read           | Includes estimate (read) and optional update (write)            |
| `ad_wf_troubleshoot_query_delay`      | `monitor_ml` + `manage_ml` | read           | Includes latency measurement (read) and optional update (write) |

---

## Privilege Definitions

| Privilege                     | Scope   | What it allows                                                                         |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------- | ---------------------- |
| `read` (index)                | Index   | Search, GET, ES                                                                        | QL FROM                |
| `view_index_metadata` (index) | Index   | Required for ES                                                                        | QL FROM and field caps |
| `monitor_ml` (cluster)        | Cluster | GET job configs, stats, snapshots, calendar events                                     |
| `manage_ml` (cluster)         | Cluster | Create/update/delete jobs, datafeeds, calendars; start/stop datafeed; revert snapshots |
| `monitor` (cluster)           | Cluster | Cluster health, remote info, security authenticate                                     |

---

## Minimum Role for Read-only Investigation

```json
{
  "cluster": ["monitor_ml"],
  "indices": [
    {
      "names": [".ml-anomalies-*", ".ml-config", ".ml-annotations-*", ".ml-notifications-*"],
      "privileges": ["read", "view_index_metadata"]
    },
    {
      "names": ["<your-source-indices>"],
      "privileges": ["read", "view_index_metadata"]
    }
  ]
}
```

## Minimum Role for Full Remediation

```json
{
  "cluster": ["monitor_ml", "manage_ml", "monitor"],
  "indices": [
    {
      "names": [".ml-anomalies-*", ".ml-config", ".ml-annotations-*", ".ml-notifications-*"],
      "privileges": ["read", "view_index_metadata"]
    },
    {
      "names": ["<your-source-indices>"],
      "privileges": ["read", "view_index_metadata"]
    }
  ]
}
```

---

## Troubleshooting Permission Errors

| Symptom                                        | Likely missing privilege                       |
| ---------------------------------------------- | ---------------------------------------------- | ------------------------------------------ |
| ES                                             | QL FROM `.ml-anomalies-*` returns no results   | `view_index_metadata` on `.ml-anomalies-*` |
| `ad_rca_source_evidence` returns empty         | `read` on source data indices                  |
| Workflow tools return 403                      | `monitor_ml` or `manage_ml` cluster privilege  |
| `ad_validate_ml_tool_permissions` fails        | `monitor` cluster privilege                    |
| `ad_ts_delayed_data_annotations` returns empty | `read` on `.ml-annotations-*`                  |
| Job config missing from `ad_get_jobs`          | `read` + `view_index_metadata` on `.ml-config` |

Run `ad_validate_ml_tool_permissions` to get a definitive list of which specific privileges are missing.
