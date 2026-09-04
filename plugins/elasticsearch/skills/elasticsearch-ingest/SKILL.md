---
name: elasticsearch-ingest
description: >
  Load CSV and JSON files into Elasticsearch indices using the bulk API and explicit
  mappings when field types matter. Use when batch-importing local files, converting
  CSV rows or JSON arrays to NDJSON bulk format, or verifying document counts and
  mappings after ingest — not for Logstash pipelines, Beats, custom scripts, or index-to-index
  reindex.
metadata:
  author: elastic
  version: 0.1.0
  universal: true
compatibility: Elasticsearch 8.x or 9.x, self-managed, Elastic Cloud Hosted, or Elastic
  Cloud Serverless; uses the bulk API available on all deployment types. Requires
  the `elastic` CLI ≥ 0.2 with `stack es` support.
---

# Elasticsearch File Ingest

Load local data files into Elasticsearch by converting them to bulk NDJSON, creating an index with the right mappings
when types matter, bulk-indexing documents, and verifying the outcome.

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

This skill covers **file → index** loading through `POST /_bulk`. It does not use Logstash, Filebeat, Elastic Agent,
Node.js ingest tools, or other sidecar pipelines. For copying documents between existing indices, use index-to-index
reindex instead of re-parsing source files.

Supported source shapes:

| Source shape        | Example                          | Bulk requirement                                                                   |
| ------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| CSV with header row | `id,name,age,...` then data rows | Parse header into field names; emit one action line + one JSON object per data row |
| JSON array file     | `[{"a":1},{"a":2}]`              | Split into per-document lines — never bulk-load the raw array as a single document |
| NDJSON / JSON Lines | one JSON object per line         | Optionally add action lines if missing; otherwise ready for bulk                   |

Parquet, Arrow, and other binary columnar formats are out of scope unless the user converts them to CSV or JSON first.

## Process

1. **Confirm connectivity.** Call `GET /`. If the call fails, stop and resolve CLI configuration before reading files or
   mutating cluster state.

2. **Inspect the source file and classify its shape.** Open the file (or sample the first lines) and decide:
   - **CSV** — first line is a comma-separated header; subsequent lines are records. Count data rows (exclude the
     header) — you will report this count after load.
   - **JSON array** — file starts with `[` and contains an array of objects. Count array elements — each element becomes
     one indexed document, not one.
   - **NDJSON** — one JSON value per line; lines alternate action metadata and document source, or each line is a
     document that still needs a preceding action line.

   The decision: pick the conversion path from [NDJSON Bulk Format](references/ndjson-bulk-format.md). **Never** send
   raw CSV text or a raw JSON array body to `POST /_bulk`.

3. **Choose the target index name.** Use the name the user supplied, or propose a lowercase name derived from the file.
   Index names must be lowercase, cannot contain spaces or `/`, and should not start with `-`, `_`, or `+`.

4. **Decide whether an explicit mapping is required.** Call `GET /{index}/_mapping` if the index may already exist.

   Create an explicit mapping **before** bulk loading when:
   - CSV columns include numbers, dates, or booleans that must be queryable as typed fields (not plain text).
   - The user asks for usable column types or aggregation-friendly fields.
   - A prior load indexed everything as `text`/`keyword` strings and must be corrected.

   When every field can remain string-like and the user did not specify types, dynamic mapping on first bulk ingest may
   suffice — but prefer explicit mappings for CSV unless the user explicitly accepts all-string typing.

   Read [Mapping Design for Ingest](references/mapping-design.md) for type choices. When the index exists with wrong
   types, ask the user before calling `DELETE /{index}` and recreating it.

5. **Create the index when needed.** When step 4 requires explicit types (or the index does not exist), call
   `PUT /{index}` with a `mappings` block **before** bulk loading. Do not rely on dynamic mapping to infer `long`,
   `date`, or `boolean` from CSV string cells — dynamic mapping often maps ambiguous strings to `text` with a `.keyword`
   sub-field.

6. **Convert the file to bulk NDJSON.** Write a temporary NDJSON file where **each document occupies two lines**:
   - Line 1 — action metadata, e.g. `{"index":{"_index":"<index>"}}` (add `"_id"` only when the user requires stable
     IDs).
   - Line 2 — document JSON with correctly typed values (numbers as JSON numbers, booleans as `true`/`false`, dates as
     ISO-8601 strings such as `2023-01-15`).

   For CSV, map the header row to JSON field names and convert cell values to the JSON types that match the mapping from
   step 5. For JSON arrays, iterate each array element and emit the action line + object line pair. See worked examples
   in [NDJSON Bulk Format](references/ndjson-bulk-format.md).

7. **Bulk index the documents.** Call `POST /_bulk` with the NDJSON file produced in step 6. Inspect the response: if
   `errors` is `true`, read per-item `error` objects, fix mapping or document issues, and retry failed items after
   remediation. Do not assume success from a zero exit code alone.

8. **Verify the outcome.** Always confirm the load — never report counts from file inspection alone.
   - Call `GET /{index}/_count` and compare to the expected row/element count from step 2.
   - When typed columns matter, call `GET /{index}/_mapping` and confirm fields such as `age` are numeric (`long` /
     `integer`), dates are `date`, and booleans are `boolean` — not `text`.

   Report the verified document count and, when relevant, the confirmed field types. If count or mapping checks fail,
   see [Troubleshooting](references/troubleshooting.md).

## Guidelines

- **Bulk only.** All file loads go through `POST /_bulk` with NDJSON action lines — not single-document `PUT` loops for
  batch files, not ingest pipelines as a substitute for client-side CSV parsing, and not posting the untouched source
  file.
- **JSON arrays must be split.** A four-element array bulk-loaded as one document yields count `1`; the correct load
  yields count `4`.
- **CSV header is schema.** The first CSV row names fields; each remaining row is one document. A file with one header
  plus five data rows must report count `5` after ingest.
- **Type coercion happens in the document JSON.** CSV cells arrive as strings; when mappings declare `long`, `date`, or
  `boolean`, emit JSON numbers, ISO date strings, and boolean literals in the bulk body — do not rely on Elasticsearch
  to infer types from quoted CSV strings after dynamic mapping chose `text`.
- **Prefer explicit mappings for typed CSV.** Creating the index with `PUT /{index}` first prevents silent all-text
  indexing that breaks range queries and aggregations.
- **Idempotent re-loads.** When reloading into an existing index, ask the user before deleting data. Duplicate bulk
  `index` actions append new documents unless `_id` is specified.

## Examples

### CSV with typed columns

Source (`users.csv` — header + 5 data rows):

```csv
id,name,age,signup_date,active
1,Ada Lovelace,36,2023-01-15,true
```

Create the index with explicit types, convert rows to NDJSON (five action+document pairs for five data rows), bulk load,
then verify count `5` and mapping types. Full walkthrough:
[Mapping Design for Ingest](references/mapping-design.md#csv-with-mixed-types) and
[NDJSON Bulk Format](references/ndjson-bulk-format.md#csv-to-bulk-ndjson).

### JSON array file

Source (`events.json`):

```json
[
  { "event_id": "e-1", "type": "login", "user_id": 1, "value": 12.5 },
  { "event_id": "e-2", "type": "logout", "user_id": 1, "value": 0.0 }
]
```

Convert to four bulk line pairs for four array elements (not one pair for the whole array). Verify `GET /{index}/_count`
returns `4`. See [NDJSON Bulk Format](references/ndjson-bulk-format.md#json-array-to-bulk-ndjson).

### NDJSON already prepared

When the file alternates action lines and document lines, validate the format and pass it directly to `POST /_bulk`
after confirming the target index and mappings.

## When Not to Use

- **Continuous or streaming ingestion** — use Elastic Agent or Beats to tail logs and metrics.
- **Complex enrichment pipelines** — design server-side ingest pipelines separately; this skill still converts files to
  bulk NDJSON client-side before load.
- **Index-to-index copy or mapping migration** — reindex between indices instead of exporting to files.
- **Very large binary columnar files** — convert to CSV or JSON offline first, then follow this skill.

## References

- [NDJSON Bulk Format](references/ndjson-bulk-format.md) — CSV and JSON-array conversion, action-line syntax, batch
  sizing
- [Mapping Design for Ingest](references/mapping-design.md) — explicit mappings for CSV types, eval-style schemas
- [Troubleshooting](references/troubleshooting.md) — wrong counts, text-typed numerics, bulk item errors

## Operations

| HTTP API (shorthand)    | `elastic` CLI command                                             |
| ----------------------- | ----------------------------------------------------------------- |
| `GET /`                 | `elastic es info`                                                 |
| `PUT /{index}`          | `elastic es indices create --index '<index>' --mappings '<json>'` |
| `DELETE /{index}`       | `elastic es indices delete --index '<index>'`                     |
| `POST /_bulk`           | `elastic es bulk --index '<index>' --input-file '<ndjson-path>'`  |
| `GET /{index}/_count`   | `elastic es count --index '<index>'`                              |
| `GET /{index}/_mapping` | `elastic es indices get-mapping --index '<index>'`                |
