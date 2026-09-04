---
name: elasticsearch-search-relevance
description: >
  Improve Elasticsearch search relevance for content and catalog indices: pin or promote
  results with query rules (correct rule type, criteria, and rule-query wiring) and
  tune organic ranking with multi_match, field boosts, and analysis grounded in the
  index mapping. Use when search results rank poorly, a specific document must appear
  first for a query, or the user asks to tune full-text matching — not for ES|QL analytics,
  index ingest, or cluster health.
metadata:
  author: elastic
  version: 0.1.0
  universal: true
compatibility: Elasticsearch 8.10 or later (query rules), self-managed, Elastic Cloud
  Hosted, or Elastic Cloud Serverless. Requires the `elastic` CLI ≥ 0.2 with `stack
  es` support.
---

# Elasticsearch Search Relevance

Improve full-text search results on content and catalog indices. Diagnose the mapping and current query, choose the
right relevance lever (query rules for deterministic pinning vs multi_match and field boosts for organic ranking), apply
the change, and verify top hits before reporting success.

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

## Scope

This skill covers **Query DSL** relevance on indices with `text` (and optional `keyword`) fields — product catalogs,
documentation, knowledge bases. It uses `POST /{index}/_search` for evaluation and query-rules APIs for pinned or
excluded documents.

Out of scope:

- ES|QL search (`POST /_query`) — use the `elasticsearch-esql` skill.
- Semantic / vector / hybrid retrieval — different field types and retrievers.
- Sorting by price, date, or popularity **instead of** fixing text relevance unless the user explicitly wants
  non-relevance ordering.

## Relevance levers

| User intent                                | Lever                                                       | APIs                                                         |
| ------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------ |
| Always show document X first for query Q   | Query rules — `pinned` rule + `rule` query in search        | `PUT /_query_rules/{ruleset_id}`, `POST /{index}/_search`    |
| Hide specific documents for query Q        | Query rules — `exclude` rule + `rule` query                 | Same                                                         |
| Better ranking for open-ended text queries | `multi_match` across mapped `text` fields with field boosts | `POST /{index}/_search`                                      |
| Tokens not matching user language          | Operator, `minimum_should_match`, or synonym analyzers      | `POST /{index}/_search`, optionally `POST /{index}/_analyze` |

**Decision rule:** If the user names a document that must rank first for a specific query, use query rules. If results
are generally weak for a phrase, tune the organic query from the mapping. Do not simulate pinning with extreme boosts,
`function_score`, or sort clauses.

## Process

1. **Inspect the mapping and current query.** Call `GET /` to confirm connectivity. When the index is unknown, narrow
   candidates with `GET /_cat/indices`, then call `GET /{index}/_mapping`.

   From the mapping, list every `text` field (e.g., `title`, `description`) and every `keyword` field used for filters
   (`brand`, `category`). Note which fields are short (precision) vs long (recall). Read the user's current search body
   if provided — identify which fields it queries and whether it already uses `rule`, `multi_match`, or single-field
   `match`.

   **Decision:** Is the problem **deterministic promotion** (one doc must win for one query) or **organic ranking**
   (several docs should score better)? **Data needed:** index name, mapping properties, current query JSON, example
   query strings, and target document ID(s) when pinning.

2. **Choose the relevance lever.** Apply the decision from step 1:
   - **Pinning / promotion** → Create a query-rules ruleset with a rule of type `pinned` (never `exclude` for
     promotion). Set `criteria` so the rule fires only for the intended query text — e.g., `contains` or `exact` on a
     metadata key such as `query_string` with value `"sale"`. Set `actions` to pin the correct document via `ids` (e.g.,
     `["SKU123"]`) or `docs` (e.g., `[{"_index":"catalog","_id":"SKU123"}]`). Use `docs` when `_id` may not be unique
     across indices. Read [Query Rules Reference](references/query-rules-reference.md) for full structure.

   - **Organic ranking** → Replace single-field `match` on a long field with `multi_match` across the mapped `text`
     fields. Boost short fields (typically `title^2` with `description` unboosted). Consider `operator`,
     `minimum_should_match`, or synonym-aware analyzers when multi-word recall is still poor — but do **not** sort by
     price, date, or keyword fields to fake better text relevance, and do **not** query `.keyword` sub-fields with
     `term` for analyzed user phrases. Read [Multi-Match Tuning](references/multi-match-tuning.md).

   **Decision:** Pick exactly one primary lever per request. **Data needed:** chosen fields and boosts, ruleset ID and
   rule ID names, criteria metadata keys, and pinned document identifiers.

3. **Apply the change.** Execute the APIs for the chosen lever:

   **Query rules path**
   - Create or replace the ruleset with `PUT /_query_rules/{ruleset_id}` (or add one rule with
     `PUT /_query_rules/{ruleset_id}/_rule/{rule_id}`).
   - Confirm structure with `GET /_query_rules/{ruleset_id}`.
   - Validate criteria with `POST /_query_rules/{ruleset_id}/_test` using the same `match_criteria` you will pass at
     search time.
   - **Wire the search:** `POST /{index}/_search` must use a `rule` query whose `ruleset_id` references the ruleset and
     whose `match_criteria` supplies values for every criteria `metadata` key (e.g., `"query_string": "sale"`). Place
     the normal relevance clause inside `organic`. **Creating the ruleset alone does not pin anything** — the pin
     applies only when search includes the `rule` query.

   **Organic tuning path**
   - Build a candidate `multi_match` (or equivalent bool/should) query from the mapping.
   - Optionally inspect analysis with `POST /{index}/_analyze` on sample query text when tokenization explains misses.

   **Decision:** Stop after one coherent change set; avoid stacking unrelated edits before testing.

4. **Test and compare top hits.** Before and after each candidate, call `POST /{index}/_search` with the same `size` (≥
   10), the user's query string, and `"track_scores": true`. For pinning, the search body **must** include the `rule`
   query from step 3.

   Compare for each run:
   - Top `_id` values and order
   - `_score` where relevant
   - Key `_source` fields (`title`, `description`, product id)

   For pinning, confirm the target document (e.g., `SKU123`) is **first** when `match_criteria` matches the query and
   that organic matches still appear below. For organic tuning, confirm titles and intent-aligned documents rise without
   relying on sort or keyword exact-match hacks.

   **Decision:** Ship the candidate that wins on evidence; if none improve results, report what was tried and propose
   the next lever (e.g., synonyms or additional fields). **Data needed:** side-by-side top-hit lists from baseline and
   candidate queries.

## Examples

### Pin SKU123 for query "sale" on `catalog`

**Wrong:** Boost `SKU123`, sort by `_id`, or create a ruleset without a `rule` search query.

**Right:**

1. `PUT /_query_rules/catalog-sale-pin` with a `pinned` rule, criteria matching query text `"sale"`, actions pinning
   `SKU123`.
2. `POST /catalog/_search` with:

```json
{
  "query": {
    "rule": {
      "ruleset_id": "catalog-sale-pin",
      "match_criteria": { "query_string": "sale" },
      "organic": {
        "multi_match": {
          "query": "sale",
          "fields": ["title^2", "description"]
        }
      }
    }
  },
  "size": 10
}
```

Verify `SKU123` is hit #1 and remaining hits are organic matches below the pin.

### Improve "running shoes" when only `description` is searched

Mapping provides `title` and `description` as `text`, plus `brand` and `category` as `keyword`.

**Wrong:** Keep `match` on `description` only; sort by price; `term` query on `title.keyword`.

**Right:**

1. Baseline: `POST /catalog/_search` with the user's current `match` on `description`; record top hits.
2. Candidate: `POST /catalog/_search` with:

```json
{
  "query": {
    "multi_match": {
      "query": "running shoes",
      "fields": ["title^2", "description"],
      "type": "best_fields",
      "operator": "or",
      "minimum_should_match": "75%"
    }
  },
  "size": 10
}
```

1. Compare top hits — documents with "running shoes" in `title` should rank above description-only matches. If recall is
   still thin, consider synonym expansion in a follow-up iteration (not sort-by-price).

## Guidelines

- **Ground every field name in the mapping** — never invent `name`, `content`, or `body` without checking
  `GET /{index}/_mapping`.
- **Query rules for pins, boosts for ranking** — merchandising belongs in query rules; field boosts belong in organic
  queries.
- **Match criteria wiring is mandatory** — `metadata` keys in rule criteria must appear in the search
  `rule.match_criteria` object with the runtime values (typically the user's query string).
- **Test before claiming success** — run baseline and candidate searches; cite top-hit changes.
- **Keyword fields filter; text fields search** — use `keyword` fields in `filter` context, not as the primary full-text
  target for natural language.
- **Always deliver the concrete artifact** — even when you cannot connect to a cluster to verify, produce the full
  ruleset JSON (for pinning) or the candidate query body (for organic tuning), then explain how to verify once the
  connection is available. Never stop at a high-level outline.

## References

- [Query Rules Reference](references/query-rules-reference.md) — criteria types, `pinned` actions, ruleset JSON, `rule`
  query wiring, test API
- [Multi-Match Tuning](references/multi-match-tuning.md) — field boosts, operators, testing discipline, anti-patterns

## Operations

| HTTP API (shorthand)                             | `elastic` CLI command                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                                          | `elastic es info`                                                                                                           |
| `GET /_cat/indices`                              | `elastic es cat indices --index '<pattern>'`                                                                                |
| `GET /{index}/_mapping`                          | `elastic es indices get-mapping --index '<index>'`                                                                          |
| `PUT /_query_rules/{ruleset_id}`                 | `elastic es query-rules put-ruleset --ruleset-id '<id>' --rules '<json>'`                                                   |
| `PUT /_query_rules/{ruleset_id}/_rule/{rule_id}` | `elastic es query-rules put-rule --ruleset-id '<id>' --rule-id '<id>' --type pinned --criteria '<json>' --actions '<json>'` |
| `GET /_query_rules/{ruleset_id}`                 | `elastic es query-rules get-ruleset --ruleset-id '<id>'`                                                                    |
| `POST /_query_rules/{ruleset_id}/_test`          | `elastic es query-rules test --ruleset-id '<id>' --match-criteria '<json>'`                                                 |
| `POST /{index}/_search`                          | `elastic es search --index '<index>' --query '<json>'`                                                                      |
| `POST /{index}/_analyze`                         | `elastic es indices analyze --index '<index>' --field '<field>' --text '<text>'`                                            |
