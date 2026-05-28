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

1. `ad_get_available_metadata` — identify security-relevant jobs (auth, network, process, DNS, endpoint).
2. `ad_query_anomaly_timeline` — establish incident time window.
3. `ad_rca_multi_job_entities` (`min_job_count=2`) — multi-job entities in security = active threat actors.

### Phase 2 — Entity attribution (Investigate mode)

1. `ad_rca_cross_job_entity_match` — expand from single alert to full entity activity chain.
2. `ad_query_influencers` (low `min_score`, broad `job_id_pattern`) — surface all associated entities.
3. `ad_rca_entity_profile` — complete behavioral dossier on suspect user/host/IP.

### Phase 3 — Attack chain reconstruction (Investigate mode)

1. `ad_rca_correlation` sorted by timestamp — reconstruct chronological order. First anomaly = entry point hypothesis.
2. `ad_rca_blast_radius` — determine lateral spread: how many systems/accounts affected.
3. `ad_rca_detector_fingerprint` — which behavioral dimensions are anomalous (auth? process? network? data volume?).

### Phase 4 — Evidence collection (Investigate mode)

1. `ad_get_job_datafeed_config` → source index → `ad_rca_source_evidence` — raw forensic ground truth.
2. For log categorization jobs: `ad_get_categories` + `ad_search_log_category_examples` — compare baseline vs. incident
   window for changed IPs, credentials, command-line arguments, file paths.

### Phase 5 — Score validation (Explain mode)

1. If score seems low for a suspicious pattern: `ad_rca_score_reassessment` — check renormalization drift.
   `initial_record_score` may reveal a threat that was renormalized away.
2. `ad_get_model_plot` — confirm actual exceeds model bounds.

### Phase 6 — Threat report

- **Threat classification**: attack type + MITRE ATT&CK tactic/technique
- **Confidence**: High/Medium/Low with reasoning
- **Affected entities**: users, hosts, IPs, processes
- **Attack timeline**: reconstructed from `first_anomaly` per job
- **Evidence summary**: key anomalous values from source documents
- **Recommended response**: containment, investigation, tuning actions

## Security-specific rules

- **Absence anomalies are high priority**: `actual << typical` on auth or process jobs = log clearing or service killing
  = defense evasion.
- **`initial_record_score >> record_score`**: do not dismiss. Score was renormalized after a more extreme event — the
  original anomaly is still a valid threat indicator.
- **Low scores across many jobs > one high score**: sophisticated attackers stay below single-job thresholds. Composite
  cross-job signals are the primary detection mechanism.
- **New entities**: first-seen host or user is higher priority than a known entity with a moderate score.
- **`multi_bucket_impact ≥ 3`**: sustained shift = persistent access, beaconing, or ongoing exfiltration.
- Run `ad_validate_ml_tool_permissions` if tools fail — permission errors are common in multi-tenant security
  environments.

## Escalation vs. tuning

| Signal                                           | Action                                            |
| ------------------------------------------------ | ------------------------------------------------- |
| Multi-job entity + source evidence + MITRE match | Escalate as confirmed threat                      |
| Multi-job entity + no source evidence            | Escalate for manual log review                    |
| Single-job, explainable by operational event     | Document and tune (calendar event or custom rule) |
| Renormalization-only score drop                  | Explain to stakeholder — use Explain mode         |
