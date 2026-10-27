# ES|QL Version History and Feature Availability

This document tracks ES|QL language features, commands, and functions across Elasticsearch versions. Use this to
determine compatibility when writing queries for specific Elasticsearch deployments.

> **Paired releases:** Certain minor versions shipped simultaneously with nearly identical feature sets. When a feature
> appears in one, assume it is in both unless explicitly noted otherwise. Paired versions: **8.18 / 9.0**, **8.19 /
> 9.1**.
>
> **Serverless:** Elastic Cloud Serverless reports a forward-moving `version.number` from `GET /` (aligned with the next
> minor from main), so clients that only semver-compare often behave as if the cluster is “latest.” **Do not** rely on
> that for feature gating: check `build_flavor` — if it is `"serverless"`, all GA and preview features are available and
> you should skip version-based gates. For snapshot builds (e.g., `9.4.0-SNAPSHOT`), strip the `-SNAPSHOT` suffix and
> use the major.minor for version checks.

## Table of Contents

- [Version Timeline Overview](#version-timeline-overview)
- [Feature Availability by Version](#feature-availability-by-version)
- [Major Limitations](#major-limitations)
- [Cross-Cluster Query Support](#cross-cluster-query-support)
- [Output Formats](#output-formats)
- [API Endpoints](#api-endpoints)
- [Performance Tips by Version](#performance-tips-by-version)
- [Version Detection](#version-detection)
- [References](#references)

## Version Timeline Overview

| Version | Release  | Status       | Key Additions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | -------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 8.11    | Nov 2023 | Tech Preview | Initial ES\|QL release                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 8.12    | Jan 2024 | Tech Preview | Spatial types, PROFILE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 8.13    | Mar 2024 | Tech Preview | Async queries, cross-cluster ENRICH                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 8.14    | May 2024 | **GA**       | Spatial functions, regex optimization                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 8.15    | Aug 2024 | GA           | Type casting (`::`), Arrow output                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 8.16    | Oct 2024 | GA           | Per-aggregation WHERE, new math/string functions                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 8.17    | Dec 2024 | GA           | MATCH, QSTR full-text functions                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 8.18    | Feb 2025 | GA           | LOOKUP JOIN (preview), scoring, KQL                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 8.19    | Apr 2025 | GA           | MATCH_PHRASE, FORK, CHANGE_POINT (preview)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 9.0     | Feb 2025 | GA           | Released with 8.18 features                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 9.1     | Jun 2025 | GA           | Full-text functions GA, FORK (preview)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 9.2     | Oct 2025 | GA           | Multi-field joins, TS, INLINE STATS (preview), CHANGE_POINT GA, FUSE (preview), RERANK (preview)                                                                                                                                                                                                                                                                                                                                                                                                             |
| 9.3     | Jan 2026 | GA           | INLINE STATS GA, SET directive (preview), Lucene-pushable JOIN predicates                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 9.4     | May 2026 | GA           | TS/TBUCKET GA, time series funcs GA, WITHOUT/METRICS_INFO/TS_INFO, PROMQL (preview), Views, RERANK GA, MV_EXPAND/VALUES GA, SET time_zone, SET approximation (preview)                                                                                                                                                                                                                                                                                                                                       |
| 9.5     | Aug 2026 | GA           | PROMQL GA, FUSE GA, SAMPLE GA, IN/NOT IN subquery (preview), IP_LOCATION (preview), TS_COLLAPSE (preview), EMBEDDING (preview), FIELD_EXTRACT (preview), Flattened fields (preview), SET approximation GA, Unmapped fields GA, JSON_EXTRACT GA, Subqueries GA, CHANGE_POINT BY GA, TO_COUNTER/TO_GAUGE GA, SPARKLINE (preview), date_range (preview), MATCH on expressions (preview), ST_UNION & spatial set ops (preview), TO_TEXT (preview), SET column_metadata (preview), Data Federation (experimental) |

## Feature Availability by Version

### Commands

| Command             | Introduced | GA       | Notes                                                                                      |
| ------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------ |
| `FROM`              | 8.11       | 8.14     | Source command                                                                             |
| `WHERE`             | 8.11       | 8.14     | Filtering                                                                                  |
| `EVAL`              | 8.11       | 8.14     | Computed columns                                                                           |
| `STATS ... BY`      | 8.11       | 8.14     | Aggregations with grouping                                                                 |
| `SORT`              | 8.11       | 8.14     | Ordering results                                                                           |
| `LIMIT`             | 8.11       | 8.14     | Result set size                                                                            |
| `KEEP`              | 8.11       | 8.14     | Column selection                                                                           |
| `DROP`              | 8.11       | 8.14     | Column removal                                                                             |
| `RENAME`            | 8.11       | 8.14     | Column renaming                                                                            |
| `DISSECT`           | 8.11       | 8.14     | Pattern extraction                                                                         |
| `GROK`              | 8.11       | 8.14     | Log parsing                                                                                |
| `ENRICH`            | 8.11       | 8.14     | Data enrichment                                                                            |
| `MV_EXPAND`         | 8.11       | 9.4      | Multi-value expansion (GA)                                                                 |
| `SHOW`              | 8.11       | 8.14     | Metadata display                                                                           |
| `ROW`               | 8.11       | 8.14     | Literal row creation                                                                       |
| `LOOKUP JOIN`       | 8.18/9.0   | 8.19/9.1 | SQL-style LEFT JOIN with lookup indices                                                    |
| `INLINE STATS`      | 9.2        | 9.3      | Inline aggregations (like window functions)                                                |
| `FORK`              | 8.19/9.1   | 9.4      | Multiple execution branches                                                                |
| `FUSE`              | 9.2        | 9.5      | Combine results from FORK branches (GA in 9.5)                                             |
| `TS`                | 9.2        | 9.4      | Time series source command (GA in 9.4)                                                     |
| `PROMQL`            | 9.4        | 9.5      | Source command using PromQL syntax on TSDS (GA in 9.5)                                     |
| `METRICS_INFO`      | 9.4        | 9.4      | TSDS metric catalogue (after `TS`)                                                         |
| `TS_INFO`           | 9.4        | 9.4      | Per-(metric, time series) metadata (after `TS`)                                            |
| `TS_COLLAPSE`       | 9.5        | Preview  | Collapse PROMQL per-step output into one row per time series                               |
| `RERANK`            | 9.2        | 9.4      | Re-score results with inference (GA in 9.4)                                                |
| `COMPLETION`        | 8.19/9.1   | 9.3      | LLM text generation                                                                        |
| `SAMPLE`            | 8.19/9.1   | 9.5      | Random sampling (GA in 9.5)                                                                |
| `CHANGE_POINT`      | 8.19/9.1   | 9.2      | Spike/dip detection (Platinum license); `BY` grouping GA in 9.5                            |
| `MMR`               | 9.4        | Preview  | Maximal Marginal Relevance diversification                                                 |
| `URI_PARTS`         | 9.4        | Preview  | Parse URI into structured columns (pipe command)                                           |
| `USER_AGENT`        | 9.4        | Preview  | Parse user agent into structured columns (pipe command)                                    |
| `REGISTERED_DOMAIN` | 9.4        | Preview  | `REGISTERED_DOMAIN`: extract from hostname (pipe command)                                  |
| `IP_LOCATION`       | 9.5        | Preview  | Query-time GeoIP enrichment (pipe command); `WITH {database_file, properties, first_only}` |
| Subqueries in FROM  | 9.4        | 9.5      | UNION ALL subqueries; ROW/TS sources added in 9.5                                          |
| `LIMIT BY`          | 9.4        | Preview  | Grouped top-N                                                                              |
| `DEDUP`             | Serverless | Preview  | Serverless preview; not available on Stack 9.5 — use `LIMIT 1 BY cols` or `STATS BY cols`  |
| Views               | 9.4        | Preview  | Virtual indices; 9.5: cross-project, now available on Serverless                           |

### Full-Text Search Functions

| Function                      | Introduced | GA       | Notes                        |
| ----------------------------- | ---------- | -------- | ---------------------------- |
| `MATCH(field, query)`         | 8.17       | 8.19/9.1 | Basic full-text matching     |
| `QSTR(query_string)`          | 8.17       | 8.19/9.1 | Query string syntax (Lucene) |
| `KQL(kql_string)`             | 8.18/9.0   | 8.19/9.1 | Kibana Query Language        |
| `MATCH_PHRASE(field, phrase)` | 8.19/9.1   | 8.19/9.1 | Exact phrase matching        |
| Match operator (`:`)          | 8.17       | 8.19/9.1 | Shorthand for MATCH          |

> **MATCH on expressions (9.5+ preview):** `MATCH` and the `:` operator can also match non-indexed expressions (e.g.
> `EVAL` columns; not after `STATS` or with options on 9.5 Stack, both allowed on Serverless) — row-by-row scan instead
> of inverted index. Wrap `keyword` expressions in `TO_TEXT` for analyzed matching.

### Vector and Advanced Search Functions

| Function / option                 | Introduced    | Status   | Notes                                                                       |
| --------------------------------- | ------------- | -------- | --------------------------------------------------------------------------- |
| `KNN`                             | 9.2 (preview) | GA (9.4) | Dense vector / `semantic_text` k-nearest neighbours                         |
| `TEXT_EMBEDDING`                  | 9.3 (preview) | GA (9.4) | Text → `dense_vector` via `text_embedding` endpoint                         |
| `V_COSINE`, `V_DOT_PRODUCT`, etc. | 9.3 (preview) | GA (9.4) | Vector similarity functions (`V_L1_NORM`, `V_L2_NORM`, `V_HAMMING`)         |
| `EMBEDDING`                       | 9.5 (preview) | Preview  | Multimodal input via `embedding` endpoint                                   |
| `TOP_SNIPPETS`                    | 9.3 (preview) | Preview  | 9.5 adds `highlight`, `pre_tag`, `post_tag`, `encoder`, `order`, `analyzer` |
| `DECAY`                           | 9.3 (preview) | Preview  | Distance-based scoring                                                      |
| Inference `timeout` option        | 9.5           | GA       | `COMPLETION`/`RERANK` `WITH {"timeout": ...}`; `TEXT_EMBEDDING` option      |

**Scoring support:**

- `METADATA _score` available from 8.18/9.0
- Must use `SORT _score DESC` to rank by relevance

### Spatial Functions

| Function                      | Introduced | Notes                                 |
| ----------------------------- | ---------- | ------------------------------------- |
| `GEO_POINT` type              | 8.12       | Basic spatial type support            |
| `CARTESIAN_POINT` type        | 8.12       | Cartesian coordinate support          |
| `ST_INTERSECTS`               | 8.14       | Geometry intersection test            |
| `ST_CONTAINS`                 | 8.14       | Containment test                      |
| `ST_DISJOINT`                 | 8.14       | Disjoint test                         |
| `ST_WITHIN`                   | 8.14       | Within test                           |
| `ST_X`, `ST_Y`                | 8.14       | Coordinate extraction                 |
| `ST_DISTANCE`                 | 8.15       | Distance calculation                  |
| `ST_EXTENT_AGG`               | 8.18/9.0   | Bounding box aggregation              |
| `ST_ENVELOPE`                 | 8.18/9.0   | Bounding box for geometry             |
| `ST_DIMENSION`                | 9.4        | Geometry dimension (0/1/2)            |
| `ST_GEOMETRYTYPE`             | 9.4        | Geometry type as string               |
| `ST_ISEMPTY`                  | 9.4        | Test if geometry is empty             |
| `ST_BUFFER`                   | 9.4        | Buffer around geometry                |
| `ST_SIMPLIFYPRESERVETOPOLOGY` | 9.4        | Simplify geometry preserving topology |
| `ST_UNION`                    | 9.5        | Preview — union of two geometries     |
| `ST_INTERSECTION`             | 9.5        | Preview — shared area                 |
| `ST_DIFFERENCE`               | 9.5        | Preview — first minus second          |
| `ST_SYMDIFFERENCE`            | 9.5        | Preview — area in exactly one         |

### Date/Time Functions

| Function          | Introduced     | Notes                                               |
| ----------------- | -------------- | --------------------------------------------------- |
| `NOW()`           | 8.11           | Current timestamp                                   |
| `DATE_TRUNC`      | 8.11           | Truncate to interval                                |
| `DATE_EXTRACT`    | 8.11           | Extract date parts                                  |
| `DATE_FORMAT`     | 8.11           | Format dates; honors `SET time_zone` from 9.4       |
| `DATE_PARSE`      | 8.11           | Parse date strings; honors `SET time_zone` from 9.4 |
| `DATE_DIFF`       | 8.13           | Difference between dates                            |
| `date_nanos` type | 8.17 (preview) | Nanosecond precision timestamps                     |
| `TRANGE`          | 9.3 (preview)  | Time range filter on `@timestamp`                   |

### String Functions

| Function                    | Introduced | Notes                                              |
| --------------------------- | ---------- | -------------------------------------------------- |
| `LEFT`, `RIGHT`             | 8.11       | Substring extraction                               |
| `SUBSTRING`                 | 8.11       | Position-based extraction                          |
| `CONCAT`                    | 8.11       | String concatenation                               |
| `TRIM`, `LTRIM`, `RTRIM`    | 8.11       | Whitespace removal                                 |
| `TO_UPPER`, `TO_LOWER`      | 8.13       | Case conversion                                    |
| `LOCATE`                    | 8.14       | Find substring position                            |
| `SPACE`                     | 8.16       | Generate spaces                                    |
| `REVERSE`                   | 8.16       | Reverse string                                     |
| `BIT_LENGTH`, `BYTE_LENGTH` | 8.17       | String length in bits/bytes                        |
| `STARTS_WITH`, `ENDS_WITH`  | 8.11       | Prefix/suffix matching                             |
| `CONTAINS`                  | 9.2        | Substring containment check                        |
| `JSON_EXTRACT`              | 9.4        | Extract from JSON string by JSONPath (GA in 9.5)   |
| `FIELD_EXTRACT`             | 9.5        | Extract sub-field from flattened object as keyword |

### Multi-Value Functions

| Function                  | Introduced | Notes                                   |
| ------------------------- | ---------- | --------------------------------------- |
| `MV_COUNT`                | 8.11       | Count values                            |
| `MV_CONCAT`               | 8.11       | Join values                             |
| `MV_FIRST`, `MV_LAST`     | 8.13       | First/last value                        |
| `MV_MIN`, `MV_MAX`        | 8.11       | Min/max value                           |
| `MV_SUM`, `MV_AVG`        | 8.11       | Sum/average                             |
| `MV_MEDIAN`               | 8.11       | Median value                            |
| `MV_SORT`                 | 8.14       | Sort multi-values                       |
| `MV_SLICE`                | 8.14       | Slice multi-values                      |
| `MV_PERCENTILE`           | 8.16       | Percentile calculation                  |
| `MV_PSERIES_WEIGHTED_SUM` | 8.16       | Weighted sum                            |
| `MV_DIFFERENCE`           | 9.4        | Set difference of two MV fields         |
| `MV_UNION`                | 9.4        | Set union of two MV fields              |
| `MV_INTERSECTION`         | 9.4        | Set intersection of two MV fields       |
| `MV_INTERSECTS`           | 9.4        | True if MV fields share a value         |
| `MV_CONTAINS`             | 9.4        | True if first MV contains all of second |

### Aggregation Functions

| Function                              | Introduced | Notes                                       |
| ------------------------------------- | ---------- | ------------------------------------------- |
| `COUNT`, `COUNT_DISTINCT`             | 8.11       | Counting                                    |
| `SUM`, `AVG`                          | 8.11       | Basic aggregations                          |
| `MIN`, `MAX`                          | 8.11       | Extended to strings/IPs in 8.16             |
| `MEDIAN`, `MEDIAN_ABSOLUTE_DEVIATION` | 8.11       | Statistical                                 |
| `PERCENTILE`                          | 8.11       | Percentile calculation                      |
| `TOP`                                 | 8.15       | Top N values                                |
| `VALUES`                              | 8.14       | Unique values (GA in 9.4)                   |
| `ST_EXTENT_AGG`                       | 8.18/9.0   | Spatial bounding box                        |
| `WEIGHTED_AVG`                        | 8.16       | Weighted average                            |
| `STD_DEV`                             | 8.18/9.0   | Standard deviation                          |
| `VARIANCE`                            | 8.18/9.0   | Variance                                    |
| `FIRST(value, sort_field)`            | 9.4        | Value from row with earliest sort field     |
| `LAST(value, sort_field)`             | 9.4        | Value from row with latest sort field       |
| `EARLIEST(@timestamp)`                | 9.4        | Min `@timestamp` (1-arg shorthand)          |
| `LATEST(@timestamp)`                  | 9.4        | Max `@timestamp` (1-arg shorthand)          |
| `SPARKLINE`                           | 9.5        | Preview — per-bucket values for a sparkline |

### Grouping Functions

| Function     | Introduced | Notes                                                            |
| ------------ | ---------- | ---------------------------------------------------------------- |
| `BUCKET`     | 8.11       | Numeric/date bucketing in `BY` clause                            |
| `CATEGORIZE` | 8.18/9.0   | Auto-categorization of text in `BY` clause                       |
| `TBUCKET`    | 9.2        | Time bucketing from `@timestamp`; preferred in TS (GA in 9.4)    |
| `WITHOUT`    | 9.4        | Group time series by every dimension except the listed ones (GA) |

### Per-Aggregation WHERE

Available since 8.16. Allows filtering individual aggregations without affecting others:

```esql
| STATS total = COUNT(*), errors = COUNT(*) WHERE level == "error" BY service.name
```

### IP Functions

| Function     | Introduced | Notes                          |
| ------------ | ---------- | ------------------------------ |
| `CIDR_MATCH` | 8.11       | Check IP against CIDR ranges   |
| `IP_PREFIX`  | 8.14       | Extract network prefix from IP |
| `TO_IP`      | 8.11       | Convert string to IP type      |

### Time Series Aggregation Functions

Available under `TS ... | STATS`. See [time-series-queries.md](time-series-queries.md) for full reference. All time
series aggregation functions in this table — both the 9.2-introduced set and the 9.3-introduced set (`DERIV`,
`PERCENTILE_OVER_TIME`, `STDDEV_OVER_TIME`, `VARIANCE_OVER_TIME`) — are **GA since 9.4**.

| Function                   | Introduced    | Status   | Notes                                                             |
| -------------------------- | ------------- | -------- | ----------------------------------------------------------------- |
| `RATE`                     | 9.2 (preview) | GA (9.4) | Per-second rate of counter increase                               |
| `IRATE`                    | 9.2 (preview) | GA (9.4) | Instant rate (last two data points)                               |
| `INCREASE`                 | 9.2 (preview) | GA (9.4) | Absolute counter increase in window                               |
| `DELTA`                    | 9.2 (preview) | GA (9.4) | Absolute change of a gauge                                        |
| `IDELTA`                   | 9.2 (preview) | GA (9.4) | Change between last two data points                               |
| `AVG_OVER_TIME`            | 9.2 (preview) | GA (9.4) | Average value over time                                           |
| `SUM_OVER_TIME`            | 9.2 (preview) | GA (9.4) | Sum of values over time                                           |
| `MIN_OVER_TIME`            | 9.2 (preview) | GA (9.4) | Minimum value over time                                           |
| `MAX_OVER_TIME`            | 9.2 (preview) | GA (9.4) | Maximum value over time                                           |
| `FIRST_OVER_TIME`          | 9.2 (preview) | GA (9.4) | Earliest value by `@timestamp`                                    |
| `LAST_OVER_TIME`           | 9.2 (preview) | GA (9.4) | Latest value by `@timestamp` (implicit default for numeric/gauge) |
| `COUNT_OVER_TIME`          | 9.2 (preview) | GA (9.4) | Count of values over time                                         |
| `COUNT_DISTINCT_OVER_TIME` | 9.2 (preview) | GA (9.4) | Count of distinct values over time                                |
| `PRESENT_OVER_TIME`        | 9.2 (preview) | GA (9.4) | `true` if field has values in window                              |
| `ABSENT_OVER_TIME`         | 9.2 (preview) | GA (9.4) | `true` if field has no values in window                           |
| `DERIV`                    | 9.3 (preview) | GA (9.4) | Derivative via linear regression                                  |
| `PERCENTILE_OVER_TIME`     | 9.3 (preview) | GA (9.4) | Percentile of values over time                                    |
| `STDDEV_OVER_TIME`         | 9.3 (preview) | GA (9.4) | Population standard deviation over time                           |
| `VARIANCE_OVER_TIME`       | 9.3 (preview) | GA (9.4) | Population variance over time                                     |

**Sliding window parameter (second argument):**

- 9.2-9.3 (preview) — accepted window values are limited to multiples of the `TBUCKET` interval in the `BY` clause; if
  no window is specified, the bucket interval is used implicitly.
- 9.4+ (GA) — all window values are accepted, with performance optimizations when the window is a multiple of the
  `TBUCKET` interval. Mixing windows that are smaller than the time bucket for one metric with windows larger than the
  time bucket for another metric in the same query is not allowed.

### Conditional Functions

| Function    | Introduced    | Notes                              |
| ----------- | ------------- | ---------------------------------- |
| `CLAMP`     | 9.3 (preview) | Clamp values to `[min, max]` range |
| `CLAMP_MIN` | 9.3 (preview) | Set lower bound for values         |
| `CLAMP_MAX` | 9.3 (preview) | Set upper bound for values         |

### WHERE IN / NOT IN (9.5+ preview)

Subquery-based set membership filtering. The reference set is any ES|QL expression returning one column.

| Syntax                                      | Introduced | Status  | Notes                                       |
| ------------------------------------------- | ---------- | ------- | ------------------------------------------- |
| `WHERE field IN (FROM ... \| KEEP ...)`     | 9.5        | Preview | Filter by matching a subquery result set    |
| `WHERE field NOT IN (FROM ... \| KEEP ...)` | 9.5        | Preview | Exclude rows matching a subquery result set |

Before 9.5, use `LOOKUP JOIN idx ON field == col | WHERE col IS NULL` for `NOT IN` (`IS NOT NULL` for `IN`).

### date_range Type and Functions (9.5+ preview)

| Function / Type          | Introduced | Status  | Notes                                         |
| ------------------------ | ---------- | ------- | --------------------------------------------- |
| `date_range` type        | 9.5        | Preview | Time range with start/end bounds              |
| `TO_DATE_RANGE(string)`  | 9.5        | Preview | Parse `"from..to"` string into date_range     |
| `TO_RANGE(from, to)`     | 9.5        | Preview | Construct date_range from two dates           |
| `RANGE_INTERSECTS(a, b)` | 9.5        | Preview | Check if two ranges (or range + date) overlap |
| `RANGE_WITHIN(a, b)`     | 9.5        | Preview | Check if range a is within range b            |
| `RANGE_CONTAINS(a, b)`   | 9.5        | Preview | Check if range a contains range b             |
| `range_min(field)`       | 9.5        | Preview | Extract lower bound of a date_range           |
| `range_max(field)`       | 9.5        | Preview | Extract upper bound of a date_range           |

### Type Casting

| Syntax                         | Introduced | Notes                                                     |
| ------------------------------ | ---------- | --------------------------------------------------------- |
| `TO_STRING(x)`                 | 8.11       | Function-based casting                                    |
| `TO_INTEGER(x)`                | 8.11       | Function-based casting                                    |
| `TO_DOUBLE(x)`                 | 8.11       | Function-based casting                                    |
| `x::string`                    | 8.15       | Operator-based casting                                    |
| `x::integer`                   | 8.15       | Operator-based casting                                    |
| `TO_COUNTER(x)` / `x::counter` | 9.5 (GA)   | Treat a numeric metric as a counter in `TS` (e.g. RATE)   |
| `TO_GAUGE(x)` / `x::gauge`     | 9.5 (GA)   | Treat a metric as a gauge in `TS`                         |
| `TO_TEXT(x)`                   | 9.5        | Preview — keyword → analyzed `text` (optional `analyzer`) |

## Major Limitations

### Pagination (Not Supported)

ES|QL **does not support cursor-based pagination** like the Search API's `search_after` or `scroll`.

**Current behavior:**

- Default: 1,000 rows returned
- Maximum: 10,000 rows (configurable via `esql.query.result_truncation_max_size`)
- No cursor or continuation token
- GitHub tracking issue: [#100000](https://github.com/elastic/elasticsearch/issues/100000)

**Workarounds:**

- Use `WHERE` to filter to relevant subset
- Use `STATS` to aggregate at query time
- For exports, use Search API with `search_after` instead

### Time Zone Support (GA in 9.4+; Serverless)

ES|QL supports query-wide timezone via the `SET time_zone` directive (GA in 9.4+; Serverless). This accepts IANA
timezone strings and UTC offsets, and applies to all date/time operations including `DATE_TRUNC`, `DATE_FORMAT`,
`NOW()`, bucketing, and display.

```esql
SET time_zone = "America/New_York";
FROM logs-*
| STATS errors = COUNT(*) BY hour = DATE_TRUNC(1 hour, @timestamp)
| SORT hour DESC
```

**Remaining limitations (all versions):**

- No per-function timezone argument — `DATE_TRUNC(1 hour, @timestamp, "America/New_York")` does **not** work
- `DATE_FORMAT` and `DATE_PARSE` do not accept timezone parameters directly; use `SET time_zone` instead

**Versions before 9.4:** No timezone support. All dates are processed in UTC — released 9.3 builds reject both
`SET time_zone` and the `time_zone` request parameter. Workaround: use `EVAL` to add/subtract hours manually:

```esql
| EVAL local_time = timestamp + 1 hour
```

### Nested Fields (Not Supported)

ES|QL **cannot query nested field types**. Unlike other unsupported types (which return `null`), nested fields are **not
returned at all** — they are silently omitted from results.

- Cannot use nested paths like `nested_field.sub_field` — referencing the nested field or a subfield in `KEEP`, `WHERE`,
  or `EVAL` fails with `Unknown column` (with `SET unmapped_fields = "load"` the subfield is `null`)
- Must flatten data at index time for ES|QL access

### Unsupported Field Types

These field types are not supported or have limitations:

| Type           | Status                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nested`       | Not supported — omitted from results (not `null`); referencing it fails with `Unknown column`                                                          |
| `flattened`    | Tech Preview (9.5) — root column only; sub-keys via `FIELD_EXTRACT`; `JSON_EXTRACT` pre-9.5; before 9.5 the column is returned as `unsupported` (null) |
| `join`         | Not supported                                                                                                                                          |
| `date_range`   | Tech Preview (9.5) — supported via `date_range` type and range functions                                                                               |
| `binary`       | Not supported                                                                                                                                          |
| `completion`   | Not supported                                                                                                                                          |
| `rank_feature` | Not supported                                                                                                                                          |
| `histogram`    | Supported in `TS` via cast only (`::exponential_histogram`/`::tdigest`; 9.3 preview / 9.4 GA)                                                          |

### JOIN Limitations

`LOOKUP JOIN` (8.18/9.0+):

- Only LEFT OUTER JOIN behavior
- Lookup index must use `index.mode: lookup` setting
- Lookup index limited to single shard (max 2B docs)
- Cross-cluster joins require lookup index on all clusters
- Only supports equality joins before 9.2

`LOOKUP JOIN` improvements in 9.2 (tech preview):

- Multi-field joins supported
- Complex join predicates with `<`, `>`, `<=`, `>=`
- Expression-based join conditions

`LOOKUP JOIN` improvements in 9.3 (tech preview):

- Lucene-pushable predicates: `MATCH`, `QSTR`, `KQL`, `CIDR_MATCH` in join conditions
- Further performance gains for filtered joins

### Subqueries

ES|QL supports **subqueries in `FROM`** (preview in 9.4, **GA in 9.5**) for combining results from multiple pipelines
(UNION ALL semantics). These are non-correlated — each branch is independent. **9.5** adds `ROW` and `TS` as valid
subquery source commands.

```esql
FROM
  (FROM web_logs | WHERE status >= 500 | KEEP @timestamp, message, service.name),
  (FROM app_logs | WHERE level == "error" | KEEP @timestamp, message, service.name)
| SORT @timestamp DESC
```

**WHERE IN / NOT IN (9.5+ preview):**

ES|QL supports `WHERE field IN (subquery)` and `WHERE field NOT IN (subquery)` for filtering rows against a reference
dataset. The subquery must return a single column.

```esql
FROM logs-*
| WHERE source.ip NOT IN (FROM allowed_ips | KEEP ip)
| STATS count = COUNT(*) BY source.ip
| SORT count DESC
```

**Not supported:**

- Correlated subqueries (branches cannot reference outer columns)
- Nested SELECT / CTEs (Common Table Expressions)

Use `INLINE STATS` (9.2+) for per-row vs. aggregate comparison patterns.

## Cross-Cluster Query Support

| Feature                   | Version | Notes                                     |
| ------------------------- | ------- | ----------------------------------------- |
| Basic CCS                 | 8.13    | Query remote clusters                     |
| Cross-cluster ENRICH      | 8.13    | Enrich with remote data                   |
| Cross-cluster LOOKUP JOIN | 9.2     | Join with remote lookup indices           |
| `skip_unavailable`        | 8.17    | Graceful handling of unavailable clusters |

## Output Formats

| Format | Version | Notes                                                         |
| ------ | ------- | ------------------------------------------------------------- |
| JSON   | 8.11    | Default format                                                |
| CSV    | 8.11    | Tabular output                                                |
| TSV    | 8.11    | Tab-separated                                                 |
| Arrow  | 8.15    | Apache Arrow IPC format                                       |
| MD     | 9.6     | Markdown pipe table (GitHub-flavored); Serverless; Stack 9.6+ |

## API Endpoints

| Endpoint                         | Version | Notes                                             |
| -------------------------------- | ------- | ------------------------------------------------- |
| `POST /_query`                   | 8.11    | Synchronous query                                 |
| `POST /_query/async`             | 8.13    | Async query submission                            |
| `GET /_query/async/{id}`         | 8.13    | Get async query results                           |
| `DELETE /_query/async/{id}`      | 8.13    | Cancel async query                                |
| `PUT /_query/view/{name}`        | 9.4     | Create/update view                                |
| `GET /_query/view/{name}`        | 9.4     | Get view definition                               |
| `DELETE /_query/view/{name}`     | 9.4     | Delete view                                       |
| `PUT /_query/data_source/{name}` | 9.5     | Data source config (experimental, not production) |
| `PUT /_query/dataset/{name}`     | 9.5     | Dataset config (experimental, not production)     |

## Performance Tips by Version

### 8.14+

- Regex patterns are optimized
- Enrich supports text fields

### 8.15+

- Use `::` casting instead of `TO_*` functions (cleaner syntax)
- Arrow format for analytics tool integration

### 8.17+

- Use `MATCH`/`QSTR` instead of `LIKE`/`RLIKE` for text search (50-1000x faster)
- Full-text functions use Lucene optimizations

### 9.1+

- Use `INLINE STATS` to avoid multiple queries
- Full-text functions are GA and stable

### 9.2+

- Use `TS` with `RATE`, `AVG_OVER_TIME`, etc. for time series metrics aggregations (preview in 9.2-9.3, GA in 9.4)
- Use `TBUCKET` for time bucketing in TS queries (GA in 9.4)
- Multi-field `LOOKUP JOIN` for complex correlations
- `FUSE` for hybrid search scoring

### 9.3+

- Use `TRANGE` instead of manual `WHERE @timestamp` filters
- Sliding window parameter for time series functions (e.g. `RATE(field, 10m)`); in 9.2-9.3 the window must be a multiple
  of the `TBUCKET` interval, this restriction is lifted in 9.4
- `CLAMP`, `CLAMP_MIN`, `CLAMP_MAX` for bounding metric values
- Histogram metrics in `TS` (preview): query `exponential_histogram` / `tdigest` with standard aggregations; cast plain
  `histogram` with `::exponential_histogram` or `::tdigest` — see
  [Histogram Metrics](time-series-queries.md#histogram-metrics)

### 9.4+

- `TS`, `TBUCKET`, and all time series aggregation functions are **GA** — safe for production metrics queries
- Histogram metrics in `TS` are **GA** (`exponential_histogram` / `tdigest`; plain `histogram` still requires a cast)
- Use `METRICS_INFO` / `TS_INFO` to discover TSDS schemas instead of inspecting mappings or field capabilities
- Use `WITHOUT(dim, ...)` to group by all dimensions except specific ones — avoids enumerating every dimension manually
- Sliding window accepts arbitrary durations — `RATE(field, 7m)` with `TBUCKET(5 minute)` now works
- Use `SET time_zone` with IANA strings for timezone-aware queries instead of manual `EVAL` offset arithmetic
- Use `SET approximation = true` to approximate large `STATS` summaries via sampling/extrapolation (preview in 9.4, GA
  in 9.5+ and Serverless) — returns estimates with confidence intervals; see
  [query-approximation.md](query-approximation.md)
- Use `SET unmapped_fields = "load"` to query fields missing from some indices without errors
- Use `FIRST`/`LAST` (or `EARLIEST`/`LATEST`) instead of `SORT` + `LIMIT 1` for grouped first/last-value queries
- Use `PROMQL` when porting Prometheus dashboards/alerts; otherwise prefer `TS` for native ES|QL (preview in 9.4, GA in
  9.5+ and Serverless; supported PromQL functions/operators vary by version — see
  [promql-command.md](promql-command.md))

### 9.5+

- `SET unmapped_fields` is **GA** — production-ready for schema-on-read queries (for `SET approximation`, GA in 9.5, see
  the 9.4+ tips above)
- `JSON_EXTRACT` is **GA** — combine with `SET unmapped_fields = "load"` for a complete schema-on-read workflow
- Subqueries in `FROM` are **GA** — use `ROW` and `TS` as subquery source commands in addition to `FROM`
- Use `WHERE field IN (FROM lookup_index | KEEP field)` (preview) to filter against reference datasets without joins
- Use `IP_LOCATION` (preview) for query-time GeoIP enrichment without ingest pipeline configuration (before 9.5, no
  query-time GeoIP: use `ENRICH` or the ingest `geoip` processor)
- Use `EMBEDDING(value, inference_id)` (preview) to generate dense vector embeddings from multimodal input (text, image,
  audio, video, PDF) via inference endpoints
- Flattened fields (preview) load as a `flattened` root column; read sub-keys only with
  `FIELD_EXTRACT(root, "dotted.key")` and cast the `keyword` result for numeric use — `JSON_EXTRACT` on `_source`
  remains the pre-9.5 workaround
- Use `CHANGE_POINT value ON key BY group` (GA) for per-series change detection instead of one query per group
- Use `SPARKLINE(agg, @timestamp, buckets, from, to)` (preview) for compact per-group trend arrays
- Use `x::counter` / `x::gauge` (GA) inside `TS` when a metric's mapping lacks the right `time_series_metric`

**Patch-release behavior changes:**

- 9.5.1 — `PROMQL` works on `date_nanos` time series indices
- 9.5.2 — a `WHERE field IN (subquery)` whose subquery folds to an empty set returns no rows

### Serverless (latest)

Serverless includes all 9.5 features plus some that have not reached Stack yet, for example the `md` output format
(Stack 9.6+), the `DEDUP` command (preview), and `SET project_routing` for cross-project search (Serverless only).
Serverless also lifts some 9.5 Stack restrictions: `MATCH` on expressions works after `STATS` and with options, and
`MATCH_PHRASE` and inline `:` accept `FIELD_EXTRACT(…)`.

## Version Detection

To check ES|QL availability and version:

```bash
# Check Elasticsearch version and build flavor (use build_flavor to detect Serverless)
curl -s localhost:9200 | jq '.version | {number, build_flavor}'

# Test ES|QL availability
curl -X POST localhost:9200/_query \
  -H "Content-Type: application/json" \
  -d '{"query": "ROW x = 1"}'
```

## References

- [ES|QL Timeline of Improvements](https://www.elastic.co/search-labs/blog/esql-timeline-of-improvements)
- [ES|QL Limitations](https://www.elastic.co/docs/reference/query-languages/esql/limitations)
- [Elasticsearch Release Notes](https://www.elastic.co/docs/release-notes/elasticsearch)
- [ES|QL for Search](https://www.elastic.co/docs/solutions/search/esql-for-search)
- [LOOKUP JOIN Documentation](https://www.elastic.co/docs/reference/query-languages/esql/esql-lookup-join)
