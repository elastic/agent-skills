# Reindex API Reference

Complete parameter reference for `POST /_reindex`. See the [main skill file](../SKILL.md) for usage guidance and best
practices.

## Endpoint

```text
POST /_reindex
POST /_reindex?wait_for_completion=false
POST /_reindex?wait_for_completion=false&slices=auto
```

## Query Parameters

| Parameter             | Type                | Default          | Description                                                                                                            |
| --------------------- | ------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `wait_for_completion` | boolean             | `true`           | Set to `false` to return a task ID immediately. The reindex runs in the background and results are stored in `.tasks`. |
| `requests_per_second` | float               | `-1` (unlimited) | Throttle indexing rate. Each batch pauses to maintain this rate. Set to `-1` to disable.                               |
| `slices`              | integer or `"auto"` | `1`              | Number of parallel slices. `auto` uses one slice per primary shard. Not supported for remote reindex.                  |
| `scroll`              | duration            | `5m`             | Keep-alive for the scroll context used to read from the source. Increase for slow clusters.                            |
| `timeout`             | duration            | —                | Timeout for the entire operation when running synchronously.                                                           |
| `refresh`             | boolean             | `false`          | Refresh the destination index after the reindex completes.                                                             |

## Request Body

### Top-level fields

| Field       | Type    | Required | Default   | Description                                                                                                                                                       |
| ----------- | ------- | -------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conflicts` | string  | No       | `"abort"` | `"abort"` stops on the first version conflict. `"proceed"` skips conflicting documents and continues. Use `"proceed"` when retrying a partially-complete reindex. |
| `max_docs`  | integer | No       | —         | Maximum number of documents to reindex. Useful for testing a configuration on a small sample before running at full scale.                                        |
| `script`    | object  | No       | —         | Painless script to transform each document. See [Script object](#script-object).                                                                                  |

### `source` object

| Field     | Type            | Required | Default    | Description                                                                                                 |
| --------- | --------------- | -------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `index`   | string or array | Yes      | —          | Source index name, alias, data stream, or list of indices.                                                  |
| `query`   | object          | No       | match_all  | Query DSL to filter source documents.                                                                       |
| `_source` | array           | No       | all fields | List of fields to include in each document.                                                                 |
| `size`    | integer         | No       | `1000`     | Number of documents per scroll batch. Reduce for large documents; increase (up to ~5000) for small ones.    |
| `slice`   | object          | No       | —          | Manual slicing: `{ "id": 0, "max": 4 }`. Prefer automatic slicing via the `slices` query parameter instead. |
| `remote`  | object          | No       | —          | Remote cluster connection. See [`source.remote` object](#sourceremote-object).                              |

### `source.remote` object

| Field             | Type     | Required | Default | Description                                                                                                                                               |
| ----------------- | -------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host`            | string   | Yes      | —       | Full URL including scheme, host, and port (e.g., `https://remote:9200`). An optional path prefix is supported (e.g., `https://remote:9200/proxy`).        |
| `username`        | string   | No       | —       | Basic auth username for the remote cluster. Supported for the remote regardless of where the reindex runs. Always use HTTPS when credentials are present. |
| `password`        | string   | No       | —       | Basic auth password for the remote cluster.                                                                                                               |
| `api_key`         | string   | No       | —       | Base64-encoded API key. Preferred over basic auth.                                                                                                        |
| `headers`         | object   | No       | —       | Custom HTTP headers. Use `{ "Authorization": "ApiKey <value>" }` as an alternative to `api_key`.                                                          |
| `socket_timeout`  | duration | No       | `30s`   | Read timeout for each scroll request to the remote. Increase to `1m`–`5m` for slow or congested networks.                                                 |
| `connect_timeout` | duration | No       | `30s`   | TCP connection timeout. Increase when the remote is behind a load balancer.                                                                               |

### `dest` object

| Field          | Type   | Required | Default      | Description                                                                                                                                                                                                                                                        |
| -------------- | ------ | -------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index`        | string | Yes      | —            | Destination index or data stream name. Create the index (or data stream via template) with explicit mappings before reindexing. When the destination is a data stream, set `op_type` to `"create"`.                                                                |
| `op_type`      | string | No       | `"index"`    | `"index"` overwrites existing documents with the same `_id`. `"create"` only creates missing documents; use with `"conflicts": "proceed"` to skip conflicts. **Required:** set to `"create"` when the destination is a data stream (data streams are append-only). |
| `pipeline`     | string | No       | —            | Name of an ingest pipeline to apply to each document during indexing.                                                                                                                                                                                              |
| `routing`      | string | No       | preserve     | `"keep"` preserves source routing (default). `"discard"` sets routing to null. `"=<value>"` sets a fixed routing value.                                                                                                                                            |
| `version_type` | string | No       | `"internal"` | `"internal"` ignores source version. `"external"` preserves source version and rejects older writes. Use `"external"` when synchronizing across clusters.                                                                                                          |

### Script object

| Field    | Type   | Description                                                                                                                                                                                                    |
| -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source` | string | Painless script body. Access the document via `ctx._source`. Set `ctx.op` to `"noop"` or `"delete"` to skip or remove documents. Modify `ctx._id`, `ctx._index`, `ctx._routing`, and `ctx._version` as needed. |
| `lang`   | string | Script language. Default and recommended: `"painless"`.                                                                                                                                                        |
| `params` | object | Named parameters accessible inside the script.                                                                                                                                                                 |

## Response Body

Returned when the reindex completes synchronously or when fetching a completed task via `GET _tasks/<task_id>`.

| Field                 | Type    | Description                                                                   |
| --------------------- | ------- | ----------------------------------------------------------------------------- |
| `took`                | integer | Total time in milliseconds.                                                   |
| `timed_out`           | boolean | Whether the operation timed out.                                              |
| `total`               | integer | Total documents processed (source-side).                                      |
| `created`             | integer | Documents successfully created in the destination.                            |
| `updated`             | integer | Documents updated in the destination (same `_id` existed).                    |
| `deleted`             | integer | Documents deleted by a script setting `ctx.op = "delete"`.                    |
| `batches`             | integer | Number of scroll batches pulled from the source.                              |
| `noops`               | integer | Documents skipped by a script setting `ctx.op = "noop"`.                      |
| `version_conflicts`   | integer | Version conflicts encountered. Only non-zero when `conflicts` is `"proceed"`. |
| `retries`             | object  | `{ "bulk": N, "search": N }` — retry counts for bulk and scroll operations.   |
| `failures`            | array   | List of per-document failure objects. Empty on full success.                  |
| `throttled_millis`    | integer | Total time spent waiting due to `requests_per_second` throttling.             |
| `requests_per_second` | float   | Effective requests-per-second rate.                                           |

## Related APIs

| API                | Endpoint                                                    | Purpose                                                                                               |
| ------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Task status        | `GET _tasks/<task_id>`                                      | Monitor a running or completed reindex task. Works on all deployment types including Serverless.      |
| List reindex tasks | `GET _tasks?actions=*reindex&detailed`                      | List all active reindex operations. Not available in Serverless — query by task ID instead.           |
| Cancel task        | `POST _tasks/<task_id>/_cancel`                             | Cancel a running reindex. Not available in Serverless — delete the destination index to stop.         |
| Rethrottle         | `POST _reindex/<task_id>/_rethrottle?requests_per_second=N` | Adjust throttling on a running reindex without canceling.                                             |
| Count              | `GET _cat/count/<index>?h=count`                            | Verify document count after reindex. Not available in Serverless — use `GET /<index>/_count` instead. |

## `reindex.remote.whitelist` Setting

Configure in `elasticsearch.yml` on every coordinating node that may execute remote reindex requests. Accepts
comma-separated `host:port` pairs with wildcard support:

```yaml
reindex.remote.whitelist: "remote-host:9200, 10.0.0.*:9200, localhost:*"
```

This setting does not apply to Elastic Cloud Serverless — Serverless only permits remote reindex from Elastic Cloud
Hosted clusters and manages the allowlist internally.

## SSL Configuration for Remote Reindex

SSL settings for remote reindex connections are configured in `elasticsearch.yml`, not in the API request body. These
settings apply to **Self-Managed only**. On ECH, SSL is managed via the deployment configuration. On Serverless, remote
reindex SSL is managed internally by Elastic.

| Setting                               | Description                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `reindex.ssl.certificate_authorities` | List of PEM CA certificate paths.                                           |
| `reindex.ssl.certificate`             | Client certificate path for mutual TLS.                                     |
| `reindex.ssl.key`                     | Client key path for mutual TLS.                                             |
| `reindex.ssl.verification_mode`       | `full` (default), `certificate`, or `none`. Use `none` only in development. |

Secure settings (`reindex.ssl.key_passphrase`, `reindex.ssl.truststore.*`, `reindex.ssl.keystore.*`) are stored in the
Elasticsearch keystore via `elasticsearch-keystore add`.
