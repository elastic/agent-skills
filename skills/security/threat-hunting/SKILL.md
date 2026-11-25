---
name: security-threat-hunting
description: >
  Hypothesis-driven threat hunting in Elastic Security using iterative ES|QL exploration.
  Covers IOC search, anomaly identification, baseline comparison, lateral movement
  tracking, and turning hunt findings into cases and detection rules. Use when running
  a proactive hunt, investigating suspicious activity patterns, searching for indicators
  of compromise, or looking for rare events in security telemetry.
metadata:
  author: elastic
  version: 0.2.0
  universal: true
compatibility: Elasticsearch 8.x or 9.x — self-managed, Elastic Cloud Hosted, or Elastic
  Cloud Serverless — with endpoint or other security data indexed. Requires the `elastic`
  CLI with `es` support.
---

# Threat Hunting

Hunt proactively for threats that detection rules have not surfaced. Start from a specific hypothesis, explore security
data iteratively with ES|QL, separate anomalies from legitimate behavior, and document what you find.

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

- **Start with a hypothesis.** Do not explore without direction. Tie each hunt to a MITRE ATT&CK technique, a threat
  report, or a specific question about your environment.
- **Rare is not malicious.** A single-host, low-count result is a lead, not a finding. Corroborate it before escalating.
- **Zero rows does not mean clean.** It means the hypothesis is not confirmed in this window, data source, and field
  set. Say so explicitly.
- **Report tool output verbatim.** Copy hostnames, IPs, hashes, and counts exactly as returned. Do not invent details.

## Hunting approaches

| Method                | Description                                           | When to use                                                     |
| --------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| **Hypothesis-driven** | Start with a specific theory about adversary behavior | New threat intel, emerging technique, "could this happen here?" |
| **CTI-driven**        | Search for known IOCs or TTPs from threat reports     | After reading a threat report, advisory, or news                |
| **Data-driven**       | Use frequency analysis and statistical outliers       | Baseline hunting, anomaly detection, "what's unusual?"          |

## Process

### Step 1 — Formulate a hypothesis

Every hunt starts with a question. Good hypotheses are **specific, testable, and scoped**:

- **Good**: "Are there LOLBin processes making DNS queries to rare external domains in our Windows fleet?"
- **Good**: "Has any process established persistence via Run keys on a single host in the last 7 days?"
- **Bad**: "Is there malware in our environment?" (too broad, not testable)

Define the expected data sources and the time window. Use 7–30 days for behavioral patterns and shorter windows for IOC
sweeps. Sources for hypotheses:

- MITRE ATT&CK techniques relevant to your environment
- Recent threat intelligence or advisories (CTI-driven)
- Alert triage patterns, such as recurring false positives that hint at coverage gaps
- [Elastic Security Labs](https://www.elastic.co/security-labs) research

Data needed: a one-sentence hypothesis, the technique or actor it maps to, the data sources, and the time window.

### Step 2 — Identify data sources

Discover which security indices exist with `GET /_cat/indices`, then confirm field availability before you query. Run
`POST /_query` with `FROM <pattern> | LIMIT 0` to list the available fields without returning documents. Use
`GET /{index}/_mapping` only for a single concrete index: on a wildcard pattern it returns the mapping of every backing
index, which can reach megabytes. Prefer ECS field names for cross-source portability.

Common sources are in the table under [Common indices for hunting](#common-indices-for-hunting). If an index the
hypothesis depends on is absent, say so and stop or adjust the hypothesis — do not query a pattern that matches nothing.

Data needed: confirmed index patterns and the fields available in each.

### Step 3 — Explore iteratively

Run each query with `POST /_query`. Use an existing template from
[references/query-templates.md](references/query-templates.md) (lateral movement, C2 beaconing, brute force, rare
process execution) or write a custom query.

Write custom ES|QL with these principles:

- **FROM**: use the narrowest index pattern, such as `logs-endpoint.events.process-*`.
- **WHERE**: scope every query with an `@timestamp` range, such as `WHERE @timestamp >= NOW() - 7 DAYS`, and filter
  early.
- **KEEP**: select only the fields you need.
- **STATS**: use `COUNT(*)`, `COUNT_DISTINCT(host.id)`, and `VALUES()` for frequency and outlier analysis. Aggregate
  before you pull raw events to understand data volume.
- **LIMIT**: cap output, including aggregations.

Start broad to establish a baseline, then chain `WHERE` clauses to narrow. Avoid one overly complex query.

Data needed: aggregate results that show the shape of the data and which entities to examine.

### Step 4 — Identify anomalies

Look for statistical outliers using the frequency pattern: aggregate by a field, count occurrences and distinct hosts,
then keep only the rare items.

```esql
FROM logs-endpoint.events.process-*
| WHERE @timestamp > NOW() - 7 day
  AND host.os.family == "windows"
  AND event.action == "start"
| STATS count = COUNT(*), hosts = COUNT_DISTINCT(host.id) BY process.executable
| WHERE hosts == 1 AND count <= 3
| SORT count ASC
| LIMIT 50
```

Interpret results:

- **Zero rows**: the hypothesis is not confirmed in this window. Expand the lookback or adjust filters before you
  conclude anything.
- **Low count, single host**: a high-interest finding. Investigate that host.
- **High count, many hosts**: likely legitimate or systemic. Refine filters to reduce noise.
- **Aggregation outliers**: rows with `hosts == 1` or `cc == 1` in frequency hunts are the most interesting.

Use percentile and standard deviation analysis (`PERCENTILE()`, `STD_DEV()`) to find volumetric anomalies. Compare
current activity against a historical baseline before you escalate. Normalize user-specific paths and GUIDs with
`REPLACE()` before aggregating — see [references/hunting-guide.md](references/hunting-guide.md).

Data needed: a short list of anomalous entities, each with the count and host spread that made it stand out.

### Step 5 — Search for IOCs

For CTI-driven hunts, query for known-bad indicators: IP addresses, domains, file hashes, and registry keys. Use
`POST /{index}/_search` for exact-match lookups across indices, and check for related activity on the same entities
within a time window. Cross-reference findings against the threat intelligence you started from.

Data needed: which indicators matched, on which hosts, and when.

### Step 6 — Investigate findings

When a hunt returns an interesting result, pivot into deeper investigation. Query the process tree around the finding
with `POST /_query`, anchored on the finding's absolute timestamp:

```esql
FROM logs-endpoint.events.process-*
| WHERE agent.id == "<agent_id>"
  AND @timestamp >= "<finding_time - 5min>"
  AND @timestamp <= "<finding_time + 10min>"
| KEEP @timestamp, process.name, process.command_line, process.pid, process.parent.name, process.executable
| SORT @timestamp
| LIMIT 50
```

For network context, file lineage, related alerts, and entity risk pivots, see
[references/hunting-guide.md](references/hunting-guide.md). For triage of related alerts, use the
**security-alert-analysis** skill.

Data needed: enough context to classify the finding as a confirmed threat, suspicious (needs more data), or benign.

### Step 7 — Document and operationalize

Record the hypothesis, data explored, queries used, time range, and result. Then act on the finding:

- **Confirmed threat**: create a case with IOCs, MITRE techniques, and affected entities. Use the **kibana-cases** skill
  for the case-management operation. Do not leave hunt results undocumented.
- **New detection gap**: convert the hunting query into a detection rule so the coverage runs continuously. Validate the
  query against recent data before you enable the rule.
- **No findings**: record the hypothesis, query, time range, and the "no findings" result. Consider scheduling the query
  as a recurring hunt or converting it to a detection rule for continuous coverage.

Data needed: classification, evidence summary, and the chosen follow-up action.

## Common indices for hunting

| Data source        | Index pattern                     | Key fields                                                                          |
| ------------------ | --------------------------------- | ----------------------------------------------------------------------------------- |
| Endpoint processes | `logs-endpoint.events.process-*`  | `process.name`, `process.command_line`, `process.parent.name`, `process.executable` |
| Endpoint network   | `logs-endpoint.events.network-*`  | `destination.ip`, `destination.port`, `process.name`, `dns.question.name`           |
| Endpoint files     | `logs-endpoint.events.file-*`     | `file.path`, `file.name`, `event.action`                                            |
| Endpoint registry  | `logs-endpoint.events.registry-*` | `registry.path`, `registry.data.strings`, `process.name`                            |
| Security alerts    | `.alerts-security.alerts-*`       | `kibana.alert.rule.name`, `kibana.alert.severity`                                   |
| AWS CloudTrail     | `logs-aws.cloudtrail-*`           | `event.action`, `aws.cloudtrail.user_identity.type`                                 |

## Guidelines

- **Hunt with direction.** Every query serves the stated hypothesis. Stop and re-scope when it does not.
- **Aggregate before drilling down.** Use `STATS` to understand volume before you pull raw events.
- **Report only tool output.** Do not invent IDs, hostnames, IPs, or details not present in the tool response.
- **Preserve identifiers.** Use the exact values the analyst provides in queries and responses.
- **Distinguish facts from inference.** Label conclusions beyond tool output as your assessment.
- **Use absolute timestamps for pivots.** Anchor follow-up queries on the finding's `@timestamp`, not `NOW()`.
- **Validate before escalating.** Check findings against known-good baselines first.
- **Document the trail.** Future analysts need the hypothesis, queries, and results.

## Examples

- "Hunt for lateral movement using PsExec across all Windows hosts in the last 30 days."
- "Search for any signs of credential dumping or LSASS access."
- "Run a data-driven hunt for unusual outbound network connections."
- "Check whether this IP from a threat report appears anywhere in our endpoint network data."

## References

- [references/query-templates.md](references/query-templates.md) — starter ES|QL templates for lateral movement, C2
  beaconing, brute force, and rare process execution
- [references/hunting-guide.md](references/hunting-guide.md) — query design principles, hunting examples by MITRE
  tactic, and investigation pivots

## Operations

| HTTP API (shorthand)    | `elastic` CLI command                                             |
| ----------------------- | ----------------------------------------------------------------- |
| `GET /_cat/indices`     | `elastic es cat indices --index '<pattern>'`                      |
| `GET /{index}/_mapping` | `elastic es indices get-mapping --index '<index>'`                |
| `POST /_query`          | `elastic es esql query --format tsv --query '<esql>'`             |
| `POST /{index}/_search` | `elastic es search --index '<index>' --input-file '<query.json>'` |
