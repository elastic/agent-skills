# Mapping Explosion and Storage Bloat

Mapping explosion occurs when Elasticsearch discovers unbounded distinct field names — often from dynamic `object`
mappings on user-supplied keys. Each new field consumes cluster state and disk; at billions of documents the cost is
severe.

## Dynamic objects are high risk

```json
{
  "labels": {
    "type": "object",
    "dynamic": true
  }
}
```

When `labels` is free-form key/value data with **thousands of distinct keys** across the index, every new key becomes a
new mapped field. Cluster state grows without bound; queries slow; index operations may fail when field limits are hit.

**Recommendation:** Replace with `flattened`:

```json
{
  "labels": {
    "type": "flattened"
  }
}
```

`flattened` treats the whole object as a single field with limited sub-key indexing — suitable for high-cardinality,
schema-less metadata used mainly for filtering (`labels.environment`, `labels.team` style queries in Query DSL).

## Alternatives when `flattened` is not enough

| Strategy                                            | When to use                                                    |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `flattened`                                         | Arbitrary key/value maps, moderate query needs                 |
| Index only an allowlist of keys via ingest pipeline | Known subset of label keys must be first-class fields          |
| Separate "labels" index                             | Extreme cardinality; join or lookup at query time              |
| `"dynamic": "strict"` on parent object              | Reject documents with unknown keys to prevent silent explosion |

## `doc_values: false` for retrieve-only fields

`doc_values` power sorting, aggregations, and most field-centric queries. Fields loaded only in `_source` (display in
UI, never filtered or aggregated) can disable them:

```json
{
  "session_id": {
    "type": "keyword",
    "doc_values": false
  }
}
```

**Requirements before disabling:**

- Field is never used in sort, aggregation, `terms` query, or runtime field inputs that need doc values.
- Field is still returned in search hits via `_source`.

On high-volume indices, `doc_values: false` on large retrieve-only keyword fields materially reduces storage.

## Storage-oriented numeric choices

| Field role                              | Bloated choice    | Leaner choice                              |
| --------------------------------------- | ----------------- | ------------------------------------------ |
| Latency / duration with fixed precision | `float`           | `scaled_float` with tuned `scaling_factor` |
| Currency to cents                       | `double`          | `scaled_float`, `scaling_factor: 100`      |
| HTTP status (filter/agg only)           | `text` (analyzed) | `keyword` or `short` if numeric            |

## Guardrails in explicit mappings

When designing or reviewing mappings:

1. Set `"dynamic": "strict"` (or `false`) on the root or sensitive objects unless unknown fields are intentional.
2. Avoid `text` on fields that are never full-text searched.
3. Avoid keyword sub-fields on large analyzed bodies without `ignore_above`.
4. Prefer `flattened` over dynamic `object` for user-supplied maps.
5. Audit mapping size with `GET /{index}/_mapping` and watch total field count against cluster
   `index.mapping.total_fields.limit`.

## Fixing explosion or bloat on a live index

Mapping parameter tweaks that do not change field **type** (e.g. adding `ignore_above` to a new sub-field only on new
indices) still require a new index when existing field types must change. For explosion remediation:

1. Design corrected mapping on a **new** index (`events-v2`, or a dated backing index).
2. Reindex with `POST /_reindex`.
3. Verify field count and document count before cutover.

Type and structural fixes cannot be applied in place on a high-volume production index.
