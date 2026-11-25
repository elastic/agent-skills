---
name: security-alert-analysis
description: >
  Investigate a specific Elastic Security detection alert: gather context, assess
  entity risk, classify the threat, document findings, and optionally acknowledge.
  Use when triaging a single known alert, performing SOC investigation, or following
  up after the security-alert-triage skill identifies a group to investigate.
metadata:
  author: elastic
  version: 0.1.0
  universal: true
compatibility: Kibana 8.x or 9.x with matching Elasticsearch — self-managed, Elastic
  Cloud Hosted, or Elastic Cloud Serverless. Acknowledgement uses the Detection Engine
  API so it works on Serverless where direct writes to alert data streams are rejected.
  Requires the `elastic` CLI with `es` and `kb` support.
---

# Alert Analysis

Investigate one Elastic Security alert (or one group of related alerts) end to end: gather context, classify the threat,
document findings, and — after confirming scope with the analyst — acknowledge.

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

## Critical principles

- **Do not classify prematurely.** Gather ALL context before deciding benign, unknown, or malicious.
- **Most alerts are false positives**, even when they look alarming. Rule names such as "Malicious Behavior" and
  severity "critical" are NOT evidence.
- **"Unknown" is an acceptable outcome** and is often the correct one when evidence is insufficient.
- **Malicious requires strong corroborating evidence** — persistence plus C2, credential theft, or lateral movement —
  not a single suspicious API call.
- **Report tool output verbatim.** Copy IDs, hostnames, timestamps, and counts exactly as returned. Do not round
  numbers, abbreviate IDs, or paraphrase error messages.

See [references/classification-guide.md](references/classification-guide.md) for detailed evidence-weighting criteria,
the behavioral weight table, and common false positive sources.

## Process

### Step 1 — Fetch the alert

Retrieve the alert document with `POST /.alerts-security.alerts-*/_search`. Filter to `kibana.alert.workflow_status` not
in (`acknowledged`, `closed`), sort by `@timestamp` ascending, and take `size: 1` for the oldest unacknowledged alert —
or filter by `_id` when the analyst provides a specific alert.

Capture:

- `_id`, `_index`, `@timestamp`
- `agent.id`, `host.name`, `user.name`
- `kibana.alert.rule.name`, `kibana.alert.rule.uuid`
- `kibana.alert.reason`, `kibana.alert.severity`
- `kibana.alert.rule.threat.tactic.name`, `kibana.alert.rule.threat.technique.name`
- Key entity fields: `source.ip`, `destination.ip`, `file.hash.*`, `process.name`

Data needed: alert core fields and key entities to anchor the investigation.

### Step 2 — Find related alerts

Before gathering entity context, check whether other alerts share the same agent, user, or time window. Run a
`POST /_query` against `.alerts-security.alerts-*`:

```esql
FROM .alerts-security.alerts-* METADATA _id
| WHERE kibana.alert.workflow_status == "open"
    AND agent.id == "<agent_id>"
    AND @timestamp >= "<alert_timestamp - 2h>" AND @timestamp <= "<alert_timestamp + 2h>"
| KEEP _id, @timestamp, kibana.alert.rule.name, kibana.alert.severity, kibana.alert.workflow_status
| SORT @timestamp ASC
| LIMIT 50
```

Group related alerts by `agent.id` and a ~5-minute time window (one incident). Triage each group as a unit.

Also run a frequency check to assess false-positive risk:

```esql
FROM .alerts-security.alerts-*
| WHERE kibana.alert.rule.name == "<rule_name>"
    AND @timestamp >= NOW() - 7 days
| STATS alert_count = COUNT(*) BY kibana.alert.workflow_status
```

A very high rule frequency (hundreds of alerts per day) is a strong false-positive signal.

Data needed: related alerts on the same entity and an environment-wide frequency count for the triggering rule.

### Step 3 — Gather entity context

**This is the most important step. Do not skip or shortcut it.** Complete all substeps before forming any classification
opinion.

**Time-range rule:** alerts can be days or weeks old. NEVER use relative time such as `NOW() - 1 HOUR`. Extract the
alert's `@timestamp` and anchor every context query with a roughly ±1 hour window around that timestamp.

Run 2–4 focused queries with `POST /_query` (not 10+). Use `KEEP` to limit columns and avoid dumping full documents.

**Process tree** — who spawned what:

```esql
FROM logs-endpoint.events.process-*
| WHERE agent.id == "<agent_id>"
    AND @timestamp >= "<alert_timestamp - 5min>"
    AND @timestamp <= "<alert_timestamp + 10min>"
    AND process.parent.name IS NOT NULL
    AND process.name NOT IN ("svchost.exe", "conhost.exe", "agentbeat.exe")
| KEEP @timestamp, process.name, process.command_line, process.pid,
       process.parent.name, process.parent.pid
| SORT @timestamp ASC
| LIMIT 80
```

**Network activity** — outbound connections, DNS:

```esql
FROM logs-endpoint.events.network-*
| WHERE agent.id == "<agent_id>"
    AND @timestamp >= "<alert_timestamp - 15min>"
    AND @timestamp <= "<alert_timestamp + 30min>"
| KEEP @timestamp, process.name, destination.ip, destination.port, dns.question.name
| SORT @timestamp ASC
| LIMIT 50
```

**Index pattern reference:**

| Data type | Index pattern                    |
| --------- | -------------------------------- |
| Alerts    | `.alerts-security.alerts-*`      |
| Processes | `logs-endpoint.events.process-*` |
| Network   | `logs-endpoint.events.network-*` |
| Logs      | `logs-*`                         |

Substeps to complete before classifying:

- (a) Related alerts on the same agent or user (Step 2)
- (b) Rule frequency across the environment — high frequency is false-positive-prone
- (c) Process tree and parent-child relationships
- (d) Network activity: DNS, connections, lateral movement indicators
- (e) Behavioral investigation: persistence, C2, lateral movement, credential access

Data needed: enough corroborating evidence to justify a classification, or a clear finding that evidence is insufficient
(→ classify unknown).

### Step 4 — Assess entity risk

Before querying Entity Analytics, preflight each index with `GET /_resolve/index/{pattern}`. If an index is absent, skip
that lookup and continue.

Check the Risk Engine and asset criticality for the involved hosts and users with `POST /_query`:

```esql
FROM risk-score.risk-score-latest-*
| WHERE host.name IN ("<host>") OR user.name IN ("<user>")
| KEEP host.name, host.risk.calculated_level, host.risk.calculated_score_norm,
       user.name, user.risk.calculated_level, user.risk.calculated_score_norm
| LIMIT 10
```

```esql
FROM .asset-criticality.asset-criticality-*
| WHERE (id_field == "host.name" AND id_value IN ("<host>"))
     OR (id_field == "user.name" AND id_value IN ("<user>"))
| KEEP id_field, id_value, criticality_level
| LIMIT 10
```

High entity risk scores (normalized >80) or `extreme_impact` / `high_impact` criticality on an involved entity are
strong prioritization signals. Skip the lookups for any index the preflight reports as absent.

Data needed: entity risk level and asset criticality for the primary host or user.

### Step 5 — Determine disposition

Only after all context is gathered, decide one of:

- **True Positive** — strong corroborating evidence (persistence plus C2, credential theft, lateral movement, known
  malware hash). Escalate and recommend containment.
- **Benign True Positive** — the alert is technically correct but the activity is known-good (for example, an IT admin
  running PSExec). Create an exception to reduce noise.
- **False Positive** — the rule needs tuning to avoid this class of alerts.
- **Unknown** — insufficient evidence. This is an acceptable and often correct outcome. Document what was found and what
  is missing.

Use the evidence-weighting criteria in [references/classification-guide.md](references/classification-guide.md) to
support the disposition call.

Summarize findings for case documentation:

- 1–2 sentence summary
- Attack chain (what happened and in what order)
- IOCs: hashes, IPs, file paths
- MITRE techniques observed
- Behavioral findings
- Response context: remediation steps, credentials at risk

For case creation and alert attachment, use the **kibana-cases** skill (the canonical cross-solution cases skill). Name
the case-management operation you need.

Data needed: classification and evidence summary for documentation.

### Step 6 — Acknowledge related alerts (confirmed, irreversible)

Before acknowledging, preview the exact scope: run `POST /{index}/_count` with the same match criteria (agent ID, host,
rule name, and time window) to confirm the count. Report the count and confirm with the analyst before writing. If the
count exceeds 10,000, acknowledge in batches.

To acknowledge, collect matching alert `_id`s with `POST /.alerts-security.alerts-*/_search` (use `_source: false` and
`size: 10000`), then set their workflow status with `POST kbn:/api/detection_engine/signals/status` (see the Operations
table for the CLI equivalent). Pass the alert IDs and target status in the request body:

```json
{ "signal_ids": ["<id1>", "<id2>"], "status": "acknowledged" }
```

Use the Detection Engine API rather than writing to the alert index directly — direct writes are rejected on Serverless.
Widen the time window for longer attack chains. Report the exact number acknowledged from the response. **There is no
undo for an acknowledgement** — confirm scope first.

## Guidelines

- **Do not classify prematurely.** All five substeps in Step 3 must complete before any opinion is formed.
- **Report only tool output.** Do not invent IDs, hostnames, IPs, or details not in the tool response.
- **Preserve identifiers.** Use exact values the analyst provides; copy `_id`s, timestamps, and hostnames verbatim.
- **Distinguish facts from inference.** Label conclusions beyond tool output explicitly as your assessment.
- **Keep context gathering focused.** Run 2–4 targeted queries per alert group, not 10+. Use `KEEP` to limit columns.
- **Acknowledgement is irreversible.** Always preview with a count and prefer a narrow, well-scoped match. Pass the
  count to the analyst and wait for confirmation before writing.
- **Absolute timestamps only.** Extract `@timestamp` from the alert and build all queries around it. Never use
  `NOW() - 1 HOUR` or other relative expressions on old alerts.

## Examples

- "Fetch the next unacknowledged alert and triage it."
- "Investigate alert ID abc-123 — gather context, classify, and create a case if malicious."
- "Process the top 5 critical alerts from the last 24 hours."
- "Triage the alert group on host WIN-SRV01 from 2025-09-14."

## References

- [references/classification-guide.md](references/classification-guide.md) — evidence-weighting criteria, behavioral
  weight table, and common false positive sources
- [Elastic Security detection alerts](https://www.elastic.co/docs/solutions/security/detect-and-alert)

## Operations

| HTTP API (shorthand)                            | `elastic` CLI command                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `POST /.alerts-security.alerts-*/_search`       | `elastic es search --index '.alerts-security.alerts-*' --input-file '<query.json>'`                 |
| `POST /{index}/_search`                         | `elastic es search --index '<index>' --input-file '<query.json>'`                                   |
| `POST /{index}/_count`                          | `elastic es count --index '<index>' --input-file '<query.json>'`                                    |
| `POST /_query`                                  | `elastic es esql query --format tsv --query '<esql>'`                                               |
| `GET /_resolve/index/{pattern}`                 | `elastic es indices resolve-index --name '<pattern>'`                                               |
| `POST kbn:/api/detection_engine/signals/status` | `elastic kb security-detections-api set-alerts-status --signal-ids '<ids>' --status 'acknowledged'` |
