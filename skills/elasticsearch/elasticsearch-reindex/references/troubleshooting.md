# Reindex Troubleshooting

Common failure modes and how to resolve them.

## "Backend closed connection" in Kibana Dev Tools

The Kibana socket timeout (default 120 s) expired, but the reindex is still running on the cluster. Check progress with
the task API. On Self-Managed / ECH, list all reindex tasks. On Serverless, query the specific task ID returned by
`wait_for_completion=false`:

```text
GET /_tasks?actions=*reindex&detailed
GET /_tasks/{task_id}
```

## Mapping conflicts cause partial reindex

Documents fail to index when field types in source and destination do not match.

**Self-Managed / ECH** — enable debug logging to surface the exact field:

```json
PUT /_cluster/settings
{ "transient": { "logger.org.elasticsearch.action.bulk.TransportShardBulkAction": "DEBUG" } }
```

Search the Elasticsearch logs for `failed to execute bulk item` or `MapperParsingException`. Fix the destination
mapping, delete the partially-populated index, and re-run. Reset the logger afterward:

```json
PUT /_cluster/settings
{ "transient": { "logger.org.elasticsearch.action.bulk.TransportShardBulkAction": null } }
```

**Serverless** — `_cluster/settings` is not available. Instead, run a small test reindex with `max_docs` set to a low
value and inspect the task response for `failures`. Each failure object contains the field name and the mapping conflict
details.

## Scroll context lost (`search_phase_execution_exception`)

The default scroll keep-alive is 5 minutes. On slow or overloaded clusters, increase it on the reindex request:

```json
POST /_reindex?scroll=2h&wait_for_completion=false
{
  "source": { "index": "my-index" },
  "dest": { "index": "my-new-index" }
}
```

## Document count mismatch after multi-source reindex

When reindexing from multiple source indices, documents with the same `_id` overwrite each other. Append the source
index name to the ID with a script (see the merge example in [patterns.md](patterns.md)) or set `"op_type": "create"` on
the destination combined with `"conflicts": "proceed"` to keep the first-written version.

## Node connectivity errors (Self-Managed / ECH only)

`NodeNotConnectedException` indicates cluster instability unrelated to the reindex API. Verify cluster health is green,
reduce replicas on the destination index, and retry. If the problem persists, resolve the underlying connectivity issue
before attempting reindex. This error does not apply to Serverless — node management is handled by Elastic.
