# Vega ES|QL Reference

Complete reference for using ES|QL queries in Kibana Vega visualizations.

## Overview

Kibana's Vega plugin supports ES|QL as a data source through the `%type%: "esql"` URL configuration. This allows you to
use Vega/Vega-Lite grammar with ES|QL's powerful piped query language.

> **CRITICAL**: Always use proper JSON format for Vega specs. HJSON triple-quoted strings (`'''`) cause parse errors in
> Kibana's Vega plugin. Use single-line queries with escaped quotes instead.

## Data URL Configuration

### Basic ES|QL Query

```json
{
  "data": {
    "url": {
      "%type%": "esql",
      "query": "FROM logs-* | STATS count=COUNT() BY status"
    }
  }
}
```

### Full Configuration Options

| Property          | Type                             | Required | Default | Description                                                       |
| ----------------- | -------------------------------- | -------- | ------- | ----------------------------------------------------------------- | --------------- |
| `%type%`          | `"esql"`                         | Yes      | -       | Specifies the ES                                                  | QL query parser |
| `query`           | `string`                         | Yes      | -       | The ES                                                            | QL query string |
| `%context%`       | `boolean`                        | No       | `false` | Apply dashboard filters to the query                              |
| `%timefield%`     | `string`                         | No       | -       | Field name for time-based filtering (enables `?_tstart`/`?_tend`) |
| `dropNullColumns` | `boolean`                        | No       | `true`  | Remove columns with all null values                               |
| `params`          | `Array<Record<string, unknown>>` | No       | `[]`    | Custom named parameters for the query                             |

## Time Range Integration

### Enabling Time Filtering

Set `%timefield%` to enable automatic time parameter injection:

```hjson
{
  data: {
    url: {
      "%type%": "esql"
      "%timefield%": "@timestamp"
      query: "FROM logs-* | WHERE @timestamp >= ?_tstart AND @timestamp <= ?_tend | STATS count=COUNT()"
    }
  }
}
```

### Time Parameters

When `%timefield%` is set and your query contains these parameters, they are automatically populated:

| Parameter  | Description                                       |
| ---------- | ------------------------------------------------- |
| `?_tstart` | Start of the time range (from Kibana time picker) |
| `?_tend`   | End of the time range (from Kibana time picker)   |

**Note**: Parameters are case-insensitive (`?_TSTART` works too).

### Example: Time Series

```hjson
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json

  data: {
    url: {
      "%type%": "esql"
      "%timefield%": "@timestamp"
      query: '''
        FROM metrics-*
        | WHERE @timestamp >= ?_tstart AND @timestamp <= ?_tend
        | STATS avg_cpu = AVG(system.cpu.total.pct)
          BY bucket = DATE_TRUNC(5 minutes, @timestamp)
        | SORT bucket ASC
      '''
    }
  }

  mark: line

  encoding: {
    x: { field: bucket, type: temporal }
    y: { field: avg_cpu, type: quantitative }
  }
}
```

## Dashboard Context (Filters)

### Applying Dashboard Filters

Enable `%context%` to have dashboard-level filters automatically applied:

```hjson
{
  data: {
    url: {
      "%type%": "esql"
      "%context%": true
      query: "FROM logs-* | STATS count=COUNT() BY host.name"
    }
  }
}
```

When a user adds filters in the dashboard (e.g., `host.name: "server-01"`), those filters are passed to the ES|QL query.

### Combining Context and Time

```hjson
{
  data: {
    url: {
      "%type%": "esql"
      "%context%": true
      "%timefield%": "@timestamp"
      query: '''
        FROM logs-*
        | WHERE @timestamp >= ?_tstart AND @timestamp <= ?_tend
        | STATS error_count = COUNT() BY service.name
        | WHERE error_count > 0
        | SORT error_count DESC
      '''
    }
  }
}
```

## Custom Parameters

### Using Named Parameters

Pass custom values to your ES|QL query:

```hjson
{
  data: {
    url: {
      "%type%": "esql"
      query: "FROM logs-* | WHERE level = ?level | STATS count=COUNT()"
      params: [{ level: "ERROR" }]
    }
  }
}
```

### Multiple Parameters

```hjson
{
  data: {
    url: {
      "%type%": "esql"
      query: '''
        FROM logs-*
        | WHERE level = ?level AND service.name = ?service
        | STATS count=COUNT()
      '''
      params: [
        { level: "ERROR" }
        { service: "api-gateway" }
      ]
    }
  }
}
```

### Combining with Time Parameters

```hjson
{
  data: {
    url: {
      "%type%": "esql"
      "%timefield%": "@timestamp"
      query: '''
        FROM logs-*
        | WHERE @timestamp >= ?_tstart AND level = ?level
        | STATS count=COUNT()
      '''
      params: [{ level: "ERROR" }]
    }
  }
}
```

## Response Transformation

ES|QL returns columnar data which is automatically transformed to row-based format for Vega.

### ES|QL Response Format

```json
{
  "columns": [
    { "name": "country", "type": "keyword" },
    { "name": "count", "type": "long" }
  ],
  "values": [
    ["US", 100],
    ["UK", 50]
  ]
}
```

### Transformed Vega Data

```json
[
  { "country": "US", "count": 100 },
  { "country": "UK", "count": 50 }
]
```

### Handling Null Values

By default, `dropNullColumns: true` removes columns where all values are null. Set to `false` to preserve them:

```hjson
{
  data: {
    url: {
      "%type%": "esql"
      query: "FROM logs-* | STATS count=COUNT(), errors=SUM(error) BY host.name"
      dropNullColumns: false
    }
  }
}
```

## Multiple Data Sources

### Named Data Sources

```hjson
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json

  data: {
    name: "main_data"
    url: {
      "%type%": "esql"
      query: "FROM logs-* | STATS count=COUNT() BY status"
    }
  }

  // Additional data can be defined in layer or other sections
}
```

### Layered Charts with Different Queries

```hjson
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json

  layer: [
    {
      data: {
        url: {
          "%type%": "esql"
          "%timefield%": "@timestamp"
          query: "FROM logs-* | WHERE @timestamp >= ?_tstart | STATS requests=COUNT() BY bucket=DATE_TRUNC(1h, @timestamp)"
        }
      }
      mark: line
      encoding: {
        x: { field: bucket, type: temporal }
        y: { field: requests, type: quantitative }
      }
    }
    {
      data: {
        url: {
          "%type%": "esql"
          "%timefield%": "@timestamp"
          query: "FROM logs-* | WHERE @timestamp >= ?_tstart AND level == 'error' | STATS errors=COUNT() BY bucket=DATE_TRUNC(1h, @timestamp)"
        }
      }
      mark: { type: line, color: red }
      encoding: {
        x: { field: bucket, type: temporal }
        y: { field: errors, type: quantitative }
      }
    }
  ]
}
```

## Kibana Configuration

### Config Block

Use `config.kibana` for Kibana-specific settings:

```hjson
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json

  config: {
    kibana: {
      hideWarnings: true
      type: "map"  // For map visualizations
      renderer: "svg"  // or "canvas"
    }
  }

  // ... rest of spec
}
```

### Kibana Config Options

| Option              | Type                  | Default      | Description                                                    |
| ------------------- | --------------------- | ------------ | -------------------------------------------------------------- |
| `hideWarnings`      | `boolean`             | `false`      | Suppress Vega warnings                                         |
| `type`              | `string`              | -            | Set to `"map"` for map visualizations                          |
| `renderer`          | `"svg"` \| `"canvas"` | `"canvas"`   | Rendering engine                                               |
| `controlsLocation`  | `string`              | `"bottom"`   | Position of controls: `"top"`, `"bottom"`, `"left"`, `"right"` |
| `controlsDirection` | `string`              | `"vertical"` | Control layout: `"horizontal"` or `"vertical"`                 |

## Best Practices

### 1. Don't Set Width/Height - Use Autosize

Kibana controls the visualization size through the dashboard panel. Let Kibana manage dimensions:

```hjson
// Good - let Kibana control size
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json

  autosize: {
    type: fit
    contains: padding
  }

  // ... rest of spec (no width/height)
}

// Bad - explicit dimensions conflict with Kibana
{
  $schema: https://vega.github.io/schema/vega-lite/v6.json
  width: 600
  height: 300
  // ...
}
```

### 2. Always Use Time Filtering for Time Series

```hjson
// Good
{
  data: {
    url: {
      "%type%": "esql"
      "%timefield%": "@timestamp"
      query: "FROM logs-* | WHERE @timestamp >= ?_tstart AND @timestamp <= ?_tend | ..."
    }
  }
}

// Bad - queries all data
{
  data: {
    url: {
      "%type%": "esql"
      query: "FROM logs-* | ..."
    }
  }
}
```

### 2. Use Context for Dashboard Integration

```hjson
// When the chart should respond to dashboard filters
{
  data: {
    url: {
      "%type%": "esql"
      "%context%": true
      // ...
    }
  }
}
```

### 3. Limit Results

Always use `LIMIT` or aggregations to control result size:

```hjson
{
  data: {
    url: {
      "%type%": "esql"
      query: "FROM logs-* | LIMIT 1000"  // Or use STATS for aggregation
    }
  }
}
```

### 4. Pre-sort Data for Time Series

```hjson
{
  data: {
    url: {
      "%type%": "esql"
      query: '''
        FROM logs-*
        | STATS count=COUNT() BY bucket=DATE_TRUNC(1h, @timestamp)
        | SORT bucket ASC  // Important for line charts
      '''
    }
  }
}
```

### 5. Always Rename Dotted Fields

Dotted field names like `service.name` or `room.name` break Vega-Lite (they're interpreted as nested object paths).
Always rename them:

```json
{
  "data": {
    "url": {
      "%type%": "esql",
      "query": "FROM logs-* | STATS count=COUNT() BY service.name | RENAME service.name AS service"
    }
  }
}
```

### 6. Use Single-Line Queries (Avoid Triple Quotes)

HJSON triple-quoted strings (`'''`) cause parse errors in Kibana. Use single-line queries with escaped quotes:

```json
{
  "data": {
    "url": {
      "%type%": "esql",
      "query": "FROM logs-* | WHERE @timestamp >= ?_tstart AND @timestamp <= ?_tend | STATS total = COUNT(), errors = COUNT(level == \"error\" OR NULL) BY service.name | RENAME service.name AS service | EVAL error_rate = errors / total * 100 | SORT error_rate DESC | LIMIT 20"
    }
  }
}
```

## Comparison: ES|QL vs Elasticsearch DSL

### ES|QL Approach

```hjson
{
  data: {
    url: {
      "%type%": "esql"
      query: "FROM logs-* | STATS count=COUNT() BY status | SORT count DESC"
    }
  }
}
```

### Elasticsearch DSL Approach (Traditional)

```hjson
{
  data: {
    url: {
      index: "logs-*"
      body: {
        size: 0
        aggs: {
          by_status: {
            terms: { field: "status", order: { _count: "desc" } }
          }
        }
      }
    }
    format: { property: "aggregations.by_status.buckets" }
  }
}
```

**ES|QL advantages:**

- More readable syntax
- Easier to write and maintain
- Supports complex transformations inline
- Better for ad-hoc analysis
