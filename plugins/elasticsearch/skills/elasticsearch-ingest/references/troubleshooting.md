# Troubleshooting

## Wrong document count

| Observed count                 | Likely cause                                      | Fix                                                          |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------------ |
| `1` for a JSON array file      | Entire array indexed as one document              | Split array into per-element action + document pairs         |
| Fewer rows than CSV data lines | Header counted as document, or blank rows skipped | Skip only the header row; count data rows before load        |
| More than expected             | Duplicate bulk load without `_id`                 | Delete index with user approval or use explicit `_id` values |

Always compare `GET /{index}/_count` to the source row/element count — never trust file inspection alone after load.

## Numeric or date fields stored as text

**Symptom:** `GET /{index}/_mapping` shows `age` as `text` or `keyword` instead of `long`; date fields lack `date` type.

**Cause:** Bulk body sent all values as strings, or index was auto-created without explicit mapping before bulk ingest.

**Fix:** Recreate index with explicit mapping (`PUT /{index}`), convert CSV cells to typed JSON in the bulk body, reload
via `POST /_bulk`, re-check mapping.

## Bulk response reports errors

When the bulk response sets `"errors": true`:

1. Inspect each item's `index.error` for `type` and `reason`.
2. **Mapper parsing exception** — document value incompatible with mapping (e.g., string in `long` field after mapping
   was fixed but JSON still has strings). Fix conversion, retry failed documents.
3. **Rejecting mapping update** — conflicting field type on re-ingest. Delete and recreate index with user approval.
4. **Document missing final source line** — malformed NDJSON pairing. Ensure every action line is followed by exactly
   one source line.

## Index already exists with wrong schema

Do not bulk load typed CSV into an index that already mapped fields as text. Call `GET /{index}/_mapping` first. With
user confirmation, `DELETE /{index}`, recreate with `PUT /{index}`, then reload.

## CSV parsing issues

- **Delimiter** — default is comma; tab- or semicolon-separated files need the correct delimiter when parsing before
  NDJSON conversion.
- **Quoted fields** — handle embedded commas inside quotes when splitting rows.
- **Headerless CSV** — assign field names explicitly or ask the user for column names before mapping design.

## Slow or failing large loads

- Split NDJSON into smaller bulk batches.
- Reduce batch size when individual documents are large.
- Check cluster health with `GET /_cluster/health` if bulk items time out repeatedly.

## Authentication or connectivity failures

If `GET /` fails, resolve CLI configuration before retrying ingest. Do not embed credentials in generated NDJSON or
mapping files.
