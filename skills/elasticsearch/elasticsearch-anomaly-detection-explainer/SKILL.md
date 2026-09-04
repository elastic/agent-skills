---
name: elasticsearch-anomaly-detection-explainer
description: >
  Explain Elasticsearch ML anomaly detection scores, model behavior, and result interpretation.
  Use when the user asks why a score is high or low, how the model learns, what the
  numbers mean, or how to troubleshoot unexpected anomaly scores.
compatibility: >
  Requires Elasticsearch 8.x+ or Elastic Cloud Serverless with ML anomaly detection.
  Uses the ML REST API and the standard _search API against .ml-anomalies-* — no ES|QL.
  User needs monitor_ml privilege for ML APIs.
metadata:
  author: elastic
  version: 0.3.0
  universal: true
---

# Anomaly Detection Score Explainer

Explain anomaly scores, model behavior, and why results look the way they do. Use the **ML REST API** for job config and
the **standard `_search` API** against `.ml-anomalies-*` for results — no ES|QL, fully compatible with Elastic
Serverless. For job lifecycle (create, start, stop), use the `elasticsearch-anomaly-detection` skill.

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

> **Prerequisite:** ML anomaly detection requires a Platinum-equivalent license on self-managed clusters. Serverless
> projects include ML. The caller needs `monitor_ml` to read job config and anomaly results.
>
> **Serverless note:** The `_ml/.../results/*` REST endpoints return HTTP 410 in Elastic Serverless. Always use
> `POST /.ml-anomalies-*/_search` for result queries instead — fully supported everywhere this skill runs.

## Process

1. **Decide whether to fetch data or interpret what the user supplied.** If the user embeds an anomaly record (or job
   config) in the prompt, interpret it directly using the domain knowledge below — do not call APIs to re-fetch fields
   already present. If the job ID, time range, or record is missing, retrieve it from the cluster.

   The decision: proceed with judgment-only explanation when the record contains `record_score`, `initial_record_score`,
   `actual`, `typical`, and `function`; otherwise fetch the missing pieces before explaining.

2. **Verify connectivity when calling the cluster.** Call `GET /`. If the call fails, stop and surface the connection
   error — do not guess endpoints or credentials.

3. **Resolve the job ID and load config.** When the job ID is unknown, call `GET /_ml/anomaly_detectors` to list
   candidates. Call `GET /_ml/anomaly_detectors/{job_id}` for full `analysis_config` (bucket_span, detectors,
   custom_rules, use_null, model_plot_config) and `GET /_ml/anomaly_detectors/{job_id}/_stats` for `state`,
   `model_size_stats.memory_status`, and data counts.

   The decision: confirm detector function and direction match the user's question before interpreting scores. A
   `low_count` job legitimately fires on drops; a `high_count` job does not.

4. **Retrieve anomaly records for the time range.** Call `POST /.ml-anomalies-*/_search` with `result_type: record`, the
   job ID, a timestamp range, and optional `record_score` filter. Read `initial_record_score`, `record_score`, `actual`,
   `typical`, `function`, `multi_bucket_impact`, and `anomaly_score_explanation`.

   Always show **both** `initial_record_score` and `record_score`. The gap is the renormalization story.

5. **Classify the score pattern before speculating on causes.**
   - **`initial_record_score` >> `record_score`** — **Renormalization.** A later, more extreme anomaly rescale this
     record downward. This is expected, healthy model behavior — not a broken model or reason to distrust the detection.
     Use `initial_record_score` for alerting severity; show both scores and explain the gap explicitly.
   - **`initial_record_score` == `record_score`** — No renormalization has occurred since detection.
   - **`actual` << `typical` with `low_count`, `count`, or `low_mean`** — **Absence / drop anomaly.** A high score is
     legitimate — the job detected an outage, pipeline stall, or service failure. This is **not** a false positive.
     Recommend incident investigation, not score tuning.
   - **`actual` >> `typical` with `high_count` or `high_mean`** — Spike anomaly; confirm with `single_bucket_impact`.

   **Only cite `anomaly_score_explanation` factors present in the record.** If `high_variance_penalty` is `false`, do
   not blame variance. If a factor is absent, note that it was not returned — do not invent it.

6. **Quantify renormalization across the job (optional).** Re-query `POST /.ml-anomalies-*/_search` for records in the
   time range sorted by `timestamp` ascending. Compute `score_drift = initial_record_score − record_score` per record
   and filter to `|score_drift| ≥ 20`. Large negative drift (initial >> record) confirms renormalization after a more
   extreme anomaly appeared later.

7. **Add context when the user asks "what caused this?" or "why so low/high?"**
   - **Model bounds** — If `model_plot_config.enabled` is true, call `POST /.ml-anomalies-*/_search` with
     `result_type: model_plot` for the same job and time range. Compare `actual` to `model_lower` / `model_upper`.
   - **Influencers** — Call `POST /.ml-anomalies-*/_search` with `result_type: influencer` for the bucket time range;
     sort by `influencer_score` descending.
   - **Categorization jobs** — Call `POST /.ml-anomalies-*/_search` with `result_type: category_definition` to list
     learned log patterns (`terms`, `regex`, `examples` per `category_id`).

   For aggregations, cross-job queries, bucket-level results, or custom filters beyond score and time, see
   [references/explainer-reference.md](references/explainer-reference.md).

## Common multi-step workflows

| Task                            | Steps (in order)                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Explain a specific anomaly**  | job config → records (job + exact time) → show initial_record_score vs record_score + score factors. |
| **Why is my score low?**        | job config → records → renormalization check → model plot (if enabled) → explain score factors.      |
| **Why is my score high?**       | job config → records → check function direction, insufficient history, use_null, cardinality.        |
| **Renormalization drift**       | records (timestamp sort) → compute score_drift → list records where initial >> record.               |
| **Which entities contributed?** | influencers (job + time range) → sort by influencer_score.                                           |
| **Visualize model bounds**      | model plot (job + time range) → compare model_lower/model_upper vs actual.                           |
| **Categorization job patterns** | category_definition (job_id) → terms, regex, examples per category.                                  |

## Critical principles

- **Retrieve the record first** (or use the one the user supplied). Never explain scores without `initial_record_score`,
  `record_score`, `actual`, `typical`, and `function`.
- **Renormalization is healthy.** When `initial_record_score >> record_score`, a more extreme anomaly appeared later and
  lowered this score — expected behavior, not a model failure.
- **Direction matters.** `low_count` fires when values drop; `high_count` fires on spikes. A high score on a traffic
  stop with `low_count` is correct detection, not a false positive.
- **Explain factors before speculating.** Read `anomaly_score_explanation` from the record. Only address factors that
  are present and relevant.
- **Job config is essential.** `bucket_span`, detector function, `custom_rules`, `use_null`, and memory status all
  affect scores. Inspect job config when a score is surprising.
- **Model plot is the most visual explanation.** When enabled, show model bounds to illustrate where the actual value
  falls relative to the expected range.
- For job health ("missing documents", "memory limit", "datafeed not running") use the `elasticsearch-anomaly-detection`
  skill.

## Domain knowledge

### Score types

| Term                     | Meaning                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| **record_score**         | Normalized 0–100 for a single anomaly record; updated by renormalization. >75 critical.  |
| **initial_record_score** | Score assigned at detection time, before renormalization. Use for alerting.              |
| **anomaly_score**        | Bucket-level severity aggregated across all detectors in a job.                          |
| **influencer_score**     | How unusual a specific entity (host, user, service) is in a bucket; high = likely cause. |
| **multi_bucket_impact**  | 0–5; how much sustained, multi-bucket behavior raised the score. ≥3 = behavioral shift.  |

### anomaly_score_explanation factors

The `anomaly_score_explanation` field on each record breaks the score into components:

| Factor                             | Direction | Meaning                                                                 |
| ---------------------------------- | --------- | ----------------------------------------------------------------------- |
| **anomaly_length**                 | Raises    | Number of consecutive buckets the anomaly spans. Longer → higher score. |
| **single_bucket_impact**           | Raises    | Extremity of this single bucket. Lower probability → higher impact.     |
| **multi_bucket_impact**            | Raises    | Contribution of sustained multi-bucket pattern.                         |
| **anomaly_characteristics_impact** | Raises    | Whether the anomaly is a mean shift vs. variance change.                |
| **high_variance_penalty**          | Lowers    | Noisy data or early training → wide confidence bounds → score reduced.  |
| **incomplete_bucket_penalty**      | Lowers    | Bucket had less data than expected (delayed data, sparse events).       |

### Why a score might be unexpectedly low

- **high_variance_penalty:** The metric is historically noisy — wide confidence bounds absorb the spike.
- **Renormalization:** A more extreme anomaly appeared later and pushed this score down (`initial_record_score` >>
  `record_score`).
- **Insufficient training history:** Need ≥3 weeks for weekly seasonality, ≥2 full cycles for any detected period.
- **bucket_span too large:** Short-duration spikes get smoothed. Use a smaller `bucket_span` for high-frequency events.
- **Detector function mismatch:** `mean` vs `high_mean`, `count` vs `high_count` — only one direction fires.
- **incomplete_bucket_penalty:** Bucket received less data than expected (ingest latency or gaps).
- **custom_rules:** A detector filter may be suppressing the anomaly.

### Why a score might be unexpectedly high

- **Insufficient history:** Model hasn't learned the normal pattern yet — early anomalies are unreliable.
- **Model split thin:** High-cardinality `partition_field` or `by_field` → very few points per entity → unreliable
  probabilities.
- **use_null:** If `use_null: true`, missing entities produce "null" anomalies that may not be meaningful.
- **Absence / drop detection:** With `low_count` or `low_mean`, `actual << typical` produces a legitimately high score —
  treat as a real incident, not a false positive.

### Model behavior concepts

| Concept             | Meaning                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| **actual**          | Observed value. **typical** is what the model expected. The direction matters.                         |
| **Absence anomaly** | `actual << typical` with `count`, `low_count`, or `low_mean` → outage, pipeline stop, service failure. |
| **by_field**        | Independent baseline per entity (e.g., per host). Each entity compared to its own history.             |
| **over_field**      | Population analysis — entity compared to its peer group in the same bucket, not its own history.       |
| **partition_field** | Fully independent sub-models with separate score normalization per partition.                          |

### Model plot and categories

- **Model plot:** Shows the model's learned upper and lower bounds at each time point. If `actual` is within bounds, no
  anomaly; if outside, the score depends on the distance from bounds. Only available when `model_plot_config` is enabled
  on the job. Query via `POST /.ml-anomalies-*/_search` with `result_type: model_plot`.
- **Categories:** For jobs with a `categorization_field_name`, query `result_type: category_definition` to show log
  message patterns (terms, regex, examples per `category_id`). Anomaly records use `by_field_value = <category_id>`.

## Score troubleshooting protocol

1. **List jobs** — Call `GET /_ml/anomaly_detectors` when the job ID is unknown.
2. **Get job config and stats** — Call `GET /_ml/anomaly_detectors/{job_id}` and
   `GET /_ml/anomaly_detectors/{job_id}/_stats`. Verify `bucket_span`, detector function, `custom_rules`, `use_null`,
   job state (opened/closed/failed), and `model_size_stats.memory_status`.
3. **Retrieve the record** — Call `POST /.ml-anomalies-*/_search` with `result_type: record`, the job ID, time range,
   and optional minimum `record_score`. Inspect `initial_record_score`, `record_score`, `actual`, `typical`, `function`,
   `multi_bucket_impact`, and `anomaly_score_explanation`.
4. **Check renormalization** — Compare `initial_record_score` vs `record_score`. If initial >> record, re-query records
   sorted by timestamp and compute `score_drift` to quantify renormalization across the job.
5. **Visualize model bounds** — If `model_plot_config` is enabled, query `result_type: model_plot` and show where the
   actual value fell relative to `model_lower` and `model_upper`.
6. **Influencers** — Query `result_type: influencer` for the anomaly bucket time range; sort by `influencer_score`.
7. **Explain factors** — From the record's `anomaly_score_explanation`, address each **present** relevant factor:
   `high_variance_penalty`, `incomplete_bucket_penalty`, `anomaly_length`, `single_bucket_impact`,
   `multi_bucket_impact`. Do not cite factors absent from the record.

## Examples

- "Why is my anomaly score only 15 when the spike looks huge?" → Check renormalization: `initial_record_score` (~92) >>
  `record_score` (~15). The spike was real; the current score was rescaled down. Use the initial score for alerting.
- "Traffic stopped and I got a HIGH score — false positive?" → No. `low_count` with `actual` far below `typical` is
  legitimate absence detection. Investigate the outage.
- "Which entities contributed most to the anomalies in job X last night?" → Query influencers for the time range.
- "Show me the model bounds for this job." → Query model plot when `model_plot_config` is enabled.
- "List records where the score was renormalized down a lot." → Records sorted by timestamp; filter large
  `initial_record_score − record_score`.

## Guidelines

- Report only what the API or the user-supplied record contains; do not invent scores, timestamps, entity values, or
  explanation factors.
- Always show both `initial_record_score` and `record_score` when explaining a record; state explicitly whether
  renormalization occurred.
- When a score factor is missing from the record, do not assert it; note that the field was not returned.
- Do not attribute low scores to `high_variance_penalty` or `incomplete_bucket_penalty` when those flags are `false` or
  absent in the record.
- For investigation ("what caused this?", "which service is responsible?") query influencers or construct cross-job
  searches via [references/explainer-reference.md](references/explainer-reference.md).
- For job health use the `elasticsearch-anomaly-detection` skill.

## Operations

| HTTP API (shorthand)                         | `elastic` CLI command                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /`                                      | `elastic es info`                                                               |
| `GET /_ml/anomaly_detectors`                 | `elastic es ml get-jobs`                                                        |
| `GET /_ml/anomaly_detectors/{job_id}`        | `elastic es ml get-jobs --job-id '<job_id>'`                                    |
| `GET /_ml/anomaly_detectors/{job_id}/_stats` | `elastic es ml get-job-stats --job-id '<job_id>'`                               |
| `POST /.ml-anomalies-*/_search`              | `elastic es search --index '.ml-anomalies-*' --input-file '<search-body.json>'` |

Query body shapes for each `result_type` (`record`, `influencer`, `model_plot`, `category_definition`) are documented in
[references/explainer-reference.md](references/explainer-reference.md).
