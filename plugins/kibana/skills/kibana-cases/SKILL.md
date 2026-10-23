---
name: kibana-cases
description: >
  Manage investigation and incident cases across Elastic Security, Observability,
  and Stack Management — create, search, update, and enrich cases with comments, alerts,
  events, and observables (IOCs). Use when tracking incidents, correlating alerts
  to a case, adding investigation notes, updating status or severity, or managing
  triage output.
metadata:
  author: elastic
  version: 0.2.0
  universal: true
compatibility: Kibana 8.x or 9.x with matching Elasticsearch — self-managed, Elastic
  Cloud Hosted, or Elastic Cloud Serverless. Cases are partitioned by solution owner
  (`securitySolution`, `observability`, or `cases`). Observables (IOCs) require a
  9.x Kibana. Requires `elastic` CLI with the `kb cases` command group.
---

# Kibana Cases

Create, search, update, and enrich Elastic cases across Security, Observability, and Stack Management. You have full
read **and write** access — never claim read-only access. Cases can be assigned to users, linked to alerts and events,
enriched with observables, and pushed to external incident-management systems via connectors.

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

## Solution context — highest-priority rule

Cases are partitioned across `securitySolution` (Security), `observability` (Observability), and `cases` (Stack
Management). A user works in exactly one. Operating in the wrong solution — or fanning out across all three — is always
a bug.

**Before any cases operation, the solution `owner` must be set**, sourced ONLY from the user naming it in plain language
("in Security", "obs cases", "Stack Management", etc.) in the current or an earlier message. Topic-keyword inference
does not count. If the owner is unset, your only valid action is to ask, verbatim:

> "Which Elastic app is this in — Security, Observability, or Stack Management?"

Once set: pass it as `owner` on every create and as the `owner` filter on every `_find`; treat it as fixed unless the
user explicitly switches. Never:

- Call `_find` (or any read) with multiple `owner` values to "cover all three" — this is the most common failure.
- Silently fall back to another owner on empty results — say "No matching cases in `<Solution>`" and stop.
- Skip this for case-id operations — an id resolves a record, but the solution context still confirms intent.

Examples:

- "find the case about the failing payment service" → ask first.
- "investigating a Suricata alert in Security — find related cases" → `securitySolution` (named directly).
- (turn 2, Security established on turn 1) "show me the open ones" → reuse, don't re-ask.
- "close case abc-123" with no prior context → ask first.

## Solution profiles

| Solution           | Typical triggers                                  | Observables (IOCs)                                                       | `critical` severity means |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------- |
| `securitySolution` | SIEM detection rules, threat hunts, manual triage | **Primary use case** — proactively track IPs, domains, file hashes, URLs | active attack in progress |
| `observability`    | APM errors, SLO violations, metric/log anomalies  | Rarely relevant — do not proactively suggest                             | complete service outage   |
| `cases`            | General-purpose, no domain assumptions            | Rarely relevant                                                          | —                         |

Domain notes: `status` flows `open` → `in-progress` → `closed`. `assignees` are user profile UIDs, not usernames.
`severity` is one of `low`, `medium`, `high`, `critical`.

## Process

1. **Establish solution context, then classify the task.** Confirm the `owner` per the rule above. Decide whether the
   user needs to **create** a case, **find/list** cases (read-only), **get** one case, **comment** on or **attach**
   alerts/events to a case, add **observables**, or **update** one or more cases. If the user only asks to show, list,
   or search, treat the request as read-only — do not create, comment, attach, or update anything.

2. **Check for an existing case before creating one.** When triaging, first search so you do not create duplicates. Call
   `GET kbn:/api/cases/_find` filtered to the owner, or `GET kbn:/api/cases/alerts/{alertId}` to see whether a specific
   alert is already attached to a case.
   - **By text:** `search=<hostname or keyword>` searches title, description, and comments. Add `status=open` to limit
     to active cases.
   - **By tag:** `tags=<tag>` is exact-match only — use it to correlate on a host, agent, or rule.

   Report the exact `total` count and each matching case verbatim. Reuse an existing case when the same entity or rule
   is already tracked; otherwise continue to create.

3. **For create tasks, build the payload.** Call `POST kbn:/api/cases` with `title`, `description`, `tags`, `severity`,
   the resolved `owner`, a `connector` (use the `none` connector unless the user asks to wire an external system), and
   `settings.syncAlerts` (default `true`). Confirm the create with the user before writing, then report the returned
   case `id` verbatim.

   ```json
   {
     "title": "Malicious DLL sideloading on host1",
     "description": "Crypto clipper malware detected via DLL sideloading...",
     "tags": ["classification:malicious", "mitre:T1574.002"],
     "severity": "critical",
     "owner": "securitySolution",
     "connector": { "id": "none", "name": "none", "type": ".none", "fields": null },
     "settings": { "syncAlerts": true }
   }
   ```

   To apply a case template, read the available templates from `GET kbn:/api/cases/configure`, then merge the template's
   fields (including any `customFields`) into the create payload.

4. **Attach alerts and events.** Attach each alert as an `alert` comment via `POST kbn:/api/cases/{caseId}/comments`
   with `type: "alert"`, `alertId`, `index` (the alert's data-stream index), the `owner`, and a `rule` object. `rule.id`
   and `rule.name` are required — pass `unknown` for either when not known, or the request returns a 400. Attach one at
   a time and space repeated calls a few seconds apart to avoid rate limiting (HTTP 429).

   ```json
   {
     "type": "alert",
     "alertId": "<alert_doc_id>",
     "index": ".ds-.alerts-security.alerts-default-2025.12.01-000013",
     "rule": { "id": "<rule_id>", "name": "Malicious Behavior Detection Alert" },
     "owner": "securitySolution"
   }
   ```

5. **Add investigation notes.** Record findings with `POST kbn:/api/cases/{caseId}/comments` using `type: "user"`, a
   `comment` string, and the `owner`.

6. **Add observables (Security).** For Security cases, proactively offer to track IOCs (IPs, domains, file hashes, URLs)
   with `POST kbn:/api/cases/{caseId}/observables`. Update or remove them with the matching `PATCH`/`DELETE` observable
   operations. Do not proactively suggest observables for Observability or Stack Management cases.

7. **For update tasks, read then patch — and batch.** Cases use optimistic concurrency, so you must send the current
   `version`. Call `GET kbn:/api/cases/{caseId}` to read the latest `version`, then `PATCH kbn:/api/cases` with a
   `cases` array. Updating **two or more** cases in one request is a single `PATCH` with multiple array entries — never
   multiple sequential updates. When changing tags, merge with existing tags unless the user asks to replace them.
   Confirm the update with the user before writing.

   ```json
   { "cases": [{ "id": "<case_id>", "version": "<case_version>", "status": "closed", "severity": "low" }] }
   ```

   On a version conflict, re-fetch the affected case and retry with the fresh `version`. Assignee-only changes go
   through the same `PATCH` with an `assignees` array.

8. **Report faithfully.** Copy case ids, titles, tags, severities, and counts exactly as returned by the API. Do not
   abbreviate ids, truncate titles, invent details, or round numbers. When the API returns zero results, state that
   explicitly.

## Reporting list and find results

1. State the exact `total` count from the JSON response (e.g., "There are 12 open cases total").
2. Present each case as a compact one-line entry: `<title> | <severity> | <case_id_short> | <created_at>`. Copy the
   **exact title** verbatim — do not rephrase, abbreviate, or summarize.
3. If the user asked for N cases, present exactly N entries (or fewer if fewer exist). Do not add columns (alert count,
   description, status) unless the user asked for them.
4. Omit fields that are null or missing. Do not add analysis or commentary after the list.

## Comments and attachments

Cases read operations return metadata only — comments and attachments are never included. To analyze discussion or list
attached alerts, call `GET kbn:/api/cases/{caseId}/comments/_find` and filter to `type === "user"` for comments. Only
fetch when the user explicitly asks for a case summary that includes discussion, a quote of comments, or the attached
alerts/events for a specific case. Never preemptively fetch for cases in a list.

## Examples

### Create a case after triage (Security)

User: "In Security, create a case for the phishing alert I triaged with severity high."

1. Owner is `securitySolution` (named). Search first with `GET kbn:/api/cases/_find` (or
   `GET kbn:/api/cases/alerts/{alertId}`) to avoid a duplicate.
2. `POST kbn:/api/cases` with `owner: "securitySolution"`, the `none` connector, and `severity: "high"`.
3. Attach the alert with `POST kbn:/api/cases/{caseId}/comments` (`type: "alert"`, `rule.id`/`rule.name` set).
4. Report the returned case `id` verbatim.

### Find open cases (read-only)

User: "Show me open Observability cases about the checkout service."

1. Owner is `observability` (named). `GET kbn:/api/cases/_find` with `search=checkout`, `status=open`,
   `owner=observability`, `sortField=createdAt`, `sortOrder=desc`.
2. Report the exact `total` and each title verbatim. Do not mutate anything.

### Close several cases at once

User: "Close cases abc-123, def-456, and ghi-789."

1. `GET` each case for its current `version`.
2. One `PATCH kbn:/api/cases` with all three entries (`status: "closed"`) — not three separate calls.

### Ambiguous — ask first

User: "Find the case about the failing payment service."

1. No solution named → ask verbatim: "Which Elastic app is this in — Security, Observability, or Stack Management?"

## Guidelines

- Report only tool output — do not invent ids, hostnames, IPs, or details not present in the response.
- Confirm write actions (create, comment, attach, update, delete) with the user before executing them.
- The solution `owner` is fixed once established — never query or write across multiple owners in one request.
- `_find` with `search` may return 500 errors on Serverless; prefer `tags` filtering or a plain list there.
- `tags` filtering is exact-match only — partial matches do not work.
- Attach alerts one at a time via the public comments endpoint; the bulk attachment endpoint is internal (see
  [Operations](#operations)).
- For non-default Kibana Spaces, prefix paths with `kbn:/s/<space_id>/api/cases/...`.

## Common pitfalls

1. **Missing solution context** — creating or searching without a confirmed `owner`.
2. **Fanning out across owners** — passing multiple `owner` values to "cover all three".
3. **Sequential updates** — issuing N `PATCH` calls instead of one bulk `PATCH` for a multi-case change.
4. **Stale version** — `PATCH` without a fresh `GET` returns a version conflict.
5. **Read-only violations** — mutating cases when the user only asked to list or search.
6. **Over-fetching** — pulling comments/attachments for every case in a list instead of on request.

## References

- [references/kibana-cases-api.md](references/kibana-cases-api.md) — Endpoints, request/response shapes, query params
- [Kibana Cases API](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-cases)

## Operations

| HTTP API (shorthand)                                 | `elastic` CLI command                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `POST kbn:/api/cases`                                | `elastic kb cases create-case --input-file '<case.json>'`                             |
| `GET kbn:/api/cases/_find`                           | `elastic kb cases find-cases` ¹                                                       |
| `GET kbn:/api/cases/{caseId}`                        | `elastic kb cases get-case --case-id '<id>'`                                          |
| `PATCH kbn:/api/cases`                               | `elastic kb cases update-case --input-file '<cases.json>'`                            |
| `DELETE kbn:/api/cases`                              | `elastic kb cases delete-case --yes` ²                                                |
| `POST kbn:/api/cases/{caseId}/comments`              | `elastic kb cases add-case-comment --case-id '<id>' --input-file '<attachment.json>'` |
| `GET kbn:/api/cases/{caseId}/comments/_find`         | `elastic kb cases find-case-comments --case-id '<id>'`                                |
| `GET kbn:/api/cases/{caseId}/alerts`                 | `elastic kb cases get-case-alerts --case-id '<id>'`                                   |
| `GET kbn:/api/cases/alerts/{alertId}`                | `elastic kb cases get-cases-by-alert --alert-id '<id>' [--owner '<owner>']`           |
| `GET kbn:/api/cases/configure`                       | `elastic kb cases get-case-configuration`                                             |
| `POST kbn:/api/cases/{caseId}/observables`           | _(no CLI binding — use HTTP shorthand)_                                               |
| `PATCH kbn:/api/cases/{caseId}/observables/{obsId}`  | _(no CLI binding — use HTTP shorthand)_                                               |
| `DELETE kbn:/api/cases/{caseId}/observables/{obsId}` | _(no CLI binding — use HTTP shorthand)_                                               |

¹ `find-cases` exposes no filter flags in the current CLI release; for `owner`, `status`, `tags`, `search`, and
pagination, run `GET kbn:/api/cases/_find` with query params via the HTTP transport directly.

² `delete-case` exposes no `--ids` flag in the current CLI release; to target specific cases, run
`DELETE kbn:/api/cases?ids=<json-array>` via the HTTP transport directly.

**Internal-only endpoints (no public binding).** Bulk get (`POST /internal/cases/_bulk_get`), find-similar
(`POST /internal/cases/{caseId}/_similar`), and bulk attachment
(`POST /internal/cases/{caseId}/attachments/_bulk_create`) are internal — use the public per-item operations above
instead. Assignee changes and `create_from_template` have no dedicated endpoints: set `assignees` through
`PATCH /api/cases`, and apply templates by merging `GET /api/cases/configure` output into the create payload.
