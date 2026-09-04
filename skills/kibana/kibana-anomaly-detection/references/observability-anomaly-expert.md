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
| Anomaly during known maintenance window                        | Expected — suppress via calendar event             | Add calendar event via ML API        |

## SRE investigation protocol

### Phase 1 — Incident scoping (Investigate mode)

1. `GET /_ml/anomaly_detectors` — identify observability jobs (latency, error rate, throughput, saturation).
2. `POST /.ml-anomalies-*/_search` (`result_type: bucket`) — establish incident start time and breadth.
3. Cross-job influencer aggregation — co-firing metrics on the same entity = the degraded service.

### Phase 2 — Root cause attribution (Investigate mode)

1. Compare datafeed indices across jobs — find all jobs monitoring the same infrastructure layer.
2. Search influencers/records for co-firing entity values across related jobs.
3. Sort record timestamps — leading metric (first anomaly) = root cause; lagging = symptoms.
4. Examine which behavioral dimensions are anomalous (latency? saturation? error rate? throughput drop?).

### Phase 3 — Evidence and context (Investigate mode)

1. `GET /_ml/datafeeds/datafeed-{job_id}` → source index → search raw metrics/logs for the suspect service/host.
2. `POST /.ml-anomalies-*/_search` (`result_type: influencer`) — rank hosts/pods/instances by `influencer_score`.
3. Profile the suspect entity across all related jobs.

### Phase 4 — Deployment regression check (Explain mode)

When incident onset aligns with a recent deployment:

1. Compare `initial_record_score` vs `record_score` — confirm whether a score drop reflects renormalization instead of
   real recovery.
2. Query `result_type: model_plot` — confirm the anomaly sits outside expected bounds instead of being a model artifact.
3. Search source metrics before and after the deployment timestamp.

### Phase 5 — Capacity planning (Explain + Troubleshoot modes)

When `multi_bucket_impact ≥ 3` on resource metrics:

1. `GET /_ml/anomaly_detectors/{job_id}/_stats` — check `memory_status` and field cardinality counts.
2. If approaching `hard_limit`, raise `model_memory_limit` or split jobs **before** results stop.
3. Do not treat a stopped datafeed as the root cause when `memory_status = hard_limit`.

## Rules

- **Name the entity with highest `influencer_score`** when scoping an incident — "checkout latency spiked" is not
  enough; identify which host/service instance drove it.
- **`multi_bucket_impact ≥ 3` on saturation metrics** → capacity intervention, not just alert acknowledgment.
- **Cross-job co-firing on the same service entity** → systemic degradation; isolate blast radius before deep-diving one
  metric.
