# Dashboard Layout Reference

This guide provides best practices for designing effective Kibana dashboard layouts.

## Kibana Grid System

Kibana dashboards use a **48-column grid** system:

- **Full width**: `w: 48`
- **Half width**: `w: 24`
- **Third width**: `w: 16`
- **Quarter width**: `w: 12`

**Height guidelines** (grid units):

- **Compact**: `h: 8-10` — KPIs, small bar charts (≤7 items)
- **Standard**: `h: 12-13` — Most charts, bar charts with labels
- **Tall**: `h: 15-18` — Complex charts, detailed timelines

## Above the Fold Design

**Critical principle**: The most important information must be visible without scrolling.

A typical screen at 1080p shows approximately **h: 28-32 grid units** above the fold (accounting for Kibana header,
filters bar, and panel margins). At 1440p, this extends to **h: 38-42**.

### Above the Fold Budget

| Resolution | Visible Height | Recommended Layout                        |
| ---------- | -------------- | ----------------------------------------- |
| 1080p      | ~30 units      | 2 rows: h:12 + h:12, or h:10 + h:10 + h:8 |
| 1440p      | ~40 units      | 3 rows: h:12 + h:12 + h:12                |
| 4K         | ~60 units      | 4+ rows comfortably                       |

### Design Strategy

1. **Primary panels above the fold**: Current state, key metrics, main trend
2. **Complementary panels below**: Detailed breakdowns, secondary trends, historical data
3. **Compact heights for bar charts**: Use `h: 10-12` instead of `h: 15` for charts with ≤10 items

## Dashboard Design Principles

### 1. Information Hierarchy

Place the most important information at the top-left where users look first:

```text
┌─────────────────────────────────────────────────────┐
│  KPIs / Summary Metrics (top row)                   │
├────────────────────────┬────────────────────────────┤
│  Primary Chart         │  Secondary Chart           │
│  (main insight)        │  (supporting data)         │
├────────────────────────┴────────────────────────────┤
│  Timeline / Trend Chart (full width)                │
├────────────────────────┬────────────────────────────┤
│  Detail Chart 1        │  Detail Chart 2            │
└────────────────────────┴────────────────────────────┘
```

### 2. Chart Type Placement Guidelines

| Chart Type             | Recommended Width | Recommended Height | Placement            |
| ---------------------- | ----------------- | ------------------ | -------------------- |
| KPI/Metric             | 12 (quarter)      | 8-10               | Top row              |
| Bar Chart (horizontal) | 24 (half)         | 15-20              | Side by side         |
| Bar Chart (vertical)   | 24-48             | 15-20              | Flexible             |
| Line/Area (timeline)   | 48 (full)         | 15-20              | Own row              |
| Pie/Donut              | 16-24             | 15-18              | Grouped with related |
| Heatmap                | 48 (full)         | 20-25              | Own row              |
| Table                  | 24-48             | 15-25              | Bottom section       |

### 3. Common Layout Patterns

#### Operational Dashboard (Monitoring)

Best for: System health, real-time monitoring, alerts

```text
┌──────────┬──────────┬──────────┬──────────┐
│  KPI 1   │  KPI 2   │  KPI 3   │  KPI 4   │  <- Status at a glance
├──────────┴──────────┴──────────┴──────────┤
│         Main Timeline (trends)            │  <- Primary metric over time
├───────────────────────┬───────────────────┤
│   Breakdown Chart 1   │  Breakdown Chart 2│  <- Drill-down by dimension
├───────────────────────┴───────────────────┤
│         Secondary Timeline                │  <- Supporting trends
└───────────────────────────────────────────┘
```

Grid coordinates:

- KPIs: `{x:0, y:0, w:12, h:8}`, `{x:12, y:0, w:12, h:8}`, `{x:24, y:0, w:12, h:8}`, `{x:36, y:0, w:12, h:8}`
- Main Timeline: `{x:0, y:8, w:48, h:15}`
- Breakdown 1: `{x:0, y:23, w:24, h:15}`
- Breakdown 2: `{x:24, y:23, w:24, h:15}`
- Secondary Timeline: `{x:0, y:38, w:48, h:15}`

#### Analytical Dashboard (Exploration)

Best for: Data analysis, comparisons, deep dives

```text
┌───────────────────────┬───────────────────┐
│                       │   Filter/Summary  │
│   Primary Analysis    ├───────────────────┤
│   (large chart)       │   Top-N List      │
├───────────────────────┴───────────────────┤
│            Comparison Chart               │
├───────────────────────┬───────────────────┤
│   Dimension A         │   Dimension B     │
└───────────────────────────────────────────┘
```

#### Executive Dashboard (Overview)

Best for: High-level summaries, stakeholder reports

```text
┌──────────┬──────────┬──────────┬──────────┐
│  KPI 1   │  KPI 2   │  KPI 3   │  KPI 4   │
├──────────┴──────────┼──────────┴──────────┤
│   Trend Chart 1     │    Trend Chart 2    │
├─────────────────────┴─────────────────────┤
│           Distribution / Breakdown        │
└───────────────────────────────────────────┘
```

## Smart Home Dashboard Example

For IoT/smart home data with temperature, humidity, and device activity:

### Compact Layout (Above the Fold)

Optimized for 1080p screens — all primary info visible without scrolling:

```text
┌───────────────────────┬───────────────────────┐  y:0
│  Avg Temp by Room     │  Avg Humidity by Room │  h:10 (compact bars)
│  (7 rooms)            │  (6 rooms)            │
├───────────────────────┴───────────────────────┤  y:10
│         Temperature Timeline                  │  h:12 (primary trend)
├───────────────────────┴───────────────────────┤  y:22
│         Humidity Timeline                     │  h:12 (below fold on 1080p)
├───────────────────────┬───────────────────────┤  y:34
│  Device Activity      │  (future: alerts)     │  h:10 (complementary)
└───────────────────────┴───────────────────────┘
```

**Above fold (y < 22-24)**: Bar charts + temperature timeline **Below fold**: Humidity timeline + device activity

Layout specification:

```json
[
  { "id": "temp-by-room", "x": 0, "y": 0, "w": 24, "h": 10 },
  { "id": "humidity-by-room", "x": 24, "y": 0, "w": 24, "h": 10 },
  { "id": "temp-timeline", "x": 0, "y": 10, "w": 48, "h": 12 },
  { "id": "humidity-timeline", "x": 0, "y": 22, "w": 48, "h": 12 },
  { "id": "device-activity", "x": 0, "y": 34, "w": 24, "h": 10 }
]
```

### Alternative: Three-Row Above Fold (1440p+)

For larger screens, fit more content above the fold:

```json
[
  { "id": "temp-by-room", "x": 0, "y": 0, "w": 24, "h": 12 },
  { "id": "humidity-by-room", "x": 24, "y": 0, "w": 24, "h": 12 },
  { "id": "temp-timeline", "x": 0, "y": 12, "w": 48, "h": 13 },
  { "id": "humidity-timeline", "x": 0, "y": 25, "w": 48, "h": 13 },
  { "id": "device-activity", "x": 0, "y": 38, "w": 24, "h": 10 }
]
```

## CLI Usage with Layout

### Method 1: Individual Panels with Position

```bash
# Add panels with explicit grid positions
node scripts/kibana-vega.js dashboards add-panel <dashboard-id> <vis-id> --x 0 --y 0 --w 24 --h 15
node scripts/kibana-vega.js dashboards add-panel <dashboard-id> <vis-id> --x 24 --y 0 --w 24 --h 15
```

### Method 2: Layout File

Create a layout file (`dashboard-layout.json`):

```json
{
  "title": "Smart Home Operations",
  "panels": [
    { "visualization": "temp-by-room-id", "x": 0, "y": 0, "w": 24, "h": 15 },
    { "visualization": "humidity-by-room-id", "x": 24, "y": 0, "w": 24, "h": 15 },
    { "visualization": "temp-timeline-id", "x": 0, "y": 15, "w": 48, "h": 15 },
    { "visualization": "humidity-timeline-id", "x": 0, "y": 30, "w": 48, "h": 15 },
    { "visualization": "device-activity-id", "x": 0, "y": 45, "w": 24, "h": 15 }
  ]
}
```

Then apply:

```bash
node scripts/kibana-vega.js dashboards apply-layout <dashboard-id> dashboard-layout.json
```

## Design Checklist

Before creating a dashboard, answer these questions:

1. **Who is the audience?** (Operators, analysts, executives)
2. **What's the primary question?** (Current status, trends, comparisons)
3. **What actions should it enable?** (Alerting, investigation, reporting)

Then follow this process:

1. **Sketch the layout** on paper or whiteboard first
2. **Identify chart types** for each data point
3. **Prioritize** - most important info top-left
4. **Group related charts** side-by-side for comparison
5. **Use full width** for timelines and trends
6. **Keep KPIs small** - they're glanceable summaries
7. **Leave room for growth** - dashboards evolve

## Panel Size Quick Reference

| Purpose             | Width | Height | Grid Config  | Notes                 |
| ------------------- | ----- | ------ | ------------ | --------------------- |
| KPI metric          | 12    | 6-8    | `w:12, h:7`  | Single number display |
| Compact bar chart   | 24    | 10     | `w:24, h:10` | ≤7 items, above fold  |
| Standard bar chart  | 24    | 12-13  | `w:24, h:12` | 8-12 items            |
| Tall bar chart      | 24    | 15     | `w:24, h:15` | 13+ items or detailed |
| Compact timeline    | 48    | 10-12  | `w:48, h:11` | Above fold priority   |
| Standard timeline   | 48    | 13-15  | `w:48, h:13` | Detailed view         |
| Large visualization | 48    | 18-20  | `w:48, h:18` | Heatmaps, detailed    |

### Above the Fold Cheat Sheet

For 1080p (~30 units visible):

- **2 rows**: `h:10 + h:12 = 22` ✓ fits with margin
- **2 rows**: `h:12 + h:12 = 24` ✓ fits tight
- **2 rows**: `h:15 + h:15 = 30` ✗ second row cut off

For 1440p (~40 units visible):

- **3 rows**: `h:12 + h:12 + h:12 = 36` ✓ fits comfortably
- **3 rows**: `h:13 + h:13 + h:13 = 39` ✓ fits tight
