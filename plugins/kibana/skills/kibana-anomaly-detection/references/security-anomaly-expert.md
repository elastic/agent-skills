# Security framing — Elastic ML anomaly detection

**Role:** Treat Elasticsearch ML anomaly detection as a behavioral threat-detection surface. Assume unusual behavior is
suspicious until benign intent is proven. Combine the **Investigate**, **Explain**, and **Troubleshoot** modes of the
parent skill, biased toward attack-first interpretation.

---

## Threat-first interpretation

Treat operational monitoring as benign-first; treat security anomalies as attack-first. Then:

1. Map behavioral deviations to known attack patterns.
2. Reconstruct attacker chains from cross-job signals.
3. Separate attacker behavior from benign operational noise.
4. Classify threats with MITRE ATT&CK context.

## Signal mapping

| Anomaly pattern                                                | Threat hypothesis                               | MITRE tactic                    |
| -------------------------------------------------------------- | ----------------------------------------------- | ------------------------------- |
| Unusual auth failures for a user/host                          | Brute force, credential stuffing                | Credential Access (TA0006)      |
| `actual << typical` with `low_count` on auth/process           | Service stop, log clearing, defense evasion     | Defense Evasion (TA0005)        |
| New/rare entity (first-seen IP, user, process)                 | Initial access, new implant, new C2             | Initial Access (TA0001)         |
| Entity anomalous in multiple jobs simultaneously               | Active compromise, lateral movement in progress | Lateral Movement (TA0008)       |
| Unusual data volume (bytes_out spike)                          | Data exfiltration                               | Exfiltration (TA0010)           |
| Rare process execution (high influencer_score on process name) | Malware execution, living-off-the-land          | Execution (TA0002)              |
| Auth success following prior auth failures                     | Successful credential compromise                | Credential Access → Persistence |
| Privilege escalation patterns (sudo, admin role changes)       | Admin abuse, shadow IT, misconfiguration        | Privilege Escalation (TA0004)   |
| Regular low-volume network spikes (beaconing)                  | C2 communication                                | Command & Control (TA0011)      |

## Investigation questions

For each anomalous entity, determine:

1. **Known vs first-seen entity** — treat first-seen entities as higher risk.
2. **Blast radius** — count how many jobs or systems co-fire.
3. **Temporal chain** — treat auth failure → auth success → lateral movement as a compromise chain hypothesis.
4. **Source evidence** — treat raw logs as the ground truth.
5. **MITRE mapping** — map the pattern to the closest tactic and technique.

## Investigation protocol

### Phase 1 — Triage (Investigate mode)

1. `GET /_ml/anomaly_detectors` — identify security-relevant jobs (auth, network, process, DNS, endpoint).
2. `POST /.ml-anomalies-*/_search` (`result_type: bucket`) — establish incident time window.
3. Cross-job influencer aggregation — multi-job entities in security = active threat actors.

### Phase 2 — Entity attribution (Investigate mode)

1. Search influencers across jobs for the alert entity — expand from single alert to full activity chain.
2. `POST /.ml-anomalies-*/_search` (`result_type: influencer`, low score threshold) — surface all associated entities;
   **rank by `influencer_score`**.
3. Profile the suspect entity across all jobs and field types, sorted by timestamp.

### Phase 3 — Attack chain reconstruction (Investigate mode)

1. Sort record timestamps across jobs — reconstruct chronological order. First anomaly = entry point hypothesis.
2. Count affected jobs/entities — determine lateral spread.
3. Examine which behavioral dimensions are anomalous (auth? process? network? data volume?).

### Phase 4 — Evidence (Investigate mode)

1. `GET /_ml/datafeeds/datafeed-{job_id}` → source index → search raw logs for the suspect entity and time window.
2. For categorization jobs, query `result_type: category_definition` and compare baseline vs anomaly log patterns.

### Phase 5 — Score sanity (Explain mode)

When scores seem inconsistent with threat severity:

1. Compare `initial_record_score` vs `record_score` — renormalization may lower historical alert scores.
2. Query `result_type: model_plot` when enabled — confirm anomaly sits outside expected bounds.
3. Check `GET /_ml/anomaly_detectors/{job_id}/_stats` for `memory_status = hard_limit` — corrupted models produce
   unreliable scores; fix via Troubleshoot mode before concluding false negative.

## Rules

- **High `influencer_score` on a process or user in a security job** warrants immediate deep-dive — do not dismiss
  because bucket `anomaly_score` is moderate.
- **Multi-job entity co-firing in security context** → assume active compromise until ruled out.
- **Absence anomalies on auth/process indices** → investigate defense evasion (log clearing, service stop) before
  dismissing as benign maintenance.
