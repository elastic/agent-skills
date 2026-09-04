# NDJSON Bulk Format

The bulk API expects **newline-delimited JSON (NDJSON)**: each line is a complete JSON value. For indexing, every
document requires **two consecutive lines** — an action line followed by a source line.

## Action line syntax

Index a document into a named index:

```json
{ "index": { "_index": "my-index" } }
```

Optional stable identifier:

```json
{ "index": { "_index": "my-index", "_id": "42" } }
```

Other actions (`create`, `update`, `delete`) follow the same two-line pattern; this skill primarily uses `index`.

## Full bulk body example

Two documents in index `demo`:

```ndjson
{"index":{"_index":"demo"}}
{"a": 1}
{"index":{"_index":"demo"}}
{"a": 2}
```

Rules:

- One JSON object per line — no pretty-printed multi-line JSON inside the bulk file.
- Action line immediately precedes its document line.
- The bulk file is **not** a JSON array and **not** CSV text.

## CSV to bulk NDJSON

Given CSV:

```csv
id,name,age,signup_date,active
1,Ada Lovelace,36,2023-01-15,true
2,Alan Turing,41,2023-02-20,false
```

Steps:

1. Parse the header row into field names: `id`, `name`, `age`, `signup_date`, `active`.
2. For each **data** row (skip the header), emit an action line targeting the destination index.
3. Emit a JSON object on the next line with typed values matching the index mapping:

```ndjson
{"index":{"_index":"eval-ingest-users"}}
{"id": 1, "name": "Ada Lovelace", "age": 36, "signup_date": "2023-01-15", "active": true}
{"index":{"_index":"eval-ingest-users"}}
{"id": 2, "name": "Alan Turing", "age": 41, "signup_date": "2023-02-20", "active": false}
```

Conversion notes:

| CSV cell         | JSON in bulk body          | Typical mapping type |
| ---------------- | -------------------------- | -------------------- |
| `36`             | `36` (number)              | `long` / `integer`   |
| `2023-01-15`     | `"2023-01-15"` (string)    | `date`               |
| `true` / `false` | `true` / `false` (boolean) | `boolean`            |
| `Ada Lovelace`   | `"Ada Lovelace"` (string)  | `keyword` or `text`  |

If every value is left as a JSON string (`"36"`, `"true"`), dynamic mapping often stores them as `text`, defeating
numeric and boolean queries even when the mapping declares richer types. Coerce types when building the JSON object.

Empty trailing rows in CSV should be skipped. Count data rows before bulk load — that count must match
`GET /{index}/_count` after ingest.

## JSON array to bulk NDJSON

Given a file containing a JSON **array** of objects:

```json
[
  { "event_id": "e-1", "type": "login", "user_id": 1, "value": 12.5 },
  { "event_id": "e-2", "type": "logout", "user_id": 1, "value": 0.0 }
]
```

**Wrong:** bulk-load the file unchanged — Elasticsearch receives one document (the entire array) or rejects the body.

**Correct:** parse the array and emit one action + document pair per element:

```ndjson
{"index":{"_index":"eval-ingest-events"}}
{"event_id": "e-1", "type": "login", "user_id": 1, "value": 12.5}
{"index":{"_index":"eval-ingest-events"}}
{"event_id": "e-2", "type": "logout", "user_id": 1, "value": 0.0}
```

Array length equals expected document count. Four objects → four bulk pairs → `GET /{index}/_count` returns `4`.

## NDJSON / JSON Lines source

When the file already contains one JSON object per line (JSON Lines):

- If lines are **documents only**, prepend an `{"index":{...}}` line before each document.
- If lines **alternate** action and source, validate the pattern and use the file directly.

## Batch sizing

For large files, split NDJSON into multiple bulk requests (commonly 500–5,000 documents per batch). Each batch must
still follow the action-then-source line pairing. Retry only failed items after reading bulk response errors.
