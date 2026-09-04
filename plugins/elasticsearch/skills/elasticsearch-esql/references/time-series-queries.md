# ES|QL Time Series Queries

Query metrics data in Elasticsearch using the `TS` source command and time series aggregation functions. Requires
Elasticsearch 9.2+.

> **Status:** `TS`, **all** time series aggregation functions (the 9.2-introduced set — `RATE`, `IRATE`, `INCREASE`,
> `DELTA`, `IDELTA`, `AVG_OVER_TIME`, `SUM_OVER_TIME`, `MIN_OVER_TIME`, `MAX_OVER_TIME`, `FIRST_OVER_TIME`,
> `LAST_OVER_TIME`, `COUNT_OVER_TIME`, `COUNT_DISTINCT_OVER_TIME`, `PRESENT_OVER_TIME`, `ABSENT_OVER_TIME` — and the
> 9.3-introduced set — `DERIV`, `PERCENTILE_OVER_TIME`, `STDDEV_OVER_TIME`, `VARIANCE_OVER_TIME`), the `TBUCKET`
> grouping function, the new `WITHOUT(...)` grouping function, and the new `METRICS_INFO` and `TS_INFO` discovery
> commands are **GA since 9.4** (preview from 9.2 to 9.3 for the 9.2/9.3 features; new in 9.4 for `WITHOUT`,
> `METRICS_INFO`, and `TS_INFO`). `TRANGE` remains in preview. **Looking for PromQL?** Elasticsearch 9.4+ also exposes a
> `PROMQL` source command for running Prometheus Query Language directly against TSDS indices. See
> [promql-command.md](promql-command.md). Prefer `PROMQL` only when the user explicitly thinks in PromQL or is migrating
> Prometheus dashboards/alerts; otherwise prefer `TS` and the inner/outer aggregation paradigm described below.

## Table of Contents

- [TS Source Command](#ts-source-command)
- [Inner/Outer Aggregation Paradigm](#innerouter-aggregation-paradigm)
- [Histogram Metrics](#histogram-metrics)
- [Time Series Aggregation Functions](#time-series-aggregation-functions)
- [TBUCKET Grouping Function](#tbucket-grouping-function)
- [WITHOUT Grouping Function](#without-grouping-function)
- [Metric and Time Series Discovery](#metric-and-time-series-discovery)
- [TRANGE Time Filter](#trange-time-filter)
- [CLAMP Functions](#clamp-functions)
- [Kibana Time Filtering](#kibana-time-filtering)
- [Common Query Patterns](#common-query-patterns)
- [Guidelines](#guidelines)
- [References](#references)

---

## TS Source Command

`TS` replaces `FROM` when querying
[time series data streams (TSDS)](https://www.elastic.co/docs/manage-data/data-store/data-streams/time-series-data-stream-tsds).
It enables time series aggregation functions (`RATE`, `AVG_OVER_TIME`, etc.) inside `STATS`.

**Availability:** Preview from 9.2 to 9.3, **GA since 9.4**. GA on Elastic Cloud Serverless.

**Syntax:**

```esql
TS index_pattern [METADATA fields]
```

**Key differences from `FROM`:**

- Targets only TSDS indices (`index.mode: time_series`)
- Enables inner/outer aggregation paradigm in `STATS`
- Cannot combine with `FORK` before `STATS` is applied
- Optimized for processing time series data; `FROM` may produce unexpected results on TSDS indices
- When there is **no** `STATS` command in the query, `TS` returns rows sorted by `@timestamp` descending by default —
  useful for listing recent values across many time series.

**Best practices:**

- Always use `TS` (not `FROM`) for aggregations on time series indices
- Add a time range filter with `TRANGE` to limit scan volume
- Avoid aggregating multiple metrics with different dimensional cardinalities in the same query

---

## Inner/Outer Aggregation Paradigm

The first `STATS` after a `TS` command uses a two-level aggregation model:

1. **Inner function** (time series aggregation) -- evaluated per individual time series (e.g. `RATE`, `AVG_OVER_TIME`)
2. **Outer function** (standard aggregation) -- aggregates inner results across groups (e.g. `SUM`, `AVG`, `MAX`)

```esql
TS metrics
| STATS SUM(RATE(search_requests)) BY TBUCKET(1 hour), host
//     ^^^  ^^^^                       inner: RATE per time series
//     outer: SUM across time series sharing the same host + bucket
```

A single host can map to multiple underlying time series. The outer `SUM` combines the per-time-series rates into one
value per host per bucket. Use `SUM` as the outer function for counters (rates are additive). Use `AVG` or `MAX` for
gauges depending on intent.

If the inner function is omitted, the default inner aggregation depends on the field type:

- **Numeric and gauge fields** — `LAST_OVER_TIME()` is assumed implicitly.
- **`exponential_histogram` and `tdigest` fields** — distributions are **merged** across the time window (not
  `LAST_OVER_TIME`). Use standard aggregations like `SUM`, `AVG`, and `PERCENTILE` directly.
- **Plain `histogram` fields** — can't be directly processed; cast with `::exponential_histogram` (or `::tdigest`) first
  — see [Histogram Metrics](#histogram-metrics).

```esql
// Gauge — equivalent queries
TS metrics | STATS AVG(memory_usage)
TS metrics | STATS AVG(LAST_OVER_TIME(memory_usage))

// exponential_histogram / tdigest — merge + standard aggregation (no cast)
TS metrics-tsds | STATS SUM(jvm.gc.duration) BY TBUCKET(1 hour)

// plain histogram — cast required
TS metrics-tsds | STATS SUM(jvm.gc.duration::exponential_histogram) BY TBUCKET(1 hour)
```

**When to use `*_OVER_TIME` vs plain aggregations for gauges:** For simple gauge queries (average CPU, max memory),
prefer `AVG(cpu)` over `AVG(AVG_OVER_TIME(cpu))` — the implicit `LAST_OVER_TIME` is sufficient and produces cleaner
queries. Use explicit `*_OVER_TIME` only when you need a specific window behavior: `AVG_OVER_TIME` to average all
samples (not just the last), `MIN_OVER_TIME`/`MAX_OVER_TIME` to find extremes within each time series before
aggregating, or `DELTA`/`DERIV` to compute changes. When in doubt, omit the inner function. For histogram fields, do not
use `*_OVER_TIME` — see [Histogram Metrics](#histogram-metrics).

Since 9.3 (preview), use a time series function directly without an outer aggregation to get one value per time series
per bucket. The result is implicitly grouped by all dimensions of each time series and includes a `_timeseries` column
with the dimension key/value pairs — see [WITHOUT Grouping Function](#without-grouping-function) for narrowing this
grouping (`BY WITHOUT(dim, ...)`, GA since 9.4).

```esql
TS metrics
| WHERE TRANGE(1 day)
| STATS RATE(search_requests) BY TBUCKET(1 hour)
```

Nesting two time series functions is **not allowed** and causes an error:

```esql
// INVALID -- nested time series functions
TS metrics | STATS AVG_OVER_TIME(RATE(memory_usage))
```

---

## Histogram Metrics

Distribution metrics use field types `histogram`, `exponential_histogram`, or `tdigest` (not plain numeric
`gauge`/`counter`). OpenTelemetry is a common source — OTLP often stores `exponential_histogram`; other ingestion paths
may store plain `histogram` or `tdigest`. For a candidate metric, use `METRICS_INFO` (9.4+) for `metric_name`,
`data_stream`, `field_type`, and `metric_type` — not mappings or field caps. The same metric name can appear on multiple
streams with different `field_type` values. See [METRICS_INFO](#metrics_info).

For `exponential_histogram` and `tdigest`, the default inner aggregation is **histogram merge** (it is an internal ES|QL
aggregation which cannot be referenced manually in queries) — use `SUM` / `AVG` / `COUNT` / `MIN` / `MAX` / `MEDIAN` /
`PERCENTILE` directly. Plain `histogram` is **not** merged automatically; cast first (see below). Do **not** use
`*_OVER_TIME` (plain `histogram` rejects it; `exponential_histogram` may accept it — still the wrong shape). Asking for
“average over time” or “avg duration” means `AVG(field)`, not `AVG_OVER_TIME`.

**When to cast:** `TS` merge accepts `exponential_histogram` or `tdigest`, not plain `histogram`. Decide from
`METRICS_INFO` (or a type error):

| `METRICS_INFO.field_type` for the streams you query                      | Cast?                                   |
| ------------------------------------------------------------------------ | --------------------------------------- |
| only `exponential_histogram` or only `tdigest`                           | Omit the cast                           |
| any plain `histogram` (alone **or** mixed with other distribution types) | Required: `::exponential_histogram`     |
| type / incompatible-types / ambiguities error mentioning `histogram`     | Add `::exponential_histogram` and retry |

Always cast when plain `histogram` is in play — including mixed streams. If the targeted streams are unambiguously
`exponential_histogram` or `tdigest`, no cast is needed. Default required cast is `::exponential_histogram` (converts
plain `histogram`; no-op for `exponential_histogram`). Use `::tdigest` instead when you know the metric actually stores
T-Digest data (for example, when values in a plain `histogram` field are mid-points rather than bucket boundaries — that
causes less precision loss).

```esql
// WRONG — *_OVER_TIME is the wrong shape (even if it succeeds)
TS metrics-* | STATS SUM(SUM_OVER_TIME(jvm.gc.duration)) BY TBUCKET(1 hour)

// CORRECT — pure exponential_histogram or tdigest on the stream from METRICS_INFO: no cast
TS metrics-tsds
| WHERE TRANGE(1 hour)
| STATS count = COUNT(jvm.gc.duration),
        avg = AVG(jvm.gc.duration),
        p99 = PERCENTILE(jvm.gc.duration, 99)
  BY jvm.gc.action, TBUCKET(5 minutes)

// CORRECT — plain histogram present or mixed streams: cast
TS metrics-*
| STATS SUM(jvm.gc.duration::exponential_histogram) BY TBUCKET(1 hour), service.name
```

`SUM` totals the values the histograms were originally created from; `COUNT` counts the number of values the histograms
were created from — it does _not_ count the number of histograms; use `PERCENTILE`/`MEDIAN`/`AVG` for latency. Prefer
the histogram metric from `METRICS_INFO` over a companion `*.summary` / `aggregate_metric_double` in `schema` unless the
user asks for it. Do not fall back to `*_OVER_TIME` or `TO_STRING`/`REPLACE` JSON parsing. For OTel ingestion
background, see [OTel histogram metrics in ES\|QL](https://www.elastic.co/search-labs/blog/otel-histogram-metrics-esql).

**Availability:** Histogram metric querying in `TS` is preview in 9.3 and **GA since 9.4** (same as
`exponential_histogram` / `tdigest` field types).

---

## Time Series Aggregation Functions

All functions below are available under `TS ... | STATS`. Each accepts a required field argument and an optional sliding
window (`time_duration`, 9.3+). The window must be a multiple of the `TBUCKET` interval. If omitted, the bucket interval
is used as the window.

### Counter Functions

For fields with `time_series_metric: counter` (`counter_double`, `counter_integer`, `counter_long`).

| Function   | Description                                                            | Since         | Status   |
| ---------- | ---------------------------------------------------------------------- | ------------- | -------- |
| `RATE`     | Per-second average rate of increase; handles counter resets            | 9.2 (preview) | GA (9.4) |
| `IRATE`    | Per-second rate between the last two data points; responsive to spikes | 9.2 (preview) | GA (9.4) |
| `INCREASE` | Absolute increase of the counter in the time window; handles resets    | 9.2 (preview) | GA (9.4) |

```esql
// Average rate per host per hour
// host is a dimension of the TSDS index metrics
TS metrics
| WHERE TRANGE(1 hour)
| STATS SUM(RATE(search_requests)) BY TBUCKET(1 hour), host

// Instant rate (last two points only) per cluster and 10 minutes
// k8s is an example of a TSDS index, to showcase that time series indexes do not have to be called metrics
// cluster is a dimension of the TSDS index k8s
TS k8s
| STATS SUM(IRATE(network.total_bytes_in)) BY cluster, TBUCKET(10 minute)

// Total counter increase
TS k8s
| STATS SUM(INCREASE(network.total_bytes_in)) BY cluster, TBUCKET(10 minute)
```

### Gauge / Numeric Functions

For gauge metrics and general numeric fields (`double`, `integer`, `long`, `aggregate_metric_double`).

| Function                   | Description                                                       | Since         | Status   |
| -------------------------- | ----------------------------------------------------------------- | ------------- | -------- |
| `AVG_OVER_TIME`            | Average value over the time window                                | 9.2 (preview) | GA (9.4) |
| `SUM_OVER_TIME`            | Sum of values over the time window                                | 9.2 (preview) | GA (9.4) |
| `MIN_OVER_TIME`            | Minimum value over the time window                                | 9.2 (preview) | GA (9.4) |
| `MAX_OVER_TIME`            | Maximum value over the time window                                | 9.2 (preview) | GA (9.4) |
| `FIRST_OVER_TIME`          | Earliest value by `@timestamp`                                    | 9.2 (preview) | GA (9.4) |
| `LAST_OVER_TIME`           | Latest value by `@timestamp` (implicit default for numeric/gauge) | 9.2 (preview) | GA (9.4) |
| `COUNT_OVER_TIME`          | Count of values over the time window                              | 9.2 (preview) | GA (9.4) |
| `COUNT_DISTINCT_OVER_TIME` | Count of distinct values over the time window                     | 9.2 (preview) | GA (9.4) |
| `PERCENTILE_OVER_TIME`     | Percentile of values; takes `(field, percentile)`                 | 9.3 (preview) | GA (9.4) |
| `STDDEV_OVER_TIME`         | Population standard deviation over the time window                | 9.3 (preview) | GA (9.4) |
| `VARIANCE_OVER_TIME`       | Population variance over the time window                          | 9.3 (preview) | GA (9.4) |
| `DELTA`                    | Absolute change of a gauge in the time window                     | 9.2 (preview) | GA (9.4) |
| `IDELTA`                   | Change between the last two data points only                      | 9.2 (preview) | GA (9.4) |
| `DERIV`                    | Derivative over time using linear regression                      | 9.3 (preview) | GA (9.4) |

```esql
// Average memory per cluster per 5 minutes (plain form — implicit LAST_OVER_TIME is sufficient for gauges)
// cluster is a dimension of the TSDS index metrics
TS metrics
| WHERE TRANGE(1 day)
| STATS AVG(memory_usage) BY cluster, TBUCKET(5 minute)

// P95 network cost per cluster per minute
// k8s is an example of a TSDS index, to showcase that time series indexes do not have to be called metrics
// cluster is a dimension of the TSDS index k8s
TS k8s
| STATS MAX(PERCENTILE_OVER_TIME(network.cost, 95)) BY cluster, TBUCKET(1 minute)

// Gauge delta (absolute change in bytes)
TS k8s
| STATS SUM(DELTA(network.bytes_in)) BY cluster, TBUCKET(10 minute)

// Derivative of cost per pod over time
// pod is a dimension of the TSDS index k8s
TS k8s
| STATS MAX(DERIV(network.cost)) BY pod, TBUCKET(5 minute)
```

### Presence / Absence Functions

Detect whether a field has data in a given time window. Return `boolean`.

| Function            | Description                                     | Since         | Status   |
| ------------------- | ----------------------------------------------- | ------------- | -------- |
| `PRESENT_OVER_TIME` | `true` if field has values in the window        | 9.2 (preview) | GA (9.4) |
| `ABSENT_OVER_TIME`  | `true` if field has **no** values in the window | 9.2 (preview) | GA (9.4) |

```esql
// Detect pods with missing data
TS k8s
| STATS missing = MAX(ABSENT_OVER_TIME(events_received)) BY pod, TBUCKET(2 minute)
```

### Sliding Window

Pass a `time_duration` as the second argument to any time series function to use a sliding window for the
per-time-series aggregation. The window is orthogonal to time bucketing of output results (`TBUCKET`). If the window is
omitted, the `TBUCKET` interval is used implicitly.

```esql
// Average rate per host over a 10-minute sliding window, bucketed by 1 minute
// host is a dimension of the TSDS index metrics
TS metrics
| WHERE TRANGE(1 hour)
| STATS AVG(RATE(requests, 10m)) BY TBUCKET(1m), host
```

**Version behavior:**

- **9.2-9.3 (preview):** the window must be a **multiple of the `TBUCKET` interval** in the `BY` clause (for example,
  with `TBUCKET(1m)` you may use `1m`, `2m`, `10m`; `7m` is rejected). If no window is specified, the `TBUCKET` interval
  is used implicitly.
- **9.4+ (GA):** all window values are accepted, with performance optimizations when the window is a multiple of the
  `TBUCKET` interval. **Restriction:** within a single query you cannot mix windows that are **smaller** than the bucket
  interval for one metric with windows that are **larger** than the bucket interval for another metric.

---

## TBUCKET Grouping Function

Creates time buckets from `@timestamp`. Use in the `BY` clause of `STATS` for time-based grouping.

**Syntax:**

```esql
STATS ... BY bucket = TBUCKET(interval)
STATS ... BY TBUCKET(interval)
```

The interval is a time duration (`1 hour`, `5 minute`, `30s`) or date period (`1 month`). A string representation
(`"1 hour"`) also works.

`TBUCKET` is the preferred bucketing function for `TS` queries. It has a simpler signature than
`DATE_TRUNC(interval, @timestamp)` and is aware of time series semantics.

**Availability:** Preview from 9.2 to 9.3, **GA since 9.4**.

Always assign a column alias to `TBUCKET` so it can be referenced in `SORT`:

```esql
// 1-hour buckets — alias enables SORT
TS metrics
| STATS rate = SUM(RATE(requests)) BY bucket = TBUCKET(1 hour), host
| SORT bucket, host

// 5-minute buckets (plain form for gauge)
TS metrics
| STATS avg_cpu = AVG(cpu_percent) BY bucket = TBUCKET(5 minute), service
| SORT bucket
```

---

## WITHOUT Grouping Function

When the first `STATS` after `TS` uses a **bare** time series aggregation function (one not wrapped in an outer
aggregation such as `AVG()` or `SUM()`), rows are implicitly grouped by **all** dimensions of each time series. The
output includes a `_timeseries` `keyword` column containing a JSON-encoded object with the dimension key/value pairs
identifying each group. Only the dimensions that actually exist for a given time series appear in `_timeseries` — not
every dimension declared in the index mappings — so different rows in the result may carry different dimension keys.

`WITHOUT(...)` lets you make this grouping explicit, or narrow it to a subset of dimensions:

- `BY WITHOUT(dim1, dim2, ...)` groups by **all** dimensions **except** those listed.
- `BY WITHOUT()` (no arguments) explicitly groups by every dimension; it is equivalent to the implicit "group by all"
  behavior.

When combining a bare time series function with other groupings, **only grouping functions** (`TBUCKET`, `WITHOUT`) are
allowed in the `BY` clause — bare dimension columns are rejected. For example:

```esql
// INVALID -- bare time series function with a bare dimension column in BY
TS k8s | STATS rate(network.total_bytes_in) BY host
```

Use `BY TBUCKET(...)` and/or `BY WITHOUT(...)`, or wrap the time series function with an outer aggregation.

**Availability:** **GA since 9.4**. Can only be used in the **first** `STATS` command under a `TS` source — using it in
a `FROM | STATS ... BY WITHOUT(...)` query is rejected.

**Examples:**

```esql
// Group by every dimension implicitly — _timeseries column carries the dimension labels
TS k8s
| STATS avg = AVG_OVER_TIME(network.cost)
| SORT avg DESC

// Group by every dimension EXCEPT pod
TS k8s
| STATS total_cost = SUM(network.cost) BY WITHOUT(pod)
| SORT total_cost

// Combine WITHOUT with TBUCKET to add a time bucket to the surviving dimensions
TS k8s
| STATS total_cost = SUM(network.cost) BY WITHOUT(pod), tbucket = TBUCKET(1 hour)
| SORT total_cost

// Equivalent to implicit grouping (group by all dimensions)
TS k8s
| STATS avg = AVG_OVER_TIME(network.cost) BY WITHOUT()
```

---

## Metric and Time Series Discovery

Two processing commands introduced in 9.4 expose the metric catalogue of a TSDS so you can discover what to query
without inspecting index mappings or calling the field capabilities API. Both must follow a `TS` source command and must
appear before pipeline-breaking commands (`STATS`, `SORT`, `LIMIT`).

| Command        | Granularity                           | Status       | Adds beyond `METRICS_INFO`                                       |
| -------------- | ------------------------------------- | ------------ | ---------------------------------------------------------------- |
| `METRICS_INFO` | One row per **metric**                | GA since 9.4 | —                                                                |
| `TS_INFO`      | One row per **(metric, time series)** | GA since 9.4 | `dimensions` JSON column with the labels identifying each series |

### METRICS_INFO

Returns one row per distinct metric in the targeted TSDS, with applicable dimensions and metadata. Useful for "what
metrics exist in this stream?" and "what dimensions apply to metric X?".

**Output columns** (all `keyword`):

- `metric_name` — single-valued
- `data_stream` — multi-valued when several streams align on unit/metric_type/field_type
- `unit` — declared unit; may be `null` or multi-valued
- `metric_type` — `counter`, `gauge`, or `histogram`
- `field_type` — Elasticsearch field type (`long`, `double`, `histogram`, `exponential_histogram`, `tdigest`, …)
- `dimension_fields` — union of dimension field names across the series for the metric

Always scope discovery with `TRANGE` (or another time filter) before `METRICS_INFO` / `TS_INFO` so the catalogue is
built from a bounded scan, not the full index history. Examples below omit `TRANGE` for brevity — add
`| WHERE TRANGE(15m)` (or another range) after `TS` in real queries.

```esql
// List every metric, alphabetically
TS k8s
| METRICS_INFO
| SORT metric_name

// Restrict to metrics that have data matching a filter
TS k8s
| WHERE cluster == "prod"
| METRICS_INFO
| SORT metric_name

// Filter by metric type, count by it
TS k8s
| METRICS_INFO
| STATS metric_count = COUNT(*) BY metric_type
| SORT metric_type

// Check field_type for a candidate metric (histogram vs numeric)
TS k8s
| METRICS_INFO
| WHERE metric_name == "jvm.gc.duration"
| KEEP metric_name, data_stream, field_type, metric_type

// Find metrics whose name matches a pattern
TS k8s
| METRICS_INFO
| WHERE metric_name LIKE "network.eth0*"
| SORT metric_name
```

### TS_INFO

Returns one row per (metric, time series) combination, including the dimension key/value pairs that identify each
series. Useful for "which time series report this metric?" and "what label combinations exist?".

`TS_INFO` includes **all `METRICS_INFO` columns** plus a `dimensions` column — a JSON-encoded object such as
`{"job":"elasticsearch","instance":"instance_1"}` (single-valued).

```esql
// Every (metric, time series) pair in the data stream
TS k8s
| TS_INFO
| SORT metric_name, dimensions

// Filter the underlying series before discovery
TS k8s
| WHERE cluster == "prod"
| TS_INFO
| KEEP metric_name, dimensions
| SORT metric_name, dimensions

// Filter by metadata after TS_INFO (gauges only)
TS k8s
| TS_INFO
| WHERE metric_type == "gauge"
| SORT metric_name, dimensions

// Count distinct time series per metric
TS k8s
| TS_INFO
| STATS series_count = COUNT(*) BY metric_name
| SORT metric_name

// Count distinct metrics per time series — spot under- or over-reporting series
TS k8s
| TS_INFO
| STATS metric_count = COUNT_DISTINCT(metric_name) BY dimensions
| SORT dimensions
```

### Guidelines

- **Use these for TSDS schema discovery** before writing `RATE`/`AVG_OVER_TIME` queries — they replace the older
  workflow of inspecting `_settings`, `_mapping`, or field capabilities for time series indices.
- **Reach for `METRICS_INFO` first** to enumerate metrics; reach for `TS_INFO` only when you need the exact dimension
  combinations (label sets) of individual series.
- **Always time-filter before discovery** with `WHERE TRANGE(...)` (and optional dimension filters) so `METRICS_INFO` /
  `TS_INFO` do not scan the full index history.
- **The output replaces the original table.** Anything you `STATS` / `SORT` / `LIMIT` afterwards operates on metadata
  rows, not raw documents — there's no way to re-attach the data points after `METRICS_INFO` or `TS_INFO`.
- **Both commands are TSDS-only.** `FROM | METRICS_INFO` and `FROM | TS_INFO` are rejected.

---

## TRANGE Time Filter

Filter data by time range using `@timestamp`. Prefer `TRANGE` over manual `WHERE @timestamp > NOW() - ...` filters.

**Syntax:**

```esql
// Offset from now (last N time units)
WHERE TRANGE(offset)

// Explicit start and end
WHERE TRANGE(start, end)
```

**Examples:**

```esql
// Last hour
TS metrics
| WHERE TRANGE(1 hour)
| STATS SUM(RATE(requests)) BY TBUCKET(1 minute), host

// Explicit time range
TS metrics
| WHERE TRANGE("2024-05-10T00:00:00Z", "2024-05-10T01:00:00Z")
| STATS SUM(RATE(requests)) BY TBUCKET(5 minute), host

// Epoch milliseconds
// k8s is an example of a TSDS index, to showcase that time series indexes do not have to be called metrics
FROM k8s
| WHERE TRANGE(1715300236000, 1715300282000)
```

**Supported parameter types:** `time_duration`, `date_period`, `date`, `date_nanos`, `keyword` (date string), `long`
(epoch millis).

**Availability:** Preview since 9.3.

---

## CLAMP Functions

Bound metric values to a range. Useful for capping outliers or enforcing value limits in time series analysis.

| Function    | Description                                         | Syntax                   |
| ----------- | --------------------------------------------------- | ------------------------ |
| `CLAMP`     | Clamp values to `[min, max]` range                  | `CLAMP(field, min, max)` |
| `CLAMP_MIN` | Set a lower bound; values below `min` become `min`  | `CLAMP_MIN(field, min)`  |
| `CLAMP_MAX` | Set an upper bound; values above `max` become `max` | `CLAMP_MAX(field, max)`  |

**Availability:** Preview since 9.3.

```esql
// Clamp network cost between 1 and 10
TS k8s
| EVAL clamped_cost = CLAMP(network.cost, 1, 10)
| STATS SUM(clamped_cost) BY TBUCKET(1 minute)

// Aggregate with clamped values
TS k8s
| STATS total = SUM(CLAMP_MAX(network.cost, 1)) BY TBUCKET(1 minute)
```

---

## Kibana Time Filtering

When writing ES|QL queries for Kibana (Discover, dashboards, alerting), **do not add manual time range filters**. Kibana
automatically applies `@timestamp` filtering based on the date picker.

Write Kibana queries without time filters:

```esql
// Kibana query -- no time filter needed
TS metrics
| STATS SUM(RATE(search_requests)) BY TBUCKET(1 hour), host
```

Use explicit time filters (`TRANGE` or `WHERE @timestamp`) only for:

- Direct API queries (`POST /_query`) run outside Kibana

---

## Common Query Patterns

### Rate of a Counter per Host per Hour

```esql
TS metrics
| WHERE TRANGE(1 hour)
| STATS SUM(RATE(search_requests)) BY TBUCKET(1 hour), host
```

### Total Rate per Host (No Time Bucketing)

```esql
TS metrics
| WHERE TRANGE(1 hour)
| STATS SUM(RATE(search_requests)) BY host
```

### Average Gauge per Cluster Over Time

```esql
// Plain form — preferred for gauge metrics
TS metrics
| WHERE TRANGE(1 day)
| STATS AVG(memory_usage) BY TBUCKET(5 minute), cluster
```

### Per-Time-Series Averages vs Global Average

```esql
// Average of last values per time series (default — preferred for most gauge queries)
TS metrics | STATS AVG(memory_usage)

// Average of ALL samples per time series (use AVG_OVER_TIME only when you need this distinction)
TS metrics | STATS AVG(AVG_OVER_TIME(memory_usage))
```

### Detect Missing Data

```esql
// k8s is an example of a TSDS index, to showcase that time series indexes do not have to be called metrics
// pod is a dimension of the TSDS index k8s
TS k8s
| WHERE TRANGE(1 hour)
| STATS missing = MAX(ABSENT_OVER_TIME(events_received)) BY pod, TBUCKET(2 minute)
```

### Counter Increase Totals

```esql
TS k8s
| WHERE TRANGE(1 hour)
| STATS SUM(INCREASE(network.total_bytes_in)) BY cluster, TBUCKET(10 minute)
```

### Instant Rate (Last Two Points)

```esql
TS k8s
| WHERE TRANGE(1 hour)
| STATS SUM(IRATE(network.total_bytes_in)) BY cluster, TBUCKET(10 minute)
```

### Sliding Window Rate

```esql
TS metrics
| WHERE TRANGE(1 hour)
| STATS AVG(RATE(requests, 10m)) BY TBUCKET(1m), host
```

In 9.2-9.3 the window must be a multiple of the `TBUCKET` interval. In 9.4+ any window value is accepted (mixing windows
smaller and larger than the bucket interval for different metrics in the same query is not supported).

---

## Guidelines

- **Use `TS` for all aggregations on TSDS indices.** `FROM` is still available for listing raw documents, but use `TS`
  for metrics aggregations.
- **Use `SUM` as the outer function for counters.** Rates and increases are additive across time series that share a
  dimension (e.g. host). Use `AVG` or `MAX` for gauges.
- **Always add a time range filter** with `TRANGE` (or `WHERE @timestamp`) to limit scan volume, except in Kibana where
  the date picker handles this automatically. Don't add a range filter if the user explicitly asks not to add it.
- **Version requirements:**
  - `TS`, `TBUCKET`, `WITHOUT`, `METRICS_INFO`, `TS_INFO`, and **all** time series aggregation functions (the
    9.2-introduced set — `RATE`, `IRATE`, `INCREASE`, `DELTA`, `IDELTA`, all `*_OVER_TIME` from 9.2,
    `PRESENT_OVER_TIME`, `ABSENT_OVER_TIME` — and the 9.3-introduced set — `DERIV`, `PERCENTILE_OVER_TIME`,
    `STDDEV_OVER_TIME`, `VARIANCE_OVER_TIME`): **GA since 9.4** (preview from 9.2-9.3 for the 9.2/9.3 functions; new in
    9.4 for `WITHOUT`, `METRICS_INFO`, `TS_INFO`).
  - `TRANGE`: 9.3+ (preview).
  - Sliding window parameter (second argument to time series functions): introduced in 9.2-9.3 (preview, restricted to
    multiples of the `TBUCKET` interval); **GA in 9.4** with arbitrary durations.
  - `CLAMP`, `CLAMP_MIN`, `CLAMP_MAX`: 9.3+ (preview).
- **Do not nest time series functions.** `AVG_OVER_TIME(RATE(field))` is invalid. Use a standard aggregation as the
  outer function.
- **Avoid mixing metrics with different dimensions** in one query. If `foo` and `bar` have different dimension values,
  `SUM(RATE(foo)) + SUM(RATE(bar))` may produce nulls for mismatched dimensions.
- **For histogram / exponential_histogram metrics**, use standard aggregations (no `*_OVER_TIME`); cast with
  `::exponential_histogram` when plain `histogram` is present, types are mixed, or a type error occurs — see
  [Histogram Metrics](#histogram-metrics).

## References

- [ES|QL TS Command](https://www.elastic.co/docs/reference/query-languages/esql/commands/ts)
- [ES|QL PROMQL Command](https://www.elastic.co/docs/reference/query-languages/esql/commands/promql) — alternative
  source command using PromQL syntax (9.4+ preview)
- [promql-command.md](promql-command.md) — PROMQL command reference in this skill
- [Time Series Aggregation Functions](https://www.elastic.co/docs/reference/query-languages/esql/functions-operators/time-series-aggregation-functions)
- [TBUCKET Function](https://www.elastic.co/docs/reference/query-languages/esql/functions-operators/grouping-functions/tbucket)
- [TRANGE Function](https://www.elastic.co/docs/reference/query-languages/esql/functions-operators/date-time-functions/trange)
- [Time Series Data Streams (TSDS)](https://www.elastic.co/docs/manage-data/data-store/data-streams/time-series-data-stream-tsds)
- [OTel histogram metrics in ES\|QL](https://www.elastic.co/search-labs/blog/otel-histogram-metrics-esql) — common
  ingestion path for exponential histograms, casts, and query patterns
