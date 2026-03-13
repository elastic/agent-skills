# Multi Search API Reference

Quick reference for the Elasticsearch search APIs used by this skill. For full documentation, see the
[Search APIs](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-msearch).

## Multi Search

```text
POST /_msearch
POST /{index}/_msearch
```

Executes multiple searches in a single request using NDJSON (newline-delimited JSON). Each request is a header/body
pair. The final line must end with `\n` and the `Content-Type` must be `application/x-ndjson`.

| Parameter                       | Description                                                                |
| ------------------------------- | -------------------------------------------------------------------------- |
| `max_concurrent_searches`       | Maximum number of concurrent searches (defaults to node count x pool size) |
| `max_concurrent_shard_requests` | Maximum concurrent shard requests per node per sub-search                  |
| `search_type`                   | `query_then_fetch` (default) or `dfs_query_then_fetch` for global scoring  |
| `ccs_minimize_roundtrips`       | Minimize network round-trips for cross-cluster search                      |
| `rest_total_hits_as_int`        | Return `hits.total` as an integer instead of an object                     |

## Search

```text
POST /{index}/_search
```

Run a single search against one or more indices.

| Parameter          | Description                                               |
| ------------------ | --------------------------------------------------------- |
| `from`             | Starting document offset (default `0`)                    |
| `size`             | Number of hits to return (default `10`)                   |
| `timeout`          | Per-shard timeout; request fails if exceeded              |
| `track_total_hits` | Accurate hit count (`true`) or fast approximate (`false`) |
| `search_type`      | `query_then_fetch` (default) or `dfs_query_then_fetch`    |
| `request_cache`    | Enable caching for `size: 0` requests                     |

## ES|QL Query

```text
POST /_query
```

Run an ES|QL query. ES|QL uses a piped syntax (`FROM index | WHERE ... | STATS ... | LIMIT n`) and returns columnar
results by default.

| Parameter               | Description                                                 |
| ----------------------- | ----------------------------------------------------------- |
| `format`                | Response format: `json`, `csv`, `tsv`, `txt`, `yaml`        |
| `drop_null_columns`     | Remove entirely null columns from the response              |
| `allow_partial_results` | Return partial results on shard failures instead of failing |

## NDJSON Format

The `_msearch` body alternates between header and body lines:

```text
header\n
body\n
header\n
body\n
```

- **Header** — JSON object with optional `index`, `routing`, `preference`, and `search_type` fields. Use `{}` to inherit
  the index from the URL path.
- **Body** — A standard search request body (`query`, `aggs`, `size`, `sort`, `_source`, etc.).

## Common Query Types

| Query          | Use for                                                    |
| -------------- | ---------------------------------------------------------- |
| `match`        | Full-text search on analyzed fields                        |
| `term`         | Exact-value lookup on keyword or numeric fields            |
| `bool`         | Combine `must`, `should`, `must_not`, and `filter` clauses |
| `range`        | Numeric or date range filtering                            |
| `multi_match`  | Full-text search across multiple fields                    |
| `match_phrase` | Exact phrase matching with term order preserved            |
| `exists`       | Documents where a field has a non-null value               |
