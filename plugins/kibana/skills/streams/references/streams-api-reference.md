# Kibana Streams API Reference

Quick reference for reading stream data and managing stream lifecycle via the Kibana Streams REST API. Lifecycle
operations require the `kbn-xsrf: true` header.

[Streams API (full operations list)](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-streams)

## Base path

Default space: `<kibana_url>/api/streams`

Non-default space: `<kibana_url>/s/<space_id>/api/streams`

## Path parameters

| Parameter      | Used in                                                        | Description                      |
| -------------- | -------------------------------------------------------------- | -------------------------------- |
| `{name}`       | `/api/streams/{name}`, `.../queries`, `.../significant_events` | Stream identifier                |
| `{streamName}` | `/api/streams/{streamName}/attachments`                        | Stream identifier (same as name) |

Refer to the official operation pages for request/response body schemas.

## In-scope operations (v1)

### Read

| Operation                  | Method | Path                                     | Description                                          |
| -------------------------- | ------ | ---------------------------------------- | ---------------------------------------------------- |
| Get stream list            | GET    | `/api/streams`                           | List all streams                                     |
| Get a stream               | GET    | `/api/streams/{name}`                    | Get stream definition and metadata                   |
| Get ingest stream settings | GET    | `/api/streams/{name}/_ingest`            | Get ingest config (stream lifecycle + failure store) |
| Get query stream settings  | GET    | `/api/streams/{name}/_query`             | Get query configuration                              |
| Get stream queries         | GET    | `/api/streams/{name}/queries`            | List queries for the stream                          |
| Read significant events    | GET    | `/api/streams/{name}/significant_events` | Get significant events for the stream                |
| Get stream attachments     | GET    | `/api/streams/{streamName}/attachments`  | List attachments (dashboards, rules, SLOs)           |

In ingest settings, **stream retention** is `ingest.lifecycle` (e.g. `dsl.data_retention`); **failure store retention**
is `ingest.failure_store.lifecycle`. When users ask to set or update retention, they usually mean the stream's data
retention, not the failure store.

### Lifecycle

| Operation       | Method | Path                    | Description                                         |
| --------------- | ------ | ----------------------- | --------------------------------------------------- |
| Disable streams | POST   | `/api/streams/_disable` | Disable streams (can lead to data loss — warn user) |
| Enable streams  | POST   | `/api/streams/_enable`  | Enable streams                                      |
| Resync streams  | POST   | `/api/streams/_resync`  | Resync streams                                      |

Disabling streams deletes wired stream data while preserving classic stream data; confirm with the user before calling
the disable API.

## Deferred (later version)

The following operations are not covered by this skill in v1:

| Operation                     | Method | Path (pattern)                                                          |
| ----------------------------- | ------ | ----------------------------------------------------------------------- |
| Create or update a stream     | PUT    | `/api/streams/{name}`                                                   |
| Delete a stream               | DELETE | `/api/streams/{name}`                                                   |
| Fork a stream                 | POST   | `/api/streams/{name}/_fork`                                             |
| Update ingest stream settings | PUT    | `/api/streams/{name}/_ingest`                                           |
| Upsert query stream settings  | PUT    | `/api/streams/{name}/_query`                                            |
| Export stream content         | POST   | `/api/streams/{name}/content/export`                                    |
| Import content into a stream  | POST   | `/api/streams/{name}/content/import`                                    |
| Bulk update queries           | POST   | `/api/streams/{name}/queries/_bulk`                                     |
| Upsert a query to a stream    | PUT    | `/api/streams/{name}/queries/{queryId}`                                 |
| Remove a query from a stream  | DELETE | `/api/streams/{name}/queries/{queryId}`                                 |
| Generate significant events   | POST   | `/api/streams/{name}/significant_events/_generate`                      |
| Preview significant events    | POST   | `/api/streams/{name}/significant_events/_preview`                       |
| Bulk update attachments       | POST   | `/api/streams/{streamName}/attachments/_bulk`                           |
| Link an attachment            | PUT    | `/api/streams/{streamName}/attachments/{attachmentType}/{attachmentId}` |
| Unlink an attachment          | DELETE | `/api/streams/{streamName}/attachments/{attachmentType}/{attachmentId}` |

For request/response details, use the
[Streams API group](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-streams) and the linked operation pages.
