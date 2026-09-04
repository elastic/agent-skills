# Multi-Field Patterns

Multi-fields let one logical field support more than one access pattern by indexing the same value under different types
or analyzers.

## Text + keyword (search and sort/aggregate)

Use when users **search** full text on a field **and** sort, aggregate, or filter with exact values on the same field.

```json
{
  "name": {
    "type": "text",
    "fields": {
      "keyword": {
        "type": "keyword",
        "ignore_above": 256
      }
    }
  }
}
```

- Queries: full-text on `name`; term filter, `terms` aggregation, and sort on `name.keyword`.
- Mapping **only** `text` breaks sort/aggregation. Mapping **only** `keyword` breaks relevance search.

Apply the same pattern to product titles, descriptions, and any "searchable but also facetable" string field.

## When not to add a keyword sub-field

| Situation                                                         | Recommendation                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| Field is full-text searched only (`message` in log indices)       | Map as `text` **without** a `.keyword` sub-field                    |
| Field is filter/agg/sort only (`url`, `status_code`, `tags`, IDs) | Map as `keyword` only — no `text` parent                            |
| High-cardinality full-text body (log message, article body)       | Do **not** add `message.keyword` unless exact-match use case exists |

## The `ignore_above` anti-pattern

Adding a `keyword` sub-field to a large analyzed text field **without** `ignore_above` indexes the entire raw string as
a single keyword term. On high-volume indices this causes:

- Bloated terms dictionary and excessive disk use
- Risk of **document parsing exceptions** when a single term exceeds Lucene's term byte limit (~32 KB)

**Anti-pattern:**

```json
{
  "message": {
    "type": "text",
    "fields": {
      "keyword": { "type": "keyword" }
    }
  }
}
```

**Fixes (pick one based on access pattern):**

1. **Full-text only** — remove the sub-field; keep `"type": "text"`.
2. **Occasional exact match on a prefix** — add `"ignore_above": 256` (or another bound matching max exact-match length)
   on the keyword sub-field.
3. **Structured extraction** — parse identifiers (request ID, error code) into dedicated `keyword` fields at ingest
   instead of keyword-indexing the whole message.

## Other multi-field variants

| Pattern                                                    | Use case                                             |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| `text` + `keyword`                                         | Search + sort/agg (most common)                      |
| `text` with different analyzers (`fields.en`, `fields.fr`) | Language-specific search on same source value        |
| `keyword` + `text` sub-field (`fields.search`)             | Exact ID field with optional secondary search (rare) |

Prefer the simplest mapping that satisfies stated access patterns — extra sub-fields multiply indexed data.
