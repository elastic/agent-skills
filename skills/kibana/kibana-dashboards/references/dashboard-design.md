# Dashboard Design Guidelines

How to compose, structure, and lay out a dashboard so it reads well. These rules apply to every dashboard you create or
update through `PUT kbn:/api/dashboards/{id}`. Chart-level rules (chart type choice, titles, units, legends, colors)
live in [Chart Design Guidelines](chart-design.md).

## Composition

A well-composed dashboard orders panels as **summary metrics → trends → breakdowns and distributions**:

1. **Consider a markdown panel when it adds value** — to set context about what the dashboard monitors, data sources, or
   important notes. Not every dashboard needs one. Never use a markdown panel as a dashboard title.
2. **Lead with high-level metrics** (metric or gauge panels): total counts, averages, key performance indicators that
   give an at-a-glance summary.
3. **Follow with time-series trends** (xy line/area panels): how the key metrics change over time.
4. **Follow with breakdowns and distributions** (xy bar, heatmap, tag cloud, partition charts, or ranking tables): top-N
   rankings, categorical splits, and density views. A table of top countries belongs here, not with summary metrics.
5. **Include as many panels as are valuable for the underlying data and user intent.** Let the richness and diversity of
   the available fields drive the panel count instead of a fixed numeric target.
6. **Every panel should serve a clear purpose.** Do not add panels just to fill space, but do not artificially limit the
   dashboard when more panels would provide genuine insight.

When the user's request is vague (for example "create a dashboard for my logs"), inspect the index mapping thoroughly
(`GET /{index}/_mapping`) and compose a rich dashboard that covers the breadth of the available data — overview metrics,
time-series trends, breakdowns, and distributions. Let the fields drive the panel count rather than defaulting to a
minimal set.

### Primary time series

Before writing panels, pick one or two **primary time-series xy charts** — the overview trend that matches the dashboard
title or intent. On a new dashboard, give at least one and at most two of them legend statistics (avg/min/max shown in
the legend). Skip this for categorical bar charts and for charts whose measure is already an `AVG`/`MIN`/`MAX` of a
field. See [Series statistics](chart-design.md#series-statistics-versus-measures) for how to express it.

## Titles and descriptions

- Every dashboard MUST have a non-empty `title`. For a new dashboard also set `description`. If an existing dashboard's
  title is empty or a placeholder such as `"User Dashboard"`, invent a title from its contents.
- Derive the dashboard title, description, section titles, panel titles, and markdown text from what the queries
  actually measure and the indices they read — not from the existing dashboard name or an assumed domain. Rename
  anything misleading.
- Panel titles must be self-explanatory and exhaustive so axis titles become unnecessary. Never duplicate information
  across the panel title, axis titles, and metric labels. Charts that display their information within themselves
  (metric, gauge, tag cloud, waffle) get no panel title at all.

## Sections

Sections are collapsible groups of panels. In the API a section is an entry of the top-level `panels` array with a
`title`, `collapsed`, a `grid` holding only `y`, and its own nested `panels`. Each section's panels start again at
`y: 0`, and the next section's outer `y` is the previous one plus 1:

```json
"panels": [
  {
    "title": "Key metrics",
    "collapsed": false,
    "grid": { "y": 0 },
    "panels": [
      {
        "type": "vis",
        "id": "total-requests",
        "grid": { "x": 0, "y": 0, "w": 12, "h": 5 },
        "config": {
          "type": "metric",
          "data_source": { "type": "esql", "query": "FROM logs* | STATS `Total requests` = COUNT()" },
          "metrics": [{ "type": "primary", "column": "Total requests" }]
        }
      }
    ]
  },
  {
    "title": "Trends",
    "collapsed": false,
    "grid": { "y": 1 },
    "panels": [
      { "type": "vis", "id": "requests-over-time", "grid": { "x": 0, "y": 0, "w": 48, "h": 10 }, "config": { "type": "xy", "...": "..." } }
    ]
  }
]
```

A complete dashboard built this way, with three sections, ES|QL panels, and ES|QL-sourced controls, is in
[assets/dashboard-esql.json](../assets/dashboard-esql.json), with a data-view counterpart in
[assets/dashboard-data-view.json](../assets/dashboard-data-view.json).

### When to use sections

- Keep small dashboards flat when a single sequence of panels is easy to scan.
- Use sections to separate summary metrics, trends, and breakdowns in that order. Each section must contain only panels
  matching its purpose: a "Key metrics" section contains summary metric/gauge panels, not time-series charts or ranking
  tables.
- Use per-domain sections when they make the dashboard clearer; keep summary metrics → trends → breakdowns ordered
  within each domain.
- Prefer sections for larger dashboards, especially when there are roughly 6 or more visualization panels or when the
  layout would otherwise feel long and hard to navigate.
- Do not add sections only for decoration. Use them when they make the dashboard structure clearer.
- Leave `collapsed: false` unless the user asks for collapsed sections; collapsed panels are not rendered until
  expanded.

## Controls

Controls are interactive filters pinned above the dashboard that let users explore data without editing queries. They
live in the root `pinned_panels` array of the dashboard body:

```json
"pinned_panels": [
  {
    "type": "options_list_control",
    "width": "medium",
    "grow": true,
    "config": {
      "title": "Service",
      "data_view_id": "<data view id>",
      "field_name": "service.name"
    }
  }
]
```

**When building a new dashboard from scratch**, proactively add 3–5 dropdown controls for the most useful categorical
fields. Pick fields that appear in panel `BY` / `WHERE` clauses and prefer low-cardinality keyword fields (for example
`service.name`, `host.name`, `env`, `region`, `kubernetes.namespace`, `http.response.status_code`). Avoid
high-cardinality identifiers (trace IDs, request IDs, UUIDs).

Do not add controls to dashboards already scoped to a single entity (one host, one service, and so on).

**Control types:**

- `options_list_control` — dropdown for categorical / keyword fields. The most common type (95% of cases).
- `range_slider_control` — numeric range slider. Add sparingly, only when filtering by a numeric threshold is useful
  across multiple panels (for example `latency`, `bytes`, `duration`).
- `time_slider_control` — global time sub-range picker. Add at most one per dashboard, only when time-range narrowing
  within the global window is useful. Its `config` can be `{}`.

**Where the options come from.** An `options_list_control` lists its values from a data view field or from an ES|QL
query:

- Data view: `config.data_view_id` and `config.field_name`. Look the data view up with `GET kbn:/api/data_views`; if
  none covers the index, create one with `POST kbn:/api/data_views/data_view` and a body such as
  `{ "data_view": { "title": "logs-*", "timeFieldName": "@timestamp" } }`.
- ES|QL (Kibana 9.5+): `config.values_source: "esql"` and `config.esql_query`. No data view is needed. End the query
  with `STATS BY <field>` so it returns one column of distinct values, and use the same field name the panel queries
  filter on. On 9.4 use the data view form above.

On a dashboard whose panels are all ES|QL, prefer the ES|QL source so the dashboard does not depend on a data view that
may not exist.

```json
"pinned_panels": [
  {
    "type": "options_list_control",
    "width": "medium",
    "grow": true,
    "config": {
      "title": "Host",
      "values_source": "esql",
      "esql_query": "FROM metrics-* | STATS BY host.name",
      "selected_options": []
    }
  }
]
```

**Required fields per control:**

- `type`: one of the three above.
- `options_list_control`: `config.data_view_id` and `config.field_name`, or `config.values_source: "esql"` and
  `config.esql_query`.
- `range_slider_control`: `config.data_view_id` and `config.field_name`.
- `config.title` (optional, `options_list_control` and `range_slider_control` only): human-readable label shown above
  the control (for example `"Service"`).

**Defaults:** `width: "medium"`, `grow: true` (fills available horizontal space). Override only if the user asks.

**Removing controls:** drop the entry from `pinned_panels` and `PUT` the full body back.

## Panel layout

The dashboard uses a **48-column grid**. On a 16:9 screen, roughly **20–24 rows** are visible without scrolling. Aim for
**8–12 panels above the fold**.

Every panel requires `grid: { x, y, w, h }`. The origin `(0, 0)` is the top-left corner.

### Grid sizes by chart type

Use these sizes — **do not make metric or gauge panels full-width**:

| Panel                     | Width `w`   | Height `h` | Notes                                                                  |
| ------------------------- | ----------- | ---------- | ---------------------------------------------------------------------- |
| Metric                    | 6, 8, or 12 | 5–6        | Single-number panels — keep them **small**. Fit 4–8 per row.           |
| Gauge                     | 12          | 8          | Up to 4 per row.                                                       |
| XY (line / area / bar)    | 24          | 10         | Use full-width (`w: 48`) only for the primary time series.             |
| Heatmap                   | 24          | 10         | Needs height for the color matrix.                                     |
| Tag cloud                 | 24          | 10         |                                                                        |
| Pie / donut               | 12          | 10         |                                                                        |
| Treemap / waffle / mosaic | 24          | 10         |                                                                        |
| Markdown                  | 24–48       | 4–9        | Size based on content length and layout needs — not always full-width. |
| Data table                | 24–48       | 12–16      | Prefer full-width so columns are readable.                             |

Metric rows: 8 metrics → each `w: 6, h: 5`; 6 metrics → each `w: 8, h: 5`; 4 metrics → each `w: 12, h: 5`.

Prefer `w` values that divide 48 evenly: **6, 8, 12, 24, 48**.

### Grid packing rules

- **Automatic upward movement:** Kibana moves each panel upward at its current `x` until another panel or the top of its
  grid blocks it. A larger `y` does not preserve empty space above a panel or guarantee row alignment. Use sections, not
  blank rows, to separate semantic groups.
- **Eliminate dead space:** Always calculate the bottom edge (`y + h`) of every panel. When starting a new row or
  placing panels below a row, set the new row's `y` to **previous row's `y + max(h)`** across all panels in that row —
  do not use only one neighbor's `y + h`.
- **Align row heights:** If multiple panels are placed side-by-side in a row (sharing the same `y`), they should have
  the exact same height (`h`). If they do not, you must fill the resulting empty vertical space before placing the next
  full-width panel.

### Positioning rules

Always set `x` and `y` so panels tile with **no gaps**:

1. **Fill rows left to right.** Start at `x: 0`. The next panel's `x` = previous panel's `x + w`. When a panel would
   exceed column 48, start a new row.
2. **New row `y`** = previous row's `y + max(h)` of all panels in that row.
3. **Same `h` per row** when possible, so rows align cleanly.
4. Panels' `x + w` must never exceed 48.
5. **When updating a dashboard**, inspect the existing panels' `grid` from the `GET` response. If there is empty space
   (a gap where a panel was removed, or unused columns beside a tall panel), place the new panel in that gap instead of
   appending below. Choose `w` and `h` to fit the available space.
6. **Markdown panels** use an explicit `grid` like any other panel. Size based on content length (`w: 24–48, h: 4–9`)
   and account for their height when positioning subsequent panels.

### Reflow after layout changes

- After resizing, moving, or removing panels, choose final sizes first, then recalculate positions across the affected
  layout, including panels whose sizes did not change. Pack rows using the rules above; do not keep old coordinates that
  leave gaps. Reflow each section separately.
- Update existing panels in place (keep their `id`). Before sending the `PUT`, check the planned coordinates for
  avoidable gaps, overlaps, and grid bounds.

### Section grid rules

- Each section has its own coordinate space. Panels nested under a section's `panels` are section-relative: each section
  starts at `y: 0`. The same 48-column grid and sizing guidance apply within each section.
- A section occupies exactly one row in the outer dashboard grid. When placing anything after a section, the next outer
  `y` is `section.grid.y + 1` (not the sum of the internal panel heights).
- Internal panel heights affect layout inside the section only; they do not increase the section's outer-grid height.
- When mixing top-level panels and sections, compute outer `y` sequentially: top-level panels advance by `y + h`,
  sections advance by `y + 1`.
- Top-level panels and sections share the same outer grid. A top-level panel placed at the same `y` as a section
  collides with it and is pushed **below** the section. Because `PUT` replaces the whole `panels` array, insert a panel
  above a section by renumbering the outer `y` of the section and everything after it in the body you send.

### Example: 4 KPI metrics + 2 time-series charts + 1 breakdown bar chart

```text
metric  (x:0,  y:0,  w:12, h:5)
metric  (x:12, y:0,  w:12, h:5)
metric  (x:24, y:0,  w:12, h:5)
metric  (x:36, y:0,  w:12, h:5)
xy-line (x:0,  y:5,  w:24, h:10)
xy-line (x:24, y:5,  w:24, h:10)
xy-bar  (x:0,  y:15, w:48, h:10)
```

### Example: the same dashboard with sections

```text
section "Key metrics"   (outer y:0)
  metric  (x:0,  y:0, w:12, h:5) … metric (x:36, y:0, w:12, h:5)
section "Trends"        (outer y:1)
  xy-line (x:0,  y:0, w:24, h:10)   xy-line (x:24, y:0, w:24, h:10)
section "Breakdowns"    (outer y:2)
  xy-bar  (x:0,  y:0, w:48, h:10)
```
