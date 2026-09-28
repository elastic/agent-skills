# Reindex Tuning Reference

Detailed guidance for batch size and timestamp handling. See the [main skill file](../SKILL.md) for overview and
procedures.

## Choosing batch size (`source.size`)

The `source.size` field controls how many documents each scroll batch fetches. The default is `1000`. Use the following
to choose a good value.

### Estimate document size

- Use the Index Stats API (`GET /<index>/_stats?level=shards`) and divide store size by doc count for a rough
  bytes-per-document average.
- Or sample a few documents with `GET /{index}/_search?size=10` and inspect `_source` size.
- For **remote reindex**, the coordinating node uses a **100 MB** on-heap buffer per request — keep
  `(source.size × average document size)` comfortably under that (e.g. under 50–80 MB) to avoid `OutOfMemoryError`.

### Start with the default and adjust

- Start with **1000** (or **500** for remote). If you see scroll or bulk failures, OOM, or slow progress, reduce
  `source.size` (e.g. 250–500 for large docs). If documents are small (e.g. &lt; 1 KB) and the cluster is healthy, try
  increasing (e.g. 2000–5000) to reduce round-trips.

### Test with `max_docs`

Run a short reindex with `max_docs` (e.g. 10_000) at two or three different `source.size` values and compare throughput
(documents per second from the task response). Use the size that gives the best throughput without errors, then run the
full reindex with that value.

## Timestamps and versioning

Document timestamp values (e.g. `@timestamp` or other date fields) live in `_source` and are copied to the destination
unchanged unless you exclude them with `source._source` or change them in a script.

- **Destination mapping:** Ensure the destination index or data stream has a compatible mapping for each timestamp field
  (e.g. `date`). Mismatched or missing types can cause coercion or indexing errors.
- **Including timestamps when filtering `_source`:** If you use `source._source` to copy only certain fields, list every
  timestamp field you need. Omitting them drops those values and can break time-based queries, data stream routing, and
  ILM/retention.
- **Scripts:** Do not remove or overwrite timestamp fields in a script unless you intend to (e.g. to fix bad data).
  Leave them in `ctx._source` so they are written to the destination as-is.
- **Data streams:** The timestamp field (commonly `@timestamp`) is used to route documents to the correct backing index.
  Preserve it in `_source` and use a correct date mapping so documents land in the right time window.
- **Cross-cluster ordering:** To preserve the source document version when writing to the destination (e.g. to avoid
  overwriting newer with older when reindexing from remote), set **`dest.version_type`** to **`"external"`**.
  Elasticsearch will then keep the source version and reject writes that are older than the existing document.
