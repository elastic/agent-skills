# Observability / SRE framing — Elastic ML anomaly detection

**Role:** Treat Elasticsearch ML anomaly detection as a reliability signal for SRE and platform work: degradation,
incident scope, and capacity decisions. Combine the **Investigate**, **Explain**, and **Troubleshoot** modes of the
parent skill, biased toward reliability interpretation.

---

## Reliability-first interpretation

Interpret anomalies through three reliability lenses:

1. **Incident detection** — is this active degradation? What is the scope?
2. **Change attribution** — tie signal to deployments, config changes, dependencies when possible.
3. **Capacity signals** — separate acute incidents from resource-exhaustion trajectories.

## Signal → reliability mapping

| Anomaly pattern                                                | Reliability interpretation                         | Action                               |
| -------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| Latency spike + error rate spike (same service, same time)     | Service degradation in progress                    | Incident response                    |
| Throughput drop (`actual << typical` with `count`/`low_count`) | Service unavailable or upstream dependency failure | Check dependencies, circuit breakers |
| Cross-service entity anomalies with temporal chain             | Cascading failure / blast propagation              | Identify blast radius, isolate       |
| Memory/CPU creep (`multi_bucket_impact ≥ 3`)                   | Resource exhaustion trajectory                     | Capacity intervention before OOM     |
| Anomaly onset matches deployment timestamp                     | Deployment regression                              | Rollback candidate                   |
| Single service anomaly, no related job co-firing               | Isolated issue, contained                          | Service-level investigation          |
| Anomaly during known maintenance window                        | Expected — suppress via calendar event             | `ad_create_calendar_event`           |

## SRE investigation protocol

### Phase 1 — Incident scoping (Investigate mode)

1. `ad_get_available_metadata` — identify observability jobs (latency, error rate, throughput, saturation, request
   count).
2. `ad_query_anomaly_timeline` (`job_id_pattern='*'`) — establish incident start time and breadth.
3. `ad_rca_multi_job_entities` (`min_job_count=2`) — co-firing metrics on the same entity = the degraded service.
4. `ad_rca_blast_radius` — scope: which downstream services are affected.

### Phase 2 — Root cause attribution (Investigate mode)

1. `ad_discover_jobs_by_datafeed_index` — find all jobs monitoring the same infrastructure layer.
2. `ad_rca_cross_job_entity_match` — confirm which services are actively co-firing.
3. `ad_rca_correlation` sorted by timestamp — leading metric (first anomaly) = root cause; lagging = symptoms.
4. `ad_rca_detector_fingerprint` — characterize failure type (latency? saturation? error rate? throughput drop?).

### Phase 3 — Evidence and context (Investigate mode)

1. `ad_get_job_datafeed_config` → source index → `ad_rca_source_evidence` — actual metric values and dimensions.
2. `ad_query_influencers` — which specific service instances, pods, or hosts are contributing.
3. `ad_rca_entity_profile` — full behavioral history for the suspect service/host.

### Phase 4 — Deployment regression check (Explain mode)

When incident onset aligns with a recent deployment:

1. `ad_rca_score_reassessment` — confirm whether a score drop reflects renormalization instead of real recovery.
2. `ad_get_model_plot` — confirm the anomaly sits outside expected bounds instead of being a model artifact.
3. `ad_rca_source_evidence` — compare metric values before and after the deployment timestamp.

### Phase 5 — Capacity planning (Explain + Troubleshoot modes)

For sustained `multi_bucket_impact ≥ 3` anomalies that look like trajectories instead of spikes:

1. `ad_ts_model_memory_health` — confirm ML memory pressure is not degrading detections.
2. `ad_query_anomaly_records` filtered to `multi_bucket_impact ≥ 3` — extract resource saturation trends.
3. `ad_estimate_memory_requirement` — size memory for expanded infrastructure.

### Phase 6 — Maintenance suppression (Troubleshoot mode)

For planned deployments or maintenance windows:

1. `ad_create_calendar_event` — suppress false positives, reduce alert fatigue, protect model health.

## Reliability-specific rules

- **`multi_bucket_impact ≥ 3`** is the primary capacity signal: sustained shifts indicate trajectory. These need
  capacity planning, not just incident response.
- **`actual << typical` with throughput detectors** = service unavailability. Treat as SEV-1 until proven otherwise.
- **Temporal ordering matters**: in cascading failures, the first anomaly timestamp points to root cause, not the
  highest score.
- **`initial_record_score >> record_score`**: renormalization — the score dropped because a worse event occurred later.
  Do not interpret as "resolved." Use Explain mode to communicate this to stakeholders.
- **All jobs firing simultaneously**: shared infrastructure layer (database, message bus, shared network path).
  Investigate shared dependencies first.
- **`ad_validate_ml_tool_permissions`**: run as a preflight when tool calls fail unexpectedly.

## Job health before trusting signals

- `ad_ts_model_memory_health` — a job at `hard_limit` stops learning new entities (new pods/services), risking missed
  anomalies for those entities.
- `ad_ts_delayed_data_annotations` — delayed data delays alerts. Raise `query_delay` toward P95 ingest latency + buffer
  when the pipeline is slow; otherwise expect missed real-time detection.
- `ad_create_calendar_event` — add maintenance windows to suppress false positives during planned deployments.

## Escalation decision framework

| Signal                                                  | SRE action                                  |
| ------------------------------------------------------- | ------------------------------------------- |
| Multi-job co-fire + blast radius > 1 service            | Declare incident, page on-call              |
| Leading metric identified + deployment timestamp match  | Rollback candidate — page owning team       |
| Sustained `multi_bucket_impact ≥ 3` + resource detector | Capacity review, no immediate incident      |
| Single-job anomaly + no downstream impact               | Service-level investigation, no incident    |
| Anomaly during known maintenance                        | Add calendar event, dismiss                 |
| Score drop only (renormalization)                       | Use Explain mode to communicate — no action |
