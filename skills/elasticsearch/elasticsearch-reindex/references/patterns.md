# Reindex Patterns

Common multi-step recipes for the Reindex API. Each pattern includes the full sequence of API calls needed.

## Pattern 1: Change Mappings on an Existing Index

Use when field types, analyzers, or tokenizers need to change on an index that already contains data. Elasticsearch does
not allow altering the mapping of an existing field — reindex into a new index with the corrected mapping, then swap an
alias to make the change transparent to clients.

### Steps

1. Create the new index with corrected mappings. On Self-Managed / ECH, include `number_of_shards` and
   `number_of_replicas: 0` for write throughput. On Serverless, omit both (managed by Elastic):

```json
PUT /my-index-v2
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 0,
    "refresh_interval": "-1"
  },
  "mappings": {
    "properties": {
      "status": { "type": "keyword" },
      "message": { "type": "text", "analyzer": "standard" },
      "@timestamp": { "type": "date" }
    }
  }
}
```

1. Reindex from old to new:

```json
POST /_reindex?wait_for_completion=false&slices=auto
{
  "source": { "index": "my-index-v1" },
  "dest": { "index": "my-index-v2" }
}
```

1. Monitor until complete, then verify counts (on Serverless, use `GET /<index>/_count` instead of `_cat/count`):

```text
GET _tasks/<task_id>
GET _cat/count/my-index-v1?h=count
GET _cat/count/my-index-v2?h=count
```

1. Restore production settings (on Serverless, restore only `refresh_interval`):

```json
PUT /my-index-v2/_settings
{ "number_of_replicas": 1, "refresh_interval": "1s" }
```

1. Swap the alias atomically:

```json
POST /_aliases
{
  "actions": [
    { "remove": { "index": "my-index-v1", "alias": "my-index" } },
    { "add": { "index": "my-index-v2", "alias": "my-index" } }
  ]
}
```

1. Delete the old index once confirmed:

```json
DELETE /my-index-v1
```

## Pattern 2: Migrate Data from a Remote Cluster

Use when upgrading Elasticsearch across major versions (e.g., 7.x to 9.x) or consolidating clusters. Remote reindex does
not support slicing — partition by date range to parallelize.

### Steps

1. Confirm the remote host is allowlisted on the local cluster (`reindex.remote.whitelist` in `elasticsearch.yml`). On
   Serverless, allowlisting is managed internally and only ECH remotes are permitted (Tech Preview).

2. Create the destination index with mappings compatible with the new version.

3. Identify a good partition key. For time-series data, use `@timestamp` ranges. For entity data, use a high-cardinality
   keyword field.

4. Reindex one partition at a time (or in parallel):

```json
POST /_reindex?wait_for_completion=false
{
  "source": {
    "remote": {
      "host": "https://old-cluster:9200",
      "api_key": "base64key",
      "socket_timeout": "2m"
    },
    "index": "logs-2025.01",
    "size": 500
  },
  "dest": { "index": "logs-2025.01" }
}
```

1. Repeat for each partition. Monitor tasks and verify counts after each completes.

2. Restore replicas and refresh interval on all destination indices.

### Partition strategies

| Data shape                    | Partition key                     | Example query                                                            |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| Time-series (logs, metrics)   | `@timestamp` range                | `"range": { "@timestamp": { "gte": "2025-01-01", "lt": "2025-02-01" } }` |
| Entity data (users, products) | Modulo on `_id` or keyword field  | `"script": { "source": "doc['user_id'].value.hashCode() % 4 == 0" }`     |
| Per-index                     | Separate request per source index | One `POST /_reindex` request per source index                            |

## Pattern 2b: Copy a Data Stream from ECH to a New Data Stream in Serverless

Use when migrating a complete data stream from Elastic Cloud Hosted (ECH) to a new data stream in a Serverless project.
The reindex request runs on Serverless and pulls from the remote ECH cluster. Data streams are append-only, so the
destination must use `op_type: "create"`.

### Steps

1. **Authenticate to Serverless with an API key.** All API calls to Serverless require an API key in the request
   headers. For the remote ECH connection you can use either an API key or basic auth (username/password) in
   `source.remote`.

2. **Create the destination data stream on Serverless.** You need an index template that has `data_stream: {}` and
   matches the data stream name, then create the data stream. On Serverless omit `number_of_shards` and
   `number_of_replicas`; you can set `refresh_interval` in the template for backing indices to tune write throughput
   during the reindex (e.g. `"-1"`), then restore it after.
   - Create an index template that matches the new data stream (e.g. `logs-myapp`) with mappings and optional
     `refresh_interval` in settings.
   - Create the data stream: `PUT _data_stream/<destination-data-stream-name>` (or let reindex create it on first
     document if the template exists and you have the required index privilege).

3. **Run reindex from remote** against the Serverless project. Set `source.remote.host` to the ECH cluster URL,
   `source.index` to the ECH data stream name, and `dest.index` to the Serverless data stream name. Use
   **`dest.op_type`: `"create"`** — required for any data stream destination because data streams are append-only.

```json
POST /_reindex?wait_for_completion=false
{
  "conflicts": "proceed",
  "source": {
    "remote": {
      "host": "https://your-ech-deployment.es.region.gcp.cloud.es.io:9243",
      "api_key": "<ECH-api-key>",
      "socket_timeout": "2m",
      "connect_timeout": "30s"
    },
    "index": "logs-myapp",
    "size": 500
  },
  "dest": {
    "index": "logs-myapp",
    "op_type": "create"
  }
}
```

1. **Parallelize with query-based partitioning** if the stream is large. Remote reindex does not support slicing. Run
   multiple reindex requests in parallel, each with a `query` that partitions the data (e.g. by `@timestamp` range).

2. **Monitor** via `GET _tasks/<task_id>` (on Serverless you get the task ID from the reindex response; list/cancel may
   not be available). **Verify document count** with `GET /<data-stream-name>/_count` on both ECH and Serverless.

3. **Restore production settings** on the destination if you set `refresh_interval` to `"-1"` in the template for the
   reindex (e.g. update the index template or apply settings to existing backing indices as supported).

## Pattern 3: Split a Large Index by Date Range

Use when a monolithic index needs to be broken into daily, weekly, or monthly indices to align with ILM policies or data
stream conventions.

### Steps

1. Create destination indices with appropriate mappings (or use an index template that matches the naming pattern).

2. Use a Painless script to route each document to the correct destination index:

```json
POST /_reindex?wait_for_completion=false&slices=auto
{
  "source": {
    "index": "monolith-index"
  },
  "dest": {
    "index": "temp"
  },
  "script": {
    "lang": "painless",
    "source": "def ts = ctx._source['@timestamp']; ctx._index = 'logs-' + ts.substring(0, 10)"
  }
}
```

This routes documents to indices named `logs-YYYY-MM-DD` based on the `@timestamp` value.

1. The destination index name in the `dest` field is overridden by the script — the `"temp"` value is never used. Ensure
   index templates cover the `logs-*` pattern so indices are created automatically with correct settings.

2. Verify document counts across all resulting indices:

```text
GET _cat/count/logs-2025-01-*?h=count
```

## Pattern 4: Merge Multiple Indices into One

Use when consolidating many small indices into a single index for simpler management or improved search performance.

### Steps

1. Create the destination index with mappings that are a superset of all source indices.

2. Handle ID collisions — documents from different source indices may share the same `_id`. Append the source index name
   to make IDs unique:

```json
POST /_reindex?wait_for_completion=false&slices=auto
{
  "conflicts": "proceed",
  "source": {
    "index": ["index-a", "index-b", "index-c"]
  },
  "dest": {
    "index": "merged-index"
  },
  "script": {
    "lang": "painless",
    "source": "ctx._id = ctx._id + '-' + ctx._index"
  }
}
```

1. If ID uniqueness is already guaranteed across sources, skip the script and reindex directly.

2. Alternatively, use `"op_type": "create"` with `"conflicts": "proceed"` to keep the first version of each document and
   skip duplicates.

## Pattern 5: Reindex through an Ingest Pipeline

Use when documents need server-side enrichment (GeoIP, user-agent parsing, enrich lookups) or structural transformation
(field removal, renaming via `rename` processor, script processor) during the copy.

### Steps

1. Create (or verify) the ingest pipeline:

```json
PUT /_ingest/pipeline/my-enrich-pipeline
{
  "description": "Add GeoIP and remove sensitive fields",
  "processors": [
    { "geoip": { "field": "client_ip" } },
    { "remove": { "field": "raw_password", "ignore_missing": true } }
  ]
}
```

1. Create the destination index.

2. Reindex with the pipeline:

```json
POST /_reindex?wait_for_completion=false&slices=auto
{
  "source": { "index": "raw-data" },
  "dest": {
    "index": "enriched-data",
    "pipeline": "my-enrich-pipeline"
  }
}
```

1. Pipeline processors run on the coordinating node's ingest thread pool. Monitor cluster load and consider
   `requests_per_second` throttling if the pipeline is CPU-intensive.

## Pattern 6: Performance-Tuned Bulk Reindex

Full recipe for reindexing a large index (100M+ documents) with all performance optimizations applied.

**Serverless note:** On Serverless, omit `number_of_shards`, `number_of_replicas`, and `index.translog.*` settings (all
managed by Elastic). Only `refresh_interval` is user-configurable. Skip the `_forcemerge` step — it is not available in
Serverless.

### Steps

1. Create the destination index tuned for write throughput. On Self-Managed / ECH use the full settings below. On
   Serverless, create the index with only `refresh_interval` in settings (omit `number_of_shards`, `number_of_replicas`,
   and `index.translog.*`):

**Self-Managed / ECH:**

```json
PUT /my-large-index-v2
{
  "settings": {
    "number_of_shards": 5,
    "number_of_replicas": 0,
    "refresh_interval": "-1",
    "index.translog.durability": "async",
    "index.translog.flush_threshold_size": "1gb"
  },
  "mappings": { }
}
```

**Serverless:**

```json
PUT /my-large-index-v2
{
  "settings": {
    "refresh_interval": "-1"
  },
  "mappings": { }
}
```

Setting `translog.durability` to `"async"` and increasing the flush threshold reduces fsync frequency (Self-Managed /
ECH only). Only use these settings during bulk ingest — restore defaults after the reindex.

1. Run the reindex with all performance options:

```json
POST /_reindex?wait_for_completion=false&slices=auto&requests_per_second=-1
{
  "conflicts": "proceed",
  "source": {
    "index": "my-large-index-v1",
    "size": 5000
  },
  "dest": {
    "index": "my-large-index-v2"
  }
}
```

1. Monitor progress:

```text
GET _tasks/<task_id>
```

Watch `status.created` and `status.total` to estimate completion time.

1. After completion, restore safe settings (on Serverless, restore only `refresh_interval`):

**Self-Managed / ECH:**

```json
PUT /my-large-index-v2/_settings
{
  "number_of_replicas": 1,
  "refresh_interval": "1s",
  "index.translog.durability": "request",
  "index.translog.flush_threshold_size": "512mb"
}
```

**Serverless:**

```json
PUT /my-large-index-v2/_settings
{
  "refresh_interval": "1s"
}
```

1. Force-merge to optimize segment count for read performance (Self-Managed / ECH only — not available in Serverless):

```text
POST /my-large-index-v2/_forcemerge?max_num_segments=1
```

1. Verify counts and swap the alias.

## Decision Tree: Do I Need to Reindex?

| Scenario                                     | Reindex needed?          | Alternative                                                                                                  |
| -------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Change a field's data type                   | Yes                      | Runtime fields (read-only fix, no stored change)                                                             |
| Add a new field to existing documents        | Yes (if stored)          | Runtime fields or ingest pipeline on new data only                                                           |
| Change analyzer or tokenizer                 | Yes                      | —                                                                                                            |
| Change shard count                           | Yes (Self-Managed / ECH) | `_split` or `_shrink` for simple shard changes (not available in Serverless — shards are managed by Elastic) |
| Move data to another cluster                 | Yes (remote reindex)     | Snapshot/restore if no transformation needed (Self-Managed / ECH only — not user-accessible in Serverless)   |
| Consolidate many small indices               | Yes                      | —                                                                                                            |
| Fix a few incorrect documents                | No                       | `_update_by_query`                                                                                           |
| Rename an index                              | No                       | Alias swap                                                                                                   |
| Filter out deleted documents (reclaim space) | Yes                      | `_forcemerge?only_expunge_deletes=true` (partial reclaim, Self-Managed / ECH only)                           |

## Additional examples

Full request examples. See the [main skill file](../SKILL.md) for process and CLI mapping.

### Full performance-tuned local reindex

```json
POST /_reindex?wait_for_completion=false&slices=auto
{
  "conflicts": "proceed",
  "source": {
    "index": "my-index-000001",
    "size": 5000
  },
  "dest": {
    "index": "my-new-index"
  }
}
```

### Remote reindex with date-range partitioning

Run multiple requests in parallel, each covering a date range:

```json
POST /_reindex?wait_for_completion=false
{
  "source": {
    "remote": {
      "host": "https://remote-cluster:9200",
      "api_key": "<remote-api-key>",
      "socket_timeout": "2m"
    },
    "index": "logs-2025",
    "query": {
      "range": {
        "@timestamp": { "gte": "2025-01-01", "lt": "2025-02-01" }
      }
    },
    "size": 500
  },
  "dest": { "index": "logs-2025" }
}
```

### Reindex with field renaming script

```json
POST /_reindex?wait_for_completion=false
{
  "source": { "index": "events-v1" },
  "dest": { "index": "events-v2" },
  "script": {
    "lang": "painless",
    "source": "ctx._source.event_type = ctx._source.remove('type')"
  }
}
```

### Reindex through an ingest pipeline

```json
POST /_reindex?wait_for_completion=false
{
  "source": { "index": "raw-logs" },
  "dest": {
    "index": "enriched-logs",
    "pipeline": "geoip-and-useragent"
  }
}
```

### Merge multiple indices with ID collision handling

```json
POST /_reindex?wait_for_completion=false
{
  "conflicts": "proceed",
  "source": { "index": ["index-a", "index-b", "index-c"] },
  "dest": { "index": "merged-index" },
  "script": {
    "lang": "painless",
    "source": "ctx._id = ctx._id + '-' + ctx._index"
  }
}
```
