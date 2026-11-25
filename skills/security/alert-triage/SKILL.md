---
name: security-alert-triage
description: >
  Prioritize and rank the Elastic Security alert queue by weighted risk — base risk
  score, MITRE tactic boost, entity risk, and asset criticality — then cluster alerts
  into entity groups. Use when an analyst asks what to focus on, which alerts are
  most urgent, or wants a ranked starting point across the queue before deeper investigation
  begins.
metadata:
  author: elastic
  version: 0.2.0
  universal: true
compatibility: 'Kibana 8.x or 9.x with matching Elasticsearch — self-managed, Elastic
  Cloud Hosted, or Elastic Cloud Serverless. Read-only: no alerts are acknowledged,
  updated, or moved during this skill. Entity Analytics enrichment is optional and
  degrades cleanly when the Risk Engine or asset criticality data is unavailable.
  Requires the `elastic` CLI with `es` support.'
---

# Alert Triage

Prioritize the Elastic Security alert queue by weighted risk and return ranked entity groups — a starting point before
investigation begins, not an investigation itself.

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

## When to use this skill

Use this skill when:

- An analyst asks "what should I focus on right now?" or "which alerts are most urgent?"
- An analyst wants to prioritize the queue for a specific time window (for example, "last 8 hours")
- An analyst provides a set of alert IDs and asks "which of these are most important?"
- An analyst is starting a shift and needs a ranked starting point before investigation begins

Do not use this skill to investigate a single known alert — use the **security-alert-analysis** skill for that. This
skill does not acknowledge alerts, create cases, or gather per-alert context. Those actions belong in the investigation
phase.

## Scoring model

The score for each alert is computed as:

```text
alert_score = base_risk_score + mitre_boost + status_modifier
group_score = MAX(alert_score across group) + entity_risk_boost + asset_criticality_boost
```

The weights, mirroring the Kibana Agent Builder alert-triage skill, are:

| Signal                | Level                                                                   | Boost |
| --------------------- | ----------------------------------------------------------------------- | ----- |
| MITRE tactic          | Exfiltration, Impact, Command and Control, Lateral Movement             | +30   |
| MITRE tactic          | Credential Access, Privilege Escalation, Defense Evasion                | +20   |
| MITRE tactic          | Persistence, Execution, Initial Access                                  | +10   |
| Workflow status       | Alert is `acknowledged`                                                 | −5    |
| Workflow status       | Alert already attached to a case (`kibana.alert.case_ids` is non-empty) | −5    |
| Entity Analytics risk | `Critical`                                                              | +25   |
| Entity Analytics risk | `High`                                                                  | +15   |
| Entity Analytics risk | `Moderate`                                                              | +5    |
| Asset criticality     | `extreme_impact`                                                        | +20   |
| Asset criticality     | `high_impact`                                                           | +12   |
| Asset criticality     | `medium_impact`                                                         | +6    |

Status modifiers are additive: an acknowledged alert already in a case receives −10 total. Entity Analytics enrichment
is best-effort; when the Risk Engine or asset criticality index is absent, both boosts are 0 and scoring continues
normally.

## Process

### Step 1 — Establish scope

Decide:

- **Time window**: default 24 hours, range 1–168 hours.
- **Workflow filter**: `"open"` (default) or `"open+acknowledged"` to include acknowledged alerts.
- **Specific alert IDs**: when the user supplies alert IDs, score exactly those and skip the time-window and
  workflow-status filters so a selected alert is never silently dropped regardless of age or status.

Data needed: time window or alert IDs; workflow scope.

### Step 2 — Fetch and score the queue

Run one `POST /_query` with ES|QL. Elasticsearch computes every score field; no arithmetic is needed after the query
returns.

Queue path (no explicit IDs):

```esql
FROM .alerts-security.alerts-* METADATA _id, _index
| WHERE kibana.alert.workflow_status == "open"
    AND @timestamp >= NOW() - 24 hours
    AND kibana.alert.building_block_type IS NULL
| EVAL tactics = COALESCE(MV_CONCAT(kibana.alert.rule.threat.tactic.name, "|"), "")
| EVAL mitre_boost = CASE(
    tactics LIKE "*Exfiltration*" OR tactics LIKE "*Impact*"
        OR tactics LIKE "*Command and Control*" OR tactics LIKE "*Lateral Movement*", 30,
    tactics LIKE "*Credential Access*" OR tactics LIKE "*Privilege Escalation*"
        OR tactics LIKE "*Defense Evasion*", 20,
    tactics LIKE "*Persistence*" OR tactics LIKE "*Execution*"
        OR tactics LIKE "*Initial Access*", 10,
    0)
| EVAL status_modifier = CASE(kibana.alert.workflow_status == "acknowledged", -5, 0)
                       + CASE(kibana.alert.case_ids IS NULL, 0, -5)
| EVAL alert_score = COALESCE(kibana.alert.risk_score, 0) + mitre_boost + status_modifier
| EVAL entity = CASE(
    host.name IS NOT NULL, CONCAT("host:", MV_FIRST(host.name)),
    user.name IS NOT NULL, CONCAT("user:", MV_FIRST(user.name)),
    CONCAT("ungrouped:", _id))
| KEEP _id, _index, @timestamp, entity, host.name, user.name, kibana.alert.rule.name,
       kibana.alert.severity, kibana.alert.workflow_status, kibana.alert.risk_score,
       mitre_boost, status_modifier, alert_score
| SORT alert_score DESC, @timestamp DESC
| LIMIT 100
```

For the explicit-IDs path, replace the `WHERE` clause with `WHERE _id IN ("<id1>", "<id2>", ...)` and keep all other
stages, but raise `LIMIT` to the number of IDs (maximum 500) so a selected alert is never truncated. This path also
drops the building-block exclusion on purpose: an alert the analyst selects explicitly is always scored, even if it is a
building block. Kibana keeps that filter on both paths.

For `"open+acknowledged"` scope, change `kibana.alert.workflow_status == "open"` to
`kibana.alert.workflow_status IN ("open", "acknowledged")`.

**Query design notes:**

- `METADATA _id` is required. The top alert `_id` per group is mandatory output — analysts use it to hand off to
  investigation or file a case directly.
- `kibana.alert.building_block_type IS NULL` excludes building-block alerts (sub-components of parent alerts) the same
  way the Kibana skill does with `must_not exists`.
- `MV_FIRST` on `host.name` / `user.name` gives a stable group key when a field has multiple values.
- `CASE` tiers are ordered 30 → 20 → 10, so the first match wins. This reproduces Kibana's per-tactic maximum without an
  elementwise operation.
- `kibana.alert.rule.threat.tactic.name` is a flat `keyword` field in the alerts mapping. `MV_CONCAT` collapses any
  multi-value results into one string that `LIKE` can match across all values.

Data needed: scored alert rows with entity key, top alert `_id`, and score breakdown.

### Step 3 — Cluster into entity groups

Rows arrive sorted by `alert_score` descending. For each distinct `entity` value, the **first** row is the group's top
alert and the row count is `alert_count`. Group by `entity` value.

Kibana uses a transitive union-find algorithm, so an alert that mentions both host A and user B merges both into one
group. This skill keys on the primary entity (host first, then user) to match Kibana's primary-entity selection while
keeping the ES|QL approach simple. Groups may differ from Kibana's on alerts that bridge a host and a user; document
this if analysts report discrepancies.

Kibana also applies entity risk and asset criticality boosts to every group before it takes the top 10. This skill
selects the top 10 by base score and then enriches only those, so a group ranked 11th or lower on base score can't
surface through enrichment boosts. Document this if analysts report a missing high-criticality group.

Return at most 10 ranked groups — the long tail is not useful at the prioritization stage.

Data needed: per-entity group with `alert_count`, top alert `_id`, top rule name, severity, and `alert_score` breakdown
(base + MITRE boost + status modifier).

### Step 4 — Enrich the top groups (best-effort)

Before querying Entity Analytics, preflight each index with `GET /_resolve/index/{pattern}`. If either index is absent
or returns no results, skip the corresponding boost (set to 0) and continue.

When the Risk Engine is available, look up the primary entity of each of the top 10 groups:

```esql
FROM risk-score.risk-score-latest-*
| WHERE host.name IN ("<host1>", "<host2>") OR user.name IN ("<user1>", "<user2>")
| KEEP host.name, host.risk.calculated_level, host.risk.calculated_score_norm,
       user.name, user.risk.calculated_level, user.risk.calculated_score_norm
| LIMIT 50
```

When asset criticality is available:

```esql
FROM .asset-criticality.asset-criticality-*
| WHERE (id_field == "host.name" AND id_value IN ("<host1>", "<host2>"))
     OR (id_field == "user.name" AND id_value IN ("<user1>", "<user2>"))
| KEEP id_field, id_value, criticality_level
| LIMIT 50
```

Add the entity risk boost and asset criticality boost to each group's score using the weight table above. Re-sort the
ten groups by updated `group_score`.

When an entity enrichment re-ranks a group above a higher base-score peer, explain why: cite the entity risk level and
asset criticality boost explicitly.

Data needed: entity risk level and asset criticality for the primary entity of each top group.

### Step 5 — Rank and report

Sort the ten groups by `group_score` descending. Summarize the top 2–3 groups in detail; list the remaining groups
briefly.

For each top group, report:

- The entity or context (for example, "4 alerts on host WIN-SRV01")
- The group score and what drove it (base risk + MITRE boost + entity risk + asset criticality)
- The primary entity's risk level and asset criticality when present (copy values verbatim, for example `Critical`,
  `extreme_impact`)
- Whether any alerts are acknowledged or already in a case (with the score modifier noted)
- The top alert rule names in the group
- **The top alert `_id` verbatim** — this is mandatory, not optional

End with a brief summary of the total alerts assessed and the number of groups identified.

Recommend the **security-alert-analysis** skill by name as the next step for any group the analyst wants to investigate
further.

## Guidelines

- **This skill is read-only.** Do not acknowledge alerts, create cases, or run investigation queries. All writes belong
  in security-alert-analysis.
- **Do not deep-investigate.** Prioritization is the output; investigation is the next step.
- **Copy identifiers verbatim.** `entityRiskLevel`, `assetCriticality`, `entityName`, and alert `_id`s must be copied
  exactly from tool output. Do not paraphrase level names or abbreviate IDs.
- **Explain re-rankings.** When entity enrichment lifts a group above a peer with a higher base score, explain why —
  cite the specific boost components.
- **Acknowledged alerts are deprioritized, not hidden.** Flag the −5 modifier and surface the group.
- **Building-block alerts are excluded automatically** by the `kibana.alert.building_block_type IS NULL` filter.
- **If the queue is empty**, tell the analyst no open alerts match the criteria and suggest widening the time window or
  changing the workflow scope.

## Examples

**Query**: "What should I focus on right now?"

Scope: `{ timeWindowHours: 24, workflowStatus: "open" }`. Run the queue path, cluster, enrich, and return the top 10
groups.

**Query**: "Prioritize alerts from the last 8 hours"

Scope: `{ timeWindowHours: 8, workflowStatus: "open" }`. Adjust the `@timestamp` filter to `>= NOW() - 8 hours`.

**Query**: "Which of these alerts should I look at first?" (with alert IDs)

Scope: `{ alertIds: ["<id1>", "<id2>", ...] }`. Use the explicit-IDs path so a selected alert that is acknowledged or
old is never silently dropped.

**Query**: "Prioritize the queue. Include acknowledged alerts."

Scope: `{ timeWindowHours: 24, workflowStatus: "open+acknowledged" }`. Adjust the workflow filter in the ES|QL `WHERE`
clause.

## Response format

Present results as ranked groups. The top alert `_id` is required in every group — analysts use it to hand off to
investigation directly.

```text
**Group 1 — [entity or context]** (score: N)
- Alerts: N alerts | Top rule: [rule name] | Severity: critical/high
- Score drivers: base risk [N] + MITRE tactic boost [+N, tactic name] + entity risk [+N, level] + asset criticality [+N, level]
- Entity signals: risk level [Critical/High/…], asset criticality [extreme_impact/…] (omit if unavailable)
- Status: [N acknowledged (−5 each), N in a case (−5 each)] (omit if none)
- **Top alert ID: [exact _id from the query result]**
- Recommended next step: investigate with security-alert-analysis

**Group 2 — [entity or context]** (score: N)
…
```

End with: "Total alerts assessed: N across M groups."

## References

- [Elastic Security detection alerts](https://www.elastic.co/docs/solutions/security/detect-and-alert)
- [Entity Analytics risk scoring](https://www.elastic.co/docs/solutions/security/advanced-entity-analytics/entity-risk-scoring)
- [Asset criticality](https://www.elastic.co/docs/solutions/security/advanced-entity-analytics/asset-criticality)

## Operations

| HTTP API (shorthand)            | `elastic` CLI command                                 |
| ------------------------------- | ----------------------------------------------------- |
| `POST /_query`                  | `elastic es esql query --format tsv --query '<esql>'` |
| `GET /_resolve/index/{pattern}` | `elastic es indices resolve-index --name '<pattern>'` |

This skill is read-only. Acknowledgement and case management operations are deliberately not bound here — use the
**security-alert-analysis** skill for those operations.
