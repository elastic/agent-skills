---
name: kibana-vega
description: >
  Create Vega and Vega-Lite visualizations with ES|QL data sources in Kibana. Use
  when building custom charts, dashboards, or programmatic panel layouts beyond standard
  Lens charts.
metadata:
  author: elastic
  version: 0.1.0
---

# Kibana Vega

Create and manage Kibana dashboards and Vega visualizations with ES|QL data sources.

## Overview

Vega is a declarative visualization grammar for creating custom charts in Kibana. Combined with ES|QL queries, it
enables highly customized visualizations beyond standard Kibana charts.

**Important Version Requirement:** This skill strictly supports **ES|QL data sources** and requires **Serverless Kibana
or version 9.4+ (SNAPSHOT)**. It will not work reliably on older versions or with older Lucene/KQL data source
definitions.

## Quick Start

### Environment Configuration

Kibana connection is configured via environment variables. Run `node scripts/kibana-vega.js test` to verify the
connection. If the test fails, suggest these setup options to the user, then stop. Do not try to explore further until a
successful connection test.

#### Option 1: Elastic Cloud (recommended for production)

```bash
export KIBANA_CLOUD_ID="deployment-name:base64encodedcloudid"
export KIBANA_API_KEY="base64encodedapikey"
```

#### Option 2: Direct URL with API Key

```bash
export KIBANA_URL="https://your-kibana:5601"
export KIBANA_API_KEY="base64encodedapikey"
```

#### Option 3: Basic Authentication

```bash
export KIBANA_URL="https://your-kibana:5601"
export KIBANA_USERNAME="elastic"
export KIBANA_PASSWORD="changeme"
```

#### Option 4: Local Development with start-local

For local development and testing, use [start-local](https://github.com/elastic/start-local) to quickly spin up
Elasticsearch and Kibana using Docker or Podman:

```bash
curl -fsSL https://elastic.co/start-local | sh
```

After installation completes, Elasticsearch runs at `http://localhost:9200` and Kibana at `http://localhost:5601`. The
script generates a random password for the `elastic` user, stored in the `.env` file inside the created
`elastic-start-local` folder.

To configure the environment variables for this skill, source the `.env` file and export the connection settings:

```bash
source elastic-start-local/.env
export KIBANA_URL="$KB_LOCAL_URL"
export KIBANA_USERNAME="elastic"
export KIBANA_PASSWORD="$ES_LOCAL_PASSWORD"
```

Then run `node scripts/kibana-vega.js test` to verify the connection.

#### Optional: Skip TLS verification (development only)

```bash
export KIBANA_INSECURE="true"
```

### Basic Workflow

```bash
# Test connection
node scripts/kibana-vega.js test

# Create visualization directly from stdin (no intermediate file needed)
echo '<json-spec>' | node scripts/kibana-vega.js visualizations create "My Chart" -

# Get visualization spec for review/modification
node scripts/kibana-vega.js visualizations get <vis-id>

# Update visualization from stdin
echo '<json-spec>' | node scripts/kibana-vega.js visualizations update <vis-id> -

# Create dashboard
node scripts/kibana-vega.js dashboards create "My Dashboard"

# Add visualization with grid position
node scripts/kibana-vega.js dashboards add-panel <dashboard-id> <vis-id> --x 0 --y 0 --w 24 --h 15

# Apply a complete layout from stdin
echo '<layout-json>' | node scripts/kibana-vega.js dashboards apply-layout <dashboard-id> -
```

**Note:** Use `-` as the file argument to read JSON from stdin. This enables direct spec creation without intermediate
files.

### Minimal Vega Spec with ES|QL

**IMPORTANT**: Always use proper JSON format (not HJSON with triple quotes) to avoid parse errors.

```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "title": "My Chart",
  "autosize": { "type": "fit", "contains": "padding" },

  "config": {
    "axis": { "domainColor": "#444", "tickColor": "#444" },
    "view": { "stroke": null }
  },

  "data": {
    "url": {
      "%type%": "esql",
      "query": "FROM logs-* | STATS count = COUNT() BY status | RENAME status AS category"
    }
  },

  "mark": { "type": "bar", "color": "#6092C0" },
  "encoding": {
    "x": { "field": "category", "type": "nominal" },
    "y": { "field": "count", "type": "quantitative" }
  }
}
```

### ES|QL Data Source Options

| Property                    | Description                                |
| --------------------------- | ------------------------------------------ | --------- |
| `%type%: "esql"`            | Required. Use ES                           | QL parser |
| `%context%: true`           | Apply dashboard filters                    |
| `%timefield%: "@timestamp"` | Enable time range with `?_tstart`/`?_tend` |

## Examples

### Stdin Examples

```bash
# Create visualization directly from JSON
echo '{"$schema":"https://vega.github.io/schema/vega-lite/v6.json",...}' | \
  node scripts/kibana-vega.js visualizations create "My Chart" -

# Update visualization
echo '{"$schema":...}' | node scripts/kibana-vega.js visualizations update <id> -

# Apply layout directly
echo '{"panels":[{"visualization":"<id>","x":0,"y":0,"w":24,"h":10}]}' | \
  node scripts/kibana-vega.js dashboards apply-layout <dash-id> -
```

## Dashboard Layout Design

### Grid System

Kibana dashboards use a **48-column grid**:

| Width   | Columns | Use Case                         |
| ------- | ------- | -------------------------------- |
| Full    | 48      | Timelines, heatmaps, wide charts |
| Half    | 24      | Side-by-side comparisons         |
| Third   | 16      | Three-column layouts             |
| Quarter | 12      | KPI metrics, small summaries     |

### Above the Fold (Critical)

**Primary information must be visible without scrolling.**

| Resolution | Visible Height | Layout Budget              |
| ---------- | -------------- | -------------------------- |
| 1080p      | ~30 units      | 2 rows: h:10 + h:12        |
| 1440p      | ~40 units      | 3 rows: h:12 + h:12 + h:12 |

**Height guidelines:**

- `h: 10` — Compact bar charts (≤7 items), fits above fold
- `h: 12-13` — Standard charts, timelines
- `h: 15+` — Detailed views, use below fold

### Layout Pattern: Operational Dashboard

```text
┌───────────────────────┬───────────────────────┐  y:0
│  Current State A      │  Current State B      │  h:10 (compact)
├───────────────────────┴───────────────────────┤  y:10
│         Primary Timeline                      │  h:12 (main trend)
├ ─ ─ ─ ─ ─ ─ ─ FOLD ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤  y:22 (1080p fold)
│         Secondary Timeline                    │  h:12 (below fold OK)
├───────────────────────┬───────────────────────┤  y:34
│  Complementary 1      │  Complementary 2      │  h:10
└───────────────────────┴───────────────────────┘
```

### Creating Layouts

#### Option 1: Add panels with positions

```bash
# Row 1: Two compact half-width charts (above fold)
node scripts/kibana-vega.js dashboards add-panel $DASH $VIS1 --x 0 --y 0 --w 24 --h 10
node scripts/kibana-vega.js dashboards add-panel $DASH $VIS2 --x 24 --y 0 --w 24 --h 10

# Row 2: Full-width timeline (above fold)
node scripts/kibana-vega.js dashboards add-panel $DASH $VIS3 --x 0 --y 10 --w 48 --h 12

# Row 3: Below fold content
node scripts/kibana-vega.js dashboards add-panel $DASH $VIS4 --x 0 --y 22 --w 48 --h 12
```

#### Option 2: Apply layout file

Create `layout.json`:

```json
{
  "title": "My Dashboard",
  "panels": [
    { "visualization": "<vis-id-1>", "x": 0, "y": 0, "w": 24, "h": 10 },
    { "visualization": "<vis-id-2>", "x": 24, "y": 0, "w": 24, "h": 10 },
    { "visualization": "<vis-id-3>", "x": 0, "y": 10, "w": 48, "h": 12 },
    { "visualization": "<vis-id-4>", "x": 0, "y": 22, "w": 48, "h": 12 }
  ]
}
```

Apply it:

```bash
node scripts/kibana-vega.js dashboards apply-layout <dashboard-id> layout.json
```

### Design Checklist

1. **Above the fold**: Primary info in top ~22 height units (1080p)
2. **Compact heights**: Use h:10 for bar charts with ≤7 items
3. **Prioritize**: Most important info top-left
4. **Group**: Related charts side-by-side for comparison
5. **Timelines**: Full width (w:48), h:12 for compact
6. **Below fold**: Complementary/detailed panels OK to scroll

## Guidelines

1. **Use JSON, not HJSON triple-quotes** — `'''` multi-line strings cause parse errors in Kibana; use single-line
   queries with escaped quotes `\"`
2. **Rename dotted fields** — `room.name` breaks Vega (interpreted as nested path); use ES|QL `RENAME room.name AS room`
3. **Don't set width/height** — use `autosize: { type: fit, contains: padding }`
4. **Set labelLimit on axes** — horizontal bar chart labels truncate; use `axis: { "labelLimit": 150 }`
5. **Sort bars by value** — pre-sort in ES|QL with `SORT field DESC` and use `sort: null` in encoding (preserves data
   order); avoid `sort: "-x"` in layered specs (bar + text labels) as it causes "conflicting sort properties" warnings
6. **Time axis: no rotated labels** — use `axis: { "labelAngle": 0, "tickCount": 8 }`, let Vega auto-format dates
7. **Descriptive titles replace axis titles** — good title/subtitle makes axis titles redundant; use `title: null` on
   axes
8. **Use color sparingly** — color is a precious visual attribute; use a single default color (`#6092C0`) for bar charts
   where position already encodes value; reserve color encoding for categorical distinction (e.g., multiple lines in a
   time series)
9. **Dark theme compatibility** — always include config to avoid bright white borders:

   ```json
   "config": {
     "axis": { "domainColor": "#444", "tickColor": "#444" },
     "view": { "stroke": null }
   }
   ```

## CLI Commands

```bash
# Dashboards
node scripts/kibana-vega.js dashboards list [search]
node scripts/kibana-vega.js dashboards get <id>
node scripts/kibana-vega.js dashboards create <title>
node scripts/kibana-vega.js dashboards delete <id>
node scripts/kibana-vega.js dashboards add-panel <dash-id> <vis-id> [--x N] [--y N] [--w N] [--h N]
node scripts/kibana-vega.js dashboards apply-layout <dash-id> <file|->

# Visualizations (use - for stdin instead of file)
node scripts/kibana-vega.js visualizations list [vega]
node scripts/kibana-vega.js visualizations get <id>
node scripts/kibana-vega.js visualizations create <title> <file|->
node scripts/kibana-vega.js visualizations update <id> <file|->
node scripts/kibana-vega.js visualizations delete <id>
```

## Full Documentation

- [Dashboard Layout Reference](references/dashboard-layout-reference.md) — Grid system, layout patterns, design best
  practices
- [Vega-Lite Reference](references/vega-lite-reference.md) — Complete Vega-Lite grammar, chart patterns, best practices
- [ES|QL in Vega Reference](references/vega-esql-reference.md) — ES|QL data source configuration, time filtering,
  parameters
- [Example Specs](examples/) — Ready-to-use chart templates

## Common Issues

| Error                                  | Solution                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| "End of input while parsing an object" | Don't use HJSON `'''` triple-quotes; use JSON with single-line queries                               |
| Labels show "undefined"                | Rename dotted fields: `RENAME room.name AS room`                                                     |
| Bars invisible / not rendering         | Remove complex `scale.domain`, use simpler color schemes                                             |
| Y-axis labels truncated                | Add `axis: { "labelLimit": 150 }` to encoding                                                        |
| Panels stacked vertically              | Use `--x --y --w --h` options or `apply-layout` command                                              |
| "width/height ignored"                 | Remove dimensions, use `autosize`                                                                    |
| Bright white borders on dark theme     | Add `config: { "view": { "stroke": null }, "axis": { "domainColor": "#444", "tickColor": "#444" } }` |
| "401 Unauthorized"                     | Check KIBANA_USERNAME/PASSWORD                                                                       |
| "conflicting sort properties"          | Don't use `sort: "-x"` in layered specs; pre-sort in ES\|QL and use `sort: null`                     |
| "404 Not Found"                        | Verify dashboard/visualization ID                                                                    |
