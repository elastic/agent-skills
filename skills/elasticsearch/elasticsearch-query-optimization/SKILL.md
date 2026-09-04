---
name: elasticsearch-query-optimization
description: >
  Diagnose slow Elasticsearch Query DSL searches and propose measured fixes. Use when
  a search is slow, profile output shows an expensive clause, exact-match filters
  sit in scoring context, or leading wildcards dominate latency. Ground every recommendation
  in search profiling — move non-scoring clauses to filter context, eliminate leading
  wildcards, and re-profile to confirm improvement.
metadata:
  author: elastic
  version: 0.1.0
  universal: true
compatibility: Elasticsearch 8.x or 9.x, self-managed, Elastic Cloud Hosted, or Elastic
  Cloud Serverless; relies on the search profiling API available on all deployment
  types. Requires the `elastic` CLI ≥ 0.2 with `stack es` support.
---

# Elasticsearch Query DSL Optimization

Diagnose why a Query DSL search is slow, identify the dominant cost from the profile (not guesswork), rewrite the query
to remove that cost while preserving match semantics, and re-measure with profiling enabled.

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

> **Scope:** Query DSL searches via `POST /{index}/_search`. This skill does not migrate queries to ES|QL — it optimizes
> the existing bool/match/term/wildcard structure the user already runs.
>
> **Ground rule:** Never recommend "add shards" or "scale hardware" as the primary fix when the profile names a specific
> clause (for example `WildcardQuery` at ~3.8s). Fix the query first; infrastructure changes require evidence the query
> is already optimal.

## Process

1. **Confirm connectivity and locate the target index.** Call `GET /`. If the call fails, stop — do not guess endpoints
   or credentials. When the user names an index pattern (for example `logs-*`), narrow candidates with
   `GET /_cat/indices` and pick the index or pattern the query actually targets.

   **Decision:** proceed only when the index is known. **Data needed:** index name or pattern, and the slow Query DSL
   body (from the user or from a saved search).

2. **Profile the slow query to find the dominant cost.** Call `POST /{index}/_search` with `"profile": true` and the
   user's query unchanged. Read `took`, then inspect `profile.shards[].searches[].query` — sort child collectors by
   `time_in_nanos` and identify the top contributor.

   **Decision:** classify the bottleneck from profile evidence:
   - **`TermQuery` / `PointRangeQuery` / `MatchNoDocsQuery` inside `must` alongside a scoring clause** — exact-match or
     range filters are being scored unnecessarily. Likely fix: move them to `filter` context (step 4a).
   - **`WildcardQuery` with a leading `*` (for example `message:*timeout*`)** — cannot use the inverted index; scans
     terms per document. Likely fix: remove the leading wildcard (step 4b).
   - **`MatchQuery` on a `text` field** — expected scoring cost; optimize only if profile shows it dominates _after_
     filter-context fixes.
   - **High `aggregation` time** — separate from query tuning; profile the agg tree (out of scope unless the user asked
     about aggs).

   **Data needed:** profile tree with `type`, `description`, `time_in_nanos`, and `breakdown` (especially `next_doc` for
   wildcards). Quote the top contributor verbatim when explaining the diagnosis.

3. **Inspect field mappings before rewriting.** Call `GET /{index}/_mapping`. For every clause you will move or rewrite,
   confirm the field type:
   - **`term` / `terms` / `filter` on exact values** — field must be `keyword` (or another non-analyzed type). A `term`
     on a `text` field is a common bug; if types are wrong, say so and suggest the correct sub-field (for example
     `service.keyword`) or a mapping change — do not silently rewrite.
   - **`match` / `match_phrase`** — target a `text` field (analyzed).
   - **`wildcard`** — works on `keyword` or `wildcard` types; leading `*` still forces a scan regardless of type.

   **Decision:** only propose rewrites that match confirmed types. **Data needed:** mapping for each field referenced in
   the query.

4. **Rewrite the query to remove the profiled bottleneck.**

   ### 4a. Move non-scoring clauses from `must` to `filter`

   When exact-match `term`/`terms`/`range`/`match` on a keyword (or other non-scoring intent) clauses sit in `must`
   alongside a full-text `match` that should drive relevance:
   - Move exact-match clauses into `bool.filter` (or a `filter` array entry).
   - Keep only clauses that must affect `_score` in `bool.must` (typically the full-text `match`).

   **Why:** filter context skips scoring and participates in the filter/bitset cache on repeated queries. **Semantics:**
   the same documents match; only scoring and performance change — state this explicitly.

   Example rewrite pattern:

   ```json
   {
     "query": {
       "bool": {
         "filter": [{ "term": { "status": "active" } }, { "term": { "tenant_id": "acme" } }],
         "must": [{ "match": { "description": "wireless keyboard" } }]
       }
     }
   }
   ```

   ### 4b. Eliminate leading wildcards

   When the profile shows `WildcardQuery` with `description` like `message:*timeout*` and high `next_doc` time, the
   leading `*` prevents index lookup. Choose a fix based on mapping and user intent (substring vs prefix vs exact):

   | Intent                       | Preferred rewrite                                                |
   | ---------------------------- | ---------------------------------------------------------------- |
   | Full-text substring in logs  | `match` or `match_phrase` on the analyzed `message` `text` field |
   | Literal substring on keyword | `wildcard`-typed field, or reindex with ngram analyzer           |
   | Prefix only (`timeout*`)     | `prefix` query on `keyword`, or edge ngram at index time         |

   Also move any non-scoring exact match (for example `{ "match": { "service": "checkout" } }` on a keyword) into
   `filter` — use `term` on the keyword field when the mapping confirms it.

   Example rewrite pattern:

   ```json
   {
     "query": {
       "bool": {
         "filter": [{ "term": { "service.keyword": "checkout" } }],
         "must": [{ "match": { "message": "timeout" } }]
       }
     }
   }
   ```

   Adjust field names (`service` vs `service.keyword`) to match the mapping from step 3.

   ### 4c. Optional — validate rewrite before profiling

   When semantics are uncertain (for example changing `wildcard` to `match` may include analyzed tokens the wildcard
   excluded), call `POST /{index}/_validate/query?explain=true` with the rewritten query and read the explanation for
   obvious mismatches.

   **Decision:** pick the smallest rewrite that addresses the profiled cost. **Data needed:** rewritten Query DSL body.

5. **Re-profile the rewritten query and compare.** Call `POST /{index}/_search` again with `"profile": true` and the
   rewritten query. Compare `took` and the top profile collector to the baseline from step 2.

   **Decision:** report success only when the dominant collector changed or `time_in_nanos` dropped materially. If the
   profile still shows a leading wildcard or scored filters, iterate — do not declare victory from `took` alone without
   profile confirmation.

   **Data needed:** before/after profile summaries (top collector `type`, `description`, `time_in_nanos`).

6. **Report findings in this order.**
   1. **Root cause** — quote the profile (for example "`WildcardQuery` `message:*timeout*` ≈ 3.8s, mostly `next_doc`").
   2. **Rewrite** — show the optimized bool structure with filter vs must separation.
   3. **Mapping notes** — keyword vs text confirmations from `GET /{index}/_mapping`.
   4. **Measured improvement** — before/after profile or `took` from step 5.
   5. **Semantic caveat** — only if the rewrite could change which documents match (for example `match` vs substring
      `wildcard`).

## Guidelines

- **Profile first.** If the user supplies a profile summary, use it — but still recommend re-profiling after changes.
- **Filter is for equality, must is for relevance.** Status, tenant ID, service name, and time ranges rarely belong in
  `must` when a text query drives ranking.
- **Leading wildcards are almost never the right fix for log search.** Prefer analyzed `match`/`match_phrase`; reserve
  `wildcard` for suffix patterns (`timeout*`) on keyword or `wildcard`-typed fields.
- **Do not conflate slow with wrong.** A slow query can return correct results; optimization preserves the result set
  unless you explicitly warn about a semantic trade-off.
- **Deep reference:** profile collector types, filter-cache behavior, and wildcard alternatives —
  [references/query-optimization-reference.md](references/query-optimization-reference.md).

## Examples

### Unscored terms in `must`

**Input:** `bool.must` contains `term` on `status`, `term` on `tenant_id`, and `match` on `description`.

**Diagnosis:** profile shows scored `TermQuery` collectors alongside `MatchQuery`; exact filters do not need scoring.

**Fix:** move both `term` clauses to `filter`; keep `match` in `must`. Confirm `status` and `tenant_id` are `keyword`.

### Leading wildcard dominates latency

**Input:** `wildcard` `message:*timeout*` plus `match` on `service` in `must`. Profile: `WildcardQuery` ~3.8s.

**Diagnosis:** leading `*` forces term enumeration; not an index/shard problem.

**Fix:** `match` on analyzed `message`; move service to `filter` as `term` on keyword. Re-profile — expect
`WildcardQuery` to disappear or shrink to negligible time.

## Operations

| HTTP API (shorthand)                         | `elastic` CLI command                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /`                                      | `elastic es info`                                                                     |
| `GET /_cat/indices`                          | `elastic es cat indices --index '<pattern>'`                                          |
| `GET /{index}/_mapping`                      | `elastic es indices get-mapping --index '<index>'`                                    |
| `POST /{index}/_search`                      | `elastic es search --index '<index>' --input-file '<search-body.json>'`               |
| `POST /{index}/_validate/query?explain=true` | `elastic es indices validate-query --index '<index>' --explain true --query '<json>'` |

Include `"profile": true` in the search JSON body (or pass `--profile true`) when profiling in steps 2 and 5.
