# Field Type Decisions

Map each field to a type based on **how queries use it**, not how values look in JSON. A value that resembles a number
but is only ever filtered with exact match belongs in `keyword`, not `long`.

## Access pattern → type

| Access pattern                                       | Primary type                          | Notes                                                                                                            |
| ---------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Full-text search (match, phrase, relevance)          | `text`                                | Analyzed; supports scoring. Cannot sort or aggregate without `fielddata` (avoid).                                |
| Exact filter, terms agg, sort                        | `keyword`                             | Not analyzed; default for IDs, enums, URLs, HTTP status codes, tags.                                             |
| Full-text search **and** sort/agg on same field      | `text` + `fields.keyword` multi-field | Search `name`; sort/agg on `name.keyword`.                                                                       |
| Integer counter / ID (numeric range or sum)          | `long` or `integer`                   | Use when values are true numbers and math/range queries apply.                                                   |
| Decimal metric (aggregations, range filters)         | `double`, `float`, or `scaled_float`  | Prefer `scaled_float` with an appropriate `scaling_factor` when precision is fixed and storage matters at scale. |
| Timestamp / date histogram                           | `date`                                | Accepts ISO-8601 and common date formats.                                                                        |
| Boolean flag                                         | `boolean`                             | Filter only; do not map as `keyword` unless the user explicitly wants string semantics.                          |
| Free-form key/value map (many distinct keys)         | `flattened`                           | Safer than `object` with `dynamic: true` at high cardinality.                                                    |
| Structured nested object (fixed schema)              | `object` or `nested`                  | Use `nested` when independent queries on array elements require it.                                              |
| Retrieve in `_source` only (never filter, sort, agg) | `keyword` with `"doc_values": false`  | Saves disk on high-volume indices; field still appears in search hits.                                           |

## Common mistakes

| Mistake                                                     | Why it hurts                                                                                    | Fix                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `text` on filter-only fields (`url`, `status_code`, `tags`) | Aggregations and sorting require `.keyword` or fielddata; wastes index space on analyzed tokens | Use `keyword`                                                  |
| `keyword` only on a field that needs full-text search       | No relevance search; wildcard queries are slow                                                  | Use `text`, or `text` + `keyword` multi-field                  |
| `text` only on a field that must also be sorted/aggregated  | Sort/agg fail or require expensive fielddata                                                    | Add `fields.keyword` sub-field                                 |
| Dynamic mapping on first document                           | Wrong type locks in (e.g. `"123"` → `text`); changing type later requires reindex               | Define explicit mapping with `PUT /{index}` before bulk ingest |
| `integer` for currency or prices with decimals              | Precision loss                                                                                  | Use `double`, `float`, or `scaled_float`                       |

## Numeric precision

| Scenario                                                          | Recommended type                            |
| ----------------------------------------------------------------- | ------------------------------------------- |
| General decimal (unknown precision)                               | `double` or `float`                         |
| Fixed decimal places (e.g. currency to cents, latency to 0.01 ms) | `scaled_float` with `scaling_factor` = 10^n |
| Counters, document counts                                         | `long`                                      |

## Dates and booleans

- **Dates:** Map as `date`. Bulk and query values should use ISO-8601 (`2024-03-15` or full datetime with timezone).
- **Booleans:** Map as `boolean` with JSON `true`/`false`. String `"true"`/`"false"` indexed dynamically often becomes
  `keyword`.

## Type changes are not in-place

Elasticsearch forbids changing an existing field's type. When review finds wrong types:

1. Create a **new** index (or versioned name such as `events-v2`) with `PUT /{new_index}` and the corrected mapping.
2. Copy documents with `POST /_reindex` from the old index to the new one.
3. Verify with `GET /{new_index}/_count` and `GET /{new_index}/_mapping`.
4. Switch reads/writes (alias swap or application config) after validation.

Do not attempt to fix type mismatches with mapping updates on the live index — they are rejected or leave data
inconsistent.
