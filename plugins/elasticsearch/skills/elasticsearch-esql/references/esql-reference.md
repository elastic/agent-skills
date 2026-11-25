# ES|QL Complete Reference

ES|QL (Elasticsearch Query Language) is a piped query language for filtering, transforming, and analyzing data in
Elasticsearch. It uses pipes (`|`) to chain commands together.

> **Serverless vs Stack:** Version annotations in this document (e.g., "9.2+") apply to Elastic Stack (self-managed and
> Cloud-hosted). Detect cluster type via `build_flavor` in the `GET /` response: `"serverless"` means all GA and preview
> features are available — **do not** gate on `version.number` for Serverless (it tracks the next minor from main;
> semver-only checks may treat it as “latest”). For Stack, use `version.number` (strip any `-SNAPSHOT` suffix) for
> feature checks.

## Table of Contents

- [Query Structure](#query-structure)
- [Query Directives](#query-directives)
- [Source Commands](#source-commands)
- [Processing Commands](#processing-commands)
- [Aggregate Functions](#aggregate-functions)
- [Time Series Aggregation Functions](#time-series-aggregation-functions)
- [String Functions](#string-functions)
- [Math Functions](#math-functions)
- [Date/Time Functions](#datetime-functions)
- [Type Conversion Functions](#type-conversion-functions)
- [IP Functions](#ip-functions)
- [Spatial Functions](#spatial-functions)
- [Dense Vector Functions](#dense-vector-functions)
- [Multivalue Functions](#multivalue-functions)
- [Conditional Functions](#conditional-functions)
- [Full-Text Search Functions](#full-text-search-functions)
- [Operators](#operators)
- [Syntax Details](#syntax-details)
- [Metadata Fields](#metadata-fields)
- [Best Practices](#best-practices)
- [Example Queries](#example-queries)

## Query Structure

```esql
source-command
| processing-command1
| processing-command2
| ...
```

An ES|QL query starts with a **source command** followed by zero or more **processing commands** separated by pipes.

---

## Query Directives

Query directives modify the behavior of an ES|QL query. They appear before the source command.

### SET (preview 9.3, GA 9.4)

Controls query-level settings. Every `SET` directive must end with a semicolon before the source command. Since 9.5, SET
directives and request-body parameters are unified — the same parameter can be specified in either location, with the
request body taking precedence when both are specified.

**Syntax:**

```esql
SET setting = "value"; [SET setting = "value";]
source-command
| processing-commands
```

**`unmapped_fields`** (9.3+ preview, **GA in 9.5**) -- controls how unmapped fields are treated. Accepted values are
`"default"`, `"nullify"`, and `"load"` (case-insensitive); any other value is rejected:

- `"default"` -- the query fails if it references a fully unmapped field (this is the default)
- `"nullify"` -- treats referenced unmapped fields as null values
- `"load"` (preview 9.4, GA 9.5) -- loads unmapped fields from stored `_source` as `keyword` type (or nullifies if
  absent from `_source`). Partially mapped fields are also loaded from `_source` where unmapped. `"load"` works inside
  FROM subqueries and views on 9.4; inside FORK it needs 9.5+ (9.4 rejects it). `PROMQL` and subfields of `flattened`
  parents are not supported with `"load"`.
- Full-text functions on a field loaded via `"load"` need an explicit `TO_TEXT` (9.5+): write
  `WHERE MATCH(TO_TEXT(note), "quota")` — `MATCH(note, "quota")` silently matches nothing because the loaded value is
  `keyword`. Partially mapped `text` fields also stay `null` where unmapped unless wrapped in `TO_TEXT`.

**`time_zone`** (9.4+ GA; Serverless) -- sets the default timezone for the query, overriding UTC default. Accepts any
IANA timezone string or UTC offset. Applies to all date/time operations: `DATE_TRUNC`, `DATE_FORMAT`, `NOW()`, etc.

**`approximation`** (9.5+ GA; Serverless; preview in 9.4) -- approximates `STATS` aggregations via random sampling and
extrapolation, returning estimates with confidence intervals for far faster results on large datasets:

- `true` -- enable approximation with default settings (1,000,000 sampled rows when grouped, 100,000 otherwise; central
  90% confidence interval)
- `false` (default) -- exact execution
- map value -- enable with custom settings: `{"rows":N}` (sampled rows, `N` ≥ 10,000) and/or `{"confidence_level":X}`
  (default `0.90`; `null` disables interval computation)

Adds `_approximation_confidence_interval(col)` and `_approximation_certified(col)` columns per estimated quantity.
`COUNT_DISTINCT`, `MIN`, `MAX`, `FIRST`, `LAST`, `TOP`, and several others are **not supported** and fall back to exact
execution — use the [`SAMPLE`](#sample) command for those. See [query-approximation.md](query-approximation.md) for the
full reference.

**`column_metadata`** (preview 9.5; Serverless preview) -- `true` adds `_meta` properties to the response `columns`;
currently only `_meta.bucket` (interval and unit) for `BUCKET` columns. Defaults to `false`.

**`project_routing`** (Serverless only; unavailable on Stack) -- limits a cross-project search to projects matching a
project-tag expression, e.g. `SET project_routing="_alias:my-project";`. Stack clusters reject it. Elasticsearch API
keys reach only the origin project; routing to linked projects needs a Cloud API key.

**Examples:**

```esql
SET unmapped_fields = "nullify";
FROM employees
| KEEP emp_no, foo
| SORT emp_no
| LIMIT 1

SET time_zone = "America/Los_Angeles";
FROM error_triage
| EVAL hour = DATE_TRUNC(1 hour, @timestamp)
| STATS errors = COUNT(*) BY hour, service
| SORT hour DESC

SET time_zone = "+05:00";
TS k8s
| WHERE @timestamp == "2024-05-10T00:04:49.000Z"
| STATS BY @timestamp, bucket = TBUCKET(3 hours)

SET approximation = true;
FROM web_traffic
| WHERE @timestamp >= NOW() - 1 week
| STATS total_hits = COUNT(*), avg_load_time = AVG(page_load_ms) BY country_code
| SORT total_hits DESC
| LIMIT 5

SET approximation = {"confidence_level": 0.95};
FROM web_traffic
| STATS avg_load_time = AVG(page_load_ms)
```

> **When to use:** `unmapped_fields` is useful when querying across multiple indices where some indices may not have all
> fields mapped. `time_zone` shifts date functions and display to a non-UTC zone. There is no per-function timezone
> argument — `DATE_TRUNC(1 hour, @timestamp, "America/Los_Angeles")` does **not** work. `approximation` trades exactness
> for speed on large `STATS` summaries — see [query-approximation.md](query-approximation.md).
>
> **Restriction:** `SET` directives cannot be used inside view definitions. The caller must apply `SET` when querying
> the view.

---

## Source Commands

Source commands produce tables, typically from Elasticsearch data.

### FROM

Retrieves data from indices, data streams, or aliases.

**Syntax:**

```esql
FROM index_pattern [METADATA fields]
```

**Examples:**

```esql
// Basic usage
FROM logs-*

// Multiple indices
FROM employees-00001, other-employees-*

// With metadata
FROM logs-* METADATA _id, _index

// Date math
FROM <logs-{now/d}>

// Cross-cluster search
FROM cluster_one:logs-*, cluster_two:logs-*
```

**Subqueries (preview in 9.4, GA in 9.5; Serverless):** `FROM` supports parenthesized subqueries with UNION ALL
semantics. Each branch is a complete ES|QL pipeline. Columns present in one branch but not another are filled with
`null`. In 9.5+, `ROW` and `TS` are also valid as subquery source commands.

```esql
// Combine logs from different indices with independent pipelines
FROM
  (FROM web_logs
   | WHERE status_code >= 500
   | KEEP @timestamp, message, service.name),
  (FROM app_logs
   | WHERE level == "error"
   | KEEP @timestamp, message, service.name)
| STATS errors = COUNT(*) BY service.name

// Mix bare index patterns and subqueries
FROM raw_index, (FROM other_index | WHERE active == true | KEEP id, name)
```

**Subquery constraints:**

- Non-correlated only — branches cannot reference columns from the outer query
- Columns with the same name must have compatible types across branches
- `FORK` cannot be used inside or after subqueries

**Subqueries vs FORK:** Different data sources → subqueries. Same data, different analyses → FORK.

**Note:** Without explicit `LIMIT`, queries default to 1000 rows (or whatever the cluster setting
esql.query.result_truncation_default_size is set to).

### ROW

Creates a row with literal values. Useful for testing.

**Syntax:**

```esql
ROW column1 = value1 [, column2 = value2, ...]
```

**Examples:**

```esql
ROW a = 1, b = "two", c = null
ROW x = [1, 2, 3]
ROW greeting = "hello", pi = 3.14159
```

**Intra-row field references (9.4+; Serverless):** Columns defined earlier in the same `ROW` can be referenced by later
columns:

```esql
ROW a = 5, b = a * 2, c = a + b
```

### Views (preview 9.4)

Views are virtual indices backed by ES|QL queries. Query a view with `FROM view_name` like any index. Views are managed
via the `/_query/view` REST API.

**Create / update a view:**

```bash
PUT /_query/view/active_employees
{
  "query": "FROM employees | WHERE is_active == true | KEEP emp_no, name, department"
}
```

**Query a view:**

```esql
FROM active_employees
| STATS headcount = COUNT(*) BY department
```

**Constraints:**

- `SET` directives cannot be used inside view definitions; the caller applies `SET` when querying
- A caller's `SET unmapped_fields = "load"` applies to fields the view's query references (9.4+)
- Views resolve across Cross-Project Search boundaries (9.5+)
- Views are available on both Stack and Serverless

### TS

Retrieves data from time series data streams (TSDS). Similar to `FROM` but enables time series aggregation functions in
`STATS` and targets only time series indices. **Preview from 9.2 to 9.3, GA since 9.4**; GA on Elastic Cloud Serverless.

**Syntax:**

```esql
TS index_pattern [METADATA fields]
```

**Key behavior:**

- Enables time series aggregation functions (`RATE`, `AVG_OVER_TIME`, etc.) in the first `STATS` command
- Time series functions are evaluated per time series first, then aggregated by group using an outer function
- If no inner time series function is specified, the default depends on field type: `LAST_OVER_TIME()` for numeric/gauge
  fields; histogram merge for `exponential_histogram`/`tdigest` (plain `histogram` needs a cast — see
  [Histogram Metrics](time-series-queries.md#histogram-metrics))
- Cannot be combined with `FORK` before `STATS` is applied
- When the query has no `STATS`, `TS` returns rows sorted by `@timestamp` descending by default
- When the first `STATS` after `TS` uses a **bare** time series function (not wrapped in an outer aggregation like
  `AVG()` / `SUM()`), results are implicitly grouped by every dimension and include a `_timeseries` JSON column. Use
  `BY WITHOUT(dim, ...)` (GA in 9.4) to narrow this grouping. Bare dimension columns in `BY` are rejected; only grouping
  functions (`TBUCKET`, `WITHOUT`) are allowed alongside a bare time series function.

**Examples:**

```esql
// Rate of search requests per host per hour
TS metrics
| WHERE @timestamp >= NOW() - 1 hour
| STATS SUM(RATE(search_requests)) BY TBUCKET(1 hour), host

// Gauge — average of last values per time series (implicit LAST_OVER_TIME)
TS metrics
| STATS AVG(memory_usage)

// Average of per-time-series averages (explicit inner function)
TS metrics
| STATS AVG(AVG_OVER_TIME(memory_usage))

// Bare time series function — group by every dimension except `pod` (9.4+ GA)
TS k8s
| STATS total_cost = SUM(network.cost) BY WITHOUT(pod)
| SORT total_cost
```

**Best practices:**

- Add a time range filter on `@timestamp` to limit data volume
- Use `TS` instead of `FROM` for aggregations on time series data
- Avoid aggregating metrics with different dimensional cardinalities in the same query

### PROMQL

Queries time series data streams (TSDS) using **Prometheus Query Language (PromQL)** instead of ES|QL syntax. Like `TS`,
it produces a table that the rest of the ES|QL pipeline can process. **GA** on Elastic Cloud Serverless and Elastic
Stack **9.5+**, **preview** in **9.4**. See [promql-command.md](promql-command.md) for the full reference.

**Syntax:**

```esql
PROMQL [ <option> ... ] [ <result_name> = ] ( <PromQL expression> )
```

**Options:**

- `index` — indices/streams/aliases (default `metrics-*`)
- `step` — query resolution step width
- `buckets` — target bucket count for auto-step (default `100`, mutually exclusive with `step`)
- `start`, `end` — explicit time range (defaults to Kibana date picker, otherwise unrestricted)
- `time` (9.5+; Serverless) — evaluate once at that time (instant query); cannot be combined with `step`, `buckets`,
  `start`, or `end`
- `scrape_interval` — expected metric collection interval (default `1m`); used for the implicit range selector window
- `<result_name>=( ... )` — name the metric output column

**Output columns:**

- The PromQL expression (or `<result_name>`) as `double` — the metric value
- `step` (`date`) — timestamp for each evaluation step (instant query: the `time`); there is no `@timestamp` column
- One `keyword` column per `by` grouping label; no label columns for an aggregation without grouping (`sum(...)`);
  otherwise (no cross-series aggregation, or `without`) a single `_timeseries` JSON column

**Examples:**

```esql
// Fully adaptive Kibana query — date picker drives time range and step
PROMQL index=metrics-* http_rate=(sum(rate(http_requests_total)))

// (9.5+; Serverless) Instant query — current value at the end of the date picker range
PROMQL index=metrics-* time=?_tend load=(avg(node_load1))

// Explicit range query with a named result column
PROMQL index=k8s step=1h cost=(max by (cluster) (network.total_bytes_in{cluster!="prod"}))
| SORT cluster

// Post-process with ES|QL after the PROMQL stage
PROMQL index=k8s step=1h bytes=(max by (cluster) (network.bytes_in))
| STATS max_bytes = MAX(bytes) BY cluster
| SORT cluster

// Enrich PromQL results with a lookup index
PROMQL index=metrics-*
  http_rate=(sum by (instance) (rate(http_requests_total)))
| LOOKUP JOIN instance_metadata ON instance
```

**Implicit range selectors:** Range vector functions can omit the range selector (`rate(http_requests_total)` instead of
`rate(http_requests_total[5m])`); the engine uses `max(step, scrape_interval)` as the window. This makes the query scale
with the date picker.

**Limitations:** Not every PromQL construct is supported, and coverage varies by version. Elasticsearch rejects
unsupported constructs with a `verification_exception` naming them. See
[promql-command.md](promql-command.md#limitations) for the unsupported constructs and
[how to handle them](promql-command.md#handling-unsupported-constructs).

### SHOW

Returns information about the deployment.

**Syntax:**

```esql
SHOW INFO
```

### Data Federation (9.5 experimental — not for production use)

Query files in Amazon S3 (Parquet, CSV, TSV, NDJSON) in place, without ingesting them. A **data source** holds the
connection and credentials; a **dataset** names the files to read. Query a dataset with `FROM <dataset>` like an index.
See [ES|QL Data Federation](https://www.elastic.co/docs/reference/query-languages/esql/esql-data-federation).

**Status:** Experimental in 9.5 and not for production use (no guarantees on performance, scale, or stability).
Available on ECH and self-managed only (not Serverless). Off by default, requires an Enterprise license, and not
supported on Windows. Use it only when the user asks to query external or S3 data, and state this status when you do.

**Enable:** set `esql.federation.enabled: true` (static node setting; on ECH, add it to the deployment's Elasticsearch
user settings) and `xpack.dataFederation.enabled: true` in Kibana for the UI (**Data management > ES|QL Data
Federation**). `GET /_query/data_source` returns 200 when the feature is enabled.

**Create a data source** (cluster `manage`, or the `global.data_source` privilege):

```bash
PUT /_query/data_source/public_s3
{
  "type": "s3",
  "settings": { "auth": "anonymous", "region": "us-east-1" }
}
```

- `auth`: `anonymous` (public buckets), `static_credentials` (`access_key`, `secret_key`; stored encrypted and returned
  as `::es_redacted::`), `federated_identity` (ECH only; `role_arn`), or `managed_identity` (operator-only).
- In 9.5, set `region` on the data source; datasets reject a `region` setting.
- Creating it does not test connectivity. Bad credentials, regions, or paths surface at query time.

**Create a dataset** (index `manage` privilege on the dataset name, plus `read` on the data source):

```bash
PUT /_query/dataset/noaa_tmax
{
  "data_source": "public_s3",
  "resource": "s3://noaa-ghcn-pds/parquet/by_station/STATION=USW00094728/ELEMENT=TMAX/*.parquet"
}
```

- `resource` is a file, a glob (`*`, `**`, `{a,b}`), or a comma-separated list. The format comes from the extension
  (`.parquet`, `.csv`, `.tsv`, `.ndjson`/`.jsonl`/`.json`; `.gz`/`.zst` compression for text formats). Set
  `"settings": {"format": "csv"}` for extensionless or mixed resources. Use one format per dataset.
- The schema is inferred (Parquet metadata, sampled rows for text formats). Hive-style `key=value` path segments become
  columns (`STATION`, `ELEMENT` above).
- Declare types or rename columns with `mappings` (`dynamic: false` makes the declaration the complete schema):
  `"mappings": {"dynamic": false, "properties": {"@timestamp": {"type": "date", "path": "DATE", "format": "yyyyMMdd"}, "value": {"type": "long", "path": "DATA_VALUE"}}}`.
- Dataset names share a namespace with indices, aliases, and views. `GET /_query/dataset[/<name>]` lists definitions.
  Delete datasets before their data source (`DELETE /_query/dataset/<name>`), or the data source delete returns 409.

**Discover schema:** datasets do not appear in `GET /_cat/indices`, `GET /{index}/_mapping`, `_field_caps`, or
`_resolve/index`. List them with `GET /_query/dataset` and read the columns with `FROM <dataset> | LIMIT 0`.

**Query:** every processing command that works on an index works on a dataset (`WHERE`, `EVAL`, `STATS`, `INLINE STATS`,
`SORT`, `KEEP`, `MV_EXPAND`, `FORK`, `CHANGE_POINT`, `SAMPLE`, subqueries).

```esql
FROM noaa_tmax
| WHERE DATE >= "20200101"
| EVAL year = SUBSTRING(DATE, 1, 4), tmax_c = DATA_VALUE / 10.0
| STATS avg_tmax_c = ROUND(AVG(tmax_c), 1), max_tmax_c = MAX(tmax_c) BY year
| SORT year
```

Every query reads from S3 (only listings and schemas are cached). Add `WHERE`, `KEEP`, and `LIMIT`: Parquet pushes
filters and column selection into the reader, while CSV and NDJSON read whole rows. Filters on Hive partition columns
skip files when they come before any `STATS`, `SORT`, or `LIMIT`.

**Combine with local data:**

```esql
// Enrich S3 rows from a lookup index: the dataset is the source, the lookup index is the target
FROM noaa_daily
| WHERE ELEMENT IN ("TMAX", "TMIN") AND DATE >= "20240101"
| LOOKUP JOIN noaa_elements ON ELEMENT
| STATS avg_value = ROUND(AVG(DATA_VALUE * scale), 1) BY element_name

// Union a dataset with an index; columns missing from one source are null
FROM noaa_tmax, noaa_elements METADATA _index
| KEEP _index, ELEMENT, DATE, element_name
| LIMIT 10
```

Subqueries (`FROM idx, (FROM dataset | ...)`), `WHERE x IN (FROM idx | KEEP x)` over a dataset, and
[views](#views-preview-94) whose query reads a dataset also work.

**Limitations and gotchas (9.5):**

- Not supported on datasets: `TS`, `KNN`, `QSTR`, `KQL`, `LOOKUP JOIN` with a dataset as the lookup target,
  cross-cluster datasets, DLS/FLS on the dataset's `read` grant, more than 8 sources in one `FROM`, and
  snapshot/restore.
- `MATCH` runs as a row-by-row scan and dataset rows get no `_score`. Inferred strings are `keyword`, so `MATCH` matches
  whole values; use `LIKE`/`RLIKE` for substrings or declare the column as `text` in `mappings`.
- `METADATA _index` returns the dataset name; `_file.path`, `_file.name`, `_file.size`, and `_file.modified` identify
  the source file. `_name` and `_class` are 9.6+. Grouping directly on a metadata column (`STATS ... BY _index`) fails
  with HTTP 500 on 9.5; copy it first: `EVAL src = CONCAT(_index, "") | STATS n = COUNT(*) BY src`.
- On 9.5, wildcard patterns such as `FROM noaa*` also match datasets (9.6 needs `SET wildcards_match_datasets = true`).
  Name datasets explicitly. Columns whose types conflict across matched sources become `unsupported`.
- Inferred types depend on the format: the same NOAA `DATE` column is `keyword` in Parquet and `integer` in CSV, and
  empty CSV cells read as `""` rather than null. Check with `LIMIT 0` before comparing or joining.
- Parquet `MAP`, nested `LIST`, and `VARIANT` columns read as null; `STRUCT` fields flatten to dotted names.
- Datasets that span files default to `schema_resolution: union_by_name` in 9.5 (9.6 defaults to `first_file_wins`).

---

## Processing Commands

Processing commands transform the input table.

### WHERE

Filters rows based on a boolean condition.

**Syntax:**

```esql
WHERE condition
```

**Examples:**

```esql
FROM employees
| WHERE salary > 50000

FROM logs-*
| WHERE status_code >= 400 AND status_code < 500

FROM events
| WHERE message LIKE "*error*"

FROM users
| WHERE name RLIKE "J.*n"

FROM data
| WHERE field IS NOT NULL
```

**WHERE IN / NOT IN with subqueries (preview 9.5; Stack and Serverless):**

Filter rows by checking whether a field value exists in a reference dataset returned by another ES|QL expression. The
subquery must return exactly one column. Use it for allow lists and deny lists (known-good IPs, blocked users, exception
lists) when no columns from the reference set are needed; use `LOOKUP JOIN` when you also need its columns. Since 9.5.2,
when the subquery folds to an empty set (e.g. `WHERE false`), `IN` returns no rows and `NOT IN` keeps all rows.

```esql
// Exclude events from known-safe IPs
FROM logs-*
| WHERE source.ip NOT IN (FROM allowed_ips | KEEP ip)
| STATS count = COUNT(*) BY source.ip
| SORT count DESC

// Filter to users in an active user list
FROM events
| WHERE user.id IN (FROM active_users | KEEP user_id)
```

> **Note:** `WHERE field IN ("val1", "val2")` with literal values continues to work as before (all versions). The
> subquery form `WHERE field IN (FROM ... | KEEP ...)` is new in 9.5.

**NULL handling (three-valued logic):** ES|QL follows SQL-style three-valued logic. Comparisons involving `NULL`
evaluate to _unknown_, not `true` or `false`. This means `WHERE field != "value"` silently excludes rows where `field`
is `NULL` (missing). This differs from DSL, KQL, EQL, and Splunk, where negation typically includes missing fields.

To include `NULL` rows in negation filters, add an explicit `IS NULL` check:

```esql
// WRONG: silently drops rows where user.name is NULL
FROM logs-*
| WHERE user.name != "admin"

// CORRECT: includes rows where user.name is missing
FROM logs-*
| WHERE user.name != "admin" OR user.name IS NULL
```

### EVAL

Adds or replaces columns with calculated values.

**Syntax:**

```esql
EVAL column1 = expression1 [, column2 = expression2, ...]
```

**Examples:**

```esql
FROM employees
| EVAL annual_salary = monthly_salary * 12

FROM logs
| EVAL duration_ms = end_time - start_time
| EVAL duration_sec = duration_ms / 1000

FROM data
| EVAL full_name = CONCAT(first_name, " ", last_name)
| EVAL is_adult = age >= 18
```

### STATS ... BY

Aggregates data, optionally grouped by columns.

**Syntax:**

```esql
STATS aggregation1 [WHERE filter1] [, aggregation2 [WHERE filter2], ...] [BY grouping1, grouping2, ...]
```

**Examples:**

```esql
// Simple count
FROM logs-*
| STATS count = COUNT(*)

// Multiple aggregations
FROM sales
| STATS
    total = SUM(amount),
    avg_amount = AVG(amount),
    max_amount = MAX(amount)

// Grouped aggregation
FROM logs-*
| STATS count = COUNT(*) BY status_code

// Multiple groupings
FROM sales
| STATS total = SUM(amount) BY region, product_category

// Time-based grouping
FROM logs-*
| STATS count = COUNT(*) BY bucket = DATE_TRUNC(1 hour, @timestamp)

// Per-aggregation WHERE filters (8.16+) — conditional metrics in a single pass
FROM logs-*
| STATS
    total = COUNT(*),
    errors = COUNT(*) WHERE level == "error",
    warnings = COUNT(*) WHERE level == "warning"
  BY service.name

// Cluster semi-structured text into categories of similar format (requires Platinum license)
FROM logs-*
| STATS count = COUNT(*) BY category = CATEGORIZE(message)

// Control the clustering threshold: (1-100): Lower -> less clusters, default=70
FROM logs-*
| STATS count = COUNT(*) BY category = CATEGORIZE(message, {"similarity_threshold": 85})

// Use token output format and a custom analyzer
FROM logs-*
| STATS count = COUNT(*) BY category = CATEGORIZE(message, {"output_format": "tokens", "analyzer": "standard"})
```

### INLINE STATS ... BY

Aggregates data like `STATS`, but preserves all original columns and appends the aggregated values as new columns. The
output has the same number of rows as the input. Tech preview in 9.2, GA in 9.3.

**Syntax:**

```esql
INLINE STATS aggregation1 [WHERE filter1] [, aggregation2 [WHERE filter2], ...] [BY grouping1, grouping2, ...]
```

**Key differences from STATS:**

- `STATS` replaces the input table with aggregation results (fewer rows)
- `INLINE STATS` keeps every input row and adds the aggregated values as new columns

**Examples:**

```esql
// Add each employee's group max salary alongside their own salary
FROM employees
| KEEP emp_no, languages, salary
| INLINE STATS max_salary = MAX(salary) BY languages

// Add a global aggregation to every row (no BY clause)
FROM employees
| KEEP emp_no, salary
| INLINE STATS avg_salary = AVG(salary)
| WHERE salary > avg_salary

// Filter rows per aggregation with WHERE
FROM employees
| KEEP emp_no, salary
| INLINE STATS
    avg_low = ROUND(AVG(salary)) WHERE salary < 50000,
    avg_high = ROUND(AVG(salary)) WHERE salary >= 50000
```

**Use cases:**

- Compare individual values against group averages or totals
- Calculate percentages of group totals without a separate query
- Replaces some patterns that would require subqueries in SQL

**Limitations:**

- Cannot use `FORK` or `LIMIT` before `INLINE STATS`
- `CATEGORIZE` grouping function is not supported

### KEEP

Keeps only specified columns.

**Syntax:**

```esql
KEEP column1 [, column2, ...]
```

**Examples:**

```esql
FROM employees
| KEEP first_name, last_name, salary

// With wildcards
FROM logs-*
| KEEP @timestamp, message, error.*
```

### DROP

Removes specified columns.

**Syntax:**

```esql
DROP column1 [, column2, ...]
```

**Examples:**

```esql
FROM employees
| DROP internal_id, temp_field

// With wildcards
FROM data
| DROP temp_*, debug_*
```

### RENAME

Renames columns.

**Syntax:**

```esql
RENAME old_name AS new_name [, old_name2 AS new_name2, ...]
```

**Examples:**

```esql
FROM employees
| RENAME emp_id AS employee_id

FROM data
| RENAME col1 AS column_one, col2 AS column_two
```

### SORT

Sorts the table.

**Syntax:**

```esql
SORT column1 [ASC/DESC] [NULLS FIRST/LAST] [, column2 ...]
```

**Examples:**

```esql
FROM employees
| SORT salary DESC

FROM logs-*
| SORT @timestamp DESC, severity ASC

FROM data
| SORT value ASC NULLS LAST
```

### LIMIT

Limits the number of rows returned. `LIMIT ... BY` (preview 9.4; Stack and Serverless) adds grouped top-N.

**Syntax:**

```esql
LIMIT number
LIMIT number BY field
```

**Examples:**

```esql
FROM logs-*
| SORT @timestamp DESC
| LIMIT 100

// Grouped top-N: keep top 3 rows per service after sorting
FROM app_logs
| STATS cnt = COUNT(*) BY service, level
| SORT cnt DESC
| LIMIT 3 BY service
```

> **Note:** In `LIMIT n BY field`, the number comes **before** `BY`. `LIMIT BY field n` does not parse.

### DEDUP (preview; Serverless only)

Removes rows that are identical across **all** columns in scope, keeping one per combination (nulls compare equal). It
takes no arguments and is equivalent to `LIMIT 1 BY <all columns>`, so `KEEP` the columns that define a duplicate first.
Not available on Stack 9.5 (parse error): there, use `LIMIT 1 BY cols` (9.4+; `SORT` first to choose which row each
group keeps) or `STATS BY cols` (any version). `DEDUP` fails on `aggregate_metric_double`, counter, and `date_range`
columns, and full-text functions such as `MATCH` cannot follow it.

```esql
// Serverless: unique host/service pairs
FROM logs-test
| KEEP host.name, service.name
| DEDUP

// Stack 9.4+: newest row per host/service pair
FROM logs-test
| SORT @timestamp DESC
| LIMIT 1 BY host.name, service.name
| KEEP host.name, service.name, @timestamp

// Any version
FROM logs-test
| STATS BY host.name, service.name
```

### DISSECT

Extracts structured fields from a string using a pattern.

**Syntax:**

```esql
DISSECT field "%{pattern}"
```

**Examples:**

```esql
FROM logs
| DISSECT message "%{clientip} - - [%{timestamp}] \"%{method} %{path}\""

FROM apache_logs
| DISSECT message "%{ip} %{} %{} [%{timestamp}] \"%{request}\" %{status} %{bytes}"
```

**Cookbook — Common DISSECT Patterns:**

```esql
// Extract email domain
FROM customers
| DISSECT email "%{local}@%{domain}"
| STATS count = COUNT(*) BY domain

// Parse HTTP method and path from log messages like "GET /api/users HTTP/1.1"
FROM logs
| DISSECT message "%{method} %{path} %{protocol}"
| WHERE method IS NOT NULL
| KEEP @timestamp, method, path

// Extract key-value pairs from structured strings like "user=admin action=login"
FROM audit_logs
| DISSECT message "%{key1}=%{val1} %{key2}=%{val2}"
```

**Limitations:** DISSECT does not support
[reference keys](https://www.elastic.co/docs/reference/query-languages/esql/esql-process-data-with-dissect-grok#esql-dissect-limitations)
(e.g., `%{*key}` / `%{&key}` for dynamic key-value extraction).

### GROK

Extracts fields using grok patterns (regex-based).

**Syntax:**

```esql
GROK field "%{PATTERN:field_name}"
```

**Common Patterns:**

- `%{IP:ip}` - IP address
- `%{NUMBER:num}` - Number
- `%{WORD:word}` - Word
- `%{DATA:data}` - Any data (non-greedy)
- `%{GREEDYDATA:text}` - Any data (greedy)
- `%{TIMESTAMP_ISO8601:ts}` - ISO timestamp

**Examples:**

```esql
FROM logs
| GROK message "%{IP:client_ip} %{WORD:method} %{NUMBER:status:int}"

FROM web_logs
| GROK agent "%{WORD:browser}/%{NUMBER:version}"
```

**Limitations:** ES|QL GROK does not support
[custom patterns](https://www.elastic.co/docs/reference/query-languages/esql/esql-process-data-with-dissect-grok#esql-custom-patterns)
or [multiple pattern matching](https://www.elastic.co/docs/reference/enrich-processor/grok-processor#trace-match). Only
built-in grok patterns are available.

### LOOKUP JOIN

Joins data from a lookup index onto the current results. The preferred way to enrich query results with data from
another index. GA in 8.19/9.1.

**Syntax:**

```esql
LOOKUP JOIN lookup_index ON join_field
```

**Key behavior:**

- Performs a LEFT OUTER JOIN — all rows from the source are preserved; unmatched rows get `NULL` for lookup fields
- The lookup index must use `index.mode: lookup` (single shard, max 2B docs)
- Supports multi-field joins (9.2+) and mixed numeric types
- Updates to the lookup index are reflected immediately in subsequent queries
- **Name collisions:** If a lookup field has the same name as an existing source column, the lookup value overwrites it.
  Use `RENAME` before the join to preserve the original column when needed.

**Examples:**

```esql
// Enrich logs with user metadata
FROM logs-*
| LOOKUP JOIN users ON user.id

// Add product details to order data
FROM orders
| LOOKUP JOIN products ON product_id
| STATS revenue = SUM(price * quantity) BY product_name

// Enrich security events with threat intelligence
FROM security-events
| LOOKUP JOIN threat_intel ON source.ip
| WHERE threat_level == "high"
```

**Multi-field joins (9.2+):**

```esql
// Join on multiple fields — match service, environment, and version
FROM application_logs
| LOOKUP JOIN service_registry ON service_name, environment, version
```

**Complex join predicates with expressions (9.2+ tech preview):**

```esql
// Range-based join — find the SLA threshold for each service's response time
FROM app_metrics
| LOOKUP JOIN sla_thresholds ON service == service_name AND response_time_ms >= threshold_min

// Date-range join — find the pricing policy active at measurement time
FROM meter_readings
| LOOKUP JOIN customers ON customer_id
| LOOKUP JOIN pricing_policies ON region_id == region AND measurement_date >= valid_from AND measurement_date < valid_to
| EVAL due_amount = usage * price_per_unit
```

**Lucene-pushable predicates in joins (9.3+ tech preview):**

Full-text functions and other Lucene-pushable predicates (`MATCH`, `QSTR`, `KQL`, `LIKE`, `STARTS_WITH`) can be applied
to lookup index fields in the `ON` clause, enabling search-style joins.

```esql
// Full-text search against lookup index fields
FROM support_tickets
| LOOKUP JOIN knowledge_base ON MATCH(article_content, issue_description) AND product == product_name

// Combine text search with equality join
FROM error_logs
| LOOKUP JOIN runbooks ON QSTR("title:timeout OR title:connection") AND service == service_name
```

### ENRICH

Enriches data using a pre-configured enrich policy. On clusters with 8.18+, prefer `LOOKUP JOIN` — it requires no policy
setup and reflects changes immediately. On clusters **before 8.18**, `ENRICH` is the only option for data enrichment. If
no enrich policy exists, suggest the user create one (see [Generation Tips](generation-tips.md#lookup-join-and-enrich)
for setup steps).

**Syntax:**

```esql
ENRICH policy_name ON match_field [WITH new_field1, new_field2, ...]
```

**Examples:**

```esql
FROM logs
| ENRICH geo_policy ON client_ip WITH country, city

FROM sales
| ENRICH products_policy ON product_id WITH product_name, category
```

### CHANGE_POINT

Detects spikes, dips, and change points in a metric. Requires a Platinum license. Tech preview in 8.19/9.1, GA in 9.2.

**Syntax:**

```esql
CHANGE_POINT value [ON key] [AS type_name, pvalue_name] [BY group1[, ..., groupN]]
```

- `value` -- the metric field to analyze for change points
- `key` -- the field to order by (typically a date or sequence); defaults to `@timestamp`
- `BY` (GA 9.5) -- detect change points independently per group; the 22-value minimum and 1,000-value cap apply per
  group
- `type_name` -- output column for the type of change (`step_change`, `distribution_change`, `trend_change`, `dip`,
  `spike`, `non_stationary`, `stationary`, `no_change`)
- `pvalue_name` -- output column for the p-value (statistical significance)

**Examples:**

```esql
// Detect change points in error rates over time
FROM logs-*
| STATS error_count = COUNT(*) WHERE level == "error" BY hour = DATE_TRUNC(1 hour, @timestamp)
| SORT hour
| CHANGE_POINT error_count ON hour AS change_type, p_value

// Find significant changes in response times
FROM metrics
| STATS avg_latency = AVG(response_time) BY minute = DATE_TRUNC(1 minute, @timestamp)
| SORT minute
| CHANGE_POINT avg_latency ON minute

// Per-group detection (9.5+): one change point series per log level
FROM logs-*
| STATS c = COUNT(*) BY t = BUCKET(@timestamp, 1 hour), level
| SORT t
| CHANGE_POINT c ON t BY level
| WHERE type IS NOT NULL
```

### FORK

Creates multiple execution branches that operate on the same input data and combines results into a single output table.
A `_fork` column identifies which branch each row came from. Preview from 9.1 to 9.3, **GA since 9.4**.

**Syntax:**

```esql
FORK ( processing_commands ) ( processing_commands ) [... ( processing_commands )]
```

**Constraints:**

- Maximum 8 branches
- Each branch defaults to `LIMIT 1000` if no LIMIT is specified
- Columns with the same name must have the same type across branches; missing columns are filled with null
- Cannot use remote cluster references with FORK
- Only one FORK per query

**Examples:**

```esql
// Run different aggregations on the same data
FROM logs-*
| FORK
    ( WHERE level == "error" | STATS errors = COUNT(*) BY service.name )
    ( WHERE level == "warning" | STATS warnings = COUNT(*) BY service.name )

// Compare different time windows
FROM metrics
| FORK
    ( WHERE @timestamp > NOW() - 1 hour | STATS recent_avg = AVG(cpu) )
    ( WHERE @timestamp > NOW() - 24 hours | STATS daily_avg = AVG(cpu) )
| SORT _fork

// Search with multiple strategies — combine full-text and keyword matches
FROM articles METADATA _score
| FORK
    ( WHERE MATCH(content, "elasticsearch performance") | SORT _score DESC | LIMIT 10 )
    ( WHERE MATCH_PHRASE(title, "search optimization") | SORT _score DESC | LIMIT 10 )
    ( WHERE category == "guides" AND tags : "elasticsearch" | SORT published_date DESC | LIMIT 10 )
| KEEP _fork, title, _score, published_date
```

### FUSE

Merges rows from multiple result sets (typically from FORK branches) and assigns new relevance scores. Preview from 9.2
to 9.4, **GA since 9.5**.

**Syntax:**

```esql
FUSE method SCORE BY score_column GROUP BY group_column KEY BY key_columns [WITH options]
```

Backquote a column literally named `score`, `key`, or `group` when it follows `SCORE BY`, `KEY BY`, or `GROUP BY`
(`` SCORE BY `score` ``); the bare word is parsed as the clause keyword.

**Methods:**

- `rrf` — Reciprocal Rank Fusion. Combines ranked lists by reciprocal rank; no score normalization needed.
- `linear` — Linear combination of scores. Supports `normalizer` and per-branch `weights`.

**LINEAR options:**

| Option       | Type    | Default | Description                                              |
| ------------ | ------- | ------- | -------------------------------------------------------- |
| `normalizer` | keyword | —       | Score normalization method; `minmax` maps scores to 0–1  |
| `weights`    | object  | equal   | Per-branch weights (e.g. `{"fork1": 0.7, "fork2": 0.3}`) |

**Examples:**

```esql
// RRF fusion (default)
FROM articles METADATA _score, _id
| FORK
    ( WHERE MATCH(content, "elasticsearch") | SORT _score DESC | LIMIT 50 )
    ( WHERE MATCH(title, "search guide") | SORT _score DESC | LIMIT 50 )
| FUSE rrf SCORE BY _score KEY BY _id
| LIMIT 10

// LINEAR fusion with minmax normalization and custom weights
FROM articles METADATA _id, _index, _score
| FORK
    ( WHERE MATCH(content, "elasticsearch") | SORT _score DESC | LIMIT 50 )
    ( WHERE semantic_content : "how does elasticsearch work" | SORT _score DESC | LIMIT 50 )
| FUSE linear WITH { "normalizer": "minmax", "weights": { "fork1": 0.7, "fork2": 0.3 } }
| SORT _score DESC
| LIMIT 10
```

### RERANK

Uses an inference model to re-score an initial set of documents. Preview 9.2, GA 9.4. Since 9.3, defaults to 1000 rows;
configurable via `esql.command.rerank.limit` and `esql.command.rerank.enabled` cluster settings.

**Syntax:**

```esql
RERANK [column =] query ON field [, field, ...] [WITH { "inference_id": "endpoint" [, "timeout": "1m"] }]
```

`"timeout"` (9.5+) takes a duration string such as `"500ms"`, `"30s"`, or `"1m"` and bounds each inference request
`RERANK` sends (rows go out in batches of 10), not the whole query. It is the same limit as the `_inference` API's
`timeout` parameter and defaults to 30s, the inference default for the `rerank` task type. Exceeding it fails the query
with `timeout_exception` ("Request timed out after [...]"); on ML-node endpoints it also bounds the wait for the model
deployment to start (`model_deployment_timeout_exception`).

`RERANK` overwrites `_score` but does not re-sort rows, so add `SORT _score DESC` after it. The endpoint needs the
`rerank` task type; without `WITH`, the default is `.rerank-v1-elasticsearch`. Endpoints that run on ML nodes, like that
default, can fail the first call after idle with a "waiting for trained model deployment" timeout after 30s (or the
`"timeout"` value); retry.

**Example:**

```esql
FROM articles METADATA _score
| WHERE MATCH(content, "elasticsearch performance")
| SORT _score DESC
| LIMIT 100
| RERANK "how to improve elasticsearch performance" ON content WITH { "inference_id": "my-rerank-model" }
| SORT _score DESC
| LIMIT 10
```

### COMPLETION

Sends prompts and context to a Large Language Model (LLM) using a `completion` inference endpoint. Preview in 8.19/9.1,
**GA since 9.3**. Requires Platinum license.

**Syntax:**

```esql
COMPLETION [column =] prompt WITH { "inference_id": "endpoint" [, "timeout": "1m"] }
```

- `column` -- optional output column; defaults to `completion`
- `"inference_id"` -- endpoint with the `completion` task type; `chat_completion` endpoints are rejected (for example,
  use `.google-gemini-3.1-flash-lite-completion`, not `.google-gemini-3.1-flash-lite-chat_completion`)
- `"timeout"` (9.5+) -- duration string such as `"30s"` or `"1m"`, meant to bound each per-row inference request. As of
  9.5.5 and Serverless the value is validated but not applied, so requests always use the default: 120s in 9.5, 30s in
  9.3–9.4

Since 9.3, `COMPLETION` processes at most 100 rows by default (`esql.command.completion.limit`); every row is a separate
LLM call, so filter and `LIMIT` first. The positional form `COMPLETION prompt WITH my_endpoint` was 9.1 preview only and
is a parse error on current versions.

**Example:**

```esql
FROM support_tickets
| WHERE status == "open"
| LIMIT 20
| EVAL prompt = CONCAT("Summarize this ticket: ", description)
| COMPLETION summary = prompt WITH { "inference_id": "my_llm_endpoint" }
| KEEP ticket_id, summary
```

### SAMPLE

Samples a random fraction of rows from the input table. Preview from 8.19/9.1 to 9.4, **GA since 9.5**.

**Syntax:**

```esql
SAMPLE probability
```

- `probability` -- value between 0 and 1 (exclusive), the chance each row is included

Use `SAMPLE` for "random sample" or "random subset" requests (add `LIMIT n` for a row count). ES|QL has no `RANDOM()`
function.

**Example:**

```esql
// Sample ~10% of rows for exploratory analysis
FROM logs-*
| SAMPLE 0.1
| STATS avg_duration = AVG(duration) BY service.name
```

`SAMPLE` can be used as a manual alternative to automatic [query approximation](query-approximation.md) when you need
control over sampling or an aggregation that approximation does not support (e.g. `COUNT_DISTINCT`). Unlike
`SET approximation`, it performs **no** extrapolation or confidence interval computation — accounting for sampling bias
is your responsibility.

### MV_EXPAND

Expands multivalued fields into separate rows.

**Syntax:**

```esql
MV_EXPAND field
```

**Examples:**

```esql
FROM data
| MV_EXPAND tags
| STATS count = COUNT(*) BY tags
```

### IP_LOCATION (preview 9.5; Stack and Serverless)

Query-time GeoIP enrichment using MaxMind or IPinfo databases — the query-time equivalent of the GeoIP ingest processor.
A pipe command (like `DISSECT`/`GROK`), not a scalar function. The input is an `ip` or a string containing an IP.

**Syntax:**

```esql
IP_LOCATION prefix = ip_expression [WITH { option = value [, ...] }]
```

**Default output columns** (default `GeoLite2-City.mmdb` database): `prefix.country_iso_code`, `prefix.country_name`,
`prefix.continent_name`, `prefix.region_iso_code`, `prefix.region_name`, `prefix.city_name`, `prefix.location`
(`geo_point`). There is no `timezone` column by default, and ASN fields (`asn`, `organization_name`, `network`) come
only from the ASN database. Unknown IPs produce `null` in every column.

**WITH options:**

- `database_file` -- database to use (default `GeoLite2-City.mmdb`; also `GeoLite2-Country.mmdb`, `GeoLite2-ASN.mmdb`,
  GeoIP2/IPinfo variants, or a custom database registered via the IP geolocation database API)
- `properties` -- list of properties to return (non-empty); a subset reduces work, and non-default properties such as
  `timezone`, `postal_code`, or `continent_code` must be requested here
- `first_only` -- `true` (default) uses the first value of a multi-value input; `false` returns `null` with a warning

**Examples:**

```esql
// Enrich source IPs with geographic information
FROM logs-*
| IP_LOCATION geo = source.ip
| KEEP source.ip, geo.country_name, geo.city_name, geo.location

// Count events by country, resolving only the needed property
FROM firewall_logs
| IP_LOCATION geo = source.ip WITH { "properties": ["country_name"] }
| STATS events = COUNT(*) BY geo.country_name
| SORT events DESC

// ASN / owning organization of each IP
FROM firewall_logs
| IP_LOCATION asn = source.ip WITH { "database_file": "GeoLite2-ASN.mmdb" }
| STATS events = COUNT(*) BY asn.organization_name
```

The first `IP_LOCATION` query triggers a one-time database download; until it completes, `keyword` columns hold the
sentinel `_ip_location_database_unavailable_<database_file>`.

> **When to use:** `IP_LOCATION` enriches at query time with no ingest pipeline configuration needed. It always uses the
> latest GeoIP database without re-indexing. Prefer ingest-time GeoIP enrichment when geographic data is needed
> frequently and query-time overhead matters.

### METRICS_INFO

Returns one row per distinct metric available in the targeted time series data stream(s), with applicable dimensions and
metadata. Use it to discover the metric catalogue without inspecting index mappings or calling the field capabilities
API. **GA since 9.4** (and on Elastic Cloud Serverless).

**Syntax:**

```esql
METRICS_INFO
```

Takes no parameters.

**Output columns** (all `keyword`):

- `metric_name` — the metric field name (single-valued)
- `data_stream` — data stream(s) containing this metric (multi-valued when several streams align on
  unit/metric_type/field_type)
- `unit` — declared unit from field mapping (e.g., `bytes`, `packets`); may be `null` or multi-valued
- `metric_type` — `counter`, `gauge`, or `histogram` (multi-valued when definitions differ across backing indices)
- `field_type` — Elasticsearch field type (e.g., `long`, `double`, `histogram`, `exponential_histogram`, `tdigest`)
- `dimension_fields` — union of dimension field names across all time series for that metric

**Restrictions:**

- Can only be used after a `TS` source command — `FROM | METRICS_INFO` is rejected.
- Must appear before pipeline-breaking commands (`STATS`, `SORT`, `LIMIT`).
- The output replaces the original table — downstream commands operate on the metadata rows, not the raw documents.

**Examples** (`TRANGE` is omitted below for brevity — always add `| WHERE TRANGE(...)` after `TS` so discovery scans a
bounded window):

```esql
// List every metric in a TSDS, alphabetically
TS k8s
| METRICS_INFO
| SORT metric_name

// Narrow to metrics that have data matching a filter, then keep only key columns
TS k8s
| WHERE cluster == "prod"
| METRICS_INFO
| KEEP metric_name, metric_type
| SORT metric_name

// Count metrics by type
TS k8s
| METRICS_INFO
| STATS metric_count = COUNT(*) BY metric_type
| SORT metric_type

// Find metrics matching a name pattern
TS k8s
| METRICS_INFO
| WHERE metric_name LIKE "network.eth0*"
| SORT metric_name
```

### TS_INFO

Returns one row per (metric, time series) combination in the targeted TSDS, including the dimension key/value pairs that
identify each series. Use it to enumerate the actual time series — and their labels — that exist for each metric. **GA
since 9.4** (and on Elastic Cloud Serverless).

**Syntax:**

```esql
TS_INFO
```

Takes no parameters.

**Output columns** (all `keyword`):

- All columns from `METRICS_INFO` (`metric_name`, `data_stream`, `unit`, `metric_type`, `field_type`,
  `dimension_fields`)
- `dimensions` — JSON-encoded object with the dimension key/value pairs identifying the time series, e.g.
  `{"job":"elasticsearch","instance":"instance_1"}`. Single-valued.

**Restrictions:**

- Can only be used after a `TS` source command — `FROM | TS_INFO` is rejected.
- Must appear before pipeline-breaking commands (`STATS`, `SORT`, `LIMIT`).
- The output replaces the original table — downstream commands operate on the metadata rows, not the raw documents.

**Examples** (same as `METRICS_INFO`: always precede with `WHERE TRANGE(...)` in real queries):

```esql
// Every (metric, time series) pair in a TSDS
TS k8s
| TS_INFO
| SORT metric_name, dimensions

// Restrict to series with data matching a filter, keep only key columns
TS k8s
| WHERE cluster == "prod"
| TS_INFO
| KEEP metric_name, dimensions
| SORT metric_name, dimensions

// Filter by metadata after TS_INFO
TS k8s
| TS_INFO
| WHERE metric_type == "gauge"
| SORT metric_name, dimensions

// Count distinct time series per metric
TS k8s
| TS_INFO
| STATS series_count = COUNT(*) BY metric_name
| SORT metric_name

// Count distinct metrics per time series — useful to spot under- or over-reporting series
TS k8s
| TS_INFO
| STATS metric_count = COUNT_DISTINCT(metric_name) BY dimensions
| SORT dimensions
```

> **`METRICS_INFO` vs `TS_INFO`:** `METRICS_INFO` returns one row **per distinct metric**; `TS_INFO` returns one row
> **per (metric, time series) combination** and adds a `dimensions` column with the labels identifying each series. Use
> `METRICS_INFO` to enumerate _what_ is being measured, and `TS_INFO` to enumerate _which_ time series exist.

### URI_PARTS (preview 9.4)

Pipe command that parses a URI string into structured columns. A target prefix is **required**.

**Syntax:**

```esql
URI_PARTS target = field
```

**Output columns:** `target.domain`, `target.path`, `target.scheme`, `target.extension`, `target.port`, `target.query`,
`target.fragment`, `target.user_info`, `target.username`, `target.password`.

**Example:**

```esql
FROM web_logs
| WHERE http.response.status_code >= 400
| URI_PARTS parts = url.full
| STATS errors = COUNT(*) BY parts.domain, parts.path
| SORT errors DESC
```

### USER_AGENT (preview 9.4)

Pipe command that parses a user agent string into structured columns. A target prefix is **required**.

**Syntax:**

```esql
USER_AGENT target = field
```

**Output columns:** `target.name`, `target.version`, `target.os.name`, `target.os.version`, `target.os.full`,
`target.device.name`.

**Example:**

```esql
FROM web_logs
| USER_AGENT ua = user_agent.original
| STATS cnt = COUNT(*) BY ua.name, ua.version
```

### REGISTERED_DOMAIN (preview 9.4)

Pipe command that extracts the registered domain, top-level domain, and subdomain from a hostname. A target prefix is
**required**.

**Syntax:**

```esql
REGISTERED_DOMAIN target = field
```

**Output columns:** `target.domain` (full input), `target.registered_domain`, `target.top_level_domain`,
`target.subdomain`.

**Example:**

```esql
FROM dns_logs
| REGISTERED_DOMAIN rd = dns.question.name
| STATS queries = COUNT(*) BY rd.registered_domain
| SORT queries DESC
```

> **Note:** `URI_PARTS`, `USER_AGENT`, and `REGISTERED_DOMAIN` are **pipe commands** (like `DISSECT`/`GROK`), not scalar
> functions. The syntax `URI_PARTS(field)` does not work — use `| URI_PARTS target = field`.

### MMR (preview 9.4)

Maximal Marginal Relevance — diversifies search results by reducing redundancy among top hits. Requires a dense vector
field and a `LIMIT` before `MMR` to constrain the candidate set.

**Syntax:**

```esql
MMR query ON vector_field LIMIT n
```

**Example:**

```esql
FROM articles
| WHERE MATCH(title, "elasticsearch tuning")
| LIMIT 100
| MMR "elasticsearch performance tuning" ON content_embedding LIMIT 10
```

### TS_COLLAPSE (preview 9.5)

Collapses the expanded per-step output of a `PROMQL` command into one row per time series. Metric and step columns
become positionally aligned multi-value fields; dimension columns stay single-valued. Must appear immediately after
`PROMQL`, and the `PROMQL` range must be bounded: pass both `start` and `end` (or run from Kibana, where the date picker
supplies them) — otherwise the query fails with `TimeSeriesCollapse end must fold to a number`.

**Syntax:**

```esql
PROMQL ... | TS_COLLAPSE
```

**Example:**

```esql
PROMQL index=k8s step=1h start="2026-10-21T00:00:00Z" end="2026-10-22T00:00:00Z"
  http_rate=(sum by (host) (rate(http_requests_total)))
| TS_COLLAPSE
| KEEP host, http_rate, step
```

---

## Aggregate Functions

Used with STATS command.

| Function                            | Description                                     | Example                                          |
| ----------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| `COUNT(*)`                          | Count all rows                                  | `STATS n = COUNT(*)`                             |
| `COUNT(field)`                      | Count non-null values                           | `STATS n = COUNT(status)`                        |
| `COUNT_DISTINCT(field)`             | Count unique values                             | `STATS unique = COUNT_DISTINCT(user_id)`         |
| `SUM(field)`                        | Sum of values                                   | `STATS total = SUM(amount)`                      |
| `AVG(field)`                        | Average                                         | `STATS avg_price = AVG(price)`                   |
| `MIN(field)`                        | Minimum value                                   | `STATS min_temp = MIN(temperature)`              |
| `MAX(field)`                        | Maximum value                                   | `STATS max_score = MAX(score)`                   |
| `MEDIAN(field)`                     | Median value                                    | `STATS med = MEDIAN(response_time)`              |
| `PERCENTILE(field, p)`              | Percentile                                      | `STATS p95 = PERCENTILE(latency, 95)`            |
| `STD_DEV(field)`                    | Standard deviation                              | `STATS sd = STD_DEV(values)`                     |
| `VARIANCE(field)`                   | Variance                                        | `STATS var = VARIANCE(values)`                   |
| `VALUES(field)`                     | Collect all values (GA)                         | `STATS all_tags = VALUES(tag)`                   |
| `TOP(field, n, order)`              | Top N values                                    | `STATS top3 = TOP(score, 3, "desc")`             |
| `WEIGHTED_AVG(val, weight)`         | Weighted average                                | `STATS wavg = WEIGHTED_AVG(score, weight)`       |
| `MEDIAN_ABSOLUTE_DEVIATION(field)`  | Robust variability measure                      | `STATS mad = MEDIAN_ABSOLUTE_DEVIATION(latency)` |
| `ABSENT(field)`                     | True if no non-null values (9.2+)               | `STATS is_absent = ABSENT(error_code)`           |
| `PRESENT(field)`                    | True if any non-null values (9.2+)              | `STATS has_data = PRESENT(metric)`               |
| `SAMPLE(field, n)`                  | Collect n sample values (8.19/9.1+)             | `STATS examples = SAMPLE(message, 5)`            |
| `FIRST(field, sort_field)`          | Earliest value by sort field (9.4+)             | `STATS earliest = FIRST(message, @timestamp)`    |
| `LAST(field, sort_field)`           | Latest value by sort field (9.4+)               | `STATS latest = LAST(message, @timestamp)`       |
| `EARLIEST(field)`                   | Min `@timestamp` shorthand (9.4+)               | `STATS e = EARLIEST(@timestamp)`                 |
| `LATEST(field)`                     | Max `@timestamp` shorthand (9.4+)               | `STATS l = LATEST(@timestamp)`                   |
| `ST_CENTROID_AGG(field)`            | Spatial centroid of points                      | `STATS center = ST_CENTROID_AGG(location)`       |
| `ST_EXTENT_AGG(field)`              | Bounding box of geometries (8.18/9.0+, preview) | `STATS bbox = ST_EXTENT_AGG(location)`           |
| `SPARKLINE(agg, date, n, from, to)` | Per-bucket values of `agg` (preview 9.5)        | See example below                                |

**SPARKLINE** returns a multi-value of `agg` per date bucket (the y-axis of a sparkline), one row per group:

```esql
FROM logs-*
| STATS hourly = SPARKLINE(COUNT(*), @timestamp, 24, NOW() - 24 hours, NOW()) BY service.name
```

Use `FIRST(value, @timestamp)` / `LAST(value, @timestamp)` for "first/latest value per group" instead of
`SORT ... | LIMIT 1` or `INLINE STATS` tricks.

### Grouping Functions

Used in the `BY` clause of `STATS` and `INLINE STATS` to create dynamic groups.

| Function              | Description                                                          | Example                                               |
| --------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| `BUCKET(field, size)` | Create fixed-size buckets for numbers or dates                       | `STATS count = COUNT(*) BY b = BUCKET(price, 10)`     |
| `TBUCKET(interval)`   | Time-based bucketing (preview 9.2-9.3, GA in 9.4)                    | `STATS SUM(RATE(reqs)) BY TBUCKET(1 hour)`            |
| `WITHOUT(dim, ...)`   | Group time series by every dimension except those listed (GA in 9.4) | `STATS total = SUM(network.cost) BY WITHOUT(pod)`     |
| `CATEGORIZE(field)`   | Auto-categorize text values (8.18/9.0+, Platinum)                    | `STATS count = COUNT(*) BY cat = CATEGORIZE(message)` |

`CATEGORIZE` must be the **first** grouping key in the `BY` clause — any additional grouping must follow it. It is not
supported as an `INLINE STATS` grouping function.

**CATEGORIZE options (9.2+):**

| Option                 | Type    | Default | Description                                                       |
| ---------------------- | ------- | ------- | ----------------------------------------------------------------- |
| `similarity_threshold` | integer | `70`    | Clustering sensitivity (1–100); lower = fewer clusters            |
| `output_format`        | keyword | `regex` | Output as `regex` patterns or space-separated `tokens`            |
| `analyzer`             | keyword | field's | Override the analyzer used to tokenize text before categorization |

**BUCKET examples:**

```esql
// Numeric buckets — group prices into ranges of 50
FROM products
| STATS count = COUNT(*) BY price_range = BUCKET(price, 50)
| SORT price_range

// Date buckets — group events into 1-hour intervals
FROM logs-*
| WHERE @timestamp > NOW() - 24 hours
| STATS count = COUNT(*) BY hour = BUCKET(@timestamp, 1 hour)
| SORT hour

// Auto-sized buckets — let ES pick bucket size (target ~20 buckets)
FROM logs-*
| WHERE @timestamp > NOW() - 7 days
| STATS count = COUNT(*) BY bucket = BUCKET(@timestamp, 20, "2025-01-01", "2025-01-08")
```

---

## Time Series Aggregation Functions

Used with the `STATS` command after a `TS` source command. These functions evaluate per time series first, then
aggregate by group using an outer function (e.g., `SUM`, `AVG`). An optional second argument specifies a sliding time
window.

**Availability:** **All** time series aggregation functions are **GA since 9.4** — both the 9.2-introduced set (`RATE`,
`IRATE`, `INCREASE`, `DELTA`, `IDELTA`, `AVG_OVER_TIME`, `SUM_OVER_TIME`, `MIN_OVER_TIME`, `MAX_OVER_TIME`,
`FIRST_OVER_TIME`, `LAST_OVER_TIME`, `COUNT_OVER_TIME`, `COUNT_DISTINCT_OVER_TIME`, `PRESENT_OVER_TIME`,
`ABSENT_OVER_TIME`) and the 9.3-introduced set (`DERIV`, `PERCENTILE_OVER_TIME`, `STDDEV_OVER_TIME`,
`VARIANCE_OVER_TIME`). On clusters in 9.2-9.3 these functions are still in tech preview.

**Sliding window parameter (second argument):** in 9.2-9.3 (preview) the window must be a multiple of the `TBUCKET`
interval; **9.4+ (GA)** accepts arbitrary durations, with performance optimizations when the window is a multiple of the
bucket interval. Within a single query, you cannot mix windows smaller than the bucket interval for one metric with
windows larger than the bucket interval for another metric.

| Function                            | Description                    | Metric Types   |
| ----------------------------------- | ------------------------------ | -------------- |
| `RATE(field [, window])`            | Per-second rate of change      | counter        |
| `IRATE(field [, window])`           | Instantaneous rate of change   | counter        |
| `INCREASE(field [, window])`        | Total increase                 | counter        |
| `AVG_OVER_TIME(field [, window])`   | Average over time              | gauge, counter |
| `SUM_OVER_TIME(field [, window])`   | Sum over time                  | gauge          |
| `MIN_OVER_TIME(field [, window])`   | Minimum over time              | gauge          |
| `MAX_OVER_TIME(field [, window])`   | Maximum over time              | gauge          |
| `LAST_OVER_TIME(field [, window])`  | Last value over time           | gauge, counter |
| `FIRST_OVER_TIME(field [, window])` | First value over time          | gauge, counter |
| `COUNT_OVER_TIME(field [, window])` | Count of values over time      | gauge, counter |
| `COUNT_DISTINCT_OVER_TIME(field)`   | Distinct count over time       | gauge, counter |
| `PERCENTILE_OVER_TIME(field, p)`    | Percentile over time           | gauge          |
| `VARIANCE_OVER_TIME(field)`         | Variance over time             | gauge          |
| `STDDEV_OVER_TIME(field)`           | Standard deviation over time   | gauge          |
| `DELTA(field [, window])`           | Change in value                | gauge          |
| `IDELTA(field [, window])`          | Instantaneous change           | gauge          |
| `DERIV(field [, window])`           | Rate of change for gauges      | gauge          |
| `PRESENT_OVER_TIME(field)`          | Whether time series has data   | gauge, counter |
| `ABSENT_OVER_TIME(field)`           | Whether time series lacks data | gauge, counter |

**Grouping helpers for time series:**

- `TBUCKET(interval)` — groups results into time buckets (used in `BY` clause)
- `TRANGE(duration)` — filters to a time range (used in `WHERE` clause)

**Examples:**

```esql
// Sum of per-time-series rates, grouped by host and hour
TS metrics
| WHERE @timestamp >= NOW() - 1 hour
| STATS SUM(RATE(search_requests)) BY TBUCKET(1 hour), host

// Average rate with a 10-minute sliding window, bucketed per minute
TS metrics
| WHERE TRANGE(1 hour)
| STATS AVG(RATE(requests, 10 minutes)) BY TBUCKET(1 minute), host
```

---

## String Functions

| Function                    | Description                                      | Example                                                              |
| --------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `LENGTH(s)`                 | String length                                    | `EVAL len = LENGTH(name)`                                            |
| `CONCAT(s1, s2, ...)`       | Concatenate strings                              | `EVAL full = CONCAT(first, " ", last)`                               |
| `SUBSTRING(s, start, len)`  | Extract substring                                | `EVAL sub = SUBSTRING(text, 1, 10)`                                  |
| `LEFT(s, n)`                | Left n characters                                | `EVAL l = LEFT(text, 5)`                                             |
| `RIGHT(s, n)`               | Right n characters                               | `EVAL r = RIGHT(text, 5)`                                            |
| `TRIM(s)`                   | Remove whitespace                                | `EVAL clean = TRIM(input)`                                           |
| `LTRIM(s)`                  | Trim left                                        | `EVAL clean = LTRIM(input)`                                          |
| `RTRIM(s)`                  | Trim right                                       | `EVAL clean = RTRIM(input)`                                          |
| `TO_UPPER(s)`               | Uppercase                                        | `EVAL upper = TO_UPPER(name)`                                        |
| `TO_LOWER(s)`               | Lowercase                                        | `EVAL lower = TO_LOWER(name)`                                        |
| `REPLACE(s, old, new)`      | Replace text                                     | `EVAL fixed = REPLACE(msg, "err", "error")`                          |
| `SPLIT(s, delim)`           | Split into array                                 | `EVAL parts = SPLIT(path, "/")`                                      |
| `STARTS_WITH(s, prefix)`    | Check prefix                                     | `WHERE STARTS_WITH(url, "https")`                                    |
| `ENDS_WITH(s, suffix)`      | Check suffix                                     | `WHERE ENDS_WITH(file, ".log")`                                      |
| `CONTAINS(s, substr)`       | Check contains                                   | `WHERE CONTAINS(message, "error")`                                   |
| `LOCATE(substr, s)`         | Find position                                    | `EVAL pos = LOCATE("@", email)`                                      |
| `REVERSE(s)`                | Reverse string                                   | `EVAL rev = REVERSE(text)`                                           |
| `REPEAT(s, n)`              | Repeat string                                    | `EVAL sep = REPEAT("-", 10)`                                         |
| `SPACE(n)`                  | N spaces                                         | `EVAL spaces = SPACE(5)`                                             |
| `BIT_LENGTH(s)`             | Bit length (8.17+)                               | `EVAL bits = BIT_LENGTH(name)`                                       |
| `BYTE_LENGTH(s)`            | Byte length (8.17+)                              | `EVAL bytes = BYTE_LENGTH(name)`                                     |
| `CHUNK(field, settings)`    | Split text into chunks (9.3+, preview)           | `EVAL chunks = CHUNK(body, {"strategy":"word","max_chunk_size":50})` |
| `HASH(alg, s)`              | Hash string (8.18/9.0+)                          | `EVAL h = HASH("SHA-256", msg)`                                      |
| `MD5(s)`                    | MD5 hash (8.18/9.0+)                             | `EVAL h = MD5(content)`                                              |
| `SHA1(s)`                   | SHA-1 hash (8.18/9.0+)                           | `EVAL h = SHA1(content)`                                             |
| `SHA256(s)`                 | SHA-256 hash (8.18/9.0+)                         | `EVAL h = SHA256(content)`                                           |
| `FROM_BASE64(s)`            | Decode base64                                    | `EVAL decoded = FROM_BASE64(encoded)`                                |
| `TO_BASE64(s)`              | Encode to base64                                 | `EVAL encoded = TO_BASE64(data)`                                     |
| `URL_DECODE(s)`             | URL-decode (9.2+)                                | `EVAL decoded = URL_DECODE(url)`                                     |
| `URL_ENCODE(s)`             | URL-encode (9.2+)                                | `EVAL encoded = URL_ENCODE(text)`                                    |
| `URL_ENCODE_COMPONENT(s)`   | URL-encode for URI components (9.2+)             | `EVAL encoded = URL_ENCODE_COMPONENT(text)`                          |
| `JSON_EXTRACT(field, path)` | Extract value from JSON string (9.4+, GA in 9.5) | `EVAL name = JSON_EXTRACT(raw, "$.user.name")`                       |
| `FIELD_EXTRACT(field, key)` | Flattened sub-field as keyword (preview 9.5)     | `EVAL val = FIELD_EXTRACT(flat_field, "sub.key")`                    |

**FIELD_EXTRACT** (preview 9.5) is the only way to read a `flattened` sub-key (e.g. OTel `resource.attributes`) on 9.5+.
The root column has type `flattened` (an object of dotted keys); `labels.env` is an unknown column, and the root cannot
be sorted, compared, or passed to `MATCH` or `JSON_EXTRACT`.

- Pass the root and the dotted key exactly as stored: `FIELD_EXTRACT(labels, "k8s.namespace")` resolves both nested
  (`{"k8s":{"namespace":…}}`) and pre-dotted (`{"k8s.namespace":…}`) input. Keys are case-sensitive; brackets are
  rejected; a `$.` prefix or an object key (`"k8s"`) silently returns `null`. Missing keys return `null`.
- The result is always `keyword`. Cast before numeric comparisons or math: `TO_INTEGER(FIELD_EXTRACT(labels, "n")) > 5`.
  Comparing to an integer is a type error; comparing to a string (`> "5"`) runs but compares lexicographically.
- Filter with `==`, `IN`, `LIKE`/`RLIKE`, or `MATCH(FIELD_EXTRACT(…), "…")`. On Stack 9.5, `MATCH_PHRASE` rejects it and
  `:` only works on a column assigned with `EVAL` first; Serverless also accepts `MATCH_PHRASE` and inline `:`.
  `KQL`/`QSTR` can address sub-keys by path (`KQL("labels.team: payments")`), but their ranges are lexicographic too.

```esql
FROM k8s_events
| EVAL env = FIELD_EXTRACT(labels, "env"), retries = TO_INTEGER(FIELD_EXTRACT(labels, "retry_count"))
| WHERE env == "prod" AND retries > 5
| STATS events = COUNT(*), max_retries = MAX(retries) BY namespace = FIELD_EXTRACT(labels, "k8s.namespace")
| SORT events DESC
```

On versions before 9.5, or for fields that are not `flattened`, use `JSON_EXTRACT` on `_source` (below).

**JSON_EXTRACT with \_source — flattened field workaround:**

On versions before 9.5, ES|QL does not natively access `flattened` field sub-keys. Use `METADATA _source` with
`JSON_EXTRACT` to reach inside flattened objects. `_source` can be passed directly to `JSON_EXTRACT` — do not wrap it
with `TO_STRING()`. In 9.5+, prefer `FIELD_EXTRACT`: the `_source` path follows the original JSON shape, so
`$.labels.k8s.namespace` misses documents that wrote the pre-dotted key `"k8s.namespace"`.

```esql
FROM logs-* METADATA _source
| EVAL provider = JSON_EXTRACT(_source, "$.cloud.provider")
| STATS count = COUNT(*) BY provider
```

For a `flattened` field `labels`, read a sub-key with `JSON_EXTRACT(_source, "$.labels.key")`. Before 9.5 none of these
work: `labels.key` (unknown column), `labels["key"]` (parse error), and `JSON_EXTRACT(labels, "$.key")` (the flattened
column itself is unsupported). Cover pre-dotted keys with `COALESCE`:

```esql
FROM k8s_events METADATA _source
| EVAL ns = COALESCE(JSON_EXTRACT(_source, "$.labels.k8s.namespace"), JSON_EXTRACT(_source, "$.labels[\"k8s.namespace\"]"))
| STATS c = COUNT(*) BY ns
```

This also works for any field that exists in the raw document but has no explicit mapping.

---

## Math Functions

| Function                        | Description                       | Example                                  |
| ------------------------------- | --------------------------------- | ---------------------------------------- |
| `ABS(n)`                        | Absolute value                    | `EVAL abs_val = ABS(diff)`               |
| `ROUND(n, decimals)`            | Round                             | `EVAL rounded = ROUND(price, 2)`         |
| `FLOOR(n)`                      | Round down                        | `EVAL floored = FLOOR(value)`            |
| `CEIL(n)`                       | Round up                          | `EVAL ceiled = CEIL(value)`              |
| `SQRT(n)`                       | Square root                       | `EVAL root = SQRT(area)`                 |
| `POW(base, exp)`                | Power                             | `EVAL squared = POW(x, 2)`               |
| `EXP(n)`                        | e^n                               | `EVAL e_power = EXP(x)`                  |
| `LOG(n)`                        | Natural log                       | `EVAL ln = LOG(value)`                   |
| `LOG10(n)`                      | Log base 10                       | `EVAL log = LOG10(value)`                |
| `SIN(n)`, `COS(n)`, `TAN(n)`    | Trig functions                    | `EVAL sine = SIN(angle)`                 |
| `ASIN(n)`, `ACOS(n)`, `ATAN(n)` | Inverse trig                      | `EVAL angle = ASIN(ratio)`               |
| `PI()`                          | Pi constant                       | `EVAL circumference = 2 * PI() * radius` |
| `E()`                           | Euler's number                    | `EVAL e = E()`                           |
| `SIGNUM(n)`                     | Sign (-1, 0, 1)                   | `EVAL sign = SIGNUM(value)`              |
| `GREATEST(a, b, ...)`           | Maximum of values                 | `EVAL max = GREATEST(a, b, c)`           |
| `LEAST(a, b, ...)`              | Minimum of values                 | `EVAL min = LEAST(a, b, c)`              |
| `ATAN2(y, x)`                   | Two-argument arctangent           | `EVAL angle = ATAN2(y, x)`               |
| `CBRT(n)`                       | Cube root                         | `EVAL root = CBRT(volume)`               |
| `COSH(n)`                       | Hyperbolic cosine                 | `EVAL ch = COSH(x)`                      |
| `SINH(n)`                       | Hyperbolic sine                   | `EVAL sh = SINH(x)`                      |
| `TANH(n)`                       | Hyperbolic tangent                | `EVAL th = TANH(x)`                      |
| `HYPOT(a, b)`                   | Hypotenuse                        | `EVAL h = HYPOT(x, y)`                   |
| `TAU()`                         | Tau (2\*Pi)                       | `EVAL t = TAU()`                         |
| `COPY_SIGN(mag, sign)`          | Copy sign (8.19/9.1+)             | `EVAL v = COPY_SIGN(mag, sign)`          |
| `SCALB(d, scaleFactor)`         | Scale by power of 2 (8.19/9.1+)   | `EVAL v = SCALB(d, 3)`                   |
| `ROUND_TO(n, v1, v2, ...)`      | Round to fixed points (8.19/9.1+) | `EVAL r = ROUND_TO(val, 0, 10, 50, 100)` |

---

## Date/Time Functions

| Function                     | Description              | Example                                      |
| ---------------------------- | ------------------------ | -------------------------------------------- |
| `NOW()`                      | Current timestamp        | `WHERE @timestamp > NOW() - 1 hour`          |
| `DATE_TRUNC(interval, date)` | Truncate to interval     | `EVAL hour = DATE_TRUNC(1 hour, @timestamp)` |
| `DATE_EXTRACT(part, date)`   | Extract part             | `EVAL month = DATE_EXTRACT(month, date)`     |
| `DATE_FORMAT(pattern, date)` | Format date              | `EVAL str = DATE_FORMAT("yyyy-MM-dd", date)` |
| `DATE_PARSE(pattern, str)`   | Parse date string        | `EVAL dt = DATE_PARSE("yyyy-MM-dd", str)`    |
| `DATE_DIFF(unit, d1, d2)`    | Difference               | `EVAL days = DATE_DIFF("day", start, end)`   |
| `DAY_NAME(date)`             | Weekday name (9.2+)      | `EVAL day = DAY_NAME(@timestamp)`            |
| `MONTH_NAME(date)`           | Month name (9.2+)        | `EVAL month = MONTH_NAME(@timestamp)`        |
| `TRANGE(duration)`           | Time range filter (9.3+) | `WHERE TRANGE(1 hour)`                       |

**Time units:** `millisecond`, `second`, `minute`, `hour`, `day`, `week`, `month`, `year`

**Timespan literals:** `1 day`, `2 hours`, `30 minutes`, `1 week`

---

## Type Conversion Functions

| Function                         | Description                                        | Example                                      |
| -------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| `TO_STRING(v)`                   | Convert to string                                  | `EVAL str = TO_STRING(num)`                  |
| `TO_INTEGER(v)`                  | Convert to integer                                 | `EVAL int = TO_INTEGER(str)`                 |
| `TO_LONG(v)`                     | Convert to long                                    | `EVAL lng = TO_LONG(str)`                    |
| `TO_DOUBLE(v)`                   | Convert to double                                  | `EVAL dbl = TO_DOUBLE(str)`                  |
| `TO_BOOLEAN(v)`                  | Convert to boolean                                 | `EVAL bool = TO_BOOLEAN(str)`                |
| `TO_DATETIME(v)`                 | Convert to datetime                                | `EVAL dt = TO_DATETIME(str)`                 |
| `TO_IP(v)`                       | Convert to IP                                      | `EVAL ip = TO_IP(str)`                       |
| `TO_VERSION(v)`                  | Convert to version                                 | `EVAL ver = TO_VERSION(str)`                 |
| `TO_UNSIGNED_LONG(v)`            | Convert to unsigned long                           | `EVAL ul = TO_UNSIGNED_LONG(str)`            |
| `TO_DATEPERIOD(v)`               | Convert to date period (8.16+)                     | `EVAL dp = TO_DATEPERIOD("1 day")`           |
| `TO_TIMEDURATION(v)`             | Convert to time duration (8.16+)                   | `EVAL td = TO_TIMEDURATION("1h")`            |
| `TO_DATE_NANOS(v)`               | Convert to nanosecond date (8.18/9.0+)             | `EVAL ns = TO_DATE_NANOS(str)`               |
| `TO_DEGREES(n)`                  | Radians to degrees                                 | `EVAL deg = TO_DEGREES(rad)`                 |
| `TO_RADIANS(n)`                  | Degrees to radians                                 | `EVAL rad = TO_RADIANS(deg)`                 |
| `TO_GEOPOINT(v)`                 | Convert to geo_point                               | `EVAL pt = TO_GEOPOINT(str)`                 |
| `TO_GEOSHAPE(v)`                 | Convert to geo_shape                               | `EVAL shape = TO_GEOSHAPE(wkt)`              |
| `TO_CARTESIANPOINT(v)`           | Convert to cartesian_point                         | `EVAL pt = TO_CARTESIANPOINT(str)`           |
| `TO_CARTESIANSHAPE(v)`           | Convert to cartesian_shape                         | `EVAL shape = TO_CARTESIANSHAPE(str)`        |
| `TO_AGGREGATE_METRIC_DOUBLE(v)`  | Convert to aggregate_metric_double (9.2+, preview) | `EVAL amd = TO_AGGREGATE_METRIC_DOUBLE(val)` |
| `TO_DENSE_VECTOR(v)`             | Convert to dense_vector (9.2+, preview)            | `EVAL vec = TO_DENSE_VECTOR(arr)`            |
| `TO_GEOHASH(v)`                  | Convert to geohash (9.2+, preview)                 | `EVAL hash = TO_GEOHASH(str)`                |
| `TO_GEOHEX(v)`                   | Convert to geohex (9.2+, preview)                  | `EVAL hex = TO_GEOHEX(str)`                  |
| `TO_GEOTILE(v)`                  | Convert to geotile (9.2+, preview)                 | `EVAL tile = TO_GEOTILE(str)`                |
| `TO_TEXT(v [, {"analyzer": a}])` | Convert keyword to analyzed text (preview 9.5)     | `WHERE MATCH(TO_TEXT(note), "quota")`        |
| `TO_COUNTER(v)` / `v::counter`   | Mark numeric metric as counter (GA 9.5, TS only)   | `SUM(RATE(bytes::counter))`                  |
| `TO_GAUGE(v)` / `v::gauge`       | Mark metric as gauge (GA 9.5, TS only)             | `AVG(requests::gauge)`                       |

`TO_COUNTER` / `TO_GAUGE` only change the type annotation, for metrics whose mapping has the wrong (or no)
`time_series_metric`. Use them inside `TS ... | STATS`; `EVAL` cannot return a counter type. See
[time-series-queries.md](time-series-queries.md#counter-and-gauge-casts).

---

## IP Functions

| Function                      | Description                        | Example                                     |
| ----------------------------- | ---------------------------------- | ------------------------------------------- |
| `CIDR_MATCH(ip, block1, ...)` | Test if IP is in one or more CIDRs | `WHERE CIDR_MATCH(source.ip, "10.0.0.0/8")` |
| `IP_PREFIX(ip, v4len, v6len)` | Get the network prefix of an IP    | `EVAL prefix = IP_PREFIX(ip, 24, 64)`       |
| `TO_IP(v)`                    | Convert to IP type                 | `EVAL ip = TO_IP(ip_string)`                |

**Examples:**

```esql
// Filter to private network ranges
FROM logs-*
| WHERE CIDR_MATCH(source.ip, "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")

// Group traffic by /24 subnet
FROM network_logs
| STATS bytes = SUM(bytes_transferred) BY subnet = IP_PREFIX(source.ip, 24, 64)
| SORT bytes DESC
```

IP functions, IP comparisons, `IN (FROM …)` subqueries, and `LOOKUP JOIN` on an `ip` field reject `keyword` values
(`must be [ip], found value [client_ip] type [keyword]`). Check the mapping and convert with `TO_IP()`. An `IN` subquery
and a `LOOKUP JOIN` key need a column on the left, so assign it with `EVAL` first:

```esql
// IN (FROM …) subquery: preview 9.5+
FROM access_logs
| EVAL ip = TO_IP(client_ip)
| WHERE NOT CIDR_MATCH(ip, "10.0.0.0/8") AND ip NOT IN (FROM allowed_ips | KEEP ip)
```

---

## Spatial Functions

| Function                                | Description                         | Example                                                   |
| --------------------------------------- | ----------------------------------- | --------------------------------------------------------- |
| `ST_DISTANCE(p1, p2)`                   | Distance between points             | `EVAL dist = ST_DISTANCE(loc, TO_GEOPOINT("POINT(0 0)"))` |
| `ST_INTERSECTS(g1, g2)`                 | Geometries intersect                | `WHERE ST_INTERSECTS(geo, boundary)`                      |
| `ST_DISJOINT(g1, g2)`                   | Geometries don't intersect          | `WHERE ST_DISJOINT(geo, zone)`                            |
| `ST_CONTAINS(g1, g2)`                   | g1 contains g2                      | `WHERE ST_CONTAINS(region, point)`                        |
| `ST_WITHIN(g1, g2)`                     | g1 within g2                        | `WHERE ST_WITHIN(point, region)`                          |
| `ST_X(point)`                           | X coordinate / longitude            | `EVAL lon = ST_X(location)`                               |
| `ST_Y(point)`                           | Y coordinate / latitude             | `EVAL lat = ST_Y(location)`                               |
| `ST_ENVELOPE(geo)`                      | Bounding box (8.18/9.0+)            | `EVAL bbox = ST_ENVELOPE(shape)`                          |
| `ST_XMAX(geo)`                          | Max X / longitude (8.18/9.0+)       | `EVAL max_lon = ST_XMAX(shape)`                           |
| `ST_XMIN(geo)`                          | Min X / longitude (8.18/9.0+)       | `EVAL min_lon = ST_XMIN(shape)`                           |
| `ST_YMAX(geo)`                          | Max Y / latitude (8.18/9.0+)        | `EVAL max_lat = ST_YMAX(shape)`                           |
| `ST_YMIN(geo)`                          | Min Y / latitude (8.18/9.0+)        | `EVAL min_lat = ST_YMIN(shape)`                           |
| `ST_GEOHASH(point, prec)`               | Encode as geohash (9.2+)            | `EVAL hash = ST_GEOHASH(location, 5)`                     |
| `ST_GEOHEX(point, prec)`                | Encode as geohex (9.2+)             | `EVAL hex = ST_GEOHEX(location, 5)`                       |
| `ST_GEOTILE(point, prec)`               | Encode as geotile (9.2+)            | `EVAL tile = ST_GEOTILE(location, 10)`                    |
| `ST_NPOINTS(geo)`                       | Number of points                    | `EVAL n = ST_NPOINTS(shape)`                              |
| `ST_SIMPLIFY(geo, tol)`                 | Simplify geometry                   | `EVAL simple = ST_SIMPLIFY(shape, 100)`                   |
| `ST_DIMENSION(geo)`                     | Dimension (0/1/2) (9.4+)            | `EVAL dim = ST_DIMENSION(shape)`                          |
| `ST_GEOMETRYTYPE(geo)`                  | Geometry type string (9.4+)         | `EVAL gtype = ST_GEOMETRYTYPE(shape)`                     |
| `ST_ISEMPTY(geo)`                       | True if empty (9.4+)                | `WHERE NOT ST_ISEMPTY(shape)`                             |
| `ST_BUFFER(geo, dist)`                  | Buffer around geometry (9.4+)       | `EVAL area = ST_BUFFER(point, 1000)`                      |
| `ST_SIMPLIFYPRESERVETOPOLOGY(geo, tol)` | Simplify preserving topology (9.4+) | `EVAL s = ST_SIMPLIFYPRESERVETOPOLOGY(shape, 100)`        |
| `ST_UNION(g1, g2)`                      | Union of geometries (preview 9.5)   | `EVAL u = ST_UNION(zone_a, zone_b)`                       |
| `ST_INTERSECTION(g1, g2)`               | Shared area (preview 9.5)           | `EVAL overlap = ST_INTERSECTION(zone_a, zone_b)`          |
| `ST_DIFFERENCE(g1, g2)`                 | g1 minus g2 (preview 9.5)           | `EVAL rest = ST_DIFFERENCE(zone_a, zone_b)`               |
| `ST_SYMDIFFERENCE(g1, g2)`              | Area in exactly one (preview 9.5)   | `EVAL xor = ST_SYMDIFFERENCE(zone_a, zone_b)`             |

---

## Dense Vector Functions

For vector search and similarity operations on `dense_vector` and `semantic_text` fields.

| Function                             | Description                                          | Example                                              |
| ------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------- |
| `KNN(field, query_vec [, options])`  | K-nearest neighbor search (preview 9.2, GA 9.4)      | `WHERE KNN(embedding, query_vector, {"k": 10})`      |
| `TEXT_EMBEDDING(text, inference_id)` | Generate text embeddings (preview 9.3, GA 9.4)       | `EVAL vec = TEXT_EMBEDDING("query", "my-model")`     |
| `V_COSINE(v1, v2)`                   | Cosine similarity (preview 9.3, GA 9.4)              | `EVAL sim = V_COSINE(vec1, vec2)`                    |
| `V_DOT_PRODUCT(v1, v2)`              | Dot product (preview 9.3, GA 9.4)                    | `EVAL dot = V_DOT_PRODUCT(vec1, vec2)`               |
| `V_L1_NORM(v1, v2)`                  | L1 / Manhattan distance (preview 9.3, GA 9.4)        | `EVAL l1 = V_L1_NORM(vec1, vec2)`                    |
| `V_L2_NORM(v1, v2)`                  | L2 / Euclidean distance (preview 9.3, GA 9.4)        | `EVAL l2 = V_L2_NORM(vec1, vec2)`                    |
| `V_HAMMING(v1, v2)`                  | Hamming distance (preview 9.3, GA 9.4)               | `EVAL h = V_HAMMING(vec1, vec2)`                     |
| `EMBEDDING(value, inference_id)`     | Multimodal embeddings (text, image, …) (preview 9.5) | `EVAL vec = EMBEDDING("red running shoes", "my-mm")` |

`EMBEDDING` needs an inference endpoint with the `embedding` task type (`TEXT_EMBEDDING` needs `text_embedding`). The
input must be a literal string; set its content type with the `type` option (e.g. a base64 data URI with
`{"type": "image"}`). Both accept `{"timeout": "30s"}` (9.5+) for a per-call inference timeout.

---

## Multivalue Functions

For handling fields with multiple values.

| Function                              | Description                                      | Example                                         |
| ------------------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| `MV_COUNT(field)`                     | Count values                                     | `EVAL n = MV_COUNT(tags)`                       |
| `MV_FIRST(field)`                     | First value                                      | `EVAL first_val = MV_FIRST(values)`             |
| `MV_LAST(field)`                      | Last value                                       | `EVAL last_val = MV_LAST(values)`               |
| `MV_MIN(field)`                       | Minimum                                          | `EVAL min = MV_MIN(scores)`                     |
| `MV_MAX(field)`                       | Maximum                                          | `EVAL max = MV_MAX(scores)`                     |
| `MV_SUM(field)`                       | Sum                                              | `EVAL total = MV_SUM(amounts)`                  |
| `MV_AVG(field)`                       | Average                                          | `EVAL avg = MV_AVG(scores)`                     |
| `MV_MEDIAN(field)`                    | Median                                           | `EVAL med = MV_MEDIAN(values)`                  |
| `MV_CONCAT(field, delim)`             | Join to string                                   | `EVAL str = MV_CONCAT(tags, ", ")`              |
| `MV_DEDUPE(field)`                    | Remove duplicates                                | `EVAL unique = MV_DEDUPE(tags)`                 |
| `MV_SORT(field)`                      | Sort values                                      | `EVAL sorted = MV_SORT(values)`                 |
| `MV_SLICE(field, start, end)`         | Slice array                                      | `EVAL slice = MV_SLICE(arr, 0, 3)`              |
| `MV_ZIP(f1, f2)`                      | Zip arrays (both must be keyword/text)           | `EVAL zipped = MV_ZIP(keys, values)`            |
| `MV_APPEND(f1, f2)`                   | Concatenate MVs                                  | `EVAL all = MV_APPEND(tags1, tags2)`            |
| `MV_CONTAINS(f1, f2)`                 | All values in f2 present in f1 (9.2+)            | `EVAL has = MV_CONTAINS(perms, required)`       |
| `MV_INTERSECTION(f1, f2)`             | Values present in both (9.3+)                    | `EVAL common = MV_INTERSECTION(a, b)`           |
| `MV_INTERSECTS(f1, f2)`               | Any value in f2 present in f1 (9.4+)             | `EVAL overlap = MV_INTERSECTS(a, b)`            |
| `MV_UNION(f1, f2)`                    | Deduplicated union (9.4+)                        | `EVAL merged = MV_UNION(a, b)`                  |
| `MV_DIFFERENCE(f1, f2)`               | Values in f1 not in f2 (9.4+)                    | `EVAL diff = MV_DIFFERENCE(a, b)`               |
| `MV_PERCENTILE(field, p)`             | Percentile of MV                                 | `EVAL p95 = MV_PERCENTILE(vals, 95)`            |
| `MV_PSERIES_WEIGHTED_SUM(field, p)`   | P-series weighted sum (both args must be double) | `EVAL ws = MV_PSERIES_WEIGHTED_SUM(vals, 2.0)`  |
| `MV_MEDIAN_ABSOLUTE_DEVIATION(field)` | MAD of MV                                        | `EVAL mad = MV_MEDIAN_ABSOLUTE_DEVIATION(vals)` |

---

## Conditional Functions

| Function                          | Description              | Example                                                    |
| --------------------------------- | ------------------------ | ---------------------------------------------------------- |
| `CASE(cond1, val1, ..., default)` | Conditional              | `EVAL level = CASE(score > 90, "A", score > 80, "B", "C")` |
| `COALESCE(v1, v2, ...)`           | First non-null           | `EVAL name = COALESCE(nickname, full_name, "Unknown")`     |
| `field IS NULL`                   | Check null               | `WHERE error IS NULL`                                      |
| `field IS NOT NULL`               | Check not null           | `WHERE response IS NOT NULL`                               |
| `CLAMP(val, min, max)`            | Clamp to range (9.3+)    | `EVAL clamped = CLAMP(score, 0, 100)`                      |
| `CLAMP_MIN(val, min)`             | Clamp lower bound (9.3+) | `EVAL v = CLAMP_MIN(score, 0)`                             |
| `CLAMP_MAX(val, max)`             | Clamp upper bound (9.3+) | `EVAL v = CLAMP_MAX(score, 100)`                           |

---

## date_range Type and Functions (preview 9.5)

The `date_range` data type represents a time range with start and end bounds. Associated functions work with range
comparisons and bound extraction. `date_range` columns also work in `COUNT`, `PRESENT`, `ABSENT`, the `MV_*` functions,
and Arrow output.

| Function / Type          | Description                                   | Example                                             |
| ------------------------ | --------------------------------------------- | --------------------------------------------------- |
| `TO_DATE_RANGE(string)`  | Parse `"from..to"` string into a date_range   | `EVAL dr = TO_DATE_RANGE("2026-01-01..2026-12-31")` |
| `TO_RANGE(from, to)`     | Construct date_range from two dates           | `EVAL dr = TO_RANGE(start_date, end_date)`          |
| `RANGE_INTERSECTS(a, b)` | Check if two ranges (or range + date) overlap | `WHERE RANGE_INTERSECTS(event_window, @timestamp)`  |
| `RANGE_WITHIN(a, b)`     | Check if range a is within range b            | `WHERE RANGE_WITHIN(inner_range, outer_range)`      |
| `RANGE_CONTAINS(a, b)`   | Check if range a contains range b             | `WHERE RANGE_CONTAINS(event_window, sub_range)`     |
| `range_min(field)`       | Extract lower bound of a date_range           | `EVAL start = range_min(event_window)`              |
| `range_max(field)`       | Extract upper bound of a date_range           | `EVAL end = range_max(event_window)`                |

`RANGE_INTERSECTS` and `RANGE_WITHIN` support Lucene pushdown for efficient filtering.

**Examples:**

```esql
// Find events overlapping with the current timestamp
FROM events
| WHERE RANGE_INTERSECTS(event_window, @timestamp)
| EVAL start = range_min(event_window), end = range_max(event_window)
| KEEP event_name, start, end

// Construct a range and check containment
FROM maintenance_windows
| EVAL window = TO_RANGE(planned_start, planned_end)
| WHERE RANGE_CONTAINS(window, @timestamp)
```

---

## Full-Text Search Functions

For text search with analyzer support (available since 8.17+).

### MATCH

Basic text search.

```esql
FROM articles
| WHERE MATCH(content, "elasticsearch query")

// With options
FROM docs
| WHERE MATCH(title, "search", {"operator": "AND"})
```

### MATCH (colon operator)

Shorthand for MATCH.

```esql
FROM logs
| WHERE message : "error"
```

> **MATCH on expressions (preview 9.5):** `MATCH` and the `:` operator can search non-indexed expressions such as `EVAL`
> columns, scanning row by row instead of using the inverted index. On a `keyword` expression this is an exact-value
> match; wrap it in `TO_TEXT` for analyzed search:
> `EVAL t = TO_TEXT(CONCAT(level, " ", message)) | WHERE MATCH(t, "timeout")`. On 9.5 Stack, `MATCH`/`:` are still
> rejected after `STATS`, the `options` parameter is not supported, and expression matches score `0`. Serverless allows
> them after `STATS` (except on an indexed field, such as a plain `BY` key) and with `options`; expression matches get
> an unweighted `_score` (about `1.0` per matched term), not BM25.

### MATCH_PHRASE

Exact phrase matching. Returns documents where the field contains the exact phrase in order. GA in 8.19/9.1.

```esql
FROM articles
| WHERE MATCH_PHRASE(title, "quick brown fox")

// With slop to allow words between phrase terms
FROM articles
| WHERE MATCH_PHRASE(content, "elasticsearch query", slop=2)
```

### QSTR (Query String)

Complex queries using query string syntax.

```esql
FROM logs
| WHERE QSTR("status:error AND (type:critical OR type:warning)")
```

### KQL

Kibana Query Language support.

```esql
FROM logs
| WHERE KQL("message: error and host.name: server*")
```

### DECAY

Distance-based scoring that decays from an origin point. Works with numeric, date, and geo fields (preview 9.3).

```esql
FROM events METADATA _score
| EVAL decay_score = DECAY("gauss", @timestamp, origin=NOW(), scale="7 days")
```

### SCORE

Returns the relevance score for a row (9.3+).

```esql
FROM articles
| WHERE MATCH(content, "elasticsearch")
| EVAL relevance = SCORE()
| SORT relevance DESC
```

### TOP_SNIPPETS

Extracts best matching snippets from text fields (preview 9.3). Options: `num_snippets`, `num_words`; 9.5+ adds
`highlight`, `pre_tag`, `post_tag`, `encoder` (`default`/`html`), `order` (`score`/`none`), and `analyzer`.

```esql
FROM articles
| WHERE MATCH(content, "elasticsearch query")
| EVAL snippet = TOP_SNIPPETS(content, "elasticsearch query")

// 9.5+: highlight matched terms
FROM articles
| WHERE MATCH(content, "elasticsearch")
| EVAL snippet = TOP_SNIPPETS(content, "elasticsearch", {"num_snippets": 2, "highlight": true, "pre_tag": "<b>", "post_tag": "</b>"})
```

### Relevance Scoring

```esql
FROM articles METADATA _score
| WHERE MATCH(content, "elasticsearch")
| SORT _score DESC
| LIMIT 10
```

---

## Operators

### Comparison Operators

- `==` Equal
- `!=` Not equal
- `<`, `<=`, `>`, `>=` Comparison
- `IS NULL`, `IS NOT NULL` Null checks

### Logical Operators

- `AND` Logical AND
- `OR` Logical OR
- `NOT` Logical NOT

### Pattern Matching

- `LIKE` Wildcard pattern (`*` zero or more chars, `?` single char)
- `RLIKE` Regular expression
- `IN` Value in list

**Examples:**

```esql
WHERE name LIKE "John*"
WHERE email RLIKE ".*@example\\.com"
WHERE status IN ("active", "pending")
WHERE NOT (status == "deleted")
```

### Arithmetic Operators

- `+`, `-`, `*`, `/`, `%` (modulo)

---

## Syntax Details

### Comments

```esql
// Single line comment

/* Multi-line
   comment */

FROM logs  // inline comment
| WHERE status == 200
```

### String Literals

```esql
// Standard strings — use backslash escapes
ROW msg = "line1\nline2", path = "C:\\Users\\data"

// Triple-quoted strings — no escaping needed, can contain single quotes
ROW pattern = """field "with quotes" and \backslashes"""
```

### Numeric Literals

```esql
// Integer, decimal, scientific notation
ROW a = 123, b = 0.23, c = 2E3, d = 1.2e-3
```

### Identifiers and Escaping

Identifiers must be enclosed in backticks if:

- they don't start with a letter, `_`, or `@`
- any other character is not a letter, number, or `_`
- they clash with a reserved keyword, including when that word is a segment of a dotted name

A literal backtick inside a backtick-quoted identifier is escaped by doubling it. Quoting with backticks always works,
even when it is not required.

```esql
// Backtick-quoted identifiers for special field names
FROM index | EVAL val = `1.field`

// Escaping backticks within identifiers
FROM index | EVAL val = `field``name`

// Reserved keyword as a column alias
FROM logs-* | STATS `first` = MIN(@timestamp) BY service.name

// Reserved keyword as a segment of a dotted field name (`in` is the IN operator)
FROM metrics-* | WHERE `host.network.interface.in.utilization` IS NOT NULL
```

**Reserved keywords.** ES|QL keywords are case-insensitive, so `in`, `IN`, and `In` are the same token. Most keywords
are treated as keywords only in the corresponding context; the docs' reserved list includes `SCORE`, `KEY`, `GROUP`,
`SET`, and `SAMPLE` on that basis.

- **Never bare in an expression:** `FIRST`, `LAST`, `BY`, `IN`, `IS`, `ON`, `WITH`, `AND`, `OR`, `NOT`, `LIKE`, `RLIKE`,
  `NULL`, `TRUE`, `FALSE`, `ASC`, `DESC`, `NULLS`. They fail as `EVAL`/`STATS` aliases, in `BY`, `WHERE`, `SORT`,
  function arguments, and as dotted segments. The `KEEP`, `DROP`, and `RENAME` source name lists accept them.
- `AS` is a keyword only inside `RENAME`; `METADATA` only inside `FROM`.
- `SCORE`, `KEY`, and `GROUP` fail bare only as the column right after `FUSE ... SCORE BY`, `KEY BY`, or `GROUP BY`.
- Command names (`SET`, `SAMPLE`, `DEDUP`, `LIMIT`, `SORT`, `FUSE`, `FORK`, `RERANK`, `COMPLETION`, `CHANGE_POINT`, …)
  are keywords only as the first word of a pipe segment and work bare as column names.

Backquoting any identifier always works; backquote a name that causes an unexplained parse error.

### Timespan Literals

Supported units: `millisecond` (`ms`), `second` (`s`), `minute` (`min`), `hour` (`h`), `day` (`d`), `week` (`w`),
`month` (`mo`), `quarter` (`q`), `year` (`yr`). Plural `s` is always accepted. Whitespace between number and unit is
optional.

```esql
// Timespans are used in expressions, not as standalone values
FROM logs-*
| WHERE @timestamp > NOW() - 1 day
| STATS hourly = COUNT(*) BY bucket = DATE_TRUNC(30 minutes, @timestamp)
```

---

## Metadata Fields

Access document metadata with the `METADATA` directive on the `FROM` command. Once enabled, metadata fields behave like
regular index fields.

| Field         | Type    | Description                                                                            |
| ------------- | ------- | -------------------------------------------------------------------------------------- |
| `_id`         | keyword | Unique document ID                                                                     |
| `_index`      | keyword | Index name                                                                             |
| `_version`    | long    | Document version number                                                                |
| `_score`      | float   | Query relevance score (updated by full-text search functions)                          |
| `_ignored`    | keyword | Fields that were ignored when the document was indexed                                 |
| `_index_mode` | keyword | Index mode (`standard`, `lookup`, `logsdb`, `time_series` etc.)                        |
| `_source`     | special | Original JSON document body. Use `JSON_EXTRACT` to access flattened or unmapped fields |
| `_size`       | integer | Document size in bytes (9.4+; requires `mapper-size` plugin)                           |

```esql
FROM logs METADATA _id, _index, _version
| KEEP _id, message

// Use _score for relevance-ranked search
FROM articles METADATA _score
| WHERE MATCH(content, "elasticsearch")
| SORT _score DESC
| LIMIT 10
```

---

## Best Practices

1. **Always use LIMIT** to avoid returning too many rows
2. **Filter early** with WHERE to reduce data processed
3. **Use KEEP** to select only needed columns
4. **Use appropriate data types** for comparisons
5. **Use STATS for aggregations** instead of returning all rows
6. **Use DATE_TRUNC for time-based grouping**
7. **Leverage full-text functions** (MATCH, QSTR) for text search - much faster than LIKE/RLIKE

---

## Example Queries

### Log Analysis

```esql
FROM logs-*
| WHERE @timestamp > NOW() - 24 hours
| WHERE status_code >= 400
| STATS error_count = COUNT(*) BY status_code, host.name
| SORT error_count DESC
| LIMIT 20
```

### User Activity

```esql
FROM user_events
| WHERE event_type == "login"
| EVAL hour = DATE_TRUNC(1 hour, @timestamp)
| STATS logins = COUNT(*), unique_users = COUNT_DISTINCT(user_id) BY hour
| SORT hour DESC
```

### Performance Metrics

```esql
FROM metrics-*
| WHERE @timestamp > NOW() - 1 hour
| STATS
    avg_response = AVG(response_time),
    p95_response = PERCENTILE(response_time, 95),
    max_response = MAX(response_time)
  BY service.name
| SORT avg_response DESC
```

**Time series version (9.2+):** For TSDS indices, use `TS` to access time series aggregation functions:

```esql
TS metrics-*
| WHERE @timestamp > NOW() - 1 hour
| STATS
    SUM(RATE(request_count)) BY service.name, TBUCKET(5 minutes)
| SORT service.name
```

### Text Search with Scoring

```esql
FROM articles METADATA _score
| WHERE MATCH(content, "machine learning")
| KEEP title, author, _score
| SORT _score DESC
| LIMIT 10
```

### Data Transformation

```esql
FROM raw_logs
| GROK message "%{IP:client_ip} - %{WORD:method} %{URIPATHPARAM:path} %{NUMBER:status:int}"
| EVAL is_error = status >= 400
| STATS
    total = COUNT(*),
    errors = COUNT(CASE(is_error, 1, null))
  BY client_ip
| EVAL error_rate = ROUND(errors * 100.0 / total, 2)
| SORT error_rate DESC
```
