# Chart Types Reference

Complete schema reference for each supported Lens chart type via the Kibana dashboards & visualizations API.

**Supported Chart Types:**

- `metric` — Single metric value
- `xy` — Line, area, bar charts
- `gauge` — Gauge visualization
- `heatmap` — Heatmap charts
- `tagcloud` — Tag/word cloud
- `datatable` — Data tables
- `region_map` — Region/choropleth maps
- `pie`, `donut`, `treemap`, `mosaic`, `waffle` — Partition charts

## Metric

Single metric value display. Uses a `metrics` (plural) array with `type: "primary"` or `type: "secondary"`.

**ES|QL:**

```json
{
  "type": "metric",
  "dataset": {
    "type": "esql",
    "query": "FROM logs | STATS count = COUNT()"
  },
  "metrics": [
    {
      "type": "primary",
      "operation": "value",
      "column": "count"
    }
  ]
}
```

**dataView:**

```json
{
  "type": "metric",
  "dataset": { "type": "dataView", "id": "90943e30-9a47-11e8-b64d-95841ca0b247" },
  "metrics": [
    {
      "type": "primary",
      "operation": "count",
      "label": "Total Events"
    }
  ]
}
```

**Metric Item Properties:**

| Property     | Type    | Required | Description                                                     |
| ------------ | ------- | -------- | --------------------------------------------------------------- |
| `type`       | string  | Yes      | `"primary"` or `"secondary"`                                    |
| `operation`  | string  | Yes      | `"value"` for ES\|QL, or aggregation name for dataView          |
| `column`     | string  | ES\|QL   | ES\|QL column name (required when `operation` is `"value"`)     |
| `field`      | string  | dataView | Field name (required for dataView aggregations needing a field) |
| `label`      | string  | No       | Display label                                                   |
| `alignments` | object  | No       | Text alignments (`{ value: "left", labels: "left" }`)           |
| `fit`        | boolean | No       | Whether to fit the value                                        |

> **Tip:** For ES|QL metrics in dashboards, avoid redundant labels by leaving the panel `title` empty (`""`) and
> aliasing the column name in ES|QL with backticks (e.g. ``STATS `Total Requests` = COUNT()`` and setting
> `"column": "Total Requests"`).

## XY Charts

Line, area, and bar charts. For ES|QL, the `dataset` goes **inside each layer**.

### Bar Chart

```json
{
  "type": "xy",
  "layers": [
    {
      "type": "bar",
      "dataset": {
        "type": "esql",
        "query": "FROM logs | STATS count = COUNT() BY status"
      },
      "x": { "operation": "value", "column": "status" },
      "y": [{ "operation": "value", "column": "count" }]
    }
  ]
}
```

### Line Chart (Time Series)

```json
{
  "type": "xy",
  "layers": [
    {
      "type": "line",
      "dataset": {
        "type": "esql",
        "query": "FROM logs | STATS count = COUNT() BY bucket = BUCKET(@timestamp, 75, ?_tstart, ?_tend)"
      },
      "x": { "operation": "value", "column": "bucket" },
      "y": [{ "operation": "value", "column": "count" }]
    }
  ]
}
```

### Area Chart

```json
{
  "type": "xy",
  "layers": [
    {
      "type": "area",
      "dataset": {
        "type": "esql",
        "query": "FROM metrics | STATS avg_cpu = AVG(cpu) BY bucket = BUCKET(@timestamp, 75, ?_tstart, ?_tend)"
      },
      "x": { "operation": "value", "column": "bucket" },
      "y": [{ "operation": "value", "column": "avg_cpu" }]
    }
  ]
}
```

### Multiple Y-Axis Values

```json
{
  "type": "xy",
  "layers": [
    {
      "type": "line",
      "dataset": {
        "type": "esql",
        "query": "FROM logs | STATS count = COUNT(), errors = COUNT(CASE(level == \"error\", 1, null)) BY bucket = BUCKET(@timestamp, 75, ?_tstart, ?_tend)"
      },
      "x": { "operation": "value", "column": "bucket" },
      "y": [
        { "operation": "value", "column": "count", "label": "Total" },
        { "operation": "value", "column": "errors", "label": "Errors" }
      ]
    }
  ]
}
```

### Split Series (Color by Field)

```json
{
  "type": "xy",
  "layers": [
    {
      "type": "line",
      "dataset": {
        "type": "esql",
        "query": "FROM logs | STATS count = COUNT() BY bucket = BUCKET(@timestamp, 75, ?_tstart, ?_tend), host"
      },
      "x": { "operation": "value", "column": "bucket" },
      "y": [{ "operation": "value", "column": "count" }],
      "breakdown_by": { "operation": "value", "column": "host" }
    }
  ]
}
```

**Layer Types:**

- `bar` — Vertical bars
- `bar_stacked` — Stacked bars
- `bar_percentage` — Percentage bars
- `bar_horizontal` — Horizontal bars
- `bar_horizontal_stacked` — Horizontal stacked bars
- `bar_horizontal_percentage` — Horizontal percentage bars
- `line` — Line chart
- `area` — Area chart
- `area_stacked` — Stacked area
- `area_percentage` — Percentage area

## Gauge

For ES|QL, uses `metric` with `operation: "value"`. Do not pass `min`/`max`/`goal` for ES|QL gauges — the API injects
defaults.

```json
{
  "type": "gauge",
  "dataset": {
    "type": "esql",
    "query": "FROM logs | STATS success_rate = COUNT(CASE(TO_INTEGER(status) == 200, 1, null)) * 100.0 / COUNT()"
  },
  "metric": {
    "operation": "value",
    "column": "success_rate"
  }
}
```

**Gauge Properties:**

| Property           | Type   | Required | Description          |
| ------------------ | ------ | -------- | -------------------- |
| `metric.operation` | string | Yes      | `"value"` for ES\|QL |
| `metric.column`    | string | Yes      | ES\|QL column name   |

## Heatmap

```json
{
  "type": "heatmap",
  "dataset": {
    "type": "esql",
    "query": "FROM logs | STATS count = COUNT() BY hour = DATE_EXTRACT(hour, @timestamp), day = DATE_EXTRACT(dayofweek, @timestamp)"
  },
  "xAxis": { "operation": "value", "column": "hour" },
  "yAxis": { "operation": "value", "column": "day" },
  "metric": { "operation": "value", "column": "count" }
}
```

## Tag Cloud

Uses `tag_by` (not `tag`) and `metric` with `operation: "value"` for ES|QL.

```json
{
  "type": "tagcloud",
  "dataset": {
    "type": "esql",
    "query": "FROM logs | STATS count = COUNT() BY keyword"
  },
  "tag_by": { "operation": "value", "column": "keyword" },
  "metric": { "operation": "value", "column": "count" }
}
```

## Datatable

For ES|QL, uses `metrics` and `rows` arrays (not `columns`). Each entry uses `{ operation: "value", column: "..." }`.

```json
{
  "type": "datatable",
  "dataset": {
    "type": "esql",
    "query": "FROM logs | STATS count = COUNT(), avg_bytes = AVG(bytes) BY host"
  },
  "metrics": [
    { "operation": "value", "column": "count" },
    { "operation": "value", "column": "avg_bytes" }
  ],
  "rows": [{ "operation": "value", "column": "host" }]
}
```

**For dataView**, the datatable uses aggregation operations:

```json
{
  "type": "datatable",
  "dataset": { "type": "dataView", "id": "90943e30-9a47-11e8-b64d-95841ca0b247" },
  "metrics": [{ "operation": "count" }, { "operation": "average", "field": "bytes" }],
  "rows": [
    {
      "operation": "terms",
      "fields": ["host.keyword"],
      "size": 15,
      "rank_by": { "type": "column", "metric": 0, "direction": "desc" }
    }
  ]
}
```

## Partition (Pie, Donut, Treemap, Mosaic, Waffle)

Partition charts display parts of a whole. Uses a flat structure (no `layers`) with `metrics` for the slice sizes and
`group_by` for the rings or groupings. The schema is identical for all partition types—simply change `"type": "pie"` to
`"donut"`, `"treemap"`, `"mosaic"`, or `"waffle"`.

**ES|QL Example:**

```json
{
  "type": "pie",
  "dataset": {
    "type": "esql",
    "query": "FROM logs | STATS count = COUNT() BY os"
  },
  "metrics": [{ "operation": "value", "column": "count" }],
  "group_by": [{ "operation": "value", "column": "os" }]
}
```

## Region Map

```json
{
  "type": "region_map",
  "dataset": {
    "type": "esql",
    "query": "FROM logs | STATS count = COUNT() BY geo.country_iso_code"
  },
  "region": { "operation": "value", "column": "geo.country_iso_code" },
  "metric": { "operation": "value", "column": "count" }
}
```

## Common Patterns

### Renaming Columns for Clarity

```json
{
  "type": "metric",
  "dataset": {
    "type": "esql",
    "query": "FROM logs | STATS total_events = COUNT(), error_count = COUNT(CASE(level == \"error\", 1, null)) | EVAL error_rate = ROUND(error_count * 100.0 / total_events, 2)"
  },
  "metrics": [{ "type": "primary", "operation": "value", "column": "error_rate" }]
}
```

### Time Bucketing

**Auto buckets (Recommended):**

```esql
STATS count = COUNT() BY bucket = BUCKET(@timestamp, 75, ?_tstart, ?_tend)
```

**Hourly buckets:**

```esql
STATS count = COUNT() BY bucket = DATE_TRUNC(1 hour, @timestamp)
```

**Daily buckets:**

```esql
STATS count = COUNT() BY bucket = DATE_TRUNC(1 day, @timestamp)
```

**5-minute buckets:**

```esql
STATS count = COUNT() BY bucket = DATE_TRUNC(5 minutes, @timestamp)
```

### Filtering in ES|QL

```esql
FROM logs
| WHERE @timestamp > NOW() - 24 hours AND level == "error"
| STATS count = COUNT() BY host
```
