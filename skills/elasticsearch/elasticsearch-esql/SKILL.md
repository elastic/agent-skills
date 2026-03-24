---
name: elasticsearch-esql
description: >
  Execute ES|QL (Elasticsearch Query Language) queries, use when the user wants to
  query Elasticsearch data, analyze logs, aggregate metrics, explore data, or create
  charts and dashboards from ES|QL results.
metadata:
  author: elastic
  version: 0.1.1
---

# Elasticsearch ES|QL

Execute ES|QL queries against Elasticsearch.

## What is ES|QL?

ES|QL (Elasticsearch Query Language) is a piped query language for Elasticsearch. It is **NOT** the same as:

- Elasticsearch Query DSL (JSON-based)
- SQL
- EQL (Event Query Language)

ES|QL uses pipes (`|`) to chain commands:
`FROM index | WHERE condition | STATS aggregation BY field | SORT field | LIMIT n`

> **Prerequisite:** ES|QL requires `_source` to be enabled on queried indices. Indices with `_source` disabled (e.g.,
> `"_source": { "enabled": false }`) will cause ES|QL queries to fail.
>
> **Version Compatibility:** ES|QL was introduced in 8.11 (tech preview) and became GA in 8.14. Features like
> `LOOKUP JOIN` (8.18+), `MATCH` (8.17+), and `INLINE STATS` (9.2+) were added in later versions. On pre-8.18 clusters,
> use `ENRICH` as a fallback for `LOOKUP JOIN` (see generation tips). `INLINE STATS` and counter-field `RATE()` have
> **no fallback** before 9.2. Check [references/esql-version-history.md](references/esql-version-history.md) for feature
> availability by version.
>
> **Cluster Detection:** Use the `GET /` response to determine the cluster type and version:
>
> - `build_flavor: "serverless"` — Elastic Cloud Serverless. Reports version `8.11.0` but supports all latest ES|QL
>   features. Ignore the version number and assume all GA and preview features are available.
> - `build_flavor: "default"` — Self-managed or Elastic Cloud Hosted. Use `version.number` for feature availability.
> - **Snapshot builds** have `version.number` like `9.4.0-SNAPSHOT`. Strip the `-SNAPSHOT` suffix and use the
>   major.minor for version checks. Snapshot builds include all features from that version plus potentially unreleased
>   features from development — if a query fails with an unknown function/command, it may simply not have landed yet.
>   Elastic employees commonly use snapshot builds for testing.

### Environment Configuration

Elasticsearch connection is configured via environment variables. Run `node scripts/esql.js test` to verify the
connection. If the test fails, suggest these setup options to the user, then stop. Do not try to explore further until a
successful connection test.

#### Option 1: Elastic Cloud (recommended for production)

```bash
export ELASTICSEARCH_CLOUD_ID="deployment-name:base64encodedcloudid"
export ELASTICSEARCH_API_KEY="base64encodedapikey"
```

#### Option 2: Direct URL with API Key

```bash
export ELASTICSEARCH_URL="https://elasticsearch:9200"
export ELASTICSEARCH_API_KEY="base64encodedapikey"
```

#### Option 3: Basic Authentication

```bash
export ELASTICSEARCH_URL="https://elasticsearch:9200"
export ELASTICSEARCH_USERNAME="elastic"
export ELASTICSEARCH_PASSWORD="changeme"
```

#### Option 4: Local Development with start-local

For local development and testing, use [start-local](https://github.com/elastic/start-local) to quickly spin up
Elasticsearch and Kibana using Docker or Podman:

```bash
curl -fsSL https://elastic.co/start-local | sh
```

After installation completes, Elasticsearch runs at `http://localhost:9200` and Kibana at `http://localhost:5601`. The
script generates a random password for the `elastic` user and an API key, both stored in the `.env` file inside the
created `elastic-start-local` folder.

To configure the environment variables for this skill, source the `.env` file and export the connection settings:

```bash
source elastic-start-local/.env
export ELASTICSEARCH_URL="$ES_LOCAL_URL"
export ELASTICSEARCH_API_KEY="$ES_LOCAL_API_KEY"
```

Then run `node scripts/esql.js test` to verify the connection.

#### Optional: Skip TLS verification (development only)

```bash
export ELASTICSEARCH_INSECURE="true"
```

## Usage

### Get Index Information (for schema discovery)

```bash
node scripts/esql.js indices                    # List all indices
node scripts/esql.js indices "logs-*"           # List matching indices
node scripts/esql.js schema "logs-2024.01.01"   # Get field mappings for an index
```

### Execute Raw ES|QL

```bash
node scripts/esql.js raw "FROM logs-* | STATS count = COUNT(*) BY host.name | SORT count DESC | LIMIT 5"
```

### Execute with TSV Output

```bash
node scripts/esql.js raw "FROM logs-* | STATS count = COUNT(*) BY component | SORT count DESC" --tsv
```

**TSV Output Options:**

- `--tsv` or `-t`: Output as tab-separated values (clean, no decorations)
- `--no-header`: Omit the header row

### Test Connection

```bash
node scripts/esql.js test
```

## Guidelines

1. **Detect deployment type**: Always run `node scripts/esql.js test` first. This detects whether the deployment is a
   Serverless project (all features available) or a versioned cluster (features depend on version). The `build_flavor`
   field from `GET /` is the authoritative signal — if it equals `"serverless"`, ignore the reported version number and
   use all ES|QL features freely.

2. **Discover schema** (required — never guess index or field names):

   ```bash
   node scripts/esql.js indices "pattern*"
   node scripts/esql.js schema "index-name"
   ```

   Always run schema discovery before generating queries. Index names and field names vary across deployments and cannot
   be reliably guessed. Even common-sounding data (e.g., "logs") may live in indices named `logs-test`, `logs-app-*`, or
   `application_logs`. Field names may use ECS dotted notation (`source.ip`, `service.name`) or flat custom names — the
   only way to know is to check.

   The `schema` command reports the index mode. If it shows `Index mode: time_series`, the output includes the data
   stream name and copy-pasteable TS syntax — use `TS <data-stream>` (not `FROM`), `TBUCKET(interval)` (not
   `DATE_TRUNC`), and wrap counter fields with `SUM(RATE(...))`. Read the full TS section in
   [Generation Tips](references/generation-tips.md) before writing any time series query. You can also check the index
   mode directly via the Elasticsearch index settings API:

   ```bash
   curl -s "$ELASTICSEARCH_URL/<index-name>/_settings/index.mode" -H "Authorization: ApiKey $ELASTICSEARCH_API_KEY"
   ```

3. **Choose the right ES|QL feature for the task**: Before writing queries, match the user's intent to the most
   appropriate ES|QL feature. Prefer a single advanced query over multiple basic ones.
   - "find patterns," "categorize," "group similar messages" → `CATEGORIZE(field)`
   - "spike," "dip," "anomaly," "when did X change" → `CHANGE_POINT value ON key`
   - "trend over time," "time series" → `STATS ... BY BUCKET(@timestamp, interval)` or `TS` for TSDB
   - "search," "find documents matching" → `MATCH`, `QSTR`, `KQL`
   - "count," "average," "breakdown" → `STATS` with aggregation functions

4. **Read the references** before generating queries:
   - [Generation Tips](references/generation-tips.md) - key patterns (TS/TBUCKET/RATE, per-agg WHERE, LOOKUP JOIN,
     CIDR_MATCH), common templates, and ambiguity handling
   - [Time Series Queries](references/time-series-queries.md) - **read before any TS query**: inner/outer aggregation
     model, TBUCKET syntax, RATE constraints
   - [ES|QL Complete Reference](references/esql-reference.md) - full syntax for all commands and functions
   - [ES|QL Search Reference](references/esql-search.md) — for full-text search queries (MATCH, QSTR, KQL, scoring)

5. **Generate the query** following ES|QL syntax:
   - Start with `FROM index-pattern` (or `TS index-pattern` for time series indices)
   - Add `WHERE` for filtering (use `TRANGE` for time ranges on 9.3+)
   - Use `EVAL` for computed fields
   - Use `STATS ... BY` for aggregations
   - For time series metrics: `TS` with `SUM(RATE(...))` for counters, `AVG(...)` for gauges, and `TBUCKET(interval)`
     for time bucketing — see the TS section in [Generation Tips](references/generation-tips.md) for the three critical
     syntax rules
   - For detecting spikes, dips, or anomalies, use `CHANGE_POINT` after time-bucketed aggregation
   - Add `SORT` and `LIMIT` as needed

6. **Execute with TSV flag**:

   ```bash
   node scripts/esql.js raw "FROM index | STATS count = COUNT(*) BY field" --tsv
   ```

## ES|QL Quick Reference

> **Version availability:** This section omits version annotations for readability. Check
> [ES|QL Version History](references/esql-version-history.md) for feature availability by Elasticsearch version.

### Basic Structure

```esql
FROM index-pattern
| WHERE condition
| EVAL new_field = expression
| STATS aggregation BY grouping
| SORT field DESC
| LIMIT n
```

### Common Patterns

**Filter and limit:**

```esql
FROM logs-*
| WHERE @timestamp > NOW() - 24 hours AND level == "error"
| SORT @timestamp DESC
| LIMIT 100
```

**Aggregate by time:**

```esql
FROM metrics-*
| WHERE @timestamp > NOW() - 7 days
| STATS avg_cpu = AVG(cpu.percent) BY bucket = DATE_TRUNC(1 hour, @timestamp)
| SORT bucket DESC
```

**Top N with count:**

```esql
FROM web-logs
| STATS count = COUNT(*) BY response.status_code
| SORT count DESC
| LIMIT 10
```

**Text search:** Use `MATCH`, `QSTR`, or `KQL` for full-text search instead of `LIKE`/`RLIKE` — they are significantly
faster and support relevance scoring. See [ES|QL Search Reference](references/esql-search.md) for the full guide.

```esql
FROM documents METADATA _score
| WHERE MATCH(content, "search terms")
| SORT _score DESC
| LIMIT 20
```

**Log categorization (Platinum license):** Use `CATEGORIZE` to auto-cluster log messages into pattern groups. Prefer
this over running multiple `STATS ... BY field` queries when exploring or finding patterns in unstructured text.

```esql
FROM logs-*
| WHERE @timestamp > NOW() - 24 hours
| STATS count = COUNT(*) BY category = CATEGORIZE(message)
| SORT count DESC
| LIMIT 20
```

**Change point detection (Platinum license):** Use `CHANGE_POINT` to detect spikes, dips, and trend shifts in a metric
series. Prefer this over manual inspection of time-bucketed counts.

```esql
FROM logs-*
| STATS c = COUNT(*) BY t = BUCKET(@timestamp, 30 seconds)
| SORT t
| CHANGE_POINT c ON t
| WHERE type IS NOT NULL
```

**Time series metrics:**

```esql
// Counter metric: SUM(RATE(...)) with TBUCKET(duration)
TS metrics-tsds
| WHERE TRANGE(1 hour)
| STATS SUM(RATE(requests)) BY TBUCKET(1 hour), host

// Gauge metric: AVG(...) — no RATE needed
TS metrics-tsds
| STATS avg_cpu = AVG(cpu) BY service.name, bucket = TBUCKET(5 minutes)
| SORT bucket
```

**Data enrichment with LOOKUP JOIN:** Use `RENAME` when the join key has a different name in the source vs the lookup
index. Use multiple fields in `ON` when the lookup table has a composite key.

```esql
// Field name mismatch — RENAME before joining
FROM support_tickets
| RENAME product AS product_name
| LOOKUP JOIN knowledge_base ON product_name

// Multi-field join (9.2+)
FROM application_logs
| LOOKUP JOIN service_registry ON service_name, environment
| KEEP service_name, environment, owner_team
```

**Multivalue field filtering:** Use `MV_CONTAINS` to check if a multivalue field contains a specific value. Use
`MV_COUNT` to count values.

```esql
// Filter by multivalue membership
FROM employees
| WHERE MV_CONTAINS(languages, "Python")

// Find entries matching multiple values
FROM employees
| WHERE MV_CONTAINS(languages, "Java") AND MV_CONTAINS(languages, "Python")

// Count multivalue entries
FROM employees
| EVAL num_languages = MV_COUNT(languages)
| SORT num_languages DESC
```

**Change point detection (alternate example):** Use when the user asks about spikes, dips, or anomalies. Requires
time-bucketed aggregation, `SORT`, then `CHANGE_POINT`.

```esql
FROM logs-*
| STATS error_count = COUNT(*) BY bucket = DATE_TRUNC(1 hour, @timestamp)
| SORT bucket
| CHANGE_POINT error_count ON bucket AS type, pvalue
```

## Full Reference

For complete ES|QL syntax including all commands, functions, and operators, read:

- [ES|QL Complete Reference](references/esql-reference.md)
- [ES|QL Search Reference](references/esql-search.md) - Full-text search: MATCH, QSTR, KQL, MATCH_PHRASE, scoring,
  semantic search
- [ES|QL Version History](references/esql-version-history.md) - Feature availability by Elasticsearch version
- [Query Patterns](references/query-patterns.md) - Natural language to ES|QL translation
- [Generation Tips](references/generation-tips.md) - Best practices for query generation
- [Time Series Queries](references/time-series-queries.md) - TS command, time series aggregation functions, TBUCKET
- [DSL to ES|QL Migration](references/dsl-to-esql-migration.md) - Convert Query DSL to ES|QL

## Error Handling

When query execution fails, the script returns:

- The generated ES|QL query
- The error message from Elasticsearch
- Suggestions for common issues

**Common issues:**

- Field doesn't exist → Always use `get_schema` and `list_indices` before writing a query. Never guess field or index
  names — they vary across deployments.
- Type mismatch → Use type conversion functions (TO_STRING, TO_INTEGER, etc.)
- Syntax error → Review ES|QL reference for correct syntax. Always use **double quotes** for strings, never single
  quotes.
- No results → Check time range and filter conditions
- Wrong function name → ES|QL uses underscored names: `STD_DEV()` not `STDDEV()`, `MEDIAN_ABSOLUTE_DEVIATION()` not
  `MAD()`. Use `CONCAT()` for strings, not `+`. Use `CASE(cond, val, ...)` not `CASE WHEN...THEN...END`.
- Wrong date part → `DATE_EXTRACT` uses ES|QL part names: `"hour_of_day"` not `"hour"`, `"day_of_month"` not `"day"`,
  `"month_of_year"` not `"month"`. Use `DATE_DIFF("day", start, end)` for date arithmetic, not subtraction.

## Examples

```bash
# Schema discovery
node scripts/esql.js test
node scripts/esql.js indices "logs-*"
node scripts/esql.js schema "logs-2024.01.01"

# Execute queries
node scripts/esql.js raw "FROM logs-* | STATS count = COUNT(*) BY host.name | LIMIT 10"
node scripts/esql.js raw "FROM metrics-* | STATS avg = AVG(cpu.percent) BY hour = DATE_TRUNC(1 hour, @timestamp)" --tsv
```
