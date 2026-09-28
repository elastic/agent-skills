# Query DSL Optimization Reference

Supporting detail for profile interpretation, query vs filter context, and wildcard alternatives.

## Search profiling

Enable profiling with `"profile": true` on `POST /{index}/_search`. The response adds a `profile` object parallel to
`hits`.

### Reading the query tree

Each shard returns `profile.shards[].searches[].query` — a tree of collectors. For each node, inspect:

| Field           | Meaning                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| `type`          | Collector class (`WildcardQuery`, `TermQuery`, `MatchQuery`, `BooleanQuery`, …) |
| `description`   | Lucene description (for example `message:*timeout*`, `status:active`)           |
| `time_in_nanos` | Total time for this collector on this shard                                     |
| `breakdown`     | Sub-timers; `next_doc` high on wildcards indicates per-doc scanning             |

**Triage rule:** the collector with the highest `time_in_nanos` (summed across shards when comparing) is the primary
optimization target. Secondary collectors matter only after the top cost is addressed.

### Common profile signatures

| Profile signal                                       | Typical cause                         | First fix                                      |
| ---------------------------------------------------- | ------------------------------------- | ---------------------------------------------- |
| `WildcardQuery` + high `next_doc` + `*term*` pattern | Leading or infix wildcard             | `match`/`match_phrase`, prefix, or ngram field |
| Multiple `TermQuery` in `must` + one `MatchQuery`    | Filters scored unnecessarily          | Move terms to `filter`                         |
| `MatchQuery` dominates after filter fix              | Large candidate set or heavy analyzer | Narrow with `filter`; check analyzer           |
| `BooleanQuery` with many `should`                    | Disjunction max over many clauses     | Reduce clauses; move constants to `filter`     |

Profiling adds overhead — use it for diagnosis and before/after comparison, not on every production request.

## Query context vs filter context

In a `bool` query:

| Context    | Scoring | Caching                     | Use for                                      |
| ---------- | ------- | --------------------------- | -------------------------------------------- |
| `must`     | Yes     | No                          | Clauses that must match **and** affect score |
| `should`   | Yes     | No                          | Optional relevance boosts                    |
| `filter`   | No      | Yes (filter cache / bitset) | Exact match, ranges, non-scoring matches     |
| `must_not` | No      | No (exclusion)              | Exclusions                                   |

Moving a `term` from `must` to `filter`:

- **Same matching documents** when the clause is required (wrap in `bool` with the same logical AND).
- **Different `_score`** — filter clauses do not contribute to score; the remaining `must` clauses define ranking.
- **Better repeat-query performance** — identical filter clauses can reuse cached bitsets.

## Wildcard and substring search

### Why leading wildcards are slow

Lucene's inverted index maps **terms → documents**. A prefix or suffix wildcard (`timeout*`) can sometimes use the term
dictionary. A leading wildcard (`*timeout*`) cannot narrow the term set upfront; the engine scans many terms and visits
documents (`next_doc` in the profile).

### Alternatives by requirement

| Requirement                   | Approach                                                                  |
| ----------------------------- | ------------------------------------------------------------------------- |
| Search analyzed log text      | `match` or `match_phrase` on `text` field                                 |
| Case-sensitive substring      | `wildcard`-typed field (still costly for leading `*`; better than `text`) |
| Fast prefix autocomplete      | Edge n-gram tokenizer at index time + `match` or `prefix` on keyword      |
| Fast infix/substring at scale | N-gram analyzer (index-time cost; query-time `match`)                     |
| Known suffix on keyword       | `wildcard` with pattern `*suffix` (no leading star on short prefix)       |

When replacing `wildcard` `*foo*` with `match`, warn that analysis may tokenize differently (for example `timeout` vs
`timeouts`) — compare hit counts or use `validate/query` when precision matters.

## Field type cheat sheet

| Query type | Expected mapping         | Common mistake                         |
| ---------- | ------------------------ | -------------------------------------- |
| `term`     | `keyword`, numeric, date | `term` on analyzed `text`              |
| `match`    | `text`                   | Using `match` for exact ID equality    |
| `wildcard` | `keyword`, `wildcard`    | Leading `*` on high-cardinality fields |
| `range`    | Numeric, date, keyword   | Range on `text`                        |

Always confirm with `GET /{index}/_mapping` — ECS and custom schemas use different sub-field names (`service` vs
`service.keyword`).
