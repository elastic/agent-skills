# Query Rules Reference

Query rules let you **pin** or **exclude** documents when search-time `match_criteria` satisfy rule `criteria`. They
replace ad-hoc sort scripts or extreme boosts for merchandising and curated results.

## Rule types

| Type      | Effect                                                                                 |
| --------- | -------------------------------------------------------------------------------------- |
| `pinned`  | Rewrites the organic query into a pinned query; listed documents appear first in order |
| `exclude` | Removes matching documents from the result set                                         |

Use `pinned` when the user wants a document at the top. Use `exclude` only when the user explicitly asks to hide
documents. Never use `exclude` for promotion.

## Criteria

Each criterion has `type`, `metadata`, and `values`. **All** criteria on a rule must match.

| Criterion type | Typical use                                             |
| -------------- | ------------------------------------------------------- |
| `exact`        | Metadata value must equal one of `values`               |
| `contains`     | Metadata value must contain one of `values` (substring) |
| `fuzzy`        | Metadata value must fuzzy-match one of `values`         |

The `metadata` key is a label you define — it is **not** an index field. At search time, the `rule` query passes
`match_criteria` whose keys must match these `metadata` names.

Common pattern for query-text rules:

```json
{
  "type": "contains",
  "metadata": "query_string",
  "values": ["sale"]
}
```

Narrow rules with additional criteria (locale, category, channel) only when the user requires them.

## Actions for `pinned` / `exclude`

Provide **either** `ids` **or** `docs`, never both in one rule.

**By `_id` only** (works when IDs are unique within the searched indices):

```json
"actions": { "ids": ["SKU123"] }
```

**By index + `_id`** (preferred when IDs may collide across indices):

```json
"actions": {
  "docs": [{ "_index": "catalog", "_id": "SKU123" }]
}
```

Pinned queries cap at 100 documents total across matching rules.

## Create a ruleset

`PUT /_query_rules/{ruleset_id}` replaces the entire ruleset body:

```json
{
  "rules": [
    {
      "rule_id": "pin-sku123-on-sale",
      "type": "pinned",
      "criteria": [
        {
          "type": "contains",
          "metadata": "query_string",
          "values": ["sale"]
        }
      ],
      "actions": {
        "docs": [{ "_index": "catalog", "_id": "SKU123" }]
      }
    }
  ]
}
```

Add or update a single rule with `PUT /_query_rules/{ruleset_id}/_rule/{rule_id}` when merging into an existing ruleset
without rewriting every rule.

## Wire rules into search

Creating the ruleset **does nothing** until a search uses a `rule` query. The `match_criteria` object must supply values
for every `metadata` key your criteria reference.

```json
{
  "query": {
    "rule": {
      "ruleset_id": "catalog-sale-pin",
      "match_criteria": {
        "query_string": "sale"
      },
      "organic": {
        "multi_match": {
          "query": "sale",
          "fields": ["title", "description"]
        }
      }
    }
  }
}
```

- `ruleset_id` — the ruleset you created.
- `match_criteria` — binds search context to rule criteria (here, the user's query text).
- `organic` — the normal relevance query; pinned hits prepend, then organic matches follow.

Validate criteria matching before searching with `POST /_query_rules/{ruleset_id}/_test` and the same `match_criteria`
payload.

## Anti-patterns for pinning

- Boosting or sorting by product ID to fake a pin — fragile and breaks when inventory changes.
- Using `exclude` when the user asked to promote a result.
- Creating a ruleset but searching with only `multi_match` or `match` — the pin never applies.
- Mismatching `metadata` names between rule criteria and search `match_criteria`.
