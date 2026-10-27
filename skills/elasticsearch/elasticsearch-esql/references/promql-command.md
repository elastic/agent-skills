# ES|QL PROMQL Command

Query time series indices using **Prometheus Query Language (PromQL)** as a source command in ES|QL. The `PROMQL`
command is the bridge for users who already know PromQL or are migrating Prometheus dashboards and alerts onto an
Elasticsearch backend, while still letting them post-process results with regular ES|QL pipes.

## Table of Contents

- From the Elasticsearch docs:
  - [Syntax](#syntax)
  - [Options](#options)
  - [Time range](#time-range)
  - [Output columns](#output-columns)
  - [Index patterns](#index-patterns)
  - [Implicit range selectors](#implicit-range-selectors)
  - [Time range durations](#time-range-durations)
  - [Best practices](#best-practices)
  - [Limitations](#limitations)
  - [Examples](#examples)
- Skill guidance:
  - [When to Use PROMQL](#when-to-use-promql)
  - [Running PROMQL Queries](#running-promql-queries)
  - [Handling Unsupported Constructs](#handling-unsupported-constructs)
    - [Stack 9.4 and 9.5 fallbacks](#stack-94-and-95-fallbacks)
  - [Kibana Charts](#kibana-charts)
  - [Guidelines](#guidelines)
  - [References](#references)

<!--
Everything between begin-docs and end-docs mirrors the PROMQL command page of the Elasticsearch docs
(https://www.elastic.co/docs/reference/query-languages/esql/commands/promql). Don't edit it here: change the docs
instead, then copy the page again. Version badges are kept, shortened to the notation used in this skill: bare
versions refer to the Elastic Stack, generally available is implied, and other lifecycles are spelled out, such as
`(9.5+; Serverless)` or `(9.4 only, preview)`. Everything after end-docs is specific to this skill.
-->

<!-- begin-docs: esql/commands/promql -->

**Availability:** 9.5+, preview in 9.4; Serverless

The `PROMQL` source command queries
[time series indices](https://www.elastic.co/docs/manage-data/data-store/data-streams/time-series-data-stream-tsds)
using [**Prometheus Query Language (PromQL)**](https://prometheus.io/docs/prometheus/latest/querying/basics/). Like
[`TS`](https://www.elastic.co/docs/reference/query-languages/esql/commands/ts), it enables time series aggregation
functions, but accepts PromQL syntax instead of ES|QL.

> **Note**
>
> `PROMQL` supports most, but not all, of PromQL. Refer to [Limitations](#limitations) for unsupported constructs, to
> [PromQL limitations](https://www.elastic.co/docs/reference/query-languages/promql/promql-limitations) for behavioral
> differences from Prometheus, and to
> [PromQL functions](https://www.elastic.co/docs/reference/query-languages/promql/functions) for the supported functions
> and their restrictions.

## Syntax

The `PROMQL` command accepts zero or more space-separated `<option>=<value>` pairs, followed by a PromQL expression in
parentheses that can be prefixed with a result name.

```esql
PROMQL [ <option>=<value> ... ] [ <result_name>= ](<PromQL Expression>)
```

## Options

The options are inspired by the Prometheus
[HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/#range-queries) with some additions specific to
ES|QL.

- `index`: A list of indices, data streams, or aliases. Supports wildcards and date math. Defaults to `metrics-*`
  querying matching indices with
  [`index.mode: time_series`](https://www.elastic.co/docs/manage-data/data-store/data-streams/time-series-data-stream-tsds).
  Example: `PROMQL index=metrics-*.otel-* http_rate=(sum(rate(http_requests_total)))`
- `step`: Query resolution step width (optional). Automatically determined given the number of target `buckets` and the
  selected time range. Example: `PROMQL step=1m http_rate=(sum(rate(http_requests_total)))`
- `buckets`: Target number of buckets for auto-step derivation. Defaults to `100`. Mutually exclusive with `step`.
  Requires a known time range, either by setting `start` and `end` explicitly or implicitly through Kibana's time range
  filter. Example:
  `PROMQL buckets=50 start="2026-04-01T00:00:00Z" end="2026-04-01T01:00:00Z" http_rate=(sum(rate(http_requests_total)))`
- `start`: Start time of the query, inclusive (optional). Uses the start based on Kibana's date picker if missing. Set
  together with `end`. Refer to [Time range](#time-range) for queries without a time range. Example:
  `PROMQL start="2026-04-01T00:00:00Z" end="2026-04-01T01:00:00Z" http_rate=(sum(rate(http_requests_total)))`
- `end`: End time of the query, inclusive (optional). Uses the end based on Kibana's date picker if missing. Set
  together with `start`, and not before it. Refer to [Time range](#time-range) for queries without a time range.
  Example: `PROMQL start="2026-04-01T00:00:00Z" end="2026-04-01T02:00:00Z" http_rate=(sum(rate(http_requests_total)))`
- `time`: (9.5+; Serverless) Evaluation time of an instant query (optional). Evaluates the expression once, at this
  time, instead of at each step of a range query. Mutually exclusive with `start`, `end`, `step`, and `buckets`.
  Example: `PROMQL time="2026-04-01T01:00:00Z" http_rate=(sum(rate(http_requests_total)))`
- `scrape_interval`: The expected metric collection interval. Defaults to `1m`. Used to determine implicit range
  selector windows as `max(step, scrape_interval)`. Example:
  `PROMQL scrape_interval=15s http_rate=(sum(rate(http_requests_total)))`
- `<result_name>=(<PromQL Expression>)`: Name of the output column with the query result timeseries (optional). By
  default, the name of the output column is the PromQL expression itself. Example:
  `PROMQL http_rate=(sum by (instance) (rate(http_requests_total))) | SORT http_rate DESC`

`start`, `end`, and `time` accept an RFC 3339 timestamp with a UTC offset, such as `"2026-04-01T00:00:00Z"`, or a Unix
timestamp in seconds, which can be fractional, such as `1775001600`. Date math, such as `now-1h`, isn't supported. In
Kibana, the `?_tstart` and `?_tend` parameters reference the time range of the date picker, such as `time=?_tend`.
`step` and `scrape_interval` accept a PromQL duration, such as `30s` or `5m`, or a number of seconds.

## Description

The `PROMQL` command takes standard PromQL parameters and a PromQL expression, runs the query, and returns the results
as regular ES|QL columns. You can continue to process the columns with other ES|QL commands.

### Time range

A range query needs either `step`, or both `start` and `end`, from which the step is derived using `buckets`. In Kibana,
the date picker provides `start` and `end`. Without a time range and without `step`, the query fails. With `step` but no
time range, the query covers all data in the index.

### Output columns

The result contains the following columns:

| Column                                                  | Type      | Description                                                                       |
| ------------------------------------------------------- | --------- | --------------------------------------------------------------------------------- |
| The PromQL expression (or `<result_name>` if specified) | `double`  | The computed metric value                                                         |
| `step`                                                  | `date`    | The timestamp for each evaluation step. For an instant query, the evaluation time |
| Grouping labels (if any)                                | `keyword` | One column per grouping label from `by` clauses                                   |
| `_timeseries` (if any)                                  | `keyword` | The labels of each series as a JSON string                                        |

The label columns depend on the outermost aggregation of the PromQL expression:

- With a `by` grouping, such as `sum by (instance) (...)`, each grouping label gets its own output column.
- With an aggregation without grouping, such as `sum(...)`, there are no label columns, and the result is a single
  series.
- Without a cross-series aggregation, such as `rate(http_requests_total)`, or with a `without` grouping, such as
  `sum without (pod) (...)`, the remaining labels of each series are returned in a single `_timeseries` column as a JSON
  string.

A range query returns one row per series and evaluation step. An instant query returns one row per series.

### Index patterns

The `index` parameter accepts the same patterns as `FROM` and `TS`, including wildcards and comma-separated lists. If
omitted, it defaults to `metrics-*`, which queries matching indices configured with
[`index.mode: time_series`](https://www.elastic.co/docs/manage-data/data-store/data-streams/time-series-data-stream-tsds).
The Prometheus-compatible `query` and `query_range` endpoints use the same default when the `{index}` path parameter is
omitted.

### Implicit range selectors

In standard PromQL, functions like `rate` require a range selector: `rate(http_requests_total[5m])`. The `PROMQL`
command allows omitting the range selector entirely. When the range selector is absent, the window is determined
automatically as `max(step, scrape_interval)`. For example:
`PROMQL scrape_interval=15s http_rate=(sum(rate(http_requests_total)))`. An implicit window adapts to the time range and
step. A fixed window doesn't: when it's shorter than the step, such as `[5m]` with a step of `1h`, each step only
reflects the last 5 minutes and ignores the samples in between. A fixed window is only useful when you need exactly that
window, such as the rate over the last 5 minutes.

### Time range durations

(Serverless) A duration, such as in a range selector, can be the difference of two RFC 3339 timestamp parameters. For
example, `[?_tend - ?_tstart]` spans the time range of the date picker in Kibana.

## Best practices

- Set `index` explicitly instead of relying on the `metrics-*` default, to narrow the data scanned.
- Omit range selectors, also when porting a Prometheus query: write `rate(http_requests_total)` instead of
  `rate(http_requests_total[5m])`, so the window adapts to the time range and step. Refer to
  [Implicit range selectors](#implicit-range-selectors). The exception is a value over the whole time range. Refer to
  [Single-value results](#single-value-results).
- Name the result, such as `http_rate=(...)`. Otherwise, the value column is named after the expression text, which
  changes whenever the expression is reformatted, so later commands can't reliably reference it.
- Match the function to the metric type: use `rate`, `irate`, or `increase` for counters, and functions such as
  `avg_over_time` or `max_over_time`, or the raw metric, for gauges. For native histograms, use `increase` instead of
  `rate`, and wrap the result in a histogram function, such as
  `histogram_quantile(0.99, sum by (job) (increase(http_request_duration_seconds)))`.
- In Kibana, omit `start` and `end` so the query follows the date picker. Elsewhere, set `start` and `end` explicitly,
  rather than only `step`, which covers all data in the index.
- Filter by labels in the PromQL selector, such as `network.cost{cluster!="prod"}`, rather than with `WHERE` after
  `PROMQL`. Selector filters reduce the data read, and a later `WHERE` doesn't.

### Single-value results

A range query returns a value for every step. To get a single value per series, such as for a metric or gauge chart or a
ranking, use an [instant query](#instant-query). In Kibana, set `time=?_tend` to evaluate the expression at the end of
the time range of the date picker (refer to
[time range parameters](https://www.elastic.co/docs/explore-analyze/query-filter/languages/esql-kibana)).

- For the current value, such as the current request rate, omit the range selector:

  ```esql
  PROMQL index=metrics-generic.prometheus-* time=?_tend http_rate=(sum(rate(http_requests_total)))
  ```

- For a value over the whole time range, such as the total number of requests, use a range selector that spans the time
  range, `[?_tend - ?_tstart]` (Serverless):

  ```esql
  PROMQL index=metrics-generic.prometheus-* time=?_tend
    total_requests=(sum(increase(http_requests_total[?_tend - ?_tstart])))
  ```

  This is also how to port a Grafana query that uses the `$__range` variable, or its `$__range_s` and `$__range_ms`
  variants: replace the range selector, such as `[$__range]` or `[${__range_s}s]`, with `[?_tend - ?_tstart]`, and set
  `time=?_tend`. Refer to [Time range durations](#time-range-durations).

## Limitations

The majority of PromQL expressions run unchanged. The following constructs are not evaluated yet, so they return a
client error (4xx):

- Binary set operators: `and` and `unless`.
- (Serverless) Binary set operator `or`, except at the top level of an expression. A top-level `or` chain supports at
  most 8 operands by default (`esql.query.max_branch_count_per_merge`) and can't use `on(...)` or `ignoring(...)`. A
  nested `or`, a chain that exceeds that limit, or an `or` with `on(...)` or `ignoring(...)` returns a client error
  (4xx).
- (9.5 only) Binary set operator `or`, except at the top level of an expression. A top-level `or` chain supports at most
  8 operands and can't use `on(...)` or `ignoring(...)`. A nested `or`, a chain of more than 8 operands, or an `or` with
  `on(...)` or `ignoring(...)` returns a client error (4xx).
- Comparison operators: evaluated only at the top level of an expression and only with a scalar literal on the
  right-hand side. Comparisons between two instant vectors, and nested comparisons, return a client error (4xx).
- Group modifiers: `on(...)`, `ignoring(...)`, `group_left`, `group_right`.
- The `@` modifier.
- Subqueries, such as `max_over_time(rate(http_requests_total)[1h:])`.
- Selectors without a metric name, and regex matchers on `__name__`, such as `{__name__=~"node_.*"}`.
- Binary expressions with a `without(...)` aggregation as an operand, and `without(...)` aggregations nested inside
  another `without(...)` aggregation, such as `sum without (pod) (max without (container) (...))`. Use `by(...)`
  instead.
- (9.5+; Serverless) Binary expressions whose operands use different `offset` values, such as
  `rate(http_requests_total) / rate(http_requests_total offset 1h)`. This restriction doesn't apply to `or`.
- (9.5+; Serverless) Binary expressions where both operands read metrics and one of them nests an aggregation inside
  another aggregation, such as `count(count by (pod) (up)) / sum(machine_count)`. Nested aggregations on their own, such
  as `sum(sum by (pod) (...))`, are supported.
- (9.5+; Serverless) Binary expressions where both operands read metrics and the operands aren't aggregated alike. Both
  operands must be either not aggregated, such as `a / b`, or aggregated once across series, such as `sum(a) / sum(b)`.
  Mixing an aggregated and a non-aggregated operand (`sum(a) / b`), combining `scalar()` of a metric with an operand
  that has labels (`b / scalar(sum(a))`), and using `topk`, `bottomk`, `limitk`, or `limit_ratio` in an operand return a
  client error (4xx). Operations with a number, such as `topk(1, a) * 2`, are supported. This restriction doesn't apply
  to `or`.
- (9.5+; Serverless) `histogram_quantile` and `histogram_fraction` over `topk`, `bottomk`, `limitk`, `limit_ratio`, or a
  `without(...)` aggregation, unless the input is first aggregated with `by(...)`. For example,
  `histogram_quantile(0.9, topk(5, a))` returns a client error (4xx), but
  `histogram_quantile(0.9, topk(5, sum by (job, le) (a)))` is supported.
- Functions: refer to
  [Not yet supported](https://www.elastic.co/docs/reference/query-languages/promql/functions#promql-not-supported) for
  the full list of recognized but unimplemented functions. Some supported functions have restrictions, which are listed
  under **Differences from Prometheus** on each function's reference entry.
- (9.4 only, preview) Binary set operator `or`.
- (9.4 only, preview) The `offset` modifier.

The following constructs return no results instead of an error:

- Binary expressions between two operands that read different metrics without aggregating them, such as
  `node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes`. Unlike in Prometheus, the series of the two metrics
  aren't matched on their other labels. Aggregate both operands by the labels to keep instead, such as
  `avg by (instance) (node_memory_MemAvailable_bytes) / avg by (instance) (node_memory_MemTotal_bytes)`.

For behavioral differences from Prometheus, refer to
[PromQL limitations](https://www.elastic.co/docs/reference/query-languages/promql/promql-limitations).

## Examples

### Fully adaptive query

Rely on Kibana's date picker for the time range, and let `step` and range selectors be inferred automatically:

```esql
PROMQL index=metrics-generic.prometheus-* http_rate=(sum(rate(http_requests_total)))
```

This is the recommended pattern for Kibana dashboards. The query responds to the date picker, adjusts the step size to
the selected time range, and sizes the range selector window accordingly.

### Instant query

(9.5+; Serverless) Evaluate the expression once, for example to get the current value of a metric:

```esql
PROMQL index=metrics-generic.prometheus-*
  time="2026-04-01T01:00:00Z"
  http_rate=(sum(rate(http_requests_total)))
```

### Cross-series aggregation by label

```esql
PROMQL index=k8s step=1h result=(sum by (cluster) (network.cost))
| SORT result
```

| result:double | step:datetime            | cluster:keyword |
| ------------- | ------------------------ | --------------- |
| 15.875        | 2024-05-10T00:00:00.000Z | staging         |
| 18.625        | 2024-05-10T00:00:00.000Z | prod            |
| 26.5          | 2024-05-10T00:00:00.000Z | qa              |

### Label filtering with named result

```esql
PROMQL index=k8s step=1h cost=(max by (cluster) (network.total_bytes_in{cluster!="prod"}))
| SORT cluster
```

| cost:double | step:datetime            | cluster:keyword |
| ----------- | ------------------------ | --------------- |
| 10797.0     | 2024-05-10T00:00:00.000Z | qa              |
| 7403.0      | 2024-05-10T00:00:00.000Z | staging         |

### Post-processing with ES|QL

Pipe PromQL results into ES|QL commands for further aggregation:

```esql
PROMQL index=k8s step=1h bytes=(max by (cluster) (network.bytes_in))
| STATS max_bytes=MAX(bytes) BY cluster
| SORT cluster
```

| max_bytes:double | cluster:keyword |
| ---------------- | --------------- |
| 931.0            | prod            |
| 972.0            | qa              |
| 238.0            | staging         |

### Ad-hoc query with inferred step

For queries outside Kibana, set `start` and `end` explicitly. The step and range selector are still inferred
automatically from the time range and the default `buckets` count:

```esql
PROMQL index=metrics-generic.prometheus-*
  start="2026-04-01T00:00:00Z"
  end="2026-04-01T01:00:00Z"
  http_rate=(sum(rate(http_requests_total)))
```

### Enrich with a lookup

Join PromQL results with external data using ES|QL commands:

```esql
PROMQL index=metrics-generic.prometheus-*
  http_rate=(sum by (instance) (rate(http_requests_total)))
| LOOKUP JOIN instance_metadata ON instance
```

<!-- end-docs: esql/commands/promql -->

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

| Aspect              | `PROMQL`                                      | `TS`                                               |
| ------------------- | --------------------------------------------- | -------------------------------------------------- |
| Syntax              | Prometheus Query Language                     | ES\|QL inner/outer aggregation                     |
| Default index       | `metrics-*`                                   | None — caller must specify                         |
| Time filtering      | `start`/`end` options or Kibana date picker   | `WHERE TRANGE(...)` or `WHERE @timestamp ...`      |
| Bucketing           | `step` / `buckets`, or `time` (instant, 9.5+) | `BY TBUCKET(interval)`                             |
| Range vector window | Implicit (`max(step, scrape_interval)`)       | Bucket interval, or sliding window arg (9.3+)      |
| Counter aggregation | `sum(rate(metric))`                           | `STATS SUM(RATE(metric)) BY TBUCKET(...)`          |
| Gauge aggregation   | `avg_over_time(metric[5m])`                   | `STATS AVG(AVG_OVER_TIME(metric)) BY TBUCKET(...)` |
| Label filtering     | `metric{cluster="prod"}`                      | `WHERE cluster == "prod"`                          |
| Availability        | 9.4 (preview), GA in 9.5                      | 9.2 (preview), GA in 9.4                           |

Both commands target TSDS indices and can be followed by the same set of ES|QL processing commands.

---

## Running PROMQL Queries

<!-- Candidates for the Elasticsearch docs: once a fact is documented there, remove it here. -->

- **Rows are not returned in time order.** That's fine for Kibana charts, which order by `step` themselves.
- **`_timeseries` is opaque to later commands.** Functions that keep series identity, such as `topk`, also return
  `_timeseries`. Dotted labels are nested in its JSON (`{"host":{"name":"web-01"}}`). To use a label in `STATS`,
  `WHERE`, or `LOOKUP JOIN`, group by it with `by (...)`.
- **Unknown metric or label names are not errors.** As in Prometheus, a selector that matches nothing returns an empty
  result. If a query returns no rows, verify the metric names first (for example with `TS <index> | METRICS_INFO`, see
  [time-series-queries.md](time-series-queries.md#metric-and-time-series-discovery)) rather than assuming no data.

---

## Handling Unsupported Constructs

1. **Check [Limitations](#limitations) before writing the query**, and write everything else in standard PromQL.
2. **Run it.** Unsupported constructs are rejected with a `400` `verification_exception` that names the construct, for
   example `Function [predict_linear] is not yet implemented` or `set operator [and] is not supported at this time`.
   This is the reliable check for functions and for clusters on older versions.
3. **On such an error**, check the
   [PromQL functions](https://www.elastic.co/docs/reference/query-languages/promql/functions) and
   [PromQL operators](https://www.elastic.co/docs/reference/query-languages/promql/operators) references for the
   construct and its availability on the cluster version.
4. **Tell the user** which construct is not supported on their deployment, rather than silently rewriting the query into
   something with different semantics, and offer an equivalent `TS` query if there is one. To add labels from a lookup
   index instead of using group modifiers, use `LOOKUP JOIN` after `PROMQL`.

### Stack 9.4 and 9.5 fallbacks

- **`topk`, `bottomk`, `limitk`, `predict_linear`, `absent`, and `label_replace` are unavailable on Stack 9.4 and 9.5.**
  For top or bottom N series, drop the function and rank each step in ES|QL (`ASC` for `bottomk`); for the others, tell
  the user:

  ```esql
  PROMQL index=metrics-tsds step=5m start="2026-10-22T13:00:00Z" end="2026-10-22T15:00:00Z"
    r=(sum by (host) (rate(requests)))
  | SORT step, r DESC
  | LIMIT 2 BY step
  ```

- **9.4 has no working instant query** (`time=` fails with `unable to create a bucket`). For one value per series, run a
  range query with `step` equal to `end - start`, and `start` a multiple of `step`: steps snap to epoch-aligned
  boundaries, so an unaligned window returns two rows per series.

  ```esql
  PROMQL index=metrics-tsds step=2h start="2026-10-22T12:00:00Z" end="2026-10-22T14:00:00Z"
    r=(sum by (host) (rate(requests)))
  ```

---

## Kibana Charts

For time series charts, use the `PROMQL` command as is: it already returns one row per series and step, and the chart
uses `step` as its time axis. Since the output has no `@timestamp` column, do not add a `WHERE` time filter, `BUCKET`,
or `TBUCKET` after `PROMQL`. For metric and gauge charts or rankings, use an instant query (refer to
[single-value results](#single-value-results)).

---

## Guidelines

- **Prefer `PROMQL` only when the user thinks in PromQL** or is porting a Prometheus query or dashboard. Otherwise,
  prefer `TS`, which integrates more naturally with the rest of ES|QL.
- **For a relative time range outside Kibana, such as the last hour, compute absolute timestamps.** Pass Unix timestamps
  in seconds, not milliseconds.
- **Group only by the labels you break down by.** For one value overall, aggregate across all series without grouping,
  such as `sum(rate(http_requests_total))`, rather than grouping by a label first and then aggregating the groups again.
- **Write one expression per `PROMQL` command.** Combine values into one expression if they form a single value, such as
  `sum(rate(rx_bytes)) + sum(rate(tx_bytes))`. Otherwise, write one query per expression, and never silently drop one.

---

## References

- [ES|QL PROMQL command](https://www.elastic.co/docs/reference/query-languages/esql/commands/promql): official
  documentation, mirrored above
- [PromQL in Elasticsearch](https://www.elastic.co/docs/reference/query-languages/promql): overview, differences from
  Prometheus
- [PromQL functions](https://www.elastic.co/docs/reference/query-languages/promql/functions): supported functions and
  per-version availability
- [PromQL operators](https://www.elastic.co/docs/reference/query-languages/promql/operators): supported operators and
  vector-matching modifiers
- [Prometheus Query Language](https://prometheus.io/docs/prometheus/latest/querying/basics/): PromQL fundamentals
- [Time series data streams (TSDS)](https://www.elastic.co/docs/manage-data/data-store/data-streams/time-series-data-stream-tsds)
- [time-series-queries.md](time-series-queries.md): `TS` command and ES|QL native time series functions
- [esql-version-history.md](esql-version-history.md): feature availability by Elasticsearch version
