# ES|QL PROMQL Command

Query time series indices using **Prometheus Query Language (PromQL)** as a source command in ES|QL. The `PROMQL`
command is the bridge for users who already know PromQL or are migrating Prometheus dashboards and alerts onto an
Elasticsearch backend, while still letting them post-process results with regular ES|QL pipes.

> **Version:** `PROMQL` is **GA** on Elastic Cloud Serverless and Elastic Stack **9.5+**, and a **preview** feature in
> **9.4**. The supported PromQL surface (functions, operators) differs between versions — see
> [Supported PromQL](#supported-promql). See [esql-version-history.md](esql-version-history.md) for version
> availability.

## Table of Contents

- [When to Use PROMQL](#when-to-use-promql)
- [Syntax](#syntax)
- [Options](#options)
- [Output Columns](#output-columns)
- [Implicit Range Selectors](#implicit-range-selectors)
- [Examples](#examples)
- [Post-Processing with ES|QL](#post-processing-with-esql)
- [PROMQL vs TS](#promql-vs-ts)
- [Supported PromQL](#supported-promql)
- [Kibana Time Filtering](#kibana-time-filtering)
- [Guidelines](#guidelines)
- [References](#references)

---

## When to Use PROMQL

Prefer `PROMQL` when **any** of the following apply:

- The user explicitly asks for a PromQL query, references Prometheus syntax (`sum by (instance) (...)`, label matchers
  like `{cluster="prod"}`, etc), or is migrating a Prometheus dashboard or alert.
- Compatibility with Prometheus tooling is required (Grafana panels, alerting rules, scripts that already speak PromQL).

Prefer the [`TS` command](time-series-queries.md) when:

- The user wrote ES|QL (or is asking in natural language without PromQL terms) and the query is naturally expressed in
  the inner/outer aggregation paradigm (`SUM(RATE(...))`, `AVG(AVG_OVER_TIME(...))`).
- The query mixes time series with non-time-series data sources or uses ES|QL features like `LOOKUP JOIN`,
  `CHANGE_POINT`, or `INLINE STATS` _before_ the metrics aggregation.

`PROMQL` and `TS` target the same TSDS indices — choose based on the syntax that best matches the user's intent.

---

## Syntax

```esql
PROMQL [ <option> ... ] [ <result_name> = ] ( <PromQL expression> )
```

- Zero or more `key=value` options, separated by spaces or newlines.
- A PromQL expression, optionally assigned a `<result_name>`. When named, the parentheses are **required**
  (`r=(sum(x))`; `r=sum(x)` fails with `Unknown parameter [r]`).
- The expression follows standard
  [Prometheus query language](https://prometheus.io/docs/prometheus/latest/querying/basics/) syntax (label matchers,
  range selectors, aggregations, binary operations). This skill does not re-document PromQL itself — write it as you
  would for Prometheus, within the [Supported PromQL](#supported-promql) surface.

Examples without `step`, `start`, or `end` are written for Kibana, where the date picker supplies the time range. For
direct `POST /_query` calls, add `step` or `start`/`end` (see [Options](#options)) — otherwise the query fails.

### Named result (recommended)

```esql
PROMQL http_rate=(sum by (instance) (rate(http_requests_total)))
```

The `<result_name>` is optional, but **always set one**. Without it, the metric column is named after the full PromQL
expression text (e.g. `sum by (instance) (rate(http_requests_total))`), which is long, brittle, and awkward to reference
in downstream `STATS`, `EVAL`, `SORT`, or `WHERE`. With a name, the column is simply `http_rate`.

### Unnamed result

```esql
PROMQL sum by (instance) (rate(http_requests_total))
```

Valid, but only use this for one-off exploration where the output is not post-processed.

---

## Options

The options mirror the Prometheus [HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/#range-queries)
with ES|QL-specific additions.

| Option            | Default     | Description                                                                                                                                   |
| ----------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `index`           | `metrics-*` | Indices, data streams, or aliases. Comma-separated lists and wildcards are supported.                                                         |
| `step`            | inferred    | Query resolution step width. Auto-derived from `buckets` and the time range when omitted.                                                     |
| `buckets`         | `100`       | Target bucket count for auto-step derivation. Mutually exclusive with `step`. Requires a time range (`start`/`end`, or Kibana's date picker). |
| `start`           | inferred    | Inclusive start of the time range. Falls back to Kibana's date picker, or unrestricted if missing.                                            |
| `end`             | inferred    | Inclusive end of the time range. Falls back to Kibana's date picker, or unrestricted if missing.                                              |
| `scrape_interval` | `1m`        | Expected metric collection interval. Used as the implicit range selector window: `max(step, scrape_interval)`.                                |

**`step` or a time range is required.** Provide either `step`, or both `start` and `end` (with the optional `buckets`).
Otherwise the query fails with
`unable to create a bucket; provide either [step] or all of [start], [end], and [buckets]`. In Kibana, the date picker
supplies `start`/`end`; for direct `POST /_query` calls you must set them (or `step`, which leaves the time range
unrestricted).

**Time format for `start` / `end`:** as in the Prometheus HTTP API, either a full ISO-8601 / RFC 3339 timestamp with a
time zone as a quoted string (`"2026-04-01T00:00:00Z"`) or a Unix timestamp in **seconds**, optionally fractional
(`1775001600`). Epoch **milliseconds** are misread as seconds and fail. Date-only strings, timestamps without a zone,
`NOW()` expressions, and date math like `"now-1h"` are rejected — compute absolute timestamps for relative ranges. Query
parameters also work (`start=?_tstart end=?_tend` with `"params": [{"_tstart": "..."}, {"_tend": "..."}]`).

**`step` vs `buckets`:** Pass at most one — combining them fails with
`Parameters [step] and [buckets] are mutually exclusive`. `step` fixes the resolution (`step=5m`); `buckets` lets the
engine pick a step that produces around N buckets across the time range (`buckets=50`).

---

## Output Columns

The result table has these columns:

| Column                                                     | Type      | Description                                                    |
| ---------------------------------------------------------- | --------- | -------------------------------------------------------------- |
| `<result_name>` (or the PromQL expression text if unnamed) | `double`  | The computed metric value                                      |
| `step`                                                     | `date`    | Timestamp for each evaluation step                             |
| Grouping labels (when `by (...)`)                          | `keyword` | One column per grouping label                                  |
| `_timeseries`                                              | `keyword` | JSON-encoded labels of each series when there is no `by (...)` |

When the PromQL expression includes a `by` aggregation like `sum by (instance) (...)`, each grouping label becomes its
own column (`instance:keyword`; dotted labels keep their name, e.g. `host.name`). In all other cases — no cross-series
aggregation, `without (...)`, or functions like `topk` that keep series identity — the labels of each series collapse
into a single `_timeseries` column as a JSON string, with dotted labels nested
(`{"cluster":"prod","host":{"name":"web-01"}}`). To filter, group, or join on a label downstream, aggregate with
`by (label)` so it becomes a real column.

Rows are **not** returned in time order. When presenting results as a table (e.g. answering a question directly), add
`| SORT step` (or `SORT step DESC`). Don't sort for Kibana visualizations — charts order by the `step` axis themselves,
so a `SORT` only adds work.

---

## Implicit Range Selectors

Standard PromQL requires range vector functions to specify a range selector: `rate(http_requests_total[5m])`. The
`PROMQL` command **allows omitting the range selector** entirely:

```esql
PROMQL scrape_interval=15s req_rate=(sum(rate(http_requests_total)))
```

When the range selector is absent, the window is computed automatically as `max(step, scrape_interval)`. This is
particularly useful for Kibana dashboards where `step` is determined by the date picker and you want the range vector to
scale with it.

You can still pass an explicit range selector when you need a fixed window: `rate(http_requests_total[5m])`.

---

## Examples

### Fully adaptive query (recommended for Kibana)

Let Kibana's date picker drive the time range, and let `step` and the range selector be inferred:

```esql
PROMQL index=metrics-* http_rate=(sum by (instance) (rate(http_requests_total)))
```

The query responds to the date picker, adjusts the step size to the selected range, and sizes the implicit range
selector window accordingly. This is the recommended pattern for dashboard panels.

### Range query with explicit parameters

```esql
PROMQL index=k8s step=5m start="2024-05-10T00:20:00.000Z" end="2024-05-10T00:25:00.000Z" cost=(
  sum(avg_over_time(network.cost[5m]))
)
```

| cost:double | step:date                |
| ----------- | ------------------------ |
| 50.25       | 2024-05-10T00:20:00.000Z |

### Cross-series aggregation by label

```esql
PROMQL index=k8s step=1h cost=(sum by (cluster) (network.cost))
| SORT cost
```

| cost:double | step:date                | cluster:keyword |
| ----------- | ------------------------ | --------------- |
| 15.875      | 2024-05-10T00:00:00.000Z | staging         |
| 18.625      | 2024-05-10T00:00:00.000Z | prod            |
| 26.5        | 2024-05-10T00:00:00.000Z | qa              |

### Label filtering

```esql
PROMQL index=k8s step=1h bytes_in=(max by (cluster) (network.total_bytes_in{cluster!="prod"}))
| SORT cluster
```

| bytes_in:double | step:date                | cluster:keyword |
| --------------- | ------------------------ | --------------- |
| 10797.0         | 2024-05-10T00:00:00.000Z | qa              |
| 7403.0          | 2024-05-10T00:00:00.000Z | staging         |

### Ad-hoc query with inferred step

For queries outside Kibana, set `start` and `end` explicitly. The step and range selector window are still inferred from
the time range and the default `buckets` value:

```esql
PROMQL index=metrics-*
  start="2026-04-01T00:00:00Z"
  end="2026-04-01T01:00:00Z"
  http_rate=(sum by (instance) (rate(http_requests_total)))
```

### Bucket count instead of fixed step

```esql
PROMQL index=metrics-*
  buckets=50
  start="2026-04-01T00:00:00Z"
  end="2026-04-01T01:00:00Z"
  req_rate=(sum(rate(http_requests_total)))
```

---

## Post-Processing with ES|QL

Because `PROMQL` is a source command, its output flows into the rest of the pipeline. Use ES|QL commands after the
PROMQL stage for further aggregation, filtering, ordering, and enrichment. Reference the metric by its `<result_name>`:

```esql
PROMQL index=k8s step=1h bytes=(max by (cluster) (network.bytes_in))
| STATS max_bytes = MAX(bytes) BY cluster
| SORT cluster
```

| max_bytes:double | cluster:keyword |
| ---------------- | --------------- |
| 931.0            | prod            |
| 972.0            | qa              |
| 238.0            | staging         |

### Enrich with LOOKUP JOIN

Join PromQL results with a lookup index using a grouping label as the join key:

```esql
PROMQL index=metrics-*
  http_rate=(sum by (instance) (rate(http_requests_total)))
| LOOKUP JOIN instance_metadata ON instance
```

The join key must be a `by (...)` label — labels inside `_timeseries` are not addressable as columns.

This pattern combines PromQL's expressiveness for time series math with ES|QL's strengths for joining external metadata,
filtering, and shaping output.

---

## PROMQL vs TS

| Aspect              | `PROMQL`                                    | `TS`                                               |
| ------------------- | ------------------------------------------- | -------------------------------------------------- |
| Syntax              | Prometheus Query Language                   | ES\|QL inner/outer aggregation                     |
| Default index       | `metrics-*`                                 | None — caller must specify                         |
| Time filtering      | `start`/`end` options or Kibana date picker | `WHERE TRANGE(...)` or `WHERE @timestamp ...`      |
| Bucketing           | `step` / `buckets` options                  | `BY TBUCKET(interval)`                             |
| Range vector window | Implicit (`max(step, scrape_interval)`)     | Bucket interval, or sliding window arg (9.3+)      |
| Counter aggregation | `sum(rate(metric))`                         | `STATS SUM(RATE(metric)) BY TBUCKET(...)`          |
| Gauge aggregation   | `avg_over_time(metric[5m])`                 | `STATS AVG(AVG_OVER_TIME(metric)) BY TBUCKET(...)` |
| Label filtering     | `metric{cluster="prod"}`                    | `WHERE cluster == "prod"`                          |
| Availability        | 9.4 (preview), GA in 9.5                    | 9.2 (preview), GA in 9.4                           |

Both commands target TSDS indices and can be followed by the same set of ES|QL processing commands (`WHERE`, `EVAL`,
`STATS`, `SORT`, `LIMIT`, `LOOKUP JOIN`, etc.).

---

## Supported PromQL

Elasticsearch does not yet implement every PromQL function, operator, and vector-matching modifier, and coverage grows
with each release (and continuously on Serverless). **Do not rely on a memorized list of what is or isn't supported.**
Instead:

1. **Write the query in standard PromQL** as you would for Prometheus.
2. **Run it.** Unsupported constructs are rejected with a `400` `verification_exception` that names the construct — for
   example `Function [predict_linear] is not yet implemented`, `set operator [and] is not supported at this time`, or
   `Unknown PromQL function [...]`.
3. **On such an error**, check the current reference for the construct, noting per-version availability against the
   cluster version:
   - [PromQL functions](https://www.elastic.co/docs/reference/query-languages/promql/functions)
   - [PromQL operators](https://www.elastic.co/docs/reference/query-languages/promql/operators)
4. **Tell the user** which construct is not supported on their deployment, rather than silently rewriting the query into
   something with different semantics.

Behavioral differences from Prometheus that apply regardless of version:

- **Time bucket alignment differs.** Buckets align to fixed calendar boundaries rather than the query start time. This
  can cause slight differences from native Prometheus, especially for short ranges or large step sizes.
- **Index defaults to `metrics-*`.** If your TSDS data lives elsewhere, always set `index` explicitly to avoid scanning
  unrelated indices.
- **Unknown metric or label names are not errors.** As in Prometheus, a selector that matches nothing returns an empty
  result. If a query returns no rows, verify the metric names first (e.g. `TS <index> | METRICS_INFO`, see
  [time-series-queries.md](time-series-queries.md#metric-and-time-series-discovery)) rather than assuming no data.

---

## Kibana Time Filtering

When writing `PROMQL` queries for Kibana (Discover, dashboards, alerts), **do not set `start` and `end` manually**.
Kibana injects the date picker's range automatically and the engine derives `step` from it. Setting `start`/`end`
explicitly overrides the date picker.

```esql
// Kibana — let the date picker drive start/end and step
PROMQL index=metrics-* http_rate=(sum by (instance) (rate(http_requests_total)))
```

For ad-hoc queries outside Kibana (direct `POST /_query`), set `start` and `end` explicitly — without them (and without
`step`) the query fails.

---

## Guidelines

- **Prefer `PROMQL` only when the user explicitly thinks in PromQL** or is porting a Prometheus query/dashboard.
  Otherwise, prefer `TS` — it integrates more naturally with the rest of ES|QL.
- **Always name the result** (`http_rate=(...)`). The default column name is the full expression text, which is hard to
  reference in downstream ES|QL commands.
- **Always set `index`** in production queries instead of relying on the `metrics-*` default — narrower patterns reduce
  scan volume and prevent accidental matches against unrelated indices.
- **Omit range selectors for adaptive dashboards.** Implicit range selectors (`rate(http_requests_total)` without
  `[5m]`) make the query scale with the date picker.
- **Pick `step` or `buckets`, not both.** Use `buckets` when you want a target panel resolution; use `step` when you
  need a fixed grain (e.g., to align with downstream aggregation). Outside Kibana, pass `start`/`end` as absolute
  ISO-8601 timestamps or Unix epoch seconds (see [Options](#options)).
- **`SORT step` only for tabular answers.** Output rows are unordered; sort when showing rows to the user, but skip it
  for Kibana visualizations.
- **Treat unsupported-construct errors as a lookup trigger**, not a guess trigger — see
  [Supported PromQL](#supported-promql).
- **Do not mix `WHERE @timestamp` filters with `start`/`end`.** Time filtering belongs in the PROMQL options or via
  Kibana's date picker; standard ES|QL `WHERE` clauses run _after_ the PromQL stage and don't bound the metric scan.

---

## References

- [ES|QL PROMQL command](https://www.elastic.co/docs/reference/query-languages/esql/commands/promql) — official
  documentation
- [PromQL in Elasticsearch](https://www.elastic.co/docs/reference/query-languages/promql) — overview, differences from
  Prometheus
- [PromQL functions](https://www.elastic.co/docs/reference/query-languages/promql/functions) — supported functions and
  per-version availability
- [PromQL operators](https://www.elastic.co/docs/reference/query-languages/promql/operators) — supported operators and
  vector-matching modifiers
- [Prometheus Query Language](https://prometheus.io/docs/prometheus/latest/querying/basics/) — PromQL fundamentals
- [Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/#range-queries) — origin of the option
  semantics
- [Time series data streams (TSDS)](https://www.elastic.co/docs/manage-data/data-store/data-streams/time-series-data-stream-tsds)
- [time-series-queries.md](time-series-queries.md) — `TS` command and ES|QL native time series functions
- [esql-version-history.md](esql-version-history.md) — feature availability by Elasticsearch version
