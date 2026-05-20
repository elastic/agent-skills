# Investigate mode — ES|QL tool reference

Supporting detail for the **Investigate** mode of the parent [SKILL.md](../SKILL.md). Use these templates with Kibana
Agent Builder ES|QL tools.

## ES|QL Tools (15)

### Discovery & Metadata

### `ad_get_available_metadata`

Discover all jobs and their configured metadata. **Call first** when jobs are unknown.

```esql
FROM .ml-config
| WHERE job_type == "anomaly_detector"
| STATS job_count = COUNT(*),
        job_ids = VALUES(job_id),
        functions = VALUES(`analysis_config.detectors.function`),
        fields = VALUES(`analysis_config.detectors.field_name`),
        by_fields = VALUES(`analysis_config.detectors.by_field_name`),
        over_fields = VALUES(`analysis_config.detectors.over_field_name`),
        partition_fields = VALUES(`analysis_config.detectors.partition_field_name`),
        influencers = VALUES(`analysis_config.influencers`),
        bucket_spans = VALUES(`analysis_config.bucket_span`)
```

_No parameters._

---

### `ad_get_jobs`

List all jobs with full config: bucket_span, detector functions, field names, memory limit.

```esql
FROM .ml-config
| WHERE job_type == "anomaly_detector"
| KEEP job_id, `analysis_config.bucket_span`, `analysis_config.detectors.function`,
       `analysis_config.detectors.field_name`, `analysis_config.detectors.partition_field_name`,
       `analysis_config.detectors.by_field_name`, `analysis_config.detectors.over_field_name`,
       `analysis_config.influencers`, `analysis_limits.model_memory_limit`, groups, description
| SORT job_id ASC | LIMIT 100
```

_No parameters._

---

### `ad_discover_related_jobs`

Find jobs sharing the same entity field name (partition/by/over). Call early even when job names differ completely.

| Parameter | Type | Description         |
| --------- | ---- | ------------------- |
| `job_id`  | text | The job of interest |

```esql
FROM .ml-config
| WHERE job_type == "anomaly_detector"
| EVAL entity_field = COALESCE(`analysis_config.detectors.partition_field_name`,
                                `analysis_config.detectors.by_field_name`,
                                `analysis_config.detectors.over_field_name`)
| MV_EXPAND entity_field
| WHERE entity_field IS NOT NULL
| STATS job_count = COUNT_DISTINCT(job_id), jobs = VALUES(job_id),
        influencers = VALUES(`analysis_config.influencers`) BY entity_field
| WHERE MV_CONTAINS(jobs, ?job_id)
| SORT job_count DESC | LIMIT 50
```

---

### Anomaly Records & Influencers

### `ad_query_anomaly_records`

Primary anomaly search. Cross-job with `*` or single-job with exact ID.

| Parameter        | Type   | Description                                                         |
| ---------------- | ------ | ------------------------------------------------------------------- |
| `job_id_pattern` | text   | LIKE wildcards: `*` all, `rcaeval-*` group, exact ID for drill-down |
| `min_score`      | double | 50 significant · 25 broad · 75 critical                             |
| `start_time`     | text   | ISO 8601                                                            |
| `end_time`       | text   | ISO 8601                                                            |

```esql
FROM .ml-anomalies-*
| WHERE result_type == "record"
  AND job_id LIKE ?job_id_pattern
  AND record_score >= ?min_score
  AND timestamp >= ?start_time AND timestamp <= ?end_time
| SORT record_score DESC | LIMIT 50
| KEEP job_id, timestamp, record_score, function, field_name, actual, typical,
       by_field_name, by_field_value, over_field_name, over_field_value,
       partition_field_name, partition_field_value,
       multi_bucket_impact, initial_record_score, detector_index, probability
```

---

### `ad_query_anomaly_timeline`

Cross-job bucket timeline. Composite scores reveal coordinated events (5 jobs × 30 = composite 150).

| Parameter        | Type   | Description                         |
| ---------------- | ------ | ----------------------------------- |
| `job_id_pattern` | text   | LIKE wildcards                      |
| `min_score`      | double | 25 for signal boosting, 50 standard |
| `start_time`     | text   | ISO 8601                            |
| `end_time`       | text   | ISO 8601                            |

```esql
FROM .ml-anomalies-*
| WHERE result_type == "bucket"
  AND job_id LIKE ?job_id_pattern
  AND anomaly_score >= ?min_score
  AND timestamp >= ?start_time AND timestamp <= ?end_time
| STATS max_score = MAX(anomaly_score), job_count = COUNT_DISTINCT(job_id),
        jobs = VALUES(job_id), composite_score = SUM(anomaly_score),
        avg_score = AVG(anomaly_score) BY timestamp
| SORT timestamp
```

---

### `ad_query_influencers`

Most anomalous entities. `job_count > 1` filter = cross-job shared influencers = strongest RCA signal.

| Parameter        | Type   | Description                        |
| ---------------- | ------ | ---------------------------------- |
| `job_id_pattern` | text   | LIKE wildcards                     |
| `min_score`      | double | 25 for shared influencer discovery |
| `start_time`     | text   | ISO 8601                           |
| `end_time`       | text   | ISO 8601                           |

```esql
FROM .ml-anomalies-*
| WHERE result_type == "influencer"
  AND job_id LIKE ?job_id_pattern
  AND influencer_score >= ?min_score
  AND timestamp >= ?start_time AND timestamp <= ?end_time
| STATS total_score = SUM(influencer_score), job_count = COUNT_DISTINCT(job_id),
        jobs = VALUES(job_id), max_score = MAX(influencer_score)
  BY influencer_field_name, influencer_field_value
| SORT total_score DESC | LIMIT 30
```

---

### RCA Tools

### `ad_rca_multi_job_entities`

**Strongest root cause signal.** Entities anomalous in 2+ jobs simultaneously. Resource faults → multi-job; network
faults → single-job.

| Parameter       | Type   | Description               |
| --------------- | ------ | ------------------------- |
| `min_score`     | double | 25 broad · 50 significant |
| `min_job_count` | double | Use 2 for cross-job RCA   |
| `start_time`    | text   | ISO 8601                  |
| `end_time`      | text   | ISO 8601                  |

```esql
FROM .ml-anomalies-*
| WHERE result_type == "record"
  AND record_score >= ?min_score
  AND timestamp >= ?start_time AND timestamp <= ?end_time
| STATS job_count = COUNT_DISTINCT(job_id), jobs = VALUES(job_id),
        max_score = MAX(record_score), total_records = COUNT(*),
        functions = VALUES(function), fields = VALUES(field_name)
  BY partition_field_value
| WHERE job_count >= ?min_job_count
| SORT job_count DESC, max_score DESC | LIMIT 20
```

---

### `ad_rca_cross_job_entity_match`

From an alert's entity value, find ALL jobs where it's anomalous. Returns `first_anomaly` per job for chronology
reconstruction.

| Parameter      | Type   | Description                                |
| -------------- | ------ | ------------------------------------------ |
| `entity_value` | text   | From alert's partition/by/over field value |
| `min_score`    | double | 10–25 for comprehensive search             |
| `start_time`   | text   | Wider than alert window (alert minus 6h)   |
| `end_time`     | text   | Alert plus 1–2h to catch delayed effects   |

```esql
FROM .ml-anomalies-*
| WHERE result_type == "record"
  AND record_score >= ?min_score
  AND timestamp >= ?start_time AND timestamp <= ?end_time
  AND (partition_field_value == ?entity_value
       OR by_field_value == ?entity_value
       OR over_field_value == ?entity_value)
| STATS max_score = MAX(record_score), anomaly_count = COUNT(*),
        functions = VALUES(function), fields = VALUES(field_name),
        first_anomaly = MIN(timestamp), last_anomaly = MAX(timestamp)
  BY job_id
| SORT max_score DESC
```

---

### `ad_rca_detector_fingerprint`

Incident fingerprint — which system aspects are anomalous (CPU? Latency? Error rate?).

| Parameter        | Type   | Description          |
| ---------------- | ------ | -------------------- |
| `job_id_pattern` | text   | LIKE wildcards       |
| `min_score`      | double | Minimum record_score |
| `start_time`     | text   | ISO 8601             |
| `end_time`       | text   | ISO 8601             |

```esql
FROM .ml-anomalies-*
| WHERE result_type == "record"
  AND job_id LIKE ?job_id_pattern
  AND record_score >= ?min_score
  AND timestamp >= ?start_time AND timestamp <= ?end_time
| STATS count = COUNT(*), max_score = MAX(record_score), avg_score = AVG(record_score)
  BY job_id, function, field_name, detector_index
| SORT max_score DESC
```

---

### `ad_rca_correlation`

Temporally ordered anomalies for cascade analysis. Earliest anomaly for an entity → root cause direction.

| Parameter        | Type   | Description                             |
| ---------------- | ------ | --------------------------------------- |
| `job_id_pattern` | text   | LIKE wildcards (scope to related group) |
| `min_score`      | double | Minimum record_score                    |
| `start_time`     | text   | ISO 8601                                |
| `end_time`       | text   | ISO 8601                                |

```esql
FROM .ml-anomalies-*
| WHERE result_type == "record"
  AND job_id LIKE ?job_id_pattern
  AND record_score >= ?min_score
  AND timestamp >= ?start_time AND timestamp <= ?end_time
| SORT timestamp ASC
| KEEP job_id, timestamp, record_score, function, field_name,
       by_field_name, by_field_value, partition_field_name, partition_field_value,
       over_field_name, over_field_value, multi_bucket_impact
| LIMIT 100
```

---

### `ad_rca_blast_radius`

Scope of impact — how many partitions/jobs are affected by a specific anomalous value.

| Parameter         | Type   | Description                             |
| ----------------- | ------ | --------------------------------------- |
| `anomalous_value` | text   | e.g. `node-backdoor`, `payment-service` |
| `min_score`       | double | 10–25 for weak-signal aggregation       |
| `start_time`      | text   | ISO 8601                                |
| `end_time`        | text   | ISO 8601                                |

```esql
FROM .ml-anomalies-*
| WHERE result_type == "record"
  AND record_score >= ?min_score
  AND timestamp >= ?start_time AND timestamp <= ?end_time
  AND (by_field_value == ?anomalous_value
       OR over_field_value == ?anomalous_value
       OR partition_field_value == ?anomalous_value)
| STATS affected_partitions = COUNT_DISTINCT(partition_field_value),
        affected_jobs = COUNT_DISTINCT(job_id), total_anomalies = COUNT(*),
        max_score = MAX(record_score),
        time_span_hours = DATE_DIFF("hour", MIN(timestamp), MAX(timestamp))
  BY by_field_value
| SORT affected_partitions DESC
```

---

### `ad_rca_entity_profile`

Complete anomaly dossier for a suspect entity across ALL jobs and field types.

| Parameter      | Type | Description                         |
| -------------- | ---- | ----------------------------------- |
| `entity_value` | text | e.g. `server-01`, `payment-service` |
| `start_time`   | text | ISO 8601                            |
| `end_time`     | text | ISO 8601                            |

```esql
FROM .ml-anomalies-*
| WHERE result_type == "record"
  AND timestamp >= ?start_time AND timestamp <= ?end_time
  AND (by_field_value == ?entity_value
       OR over_field_value == ?entity_value
       OR partition_field_value == ?entity_value)
| SORT timestamp ASC | LIMIT 100
| KEEP job_id, timestamp, record_score, function, field_name,
       by_field_name, by_field_value, over_field_name, over_field_value,
       partition_field_name, partition_field_value, actual, typical, multi_bucket_impact
```

---

### `ad_rca_source_evidence`

Raw source documents from the original data index. Get source index from `ad_get_job_datafeed_config` first.

| Parameter      | Type | Description                                                              |
| -------------- | ---- | ------------------------------------------------------------------------ |
| `source_index` | text | LIKE pattern from datafeed config (e.g. `rcaeval-re1-ob`, `otel-flat-*`) |
| `start_time`   | text | ISO 8601                                                                 |
| `end_time`     | text | ISO 8601                                                                 |

```esql
FROM * METADATA _index
| WHERE _index LIKE ?source_index
  AND @timestamp >= ?start_time AND @timestamp <= ?end_time
| SORT @timestamp DESC | LIMIT 50
```

---

### Log Categorization (when `by_field_name == "mlcategory"`)

### `ad_get_categories`

Category definitions (terms, regex, examples) for jobs with `categorization_field_name`.

| Parameter | Type | Description                  |
| --------- | ---- | ---------------------------- |
| `job_id`  | text | The anomaly detection job ID |

```esql
FROM .ml-anomalies-*
| WHERE result_type == "category_definition" AND job_id == ?job_id
| SORT category_id ASC
| KEEP job_id, category_id, terms, regex, max_matching_length, examples
| LIMIT 100
```

---

### `ad_search_log_category_examples`

Raw log samples for two-window comparison (baseline vs anomaly window). Compare variable parts — IPs, hostnames, error
codes — to find what changed.

| Parameter      | Type | Description                             |
| -------------- | ---- | --------------------------------------- |
| `source_index` | text | LIKE pattern from datafeed config       |
| `start_time`   | text | ISO 8601 (baseline: 24h before anomaly) |
| `end_time`     | text | ISO 8601                                |

```esql
FROM * METADATA _index
| WHERE _index LIKE ?source_index
  AND @timestamp >= ?start_time AND @timestamp <= ?end_time
| SORT @timestamp DESC | LIMIT 50
```

---
