# Multi-Match and Field-Boost Tuning

Use this reference when organic relevance is weak and the user wants **better ranking**, not pinned merchandising.

## Read the mapping first

From `GET /{index}/_mapping`, classify fields:

| Mapping type           | Search role                                                                |
| ---------------------- | -------------------------------------------------------------------------- |
| `text`                 | Full-text retrieval and scoring (`title`, `description`, `body`)           |
| `keyword`              | Filtering, sorting, aggregations — **not** primary natural-language search |
| `text` with sub-fields | Often `field` for search and `field.keyword` for exact filters             |

Short `text` fields (title, name) signal **precision**. Long fields (description, body) signal **recall**. When both
exist, search both — do not query only the long field.

## Baseline: multi_match across title + description

When a query hits only `description`, promote title:

```json
{
  "query": {
    "multi_match": {
      "query": "running shoes",
      "fields": ["title^2", "description"],
      "type": "best_fields"
    }
  }
}
```

- `title^2` — doubles title contribution; tune `^1.5`–`^3` based on tested top hits.
- `type: "best_fields"` — default for short user queries; scores by the best matching field.
- `type: "cross_fields"` — treats fields as one combined field; useful when terms should match across fields evenly.

## Recall levers (when top hits still miss intent)

Apply one lever at a time; re-test after each change.

**Operator and minimum match** — for multi-word queries where only one term matches:

```json
{
  "query": {
    "multi_match": {
      "query": "running shoes",
      "fields": ["title^2", "description"],
      "operator": "and",
      "minimum_should_match": "75%"
    }
  }
}
```

Use `operator: "or"` with `minimum_should_match` when strict AND drops too many relevant docs.

**Synonyms** — when users use alternate product language ("sneakers" vs "running shoes"). Synonym sets apply at index
time via analyzers; creating `PUT /_synonyms/{set_id}` alone does not change an existing index until the index analyzer
references that set. Prefer query-time tuning first; propose synonym sets only when recall gaps persist after field
boosting.

**Analysis inspection** — call `POST /{index}/_analyze` with the same analyzer as the target `text` field to confirm
tokens for sample queries before forcing exact matches.

## Testing discipline

1. Run the **current** query with `POST /{index}/_search`; capture top `_id`, `_score`, and key `_source` fields.
2. Run each **candidate** query the same way (`size` ≥ 10).
3. Compare ordering and explain why the candidate is better — do not declare success without evidence.

Use `"explain": true` on a single hit when score behavior is unclear.

## Anti-patterns for ranking fixes

| Wrong approach                                            | Why                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| `sort` on `price` or date instead of `_score`             | Solves merchandising, not text relevance                        |
| `term` / `match` on `.keyword` for analyzed phrases       | Analyzed text requires `match` / `multi_match` on `text` fields |
| Single-field `match` on `description` when `title` exists | Ignores the highest-signal field                                |
| Extreme `function_score` or `boosting` to pin one SKU     | Use query rules (`pinned`) for deterministic promotion          |
| Changing query without re-running search                  | Cannot verify improvement                                       |

## Field priority (content indices)

When choosing fields and boosts without user guidance:

1. `title`, `name`, `subject`
2. `summary`, `headline`
3. `description`, `body`, `content`, `text`

Boost higher in the list; include lower fields for recall.
