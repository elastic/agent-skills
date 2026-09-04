---
name: kibana-dashboards
description: >
  Create and manage Kibana Dashboards and Lens visualizations. Use when you need to
  define dashboards and visualizations declaratively, version control them, or automate
  their deployment.
metadata:
  author: elastic
  version: 0.3.0
  universal: true
compatibility: Kibana 9.4 or later (Dashboards and Visualizations APIs) with matching
  Elasticsearch, self-managed, Elastic Cloud Hosted, or Elastic Cloud Serverless.
  Requires the `elastic` CLI ≥ 0.3 with `stack kb` support (dedicated `dashboards`
  and `visualizations` commands).
---

# Kibana Dashboards and Lens Visualizations

Create, update, and delete Kibana dashboards and standalone Lens visualizations using the Kibana 9.4+ Dashboards and
Visualizations APIs. Produce minimal, diffable JSON bodies; prefer inline panel definitions over library references; and
choose the correct dataset type (data view vs ES|QL) before writing metrics or chart layers.

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

## Prerequisites

**Version requirement:** Kibana 9.4+ (Dashboards and Visualizations APIs).

**ES|QL placement:**

- Standalone library charts: `PUT kbn:/api/visualizations/{id}` with `data_source.type: "esql"`.
- ES|QL panels embedded in a dashboard: inline `vis` panel `config` with `data_source.type: "esql"` via
  `PUT kbn:/api/dashboards/{id}`.
- Do not use `data_source.type: "data_view_reference"` or index-pattern aggregations when the user explicitly requests
  ES|QL — the persisted Lens state must use a text-based ES|QL datasource (`textBased` / `esql`), not a data-view count
  operation.

## Process

1. **Verify Kibana connectivity.** Call `GET kbn:/api/status`. If the call fails, stop and surface the error — do not
   guess endpoints or credentials. Read `version.number` to confirm the cluster meets the 9.4+ requirement.

2. **Classify the task.** Decide whether the user needs a **dashboard** (collection of panels, optional time range), a
   **standalone Lens visualization** (library item referenced by id or used alone), or **both**. Determine whether a
   deterministic saved-object id was supplied — when given, use upsert (`PUT`) with that id rather than `POST` (which
   auto-generates ids).

3. **Choose the dataset type before building metrics or layers.**

   | User intent                                      | Dataset                                                                    | Metric / axis pattern                                                                                                                    |
   | ------------------------------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
   | Simple count or aggregation on a saved data view | `data_source.type: "data_view_reference"` with `ref_id`                    | `metrics: [{ type: "primary", operation: "count" }]` (or other aggregation operations)                                                   |
   | Ad-hoc index pattern                             | `data_source.type: "data_view_spec"` with `index_pattern` and `time_field` | Same aggregation `operation` fields                                                                                                      |
   | ES\|QL query (explicit or complex logic)         | `data_source.type: "esql"` with `query`                                    | `metrics: [{ type: "primary", column: "<alias>" }]` or layer axes `{ column: "<alias>" }` — **never** `operation: "count"` on the metric |

   Write the aggregation in the ES|QL query (`STATS count = COUNT()`), then reference the resulting column by name.

4. **Build a dashboard body when creating or updating dashboards.** The request body is flat — `title`, `panels`, and
   optional `time_range` at the root. Do not wrap in `{ data: ... }` on write. Required fields:
   - `title` — exact string the user requested.
   - `panels` — array; use `[]` when the user asks for an empty dashboard (do not omit the key or invent panels).
   - `time_range` — when the user specifies a default time filter, set `{ "from": "<expr>", "to": "<expr>" }` (for
     example `{ "from": "now-7d", "to": "now" }`). Supplying `time_range` persists the dashboard time filter on open
     (equivalent to enabling time restore in the UI).

   **Upsert with a deterministic id:**

   ```json
   {
     "title": "Sales Overview",
     "panels": [],
     "time_range": { "from": "now-7d", "to": "now" }
   }
   ```

   Call `PUT kbn:/api/dashboards/eval-sales-overview` with the body above when the user supplies that id.

   **Inline ES|QL metric panel example** (inside `panels`):

   ```json
   {
     "type": "vis",
     "id": "total-requests",
     "grid": { "x": 0, "y": 0, "w": 12, "h": 6 },
     "config": {
       "title": "Total Requests",
       "type": "metric",
       "data_source": {
         "type": "esql",
         "query": "FROM logs* | STATS count = COUNT()"
       },
       "metrics": [{ "type": "primary", "column": "count" }]
     }
   }
   ```

   Prefer inline `config` properties over `config.ref_id` for portable dashboards. Read
   [Dashboard API Reference](references/dashboard-api-reference.md) for panel types, grid layout, and copy workflows.

5. **Build a standalone Lens visualization when the user asks for a library chart.** Use the Visualizations API. Upsert
   with `PUT kbn:/api/visualizations/{id}` when an id is supplied; otherwise `POST kbn:/api/visualizations` and report
   the generated id from the response.

   **ES|QL metric (total count from logs):**

   ```json
   {
     "type": "metric",
     "title": "Total Requests",
     "data_source": {
       "type": "esql",
       "query": "FROM logs* | STATS count = COUNT()"
     },
     "metrics": [{ "type": "primary", "column": "count" }]
   }
   ```

   Call `PUT kbn:/api/visualizations/eval-total-requests` when that id is required. The API persists a Lens saved object
   whose datasource state uses ES|QL (`textBased` / `esql`), not an index-pattern aggregation.

   Read [Lens API Reference](references/lens-api-reference.md) and
   [Chart Types Reference](references/chart-types-reference.md) for xy, gauge, heatmap, and other chart schemas.

6. **Execute and confirm.** Perform the write with `PUT kbn:/api/dashboards/{id}` or `PUT kbn:/api/visualizations/{id}`
   (or `POST` when no id is supplied). Confirm with `GET kbn:/api/dashboards/{id}` or
   `GET kbn:/api/visualizations/{id}`. Report the id and title back to the user — do not claim success without a
   successful read-back.

7. **List, export, or delete when requested.** Call `GET kbn:/api/dashboards` or `GET kbn:/api/visualizations` to
   discover existing objects. Call `DELETE kbn:/api/dashboards/{id}` or `DELETE kbn:/api/visualizations/{id}` to remove
   objects. For bulk export or import of saved objects, call `POST kbn:/api/saved_objects/_export` or
   `POST kbn:/api/saved_objects/_import`.

## Dashboard grid

Dashboards use a **48-column** grid. On 16:9 screens, roughly **20–24 rows** fit above the fold — target **8–12 panels**
in that band.

| Width   | Columns | Height (rows) | Use case                 |
| ------- | ------- | ------------- | ------------------------ |
| Full    | 48      | 14–16         | Wide time series, tables |
| Half    | 24      | 10–12         | Primary charts           |
| Quarter | 12      | 5–6           | KPI metrics              |
| Sixth   | 8       | 4–5           | Dense metric rows        |

**Grid packing:** When stacking rows, set the next panel's `y` to the previous panel's `y + h`. Panels sharing a row
should use the same `h`. Do not add markdown panels as dashboard titles — use descriptive chart titles instead.

## ES|QL patterns

**Time series bucket** (dashboard time picker injects `?_tstart` / `?_tend`):

```esql
FROM logs*
| WHERE @timestamp <= ?_tend AND @timestamp > ?_tstart
| STATS count = COUNT() BY BUCKET(@timestamp, 75, ?_tstart, ?_tend)
```

Set `"scale": "temporal"` on the x-axis for time-series xy charts. See
[Chart Types Reference](references/chart-types-reference.md) for axis and layer details.

**Static reference values** — use `EVAL` in the query, then reference the column:

```esql
FROM logs* | STATS count = COUNT() | EVAL goal = 15000
```

## Examples

Example JSON definitions live under [assets/](assets/): `demo-dashboard.json`, `dashboard-with-visualizations.json`,
`metric-esql.json`, `bar-chart-esql.json`, `line-chart-timeseries.json`.

## Guidelines

1. **Match the user's id and title exactly** when supplied — do not substitute auto-generated ids.
2. **Honor empty panels** — when the user asks for `panels: []`, send an empty array; do not add placeholder panels.
3. **ES|QL when requested** — use `data_source.type: "esql"` and column references; never satisfy an ES|QL request with
   `operation: "count"` on a data view.
4. **Minimal payloads** — omit derivable defaults; let the API inject styling and metadata.
5. **Confirm writes** — always read back with `GET` after create or update.
6. **Read references before complex charts** — metric and xy schemas differ between data view and ES|QL; consult
   [Chart Types Reference](references/chart-types-reference.md) before generating partition or table charts.

## Common issues

| Error                               | Likely cause                | Fix                                                                          |
| ----------------------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| 404 on GET after PUT                | Wrong id or space           | Confirm id and retry `GET kbn:/api/dashboards/{id}`                          |
| 400 validation                      | ES\|QL column mismatch      | Align `metrics[].column` / layer `column` with `STATS` aliases in the query  |
| ES\|QL panel saved as data view     | Wrong dataset type          | Use `data_source.type: "esql"`, not `data_view_reference`                    |
| Empty dashboard missing time filter | Omitted `time_range`        | Include `{ "from": "now-7d", "to": "now" }` when a default range is required |
| XY chart failure                    | Missing layer `data_source` | Put `data_source` inside each layer, not only at the root                    |

## Operations

As of CLI v0.3.0 the Dashboards and Visualizations APIs have dedicated `elastic kb dashboards` and
`elastic kb visualizations` commands for listing, reading, updating, and deleting objects by id. The `create-*-redirect`
commands do not accept a request body yet, so to write a new object supply an id and use the `update-*-redirect` (PUT)
command, which carries the JSON body via `--input-file`. To author several objects at once, build a saved-object NDJSON
and import it with `post-saved-objects-import` (read it back with `post-saved-objects-export`).

| HTTP API (shorthand)                   | `elastic` CLI command                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET kbn:/api/status`                  | `elastic kb system get-status`                                                                                                                                    |
| `POST kbn:/api/saved_objects/_import`  | `elastic kb saved-objects post-saved-objects-import --file '<path.ndjson>' --overwrite`                                                                           |
| `POST kbn:/api/saved_objects/_export`  | `elastic kb saved-objects post-saved-objects-export --objects '[{"type":"<type>","id":"<id>"}]'`                                                                  |
| `GET kbn:/api/dashboards`              | `elastic kb dashboards get-dashboards-redirect`                                                                                                                   |
| `GET kbn:/api/dashboards/{id}`         | `elastic kb dashboards get-dashboard-redirect --id '<id>'`                                                                                                        |
| `PUT kbn:/api/dashboards/{id}`         | `elastic kb dashboards update-dashboard-redirect --id '<id>' --input-file '<path.json>'`                                                                          |
| `DELETE kbn:/api/dashboards/{id}`      | `elastic kb dashboards delete-dashboard-redirect --id '<id>'`                                                                                                     |
| `POST kbn:/api/dashboards` (no id)     | `create-dashboard-redirect` takes no body yet — supply an id and use `update-dashboard-redirect`, or author via `post-saved-objects-import` (type `dashboard`)    |
| `GET kbn:/api/visualizations`          | `elastic kb visualizations get-visualizations-redirect`                                                                                                           |
| `GET kbn:/api/visualizations/{id}`     | `elastic kb visualizations get-visualization-redirect --id '<id>'`                                                                                                |
| `PUT kbn:/api/visualizations/{id}`     | `elastic kb visualizations update-visualization-redirect --id '<id>' --input-file '<path.json>'`                                                                  |
| `DELETE kbn:/api/visualizations/{id}`  | `elastic kb visualizations delete-visualization-redirect --id '<id>'`                                                                                             |
| `POST kbn:/api/visualizations` (no id) | `create-visualization-redirect` takes no body yet — supply an id and use `update-visualization-redirect`, or author via `post-saved-objects-import` (type `lens`) |
