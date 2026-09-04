# Mapping Design for Ingest

Create explicit mappings with `PUT /{index}` **before** bulk loading when field types affect search, sorting, or
aggregations. Dynamic mapping of CSV-derived strings rarely produces the types operators expect.

## When explicit mapping is mandatory

- CSV columns include integers, floats, dates, or booleans.
- The user asks for "usable types" or mentions aggregations, range filters, or date histograms.
- A prior ingest indexed numeric-looking fields as `text`.

When every field can remain a string and the user accepts keyword/text semantics, dynamic mapping on first bulk ingest
may be acceptable — still verify with `GET /{index}/_mapping` afterward.

## CSV with mixed types

Example schema matching a typical user-ingest fixture:

```json
{
  "properties": {
    "id": { "type": "long" },
    "name": { "type": "keyword" },
    "age": { "type": "long" },
    "signup_date": { "type": "date" },
    "active": { "type": "boolean" }
  }
}
```

Create the index with this mapping, then bulk-load NDJSON documents whose JSON values match these types (numeric `age`,
ISO date string for `signup_date`, boolean literal for `active`).

### Common type choices

| Field role        | Mapping type                              | Bulk JSON shape                                 |
| ----------------- | ----------------------------------------- | ----------------------------------------------- |
| Identifier / enum | `keyword`                                 | string                                          |
| Free text         | `text` (optionally with `fields.keyword`) | string                                          |
| Integer count     | `long` or `integer`                       | number                                          |
| Decimal metric    | `double` or `float`                       | number                                          |
| Timestamp / date  | `date`                                    | ISO-8601 string (`yyyy-MM-dd` or full datetime) |
| Flag              | `boolean`                                 | `true` / `false`                                |

Avoid mapping typed columns as `text` when the user expects numeric or date behavior.

## JSON array / schemaless JSON

When objects share a stable schema, define properties explicitly as above. When the schema is unknown:

- Inspect a sample of objects for field names and value shapes.
- Map obvious timestamps to `date`, counters to `long`, and free-text fields to `text` or `keyword`.
- Bulk load a small sample first, then call `GET /{index}/_mapping` and adjust before loading the full file if types are
  wrong.

For event-style objects such as `{ "event_id", "type", "user_id", "value" }`:

```json
{
  "properties": {
    "event_id": { "type": "keyword" },
    "type": { "type": "keyword" },
    "user_id": { "type": "long" },
    "value": { "type": "double" }
  }
}
```

## Fixing wrong mappings

Elasticsearch does not change existing field types in place. When `GET /{index}/_mapping` shows `age` as `text` after
load:

1. Explain the mismatch to the user.
2. With confirmation, call `DELETE /{index}`.
3. Recreate with `PUT /{index}` and the correct mapping.
4. Re-convert the source file to typed NDJSON and bulk load again.

## Dynamic mapping pitfalls

| Pitfall                           | Symptom                        | Prevention                                       |
| --------------------------------- | ------------------------------ | ------------------------------------------------ |
| CSV numbers as JSON strings       | `age` mapped as `text`         | Emit JSON numbers; create explicit mapping first |
| Boolean strings `"true"`          | Stored as keyword/text         | Emit JSON booleans                               |
| Ambiguous dates                   | Parsing failures or wrong type | Use ISO-8601; map as `date`                      |
| First row typo becomes field name | Unexpected field names         | Validate CSV header before conversion            |

Always verify mappings after the first successful bulk batch when types matter.
