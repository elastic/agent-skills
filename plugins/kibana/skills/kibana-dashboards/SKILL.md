---
name: kibana-dashboards
description: >
  Create and manage Kibana Dashboards and Lens visualizations. Use when you need to
  define dashboards and visualizations declaratively, version control them, automate
  their deployment, or improve layout, sections, controls, or chart design.
metadata:
  author: elastic
  version: 0.4.0
  universal: true
compatibility: Kibana 9.4 or later (Dashboards and Visualizations APIs) with matching
  Elasticsearch, self-managed, Elastic Cloud Hosted, or Elastic Cloud Serverless.
  Requires the `elastic` CLI ≥ 0.4 with `stack kb` support (dedicated `dashboards`
  and `visualizations` commands).
---

# Kibana Dashboards and Lens Visualizations

Create, update, and delete Kibana dashboards and standalone Lens visualizations using the Kibana 9.4+ Dashboards and
Visualizations APIs. Produce minimal, diffable JSON bodies; prefer inline panel definitions over library references;
choose the correct dataset type (data view vs ES|QL) before writing metrics or chart layers; and follow the design
guidance in [Dashboard Design Guidelines](references/dashboard-design.md) and
[Chart Design Guidelines](references/chart-design.md) so the result reads like a well-made Kibana dashboard, not a
schema dump.

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
   guess endpoints or credentials. Read `version.number` to confirm the cluster meets the 9.4+ requirement, and keep the
   version in mind: a few settings are marked 9.5+ or 9.6+ in [Design essentials](#design-essentials) and have a
   fallback for older clusters. Never refuse a dashboard on 9.4 because of them.

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

   **Write the ES|QL with the `elasticsearch-esql` skill.** It covers schema discovery, time series data streams (`TS`,
   `RATE` for counters, `METRICS_INFO`), and query execution. Two dashboard-specific points on top of it:
   - Run every panel query before saving it, substituting fixed expressions such as `NOW() - 7 days` for `?_tstart` and
     `?_tend`, which only Kibana can supply.
   - Check the data's time span (`STATS MIN(@timestamp), MAX(@timestamp)`). Without a saved `time_range`, Kibana opens
     the dashboard on the last 15 minutes, so a dashboard over older or historical data renders empty panels. Tell the
     user which range shows data, or ask whether to persist one.

4. **Design before you write.** Read [Dashboard Design Guidelines](references/dashboard-design.md) and
   [Chart Design Guidelines](references/chart-design.md) and decide the composition, the chart type and grid size of
   each panel, the per-chart presentation settings, and the exact `grid` coordinates. The rules most often missed are
   summarized in [Design essentials](#design-essentials) below. Choices you do not make deliberately fall back to those
   defaults; they are not optional polish.

5. **Build a dashboard body when creating or updating dashboards.** The request body is flat — `title`, `panels`, and
   optional `description`, `time_range`, and `pinned_panels` at the root. Do not wrap in `{ data: ... }` on write.
   Required fields:
   - `title` — exact string the user requested; otherwise a title derived from what the panels measure. Never empty.
   - `description` — set on every new dashboard.
   - `panels` — array of panels and sections; use `[]` when the user asks for an empty dashboard (do not omit the key or
     invent panels).
   - `time_range` — when the user specifies a default time filter, set `{ "from": "<expr>", "to": "<expr>" }` (for
     example `{ "from": "now-7d", "to": "now" }`). Supplying `time_range` persists the dashboard time filter on open
     (equivalent to enabling time restore in the UI). Do not invent a range the user did not ask for.
   - `pinned_panels` — the controls chosen in the design step (see the Controls section of the design guidelines).

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
     "grid": { "x": 0, "y": 0, "w": 12, "h": 5 },
     "config": {
       "type": "metric",
       "data_source": {
         "type": "esql",
         "query": "FROM logs* | STATS `Total requests` = COUNT()"
       },
       "metrics": [{ "type": "primary", "column": "Total requests" }]
     }
   }
   ```

   The metric has no `title` because its label already names it, and it is a quarter-width, 5-row panel — both are
   design defaults, not stylistic choices. Prefer inline `config` properties over `config.ref_id` for portable
   dashboards. Read [Dashboard API Reference](references/dashboard-api-reference.md) for panel types and copy workflows.

6. **Build a standalone Lens visualization when the user asks for a library chart.** Use the Visualizations API. Upsert
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
   [Chart Types Reference](references/chart-types-reference.md) for xy, gauge, heatmap, and other chart schemas, and
   apply the same [Chart Design Guidelines](references/chart-design.md) as for dashboard panels.

7. **Edit existing objects in place.** `PUT` replaces the whole document, so `GET` first, change only what was asked,
   and send everything else back unchanged — panel `id`s, queries, filters, controls, and `time_range` included.

8. **Execute and confirm.** Perform the write with `PUT kbn:/api/dashboards/{id}` or `PUT kbn:/api/visualizations/{id}`
   (or `POST` when no id is supplied). Confirm with `GET kbn:/api/dashboards/{id}` or
   `GET kbn:/api/visualizations/{id}`. Report the id and title back to the user — do not claim success without a
   successful read-back.

   A successful read-back proves the object persisted, not that it renders. The API normalizes the body and fills in
   defaults. Compare the returned config against what you sent and look for values you did not intend, for example
   `legend.visibility: "hidden"` on a multi-series chart.

9. **List, export, or delete when requested.** Call `GET kbn:/api/dashboards` or `GET kbn:/api/visualizations` to
   discover existing objects. Call `DELETE kbn:/api/dashboards/{id}` or `DELETE kbn:/api/visualizations/{id}` to remove
   objects. For bulk export or import of saved objects, call `POST kbn:/api/saved_objects/_export` or
   `POST kbn:/api/saved_objects/_import`.

## Design essentials

The full rules live in the references; these are the ones most often missed. They apply to every dashboard and
visualization you write.

**Version-gated settings.** Everything else in this skill works on Kibana 9.4. These three need a newer Kibana; below
that version use the fallback instead of the setting.

| Setting                                                   | Needs | Fallback on older clusters                                                   |
| --------------------------------------------------------- | ----- | ---------------------------------------------------------------------------- |
| `options_list_control` with `values_source: "esql"`       | 9.5   | `data_view_id` and `field_name`; create a data view if none covers the index |
| `background_chart: { type: "trend" }` on an ES\|QL metric | 9.5   | Omit `background_chart`; the metric shows the value only                     |
| `styling: { areas: { fill: "gradient" } }`                | 9.6   | Omit `styling.areas`; areas render with a solid fill                         |

**Dashboard** ([Dashboard Design Guidelines](references/dashboard-design.md))

- Order panels summary metrics → trends → breakdowns. Let the fields drive the panel count; every panel needs a purpose.
- Non-empty `title` and a `description` on every new dashboard, derived from what the queries measure.
- Sections (`{ title, collapsed, grid: { y }, panels }` entries in `panels`) for roughly 6+ visualization panels, each
  holding only panels matching its purpose. 3–5 options-list controls in `pinned_panels` on new dashboards; on an
  all-ES|QL dashboard, source their values from an ES|QL query (`values_source: "esql"`, 9.5+) instead of a data view.
- 48-column grid, 20–24 rows above the fold, 8–12 panels in that band. Sizes by chart type:

  | Panel                     | `w`                                 | `h`   |
  | ------------------------- | ----------------------------------- | ----- |
  | Metric                    | 6, 8, or 12                         | 5–6   |
  | Gauge                     | 12                                  | 8     |
  | XY, heatmap, tag cloud    | 24 (48 for the primary time series) | 10    |
  | Treemap / waffle / mosaic | 24                                  | 10    |
  | Pie / donut               | 12                                  | 10    |
  | Markdown                  | 24–48                               | 4–9   |
  | Data table                | 24–48                               | 12–16 |

  Never make a metric or gauge full-width. Use `w` values that divide 48. Fill rows left to right; a new row's `y` is
  the previous row's `y + max(h)`; panels in a row share `h`; `x + w ≤ 48`. Kibana compacts panels upward, so blank rows
  do not survive — separate groups with sections. Section panels use section-relative coordinates and a section occupies
  one outer row.

**Charts** ([Chart Design Guidelines](references/chart-design.md))

- Pick the chart type from the selection list; tag clouds only for short strings, pies for fewer than about 7 slices.
- No panel title on metric, gauge, tag cloud, and waffle charts; elsewhere a self-explanatory title and no axis titles
  (`title: { visible: false }` on both axes). Never repeat information across title, axes, and labels.
- Natural units via `format`: percent, bytes, bits, duration whenever the column reveals one; plain counts unformatted.
- XY: set `legend: { position: "bottom", layout: { type: "list" }, visibility: "visible" }` on every chart with a
  `breakdown_by` or more than one `y` column, and `visibility: "hidden"` on single-series charts. Use
  `layout: { type: "grid" }` only when the legend carries statistics. The API defaults `visibility` to `hidden` and
  `layout` to `grid`; it does not count the series. Areas (gradient fill) only up to three series, lines above that.
  Line charts take the `elastic_line_optimized` palette on `breakdown_by.color`. Use `scale: "temporal"` for time axes,
  and legend statistics only when asked for avg/min/max "in the legend" (a presentation setting, not an ES|QL
  aggregation).
- Metric: trend background or secondary metric when the query supports it; color the value, never the background, and
  only for bounded metrics (percentages, error rates) with 3 status bands. Never set `apply_color_to` without `color`,
  and never combine a background chart with color: Lens then colors the background, not the value.
- Gauge: never invent `min`/`max`/`goal`; default to four equal percentage bands.
- Heatmap, pie, partition charts, xy series: default palettes unless the user asks. Tables color values as badges only.
- Color only where it carries meaning, always from the [Kibana Palette Catalog](references/color-palettes.md), never
  invented hex values or legacy palettes; the same category keeps one color across all charts.
- On edits, preserve explicit user choices and existing thresholds; defaults are preferences, not proof a setting is
  wrong.

## ES|QL patterns

**Time series bucket** (dashboard time picker injects `?_tstart` / `?_tend`):

```esql
FROM logs*
| WHERE @timestamp <= ?_tend AND @timestamp > ?_tstart
| STATS count = COUNT() BY BUCKET(@timestamp, 75, ?_tstart, ?_tend)
```

See [Chart Types Reference](references/chart-types-reference.md) for axis and layer details.

**Time series data stream (TSDS) xy chart.** `TS` queries accept the same `BUCKET` pattern, so the chart binds the time
axis the same way:

```esql
TS metrics-otel-default
| WHERE @timestamp <= ?_tend AND @timestamp > ?_tstart AND attributes.device != "lo"
| STATS `Throughput` = SUM(RATE(metrics.system.network.io)) BY BUCKET(@timestamp, 75, ?_tstart, ?_tend), attributes.direction
```

**Metric with trend background.** The API copies the query into a hidden trendline layer and adds its own time bucket.
On a `TS` source do not add `BUCKET` yourself and do not `KEEP` after `STATS`; on a `FROM` source keep the `?_tstart` /
`?_tend` filter, or no trendline is built. Derive values inside `STATS`:

```esql
TS metrics-otel-default
| WHERE attributes.state == "idle"
| STATS `CPU busy` = 1 - AVG(metrics.system.cpu.utilization)
```

**Static reference values** — use `EVAL` in the query, then reference the column:

```esql
FROM logs* | STATS count = COUNT() | EVAL goal = 15000
```

## Examples

Two complete dashboard bodies live under [assets/](assets/). Both use every version-gated setting, so they need Kibana
9.6 as written; on 9.5 drop `styling.areas`, and on 9.4 also replace the ES|QL-sourced controls and the trend background
with their fallbacks.

- `dashboard-esql.json` — an ES|QL dashboard over the Kibana sample web logs that follows the design guidance: three
  sections, formatted metrics with a trend background and status coloring, a primary time series with legend statistics,
  breakdown bars, a table, and options-list controls whose values come from ES|QL queries.
- `dashboard-data-view.json` — the same dashboard shape built on the sample logs data view with aggregation operations
  instead of ES|QL: sections, data-view controls, a primary time series with legend statistics, a heatmap, horizontal
  bars, and a ranked table with labeled and formatted columns.

Single-chart schema examples for every chart type are in [Chart Types Reference](references/chart-types-reference.md).

## Guidelines

1. **Minimal payloads, complete presentation** — omit derivable metadata and schema defaults, but always set the
   presentation settings the design guidance calls for (formats, hidden axis titles, legend position and visibility,
   gradient areas, metric coloring, gauge bands), subject to the version-gated table in
   [Design essentials](#design-essentials). The API does not add these for you.
2. **Read references before complex charts** — metric and xy schemas differ between data view and ES|QL; consult
   [Chart Types Reference](references/chart-types-reference.md) before generating partition or table charts.

## Common issues

| Error                                             | Likely cause                                                                        | Fix                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 404 on GET after PUT                              | Wrong id or space                                                                   | Confirm id and retry `GET kbn:/api/dashboards/{id}`                                                           |
| 400 validation                                    | ES\|QL column mismatch                                                              | Align `metrics[].column` / layer `column` with `STATS` aliases in the query                                   |
| ES\|QL panel saved as data view                   | Wrong dataset type                                                                  | Use `data_source.type: "esql"`, not `data_view_reference`                                                     |
| Empty dashboard missing time filter               | Omitted `time_range`                                                                | Include `{ "from": "now-7d", "to": "now" }` when a default range is required                                  |
| XY chart failure                                  | Missing layer `data_source`                                                         | Put `data_source` inside each layer, not only at the root                                                     |
| Metric value rendered green                       | `apply_color_to` without `color`                                                    | Omit both, or add a `color` config alongside `apply_color_to: "value"`                                        |
| Metric tile is a solid colored block              | `background_chart` combined with `color` steps                                      | Lens colors the background when a trend or bar is present; drop either the background chart or the color      |
| Metric panel: "expected at most one time tbucket" | Trend background on a `TS` query that groups by `BUCKET(@timestamp, ...)`           | Remove the `BUCKET`; the API appends `TBUCKET(75)` itself (an existing `TBUCKET` is kept)                     |
| Trend metric shows no trend line                  | `FROM` query without `?_tstart` / `?_tend`, or `TS` query with `KEEP` after `STATS` | Add the time filter, or drop the `KEEP`; see the Metric rules in Chart Design Guidelines                      |
| Multi-series xy chart shows no legend             | `legend.visibility` omitted, so the API set it to `hidden`                          | Set `legend: { position: "bottom", visibility: "visible" }` on charts with a breakdown or several `y` columns |
| 400 on color config                               | Categorical mapping on a numeric column, or `steps` on a keyword column             | Match the coloring mode to the column type; see Chart Design Guidelines                                       |
| 400 on `steps`                                    | Non-continuous ranges or missing `gte`/`lt`                                         | Every step except the first needs `gte`, every step except the last needs `lt`, the last uses `lte`           |
| 400 on `format.duration`                          | Unit name such as `milliseconds`                                                    | Use the short unit codes `ps`, `ns`, `us`, `ms`, `s`, `min`, `h`, `d`, `w`, `mo`, `y`; `to` accepts `auto`    |
| Control fails validation                          | Missing `data_view_id`                                                              | Look the data view up with `GET kbn:/api/data_views`, create one, or source the options from ES\|QL instead   |
| Panels overlap or leave gaps                      | Coordinates not recomputed                                                          | Reflow with the positioning rules in the Dashboard Design Guidelines                                          |

## Operations

As of CLI v0.4.0 the Dashboards and Visualizations APIs have dedicated `elastic kb dashboards` and
`elastic kb visualizations` command groups. `elastic kb` is shorthand for `elastic stack kb`. Write commands take the
JSON body from `--input-file '<path.json>'` or `--body '<json>'`. `upsert-*` takes the id on `--id` and creates or
replaces the object. `delete-*` requires `--yes`. Every command accepts `--dry-run`, which validates flags and JSON
syntax only. It does not validate the panel schema. To author several objects at once, build a saved-object NDJSON file
and import it with `post-saved-objects-import`. Read it back with `post-saved-objects-export`. If the CLI rejects a
command name from this table, run `elastic stack kb <group> --help` and use the listed name.

| HTTP API (shorthand)                                                                              | `elastic` CLI command                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET kbn:/api/status`                                                                             | `elastic kb system get-status`                                                                                                                                                                                                                               |
| `POST kbn:/api/saved_objects/_import`                                                             | `elastic kb saved-objects post-saved-objects-import --file '<path.ndjson>' --overwrite`                                                                                                                                                                      |
| `POST kbn:/api/saved_objects/_export`                                                             | `elastic kb saved-objects post-saved-objects-export --objects '[{"type":"<type>","id":"<id>"}]'` (returns a JSON array, not NDJSON)                                                                                                                          |
| `GET kbn:/api/dashboards`                                                                         | `elastic kb dashboards search-dashboards`                                                                                                                                                                                                                    |
| `GET kbn:/api/dashboards/{id}`                                                                    | `elastic kb dashboards get-dashboard --id '<id>'`                                                                                                                                                                                                            |
| `PUT kbn:/api/dashboards/{id}`                                                                    | `elastic kb dashboards upsert-dashboard --id '<id>' --input-file '<path.json>'`                                                                                                                                                                              |
| `POST kbn:/api/dashboards` (no id)                                                                | `elastic kb dashboards create-dashboard --input-file '<path.json>'`                                                                                                                                                                                          |
| `DELETE kbn:/api/dashboards/{id}`                                                                 | `elastic kb dashboards delete-dashboard --id '<id>' --yes`                                                                                                                                                                                                   |
| `GET kbn:/api/visualizations`                                                                     | `elastic kb visualizations search-visualizations`                                                                                                                                                                                                            |
| `GET kbn:/api/visualizations/{id}`                                                                | `elastic kb visualizations get-visualization --id '<id>'`                                                                                                                                                                                                    |
| `PUT kbn:/api/visualizations/{id}`                                                                | `elastic kb visualizations upsert-visualization --id '<id>' --input-file '<path.json>'`                                                                                                                                                                      |
| `POST kbn:/api/visualizations` (no id)                                                            | `elastic kb visualizations create-visualization --input-file '<path.json>'`                                                                                                                                                                                  |
| `DELETE kbn:/api/visualizations/{id}`                                                             | `elastic kb visualizations delete-visualization --id '<id>' --yes`                                                                                                                                                                                           |
| `GET kbn:/api/data_views`                                                                         | `elastic kb data-views get-all-data-views-default` (to find a `data_view_id` for controls)                                                                                                                                                                   |
| `POST kbn:/api/data_views/data_view`                                                              | `elastic kb data-views create-data-view-default --input-file '<path.json>'`                                                                                                                                                                                  |
| `GET /_cat/indices`, `GET /{index}/_mapping`, `GET /{index}/_settings/index.mode`, `POST /_query` | `elastic es cat indices --index '<pattern>'`, `elastic es indices get-mapping --index '<index>'`, `elastic es indices get-settings --index '<index>' --name index.mode`, `elastic es esql query --format tsv --query "<esql>" [--filter '<query dsl json>']` |
