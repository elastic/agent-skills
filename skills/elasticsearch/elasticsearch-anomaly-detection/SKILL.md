---
name: elasticsearch-anomaly-detection
description: >
  Create and manage Elastic ML anomaly detection jobs via the API. Use when setting
  up jobs on an index or data stream, configuring jobs and datafeeds, or opening,
  starting, or stopping them.
compatibility: >
  Requires Elasticsearch 8.x+ or Elastic Cloud Serverless with ML anomaly detection.
  Uses the ML REST API only. User needs manage_ml privilege to create and manage jobs.
metadata:
  author: elastic
  version: 1.1.0
  universal: true
---

# Elasticsearch Anomaly Detection

Create, open, and start ML anomaly detection jobs on time-series data. Choose the right count-family detector direction,
configure bucket span and time field, wire the datafeed to the correct index, and confirm running state from stats — not
from assumptions.

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
> projects include ML. The caller needs `manage_ml` to create and manage jobs.
>
> **Related skill:** For interpreting anomaly scores, influencers, and model behavior after a job is running, use
> `elasticsearch-anomaly-detection-explainer` — not this skill.

## Process

1. **Discover the target index and time field.** List candidate indices with `GET /_cat/indices` (pass a pattern when
   the user names one). Fetch field types for the chosen index with `GET /{index}/_mapping`. The decision: confirm the
   index exists, identify the time field (often `@timestamp`), and verify document volume is sufficient for baseline
   learning. Never guess index or field names — they vary across deployments.

2. **Choose detector function and direction.** Match the user's intent to a count-family detector in
   `analysis_config.detectors`:
   - **Spike, surge, unusual increase in event volume** → `high_count` (or `count`, which flags both directions but is
     acceptable when the user cares about spikes). Do **not** use `low_count` — it will miss spikes.
   - **Drop, outage, absence of events, traffic stops** → `low_count`. Do **not** use `high_count` — it will miss drops
     and silence.
   - **Metric deviation** (CPU, latency, a numeric field) → mean-family functions (`mean`, `high_mean`, `low_mean`) with
     `field_name` set — only when the user asks about a numeric metric, not raw event volume.

   The decision: pick one primary detector whose direction matches the anomaly type. For volume spike/drop questions on
   document counts, stay in the count family — mean detectors are unsuited to "how many events" questions.

3. **Set immutable job shape before creation.** These fields cannot change after `PUT /_ml/anomaly_detectors/{job_id}`:
   - `analysis_config.bucket_span` — use the interval the user specifies (e.g. `15m` for 15-minute buckets). Match the
     granularity of anomalies they care about; too short is noisy, too long is slow to detect.
   - `data_description.time_field` — the time field from the mapping (commonly `@timestamp`).
   - `analysis_config.detectors` — the function and direction from step 2.

   Example job body for a volume-spike detector:

   ```json
   {
     "analysis_config": {
       "bucket_span": "15m",
       "detectors": [{ "function": "high_count" }]
     },
     "data_description": { "time_field": "@timestamp" }
   }
   ```

   Example for an outage / drop detector:

   ```json
   {
     "analysis_config": {
       "bucket_span": "15m",
       "detectors": [{ "function": "low_count" }]
     },
     "data_description": { "time_field": "@timestamp" }
   }
   ```

4. **Create the job.** Call `PUT /_ml/anomaly_detectors/{job_id}` with the job id the user requested (or a descriptive
   id you propose). The job starts in `closed` state — creating it does not start analysis.

5. **Create the datafeed.** Call `PUT /_ml/datafeeds/datafeed-{job_id}` immediately after job creation. Set `job_id` to
   the same id, `indices` to the target index (exact name or pattern from step 1), and a query that selects the relevant
   documents (typically `match_all`). The datafeed id convention is `datafeed-{job_id}`.

   ```json
   {
     "job_id": "{job_id}",
     "indices": ["{index}"],
     "query": { "match_all": {} }
   }
   ```

6. **Open the job, then start the datafeed — in that order.** This sequence is mandatory; do not skip or reorder:
   1. `POST /_ml/anomaly_detectors/{job_id}/_open` — transitions the job to `opened`.
   2. `POST /_ml/datafeeds/datafeed-{job_id}/_start` — transitions the datafeed to `started`.

   Opening before the datafeed exists fails. Starting the datafeed before opening the job fails. Do not report success
   after only creating resources — the job is not running until both are active.

7. **Confirm running state from stats.** Verify the outcome with:
   - `GET /_ml/anomaly_detectors/{job_id}/_stats` — expect `state: "opened"`.
   - `GET /_ml/datafeeds/datafeed-{job_id}/_stats` — expect `state: "started"`.

   Optionally call `GET /_ml/anomaly_detectors/{job_id}` to confirm configuration (detectors, `bucket_span`,
   `time_field`, datafeed indices). Report both stats states explicitly — "created" is not the same as "opened" and
   "started".

## Teardown

When stopping or deleting a job, reverse the startup order:

1. `POST /_ml/datafeeds/datafeed-{job_id}/_stop` — stop the datafeed first.
2. `POST /_ml/anomaly_detectors/{job_id}/_close` — then close the job.

Stop the datafeed before closing the job. Close the job before resetting or deleting it.

## Guidelines

- **Required lifecycle order (create):** job → datafeed → open job → start datafeed. Every new job follows this
  sequence.
- **Detector direction is the highest-impact decision** for volume anomalies. Re-read the user's wording: "spike",
  "surge", and "unusual increase" → high direction; "drop", "outage", "stops", "absence" → low direction.
- **Immutable fields** (`bucket_span`, detectors, `time_field`) require delete-and-recreate if wrong — validate mapping
  and intent before the first `PUT`.
- **Datafeed index must match the user's target.** Point `indices` at the exact index or pattern they named — not a
  nearby guess.
- **Entity-level analysis** (`by_field_name`, `over_field_name`, `partition_field_name`) and advanced tuning live in
  [references/anomaly-detection-reference.md](references/anomaly-detection-reference.md).

## Full Reference

For API paths, request/response fields, score semantics, and field interactions, read
[references/anomaly-detection-reference.md](references/anomaly-detection-reference.md).

## Operations

| HTTP API (shorthand)                           | `elastic` CLI command                                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /_cat/indices`                            | `elastic es cat indices --index '<pattern>'`                                                                            |
| `GET /{index}/_mapping`                        | `elastic es indices get-mapping --index '<index>'`                                                                      |
| `PUT /_ml/anomaly_detectors/{job_id}`          | `elastic es ml put-job --job-id '<job_id>' --analysis-config '<json>' --data-description '<json>'`                      |
| `PUT /_ml/datafeeds/datafeed-{job_id}`         | `elastic es ml put-datafeed --datafeed-id 'datafeed-<job_id>' --job-id '<job_id>' --indices '<index>' --query '<json>'` |
| `POST /_ml/anomaly_detectors/{job_id}/_open`   | `elastic es ml open-job --job-id '<job_id>'`                                                                            |
| `POST /_ml/datafeeds/datafeed-{job_id}/_start` | `elastic es ml start-datafeed --datafeed-id 'datafeed-<job_id>'`                                                        |
| `GET /_ml/anomaly_detectors/{job_id}`          | `elastic es ml get-jobs --job-id '<job_id>'`                                                                            |
| `GET /_ml/anomaly_detectors/{job_id}/_stats`   | `elastic es ml get-job-stats --job-id '<job_id>'`                                                                       |
| `GET /_ml/datafeeds/datafeed-{job_id}/_stats`  | `elastic es ml get-datafeed-stats --datafeed-id 'datafeed-<job_id>'`                                                    |
| `POST /_ml/datafeeds/datafeed-{job_id}/_stop`  | `elastic es ml stop-datafeed --datafeed-id 'datafeed-<job_id>'`                                                         |
| `POST /_ml/anomaly_detectors/{job_id}/_close`  | `elastic es ml close-job --job-id '<job_id>'`                                                                           |
