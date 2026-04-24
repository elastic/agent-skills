# Vega-Lite Reference for Kibana

Complete reference for creating data visualizations using Vega-Lite in Kibana. This guide follows best practices from
the [UW Interactive Data Lab Visualization Curriculum](https://idl.uw.edu/visualization-curriculum/intro.html).

## Philosophy

At its core, a visualization maps data to visual properties. Vega-Lite embodies a **grammar of graphics**: you describe
_what_ you want to visualize, not _how_ to draw it. This enables:

- Concise specifications
- Automatic inference of scales, axes, legends
- Composable multi-view displays
- Reproducible visualizations

---

## Critical Pitfalls (Read First!)

> ⚠️ **These issues cause silent failures. Your chart will render but show wrong/missing data.**

### 1. Dot-Notation Field Names

**Problem:** Field names containing dots (e.g., `room.name`, `host.ip`, `metric.value`) are interpreted as nested object
paths.

```json
// Data from ES|QL: {"room.name": "Kitchen", "temp": 21}
// Vega-Lite looks for: {room: {name: "Kitchen"}}
// Result: "undefined" in labels, collapsed bars, broken legends
```

**Solution:** Use ES|QL `RENAME` to create simple field names:

```esql
FROM logs-*
| STATS count=COUNT() BY service.name
| RENAME service.name AS service
```

### 2. Don't Set Width/Height - Use Autosize

**Problem:** Kibana controls the panel size. Explicit dimensions cause conflicts.

```hjson
// ❌ BAD - conflicts with Kibana panel sizing
{
  width: 600
  height: 300
  // ...
}

// ✅ GOOD - let Kibana control size
{
  autosize: {
    type: fit
    contains: padding
  }
  // ...
}
```

### 3. Horizontal Bar Chart Label Truncation

Y-axis labels get cut off on horizontal bar charts. Always set `labelLimit`:

```json
"y": {"field": "category", "axis": {"labelLimit": 200}}
```

### 4. Legends vs Direct Labels

Legends force the reader's eye to jump back and forth. Label lines directly when possible:

```json
{
  "layer": [
    { "mark": "line" },
    {
      "mark": { "type": "text", "align": "left", "dx": 5 },
      "transform": [
        {
          "window": [{ "op": "row_number", "as": "rank" }],
          "sort": [{ "field": "x", "order": "descending" }],
          "groupby": ["series"]
        },
        { "filter": "datum.rank === 1" }
      ],
      "encoding": { "text": { "field": "series" } }
    }
  ]
}
```

### 5. HJSON Triple-Quoted Strings Break Kibana

**Problem:** HJSON multi-line strings with `'''` cause parse errors in Kibana's Vega plugin.

```text
Error: End of input while parsing an object (missing '}')
```

**Solution:** Use proper JSON format with single-line queries and escaped quotes:

```json
{
  "data": {
    "url": {
      "%type%": "esql",
      "query": "FROM logs-* | WHERE level == \"error\" | STATS count=COUNT() BY host"
    }
  }
}
```

### 6. Color Schemes Invisible on Dark Themes

**Problem:** Some color schemes with `reverse: true` render invisible on Kibana's dark theme.

```json
// ❌ BAD - invisible bars on dark theme
"color": {
  "scale": { "scheme": "redyellowgreen", "reverse": true }
}
```

**Solution:** Use dark-theme-friendly schemes:

```json
// ✅ GOOD - visible on both light and dark themes
"color": {
  "scale": { "scheme": "blues" }  // or: viridis, warmgreys, teals, purples
}
```

**Safe color schemes:** `blues`, `greens`, `purples`, `teals`, `viridis`, `warmgreys`, `cividis`

### 7. Sort Conflicts in Layered Specs

**Problem:** Using `sort: "-x"` on a shared encoding in a layered spec (e.g., bar + text value labels) causes:

```text
Domains that should be unioned has conflicting sort properties. Sort will be set to true.
```

Vega-Lite tries to union the scale domains across layers and finds conflicting sort specifications.

**Solution:** Pre-sort data in ES|QL with `SORT field DESC` and use `sort: null` in encoding to preserve data order:

```json
// ❌ BAD - causes "conflicting sort properties" warning in layered specs
"y": { "field": "category", "type": "nominal", "sort": "-x" }

// ✅ GOOD - pre-sort in ES|QL, use sort: null to preserve data order
// ES|QL: ... | SORT revenue DESC
"y": { "field": "category", "type": "nominal", "sort": null }
```

**Note:** `sort: "-x"` is fine in single-mark specs (no layers). The conflict only occurs in `layer` compositions where
multiple marks share the same encoding axis.

### 8. Time Axis: No Rotated Labels

**Problem:** Rotated date labels create visual clutter and are hard to read.

```json
// ❌ BAD - cluttered, hard to read
"axis": { "format": "%b %d %H:%M", "labelAngle": -45 }
```

**Solution:** Keep labels horizontal, let Vega auto-format, limit tick count:

```json
// ✅ GOOD - clean horizontal labels, auto-formatted
"axis": { "labelAngle": 0, "tickCount": 8 }
```

**Time axis best practices:**

- **Never rotate** — use `"labelAngle": 0`
- **Let Vega auto-format** — omit `format` for intelligent date display
- **Limit ticks** — use `"tickCount": 6-10` to prevent crowding
- **Remove redundant title** — use `"title": null` when axis is self-explanatory
- **Compact y-axis titles** — use "°C" or "%" instead of "Temperature (°C)"

```json
// Optimal time series encoding
"encoding": {
  "x": {
    "field": "timestamp",
    "type": "temporal",
    "title": null,
    "axis": { "labelAngle": 0, "tickCount": 8 }
  },
  "y": {
    "field": "value",
    "type": "quantitative",
    "title": "°C",
    "scale": { "zero": false }
  }
}
```

---

## Specification Structure

A Vega-Lite specification is a JSON/HJSON object:

```hjson
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json

  // Let Kibana control sizing
  autosize: { type: fit, contains: padding }

  data: { ... }
  mark: "..."
  encoding: { ... }
}
```

### Core Components

| Component   | Description                                         |
| ----------- | --------------------------------------------------- | ----------------------------- |
| `data`      | Input data (ES                                      | QL query, inline values, URL) |
| `mark`      | Geometric shape (bar, line, point, area, etc.)      |
| `encoding`  | Mapping of data fields to visual channels           |
| `transform` | Data transformations (filter, aggregate, calculate) |
| `config`    | Styling defaults                                    |

---

## Data Types

Understanding data types is fundamental to choosing appropriate visual encodings.

| Type             | Symbol | Description              | Example                      | Appropriate Channels           |
| ---------------- | ------ | ------------------------ | ---------------------------- | ------------------------------ |
| **Nominal**      | `N`    | Categories without order | country, product type        | color hue, shape, row/column   |
| **Ordinal**      | `O`    | Ordered categories       | rating (low/med/high), month | position, color value, size    |
| **Quantitative** | `Q`    | Continuous numbers       | temperature, revenue         | position, size, color gradient |
| **Temporal**     | `T`    | Date/time values         | timestamp, date              | position (time axis)           |

### Type Selection Guidelines

- **Nominal**: Use when equality comparison matters (A = B?)
- **Ordinal**: Use when rank order matters (A < B?)
- **Quantitative**: Use when magnitude/distance matters (A - B = ?)
- **Temporal**: Use for time-based data with calendar semantics

---

## Encoding Channels

Channels map data fields to visual properties.

### Position Channels

```json
"encoding": {
  "x": {"field": "date", "type": "temporal"},
  "y": {"field": "value", "type": "quantitative"},
  "x2": {"field": "end_date"},
  "y2": {"field": "high_value"}
}
```

| Channel              | Description                 | Best For               |
| -------------------- | --------------------------- | ---------------------- |
| `x`, `y`             | Primary position            | All data types         |
| `x2`, `y2`           | Secondary position (ranges) | Range bars, error bars |
| `xOffset`, `yOffset` | Position offset within band | Grouped/dodged bars    |

### Mark Property Channels

```json
"encoding": {
  "color": {"field": "category", "type": "nominal"},
  "size": {"field": "population", "type": "quantitative"},
  "shape": {"field": "region", "type": "nominal"},
  "opacity": {"field": "confidence", "type": "quantitative"}
}
```

| Channel       | Description        | Best For                               |
| ------------- | ------------------ | -------------------------------------- |
| `color`       | Fill/stroke color  | Nominal (hue), Quantitative (gradient) |
| `size`        | Mark size/area     | Quantitative values                    |
| `shape`       | Point symbol shape | Nominal (≤6 categories)                |
| `opacity`     | Transparency       | Quantitative, overlapping data         |
| `strokeWidth` | Line thickness     | Quantitative                           |
| `strokeDash`  | Dash pattern       | Nominal (≤3 categories)                |

### Text & Tooltip Channels

```json
"encoding": {
  "text": {"field": "label"},
  "tooltip": [
    {"field": "name", "title": "Country"},
    {"field": "value", "title": "GDP", "format": ",.0f"}
  ]
}
```

### Facet Channels

```json
"encoding": {
  "row": {"field": "region", "type": "nominal"},
  "column": {"field": "year", "type": "ordinal"}
}
```

---

## Mark Types

### Basic Marks

| Mark     | Use Case             | Example            |
| -------- | -------------------- | ------------------ |
| `point`  | Scatter plots        | `"mark": "point"`  |
| `circle` | Filled scatter plots | `"mark": "circle"` |
| `bar`    | Bar charts           | `"mark": "bar"`    |
| `line`   | Time series, trends  | `"mark": "line"`   |
| `area`   | Volume over time     | `"mark": "area"`   |
| `tick`   | Strip plots          | `"mark": "tick"`   |
| `rule`   | Reference lines      | `"mark": "rule"`   |
| `text`   | Labels               | `"mark": "text"`   |
| `rect`   | Heatmaps             | `"mark": "rect"`   |
| `arc`    | Pie/donut charts     | `"mark": "arc"`    |

### Composite Marks

| Mark        | Use Case                  |
| ----------- | ------------------------- |
| `boxplot`   | Distribution summary      |
| `errorbar`  | Uncertainty visualization |
| `errorband` | Confidence intervals      |

### Mark Properties

```json
"mark": {
  "type": "bar",
  "color": "#4c78a8",
  "opacity": 0.8,
  "cornerRadius": 2,
  "strokeWidth": 0
}
```

---

## Scales

Scales map data values to visual values.

### Scale Types

| Type      | Description         | Use For                     |
| --------- | ------------------- | --------------------------- |
| `linear`  | Linear mapping      | Quantitative data           |
| `log`     | Logarithmic         | Wide-ranging values, ratios |
| `sqrt`    | Square root         | Area-based size encoding    |
| `time`    | Time-based          | Temporal data               |
| `ordinal` | Discrete categories | Nominal/ordinal             |
| `band`    | Discrete with width | Bar charts                  |

### Scale Configuration

```json
"encoding": {
  "x": {
    "field": "value",
    "type": "quantitative",
    "scale": {
      "domain": [0, 100],
      "zero": true,
      "nice": true
    }
  }
}
```

### Color Scales

```json
"encoding": {
  "color": {
    "field": "temperature",
    "type": "quantitative",
    "scale": {
      "scheme": "viridis",
      "domain": [-10, 40]
    }
  }
}
```

**Recommended Color Schemes:**

| Type        | Schemes                                         |
| ----------- | ----------------------------------------------- |
| Sequential  | `viridis`, `blues`, `greens`, `oranges`, `reds` |
| Diverging   | `redblue`, `redyellowblue`, `spectral`          |
| Categorical | `category10`, `tableau10`, `set1`               |

---

## Transforms

Data transformations within the spec.

### Filter

```json
"transform": [
  {"filter": "datum.year == 2020"},
  {"filter": {"field": "country", "oneOf": ["USA", "China", "India"]}}
]
```

### Calculate

```json
"transform": [
  {"calculate": "datum.revenue - datum.cost", "as": "profit"},
  {"calculate": "datum.value * 100 / datum.total", "as": "percentage"}
]
```

### Aggregate

```json
"transform": [
  {
    "aggregate": [
      {"op": "mean", "field": "temperature", "as": "avg_temp"},
      {"op": "count", "as": "n"}
    ],
    "groupby": ["month", "location"]
  }
]
```

**Aggregation Operations:** `count`, `sum`, `mean`, `median`, `min`, `max`, `stdev`, `variance`, `q1`, `q3`, `distinct`

### Bin

```json
"encoding": {
  "x": {
    "bin": true,
    "field": "temperature"
  },
  "y": {"aggregate": "count"}
}
```

### Time Unit

```json
"encoding": {
  "x": {
    "timeUnit": "yearmonth",
    "field": "date"
  }
}
```

**Time Units:** `year`, `quarter`, `month`, `week`, `day`, `hours`, `minutes`, `yearmonth`, `yearmonthdate`,
`hoursminutes`

### Window

```json
"transform": [
  {
    "window": [
      {"op": "row_number", "as": "rank"},
      {"op": "sum", "field": "value", "as": "cumulative"}
    ],
    "sort": [{"field": "value", "order": "descending"}]
  }
]
```

### Fold (Unpivot)

```json
"transform": [
  {"fold": ["temp_min", "temp_max"], "as": ["measure", "value"]}
]
```

### Regression

```json
"transform": [
  {"regression": "y", "on": "x", "method": "linear"}
]
```

---

## Multi-View Composition

### Layer

Superimpose multiple marks on shared axes.

```json
{
  "layer": [
    {
      "mark": { "type": "area", "opacity": 0.3 }
    },
    {
      "mark": { "type": "line", "color": "black" }
    }
  ],
  "encoding": {
    "x": { "field": "date", "type": "temporal" },
    "y": { "field": "value", "type": "quantitative" }
  }
}
```

### Horizontal Concatenation (hconcat)

```json
{
  "hconcat": [
    {"mark": "bar", "encoding": {...}},
    {"mark": "line", "encoding": {...}}
  ]
}
```

### Vertical Concatenation (vconcat)

```json
{
  "vconcat": [
    {"mark": "bar", "encoding": {...}},
    {"mark": "line", "encoding": {...}}
  ]
}
```

### Facet (Small Multiples)

```json
{
  "mark": "bar",
  "encoding": {
    "x": { "field": "value", "type": "quantitative" },
    "y": { "field": "category", "type": "nominal" },
    "column": { "field": "region", "type": "nominal" }
  }
}
```

### Resolve

Control how scales/axes/legends are shared or independent.

```json
{
  "layer": [...],
  "resolve": {
    "scale": {"y": "independent"},
    "axis": {"y": "independent"}
  }
}
```

---

## Common Chart Patterns for Kibana

All examples use ES|QL data sources and proper Kibana sizing.

### Horizontal Bar Chart with Value Labels

```hjson
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json
  title: { text: "Sales by Region", anchor: "start" }
  autosize: { type: fit, contains: padding }

  data: {
    url: {
      "%type%": "esql"
      "%context%": true
      query: '''
        FROM sales-*
        | STATS sales = SUM(amount) BY region
        | SORT sales DESC
        | LIMIT 10
      '''
    }
  }

  layer: [
    { mark: { type: bar, cornerRadiusEnd: 3 } }
    {
      mark: { type: text, align: left, dx: 5, fontSize: 11 }
      encoding: { text: { field: sales, format: "," } }
    }
  ]

  // Use sort: null with layered specs; data is pre-sorted by ES|QL SORT
  encoding: {
    y: {
      field: region
      type: nominal
      sort: null
      title: null
      axis: { labelLimit: 150 }
    }
    x: { field: sales, type: quantitative, title: "Sales ($)" }
    color: { value: "#4c78a8" }
  }
}
```

### Time Series with Area and Line

```hjson
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json
  title: {
    text: "Request Rate"
    subtitle: "Requests per minute"
    anchor: start
  }
  autosize: { type: fit, contains: padding }

  data: {
    url: {
      "%type%": "esql"
      "%context%": true
      "%timefield%": "@timestamp"
      query: '''
        FROM logs-*
        | WHERE @timestamp >= ?_tstart AND @timestamp <= ?_tend
        | STATS requests = COUNT() BY bucket = DATE_TRUNC(1 minute, @timestamp)
        | SORT bucket ASC
      '''
    }
  }

  layer: [
    { mark: { type: area, opacity: 0.2, color: "#4c78a8" } }
    { mark: { type: line, color: "#4c78a8", strokeWidth: 2 } }
  ]

  encoding: {
    x: {
      field: bucket
      type: temporal
      title: null
      axis: { labelAngle: 0, tickCount: 8 }
    }
    y: {
      field: requests
      type: quantitative
      title: "Requests"
    }
  }
}
```

### Multi-Line Chart with Direct Labels

```hjson
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json
  title: { text: "Service Performance", anchor: start }
  autosize: { type: fit, contains: padding }

  data: {
    url: {
      "%type%": "esql"
      "%context%": true
      "%timefield%": "@timestamp"
      query: '''
        FROM metrics-*
        | WHERE @timestamp >= ?_tstart AND @timestamp <= ?_tend
        | STATS avg_latency = AVG(latency) BY bucket = DATE_TRUNC(5 minutes, @timestamp), service
        | SORT bucket ASC
      '''
    }
  }

  layer: [
    {
      mark: { type: line, strokeWidth: 2 }
    }
    {
      transform: [
        {
          window: [{ op: "row_number", as: "rank" }]
          sort: [{ field: "bucket", order: "descending" }]
          groupby: ["service"]
        }
        { filter: "datum.rank === 1" }
      ]
      mark: { type: text, align: left, dx: 8, fontSize: 12, fontWeight: bold }
      encoding: { text: { field: service } }
    }
  ]

  encoding: {
    x: {
      field: bucket
      type: temporal
      title: null
      axis: { labelAngle: 0, tickCount: 8 }
    }
    y: { field: avg_latency, type: quantitative, title: "ms" }
    color: { field: service, type: nominal, legend: null }
  }
}
```

### Heatmap

```hjson
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json
  title: { text: "Activity by Day and Hour", anchor: start }
  autosize: { type: fit, contains: padding }

  data: {
    url: {
      "%type%": "esql"
      "%context%": true
      "%timefield%": "@timestamp"
      query: '''
        FROM logs-*
        | WHERE @timestamp >= ?_tstart AND @timestamp <= ?_tend
        | EVAL hour = DATE_EXTRACT("HOUR_OF_DAY", @timestamp)
        | EVAL day = DATE_FORMAT("EEE", @timestamp)
        | STATS activity = COUNT() BY hour, day
      '''
    }
  }

  mark: { type: rect, cornerRadius: 2 }

  encoding: {
    x: { field: hour, type: ordinal, title: "Hour" }
    y: { field: day, type: nominal, title: null }
    color: {
      field: activity
      type: quantitative
      scale: { scheme: blues }
      title: "Events"
    }
  }
}
```

### Grouped Bar Chart

```hjson
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json
  autosize: { type: fit, contains: padding }

  data: {
    url: {
      "%type%": "esql"
      query: '''
        FROM sales-*
        | STATS revenue = SUM(amount) BY category, quarter
        | SORT category, quarter
      '''
    }
  }

  mark: { type: bar, cornerRadius: 2 }

  encoding: {
    x: { field: category, type: nominal, title: null }
    y: { field: revenue, type: quantitative, title: "Revenue" }
    xOffset: { field: quarter, type: nominal }
    color: {
      field: quarter
      type: nominal
      title: "Quarter"
      scale: { range: ["#4c78a8", "#72b7b2"] }
    }
  }
}
```

### Scatter Plot with Trend Line

```hjson
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json
  autosize: { type: fit, contains: padding }

  data: {
    url: {
      "%type%": "esql"
      query: '''
        FROM metrics-*
        | STATS cpu = AVG(cpu_percent), memory = AVG(memory_percent) BY host
      '''
    }
  }

  layer: [
    {
      mark: { type: point, filled: true, size: 60, opacity: 0.7 }
    }
    {
      mark: { type: line, color: "firebrick", strokeWidth: 2 }
      transform: [{ regression: "memory", on: "cpu" }]
    }
  ]

  encoding: {
    x: { field: cpu, type: quantitative, title: "CPU %" }
    y: { field: memory, type: quantitative, title: "Memory %" }
  }
}
```

---

## Best Practices

### 1. Never Use Pie or Donut Charts

Humans cannot accurately compare arc lengths or angles. **Always use sorted bar charts instead.**

```hjson
// ❌ AVOID - pie/donut charts
{ mark: { type: arc, innerRadius: 50 } }

// ✅ USE - sorted horizontal bar chart (pre-sort in ES|QL, use sort: null for layered specs)
{
  mark: bar
  encoding: {
    y: { field: category, sort: null }
    x: { field: value }
  }
}
```

### 2. Use Color to Encode Data, Not Decorate

- **Single series = single color** (don't add rainbow gradients)
- Reserve color for encoding **meaningful data dimensions**
- Use **sequential** schemes for quantitative data
- Use **categorical** schemes only for nominal data (≤10 categories)

### 3. Sort by Value, Not Alphabetically

Pre-sort data in ES|QL (`SORT value DESC`) and use `sort: null` to preserve that order. This is required for layered
specs (bar + text labels) to avoid "conflicting sort properties" warnings. For single-mark specs, `sort: "-x"` also
works.

```json
// ✅ PREFERRED - works in all specs (single-mark and layered)
// ES|QL: ... | SORT revenue DESC
"encoding": {
  "y": {"field": "category", "sort": null}
}

// ⚠️ OK for single-mark only - causes warnings in layered specs
"encoding": {
  "y": {"field": "category", "sort": "-x"}
}
```

### 4. Annotate Values Directly on Bars

Use `sort: null` on the categorical axis (not `sort: "-x"`) since this is a layered spec. Pre-sort data via ES|QL.

```hjson
{
  layer: [
    { mark: bar }
    {
      mark: { type: text, align: left, dx: 5, fontSize: 11 }
      encoding: { text: { field: value, format: "," } }
    }
  ]
  // Data pre-sorted by ES|QL: ... | SORT value DESC
  encoding: {
    y: { field: category, sort: null }
    x: { field: value }
  }
}
```

### 5. Direct Label Instead of Legends

Place labels directly on data points:

```hjson
{
  layer: [
    {
      mark: { type: line, strokeWidth: 2 }
      encoding: { color: { field: series, legend: null } }
    }
    {
      mark: { type: text, align: left, dx: 8, fontWeight: bold }
      transform: [
        {
          window: [{ op: "row_number", as: "rank" }]
          sort: [{ field: "x", order: "descending" }]
          groupby: ["series"]
        }
        { filter: "datum.rank === 1" }
      ]
      encoding: {
        text: { field: series }
        color: { field: series, legend: null }
      }
    }
  ]
}
```

### 6. Add Reference Lines for Context

```hjson
{
  layer: [
    { mark: bar, encoding: {...} }
    {
      mark: { type: rule, strokeDash: [4, 4], color: "#999" }
      encoding: { y: { datum: 20 } }
    }
    {
      mark: { type: text, align: left, dx: 5, color: "#666" }
      encoding: {
        y: { datum: 20 }
        text: { value: "Target: 20" }
      }
    }
  ]
}
```

### 7. Descriptive Titles Replace Axis Titles

A good title/subtitle makes axis titles redundant. Remove them to reduce clutter.

```json
// ❌ REDUNDANT - title and axis titles say the same thing
{
  "title": "Temperature Over Time",
  "encoding": {
    "x": { "field": "time", "title": "Time" },
    "y": { "field": "temp", "title": "Temperature (°C)" }
  }
}

// ✅ CLEAN - descriptive title, no axis titles needed
{
  "title": {
    "text": "Temperature Over Time",
    "subtitle": "Hourly readings, December 2025"
  },
  "encoding": {
    "x": { "field": "time", "title": null },
    "y": { "field": "temp", "title": null }
  }
}
```

**When to keep axis titles:**

- Units aren't obvious (use compact: "°C", "%", "ms")
- Multiple y-axes with different scales
- Scientific/technical charts where precision matters

```json
"title": {
  "text": "Room Climate Comparison",
  "subtitle": "Temperature and humidity by room",
  "anchor": "start"
}
```

### 8. Use Small Multiples Over Complexity

Instead of overloading one chart, use faceting:

```hjson
{
  mark: line
  encoding: {
    column: { field: region, type: nominal }
    x: { field: date, type: temporal }
    y: { field: value, type: quantitative }
  }
}
```

---

## Kibana-Specific Configuration

### Config Block for Kibana

```hjson
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json

  config: {
    kibana: {
      hideWarnings: true
      renderer: "svg"  // or "canvas"
    }
    view: { stroke: null }
    axis: { labelFontSize: 12, titleFontSize: 14 }
  }

  // ... rest of spec
}
```

### Kibana Config Options

| Option         | Type                  | Default    | Description                           |
| -------------- | --------------------- | ---------- | ------------------------------------- |
| `hideWarnings` | `boolean`             | `false`    | Suppress Vega warnings                |
| `type`         | `string`              | -          | Set to `"map"` for map visualizations |
| `renderer`     | `"svg"` \| `"canvas"` | `"canvas"` | Rendering engine                      |

---

## Professional Theming

### Light Theme

```hjson
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json
  background: white

  config: {
    title: {
      color: "#171717"
      subtitleColor: "#737373"
      fontSize: 16
      subtitleFontSize: 12
      anchor: start
    }
    axis: {
      labelColor: "#525252"
      titleColor: "#525252"
      gridColor: "#e5e5e5"
      domainColor: "#d4d4d4"
      tickColor: "#d4d4d4"
    }
    legend: {
      labelColor: "#525252"
      titleColor: "#525252"
    }
    view: { stroke: null }
  }
}
```

### Dark Theme

```hjson
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json
  background: "#0a0a0a"

  config: {
    title: {
      color: "#e5e5e5"
      subtitleColor: "#a3a3a3"
      fontSize: 16
      subtitleFontSize: 12
      anchor: start
    }
    axis: {
      labelColor: "#a3a3a3"
      titleColor: "#a3a3a3"
      gridColor: "#262626"
      domainColor: "#404040"
      tickColor: "#404040"
    }
    legend: {
      labelColor: "#a3a3a3"
      titleColor: "#a3a3a3"
    }
    view: { stroke: null }
  }
}
```

---

## Quick Reference Checklist

Before finalizing any chart, verify:

- [ ] **Descriptive title/subtitle** — makes axis titles unnecessary
- [ ] **Remove redundant axis titles** — use `title: null` when chart title is clear
- [ ] **No width/height set** — use `autosize: { type: fit, contains: padding }`
- [ ] **Simple field names** — use RENAME in ES|QL for dotted fields
- [ ] **Sort bars by value** — pre-sort in ES|QL, use `sort: null` in layered specs (not `sort: "-x"`)
- [ ] **Time axis horizontal** — `labelAngle: 0`, `tickCount: 8`, auto-format
- [ ] **Value labels** on bars for precise reading
- [ ] **Direct labels** on lines instead of legends (or legend at right)
- [ ] **Compact units if needed** — use "°C" not "Temperature (°C)"
- [ ] **Reference lines** for thresholds/targets with labels
- [ ] **Consistent theming** — same colors mean same things

## References

- [Vega-Lite Documentation](https://vega.github.io/vega-lite/docs/)
- [Vega-Lite Examples](https://vega.github.io/vega-lite/examples/)
- [UW Visualization Curriculum](https://idl.uw.edu/visualization-curriculum/intro.html)
