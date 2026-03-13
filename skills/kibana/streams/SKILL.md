---
name: kibana-streams
description: >
  List, inspect, enable, disable, and resync Kibana Streams via the REST API. Use
  when the user needs stream details, ingest/query settings, queries, significant
  events, or attachments.
metadata:
  author: elastic
  version: 0.1.0
---

# Kibana Streams

Read stream metadata, settings, queries, significant events, and attachments, and manage stream lifecycle (enable,
disable, resync) via the Kibana Streams REST API. Streams are an experimental way to manage data in Kibana — expect API
and behavior changes. This skill covers **read** operations and **lifecycle** only; create, update, delete, fork, and
other mutating operations may be added in a later version.

For detailed endpoints and parameters, see [references/streams-api-reference.md](references/streams-api-reference.md).

## When to use

- Listing all streams or getting a single stream's definition and metadata
- Reading a stream's ingest or query settings
- Listing a stream's queries
- Reading significant events for a stream
- Listing attachments (dashboards, rules, SLOs) linked to a stream
- Enabling, disabling, or resyncing streams

## Prerequisites

| Item               | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| **Kibana URL**     | Kibana endpoint (e.g. `https://localhost:5601` or a Cloud deployment URL)   |
| **Authentication** | API key or basic auth (see the elasticsearch-authn skill)                   |
| **Privileges**     | `read_stream` for read operations; appropriate privilege for lifecycle APIs |

Use the space-scoped path `/s/{space_id}/api/streams` when operating in a non-default space.

## API base and headers

- **Base path:** `GET` or `POST` to `<kibana_url>/api/streams` (or `/s/<space_id>/api/streams` for a space).
- **Read operations:** Typically do not require extra headers; follow the
  [official API docs](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-streams) for each endpoint.
- **Lifecycle operations:** `POST /api/streams/_disable`, `_enable`, and `_resync` are mutating — send `kbn-xsrf: true`
  (or equivalent) as required by your Kibana version.

## Operations (read + lifecycle)

### Read

| Operation                  | Method | Path                                     |
| -------------------------- | ------ | ---------------------------------------- |
| Get stream list            | GET    | `/api/streams`                           |
| Get a stream               | GET    | `/api/streams/{name}`                    |
| Get ingest stream settings | GET    | `/api/streams/{name}/_ingest`            |
| Get query stream settings  | GET    | `/api/streams/{name}/_query`             |
| Get stream queries         | GET    | `/api/streams/{name}/queries`            |
| Read significant events    | GET    | `/api/streams/{name}/significant_events` |
| Get stream attachments     | GET    | `/api/streams/{streamName}/attachments`  |

### Lifecycle

| Operation       | Method | Path                    |
| --------------- | ------ | ----------------------- |
| Disable streams | POST   | `/api/streams/_disable` |
| Enable streams  | POST   | `/api/streams/_enable`  |
| Resync streams  | POST   | `/api/streams/_resync`  |

Path parameters: `{name}` and `{streamName}` are the stream identifier (same value; the API docs use both names).

## Lifecycle and retention (ingest settings)

Ingest settings (`GET /api/streams/{name}/_ingest`) expose two separate lifecycle areas:

- **Stream lifecycle** (`ingest.lifecycle`) — Controls how long the **stream's data** is retained. Use
  `lifecycle.dsl.data_retention` (e.g. `"30d"`) for explicit retention, or `lifecycle.inherit` for child streams. This
  is what users usually mean when they ask to "set retention", "update retention", or "change the stream's retention".
- **Failure store lifecycle** (`ingest.failure_store.lifecycle`) — Controls retention of **failed documents** only
  (documents that did not process successfully). Users rarely need to change this unless they explicitly mention the
  failure store or failed-document retention.

When a user asks to set or update retention, target the **stream's** main lifecycle (`lifecycle.dsl.data_retention`),
not the failure store, unless they specifically ask about failure store or failed documents.

## Examples

### List streams

```bash
curl -X GET "${KIBANA_URL}/api/streams" \
  -H "Authorization: ApiKey <base64-api-key>"
```

### Get a single stream

```bash
curl -X GET "${KIBANA_URL}/api/streams/my-stream" \
  -H "Authorization: ApiKey <base64-api-key>"
```

### Get stream queries

```bash
curl -X GET "${KIBANA_URL}/api/streams/my-stream/queries" \
  -H "Authorization: ApiKey <base64-api-key>"
```

### Get significant events or attachments

```bash
# Significant events
curl -X GET "${KIBANA_URL}/api/streams/my-stream/significant_events" \
  -H "Authorization: ApiKey <base64-api-key>"

# Attachments (dashboards, rules, SLOs linked to the stream)
curl -X GET "${KIBANA_URL}/api/streams/my-stream/attachments" \
  -H "Authorization: ApiKey <base64-api-key>"
```

### Disable, enable, or resync streams

```bash
# Disable streams (request body per API docs) — warn user and confirm before proceeding
curl -X POST "${KIBANA_URL}/api/streams/_disable" \
  -H "Authorization: ApiKey <base64-api-key>" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -d '{}'

# Enable streams
curl -X POST "${KIBANA_URL}/api/streams/_enable" \
  -H "Authorization: ApiKey <base64-api-key>" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -d '{}'

# Resync streams
curl -X POST "${KIBANA_URL}/api/streams/_resync" \
  -H "Authorization: ApiKey <base64-api-key>" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Check the [Streams API operation pages](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-streams) for
request/response bodies (e.g. request body for \_disable/\_enable/\_resync if required).

## Guidelines

- When the user asks to set or update **retention**, assume they mean the **stream's** data retention
  (`ingest.lifecycle` / `lifecycle.dsl.data_retention`). Do not change only the failure store retention unless they
  explicitly ask about the failure store or failed documents.
- Other mutating operations (create, update, delete, fork, bulk query management, attachment management, and more) are
  not supported by this skill. See [references/streams-api-reference.md](references/streams-api-reference.md) for the
  full list of deferred operations.
- **Disabling streams can lead to data loss.** Before calling the disable API, warn the user and confirm they understand
  the risk (and have backed up or no longer need the data).
- Prefer read operations when the user only needs to inspect stream state; use lifecycle APIs when they need to enable,
  disable, or resync streams.
