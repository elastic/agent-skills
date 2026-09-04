# Anomaly Detection API and concepts

## API paths

```json
PUT  /_ml/anomaly_detectors/<job_id>
POST /_ml/anomaly_detectors/<job_id>/_update
POST /_ml/anomaly_detectors/<job_id>/_open
POST /_ml/anomaly_detectors/<job_id>/_close
POST /_ml/anomaly_detectors/<job_id>/_flush
POST /_ml/anomaly_detectors/<job_id>/_reset
GET  /_ml/anomaly_detectors/<job_id>/_stats
DELETE /_ml/anomaly_detectors/<job_id>

PUT  /_ml/datafeeds/datafeed-<job_id>
POST /_ml/datafeeds/datafeed-<job_id>/_update
POST /_ml/datafeeds/datafeed-<job_id>/_start
POST /_ml/datafeeds/datafeed-<job_id>/_stop
GET  /_ml/datafeeds/datafeed-<job_id>/_stats
GET  /_ml/datafeeds/datafeed-<job_id>/_preview
DELETE /_ml/datafeeds/datafeed-<job_id>

GET  /_ml/anomaly_detectors/<job_id>/results/buckets
GET  /_ml/anomaly_detectors/<job_id>/results/records
GET  /_ml/anomaly_detectors/<job_id>/results/influencers
POST /_ml/anomaly_detectors/<job_id>/results/overall_buckets

GET  /_ml/anomaly_detectors/<job_id>/model_snapshots
POST /_ml/anomaly_detectors/<job_id>/model_snapshots/<snap_id>/_revert

PUT  /_ml/filters/<filter_id>
PUT  /_ml/calendars/<calendar_id>
POST /_ml/calendars/<calendar_id>/events
```

## Anomaly Scores

- **record_score** (0-100): Severity of a single anomaly record. >75 = critical, 50-75 = warning, 25-50 = minor, <25 =
  informational.
- **anomaly_score** (bucket-level): Overall severity for a time bucket across all detectors in a job.
- **influencer_score**: How unusual an entity is within a time bucket. Entities appearing across multiple jobs with high
  scores are strong root-cause candidates.
- **initial_record_score** vs **record_score**: If initial >> current, the model renormalized the anomaly downward after
  seeing more data. Use initial_record_score for alerting on fresh anomalies.
- **multi_bucket_impact**: Positive values (0-5) indicate sustained anomalies spanning multiple buckets. Values >= 3
  suggest a genuine behavioral shift, not a transient spike.

## Key Concepts

- **Influencers**: Entities (hosts, users, services, IPs) that contribute to anomalies. Cross-job shared influencers are
  the strongest RCA signal.
- **by_field**: Splits analysis into independent baselines per entity (e.g., per-user, per-host).
- **over_field**: Population analysis — compares each entity against its peer group.
- **partition_field**: Splits the model into independent partitions (e.g., per-datacenter).

## Job state machine

```text
closed → opening → opened → closing → closed
                  ↘ failed → closed  (requires ?force=true on _close)
```

Stop the datafeed before closing the job. Close the job before resetting or reverting a snapshot.

## Immutable after job creation

These cannot be changed with `_update` — changing them requires deleting and recreating the job:

- `analysis_config.bucket_span`
- `analysis_config.detectors` (add or remove)
- `data_description.time_field`
- `results_index_name`

## Non-obvious field interactions

**`bucket_span`** — Choose based on the granularity of anomalies the user cares about, not on data frequency. Too short
→ noisy; too long → slow to detect.

**`by_field_name` vs `over_field_name` vs `partition_field_name`**

- `by_field_name` — separate model per value; detects deviation from each value's own history.
- `over_field_name` — one shared population model; detects individuals that deviate from their peers. Use this for "who
  is the outlier right now" questions.
- `partition_field_name` — fully isolated model per value; higher memory cost than `by_field_name`. Use only when
  partitions are genuinely independent (for example, separate tenants).

**`query_delay` vs `latency`**

- `query_delay` (datafeed) — how far behind real time the datafeed searches. Increase when source data arrives late.
- `latency` (job `analysis_config`) — buffer for out-of-order records within the job. Adds processing lag equal to its
  value.

**`summary_count_field_name`** — Required in `analysis_config` whenever the datafeed uses aggregations. Must match the
field in the aggregation output that holds the document count.

## Renormalization

Elasticsearch continuously renormalizes scores relative to the most extreme anomaly ever seen by the job. A score of 90
today might become 60 next week if a more extreme anomaly appears. This is by design — it ensures the "worst ever" event
always scores near 100.

## multi_bucket_impact

Positive values (0-5) indicate an anomaly that spans multiple consecutive buckets. Values >= 3 suggest a genuine
sustained behavioral shift rather than a transient spike. A single-bucket anomaly with no multi_bucket_impact is likely
a one-off event.

## Indices

| Index                           | Contents                                                     | Queryable                                              |
| ------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| `.ml-anomalies-shared`          | Default results (buckets, records, influencers) for all jobs | Yes — filter by `job_id` and `result_type`             |
| `.ml-anomalies-custom-<suffix>` | Results when `results_index_name` is set on the job          | Yes — same approach                                    |
| `.ml-state-*`                   | Model state and snapshots                                    | No — internal only; use the snapshots API              |
| `.ml-stats-*`                   | Job and datafeed stats history                               | Yes — read-only; prefer `_stats` API for current state |
| `.ml-notifications-*`           | Audit log: job lifecycle events, errors, warnings            | Yes — useful for diagnosing silent failures            |
| `.ml-config`                    | Job and datafeed definitions (internal store)                | No — internal only; use the ML REST API                |
| `.ml-annotations-*`             | User and system annotations on anomaly charts                | Yes — read-only; filter by `job_id` and `type`         |

## Further reading

Full field documentation if fetch is available:

- Job: `https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-ml-put-job`
- Datafeed: `https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-ml-put-datafeed`
- Detector functions: `https://www.elastic.co/guide/en/machine-learning/current/ml-functions.html`
