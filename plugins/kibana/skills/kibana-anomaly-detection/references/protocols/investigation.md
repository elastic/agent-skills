# Investigation Protocol (14 Steps)

Canonical workflow for root cause analysis of Elastic ML anomaly detection events.

> For a worked example, see [../worked-example.md](../worked-example.md). Query templates:
> [../investigation-queries.md](../investigation-queries.md).

---

## When to Use This Protocol

- Starting from a single alert and need to determine the root cause
- Multiple jobs are co-firing and you need to find the common denominator
- Asked "what broke?", "which entity caused this?", or "why is service X slow?"

For **score explanation questions** (why is my score low/high?), see [../score-reference.md](../score-reference.md)
instead.

---

## Three-Layer Job Discovery

Before beginning analysis, identify all related jobs using these signals in priority order:

1. **Shared datafeed index patterns** (strongest) — `GET /_ml/datafeeds/datafeed-{job_id}` → compare `indices` across
   jobs via `GET /_ml/anomaly_detectors`.
2. **Shared entity field names** (config signal) — `GET /_ml/anomaly_detectors/{job_id}` → compare `by_field_name`,
   `over_field_name`, `partition_field_name`.
3. **Shared entity values in results** (active incident) — `POST /.ml-anomalies-*/_search` with
   `result_type: influencer` for co-firing entity values across jobs.

---

## The 14 Steps

### Phase 1: Discovery

**Step 1 — Discover** Call `GET /_ml/anomaly_detectors` to list jobs. Call `GET /_ml/anomaly_detectors/{job_id}` for
detector functions, entity fields, and `bucket_span`. Always start here when jobs are unknown.

**Step 2 — Find related jobs** Compare datafeed `indices` and entity field names across jobs. Jobs sharing a source
index or entity dimension monitor the same system from different angles.

**Step 3 — Scope** Call `POST /.ml-anomalies-*/_search` with `result_type: bucket`, a time range, and minimum
`anomaly_score`. Identify the incident window and count of affected jobs.

---

### Phase 2: Entity Attribution

**Step 4 — Expand from alert** Extract entity values from the alert (`partition_field_value`, `by_field_value`,
`over_field_value`). Search influencers across related jobs for those values.

**Step 5 — Multi-job entities** Aggregate influencers by entity value across jobs. Entities anomalous in **2+ jobs**
simultaneously are the strongest root cause signal — prime suspects. Single-job entities are likely downstream victims.

> Resource faults (CPU, memory, disk) affect multiple metrics → multi-job. Network faults (packet loss) affect latency
> but not resource metrics → single-job.

**Step 6 — Fingerprint** Query records across the related job group. Understand which system aspects are anomalous: CPU?
Latency? Error rate? Memory? The combination of anomalous detectors characterizes the fault type.

---

### Phase 3: Deep Analysis

**Step 7 — Drill down per job** Call `POST /.ml-anomalies-*/_search` with `result_type: record` and an exact job ID to
examine a specific job's anomalies without cross-job noise.

**Step 8 — Attribute (critical)** Call `POST /.ml-anomalies-*/_search` with `result_type: influencer`, sort by
**`influencer_score` descending**, and use a low minimum score (25). The entity with the highest `influencer_score` is
the primary suspect — not the bucket `anomaly_score` alone.

**Step 9 — Profile** Query all record and influencer results for the suspect entity across jobs, sorted by timestamp, to
build a complete dossier.

**Step 10 — Characterize** Examine `multi_bucket_impact` in results:

- `≥ 3` → sustained behavioral shift (system change), not a transient spike
- `0–2` → isolated event (one-off anomaly)

---

### Phase 4: Root Cause Confirmation

**Step 11 — Cascade** Sort record timestamps across jobs for the suspect entity. The **earliest anomaly** points toward
the root cause. Reconstruct chronology: which metric became anomalous first?

**Step 12 — Evidence** Get source indices from `GET /_ml/datafeeds/datafeed-{job_id}`, then search source data for the
suspect entity and time window. Raw source documents show the actual values at ingestion.

**Step 13 — Log categories** _(only when `by_field_name == "mlcategory"`)_ Query `result_type: category_definition` for
the job. Compare category terms and examples between baseline and anomaly windows. Cross-reference changed entities with
influencers from related jobs.

---

### Phase 5: Synthesis

**Step 14 — Synthesize** Present findings as a structured RCA report:

| Section                  | Content                                                       |
| ------------------------ | ------------------------------------------------------------- |
| **Root cause entity**    | Entity with highest `influencer_score` and multi-job presence |
| **Affected systems**     | Which jobs/metrics were impacted                              |
| **Temporal progression** | Which metric became anomalous first (from Step 11)            |
| **Fault type**           | Resource / Network / Application / Pipeline                   |
| **Severity**             | `record_score` range, `multi_bucket_impact`, duration         |
| **Recommended actions**  | Remediation steps                                             |

---

## Key Decision Rules

- **Rank by `influencer_score` for entity attribution** — bucket `anomaly_score` is aggregate severity, not cause.
- **Low scores across many jobs** > one high score — composite cross-job signal often indicates systemic root cause.
- **`actual << typical` with count/low_count** → absence/outage, not just a numerically low value.
- **Entities in 2+ jobs** → prime suspects (resource fault or systemic failure).
- **Entities in only 1 job** → likely downstream victims or surface-level effects.
- **Earliest anomaly chronology** → the earliest metric to become anomalous is closest to the root cause.
