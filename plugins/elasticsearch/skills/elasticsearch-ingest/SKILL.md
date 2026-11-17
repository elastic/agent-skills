---
name: elasticsearch-ingest
description: >
  Load local CSV, JSON array, and NDJSON files into Elasticsearch indices with the
  bulk API through the `elastic` CLI, creating an explicit mapping first when field
  types matter. Use when batch-importing local files, loading a pre-formed bulk NDJSON
  body, or verifying document counts and mappings after a load — not for Logstash
  pipelines, Beats, Elastic Agent, continuous ingestion, or index-to-index reindex.
metadata:
  author: elastic
  version: 0.2.0
  universal: true
compatibility: Elasticsearch 8.x or 9.x, self-managed, Elastic Cloud Hosted, or Elastic
  Cloud Serverless; uses the bulk API available on all deployment types. Requires
  the `elastic` CLI ≥ 0.5 with `stack es` support.
---

# Elasticsearch File Ingest

Load local files into an index with `POST /_bulk`. The
[Bulk API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-bulk.md) covers the NDJSON
action-and-source format, action semantics, the 100 MB request limit, and the `errors`/`items` response. The
[mapping overview](https://www.elastic.co/docs/manage-data/data-store/mapping.md) covers field types and why they can't
change after indexing. This skill holds what those pages and the CLI help don't make obvious. Mapping design for
specific access patterns belongs to the elasticsearch-index-design skill.

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

## Guidelines

- **Check the cluster before touching files.** `GET /` confirms the CLI context works; if it fails, fix configuration
  before converting or loading anything.
- **Create the index before the first bulk request when types matter.** The first document fixes each field's type
  permanently
  ([dynamic field mapping](https://www.elastic.co/docs/manage-data/data-store/mapping/dynamic-field-mapping.md)).
  Without a mapping, quoted numbers and booleans become `text` with a `.keyword` sub-field, quoted ISO dates become
  `date`, and a numeric column whose first value is `0` becomes `long`, so later `12.5` values are truncated. Look at
  `GET /{index}/_mapping` if the index might exist, then `PUT /{index}` with `mappings`.
- **The mapping does the typing, not the JSON.** With an explicit mapping, `"36"` indexes into a `long`
  ([coerce](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/coerce.md)) and `"true"` into a
  `boolean` ([boolean](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/boolean.md)). Values that
  can't be parsed still fail per item: `"N/A"` in a number, `01/15/2023` in a `date` without a matching
  [`format`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/date.md), and empty CSV cells, which
  arrive as `""` (that reads as `false` in a boolean field). Send blanks as `null` or omit the field.
- **Let the CLI's bulk-ingest helper parse CSV, JSON arrays, and documents-only NDJSON.** The `POST /{index}/_bulk`
  helper in Operations splits arrays per element, batches by bytes (5 MB default), sends batches in parallel, and
  retries batches that fail outright. For CSV it turns `true`/`false` into booleans and every numeric-looking cell into
  a number, which strips leading zeros from ZIP codes and padded IDs whatever the mapping says. Convert such files to
  NDJSON yourself with those columns kept as strings, then load that.
- **Send a pre-formed bulk body through `POST /_bulk`, not the helper.** The helper prefixes every line with an `index`
  action, so a file that already alternates action and source lines would index its action lines as documents. The CLI
  takes the body as a JSON file shaped `{"operations": [action, source, …]}` rather than raw NDJSON; keep each request
  well under 100 MB.
- **Use `POST /_bulk` when the helper's fixed `index` action is wrong.** The helper can't set `_id`, so a rerun
  duplicates every document. Stable `_id`s make reloads overwrite instead. Data streams accept only `create` actions and
  need a matching index template
  ([use a data stream](https://www.elastic.co/docs/manage-data/data-store/data-streams/use-data-stream.md)).
- **Don't trust a zero exit code.** Bulk returns 200 with `errors: true` when individual items fail, and the helper's
  summary only counts `failed` documents without the reasons. Before a full load, send a few documents through
  `POST /_bulk` and read each item's `error.type` and `reason`; fix the mapping or the conversion, not the cluster. Back
  off on `429` rather than retrying immediately
  ([tune for indexing speed](https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/indexing-speed.md)).
- **Wrong types on an existing index: ask before deleting.** `DELETE /{index}` destroys data that may not exist anywhere
  else, so get explicit confirmation in the conversation first. A wrong mapping isn't permission. The non-destructive
  path is a new index (`users-v2`) with the right mapping, loaded from the file again
  ([explicit mapping](https://www.elastic.co/docs/manage-data/data-store/mapping/explicit-mapping.md)).
- **Report what the cluster says.** Documents are invisible to search until a refresh (default 1s on Stack, 5s on
  Serverless; [refresh](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/refresh-parameter.md)), so run
  `POST /{index}/_refresh` or send the last `POST /_bulk` with `refresh=wait_for`. Then compare `GET /{index}/_count`
  with the rows or elements in the file, and check `GET /{index}/_mapping` when types matter. A low count means failed
  items, overwritten `_id`s, or a missed refresh; a high count means a duplicate load.

## Examples

- "Load `users.csv` with usable column types" — create `users` with `long`, `date`, and `boolean` fields first, load
  with the helper in CSV mode, refresh, then confirm the count equals the data rows (not the header).
- "Import `events.json` (a JSON array)" — the helper splits the array; the count should equal the number of elements.
- "Load `orders.csv` with a `zip` column like `02134`" — the helper's CSV casting would drop the leading zero, so
  convert to NDJSON with `zip` as a string and map it as `keyword`.
- "Load `bulk.ndjson`, which already has action lines with `_id`s" — wrap it as `operations` for `POST /_bulk`; the
  helper would double-wrap it.
- "The index exists but `age` is `text`; delete it now?" — not without explicit confirmation; offer a new index loaded
  from the same file instead.

## Operations

| HTTP API (shorthand)           | `elastic` CLI command                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `GET /`                        | `elastic es info`                                                                             |
| `GET /{index}/_mapping`        | `elastic es indices get-mapping --index '<index>'`                                            |
| `PUT /{index}`                 | `elastic es indices create --index '<index>' --mappings '<json>'`                             |
| `DELETE /{index}`              | `elastic es indices delete --index '<index>'`                                                 |
| `POST /{index}/_bulk` (helper) | `elastic es helpers bulk-ingest --index '<index>' --data-file '<path>' [--source-format csv]` |
| `POST /_bulk`                  | `elastic es bulk --input-file '<operations.json>' [--refresh wait_for]`                       |
| `POST /{index}/_refresh`       | `elastic es indices refresh --index '<index>'`                                                |
| `GET /{index}/_count`          | `elastic es count --index '<index>'`                                                          |
