# ES|QL Query Approximation (Approximate STATS)

Approximate `STATS` aggregations using random sampling and extrapolation. Enabling approximation makes ES|QL rewrite the
query to sample rows and extrapolate, returning estimates together with confidence intervals and a certification flag
instead of exact results. Use it when the user runs heavy `STATS` summaries over large datasets and approximate results
with known error bounds are acceptable in exchange for dramatically faster execution.

> **Version:** Approximation is **GA on Elastic Cloud Serverless and Elastic Stack 9.5+**. It was introduced as a
> preview in Elastic Stack 9.4. It is controlled by the `approximation` setting of the
> [`SET` directive](esql-reference.md#query-directives) (preview since 9.3). See
> [esql-version-history.md](esql-version-history.md) for version availability.

Approximation breaks the dependency between performance and dataset size: accuracy depends mainly on the data and the
query, not on how many rows are in the source index, so the speed advantage grows as the data grows.

## Table of Contents

- [Enabling Approximation](#enabling-approximation)
- [Understanding the Output](#understanding-the-output)
- [Configuration Options](#configuration-options)
- [Supported Aggregation Functions](#supported-aggregation-functions)
- [Unsupported Query Patterns](#unsupported-query-patterns)
- [When Approximation Is Less Effective](#when-approximation-is-less-effective)
- [Exact Execution via Index Summary Statistics](#exact-execution-via-index-summary-statistics)
- [Using SAMPLE Directly](#using-sample-directly)
- [Guidelines](#guidelines)
- [Summary](#summary)
- [References](#references)

---

## Enabling Approximation

Prepend `SET approximation=true;` to an existing `STATS` query. No other change to the query is required — the rewrite
(sampling, extrapolation, confidence interval computation) is automatic.

```esql
SET approximation=true;
FROM web_traffic
| WHERE @timestamp >= NOW() - 1 week
| STATS total_hits = COUNT(),
        avg_load_time = AVG(page_load_ms)
  BY country_code
| SORT total_hits DESC
| LIMIT 5
```

## Understanding the Output

An approximate query returns the same columns as the exact query, plus **two extra columns for each estimated
quantity**:

- `_approximation_confidence_interval(<col>)` — the central **90%** confidence interval for the estimate: an interval
  that has a 0.9 probability of containing the true value.
- `_approximation_certified(<col>)` — a boolean. When `true`, the statistical assumptions behind the interval hold and
  the confidence interval is trustworthy. When `false`, the estimate may still be accurate, but the distribution could
  not be confirmed to satisfy those assumptions — treat the interval with caution.

For example, a query computing `total_hits = COUNT()` and `avg_load_time = AVG(page_load_ms)` `BY country_code` returns
the `total_hits`, `avg_load_time`, and `country_code` columns plus `_approximation_confidence_interval(total_hits)`,
`_approximation_certified(total_hits)`, `_approximation_confidence_interval(avg_load_time)`, and
`_approximation_certified(avg_load_time)`.

## Configuration Options

The defaults work well for most queries. Tune them by passing a map value to `approximation` instead of `true`.

Map entries:

- `rows` (integer) — number of sampled rows used to approximate the query. Must be **at least 10,000**. `null` uses the
  system default. Defaults: **1,000,000** rows for grouped `STATS` (queries with a `BY` clause) and **100,000** rows
  otherwise.
- `confidence_level` (double) — confidence level of the computed intervals. Default **0.90**. `null` **disables**
  confidence interval (and certification) computation, which can yield an additional speedup.

### Disabling confidence intervals

Skip interval and certification computation when only point estimates are needed:

```esql
SET approximation={"confidence_level":null};
FROM web_traffic
| WHERE @timestamp >= NOW() - 1 day
| STATS total_bytes = SUM(response_bytes),
        avg_load_time = AVG(page_load_ms)
  BY datacenter_region
| SORT total_bytes DESC
| LIMIT 10
```

### Controlling the sample size

Increase `rows` when results are too imprecise — particularly for high-cardinality grouping. Larger samples improve
accuracy at the cost of reduced speedup; as long as the sample stays well below the total row count, there is still a
performance benefit.

```esql
SET approximation={"rows":5000000};
FROM web_traffic
| WHERE @timestamp >= NOW() - 1 week
| STATS total_hits = COUNT(*),
        avg_load_time = AVG(page_load_ms)
  BY url_path
| SORT total_hits DESC
| LIMIT 25
```

Both options can be combined: `SET approximation={"rows":2000000,"confidence_level":0.95};`.

## Supported Aggregation Functions

Approximation applies to aggregation functions where sampling and extrapolation produce statistically sound estimates
(for example `COUNT`, `COUNT(*)`, `SUM`, `AVG`, `MEDIAN`, `PERCENTILE`).

The following aggregation functions are **not supported** and cause the query to **fall back to exact execution**:

`COUNT_DISTINCT`, `MIN`, `MAX`, `FIRST`, `LAST`, `TOP`, `ABSENT`, `PRESENT`, `ST_CENTROID_AGG`, `ST_EXTENT_AGG`.

Some of these (e.g. `MIN`, `MAX`) are intrinsically hard to estimate reliably from a sample without strong
distributional assumptions, so they are excluded to avoid accidental misuse. For `COUNT_DISTINCT` and similar, use the
[`SAMPLE` command](#using-sample-directly) instead.

## Unsupported Query Patterns

These patterns are not supported for approximation and fall back to exact execution:

- Queries using the `TS` or `PROMQL` source command.
- Pipelines containing **two or more `STATS` commands**.

The `FORK`, `LOOKUP JOIN`, and `INLINE STATS` processing commands **are** supported since version 9.5.

## When Approximation Is Less Effective

Approximation works best on large, broad `STATS` queries. Two patterns reduce or eliminate the benefit:

### Highly selective filters

If a `WHERE` clause matches only a small fraction of the data, the data is already small and sampling adds little. ES|QL
detects this during the rewrite and falls back to exact execution — but the rewrite itself adds overhead. If you know in
advance the query matches very few rows, run it **without** approximation.

### High-cardinality grouping

When the `BY` expression has very high cardinality, individual groups may receive very few sampled rows. This can cause:

- Groups with **fewer than 10 samples** being dropped entirely from results.
- Large estimation errors for retained groups.
- No results at all if the grouping field is unique per document.

Sorting by ascending count (finding the rarest groups) is especially problematic, since heavy hitters may require
sampling most of the dataset. If accuracy for high-cardinality queries matters, increase `rows`. As a rule of thumb, aim
for at least a few hundred samples per group.

## Exact Execution via Index Summary Statistics

Some aggregations can be computed directly from summary statistics maintained in the index (for example, a simple
`COUNT(*)` over an indexed numeric field with no grouping). The planner detects these cases and runs them exactly, since
they are already fast. No action is needed — when this happens, the confidence intervals have **zero length**,
indicating the results are exact.

## Using SAMPLE Directly

For full control, or for aggregations not supported by automatic approximation (such as `COUNT_DISTINCT`), use the
[`SAMPLE` command](esql-reference.md#sample). It gives raw sampled data with **no** automatic extrapolation or
confidence interval computation — interpreting the result and accounting for sampling bias is your responsibility.

```esql
// Distinct count over ~1% of the data (COUNT_DISTINCT is not supported by automatic approximation)
FROM web_traffic
| SAMPLE 0.01
| STATS unique_visitors = COUNT_DISTINCT(client_ip)

// Frequency profile over a sample; adjust the probability to observe convergence
FROM web_traffic
| SAMPLE 0.01
| STATS c = COUNT(*) BY search_phrase
```

## Guidelines

1. **Use approximation when**: the user runs a large `STATS` summary, exact values are not strictly required, and faster
   results are desirable. The benefit grows with dataset size.
2. **Do not use approximation when**: the query is highly selective (matches few rows), needs exact results, or uses an
   unsupported function or query pattern (it will silently fall back to exact, adding only rewrite overhead).
3. **Always surface the error bounds**: when reporting approximate results, include or mention the
   `_approximation_confidence_interval(...)` values and check `_approximation_certified(...)`. Do not present
   approximate estimates as exact figures.
4. **Zero-length intervals mean exact**: a confidence interval of zero length indicates the planner executed the query
   exactly from index summary statistics.
5. **Disable intervals for max speed**: when only point estimates are needed, set `confidence_level` to `null`.
6. **Tune `rows` for high-cardinality grouping**: increase the sample size (minimum 10,000; default 1,000,000 grouped /
   100,000 ungrouped) until groups have at least a few hundred samples each.
7. **Reach for `SAMPLE`** when an unsupported function like `COUNT_DISTINCT` is required.

## Summary

| Aspect                          | Detail                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Enable approximation            | `SET approximation=true;`                                                                                       |
| Disable confidence intervals    | `SET approximation={"confidence_level":null};`                                                                  |
| Custom sample size              | `SET approximation={"rows":N};` (`N` ≥ 10,000)                                                                  |
| Default sample size (grouped)   | 1,000,000 rows                                                                                                  |
| Default sample size (ungrouped) | 100,000 rows                                                                                                    |
| Confidence interval default     | Central 90% interval (`confidence_level` 0.90)                                                                  |
| Minimum samples per group       | 10 (groups below this are dropped)                                                                              |
| Added output columns            | `_approximation_confidence_interval(col)`, `_approximation_certified(col)`                                      |
| Unsupported functions           | `COUNT_DISTINCT`, `MIN`, `MAX`, `FIRST`, `LAST`, `TOP`, `ABSENT`, `PRESENT`, `ST_CENTROID_AGG`, `ST_EXTENT_AGG` |
| Falls back to exact             | `TS`/`PROMQL` source; 2+ `STATS` commands; highly selective filters                                             |

## References

- [Approximate STATS queries](https://www.elastic.co/docs/reference/query-languages/esql/esql-query-approximation)
- [ES|QL SET directive — `approximation`](https://www.elastic.co/docs/reference/query-languages/esql/commands/set#esql-approximation)
