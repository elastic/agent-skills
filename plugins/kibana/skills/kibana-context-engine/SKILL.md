---
name: kibana-context-engine
description: >
  Query Elastic Context Engine AI Indices, and the Knowledge Indicators (KIs) they
  store. Use when asked to search, explore, count, or answer questions from an AI
  Index / KI / Context Engine knowledge index, and when writing the ES|QL that queries
  one.
metadata:
  author: elastic
  version: 0.2.1
  universal: false
compatibility: Kibana 9.6 or later with matching Elasticsearch, or an Elastic Serverless
  project, with the `contextEngine:enabled` advanced setting turned on in the target
  space. Runs against the Context Engine HTTP APIs through the `elastic` CLI. The
  caller needs Context Engine `read`, plus Elasticsearch `read` and `view_index_metadata`
  on the backing `ai-index-*` indices.
---

# Query Context Engine AI Indices

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

## Concepts

**AI Index** — an Elasticsearch index named `ai-index-idx-*`, or a data stream named `ai-index-ds-*`, registered with
the Context Engine under a logical id. The registration lives in Kibana; the knowledge lives in the backing index. Only
the list operation knows which `ai-index-*` indices are registered and what to put in `FROM`; the index name alone does
not tell you.

**Knowledge Indicator (KI)** — one document in an AI Index: context prepared for agents, such as a description of some
data, a summary, an access pattern, a runnable query, or a record of a Kibana resource. A KI may answer a question
outright, or help you locate and use the source that does.

A KI is retired by a tombstone (`governance.lifecycle.status: deleted`) or by an `expires_at` in the past. On a data
stream, one KI is several revisions under the same `id`, the newest of which is its current state. The query API returns
only current, active, unexpired KIs unless the query asks otherwise (see [Lifecycle](#lifecycle)).

Search the AI Indices before broader retrieval whenever their KIs may cover the question. This skill reads KIs;
generating them belongs to the Context Engine's automations and feedback loop.

Three read-only Context Engine HTTP APIs back this skill. The [Operations](#operations) table maps each to its `elastic`
CLI command:

| Operation | HTTP API (shorthand)                                         | Input                        | Returns                                                                 |
| --------- | ------------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------- |
| List      | `GET kbn:/api/context_engine/ai_index`                       | —                            | `{ ai_indices: [{ id, description, managed, dest: { type, value } }] }` |
| Describe  | `GET kbn:/api/context_engine/ai_index/{aiIndexId}/_describe` | `aiIndexId` in the path      | `{ response }`, a free-form context block (fields, counts, examples)    |
| Query     | `POST kbn:/api/context_engine/ai_index/_query`               | `{ query, params?, limit? }` | `{ columns, values }`, ES\|QL rows                                      |

Use them in this order: **list → describe → query**. Never guess an index id, a `FROM` target, or a field name; describe
supplies all three. Nothing else can read an AI Index correctly: a generic ES|QL query (`POST /_query`) or index listing
neither knows which indices are registered nor applies the space scoping.

Every call is scoped to one space, and the space comes from the request rather than from anything written into the
query. Point the request at another space to read that space's KIs.

## The canonical KI schema

Elastic's canonical KI indices share these fields. Other AI Indices differ, so treat this as a starting shape and let
describe settle the fields for any given index.

| Field                                  | ES\|QL type | Purpose                                                                                                       |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `type`                                 | keyword     | Categorization, e.g. `"index_metadata"`, `"document"`, `"entity_profile"`, `"detection"`                      |
| `title`                                | text        | Short name of the KI or its backing entity                                                                    |
| `description`                          | text        | Short description of this KI                                                                                  |
| `content`                              | text        | Full text: purpose, questions answered, access patterns                                                       |
| `tags`                                 | keyword     | Filter facets; multi-valued, so use `MATCH(tags, ?tag)` rather than `==`                                      |
| `attributes`                           | flattened   | Structured keyword-queryable metadata (status, themes, entity names). `attributes.esql` holds runnable ES\|QL |
| `expires_at`                           | date        | Optional; a KI whose `expires_at` has passed is expired and hidden by default                                 |
| `governance.lifecycle.status`          | keyword     | `deleted` marks a tombstone, hidden by default. On a data stream, only the newest revision's status counts    |
| `governance.provenance.created_by.uri` | keyword     | The automation that wrote the KI, as `workflow://<id>`                                                        |

Semantic sub-fields use **dot notation**: `title.semantic`, `description.semantic`, `content.semantic`. They exist only
where the mapping defines them; the describe block's `Semantic fields` section lists the real ones.

### `attributes.esql` — a KI's runnable ES|QL

When a KI carries runnable ES|QL, it lives in `attributes.esql`. That is the canonical location; do not look elsewhere
in `attributes`. The field is optional, so a query must tolerate its absence. The same access pattern is also presented
as prose inside `content` — templates, params, and returns — so reach for `content` when a KI has no `attributes.esql`,
or when the description of the query matters more than the query itself.

`attributes` is `flattened`, so extract the value with `FIELD_EXTRACT` before filtering or keeping it:

```esql
FROM <dest.value>
| WHERE governance.lifecycle.status IS NULL OR governance.lifecycle.status == "active"
| WHERE expires_at IS NULL OR expires_at > NOW()
| WHERE type == "detection"
| EVAL esql = FIELD_EXTRACT(attributes, "esql")
| WHERE esql IS NOT NULL
| KEEP title, description, esql
| LIMIT 5
```

A KI may store an array of queries, making the extracted value multivalued. `IS NOT NULL` still filters correctly, but
scalar comparisons like `==` skip multivalued rows. Add `| MV_EXPAND esql` after the `IS NOT NULL` to get one row per
query.

## Flow

### Step 1 — List the AI indices

Call `GET kbn:/api/context_engine/ai_index`. Each entry gives:

- `id`, to pass to describe.
- `dest.value`, the exact string to put after `FROM`. Use it verbatim: it differs from the id (`sales-knowledge` →
  `ai-index-idx-sales-knowledge`). `dest.type` says whether it is an `index` or a `data_stream`.
- `description` and `managed`, to choose between entries.

The list is scoped to the caller's space and to what the caller can read. An entry whose backing index is empty or does
not exist yet is still listed; an index the caller lacks `read` on is silently left out.

Skip this step when your instructions already name the index. Step 2 still applies: describe supplies the `FROM` target
and the field names either way.

### Step 2 — Describe the one you picked

Call `GET kbn:/api/context_engine/ai_index/{aiIndexId}/_describe` with the `id` from Step 1. The `response` is a text
block meant to be **read, not parsed**: no regexing it into structured data. It contains:

- the `Query with ES|QL against:` line (the `FROM` target),
- `Fields`, every mapped field as `path: type` plus `searchable` / `aggregatable` (capped at 500; a path mapped
  inconsistently across matched indices shows as `conflict`),
- `Semantic fields`, the searchable `semantic_text` fields, when any,
- `Knowledge item types` and `Tags`, the top 20 KI `type` / `tags` values by document count in this space, active and
  unexpired only,
- `Example queries`, three ready ES|QL shapes, each opening with the lifecycle pipeline for the index's destination
  type.

The block is capped at ~16k tokens. Read it and use it; do not echo it back to the user.

### Step 3 — Query

Call `POST kbn:/api/context_engine/ai_index/_query` with `{ query, params?, limit? }`. Build the ES|QL from the describe
block's field list, starting from its example queries, and pass user input as named parameters (`?query`, `?type`,
`?tag`) rather than interpolating it into the query string. The response is `{ columns, values }`; summarize it for the
user rather than dumping raw rows.

**What the server owns and you cannot override:**

| Constraint       | Behavior                                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle filter | Inserted after `FROM` on any query that reads a registered AI Index: active and unexpired KIs only, newest revision per `id` on a data stream, `governance.*` dropped when the query does not name it. See [Lifecycle](#lifecycle). |
| Space filter     | Applied server-side from the request. **Never write a space condition into the query**: yours does not replace the server's and can silently match nothing.                                                                         |
| Row limit        | `limit` defaults to 100, max 1000. A smaller trailing `LIMIT` in the query wins; a larger one is capped.                                                                                                                            |
| Query size       | 10,000 characters max                                                                                                                                                                                                               |
| `params`         | At most 100 entries; keys ≤256 chars, string values ≤4096 chars                                                                                                                                                                     |
| Index access     | The query's `FROM` decides what is read; Elasticsearch index privileges bound it. ES 4xx comes back as-is.                                                                                                                          |

There is no `time_range` and no `filter` parameter. Express time windows in the ES|QL itself
(`WHERE @timestamp >= NOW() - 24 hours`) or through `params`.

### Lifecycle

Open every query with the two lifecycle filters, unless reading retired KIs, and end row-returning queries in `KEEP`
(aggregations end in `STATS`): the query then reads as what it returns without pulling `governance.*` into context.

```esql
| WHERE governance.lifecycle.status IS NULL OR governance.lifecycle.status == "active"
| WHERE expires_at IS NULL OR expires_at > NOW()
```

The query API adds these two filters and `DROP governance.*` to any query that omits them, and on a data stream always
keeps only the newest revision per `id` (adding `METADATA _id, _index` when missing). A top-level `WHERE` on a lifecycle
field switches off that field's filter only; showing the field in `KEEP` does not. Any `governance.*` column named
anywhere in the query, the opening status filter included, switches off the `DROP`, so a query that opens with the two
filters returns `governance.*` columns unless it ends in `KEEP` or `STATS`. An index that is not registered as an AI
Index is read as-is.

## Examples

These run as-is against canonical KI indices. For any other AI Index, adapt the field names from the describe block:
`title.semantic` does not exist unless the mapping has it.

### Full-text search, lexical and semantic fused

```esql
FROM ai-index-idx-sales-knowledge METADATA _id, _index, _score
| WHERE governance.lifecycle.status IS NULL OR governance.lifecycle.status == "active"
| WHERE expires_at IS NULL OR expires_at > NOW()
| FORK
    ( WHERE MATCH(title, ?query) OR MATCH(description, ?query) OR MATCH(content, ?query) | SORT _score DESC | LIMIT 20 )
    ( WHERE MATCH(title.semantic, ?query) OR MATCH(description.semantic, ?query) OR MATCH(content.semantic, ?query) | SORT _score DESC | LIMIT 20 )
| FUSE
| SORT _score DESC, _id ASC
| KEEP title, description, content, type, tags
| LIMIT 5
```

Called with the search phrase as a parameter:

```json
{ "query": "<the esql above>", "params": { "query": "refund policy for annual plans" }, "limit": 5 }
```

### Filter by KI type and tag

```esql
FROM ai-index-idx-sales-knowledge
| WHERE governance.lifecycle.status IS NULL OR governance.lifecycle.status == "active"
| WHERE expires_at IS NULL OR expires_at > NOW()
| WHERE type == ?type AND MATCH(tags, ?tag)
| KEEP title, description, content, type, tags
| LIMIT 5
```

### Count KIs by type

A first probe to confirm the index holds KIs visible from this space:

```esql
FROM ai-index-idx-sales-knowledge
| WHERE governance.lifecycle.status IS NULL OR governance.lifecycle.status == "active"
| WHERE expires_at IS NULL OR expires_at > NOW()
| STATS count = COUNT(*) BY type
| SORT count DESC
| LIMIT 20
```

### Read retired KIs, only when asked

Only when the user asks about deleted or expired knowledge. Tombstoned and expired KIs stay readable, on an index or a
data stream:

- **Tombstoned:** a `WHERE` on `governance.lifecycle.status` turns off the status filter and, being a `governance.*`
  column, the `DROP` too; the expiry filter still applies.
- **Expired:** a `WHERE` on `expires_at` turns off the expiry filter; the status filter still applies.

Nothing else is readable: a KI whose document was removed is gone, and older revisions on a data stream are never
returned.

```esql
FROM ai-index-idx-sales-knowledge
| WHERE governance.lifecycle.status == "deleted"
| KEEP title, governance.provenance.created_by.uri
| LIMIT 20
```

On a data stream, the same query returns the KIs whose newest revision is a tombstone:

```esql
FROM ai-index-ds-sales-knowledge
| WHERE governance.lifecycle.status == "deleted"
| KEEP title, governance.provenance.created_by.uri
| LIMIT 20
```

## Diagnosing

These failure modes look alike from the outside and have different fixes. Work down the table.

| Symptom                                               | Cause                                                                              | Fix                                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `elastic kb context-engine` is not a known command    | The installed `elastic` CLI predates the Context Engine commands                   | Update the `elastic` CLI                                                                             |
| **404** from every Context Engine call in one space   | `contextEngine:enabled` is off **in that space**. Not a permissions problem        | Turn it on in that space's advanced settings                                                         |
| **404** from every Context Engine call on every space | Kibana predates the Context Engine APIs                                            | Check the version against the compatibility note above                                               |
| **403** from every Context Engine call                | Caller lacks the Context Engine `read` Kibana privilege                            | Add Context Engine `read` to the caller's role                                                       |
| **403** from query or describe only                   | Missing Elasticsearch index privilege on the backing `ai-index-*` indices          | Grant `read` (query) / `read` and `view_index_metadata` (describe)                                   |
| Describe returns a block with no counts sections      | `type`/`tags` are not aggregatable `keyword` fields, or no documents in this space | Expected; the rest of the block is still usable                                                      |
| An AI index you expect is not listed                  | No `read` on its backing index, or every document in it belongs to another space   | Check privileges and the space the request is scoped to                                              |
| `Unknown index` from a query whose id **was** listed  | The AI Index is registered but its backing index does not exist yet                | Expected for a registration with no data; pick another index                                         |
| Error saying the query response is too large          | The rows exceeded the 20 MB response cap                                           | Narrow with `KEEP` (drop `content` and other large fields), lower `limit`, or aggregate with `STATS` |
| Query returns nothing but the index has data          | Wrong space: the server-side space filter hides other spaces' documents            | Scope the request to the right space                                                                 |
| A KI you know exists is not returned                  | It is tombstoned, or its `expires_at` has passed                                   | Filter on `governance.lifecycle.status` or `expires_at` in a `WHERE` to read it (see Lifecycle)      |
| No `governance.*` columns in the result               | The query names no `governance.*` column, or a `KEEP`/`STATS` leaves them out      | Expected; name the field you need, e.g. in `KEEP`                                                    |

## Guidelines

- Never skip describe. A query written from memory could fail, or silently returns nothing.
- Read AI Indices only through `POST kbn:/api/context_engine/ai_index/_query`. A direct Elasticsearch query or a
  cluster-wide ES|QL query (`POST /_query`) bypasses the space scoping, the lifecycle filter, and the row cap: it
  returns every revision, deleted and expired ones included. Consult the `elasticsearch-esql` skill for ES|QL syntax.
- Start at `limit` 5 and narrow the columns with `KEEP`. The whole result enters your context.
- If the top 5 don't answer the question, check how they fall short: on topic but incomplete → raise the limit; off
  topic → the query is wrong, so reword the search terms or loosen the `WHERE` rather than asking for more rows.
- Answer from the rows and cite the KI titles; do not dump the raw result.
- An empty result means no current KI. Do not read tombstones or expired KIs unless the user asks about deleted or
  expired knowledge.

## Out of scope

- Creating, updating, or deleting AI indices, and managing their `sources` / `automations` / `feedback_analysis` config.
- Generating Knowledge Indicators, or deciding what an AI Index should contain. That is the Context Engine's automations
  and its analyze-and-improve feedback loop, not query time.

## Operations

| HTTP API (shorthand)                                         | `elastic` CLI command                                                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `GET kbn:/api/context_engine/ai_index`                       | `elastic kb context-engine get-context-engine-ai-index`                                                           |
| `GET kbn:/api/context_engine/ai_index/{aiIndexId}/_describe` | `elastic kb context-engine get-context-engine-ai-index-aiindexid-describe --ai-index-id '<id>'`                   |
| `POST kbn:/api/context_engine/ai_index/_query`               | `elastic kb context-engine post-context-engine-ai-index-query --query '<esql>' [--params '<json>'] [--limit <n>]` |
| `GET kbn:/api/context_engine/ai_index/{aiIndexId}`           | `elastic kb context-engine get-context-engine-ai-index-aiindexid --ai-index-id '<id>'`                            |
