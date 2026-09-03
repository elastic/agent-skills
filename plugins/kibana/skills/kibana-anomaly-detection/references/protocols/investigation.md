# Investigation Protocol (14 Steps)

Canonical workflow for root cause analysis of Elastic ML anomaly detection events.

> For a worked example, see [../worked-example.md](../worked-example.md).

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

1. **Shared datafeed index patterns** (strongest) — Jobs reading from the same source indices monitor the same
   underlying system.
2. **Shared entity field names** (config signal) — Jobs that split by the same field names analyze the same entity
   dimensions.
3. **Shared entity values in results** (active incident) — During an active incident, find all jobs where a specific
   entity is currently co-firing.

---

## The 14 Steps

### Phase 1: Discovery

**Step 1 — Discover** Call `ad_get_available_metadata` to learn available jobs, fields, and functions. Always start here
when jobs are unknown.

**Step 2 — Find related jobs** Use `ad_discover_jobs_by_datafeed_index` with the job of interest — it retrieves that
job's `datafeed_config.indices`, then finds all other jobs sharing the same source index. Also use
`ad_discover_related_jobs` to find jobs sharing entity field names (partition/by/over). Fallback: compare
`datafeed_config.indices` manually via `ad_get_jobs`.

**Step 3 — Scope** Use `ad_query_anomaly_timeline` with `job_id_pattern` set to the related job group (e.g.,
`rcaeval-*`) or `*` for all jobs. Identify the incident time window and count of affected jobs. Cross-job composite
scores reveal coordinated events.

---

### Phase 2: Entity Attribution

**Step 4 — Expand from alert** Extract entity values from the alert (`partition_field_value`, `by_field_value`,
`over_field_value`). Use `ad_rca_cross_job_entity_match` to find all related jobs with anomalies for that entity. Note
`first_anomaly` per job for chronology reconstruction.

**Step 5 — Multi-job entities** Use `ad_rca_multi_job_entities` with `min_job_count=2`. Entities anomalous in 2+ jobs
simultaneously are the strongest root cause signal — they are prime suspects. Single-job entities are likely downstream
victims.

> Resource faults (CPU, memory, disk) affect multiple metrics → multi-job. Network faults (packet loss) affect latency
> but not resource metrics → single-job.

**Step 6 — Fingerprint** Use `ad_rca_detector_fingerprint` with the related job group as `job_id_pattern`. Understand
which system aspects are anomalous: CPU? Latency? Error rate? Memory? The combination of anomalous detectors
characterizes the fault type.

---

### Phase 3: Deep Analysis

**Step 7 — Drill down per job** Use `ad_query_anomaly_records` with an exact `job_id_pattern` to examine a specific
job's anomalies in detail, without cross-job noise.

**Step 8 — Attribute** Use `ad_query_influencers` with the related job group as `job_id_pattern` and a low `min_score`
(25) for shared influencer discovery. Filter for `job_count > 1` to surface entities that are influencers in multiple
co-firing jobs — the common denominator.

**Step 9 — Profile** Use `ad_rca_entity_profile` to build a complete dossier on the suspect entity: all anomalies across
all jobs and field types, sorted by timestamp.

**Step 10 — Characterize** Examine `multi_bucket_impact` in results:

- `≥ 3` → sustained behavioral shift (system change), not a transient spike
- `0–2` → isolated event (one-off anomaly)

---

### Phase 4: Root Cause Confirmation

**Step 11 — Cascade** Use `ad_rca_correlation` sorted by timestamp. The job with the **earliest anomaly** for the
suspect entity points toward the root cause. Reconstruct chronology: which metric became anomalous first?

**Step 12 — Evidence** Get the source index from `ad_get_job_datafeed_config`, then call `ad_rca_source_evidence` to
retrieve raw source documents. This shows the actual values that triggered the anomaly at the point of ingestion.

**Step 13 — Log categories** _(only when `by_field_name == "mlcategory"`)_ For log categorization jobs:

1. `ad_get_categories` → find the category matching the anomaly's `by_field_value` (category ID). Examine its terms,
   regex, and examples.
2. `ad_search_log_category_examples` twice — once for a **baseline window** (24h before anomaly), once for the **anomaly
   window**.
3. Compare: look for changed field values in the variable parts of the log structure (IPs, hostnames, error codes,
   paths, credentials).
4. Cross-reference changed entities with influencers from other related jobs to confirm root cause.

---

### Phase 5: Synthesis

**Step 14 — Synthesize** Present findings as a structured RCA report:

| Section                  | Content                                                       |
| ------------------------ | ------------------------------------------------------------- |
| **Root cause entity**    | The entity (host, service, user) responsible                  |
| **Affected systems**     | Which jobs/metrics were impacted                              |
| **Temporal progression** | Which metric became anomalous first (from Step 11)            |
| **Fault type**           | Resource (CPU/memory/disk) / Network / Application / Pipeline |
| **Severity**             | `record_score` range, `multi_bucket_impact`, duration         |
| **Recommended actions**  | Remediation steps                                             |

---

## Quick Reference: Tool → Step Mapping

| Tool                                 | Step |
| ------------------------------------ | ---- |
| `ad_get_available_metadata`          | 1    |
| `ad_discover_jobs_by_datafeed_index` | 2    |
| `ad_discover_related_jobs`           | 2    |
| `ad_query_anomaly_timeline`          | 3    |
| `ad_rca_cross_job_entity_match`      | 4    |
| `ad_rca_multi_job_entities`          | 5    |
| `ad_rca_detector_fingerprint`        | 6    |
| `ad_query_anomaly_records`           | 7    |
| `ad_query_influencers`               | 8    |
| `ad_rca_entity_profile`              | 9    |
| `ad_rca_correlation`                 | 11   |
| `ad_get_job_datafeed_config`         | 12   |
| `ad_rca_source_evidence`             | 12   |
| `ad_get_categories`                  | 13   |
| `ad_search_log_category_examples`    | 13   |

---

## Key Decision Rules

- **Low scores across many jobs** > one high score — composite cross-job signal often indicates systemic root cause.
- **`actual << typical` with count/low_count** → absence/outage, not just a numerically low value.
- **Entities in 2+ jobs** → prime suspects (resource fault or systemic failure).
- **Entities in only 1 job** → likely downstream victims or surface-level effects.
- **`first_anomaly` chronology** → the earliest metric to become anomalous is closest to the root cause.
