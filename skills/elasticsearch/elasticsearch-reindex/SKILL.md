---
name: elasticsearch-reindex
description: >
  Guide Elasticsearch reindex for performance: local and remote, slicing, throttling,
  task API. Use when copying or migrating indices, changing mappings, or transforming
  during reindex.
metadata:
  author: elastic
  version: 0.2.0
  universal: true
compatibility: Elasticsearch 8.x or 9.x, self-managed, Elastic Cloud Hosted, or Elastic
  Cloud Serverless; local reindex works on all deployment types, while remote reindex
  requires host allowlisting on self-managed / Elastic Cloud Hosted (Serverless supports
  Elastic Cloud Hosted remotes only, Tech Preview). Requires the `elastic` CLI ≥ 0.2
  with `stack es` support.
---

# Elasticsearch Reindex

Copy documents from source indices or data streams to a destination using `POST /_reindex`. An expert reindex workflow
prepares the destination explicitly, chooses local versus remote execution, filters at the source when only a subset is
needed, runs long copies asynchronously, tracks the task to completion, and verifies the destination document count
before reporting results.

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

## Process

1. **Confirm connectivity and deployment type.** Call `GET /`. Read `build_flavor` and `version.number` to know whether
   shard, replica, and cluster-settings APIs are available (Serverless manages shards/replicas internally and blocks
   most `_cluster/*` APIs). The decision: continue only when the cluster is reachable. If the call fails, stop — do not
   guess endpoints or credentials.

2. **Decide local versus remote reindex.** Compare where the source and destination live.
   - **Same cluster** — use local reindex: `source.index` and `dest.index` only. Do **not** add `source.remote` when
     both indices are on the cluster you are connected to.
   - **Different cluster** — use reindex from remote: add `source.remote` with the remote cluster URL and credentials.
     Remote reindex does not support slicing; compensate with query-based partitioning (date ranges, term filters)
     across parallel requests. Confirm the remote host is allowlisted on Self-Managed / ECH (`reindex.remote.whitelist`
     in cluster config); Serverless manages allowlisting internally (ECH remotes only, Tech Preview).

   Data needed: source index name(s), destination index name, and whether they share a cluster.

3. **Inspect the source — never guess field names or counts.** Call `GET /{source}/_mapping` to ground field names and
   types. Call `GET /{source}/_count` (or `GET /_cat/count/{source}?h=count` on Self-Managed / ECH) to learn how many
   documents exist.

   The decision: **full copy** versus **filtered subset**.
   - Full copy — omit `source.query` (match-all behavior).
   - Filtered subset — add `source.query` with Query DSL. For time ranges, use a `range` filter on the timestamp field
     (commonly `@timestamp`), e.g. `"gte": "2025-01-01", "lt": "2025-02-01"` for January 2025. Do **not** run a
     full-index copy when the user asked for a date range or other filter.

   Data needed: the user's filter criteria and the mapping-confirmed field names.

4. **Prepare the destination index before copying.** `_reindex` does **not** copy mappings, shard counts, or analyzers.
   Create the destination with explicit settings and mappings derived from the source mapping via `PUT /{dest}`.
   - On Self-Managed / ECH: set `number_of_replicas: 0` and `refresh_interval: "-1"` on the destination during the copy
     for write throughput; restore production values afterward with `PUT /{dest}/_settings`.
   - On Serverless: omit `number_of_shards` and `number_of_replicas` (managed by Elastic); you may set
     `refresh_interval: "-1"` during the copy.
   - For **data stream** destinations: ensure an index template with `data_stream: {}` exists, create the data stream,
     and set `dest.op_type` to `"create"` (append-only).

   The decision: create/prepare the target rather than relying on auto-creation with dynamic mapping. Wrong or missing
   mappings cause partial failures or silent type coercion.

   Data needed: destination name, corrected or compatible mappings, and deployment-specific settings constraints.

5. **Build and submit the reindex request.** Call `POST /_reindex?wait_for_completion=false` for any copy that may take
   more than a few seconds or when the user says the index is large — the response returns a **task id** immediately
   instead of blocking.

   Request body essentials:
   - `source.index` — source index or data stream (correct name, not reversed with `dest.index`).
   - `dest.index` — prepared destination from step 4.
   - `source.query` — include only when step 3 chose a filtered subset.
   - `conflicts: "proceed"` — when retrying a partially complete reindex.
   - Optional tuning: `source.size` (batch size), `requests_per_second` (throttle), `slices=auto` on local reindex only
     (parallelize per primary shard — never for remote), `scroll` (increase keep-alive on slow clusters), `max_docs`
     (test runs), `script` (transform), `dest.pipeline` (ingest enrichment).

   Example filtered subset (January 2025 only):

   ```json
   {
     "source": {
       "index": "eval-reindex-src",
       "query": {
         "range": {
           "@timestamp": { "gte": "2025-01-01", "lt": "2025-02-01" }
         }
       }
     },
     "dest": { "index": "eval-reindex-jan" }
   }
   ```

   Do **not** reach for `_split`, `_shrink`, or snapshot/restore when the task is a filtered subset copy or a straight
   document migration — those APIs solve different problems.

6. **Track the task to completion.** Store the task id from the reindex response. Poll `GET /_tasks/{task_id}` until
   `completed` is `true`. Read `status.total`, `status.created`, and `response.failures`. On Self-Managed / ECH you may
   also list active reindex tasks with `GET /_tasks?actions=*reindex&detailed`; on Serverless, query by task id only
   (list/cancel are not available). Adjust throttling mid-flight with
   `POST /_reindex/{task_id}/_rethrottle?requests_per_second=N` without canceling.

7. **Verify and report the destination count.** Call `GET /{dest}/_count` (works on all deployment types). On
   Self-Managed / ECH you may also use `GET /_cat/count/{dest}?h=count`. Compare source filter expectations to the
   destination count. Report the **exact** count from the destination — do not estimate or guess.

   After a successful full copy, restore production settings on the destination with `PUT /{dest}/_settings` (replicas
   and refresh interval on Self-Managed / ECH; refresh interval only on Serverless).

## Deployment constraints

| Capability                  | Self-Managed / ECH | Serverless                                |
| --------------------------- | ------------------ | ----------------------------------------- |
| Local reindex               | Full support       | Full support                              |
| Reindex from remote         | Full support       | Tech Preview — ECH remotes only           |
| `number_of_shards/replicas` | User-configurable  | Managed — omit on index creation          |
| `slices=auto` (local only)  | Supported          | Supported for local reindex               |
| `GET /_cat/count/{index}`   | Supported          | Not available — use `GET /{index}/_count` |
| `GET /_tasks` (list/cancel) | Full               | Get by task id only                       |
| `PUT /_cluster/settings`    | Supported          | Blocked                                   |
| `_split` / `_shrink`        | Supported          | Not available                             |

## Consider alternatives first

- **Runtime fields** — fix field-type mismatches or add computed fields without reindexing when stored values need not
  change.
- **Aliases** — redirect queries transparently; combine with reindex for zero-downtime mapping changes.
- **Snapshot and restore** (Self-Managed / ECH) — faster whole-index transfer when no transformation is needed.

See the decision tree in [references/patterns.md](references/patterns.md#decision-tree-do-i-need-to-reindex).

## Reference material

- [API parameter reference](references/api-reference.md) — full `POST /_reindex` body and query parameters
- [Multi-step patterns](references/patterns.md) — mapping changes, remote migration, merge, ingest pipeline, performance
- [Tuning](references/tuning.md) — batch size (`source.size`), timestamps, versioning
- [Troubleshooting](references/troubleshooting.md) — mapping conflicts, scroll timeouts, count mismatches

## Examples

**"Copy `logs-2024` into a new index with a corrected mapping"** — create the destination first, then reindex:

```json
POST /_reindex
{ "source": { "index": "logs-2024" }, "dest": { "index": "logs-2024-v2" } }
```

**"Reindex a large index in parallel and throttle it"** — slice automatically and cap the request rate:

```json
POST /_reindex?slices=auto&requests_per_second=2000
{ "source": { "index": "events" }, "dest": { "index": "events-v2" } }
```

**"Migrate only recent documents"** — filter the source with a query:

```json
POST /_reindex
{
  "source": { "index": "metrics", "query": { "range": { "@timestamp": { "gte": "now-30d" } } } },
  "dest": { "index": "metrics-recent" }
}
```

## Guidelines

- **Confirm deployment type first.** Call `GET /` and read `build_flavor`; shard, replica, cluster-settings, and task
  APIs differ between Self-Managed / ECH and Serverless (see Deployment constraints).
- **Prefer an alternative when it fits.** Runtime fields, aliases, or snapshot-and-restore often avoid a full reindex.
- **Tune the destination for the copy.** On Self-Managed / ECH set `number_of_replicas: 0` and `refresh_interval: "-1"`
  during the copy, then restore production settings afterward; on Serverless these are managed.
- **Parallelize large copies.** Use `slices=auto` for local reindex and throttle with `requests_per_second` to protect
  the cluster.
- **Run big jobs asynchronously.** Submit with `wait_for_completion=false` and poll the task instead of blocking.
- **Verify by count.** Compare the source filter expectation to the exact destination `GET /{dest}/_count` — never
  estimate.

## Operations

| HTTP API (shorthand)                                         | `elastic` CLI command                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `GET /`                                                      | `elastic es info`                                                                     |
| `GET /{index}/_mapping`                                      | `elastic es indices get-mapping --index '<index>'`                                    |
| `GET /{index}/_count`                                        | `elastic es count --index '<index>'`                                                  |
| `GET /_cat/count/{index}?h=count`                            | `elastic es cat count --index '<index>' --h count`                                    |
| `PUT /{index}`                                               | `elastic es indices create --index '<index>' --mappings '<json>' --settings '<json>'` |
| `PUT /{index}/_settings`                                     | `elastic es indices put-settings --index '<index>' --settings '<json>'`               |
| `POST /_reindex?wait_for_completion=false`                   | `elastic es reindex --wait-for-completion false --source '<json>' --dest '<json>'`    |
| `GET /_tasks/{task_id}`                                      | `elastic es tasks get --task-id '<task_id>'`                                          |
| `GET /_tasks?actions=*reindex&detailed`                      | `elastic es tasks list --actions '*reindex' --detailed`                               |
| `POST /_tasks/{task_id}/_cancel`                             | `elastic es tasks cancel --task-id '<task_id>'`                                       |
| `POST /_reindex/{task_id}/_rethrottle?requests_per_second=N` | `elastic es reindex-rethrottle --task-id '<task_id>' --requests-per-second <N>`       |
