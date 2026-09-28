---
name: elasticsearch-index-design
description: >
  Design and review Elasticsearch index mappings for stated access patterns: correct
  field types, text+keyword multi-fields, doc_values tuning, mapping-explosion avoidance,
  and explicit shard settings. Use when creating a new index, reviewing a mapping
  for storage or query performance, fixing wrong field types, or when the user asks
  which type to use for search, filter, sort, or aggregation on a field.
metadata:
  author: elastic
  version: 0.1.0
  universal: true
compatibility: Elasticsearch 8.x or 9.x, self-managed, Elastic Cloud Hosted, or Elastic
  Cloud Serverless; explicit shard and replica settings apply to self-managed and
  Elastic Cloud Hosted only (managed internally on Serverless). Requires the `elastic`
  CLI ≥ 0.2 with `stack es` support.
---

# Elasticsearch Index Design

Design explicit index mappings from access patterns, review existing mappings for type and storage mistakes, and apply
corrections through a new index plus reindex when field types must change.

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

## Process

1. **Gather access patterns per field.** Before choosing types, list how each field is used. For every field capture:
   - **Search** — full-text match, phrase, relevance scoring?
   - **Filter** — exact term, terms set, prefix?
   - **Aggregate** — terms, cardinality, histogram, stats?
   - **Sort** — ascending/d descending in result sets?
   - **Retrieve only** — returned in `_source` but never queried?

   The decision: classify each field into one primary access pattern (search, exact, numeric metric, date, boolean,
   structured object, or retrieve-only). Missing access-pattern data is a blocker — ask the user rather than guessing.
   Call `GET /` to confirm connectivity; when reviewing an existing index, call `GET /{index}/_mapping` to ground the
   discussion in the current mapping.

2. **Choose field types from access patterns.** Map each field to the minimal type set that satisfies its pattern. Read
   [Field Type Decisions](references/field-type-decisions.md) and
   [Multi-Field Patterns](references/multi-field-patterns.md) before proposing mappings.

   Key judgments:

   | Pattern                                         | Mapping                                                      |
   | ----------------------------------------------- | ------------------------------------------------------------ |
   | Full-text search only                           | `text` (no keyword sub-field)                                |
   | Filter / agg / sort only                        | `keyword` (not `text`)                                       |
   | Full-text search **and** sort or aggregation    | `text` with `fields.keyword` multi-field                     |
   | Decimal price or metric                         | `double`, `float`, or `scaled_float` — not `text` or integer |
   | Timestamp                                       | `date`                                                       |
   | True/false flag                                 | `boolean`                                                    |
   | Free-form key/value map with many distinct keys | `flattened` — not dynamic `object`                           |

   **Multi-field rule:** When a field must be searchable **and** sortable/aggregatable (e.g. product `name`), map it as
   `text` with a `keyword` sub-field — search on `name`, sort and aggregate on `name.keyword`. Mapping as only `text` or
   only `keyword` is wrong for that combined pattern.

   **Explicit mapping rule:** For new indices, always define mappings explicitly with `PUT /{index}`. Do not rely on
   dynamic mapping for production indices — the first document can lock in wrong types (strings as `text`, ambiguous
   numbers as `keyword`).

   **Index settings:** Set deliberate `number_of_shards` and `number_of_replicas` in the same `PUT /{index}` request
   when the deployment allows it (Self-Managed / Elastic Cloud Hosted). On Serverless, omit shard and replica counts
   (Elastic manages them); still supply explicit mappings. State chosen values or document that defaults apply.

   Example — `products` index optimized for search plus sort/agg on name:

   ```json
   {
     "settings": {
       "number_of_shards": 1,
       "number_of_replicas": 1
     },
     "mappings": {
       "properties": {
         "name": {
           "type": "text",
           "fields": {
             "keyword": { "type": "keyword", "ignore_above": 256 }
           }
         },
         "price": { "type": "double" },
         "created": { "type": "date" },
         "in_stock": { "type": "boolean" }
       }
     }
   }
   ```

   Create with `PUT /products` passing the `settings` and `mappings` blocks. Verify with `GET /products/_mapping`.

3. **Guard against mapping explosion and storage bloat.** On high-volume indices, type mistakes multiply cost. Read
   [Mapping Explosion and Storage Bloat](references/mapping-explosion.md) and apply these review checks:
   - **Analyzed-but-not-searched fields** — Fields used only for filter and aggregation (`url`, HTTP `status_code`,
     `tags`, IDs) must be `keyword`, not `text`. `text` wastes space; aggregations on `text` require fielddata or a
     `.keyword` sub-field that should not exist if the field is not searched.
   - **`message.keyword` without `ignore_above`** — A keyword sub-field on a large full-text body indexes the entire raw
     string as one term. Flag this anti-pattern; remove the sub-field when only full-text search is needed, or add
     `ignore_above` when a bounded exact-match sub-field is truly required.
   - **Dynamic free-form objects** — `object` with `"dynamic": true` on user-supplied key/value data with thousands of
     distinct keys causes **mapping explosion**. Recommend `flattened` (or strict dynamic / allowlist strategy).
   - **`doc_values: false`** — On fields retrieved in hits but never sorted, aggregated, or filtered (e.g. display-only
     `session_id`), set `"doc_values": false` on `keyword` to save disk at scale.
   - **`scaled_float`** — For metrics with bounded precision (e.g. `response_time_ms`), prefer `scaled_float` with an
     appropriate `scaling_factor` over plain `float`/`double` when storage dominates.

   Prefer `"dynamic": "strict"` on the root mapping unless unknown fields are an explicit requirement.

4. **Apply design: create new index and reindex when types change.** Elasticsearch **cannot** change an existing field's
   type in place. When review finds wrong types (text→keyword, object→flattened, float→scaled_float, doc_values changes
   on existing fields), state clearly that fixes require a **new index** and **reindex** — not a mapping update on the
   live index.

   Workflow for correcting an existing high-volume index such as `events`:
   1. **Design the corrected mapping** on a new index name (e.g. `events-v2`) incorporating all fixes from steps 2–3.
   2. **Create the destination** with `PUT /events-v2` and the full corrected `mappings` (and `settings` where
      applicable).
   3. **Copy documents** with `POST /_reindex` — for large indices use `wait_for_completion=false` and track the task.
      Source: `{ "index": "events" }`, destination: `{ "index": "events-v2" }`.
   4. **Verify** with `GET /events-v2/_count` (compare to source count) and `GET /events-v2/_mapping` (confirm types).
   5. **Cut over** reads and writes (index alias swap or application config) after validation.

   Example corrected excerpt for the `events` review pattern:

   ```json
   {
     "mappings": {
       "properties": {
         "@timestamp": { "type": "date" },
         "event_id": { "type": "keyword" },
         "session_id": { "type": "keyword", "doc_values": false },
         "url": { "type": "keyword" },
         "status_code": { "type": "keyword" },
         "response_time_ms": { "type": "scaled_float", "scaling_factor": 100 },
         "tags": { "type": "keyword" },
         "message": { "type": "text" },
         "labels": { "type": "flattened" }
       }
     }
   }
   ```

   Do not attempt in-place mapping fixes for these type changes — they are rejected or leave data inconsistent. For
   greenfield indices, a single `PUT /{index}` before first ingest avoids reindex entirely.

## Review checklist

When the user supplies a mapping JSON and usage notes, walk this checklist in order:

1. Match each field's type to its stated access pattern (see step 2).
2. Flag `text` on filter/agg-only fields; flag missing multi-fields where search and sort/agg share one logical field.
3. Flag `message.keyword` (or similar) without `ignore_above` on large analyzed text.
4. Flag dynamic `object` on high-cardinality free-form maps; recommend `flattened`.
5. Propose retrieve-only and numeric storage optimizations (`doc_values: false`, `scaled_float`).
6. State that type changes require a new index and `POST /_reindex`, then show the corrected mapping and reindex plan.

## Examples

**"Users search product names and also sort and aggregate on them"** — one logical field, two access patterns, so use a
`text` field with a `keyword` multi-field:

```json
{
  "mappings": {
    "properties": {
      "product_name": { "type": "text", "fields": { "keyword": { "type": "keyword", "ignore_above": 256 } } }
    }
  }
}
```

**"A `status` field is only ever filtered and aggregated, never full-text searched"** — use `keyword`, not `text`:

```json
{ "mappings": { "properties": { "status": { "type": "keyword" } } } }
```

**"Free-form `labels` object with unbounded keys"** — avoid mapping explosion with `flattened`:

```json
{ "mappings": { "properties": { "labels": { "type": "flattened" } } } }
```

## Guidelines

- **Minimal mapping** — Map only what access patterns require; every sub-field and analyzed form adds indexed data.
- **Never guess access patterns** — Wrong type choice is expensive to fix at scale.
- **Verify after create** — Always confirm with `GET /{index}/_mapping`; use `GET /{index}/_count` after reindex.
- **Cross-skill boundary** — Copying documents between indices is `POST /_reindex` (see the reindex skill for slicing,
  throttling, and task tracking). Loading files into a new index is bulk ingest, not index design.

## Reference material

- [Field Type Decisions](references/field-type-decisions.md) — access-pattern-to-type table and common mistakes
- [Multi-Field Patterns](references/multi-field-patterns.md) — text+keyword, `ignore_above`, anti-patterns
- [Mapping Explosion and Storage Bloat](references/mapping-explosion.md) — `flattened`, `doc_values`, dynamic objects

## Operations

| HTTP API (shorthand)                       | `elastic` CLI command                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `GET /`                                    | `elastic es info`                                                                     |
| `GET /{index}/_mapping`                    | `elastic es indices get-mapping --index '<index>'`                                    |
| `PUT /{index}`                             | `elastic es indices create --index '<index>' --mappings '<json>' --settings '<json>'` |
| `POST /_reindex`                           | `elastic es reindex --source '<json>' --dest '<json>'`                                |
| `POST /_reindex?wait_for_completion=false` | `elastic es reindex --wait-for-completion false --source '<json>' --dest '<json>'`    |
| `GET /{index}/_count`                      | `elastic es count --index '<index>'`                                                  |
