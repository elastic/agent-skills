---
name: kibana-anomaly-detection
description: >
  Elastic ML anomaly detection — investigation/RCA, score explanation, job lifecycle
  troubleshooting, and job operations. Use when answering "what broke?"/"which entity?"/RCA,
  "why is score high/low?"/renormalization, "datafeed stopped"/"memory limit"/hard_limit,
  or configuring ML anomaly detection jobs. Reads results from `.ml-anomalies-*` and
  job state from ML REST APIs.
metadata:
  author: elastic
  version: 0.3.0
  universal: true
compatibility: Elasticsearch 8.x–9.x or Elastic Cloud Serverless with ML anomaly detection;
  Kibana 8.x–9.x for saved-object context only
---

# Elastic ML Anomaly Detection

Expert process for ML anomaly detection: attribute incidents to entities, explain scores and model behavior, diagnose
job lifecycle failures, and manage jobs. Read anomaly **results** from `POST /.ml-anomalies-*/_search` (Serverless-safe)
and **job/datafeed state** from ML REST APIs. When the user embeds fixture evidence (influencer rows, job stats) in the
prompt, apply the judgment below directly — do not re-fetch fields already supplied.

<!-- begin-partial: preamble -->

## Environment Configuration

This skill executes Elasticsearch operations through the `elastic` CLI. If the
[`elastic` CLI](https://github.com/elastic/cli#configuration) is not installed, tell the user what it is needed for. Do
not guess credentials, call the HTTP API directly, or attempt other workarounds.

This skill references operations in HTTP-shorthand form (e.g., `GET /`, `GET /_cat/indices`, `GET /{index}/_mapping`,
`GET /{index}/_settings/index.mode`, `POST /_query`). The [Operations](#operations) table at the end of this document
maps each shorthand to the equivalent `elastic` CLI command — always use the CLI rather than calling the HTTP API
directly.

<!-- end-partial: preamble -->

## Mode selector

| User intent                                                                   | Mode                                                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| "What broke?" / RCA / cross-job / blast radius / influencers / log categories | **Investigate**                                                                                        |
| "Why score high/low?" / renormalization / model bounds / forecasts            | **Explain**                                                                                            |
| Missing docs / memory limit / datafeed stopped / lifecycle / calendars        | **Troubleshoot**                                                                                       |
| Create a job / configure a datafeed / start analysis / retrieve results       | **Manage**                                                                                             |
| Security framing (attack chains, MITRE, exfil)                                | Investigate + [references/security-anomaly-expert.md](references/security-anomaly-expert.md)           |
| Observability/SRE framing (degradation, capacity, deployment regression)      | Investigate + [references/observability-anomaly-expert.md](references/observability-anomaly-expert.md) |

When a question spans modes: **Investigate → Explain → Troubleshoot**. Finish one mode before blending logic.

> **Serverless note:** Legacy `/_ml/anomaly_detectors/{job_id}/results/*` endpoints return HTTP 410 in Serverless.
> Always query `.ml-anomalies-*` via `POST /.ml-anomalies-*/_search` with `result_type` filters.

## Score quick reference

- `record_score` bands: **>75** critical · **50–75** warning · **25–50** minor · **<25** informational
- `multi_bucket_impact ≥ 3` → sustained shift (not a transient spike)
- `initial_record_score >> record_score` → renormalization (model saw worse anomalies later)
- `actual << typical` with `count`/`low_count`/`low_mean` → absence/outage, not just a low value
- Low scores across many jobs > one high score — composite cross-job signal often beats single-detector severity

> Full score definitions, renormalization mechanics, and `anomaly_score_explanation` components:
> [references/score-reference.md](references/score-reference.md).

## Core concepts

Treat `.ml-anomalies-*` as layered result types via `result_type` in search queries:

| `result_type`         | Scope           | Key fields                                                                               |
| --------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| `bucket`              | Time window     | `anomaly_score`, `initial_anomaly_score`, `timestamp`                                    |
| `record`              | Detector row    | `record_score`, `initial_record_score`, `actual`, `typical`, `anomaly_score_explanation` |
| `influencer`          | Entity × bucket | `influencer_field_name`, `influencer_field_value`, **`influencer_score`**                |
| `model_plot`          | Bounds          | `model_lower`, `model_upper`, `actual`                                                   |
| `category_definition` | Log patterns    | `category_id`, `terms`, `regex`, `examples`                                              |

Read scores this way:

- `anomaly_score` / `record_score` = **current normalized** values (move as the model sees new extremes).
- `initial_anomaly_score` / `initial_record_score` = **immutable snapshots** from detection time.
- **`influencer_score` ranks entity responsibility within a bucket** — the highest score is the primary suspect, not the
  bucket-level `anomaly_score` alone.
- Map entities via `partition_field_value` / `by_field_value` / `over_field_value`.
- Read `multi_bucket_impact` (-5 to +5) to separate single-bucket spikes from sustained trends.

---

## Mode: Investigate — RCA

**When:** "what broke?", "which entity caused this?", cross-job correlation, blast radius, attack/cascade chains.

### Process

1. **Discover jobs.** Call `GET /_ml/anomaly_detectors` when the job ID is unknown. Call
   `GET /_ml/anomaly_detectors/{job_id}` and `GET /_ml/datafeeds/datafeed-{job_id}` to learn source indices, entity
   fields (`by_field_name`, `over_field_name`, `partition_field_name`), and `bucket_span`. The decision: identify the
   related job group — jobs sharing a datafeed index or entity field monitor the same system from different angles.

2. **Scope the incident window.** Call `POST /.ml-anomalies-*/_search` with `result_type: bucket`, a time range, and
   optional minimum `anomaly_score`. The decision: fix the incident start/end and count how many jobs co-fire in that
   window. Low scores across many jobs simultaneously often indicate a systemic root cause.

3. **Attribute to entities (critical for RCA).** For the anomalous bucket timestamp, call
   `POST /.ml-anomalies-*/_search` with `result_type: influencer`, the job ID(s), and the bucket time range. Sort by
   **`influencer_score` descending**. The decision: name the entity with the **highest `influencer_score`** as the
   likely cause — it ranks how unusual each entity is in that bucket. Do not restate only the bucket `anomaly_score`
   without attributing responsibility. Recommend drilling into that entity's records next.

4. **Cross-job confirmation.** Re-query influencers (or bucket records) across related job IDs for the same entity
   values and time window. Entities anomalous in **2+ jobs** are prime suspects (resource fault or systemic failure);
   single-job entities are often downstream victims. See
   [references/protocols/investigation.md](references/protocols/investigation.md).

5. **Drill into records.** Call `POST /.ml-anomalies-*/_search` with `result_type: record`, exact job ID, entity filters
   (`partition_field_value`, `by_field_value`), and low minimum `record_score` (25 or lower). Read
   `multi_bucket_impact ≥ 3` as sustained behavioral shift. Read `actual` vs `typical` for fault class (spike vs
   absence/outage).

6. **Confirm with source evidence.** Call `POST /{index}/_search` on the datafeed source index for the suspect entity
   and time window. Raw source documents are ground truth — never close an RCA without them.

7. **Synthesize.** Report: **root cause entity · affected jobs · temporal progression · fault class · severity ·
   recommended actions**. Worked walkthrough: [references/worked-example.md](references/worked-example.md). Query
   templates: [references/investigation-queries.md](references/investigation-queries.md).

### Rules

1. **Rank by `influencer_score`, not `anomaly_score`, for "which entity?"** — bucket score is aggregate; influencer
   score attributes cause.
2. **Multi-job entities are prime suspects; single-job entities are usually victims.**
3. **Earliest anomaly timestamp wins** — reconstruct chronology from record timestamps across jobs.
4. **`multi_bucket_impact ≥ 3` = sustained behavioral shift**, weight higher than transient spikes.
5. **Use low score thresholds (25 or lower) for influencer/record queries** — high thresholds miss correlated entities.
6. **Never close an RCA without source evidence** from the datafeed index.

---

## Mode: Explain — Score / model behavior

**When:** "why is my score 30/90?", "score dropped overnight", "what is renormalization?", "why wasn't this detected?".

### Process

1. **Decide fetch vs interpret.** If the user supplies a record with `record_score`, `initial_record_score`, `actual`,
   and `typical`, interpret directly. Otherwise load config with `GET /_ml/anomaly_detectors/{job_id}` and records with
   `POST /.ml-anomalies-*/_search` (`result_type: record`).

2. **Always show both `initial_record_score` and `record_score`.** The gap is the renormalization story. Large positive
   drift (`initial_record_score >> record_score`) means a later, more extreme anomaly rescale this record downward —
   expected healthy behavior, not a broken model.

3. **Classify the pattern before speculating.**

   | Pattern                                                      | Interpretation                                                    |
   | ------------------------------------------------------------ | ----------------------------------------------------------------- |
   | `initial_record_score >> record_score`                       | Renormalization — explain before suggesting config changes        |
   | `actual << typical` with `low_count`/`count`/`low_mean`      | Absence/outage anomaly — investigate the outage, not score tuning |
   | `high_variance_penalty: true` in `anomaly_score_explanation` | Noisy metric — wide bounds absorbed the spike                     |
   | `incomplete_bucket_penalty: true`                            | Ingest lag or sparse bucket — score legitimately reduced          |

   Only cite `anomaly_score_explanation` factors **present** in the record.

4. **Quantify renormalization (optional).** Re-query records sorted by `timestamp`; compute
   `score_drift = initial_record_score - record_score` and flag large drift.

5. **Add visual context when needed.** If `model_plot_config.enabled`, query `result_type: model_plot` and compare
   `actual` to `model_lower`/`model_upper`. For categorization jobs, query `result_type: category_definition`.

6. **Check job health when scores look wrong persistently.** Call `GET /_ml/anomaly_detectors/{job_id}/_stats` —
   `model_size_stats.memory_status` of `hard_limit` corrupts learning and can invalidate scores. Escalate to
   Troubleshoot mode.

### `anomaly_score_explanation` components

| Component                        | Effect  | What it means                                                |
| -------------------------------- | ------- | ------------------------------------------------------------ |
| `anomaly_length`                 | ↑ score | More consecutive anomalous buckets                           |
| `single_bucket_impact`           | ↑ score | Lower probability → higher impact                            |
| `multi_bucket_impact`            | ↑ score | Sustained pattern contribution                               |
| `anomaly_characteristics_impact` | ↑ score | Mean shift vs. variance change                               |
| `high_variance_penalty`          | ↓ score | Noisy data → wide bounds → anomaly less surprising           |
| `incomplete_bucket_penalty`      | ↓ score | Bucket has less data than expected (ingest lag, sparse data) |

### Rules

1. **Explain renormalization before diagnosing config** — score drift is the most common "score dropped" cause.
2. **`actual << typical` with count/low_count is an absence anomaly** — distinguish outages from value spikes.
3. **Weekly seasonality needs ≥3 weeks of training data** — flag young jobs as the cause.
4. **Detector function direction matters** — see
   [references/anomaly-detection-functions.md](references/anomaly-detection-functions.md).

---

## Mode: Troubleshoot — Job lifecycle

**When:** "missing documents", "datafeed stopped", **`hard_limit`**, "results look wrong", lifecycle changes.

### Process

1. **Load job and datafeed state.** Call `GET /_ml/anomaly_detectors/{job_id}/_stats` and
   `GET /_ml/datafeeds/datafeed-{job_id}/_stats`. Read `state`, `data_counts`, **`model_size_stats`**, and datafeed
   `state`. If the user embeds stats JSON, diagnose from `memory_status` and datafeed state directly.

2. **Diagnose memory status first (critical).** Inspect `model_size_stats`:

   | Field                      | Meaning                                                     |
   | -------------------------- | ----------------------------------------------------------- |
   | `memory_status`            | `ok` / `soft_limit` (pruning) / **`hard_limit` (critical)** |
   | `model_bytes`              | Current memory used                                         |
   | `model_bytes_memory_limit` | Configured `model_memory_limit`                             |

   When **`memory_status` is `hard_limit`** and `model_bytes` equals `model_bytes_memory_limit`, the model hit its
   memory ceiling — it stops learning new entities and results degrade or stop. A stopped datafeed is often a
   **symptom**, not the root cause. **Do not recommend only restarting the datafeed** — that alone does not clear a hard
   limit.

3. **Remediate hard_limit.** The fix is to **raise `model_memory_limit`** (via job update) **and/or reduce model size**
   by lowering cardinality (fewer partition/by/over field values, split into multiple jobs). Raising the limit requires
   the lifecycle sequence below (stop datafeed → close job → update → open → start). Optionally call
   `POST /_ml/anomaly_detectors/_estimate_model_memory` to size the new limit from source cardinality.

4. **Diagnose missing documents / query timing.** After memory is healthy, inspect datafeed `query_delay` and
   `delayed_data_check_config` via `GET /_ml/datafeeds/datafeed-{job_id}`. Search `.ml-annotations-*` for delayed-data
   events. Set `query_delay` to P95 ingest latency + buffer (default `60s`–`120s`).

5. **Read job messages.** Search `.ml-notifications-*` for the job ID when errors are unclear.

6. **Recover corrupted model state.** Call `POST /_ml/anomaly_detectors/{job_id}/model_snapshots/{snapshot_id}/_revert`
   to revert to a known-good snapshot when the model was corrupted during hard_limit.

### Lifecycle for config changes (memory limit, query_delay)

Apply in order — skipping steps causes rejected updates:

1. `POST /_ml/datafeeds/datafeed-{job_id}/_stop`
2. `POST /_ml/anomaly_detectors/{job_id}/_close`
3. `POST /_ml/anomaly_detectors/{job_id}/_update` (memory limit) and/or `POST /_ml/datafeeds/datafeed-{job_id}/_update`
   (query_delay)
4. `POST /_ml/anomaly_detectors/{job_id}/_open`
5. `POST /_ml/datafeeds/datafeed-{job_id}/_start`

Preview changes with `POST /_ml/datafeeds/datafeed-{job_id}/_preview` before restarting.

> **`hard_limit` corrupts model state** and causes downstream missing-doc false alarms. **Fix memory before fixing
> `query_delay`.** Full troubleshooting detail:
> [references/troubleshooting-reference.md](references/troubleshooting-reference.md).

### Rules

1. **Ground lifecycle diagnosis in `memory_status`** — not generic "restart it" advice.
2. **Fix memory before `query_delay`** — hard_limit invalidates downstream diagnostics.
3. **Stop datafeed → close job → update → open → start** for any memory or datafeed config change.
4. **Do not delete the job** as first remediation for hard_limit — raise limit and/or reduce cardinality.

---

## Mode: Manage — Create / configure jobs

**When:** "set up a job", "create an ML detector", "monitor X over time".

For the full create/open/start lifecycle, prefer the `elasticsearch-anomaly-detection` skill. This mode summarizes the
sequence and detector selection:

1. **Verify target index.** Call `GET /{index}/_mapping` — confirm time field and detector fields exist.
2. **Create job.** Call `PUT /_ml/anomaly_detectors/{job_id}` with `analysis_config` (detectors, `bucket_span`,
   influencers) and `data_description.time_field`.
3. **Create datafeed.** Call `PUT /_ml/datafeeds/datafeed-{job_id}` with `indices`, `query`, and `query_delay`.
4. **Open and start.** Call `POST /_ml/anomaly_detectors/{job_id}/_open`, then
   `POST /_ml/datafeeds/datafeed-{job_id}/_start`.
5. **Confirm.** Call `GET /_ml/anomaly_detectors/{job_id}/_stats` and `GET /_ml/datafeeds/datafeed-{job_id}/_stats`.

Choose detector functions from user intent — see
[references/anomaly-detection-functions.md](references/anomaly-detection-functions.md). Worked JSON bodies:
[references/job-creation-recipes.md](references/job-creation-recipes.md).

### Rules

1. **Create job before datafeed.** Open job before starting datafeed.
2. **`query_delay` = P95 ingest latency + buffer** (60s–120s safe default).
3. **`by_field_name` vs `over_field_name`:** `by` compares entity to its own history; `over` compares to peer group.
4. **Forecasts require non-population jobs** — jobs with `over_field_name` cannot be forecasted.

---

## Examples

**RCA:** "Something caused a spike in checkout latency — which entity?" → Query influencers for the bucket → **web-07**
has highest `influencer_score` (91.5) vs 22.0 and 8.4 → name web-07 as likely cause → recommend drilling into its
records — do not answer with only bucket `anomaly_score` 88.

**Score drop:** "Score went from 90 to 55 — did the model change?" → Compare `initial_record_score` vs `record_score` →
explain renormalization if drift is large.

**Memory limit:** "Job shows `hard_limit` and datafeed stopped." → Diagnose
`model_size_stats.memory_status = hard_limit` → raise `model_memory_limit` via close/update/open lifecycle and/or reduce
cardinality — **not** "just restart the datafeed".

**New job:** "Detect unusual error rates per host." → `high_count` with `by_field_name: host.keyword` →
create/open/start sequence.

---

## Guidelines

1. **Pick a mode first.** Don't blend RCA logic with score-explanation logic in one response.
2. **For "which entity?" rank `influencer_score`**, not bucket `anomaly_score`.
3. **For lifecycle failures read `memory_status`** before recommending datafeed restarts.
4. **Show `initial_record_score` alongside `record_score`** — the gap tells the renormalization story.
5. **Fix memory before `query_delay`.** Hard_limit invalidates downstream diagnostics.
6. **Confirm RCAs with source evidence** from the datafeed index.

## Operations

| HTTP API (shorthand)                                                         | `elastic` CLI command                                                                               |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /{index}/_mapping`                                                      | `elastic es indices get-mapping --index '<index>'`                                                  |
| `POST /{index}/_search`                                                      | `elastic es search --index '<index>' --input-file '<search-body.json>'`                             |
| `GET /_ml/anomaly_detectors`                                                 | `elastic es ml get-jobs`                                                                            |
| `GET /_ml/anomaly_detectors/{job_id}`                                        | `elastic es ml get-jobs --job-id '<job_id>'`                                                        |
| `GET /_ml/anomaly_detectors/{job_id}/_stats`                                 | `elastic es ml get-job-stats --job-id '<job_id>'`                                                   |
| `GET /_ml/datafeeds/datafeed-{job_id}`                                       | `elastic es ml get-datafeeds --datafeed-id 'datafeed-<job_id>'`                                     |
| `GET /_ml/datafeeds/datafeed-{job_id}/_stats`                                | `elastic es ml get-datafeed-stats --datafeed-id 'datafeed-<job_id>'`                                |
| `POST /.ml-anomalies-*/_search`                                              | `elastic es search --index '.ml-anomalies-*' --input-file '<search-body.json>'`                     |
| `POST /.ml-annotations-*/_search`                                            | `elastic es search --index '.ml-annotations-*' --input-file '<search-body.json>'`                   |
| `POST /.ml-notifications-*/_search`                                          | `elastic es search --index '.ml-notifications-*' --input-file '<search-body.json>'`                 |
| `POST /_ml/anomaly_detectors/_estimate_model_memory`                         | `elastic es ml estimate-model-memory --analysis-config '<json>'`                                    |
| `PUT /_ml/anomaly_detectors/{job_id}`                                        | `elastic es ml put-job --job-id '<job_id>' --input-file '<job-body.json>'`                          |
| `PUT /_ml/datafeeds/datafeed-{job_id}`                                       | `elastic es ml put-datafeed --datafeed-id 'datafeed-<job_id>' --input-file '<datafeed-body.json>'`  |
| `POST /_ml/anomaly_detectors/{job_id}/_open`                                 | `elastic es ml open-job --job-id '<job_id>'`                                                        |
| `POST /_ml/anomaly_detectors/{job_id}/_close`                                | `elastic es ml close-job --job-id '<job_id>'`                                                       |
| `POST /_ml/anomaly_detectors/{job_id}/_update`                               | `elastic es ml update-job --job-id '<job_id>' --analysis-limits '<json>'`                           |
| `POST /_ml/datafeeds/datafeed-{job_id}/_update`                              | `elastic es ml update-datafeed --datafeed-id 'datafeed-<job_id>' --input-file '<update-body.json>'` |
| `POST /_ml/datafeeds/datafeed-{job_id}/_start`                               | `elastic es ml start-datafeed --datafeed-id 'datafeed-<job_id>'`                                    |
| `POST /_ml/datafeeds/datafeed-{job_id}/_stop`                                | `elastic es ml stop-datafeed --datafeed-id 'datafeed-<job_id>'`                                     |
| `POST /_ml/datafeeds/datafeed-{job_id}/_preview`                             | `elastic es ml preview-datafeed --datafeed-id 'datafeed-<job_id>'`                                  |
| `POST /_ml/anomaly_detectors/{job_id}/model_snapshots/{snapshot_id}/_revert` | `elastic es ml revert-model-snapshot --job-id '<job_id>' --snapshot-id '<snapshot_id>'`             |

Search body shapes for each `result_type` and troubleshooting queries are documented in
[references/investigation-queries.md](references/investigation-queries.md) and
[references/troubleshooting-reference.md](references/troubleshooting-reference.md).
