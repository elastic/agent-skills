# ES|QL Query Generation Tips

Guidelines for generating accurate ES|QL queries from natural language.

> **Cluster detection:** Check `build_flavor` in the `GET /` response. Serverless (`"serverless"`) reports version
> `8.11.0` but supports all latest features — do not restrict queries based on the version. For self-managed
> (`"default"`), use `version.number` for feature checks (strip `-SNAPSHOT` suffix on pre-release builds).

## Table of Contents

- [Step-by-Step Generation Process](#step-by-step-generation-process)
- [Field Name Conventions](#field-name-conventions)
- [Query Optimization Tips](#query-optimization-tips)
- [Key Patterns](#key-patterns)
- [Common Query Templates](#common-query-templates)
- [Handling Ambiguity](#handling-ambiguity)
- [Output Formatting Suggestions](#output-formatting-suggestions)

## Step-by-Step Generation Process

### 1. Identify the Data Source

**Question:** What index or data should be queried?

- Look for index names, data types, or subject areas mentioned
- Common patterns: `logs-*`, `metrics-*`, `events-*`, `apm-*`
- If unclear, use wildcards or ask for clarification

```esql
FROM logs-*           // Generic logs
FROM metrics-*        // Metrics data
FROM my-index-2024.*  // Dated indices
```

For time series data streams (TSDS), use `TS` instead of `FROM` to enable time series aggregation functions like `RATE`,
`AVG_OVER_TIME`, etc. (9.2+):

```esql
TS metrics-*          // Time series source — enables RATE, AVG_OVER_TIME, etc.
```

### 2. Determine Time Range

**Question:** What time period should be covered?

| User Expression | ES\|QL                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------ |
| "last hour"     | `@timestamp > NOW() - 1 hour`                                                              |
| "last 24 hours" | `@timestamp > NOW() - 24 hours`                                                            |
| "last 7 days"   | `@timestamp > NOW() - 7 days`                                                              |
| "today"         | `@timestamp >= DATE_TRUNC(1 day, NOW())`                                                   |
| "yesterday"     | `@timestamp >= DATE_TRUNC(1 day, NOW()) - 1 day AND @timestamp < DATE_TRUNC(1 day, NOW())` |
| "this week"     | `@timestamp >= DATE_TRUNC(1 week, NOW())`                                                  |
| "this month"    | `@timestamp >= DATE_TRUNC(1 month, NOW())`                                                 |

**Default:** If no time range is specified, add a reasonable default (e.g., last 24 hours) to avoid scanning too much
data.

### 3. Identify Filters

**Question:** What conditions should narrow the results?

Look for:

- Status/level: "errors", "warnings", "successful"
- Environment: "production", "staging", "dev"
- Source/host: specific servers, services, applications
- Values: specific codes, IDs, names

```esql
// Multiple filters
| WHERE level == "error"
| WHERE environment == "production"
| WHERE service.name == "api-gateway"
```

Or combined:

```esql
| WHERE level == "error" AND environment == "production" AND service.name == "api-gateway"
```

**Negation and NULL values:** ES|QL uses three-valued logic. `WHERE field != "value"` silently excludes rows where the
field is `NULL` (missing). When generating negation filters, always add an `IS NULL` guard:

```esql
| WHERE environment != "test" OR environment IS NULL
```

### 4. Determine Output Type

**Question:** Does the user want raw data or aggregated results?

| User Intent                          | Approach                           |
| ------------------------------------ | ---------------------------------- |
| "show me", "list", "find"            | Raw data with KEEP, SORT, LIMIT    |
| "count", "how many"                  | STATS with COUNT                   |
| "average", "total", "sum"            | STATS with aggregation function    |
| "by X", "per X", "grouped by"        | STATS ... BY grouping              |
| "top N", "most common"               | STATS + SORT DESC + LIMIT          |
| "distribution", "breakdown"          | STATS COUNT BY category            |
| "over time", "trend"                 | STATS BY DATE_TRUNC                |
| "patterns", "categorize", "types of" | STATS ... BY CATEGORIZE(field)     |
| "spike", "dip", "anomaly", "change"  | CHANGE_POINT value ON key          |
| "patterns over time"                 | CATEGORIZE + BUCKET + CHANGE_POINT |

**Prefer single advanced queries over multiple basic ones.** When the user asks to "find patterns" or "analyze logs,"
use `CATEGORIZE` in one query rather than running several `STATS ... BY field` queries against different fields.
Similarly, use `CHANGE_POINT` to detect anomalies rather than producing hourly counts for the user to eyeball.

### 5. Select Fields

**Question:** What fields should be shown?

For raw data queries, use KEEP to select relevant fields:

```esql
| KEEP @timestamp, host.name, message, level
```

For aggregations, the output fields are defined by STATS:

```esql
| STATS count = COUNT(*), avg_time = AVG(response_time) BY endpoint
```

### 6. Apply Ordering and Limits

**Question:** How should results be ordered and limited?

- Time-based: `SORT @timestamp DESC`
- By count/value: `SORT count DESC`
- Alphabetical: `SORT name ASC`

**Always add LIMIT** unless the user specifically wants all results:

```esql
| LIMIT 100  // Reasonable default
| LIMIT 1000 // Maximum before considering pagination
```

---

## Field Name Conventions

When generating queries, use common field naming conventions:

### Elastic Common Schema (ECS)

| Category    | Common Fields                                                  |
| ----------- | -------------------------------------------------------------- |
| Timestamp   | `@timestamp`                                                   |
| Message     | `message`                                                      |
| Log level   | `log.level`, `level`                                           |
| Host        | `host.name`, `host.ip`                                         |
| Service     | `service.name`, `service.type`                                 |
| HTTP        | `http.request.method`, `http.response.status_code`, `url.path` |
| User        | `user.name`, `user.id`                                         |
| Source      | `source.ip`, `source.port`                                     |
| Destination | `destination.ip`, `destination.port`                           |
| Error       | `error.message`, `error.type`                                  |
| Event       | `event.action`, `event.category`, `event.outcome`              |

### Default to ECS Dotted Names

When schema discovery is not available and you must guess field names, always prefer ECS dotted notation over flat
names. Flat names like `source_ip` or `service` are common mistakes — most Elastic indices use the dotted ECS form.

| Prefer (ECS)     | Avoid (flat) |
| ---------------- | ------------ |
| `source.ip`      | `source_ip`  |
| `service.name`   | `service`    |
| `event.category` | `event`      |
| `event.outcome`  | `outcome`    |
| `host.name`      | `hostname`   |

### Legacy/Custom Fields

Some indices may use non-ECS field names:

- `status_code` instead of `http.response.status_code`
- `hostname` instead of `host.name`
- `timestamp` instead of `@timestamp`

**Recommendation:** Always run `./esql.js schema <index>` to discover actual field names before generating queries.
Never guess — index and field names vary across deployments.

---

## Query Optimization Tips

### 1. Filter Early

Put WHERE clauses as early as possible:

```esql
// Good - filter first
FROM logs-*
| WHERE @timestamp > NOW() - 1 hour
| WHERE level == "error"
| STATS count = COUNT(*) BY host.name

// Less efficient - filtering after processing
FROM logs-*
| STATS count = COUNT(*) BY host.name, level
| WHERE level == "error"
```

### 2. Use Appropriate Time Ranges

Smaller time ranges = faster queries:

```esql
// Specific range is faster
| WHERE @timestamp > NOW() - 1 hour

// Than scanning all data
// (no time filter)
```

### 3. Limit Fields

Only keep fields you need:

```esql
// Good - specific fields
| KEEP @timestamp, message, host.name

// Less efficient - all fields
// (no KEEP command)
```

### 4. Use LIMIT

Prevent returning excessive rows:

```esql
| LIMIT 100  // Always include for raw data queries
```

### 5. Check for Pre-Existing Computed Fields

Before computing derived values (distances, durations, rates, etc.) with `EVAL`, check the schema for fields that were
already calculated at ingest time. Many indices pre-compute common values — using them is simpler and avoids
recomputation.

```esql
// Prefer: use the pre-computed field
FROM kibana_sample_data_flights
| STATS avg_distance = AVG(DistanceKilometers)

// Avoid: recomputing what already exists
FROM kibana_sample_data_flights
| EVAL distance_km = ST_DISTANCE(OriginLocation, DestLocation) / 1000
| STATS avg_distance = AVG(distance_km)
```

---

## Key Patterns

### Per-Aggregation WHERE (8.16+)

Use `COUNT(*) WHERE condition` instead of CASE-based workarounds to compute conditional metrics in a single pass:

```esql
FROM logs-*
| STATS
    total = COUNT(*),
    errors = COUNT(*) WHERE level == "error",
    warnings = COUNT(*) WHERE level == "warning"
  BY service.name
| EVAL error_rate = ROUND(errors * 100.0 / total, 2)
```

### LOOKUP JOIN and ENRICH

`LOOKUP JOIN` (8.18+) is the preferred way to enrich query results from another index. On clusters **before 8.18**, fall
back to `ENRICH` — it provides similar enrichment capability but requires a pre-configured enrich policy.

**If no enrich policy exists**, suggest the user create one. Example setup:

```bash
# 1. Create the enrich policy
PUT /_enrich/policy/customers_policy
{
  "match": {
    "indices": "customers",
    "match_field": "customer_id",
    "enrich_fields": ["name", "region", "email"]
  }
}

# 2. Execute the policy (builds the enrich index)
POST /_enrich/policy/customers_policy/_execute
```

Then the query uses `ENRICH` instead of `LOOKUP JOIN`:

```esql
// 8.18+ — LOOKUP JOIN (preferred, no policy needed, easier to update)
FROM orders
| LOOKUP JOIN customers_lookup ON customer_id
| KEEP order_id, customer_id, name, region, total

// Pre-8.18 — ENRICH (requires policy setup above)
FROM orders
| ENRICH customers_policy ON customer_id WITH name, region
| KEEP order_id, customer_id, name, region, total
```

**Multi-field joins (9.2+):** Join on multiple fields when the lookup table has a composite key:

```esql
FROM application_logs
| LOOKUP JOIN service_registry ON service_name, environment
| KEEP service_name, environment, owner_team, response_time_ms
```

> Multi-field joins have no ENRICH equivalent — ENRICH only supports a single match field.

**Pre-join checklist:** Before writing any `LOOKUP JOIN`, verify these two things:

1. **Field name match:** Does the join key have the same name in both the source and lookup index? If not, add `RENAME`
   before the join. This is a common source of silent failures.
2. **Composite key:** Does the lookup table require multiple fields to uniquely identify a row? If so, list all key
   fields in the `ON` clause (9.2+).

**Field name mismatches:** When the join key has a different name in the source vs the lookup table, use `RENAME` before
the join:

```esql
FROM support_tickets
| RENAME product AS product_name
| LOOKUP JOIN knowledge_base ON product_name
| KEEP ticket_id, description, resolution
```

### Time Series (TS) Queries

When `schema` reports `Index mode: time_series`, use the `TS` source command instead of `FROM`. Three critical syntax
rules:

**1. Use the data stream name, not the resolved backing index:**

```esql
// WRONG — resolved backing index
FROM .ds-metrics-tsds-2026.03.09-000001

// CORRECT — data stream name (shown by schema command)
TS metrics-tsds
```

The `schema` command displays the data stream name when the index is a TSDS backing index.

**2. TBUCKET takes only a duration — not @timestamp:**

`TBUCKET` is not `DATE_TRUNC`. Do not pass `@timestamp`:

```esql
// WRONG — DATE_TRUNC-style syntax
| STATS avg_cpu = AVG(cpu) BY bucket = TBUCKET(@timestamp, 5 minutes)

// CORRECT — duration only, timestamp is implicit
| STATS avg_cpu = AVG(cpu) BY bucket = TBUCKET(5 minutes)
```

**3. Counter fields need RATE() wrapped in an outer aggregation:**

`RATE()` computes per-time-series rates. When grouping by non-time dimensions (e.g., `host`), wrap it in `SUM()`
(counters are additive). Bare `RATE() BY host` fails:

```esql
// WRONG — bare RATE with non-time grouping
TS metrics-tsds
| STATS request_rate = RATE(requests) BY host

// CORRECT — SUM wraps RATE for non-time groupings
TS metrics-tsds
| STATS request_rate = SUM(RATE(requests)) BY TBUCKET(1 hour), host
```

For gauge fields, use `AVG()` or `MAX()` as the outer function:

```esql
TS metrics-tsds
| STATS avg_cpu = AVG(AVG_OVER_TIME(cpu)) BY TBUCKET(5 minutes), service.name
```

See [Time Series Queries](time-series-queries.md) for the full inner/outer aggregation model.

**Pre-9.2 limitation:** The `TS` command, `RATE()`, `TBUCKET()`, and `AVG_OVER_TIME()` all require Elasticsearch
**9.2+**. On older clusters, counter fields (`counter_long`, `counter_double`) cannot be aggregated meaningfully —
standard aggregation functions like `MAX()`, `SUM()`, and `AVG()` reject counter field types. There is no workaround.
When the cluster is pre-9.2 and the question involves counter rates or time-series-specific aggregations, explain that
the `TS` command and `RATE()` are required (9.2+) and the query cannot be expressed on the current cluster version.

For **gauge** fields in time-series indices on pre-9.2 clusters, `FROM` with standard aggregations (`AVG`, `MAX`, `MIN`)
still works — only counter fields are affected.

### INLINE STATS (9.2+)

`INLINE STATS` is available in **9.2+** only. It computes an aggregation and appends the result as a new column to every
row (like a SQL window function). Use cases that require comparing individual rows to group-level aggregates (e.g.,
"find values above the group average", "percentage of total") depend on `INLINE STATS` and **cannot be expressed in
ES|QL before 9.2**. There is no fallback.

When the cluster is pre-9.2 and the question requires per-row vs. aggregate comparison, explain that `INLINE STATS` is
needed and suggest the user either upgrade or perform the comparison client-side.

### External IPs — CIDR_MATCH with RFC 1918

When the user asks about "external IPs" or "public IPs", exclude private (RFC 1918) ranges with `NOT CIDR_MATCH`:

```esql
FROM security-events
| WHERE event.outcome == "failure"
  AND NOT CIDR_MATCH(source.ip, "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
```

---

## Common Query Templates

### Error Investigation

```esql
FROM logs-*
| WHERE @timestamp > NOW() - 1 hour
| WHERE level == "error"
| KEEP @timestamp, message, host.name, service.name, error.message
| SORT @timestamp DESC
| LIMIT 100
```

### Service Health Overview

```esql
FROM metrics-*
| WHERE @timestamp > NOW() - 15 minutes
| STATS
    avg_cpu = AVG(system.cpu.percent),
    avg_mem = AVG(system.memory.used.pct),
    host_count = COUNT_DISTINCT(host.name)
  BY service.name
| SORT avg_cpu DESC
```

### API Performance Analysis

```esql
FROM apm-*
| WHERE @timestamp > NOW() - 1 hour
| STATS
    count = COUNT(*),
    avg_duration = AVG(transaction.duration.us),
    p95_duration = PERCENTILE(transaction.duration.us, 95),
    error_count = COUNT(CASE(transaction.result != "success", 1, null))
  BY transaction.name
| EVAL error_rate = ROUND(error_count * 100.0 / count, 2)
| SORT count DESC
| LIMIT 20
```

### Traffic Analysis

```esql
FROM web-logs
| WHERE @timestamp > NOW() - 24 hours
| STATS
    requests = COUNT(*),
    unique_ips = COUNT_DISTINCT(client.ip)
  BY hour = DATE_TRUNC(1 hour, @timestamp)
| SORT hour DESC
```

### Security Event Review

```esql
FROM security-*
| WHERE @timestamp > NOW() - 24 hours
| WHERE event.category == "authentication"
| WHERE event.outcome == "failure"
| STATS
    failures = COUNT(*)
  BY user.name, source.ip
| WHERE failures > 5
| SORT failures DESC
```

---

## Handling Ambiguity

When the user request is ambiguous:

### Missing Index

If no index specified, make a reasonable assumption:

- "show errors" → `FROM logs-*`
- "show CPU usage" → `FROM metrics-*`
- "show requests" → `FROM web-logs` or `FROM access-*`

Or output the query with a placeholder and note:

```esql
FROM <index-pattern>  // Specify your index
| WHERE ...
```

### Missing Time Range

Add a sensible default:

```esql
| WHERE @timestamp > NOW() - 24 hours  // Default: last 24 hours
```

### Unclear Aggregation

When "show X" could mean list or count:

- If followed by "by Y" → aggregation
- If asking for specifics → raw data
- If asking "how many" → count
- Default to raw data with limit

### Unknown Field Names

If field names are uncertain:

1. Use common ECS names as first guess
2. Suggest running schema discovery
3. Note the assumption in output

---

## Output Formatting Suggestions

When presenting generated queries:

```text
=== ES|QL Query ===

FROM logs-*
| WHERE @timestamp > NOW() - 1 hour
| WHERE level == "error"
| STATS count = COUNT(*) BY host.name
| SORT count DESC
| LIMIT 10

=== Explanation ===
- Queries all log indices
- Filters to the last hour
- Counts errors per host
- Returns top 10 hosts by error count

=== To Execute ===
./esql.js raw "FROM logs-* | WHERE @timestamp > NOW() - 1 hour | WHERE level == \"error\" | STATS count = COUNT(*) BY host.name | SORT count DESC | LIMIT 10"
```
