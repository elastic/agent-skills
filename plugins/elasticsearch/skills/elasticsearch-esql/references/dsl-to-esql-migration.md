# Query DSL to ES|QL Migration Guide

This guide helps you migrate from Elasticsearch Query DSL (JSON-based queries) to ES|QL (piped query language).

> **Versions:** Statuses below reflect Elastic Stack 9.5 and Elastic Cloud Serverless. Serverless includes every Stack
> 9.5 feature plus a few that have not reached Stack yet (for example `DEDUP`). See
> [esql-version-history.md](esql-version-history.md) for per-version availability before using a preview feature.

## Table of Contents

- [Overview: Key Differences](#overview-key-differences)
- [Basic Query Structure](#basic-query-structure)
- [Match All Query](#match-all-query)
- [Term Query (Exact Match)](#term-query-exact-match)
- [Match Query (Full-Text Search)](#match-query-full-text-search)
- [Match Phrase Query](#match-phrase-query)
- [Multi-Match Query](#multi-match-query)
- [Query String Query](#query-string-query)
- [Range Query](#range-query)
- [Bool Query](#bool-query)
- [Exists Query](#exists-query)
- [Wildcard / Prefix Query](#wildcard--prefix-query)
- [Regexp Query](#regexp-query)
- [Flattened Field Queries](#flattened-field-queries)
- [Aggregations](#aggregations)
- [Sampling and Approximate Aggregations](#sampling-and-approximate-aggregations)
- [Sorting](#sorting)
- [Field Selection (\_source)](#field-selection-_source)
- [Pagination](#pagination)
- [Field Collapsing and Top Hits per Group](#field-collapsing-and-top-hits-per-group)
- [Script Fields and Runtime Fields](#script-fields-and-runtime-fields)
- [LOOKUP JOIN (Replaces Enrichment Patterns)](#lookup-join-replaces-enrichment-patterns)
- [GeoIP Enrichment](#geoip-enrichment)
- [Filters Aggregation (Per-Aggregation WHERE)](#filters-aggregation-per-aggregation-where)
- [Pipeline Aggregations](#pipeline-aggregations)
- [Highlighting](#highlighting)
- [Vector and Semantic Search](#vector-and-semantic-search)
- [Rescoring and Hybrid Ranking](#rescoring-and-hybrid-ranking)
- [ES|QL Limitations (vs Query DSL)](#esql-limitations-vs-query-dsl)
- [Migration Checklist](#migration-checklist)
- [Performance Considerations](#performance-considerations)
- [Quick Reference Table](#quick-reference-table)

## Overview: Key Differences

| Aspect           | Query DSL               | ES\|QL                          |
| ---------------- | ----------------------- | ------------------------------- |
| Format           | JSON                    | Piped text                      |
| Execution        | Translated to Lucene    | Native execution engine         |
| Default results  | 10                      | 1,000                           |
| Max results      | 10,000 (configurable)   | 10,000 (configurable)           |
| Aggregations     | Nested JSON structure   | `STATS ... BY` command          |
| Full-text search | `match`, `query_string` | `MATCH()`, `QSTR()`, `KQL()`    |
| Scoring          | Automatic with queries  | Explicit with `METADATA _score` |

### When to Use ES|QL vs Query DSL

**Use ES|QL for:**

- Log exploration and ad-hoc analysis
- Time-series data analysis
- Simple to moderate aggregations
- Data transformation pipelines
- Interactive troubleshooting

**Use Query DSL for:**

- Complex nested aggregations
- Advanced scoring and boosting
- Nested/parent-child document queries
- Features not yet in ES|QL (see Limitations)

---

## Basic Query Structure

### Query DSL

```json
POST /my-index/_search
{
  "query": { ... },
  "aggs": { ... },
  "sort": [ ... ],
  "size": 100,
  "_source": ["field1", "field2"]
}
```

### ES|QL

```esql
FROM my-index
| WHERE <conditions>
| STATS <aggregations> BY <groupings>
| SORT <field> DESC
| KEEP field1, field2
| LIMIT 100
```

---

## Match All Query

### Query DSL

```json
{
  "query": {
    "match_all": {}
  },
  "size": 100
}
```

### ES|QL

```esql
FROM my-index
| LIMIT 100
```

---

## Term Query (Exact Match)

### Query DSL

```json
{
  "query": {
    "term": {
      "status": "published"
    }
  }
}
```

### ES|QL

```esql
FROM my-index
| WHERE status == "published"
```

### Multiple Terms (terms query)

#### Query DSL

```json
{
  "query": {
    "terms": {
      "status": ["published", "draft"]
    }
  }
}
```

#### ES|QL

```esql
FROM my-index
| WHERE status IN ("published", "draft")
```

### Terms Lookup (terms from another index)

#### Query DSL

```json
{
  "query": {
    "terms": {
      "source.ip": { "index": "allowed_ips", "id": "office", "path": "ips" }
    }
  }
}
```

#### ES|QL (9.5+ preview)

Use a `WHERE ... IN` subquery. The subquery must return exactly one column. It can read any index (not only lookup
indices) and filter it with `WHERE`.

```esql
FROM web_logs
| WHERE source.ip IN (FROM allowed_ips | KEEP ip)
| STATS hits = COUNT(*) BY source.ip
```

`NOT IN (FROM ...)` works the same way for exclusion lists. A DSL terms lookup reads the values of one field in one
document. The ES|QL subquery collects a column across all rows the subquery returns, so store one value per row or
narrow the subquery with `WHERE`.

Before 9.5, join against a lookup index (`index.mode: lookup`) and keep the matched rows (`IS NULL` for `NOT IN`):

```esql
FROM web_logs
| LOOKUP JOIN allowed_ips ON source.ip == ip
| WHERE ip IS NOT NULL
| STATS hits = COUNT(*) BY source.ip
```

The `LOOKUP JOIN` fallback duplicates a row when several lookup rows match it. The `ON a == b` form is 9.2+; on
8.18/9.0–9.1, `RENAME` the source field to the lookup key name and use `ON ip`.

---

## Match Query (Full-Text Search)

### Query DSL

```json
{
  "query": {
    "match": {
      "title": "elasticsearch guide"
    }
  }
}
```

### ES|QL (8.17+)

```esql
FROM my-index
| WHERE MATCH(title, "elasticsearch guide")
```

Or using the match operator:

```esql
FROM my-index
| WHERE title : "elasticsearch guide"
```

### With Relevance Scoring

```esql
FROM my-index METADATA _score
| WHERE MATCH(title, "elasticsearch guide")
| SORT _score DESC
| LIMIT 10
```

---

## Match Phrase Query

### Query DSL

```json
{
  "query": {
    "match_phrase": {
      "title": "quick brown fox"
    }
  }
}
```

### ES|QL (8.19+)

```esql
FROM my-index
| WHERE MATCH_PHRASE(title, "quick brown fox")
```

---

## Multi-Match Query

### Query DSL

```json
{
  "query": {
    "multi_match": {
      "query": "elasticsearch",
      "fields": ["title", "content", "tags"]
    }
  }
}
```

### ES|QL

```esql
FROM my-index
| WHERE MATCH(title, "elasticsearch")
    OR MATCH(content, "elasticsearch")
    OR MATCH(tags, "elasticsearch")
```

Or use QSTR for more flexibility:

```esql
FROM my-index
| WHERE QSTR("title:elasticsearch OR content:elasticsearch OR tags:elasticsearch")
```

---

## Query String Query

### Query DSL

```json
{
  "query": {
    "query_string": {
      "query": "status:active AND (type:blog OR type:article)"
    }
  }
}
```

### ES|QL

```esql
FROM my-index
| WHERE QSTR("status:active AND (type:blog OR type:article)")
```

---

## Range Query

### Query DSL

```json
{
  "query": {
    "range": {
      "price": {
        "gte": 10,
        "lte": 100
      }
    }
  }
}
```

### ES|QL

```esql
FROM my-index
| WHERE price >= 10 AND price <= 100
```

### Date Range

#### Query DSL

```json
{
  "query": {
    "range": {
      "@timestamp": {
        "gte": "now-24h",
        "lte": "now"
      }
    }
  }
}
```

#### ES|QL

```esql
FROM my-index
| WHERE @timestamp >= NOW() - 24 hours AND @timestamp <= NOW()
```

Or simply:

```esql
FROM my-index
| WHERE @timestamp > NOW() - 24 hours
```

---

## Bool Query

The bool query is one of the most complex DSL structures to migrate.

### Query DSL

```json
{
  "query": {
    "bool": {
      "must": [{ "match": { "title": "elasticsearch" } }],
      "filter": [{ "term": { "status": "published" } }, { "range": { "date": { "gte": "2024-01-01" } } }],
      "should": [{ "term": { "featured": true } }],
      "must_not": [{ "term": { "draft": true } }]
    }
  }
}
```

### ES|QL

**Note:** ES|QL handles `must`, `filter`, and `must_not` directly with WHERE conditions. A `should` clause that only
adds optional score boosting on top of `must` has no direct equivalent: only full-text functions contribute to `_score`,
and every `WHERE` condition filters.

```esql
FROM my-index METADATA _score
| WHERE MATCH(title, "elasticsearch")           // must
    AND status == "published"                   // filter
    AND date >= "2024-01-01"                    // filter
    AND (draft != true OR draft IS NULL)        // must_not
| EVAL featured_boost = CASE(featured == true, 100.0, 0.0)
| EVAL combined_score = _score + featured_boost // approximate should boost
| SORT combined_score DESC
```

> **Three-valued logic warning:** `draft != true` alone excludes rows where `draft` is NULL. In Query DSL,
> `must_not: { term: { draft: true } }` keeps documents where `draft` is missing. To match that behavior in ES|QL, add
> `OR draft IS NULL`.
>
> **Should clause:** ES|QL cannot natively replicate optional `should` boosting. The `EVAL` approach above is a rough
> approximation. If precise relevance scoring is critical, consider using Query DSL instead.

When a bool query has only `should` clauses over full-text queries (match any, rank by how well each matches), use `OR`
between full-text functions. Their scores add up, and the `boost` option weights a clause:

```esql
FROM articles METADATA _score
| WHERE MATCH(title, "elasticsearch", {"boost": 2.0}) OR MATCH(content, "elasticsearch")
| SORT _score DESC
| LIMIT 10
```

---

## Exists Query

### Query DSL

```json
{
  "query": {
    "exists": {
      "field": "user"
    }
  }
}
```

### ES|QL

```esql
FROM my-index
| WHERE user IS NOT NULL
```

### Does Not Exist

#### Query DSL

```json
{
  "query": {
    "bool": {
      "must_not": {
        "exists": { "field": "user" }
      }
    }
  }
}
```

#### ES|QL

```esql
FROM my-index
| WHERE user IS NULL
```

---

## Wildcard / Prefix Query

### Query DSL

```json
{
  "query": {
    "wildcard": {
      "name": "john*"
    }
  }
}
```

### ES|QL

```esql
FROM my-index
| WHERE name LIKE "john*"
```

Or using STARTS_WITH:

```esql
FROM my-index
| WHERE STARTS_WITH(name, "john")
```

---

## Regexp Query

### Query DSL

```json
{
  "query": {
    "regexp": {
      "name": "joh?n.*"
    }
  }
}
```

### ES|QL

```esql
FROM my-index
| WHERE name RLIKE "joh?n.*"
```

**Note:** `RLIKE` uses the same Lucene regular expression syntax as the DSL `regexp` query, so patterns usually carry
over unchanged (`joh?n.*` matches `jon` and `john`). The pattern must match the whole value, as in the DSL.

---

## Flattened Field Queries

### Query DSL

```json
{
  "query": {
    "bool": {
      "filter": [{ "term": { "labels.env": "prod" } }, { "range": { "labels.retry_count": { "gte": "10" } } }]
    }
  }
}
```

### ES|QL (9.5+ preview)

ES|QL loads a `flattened` field as a single root column, so `labels.env` is an unknown column. Read sub-keys with
`FIELD_EXTRACT(root, "dotted.key")`:

```esql
FROM k8s_events
| WHERE FIELD_EXTRACT(labels, "env") == "prod"
    AND TO_INTEGER(FIELD_EXTRACT(labels, "retry_count")) >= 10
| KEEP service, reason
```

`FIELD_EXTRACT` always returns `keyword`. Cast it before numeric comparisons or math: comparing it to an integer is a
type error, and comparing it to a string (`>= "10"`) compares lexicographically, like a DSL `range` query on a flattened
sub-field.

Before 9.5, the flattened column is unsupported. On 9.4, read sub-keys from `_source` with `JSON_EXTRACT`:

```esql
FROM k8s_events METADATA _source
| EVAL env = JSON_EXTRACT(_source, "$.labels.env")
| WHERE env == "prod"
```

See [esql-reference.md](esql-reference.md#string-functions) for pre-dotted keys and other `FIELD_EXTRACT` rules.

---

## Aggregations

### Terms Aggregation (Group By Count)

#### Query DSL

```json
{
  "size": 0,
  "aggs": {
    "status_counts": {
      "terms": {
        "field": "status",
        "size": 10
      }
    }
  }
}
```

#### ES|QL

```esql
FROM my-index
| STATS count = COUNT(*) BY status
| SORT count DESC
| LIMIT 10
```

### Date Histogram Aggregation

#### Query DSL

```json
{
  "size": 0,
  "aggs": {
    "events_over_time": {
      "date_histogram": {
        "field": "@timestamp",
        "calendar_interval": "day"
      }
    }
  }
}
```

#### ES|QL

```esql
FROM my-index
| STATS count = COUNT(*) BY day = DATE_TRUNC(1 day, @timestamp)
| SORT day
```

### Date Histogram with Sub-Aggregation

#### Query DSL

```json
{
  "size": 0,
  "aggs": {
    "events_over_time": {
      "date_histogram": {
        "field": "@timestamp",
        "calendar_interval": "hour"
      },
      "aggs": {
        "avg_response": {
          "avg": { "field": "response_time" }
        }
      }
    }
  }
}
```

#### ES|QL

```esql
FROM my-index
| STATS
    count = COUNT(*),
    avg_response = AVG(response_time)
  BY hour = DATE_TRUNC(1 hour, @timestamp)
| SORT hour
```

### Multiple Metric Aggregations

#### Query DSL

```json
{
  "size": 0,
  "aggs": {
    "price_stats": {
      "stats": { "field": "price" }
    }
  }
}
```

#### ES|QL

```esql
FROM my-index
| STATS
    count = COUNT(price),
    min_price = MIN(price),
    max_price = MAX(price),
    avg_price = AVG(price),
    sum_price = SUM(price)
```

### Percentiles Aggregation

#### Query DSL

```json
{
  "size": 0,
  "aggs": {
    "response_percentiles": {
      "percentiles": {
        "field": "response_time",
        "percents": [50, 95, 99]
      }
    }
  }
}
```

#### ES|QL

```esql
FROM my-index
| STATS
    p50 = PERCENTILE(response_time, 50),
    p95 = PERCENTILE(response_time, 95),
    p99 = PERCENTILE(response_time, 99)
```

### Cardinality Aggregation (Distinct Count)

#### Query DSL

```json
{
  "size": 0,
  "aggs": {
    "unique_users": {
      "cardinality": { "field": "user_id" }
    }
  }
}
```

#### ES|QL

```esql
FROM my-index
| STATS unique_users = COUNT_DISTINCT(user_id)
```

### Filter Aggregation

#### Query DSL

```json
{
  "size": 0,
  "aggs": {
    "errors": {
      "filter": { "term": { "level": "error" } },
      "aggs": {
        "count": { "value_count": { "field": "_id" } }
      }
    }
  }
}
```

#### ES|QL

```esql
FROM my-index
| WHERE level == "error"
| STATS count = COUNT(*)
```

Or to get both total and filtered in one query using `CASE`:

```esql
FROM my-index
| STATS
    total = COUNT(*),
    errors = COUNT(CASE(level == "error", 1, null))
```

With per-aggregation `WHERE` (8.16+), this is simpler:

```esql
FROM my-index
| STATS
    total = COUNT(*),
    errors = COUNT(*) WHERE level == "error"
```

### Nested Aggregations (Multiple Group By)

#### Query DSL

```json
{
  "size": 0,
  "aggs": {
    "by_country": {
      "terms": { "field": "country" },
      "aggs": {
        "by_city": {
          "terms": { "field": "city" }
        }
      }
    }
  }
}
```

#### ES|QL

```esql
FROM my-index
| STATS count = COUNT(*) BY country, city
| SORT country, count DESC
```

### Top Hits per Bucket

A `terms` aggregation with a `top_hits` sub-aggregation maps to `SORT` + `LIMIT n BY`. See
[Field Collapsing and Top Hits per Group](#field-collapsing-and-top-hits-per-group).

---

## Sampling and Approximate Aggregations

### random_sampler Aggregation

#### Query DSL

```json
{
  "size": 0,
  "aggs": {
    "sampled": {
      "random_sampler": { "probability": 0.1 },
      "aggs": {
        "by_level": {
          "terms": { "field": "level" },
          "aggs": { "avg_duration": { "avg": { "field": "duration" } } }
        }
      }
    }
  }
}
```

#### ES|QL

Use `SAMPLE` (preview 8.19/9.1, GA 9.5) before `STATS`:

```esql
FROM logs-test
| SAMPLE 0.1
| STATS events = COUNT(*), avg_duration = AVG(duration) BY level
```

`SAMPLE` does no extrapolation: `COUNT` and `SUM` cover only the sampled rows, so divide them by the probability to
estimate totals.

### sampler Aggregation (top-scoring documents)

The DSL `sampler` aggregation is not random: it aggregates the top-scoring `shard_size` documents on each shard. The
closest ES|QL pattern keeps the top-scoring rows overall, not per shard:

```esql
FROM articles METADATA _score
| WHERE MATCH(content, "elasticsearch")
| SORT _score DESC
| LIMIT 100
| STATS docs = COUNT(*) BY category
```

### Approximate STATS

Query DSL has no automatic approximation. In ES|QL, prepend `SET approximation = true;` (preview 9.4, GA 9.5) to a large
`STATS` query to get extrapolated estimates with confidence intervals:

```esql
SET approximation = true;
FROM logs-test
| STATS events = COUNT(*), avg_duration = AVG(duration) BY level
```

Some functions (for example `COUNT_DISTINCT`, `MIN`, `MAX`) and query shapes (`TS`, `PROMQL`, two or more `STATS`) fall
back to exact execution. See [query-approximation.md](query-approximation.md) for the output columns, options, and when
to use `SAMPLE` instead.

---

## Sorting

### Query DSL

```json
{
  "sort": [{ "@timestamp": { "order": "desc" } }, { "name": { "order": "asc" } }]
}
```

### ES|QL

```esql
FROM my-index
| SORT @timestamp DESC, name ASC
```

---

## Field Selection (\_source)

### Query DSL

```json
{
  "_source": ["title", "author", "date"]
}
```

### ES|QL

```esql
FROM my-index
| KEEP title, author, date
```

### Exclude Fields

#### Query DSL

```json
{
  "_source": {
    "excludes": ["internal_*", "temp"]
  }
}
```

#### ES|QL

```esql
FROM my-index
| DROP internal_*, temp
```

---

## Pagination

### Query DSL

```json
{
  "from": 20,
  "size": 10
}
```

### ES|QL

ES|QL doesn't have direct `from` equivalent. Use filtering or time-based pagination:

```esql
FROM my-index
| SORT @timestamp DESC
| LIMIT 10
```

For subsequent pages, use the last seen value:

```esql
FROM my-index
| WHERE @timestamp < "2024-01-15T10:30:00Z"
| SORT @timestamp DESC
| LIMIT 10
```

---

## Field Collapsing and Top Hits per Group

### Query DSL

```json
{
  "query": { "match": { "message": "error" } },
  "collapse": { "field": "service.name" },
  "sort": [{ "@timestamp": "desc" }]
}
```

The same shape as an aggregation:

```json
{
  "size": 0,
  "aggs": {
    "by_service": {
      "terms": { "field": "service.name" },
      "aggs": {
        "latest": { "top_hits": { "size": 1, "sort": [{ "@timestamp": "desc" }], "_source": ["message"] } }
      }
    }
  }
}
```

### ES|QL (9.4+ preview)

`SORT` to choose which row wins, then `LIMIT n BY field` keeps the first `n` rows per group (Stack and Serverless):

```esql
FROM logs-test
| WHERE MATCH(message, "error")
| SORT @timestamp DESC
| LIMIT 1 BY service.name
| KEEP service.name, @timestamp, message
```

Use `LIMIT 3 BY service.name` for the equivalent of `inner_hits` or `top_hits` with `size: 3`. Rows stay flat: there is
no nested hits array per group. The number comes before `BY` (`LIMIT BY service.name 3` does not parse). `SORT ... DESC`
puts nulls first in ES|QL, so add `NULLS LAST` when the sort field can be missing.

When you only need one value per group, an aggregation is simpler:
`STATS latest_message = LAST(message, @timestamp) BY service.name` (9.4+). Before 9.4, use `INLINE STATS` (9.2+ preview,
GA 9.3):

```esql
FROM logs-test
| INLINE STATS latest = MAX(@timestamp) BY service.name
| WHERE @timestamp == latest
```

To drop rows that are identical across all kept columns, use `DEDUP` on Serverless (preview). It is not available on
Stack 9.5 (parse error); use `LIMIT 1 BY cols` or `STATS BY cols` there:

```esql
// Serverless only
FROM logs-test
| KEEP host.name, service.name
| DEDUP
```

---

## Script Fields and Runtime Fields

### Query DSL

```json
{
  "script_fields": {
    "price_with_tax": {
      "script": {
        "source": "doc['price'].value * 1.1"
      }
    }
  }
}
```

### ES|QL

```esql
FROM my-index
| EVAL price_with_tax = price * 1.1
```

Search-time `runtime_mappings` also become `EVAL` columns, which later commands can filter, aggregate, and sort on:

```esql
FROM web_logs
| EVAL is_error = status_code >= 500, kb = bytes / 1024.0
| STATS errors = COUNT(*) WHERE is_error, avg_kb = AVG(kb)
```

Painless logic maps to ES|QL functions (`CASE`, `CONCAT`, `DATE_EXTRACT`, `DISSECT`, `GROK`, and so on). There is no
Painless escape hatch for logic those functions cannot express.

---

## LOOKUP JOIN (Replaces Enrichment Patterns)

### Query DSL

```json
{
  "query": { "match_all": {} },
  "runtime_mappings": {
    "region_name": {
      "type": "keyword",
      "script": "/* typically handled via enrich processor or application-side join */"
    }
  }
}
```

### ES|QL

Use `LOOKUP JOIN` (8.18/9.0+) to join against a lookup index:

```esql
FROM orders
| LOOKUP JOIN customers_lookup ON customer_id
| KEEP order_id, customer_id, name, email, total
```

> **Note:** The lookup index must use `index.mode: lookup` and is limited to a single shard. Prefer `LOOKUP JOIN` over
> `ENRICH` for new queries.

---

## GeoIP Enrichment

### Query DSL

The Search API has no query-time GeoIP lookup. Location fields are added at ingest time with the `geoip` processor:

```json
PUT _ingest/pipeline/geoip-web
{
  "processors": [{ "geoip": { "field": "source.ip", "target_field": "geo" } }]
}
```

### ES|QL (9.5+ preview)

`IP_LOCATION` resolves IPs at query time, with no pipeline or re-indexing (Stack and Serverless):

```esql
FROM web_logs
| IP_LOCATION geo = source.ip WITH { "properties": ["country_name"] }
| STATS hits = COUNT(*) BY geo.country_name
```

Private and unknown IPs return `null`. The first query on a cluster triggers a one-time database download. Before 9.5,
read the fields written by the ingest `geoip` processor, or use `ENRICH` with a `range` policy over an IP-range source
index.

---

## Filters Aggregation (Per-Aggregation WHERE)

### Query DSL

```json
{
  "size": 0,
  "aggs": {
    "messages": {
      "filters": {
        "filters": {
          "errors": { "match": { "level": "error" } },
          "warnings": { "match": { "level": "warning" } }
        }
      }
    }
  }
}
```

### ES|QL

With per-aggregation `WHERE` (8.16+):

```esql
FROM logs
| STATS
    errors = COUNT(*) WHERE level == "error",
    warnings = COUNT(*) WHERE level == "warning",
    total = COUNT(*)
```

---

## Pipeline Aggregations

### Query DSL

```json
{
  "size": 0,
  "aggs": {
    "sales_per_month": {
      "date_histogram": { "field": "date", "calendar_interval": "month" },
      "aggs": {
        "total_sales": { "sum": { "field": "amount" } },
        "cumulative_sales": { "cumulative_sum": { "buckets_path": "total_sales" } }
      }
    }
  }
}
```

### ES|QL

ES|QL has no `buckets_path` or window functions. **`cumulative_sum` (the example above) has no equivalent**, and neither
do `cumulative_cardinality`, `serial_diff`, `moving_fn`, or `derivative` over arbitrary (non-time-series) buckets.
Compute those client-side or keep them in Query DSL. Many other pipeline aggregations map to commands that run after
`STATS`:

| Pipeline aggregation                                     | ES\|QL equivalent                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `bucket_script`                                          | `EVAL` after `STATS`                                                     |
| `bucket_selector`                                        | `WHERE` after `STATS`                                                    |
| `bucket_sort`                                            | `SORT` + `LIMIT` after `STATS`                                           |
| `avg_bucket`, `max_bucket`, `sum_bucket`, `stats_bucket` | A second `STATS` over the first one's output                             |
| Ratio to the overall total (percent of total)            | `INLINE STATS` (preview 9.2, GA 9.3) after `STATS`, then `EVAL`          |
| `derivative` / `moving_avg` on metrics                   | `TS` with `RATE`, `DERIV`, `AVG_OVER_TIME(field, window)` (GA 9.4)       |
| Change detection (`change_point` aggregation)            | `CHANGE_POINT` (preview 8.19/9.1, GA 9.2; `BY` GA 9.5); Platinum license |
| `cumulative_sum`, `serial_diff`, `moving_fn`             | No equivalent                                                            |

`bucket_script` and `bucket_selector`:

```esql
FROM sales
| STATS revenue = SUM(amount), orders = COUNT(*) BY month = DATE_TRUNC(1 month, date)
| EVAL avg_order = ROUND(revenue / orders, 2)
| WHERE revenue > 100
| SORT month
```

`avg_bucket` and `max_bucket` (sibling aggregations over monthly totals):

```esql
FROM sales
| STATS revenue = SUM(amount) BY month = DATE_TRUNC(1 month, date)
| STATS avg_monthly = AVG(revenue), max_monthly = MAX(revenue)
```

Percent of total with `INLINE STATS`, which adds an aggregate to every row without collapsing them:

```esql
FROM sales
| STATS revenue = SUM(amount) BY region
| INLINE STATS total = SUM(revenue)
| EVAL pct = ROUND(revenue / total * 100, 1)
```

Rate, derivative, and moving average on a time series data stream. The second argument of a time series function is a
sliding window, which replaces `moving_avg`:

```esql
TS metrics-tsds
| STATS req_rate = SUM(RATE(requests)),
        cpu_trend = AVG(DERIV(cpu)),
        cpu_smoothed = AVG(AVG_OVER_TIME(cpu, 15 minutes))
  BY host, bucket = TBUCKET(5 minutes)
```

Per-series change detection after a `date_histogram`-style `STATS`:

```esql
FROM logs-test
| STATS c = COUNT(*) BY t = BUCKET(@timestamp, 1 hour), service.name
| SORT t
| CHANGE_POINT c ON t BY service.name
| WHERE type IS NOT NULL
```

See [time-series-queries.md](time-series-queries.md) for the full set of time series functions.

---

## Highlighting

### Query DSL

```json
{
  "query": { "match": { "content": "elasticsearch" } },
  "highlight": {
    "fields": { "content": {} }
  }
}
```

### ES|QL (9.3+ preview)

Use `TOP_SNIPPETS` (preview since 9.3) to return the best-matching passages of a field. Its 9.5 options (preview)
`highlight`, `pre_tag`, `post_tag`, `encoder` (`default` or `html`), and `order` (`score` or `none`) wrap matched terms
in tags, like DSL highlighting:

```esql
FROM articles
| WHERE MATCH(content, "elasticsearch")
| EVAL snippet = TOP_SNIPPETS(content, "elasticsearch", {"num_snippets": 2, "num_words": 20, "highlight": true, "pre_tag": "<mark>", "post_tag": "</mark>", "encoder": "html"})
| KEEP title, snippet
```

On 9.3 and 9.4, only `num_snippets` and `num_words` exist: `TOP_SNIPPETS` returns passages without highlight tags.

Remaining gaps compared to DSL highlighting:

- The query text is passed to `TOP_SNIPPETS` separately and does not reuse the `WHERE` query. Terms are matched
  individually: a quoted phrase such as `"search engine"` highlights `search` and `engine` wherever they occur.
- One field per call; there is no `fields: {"*": {}}` wildcard or `require_field_match`.
- A row with no matching terms returns `null` (no `no_match_size` fallback).
- No highlighter choice (`unified`, `plain`, `fvh`), `highlight_query`, or `fragment_size` in characters. `num_words`
  controls snippet length in words.

---

## Vector and Semantic Search

These map one-to-one to ES|QL functions. See [esql-search.md](esql-search.md) for full syntax and options.

| Query DSL                                              | ES\|QL                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `knn` query or top-level `knn` with a query vector     | `WHERE KNN(field, [0.1, 0.2, ...])` (preview 9.2, GA 9.4)                       |
| `knn` with `query_vector_builder` (`text_embedding`)   | `WHERE KNN(field, TEXT_EMBEDDING("text", "endpoint-id"))` (preview 9.3, GA 9.4) |
| `semantic` query or `match` on a `semantic_text` field | `WHERE MATCH(semantic_field, "text")` or `WHERE semantic_field : "text"`        |

```json
{
  "knn": {
    "field": "embedding",
    "query_vector_builder": {
      "text_embedding": { "model_id": "my-embedding-endpoint", "model_text": "how do I tune search performance" }
    },
    "k": 10,
    "num_candidates": 100
  }
}
```

```esql
FROM docs METADATA _score
| WHERE KNN(embedding, TEXT_EMBEDDING("how do I tune search performance", "my-embedding-endpoint"))
| SORT _score DESC
| LIMIT 10
```

`KNN` requires a `dense_vector` (or `semantic_text`) field, and `TEXT_EMBEDDING` requires a `text_embedding` inference
endpoint.

---

## Rescoring and Hybrid Ranking

### Inference Reranking (text_similarity_reranker)

#### Query DSL

```json
{
  "retriever": {
    "text_similarity_reranker": {
      "retriever": { "standard": { "query": { "match": { "content": "elasticsearch" } } } },
      "field": "content",
      "inference_id": "my-rerank-endpoint",
      "inference_text": "how do I tune search performance",
      "rank_window_size": 50
    }
  }
}
```

#### ES|QL

`RERANK` (preview 9.2, GA 9.4) re-scores the rows in front of it, so `LIMIT` first to set the window. It overwrites
`_score` but does not re-sort:

```esql
FROM articles METADATA _score
| WHERE MATCH(content, "elasticsearch")
| SORT _score DESC
| LIMIT 50
| RERANK "how do I tune search performance" ON content WITH { "inference_id": "my-rerank-endpoint" }
| SORT _score DESC
| LIMIT 10
```

The endpoint needs the `rerank` task type. The DSL `rescore` element with a `query` rescorer (re-run a second query on
the top N hits) has no direct equivalent; approximate it by combining scores in `EVAL`.

### Reciprocal Rank Fusion and Linear Retrievers

#### Query DSL

```json
{
  "retriever": {
    "rrf": {
      "retrievers": [
        { "standard": { "query": { "match": { "title": "elasticsearch" } } } },
        { "standard": { "query": { "match": { "content": "performance" } } } }
      ],
      "rank_window_size": 10
    }
  }
}
```

#### ES|QL

Run each retriever as a `FORK` branch (preview 8.19/9.1, GA 9.4) and merge them with `FUSE` (preview 9.2, GA 9.5).
`FUSE` needs `METADATA _id, _index, _score`:

```esql
FROM articles METADATA _id, _index, _score
| FORK
    (WHERE MATCH(title, "elasticsearch") | SORT _score DESC | LIMIT 10)
    (WHERE MATCH(content, "performance") | SORT _score DESC | LIMIT 10)
| FUSE
| SORT _score DESC
| LIMIT 10
```

`FUSE` defaults to RRF. For a `linear` retriever, use
`FUSE linear WITH { "normalizer": "minmax", "weights": { "fork1": 0.7, "fork2": 0.3 } }`. A branch can use `KNN` or
semantic `MATCH` for hybrid search, and `RERANK` can follow `FUSE`.

---

## ES|QL Limitations (vs Query DSL)

Feature gaps and partial equivalents as of Elastic Stack 9.5 (Serverless differences noted):

| Feature                                  | Query DSL | ES\|QL                                                                                                             |
| ---------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| Highlighting                             | ✅        | Partial: `TOP_SNIPPETS` (preview 9.3; highlight tags 9.5 preview)                                                  |
| Nested queries                           | ✅        | ❌                                                                                                                 |
| Parent-child queries                     | ✅        | ❌                                                                                                                 |
| Scroll/pagination beyond 10k             | ✅        | ❌                                                                                                                 |
| Percolate queries                        | ✅        | ❌                                                                                                                 |
| Complex boosting                         | ✅        | Limited (`boost` option on full-text functions, `EVAL` on `_score`)                                                |
| Geo distance sorting                     | ✅        | ✅ `EVAL d = ST_DISTANCE(...)` then `SORT d`                                                                       |
| Runtime fields                           | ✅        | Use EVAL                                                                                                           |
| Suggest API                              | ✅        | ❌                                                                                                                 |
| Collapse (field collapsing)              | ✅        | ✅ `SORT` + `LIMIT 1 BY field` (preview 9.4); `DEDUP` for whole-row duplicates (Serverless preview; Stack planned) |
| Inner hits                               | ✅        | Partial: `LIMIT n BY` for collapse groups (flat rows); ❌ for nested and parent-child                              |
| Terms lookup                             | ✅        | ✅ `WHERE x IN (FROM idx \| KEEP col)` (preview 9.5)                                                               |
| Query rescorer                           | ✅        | ❌ (`RERANK` covers inference reranking, GA 9.4)                                                                   |
| Cumulative / moving-window pipeline aggs | ✅        | ❌ (time series windows via `TS` only)                                                                             |
| Timezone support                         | ✅        | ✅ `SET time_zone` (9.4+ GA; Serverless)                                                                           |
| JOIN (non-lookup)                        | N/A       | ❌ (only LEFT JOIN on lookup index)                                                                                |
| Subqueries / UNION ALL                   | N/A       | ✅ `FROM` subqueries (preview 9.4, GA 9.5); `WHERE IN`/`NOT IN` subqueries (preview 9.5)                           |

### Unsupported Field Types in ES|QL

- `nested` (fields are omitted from results entirely)
- `join` (parent-child)
- `binary`
- `completion`
- `flattened` before 9.5 (on 9.4, use `METADATA _source` + `JSON_EXTRACT` to access sub-keys; 9.5+ preview: root column
  plus `FIELD_EXTRACT`, see [Flattened Field Queries](#flattened-field-queries))
- Range types other than `date_range` (`integer_range`, `ip_range`, etc.); `date_range` is supported as a preview type
  in 9.5 with `RANGE_INTERSECTS`, `RANGE_WITHIN`, and related functions
- `rank_feature`, `rank_features`
- `search_as_you_type`
- `histogram`: only inside `TS`, cast with `::exponential_histogram` or `::tdigest` (preview 9.3, GA 9.4)

---

## Migration Checklist

When migrating from Query DSL to ES|QL:

1. **Check field type support** - Verify all fields use supported types
2. **Review aggregation complexity** - Deeply nested aggregations may need restructuring
3. **Handle scoring requirements** - Add `METADATA _score` if relevance sorting needed
4. **Adjust result limits** - ES|QL defaults to 1000 rows, max 10000
5. **Test full-text search** - Use `MATCH()`, `QSTR()`, or `KQL()` functions
6. **Validate time ranges** - ES|QL time syntax differs from DSL
7. **Check for unsupported features** - Nested and parent-child docs, cumulative pipeline aggregations, etc.
8. **Check version and deployment** - Preview features such as `LIMIT BY`, `TOP_SNIPPETS`, `FIELD_EXTRACT`, and
   `IN (subquery)` need a recent Stack version; `DEDUP` is Serverless only

---

## Performance Considerations

| Aspect           | Query DSL               | ES\|QL                 |
| ---------------- | ----------------------- | ---------------------- |
| Caching          | Filter context cached   | No equivalent caching  |
| Query planning   | Based on Lucene         | Dedicated query engine |
| Aggregations     | Can be memory-intensive | Block-based processing |
| Full-text search | Native Lucene           | Uses same analyzers    |

**ES|QL advantages:**

- Concurrent/parallel processing
- Block-based execution (more efficient for large scans)
- No query-to-DSL translation overhead

**Query DSL advantages:**

- More mature caching
- Better for complex scoring scenarios
- More features available

---

## Quick Reference Table

| Query DSL                  | ES\|QL Equivalent                          |
| -------------------------- | ------------------------------------------ |
| `match_all`                | `FROM index`                               |
| `term`                     | `WHERE field == value`                     |
| `terms`                    | `WHERE field IN (...)`                     |
| `match`                    | `WHERE MATCH(field, query)`                |
| `match_phrase`             | `WHERE MATCH_PHRASE(field, query)`         |
| `query_string`             | `WHERE QSTR("...")`                        |
| `range`                    | `WHERE field >= x AND field <= y`          |
| `bool.must`                | `WHERE cond1 AND cond2`                    |
| `bool.should`              | `WHERE cond1 OR cond2`                     |
| `bool.must_not`            | `WHERE (field != val OR field IS NULL)` \* |
| `bool.filter`              | `WHERE cond` (no scoring)                  |
| `exists`                   | `WHERE field IS NOT NULL`                  |
| `wildcard`                 | `WHERE field LIKE "pattern*"`              |
| `regexp`                   | `WHERE field RLIKE "pattern"`              |
| `prefix`                   | `WHERE STARTS_WITH(field, "prefix")`       |
| `terms` agg                | `STATS count = COUNT(*) BY field`          |
| `date_histogram`           | `STATS ... BY DATE_TRUNC(interval, field)` |
| `avg`, `sum`, `min`, `max` | `STATS AVG(f), SUM(f), MIN(f), MAX(f)`     |
| `cardinality`              | `STATS COUNT_DISTINCT(field)`              |
| `percentiles`              | `STATS PERCENTILE(field, p)`               |
| `filter` agg               | `COUNT(*) WHERE cond` (8.16+)              |
| `top_hits` (per bucket)    | `SORT field \| LIMIT n BY group` (9.4+)    |
| `collapse`                 | `SORT field \| LIMIT 1 BY field` (9.4+)    |
| `terms` lookup             | `WHERE f IN (FROM idx \| KEEP col)` (9.5+) |
| `term` on flattened key    | `WHERE FIELD_EXTRACT(root, "key") == v`    |
| `random_sampler` agg       | `SAMPLE p`                                 |
| `bucket_script`            | `EVAL` after `STATS`                       |
| `bucket_selector`          | `WHERE` after `STATS`                      |
| `highlight`                | `EVAL TOP_SNIPPETS(field, query, {...})`   |
| `knn`                      | `WHERE KNN(field, vector)`                 |
| `semantic`                 | `WHERE MATCH(semantic_field, text)`        |
| `text_similarity_reranker` | `RERANK query ON field WITH {...}`         |
| `rrf` / `linear` retriever | `FORK (...) (...) \| FUSE [linear]`        |
| `runtime_mappings`         | `EVAL`                                     |
| `geoip` ingest processor   | `IP_LOCATION prefix = ip` (9.5+)           |
| `_source`                  | `KEEP field1, field2`                      |
| `sort`                     | `SORT field DESC`                          |
| `size`                     | `LIMIT n`                                  |

\* ES|QL uses three-valued logic. `field != value` excludes NULLs, unlike DSL `must_not` which keeps documents where the
field is missing. Add `OR field IS NULL` to match DSL behavior.
