# Chart Design Guidelines

What a good chart looks like, and how to express it in the visualization config JSON. These rules apply to every inline
`vis` panel `config` and every standalone visualization body. [Chart Types Reference](chart-types-reference.md)
documents the schema of each chart type; this document tells you which settings to choose. Palette names, ids, and hex
values are in the [Kibana Palette Catalog](color-palettes.md).

Every section has two parts: **Design** (the preference, stated without JSON) and **Config** (how to carry it out). Do
not invent a second design policy in the config: the config only implements the design.

## Choosing a chart type

Choose the type that best fits the user's intent and the nature of the data being visualized:

- `metric` — Displays a single numeric value, KPI, or aggregate statistic (count, sum, average) with an optional trend
  line. Choose for single numbers without ranges or targets.
- `gauge` — Displays a single metric within a range with optional min/max/goal bounds. Choose when showing progress
  toward a goal or performance against thresholds (for example "CPU usage as a gauge", "sales target progress").
- `xy` — Line, bar, or area charts with X and Y axes. Choose for time series, trends, comparisons across series, or
  distributions/histograms (for example "request count over time", "average CPU over time", "sales by region as a bar
  chart"). Avg/min/max _in the legend_ is still xy, not a combination chart.
- `heatmap` — Colors a two-dimensional grid of x/y buckets by metric magnitude. Choose when both axes are buckets
  (categorical or time) and color should convey density or intensity (for example "errors by service and status code",
  "requests by hour of day and day of week").
- `tag_cloud` — Displays terms sized by frequency or value. Choose only when the terms are short strings (tags, status
  codes, country codes, browsers). Do not use for long text such as error messages, URLs, or log lines — use a table
  instead.
- `region_map` — Choropleth map coloring geographic boundaries (country, state, county) by a metric. Choose when the
  data has region identifiers that join to map boundaries and a map view is expected (for example "revenue by state on a
  map").
- `data_table` — Structured table with sortable columns. Choose when precise values, sortable columns, or
  multi-dimensional breakdowns matter more than visual patterns (for example "list top 20 hosts by CPU usage").
- `pie` — Pie or donut showing part-to-whole proportions as slices. Choose for percentage breakdowns with a limited
  number of categories, ideally fewer than 7 (for example "traffic distribution by browser as a donut").
- `treemap` — Nested rectangles where area encodes magnitude. Choose for size comparisons across many categories or
  hierarchical breakdowns (for example "disk usage by folder", "log volume by service and host").
- `waffle` — Grid of small squares where the filled share encodes a proportion. Choose for intuitive single-percentage
  displays that read easier than pie charts (for example "percentage of requests that are errors").
- `mosaic` — Tiled rectangles where area and position encode the joint distribution of two categorical dimensions.
  Choose for cross-tabulations (for example "request methods by status code", "error distribution across services and
  environments").

When a request fits none of these, pick the closest supported type and explain the substitution.

## General rules (all chart types)

### Design

- **Titles:** omit the panel title when the chart already displays the information within itself (metric, gauge, tag
  cloud, and waffle charts show their value and label directly). When a title is needed, make it self-explanatory and
  exhaustive so axis titles become unnecessary. Never duplicate information across the title, axis titles, and metric
  labels.
- **Units:** show values in their natural unit whenever the data has a well-known one — percentages for utilization and
  rates, bytes for storage, memory, and network volume, bits for network throughput, human-readable durations for
  latency and response times. Column names and the request often reveal the unit (for example "cpu", "percent",
  "bytes_in", "disk_used", "latency_ms"); apply it even when nobody asked. Plain counts, rates without a known scale,
  and ambiguous units stay unformatted.
- **Defaults are preferences, not proof that an existing setting is wrong.** A gauge goal, a threshold, or an unusual
  color may be intentional; preserve explicit user choices and meaningful existing settings when editing.

### Config

- **Titles:** omit the `title` field (or set it to `""`) to show no title. For ES|QL metrics, alias the column in the
  query so the metric label is readable (for example ``STATS `Total Requests` = COUNT()``).
- **Number formats** — set `format` on the bound column (`metrics[]`, `y[]`, gauge `metric`, table columns):

  | Data                            | Format                                                                           |
  | ------------------------------- | -------------------------------------------------------------------------------- |
  | CPU / utilization percentages   | `{ "type": "percent", "decimals": 1, "compact": true }` (expects a 0–1 fraction) |
  | Whole-number percentages        | `{ "type": "number", "decimals": 1, "suffix": "%" }` (value already 0–100)       |
  | Bytes                           | `{ "type": "bytes", "decimals": 1 }`                                             |
  | Bits                            | `{ "type": "bits", "decimals": 1 }`                                              |
  | Durations                       | `{ "type": "duration", "from": "<source unit>", "to": "auto" }`                  |
  | Large plain numbers (if needed) | `{ "type": "number", "decimals": 0, "compact": true }`                           |

  The duration `from` unit must match how the field is stored: one of `ps`, `ns`, `us`, `ms`, `s`, `min`, `h`, `d`, `w`,
  `mo`, `y` (for example `"ms"` for `latency_ms`). `to` is `auto`, `auto-approximate`, or one of `ms`, `s`, `min`, `h`,
  `d`, `w`, `mo`, `y` (no sub-millisecond targets). Do NOT apply a format to plain counts or ambiguous units.

## Series statistics versus measures

Two different "average" requests — do not mix them:

- **Measure over time:** "average `<field>` over time" (for example average CPU). The query averages that field with
  `AVG(<field>)` in a single `STATS ... BY <time bucket>`, and the chart binds that column. That is not legend
  statistics.
- **Legend statistics:** "log volume over time, show avg/min/max" or "trend with avg, min, max" when no source field is
  being averaged. Those words are presentation: query only the measure over time (for example the count per bucket), do
  **not** add `AVG`/`MIN`/`MAX` columns or a second `STATS` that collapses the buckets, and instead set
  `legend.statistics` on the xy chart with `legend.visibility: "visible"`.

Supported `legend.statistics` values: `min`, `max`, `avg`, `median`, `range`, `last_value`, `last_non_null_value`,
`first_value`, `first_non_null_value`, `difference`, `difference_percentage`, `count`, `total`, `standard_deviation`,
`variance`, `distinct_count`, `current_and_last_value`. Never invent statistic columns the query does not emit.

```json
"legend": { "position": "bottom", "layout": { "type": "grid" }, "visibility": "visible", "statistics": ["avg", "min", "max"] }
```

## Metric

### Design

- No panel title: the primary metric label already names the panel.
- A single number is fine. When the query results support it and the value benefits from context, add a trend background
  or a secondary metric instead of leaving a lone number on white.
- Show a progress bar only when the value has a meaningful maximum.
- A secondary trend or delta needs no label; label a secondary metric only when it is a distinct named measure.
- Color the value, not the background, and only when it carries meaning. Clearly bounded metrics (percent, ratio,
  CPU/memory/disk utilization, error rate, success rate, SLO compliance) benefit from status bands in the same scale as
  the value; for adverse metrics such as error rate, higher is worse. Unbounded values (raw counts, bytes, durations,
  throughput, rates with unknown scale) stay uncolored.
- A metric is either colored or has a background chart, not both. When a trend or progress bar background is present,
  Lens applies the color to the background instead of the value, so status bands turn the whole tile into a colored
  block. For a bounded metric, prefer the colored value and skip the trend; for an unbounded metric, use the trend and
  no color.

### Config

- Trend backgrounds (`background_chart: { "type": "trend" }` on the primary metric) and secondary metrics (a second
  `metrics[]` entry with `"type": "secondary"`) must bind columns the same ES|QL query returns. Never invent another
  index or field.
- **Trend backgrounds on ES|QL metrics (Kibana 9.5+).** On 9.4 the setting is accepted but no trendline layer is
  generated for ES|QL sources, so omit `background_chart` there. From 9.5 the API builds a hidden `*_trendline` layer by
  copying the query and adding a time bucket to the `STATS ... BY` clause. It needs to know the time field, which it
  reads from the column compared to `?_tstart` / `?_tend` in the query, or assumes `@timestamp` for a `TS` source. Rules
  that follow from this:
  - `FROM` queries must filter on the time field with `?_tstart` / `?_tend`, otherwise no trendline layer is created and
    the metric silently renders without a trend. The API appends `BUCKET(<time field>, 75, ?_tstart, ?_tend)`, or keeps
    an existing `BUCKET(<time field>, ...)` in the `BY` clause, and adds the bucket column to any later `KEEP`.
  - `TS` queries get `TBUCKET(75)` appended to the first `STATS` after `TS`, unless that `STATS` already groups by
    `TBUCKET(...)`, which is kept. A `BUCKET(@timestamp, ...)` is not recognized on a `TS` source, so it ends up next to
    the appended `TBUCKET` and Elasticsearch rejects the query with "expected at most one time tbucket". The API does
    not add the bucket column to a later `KEEP` on `TS` queries, so a `KEEP` after `STATS` drops it and the trend is
    empty.
  - Simplest shape for both sources: `source | WHERE <time filter> ... | STATS <alias> = <agg>` with derived values
    computed inside `STATS`, for example ``STATS `CPU busy` = 1 - AVG(cpu.idle)``, and no `KEEP` afterwards.
- Progress bar: `background_chart: { "type": "bar", "max_value": "<column>" }` on the primary metric, only for
  meaningful progress-to-max.
- For trend/delta secondary metrics, hide the label with `styling.secondary.label.visible: false` and omit `label`.
- Coloring: set `"apply_color_to": "value"` only together with a `color` config; do not color the background unless the
  user asks. When not coloring, omit both `color` and `apply_color_to` — `apply_color_to` without a color makes Lens
  tint the value with a default green.
- Never combine `background_chart` (`trend` or `bar`) with `color` steps or `apply_color_to`. Lens ignores
  `apply_color_to: "value"` when a background chart is present and colors the background instead. Pick one per metric.
- Bounded metrics: explicit 3-band `steps` with thresholds in the same unit and scale as the metric output (percent
  thresholds for percent values, fractions for 0–1 values). Prefer "Status", "Negative", "Positive", or "Temperature"
  when thresholds have semantic meaning; use a status/adverse palette for adverse metrics. Copy the 3-stop preview of
  the chosen palette from the catalog.
- Unbounded values: `color: { "type": "auto" }` or no color.

```json
{
  "type": "metric",
  "data_source": {
    "type": "esql",
    "query": "FROM metrics* | STATS `Error rate` = 100.0 * COUNT(CASE(status >= 500, 1, null)) / COUNT()"
  },
  "metrics": [
    {
      "type": "primary",
      "column": "Error rate",
      "format": { "type": "number", "decimals": 1, "suffix": "%" },
      "apply_color_to": "value",
      "color": {
        "type": "dynamic",
        "range": "absolute",
        "steps": [
          { "gte": 0, "lt": 1, "color": "#24c292" },
          { "gte": 1, "lt": 5, "color": "#fcd883" },
          { "gte": 5, "lte": 100, "color": "#f6726a" }
        ]
      }
    }
  ]
}
```

## Gauge

### Design

- Gauge bounds and goals describe business targets. Never invent, infer, or backfill minimum, maximum, or goal values
  from the data or from units like bytes, requests, or rates; set them only when the user provides them, and keep
  existing ones on edits.
- For new gauges, prefer four equal percentage color bands unless the user specifies different bands. When improving an
  existing dashboard, apply the four equal percentage bands unless the existing bands reflect explicit user thresholds
  or meaningful business ranges. A focused color or palette edit keeps the existing band count, thresholds, and
  percentage or absolute scale.

### Config

- Omit `min`, `max`, and `goal` unless the user supplied them or the existing configuration already has them.
- Default bands: `color: { "type": "dynamic", "range": "percentage", "steps": [...] }` with 4 bands `0 <= value < 25`,
  `25 <= value < 50`, `50 <= value < 75`, `75 <= value <= 100`, colors copied from the 4-stop preview of the chosen
  palette. A palette-only edit changes only step colors: preserve the existing number of steps, threshold boundaries,
  and `range`. Change existing bands only when the instruction requests it; explicit user thresholds take precedence
  over defaults.

```json
"metric": {
  "column": "cpu_pct",
  "format": { "type": "percent", "decimals": 1, "compact": true },
  "color": {
    "type": "dynamic",
    "range": "percentage",
    "steps": [
      { "gte": 0, "lt": 25, "color": "#24c292" },
      { "gte": 25, "lt": 50, "color": "#aee8d2" },
      { "gte": 50, "lt": 75, "color": "#ffc9c2" },
      { "gte": 75, "lte": 100, "color": "#f6726a" }
    ]
  }
}
```

## XY (line, area, bar)

### Design

- No axis titles: the panel title and column labels already convey meaning.
- Area series use a gradient fill, never a solid fill.
- Use areas only for one to three series. With more series, stacked or overlapping fills hide each other; use a line
  chart instead.
- Place the legend outside the plot, at the bottom. Lay it out as a list, except when it carries legend statistics,
  where a grid keeps the numbers aligned in columns. Hide it when it only repeats what is visible (a single series);
  show it when there are several series or when it carries legend statistics.
- Line charts use the "Elastic line optimized" palette, whose colors stay distinguishable as thin strokes. Other chart
  types keep the default palette. Add explicit per-series colors only when the user asks or when the same category must
  keep one color across charts.

### Config

- For horizontal bars, use `type: "bar_horizontal"` with `x` = category column and `y` = metric column. Example: "top OS
  by count as horizontal bar" → `type: "bar_horizontal", x: { column: "OS" }, y: [{ column: "Count" }]`. Do NOT put the
  metric on `x`.
- Hide axis titles with `title: { "visible": false }` on both the x and y axes; do not set axis title text.
- Area series: `styling: { "areas": { "fill": "gradient" } }` (Kibana 9.6+; omit `styling.areas` on older clusters,
  which render a solid fill).
- Legend: `legend: { "position": "bottom", "layout": { "type": "list" } }` with the default outside placement; do not
  set `placement`. Use `"layout": { "type": "grid" }` only when `legend.statistics` is set. The API defaults `layout` to
  `grid`, so set it explicitly on every xy chart. Always set `legend.visibility` explicitly. Use `"visible"` when the
  layer has a `breakdown_by` or more than one `y` column, and always when legend statistics are set. Use `"hidden"` for
  a single series whose name is already in the panel title or on the axis. The API fills an omitted `visibility` with
  `"hidden"`. It does not detect the series count the way the Lens editor does.
- Legend statistics: see [Series statistics versus measures](#series-statistics-versus-measures).
- Time series: always `"scale": "temporal"` on the x axis (see [Chart Types Reference](chart-types-reference.md)).
- Series count: `area` and `area_stacked` layers only when the query yields at most three series (one `y` column times
  the breakdown cardinality). Above that, use `line`.
- Line palette: on `line` layers with a `breakdown_by`, set
  `breakdown_by.color: { "mode": "categorical", "palette": "elastic_line_optimized", "mapping": [] }`. On `line` layers
  with several `y` columns and no breakdown, `y[].color` accepts only a static color, so give each column
  `color: { "type": "static", "color": "<hex>" }` with consecutive hex values from the `elastic_line_optimized` preview
  in the palette catalog. Bar and area layers keep the default palette.
- Other coloring: omit explicit `color` properties unless colors were requested; Lens applies its default palettes.
  Never introduce or switch to legacy palette ids (`eui_amsterdam`, `kibana_v7_legacy`, `elastic_brand_2023`).

```json
{
  "type": "xy",
  "title": "Log volume over time",
  "axis": {
    "x": { "scale": "temporal", "domain": { "type": "fit", "rounding": false }, "title": { "visible": false } },
    "y": { "title": { "visible": false } }
  },
  "legend": {
    "position": "bottom",
    "layout": { "type": "grid" },
    "visibility": "visible",
    "statistics": ["avg", "min", "max"]
  },
  "styling": { "areas": { "fill": "gradient" } },
  "layers": [
    {
      "type": "area",
      "data_source": {
        "type": "esql",
        "query": "FROM logs* | WHERE @timestamp <= ?_tend AND @timestamp > ?_tstart | STATS count = COUNT() BY BUCKET(@timestamp, 75, ?_tstart, ?_tend)"
      },
      "x": { "column": "BUCKET(@timestamp, 75, ?_tstart, ?_tend)", "label": "@timestamp" },
      "y": [{ "column": "count", "label": "Logs" }]
    }
  ]
}
```

## Heatmap

### Design

- Keep the default "Temperature" palette that Lens binds to the data; use a custom palette or thresholds only when the
  user asks.

### Config

- Omit `metric.color` or use `color: { "type": "auto" }`; generate explicit `steps` (5 bands, colors from the 5-stop
  preview) only when the user requests a custom palette or gives thresholds.

## Tag cloud

- Only for short strings (tags, status codes, country codes, browsers); never for long text. No panel title — the terms
  are the content.
- No coloring rules beyond the general [Color](#color) guidance.

## Region map

- Choose only when the data has region identifiers that join to map boundaries. No coloring rules beyond the general
  [Color](#color) guidance.

## Data table

### Design

- Color table values as badges, and only where color adds meaning (status, severity, magnitude). Do not color cell
  backgrounds or text unless the user asks.

### Config

Column color settings go on the column entry in `metrics[]` or `rows[]`:

- Prefer `"apply_color_to": "badge"`; avoid cell background or text coloring unless the user asks.
- Numeric columns: when coloring is useful, use `"apply_color_to": "badge"` with `color: { "type": "auto" }` so Lens
  computes stops from table data. Generate explicit 5-band `steps` only when the user asks for a palette or thresholds.
- Categorical (keyword/text) columns: when coloring is useful, use
  `color: { "mode": "categorical", "palette": "<palette id>", "mapping": [] }` so Lens assigns colors to actual values.
- NEVER apply categorical mapping to a numeric column or dynamic palette steps to a keyword column.

```json
"metrics": [{ "column": "error_rate", "format": { "type": "number", "decimals": 1, "suffix": "%" }, "apply_color_to": "badge", "color": { "type": "auto" } }],
"rows": [{ "column": "service", "apply_color_to": "badge", "color": { "mode": "categorical", "palette": "default", "mapping": [] } }]
```

## Pie and donut

### Design

- Use the default palette; per-slice or custom colors only when the user asks.
- Keep the category count small (ideally fewer than 7); above that, prefer a bar chart or table.

### Config

- Omit explicit `color` properties; Lens applies its default palette. Add colors only when the user explicitly requests
  them.
- Donuts: `"styling": { "donut_hole": "m" }` on a `pie`.

## Treemap, waffle, mosaic

- Follow the general [Color](#color) guidance: let Lens apply its default palette and add explicit colors only when the
  user asks or when a category must keep one color across charts.

## Color

### Design

- Add color only when it adds meaning: status colors for meaningful thresholds, intensity colors for magnitude, and one
  consistent color for the same category wherever it appears across charts. Neutral data with no useful color meaning
  stays uncolored.
- Choose palettes from the [Kibana palette catalog](color-palettes.md), never invented colors or legacy palettes:
  "Status" for threshold bands, "Temperature" for intensity, "Complementary" for divergence, "Negative"/"Positive" for
  adverse/favorable values, "Cool"/"Warm"/"Gray" for neutral magnitude, and a categorical palette for distinct
  categories: `elastic_line_optimized` on line charts, `default` elsewhere, `severity` when categories are severities.
- Thresholds are data values in the metric's own unit and scale. When only the colors change, keep the existing
  thresholds.
- Respect explicit user choices and meaningful existing color assignments. An off-palette color is not automatically
  wrong; do not assume an existing color was invented just because its history is unknown.
- Cross-chart consistency is your job: when a category (a service, a status code) appears in several panels, give it the
  same color in every panel's config.

### Config

#### Default policy

- Prefer Lens defaults for unknown-scale data: use `color: { "type": "auto" }` or omit `color` when Lens can calculate
  better thresholds at render time.
- Generate explicit numeric `steps` only when the chart-specific rules above allow it (metric bounded values, gauge
  bands) or when the user asks for a custom palette or exact thresholds.
- The chart-specific coloring rules above override this policy where they differ.

#### Coloring mode — choose by column type

- Numeric columns → `color: { "type": "auto" }` by default;
  `color: { "type": "dynamic", "range": "absolute" | "percentage", "steps": [...] }` only when explicit steps are
  allowed.
- Keyword / text columns → `color: { "mode": "categorical", "palette": "<palette id>", "mapping": [] }`.
- NEVER apply categorical mapping to a numeric column or dynamic palette steps to a keyword column.
- NEVER use the deprecated `type: "legacy_dynamic"`.

#### Dynamic steps — mechanics for when the rules call for explicit `steps`

- Pick exactly ONE gradient palette, following the design guidance on which palette fits which meaning.
- Use the step count the chart type calls for: 3 for metrics, 4 for gauges, 5 for heatmaps and tables. For a recolor of
  an existing chart, keep its current step count and copy the preview with that many stops.
- Every `steps[*].color` hex MUST come from the selected palette's preview line for that step count, exactly as written.
- Each step is `{ "gte": <lower, inclusive>, "lt": <upper, exclusive>, "color": "#hex" }`; the last step uses `lte`
  instead of `lt`. Steps must be continuous, and every step except the first needs `gte`.
- Step thresholds are data values, not display labels; keep them in the same unit and scale as the metric column. For
  rates, do not assume per-second thresholds unless the ES|QL query computes per-second values.
- Keep palette order by default; to reverse, reverse the `steps` colors yourself. There is no `reverse` field.

#### Categorical mapping — pick a palette by id

- Set `color: { "mode": "categorical", "palette": "<palette id>", "mapping": [] }` and let Lens auto-assign a distinct
  color per distinct value at render time.
- The `palette` value MUST be one of the categorical palette ids in the catalog, verbatim (`default`,
  `elastic_line_optimized`, `severity`).
- Leave `mapping: []` by default. Only define explicit `mapping[]` entries when the user names specific values to color,
  or when a category must keep one color across charts.
- When you do map explicit values, each entry is
  `{ "values": ["<value>"], "color": { "type": "color_code", "value": "#hex" } }`, drawing the hex from one of the
  catalog palettes.
