---
name: observability-logs-search
description: >
  Search and filter Observability logs using ES|QL. Use when investigating log spikes,
  errors, or anomalies; getting volume and trends; or drilling into services or containers
  during incidents.
metadata:
  author: elastic
  version: 0.2.0
---

# Logs Search

Search and filter logs to support incident investigation. The workflow mirrors Kibana Discover: apply a time range and
scope filter, then **iteratively add exclusion filters (NOT)** until a small, interesting subset of logs remains—either
the root cause or the key document. Optionally view logs in context (preceding and following that document) or pivot to
another entity and start a fresh search. Use ES|QL only (`POST /_query`); do not use Query DSL.

## When NOT to use

- **Metrics or traces** — use the dedicated metric or trace tools.

## Parameter conventions

Use consistent names for Observability log search:

| Parameter   | Type   | Description                                                                 |
| ----------- | ------ | --------------------------------------------------------------------------- |
| `start`     | string | Start of time range (Elasticsearch date math, e.g. `now-1h`)                |
| `end`       | string | End of time range (e.g. `now`)                                              |
| `kqlFilter` | string | KQL query string to narrow results. Not `query`, `filter`, or `kql`.        |
| `limit`     | number | Maximum log samples to return (e.g. 10–100)                                 |
| `groupBy`   | string | Optional field to group the histogram by (e.g. `log.level`, `service.name`) |

For entity filters, use ECS field names: `service.name`, `host.name`, `service.environment`, `kubernetes.pod.name`,
`kubernetes.namespace`. Query ECS names only; OpenTelemetry aliases map automatically in Observability indices.

### Context minimization

Keep the context window small. In the sample branch of the query, **KEEP only a subset of fields**; do not return full
documents by default. A small summary (e.g. 10 docs with KEEP) stays under ~1000 tokens; a single full JSON doc can
exceed 4000 tokens.

**Recommended KEEP list for sample logs:**  
`message`, `error.message`, `service.name`, `container.name`, `host.name`, `container.id`, `agent.name`,
`kubernetes.container.name`, `kubernetes.node.name`, `kubernetes.namespace`, `kubernetes.pod.name`

**Message fallback:** If present, use the first non-empty of: `body.text` (OTel), `message`, `error.message`,
`event.original`, `exception.message`, `error.exception.message`, `attributes.exception.message` (OTel). Observability
index templates often alias these; when building a single “message” for display, prefer that order.

**Limit samples:** Default to a small sample (10–20 logs) per query. Cap at 500; do not fetch thousands in one call.
Each funnel step is only to decide the next call—only the final narrowed result is the one to keep in context and
summarize.

## The funnel workflow

**You must iterate.** Do not stop after one query. Keep excluding noise with `NOT` until **fewer than 20 log patterns**
(distinct message categories) remain. **Always keep the full filter when iterating:** concatenate new NOTs to the
previous KQL; do not “zoom out” or drop earlier exclusions.

1. **Round 1 — broad:** Run a query with only the scope filter (e.g. `service.name: advertService`) and time range. Get
   total count, histogram, sample logs, and message categorization (common + rare patterns).
2. **Inspect:** Look at the **histogram** (when spikes or drops occur), the **sample messages**, and the **categorized
   patterns** (fork4 = top patterns by count, fork5 = rare patterns). If the histogram shows a sharp spike at a specific
   time, narrow the time range (t_start, t_end) around that spike for the next round. Count how many distinct log
   patterns remain (from the categorization); identify high-volume noise to exclude.
3. **Round 2 — exclude noise:** Add `NOT` clauses to the KQL filter for the dominant noise patterns. Run the query again
   with the **full** filter (all previous NOTs plus new ones).
4. **Repeat:** Keep adding `NOT` clauses and re-running with the full filter. Do **not** stop after one or two rounds.
   Continue until **fewer than 20 log patterns remain** (use the categorization result to count distinct message
   categories). Then the remaining set is small enough to interpret as the interesting bits (errors, anomalies, root
   cause).
5. **Pivot (optional):** Once the funnel isolates a specific entity (e.g. `container.id`, `host.name`), run one more
   query focused on that entity to see its “dying words” or surrounding context.
6. **Step back (if needed):** If the funnel does not reveal the root cause, consider viewing logs in context (preceding
   and following the key document) or a different entity and start a fresh search.

If you stop before reaching fewer than 20 log patterns, you will report noise instead of the actual failures. Each
intermediate result is only for deciding the next call; only the final narrowed result should be kept in context and
summarized.

## ES|QL patterns for log search

Use ES|QL (`POST /_query`) only; do not use Query DSL. **Always** return in one request: a time-series histogram, total
count, a small sample of logs, and **message categorization** (common and rare patterns). The histogram is the primary
signal—it shows when spikes or drops occur and guides the next filter. Use `FORK` to compute trend, total, samples, and
categorization in a single query.

**FORK output interpretation:** The response contains multiple result sets identified by a `_fork` column (or
equivalent). Map them as: **fork1** = trend (count per time bucket), **fork2** = total count (single row), **fork3** =
sample logs, **fork4** = common message patterns (top 20 by count, from up to 10k logs), **fork5** = rare message
patterns (bottom 20 by count, from up to 10k logs). Use fork1 to spot when to narrow the time range; use fork2 to see
how much noise remains; use fork3 to decide which NOTs to add next; use fork4 and fork5 to see how many distinct log
patterns remain and to choose the next exclusions—**continue iterating until fewer than 20 log patterns remain**.

### KQL guidance

- Prefer **phrase queries** for specificity when the target text is tokenized as you expect (e.g.
  `message: "GET /health"`, `service.name: "advertService"`).
- If the target would not be tokenized as a single term, use a **wildcard** (e.g. `message: *Returning*`,
  `message: *WARNING*`). Do **not** put wildcard characters inside quoted phrases.
- Use **explicit fielded KQL**: `service.name: "payment-api"`, `message: "GET /health"`,
  `NOT kubernetes.namespace: "kube-system"`, `error.message: * AND NOT message: "Known benign warning"`.
- **Filtering on `log.level`** (e.g. `log.level: error`) can be useful, but it is **often flawed**: many logs have
  missing or incorrect level metadata (e.g. everything as "info", or level only in the message text). Prefer funneling
  by message content or `error.message` when hunting failures; treat `log.level` as a hint, not a reliable filter.
- **Random full-text searches for words like "error"** are also **often flawed**: they match harmless mentions (e.g. "no
  error", "error code 0", stack traces that reference the word). Prefer scoping by service/entity and iterating with NOT
  exclusions on actual message patterns rather than relying on a single keyword.

### Basic log search with histogram, samples, and categorization

Include message categorization so you can count distinct log patterns and iterate until fewer than 20 remain. Use a
five-way FORK: trend, total, samples, common patterns, rare patterns.

```json
POST /_query
{
  "query": "FROM logs-* METADATA _id, _index | WHERE @timestamp >= TO_DATETIME(\"2025-03-06T10:00:00.000Z\") AND @timestamp <= TO_DATETIME(\"2025-03-06T11:00:00.000Z\") | FORK (STATS count = COUNT(*) BY bucket = BUCKET(@timestamp, 1m) | SORT bucket) (STATS total = COUNT(*)) (SORT @timestamp DESC | LIMIT 10 | KEEP _id, _index, message, error.message, service.name, container.name, host.name, kubernetes.container.name, kubernetes.node.name, kubernetes.namespace, kubernetes.pod.name) (LIMIT 10000 | STATS COUNT(*) BY CATEGORIZE(message) | SORT `COUNT(*)` DESC | LIMIT 20) (LIMIT 10000 | STATS COUNT(*) BY CATEGORIZE(message) | SORT `COUNT(*)` ASC | LIMIT 20)"
}
```

- **fork4** (common): top 20 message patterns by count, from up to 10,000 logs—use to add NOTs for dominant noise.
- **fork5** (rare): bottom 20 message patterns by count—helps spot needles in the haystack.  
  Count distinct patterns across fork4/fork5 (and the overall categorization) and **continue iterating until fewer than
  20 log patterns remain**.

Adjust the index pattern (e.g. `logs-*`, `logs-*-*`), time range, and bucket size (e.g. `30s`, `5m`, `1h`). Keep sample
LIMIT small (10–20 by default; cap at 500). Use KEEP so the sample branch returns only summary fields, not full
documents.

### Adding a KQL filter

Narrow results with `KQL("...")`. The KQL expression is a single double-quoted string in ES|QL.

**Escaping in the request body:** The query is sent inside JSON, so every double quote that is part of the ES|QL string
must be escaped. Use `\"` for the quotes that wrap the KQL expression. If the KQL expression itself contains double
quotes (e.g. a phrase like `message: "GET /health"`), escape those in the JSON as `\\\"` so the KQL parser receives
literal quote characters.

```json
POST /_query
{
  "query": "FROM logs-* METADATA _id, _index | WHERE @timestamp >= TO_DATETIME(\"2025-03-06T10:00:00.000Z\") AND @timestamp <= TO_DATETIME(\"2025-03-06T11:00:00.000Z\") | WHERE KQL(\"service.name: checkout AND log.level: error\") | FORK (STATS count = COUNT(*) BY bucket = BUCKET(@timestamp, 1m) | SORT bucket) (STATS total = COUNT(*)) (SORT @timestamp DESC | LIMIT 10 | KEEP _id, _index, message, error.message, service.name, host.name, kubernetes.pod.name) (LIMIT 10000 | STATS COUNT(*) BY CATEGORIZE(message) | SORT `COUNT(*)` DESC | LIMIT 20) (LIMIT 10000 | STATS COUNT(*) BY CATEGORIZE(message) | SORT `COUNT(*)` ASC | LIMIT 20)"
}
```

### Excluding noise with NOT

Build the funnel by excluding known noise. In the request body, wrap the KQL string in `\"...\"` and escape any quotes
inside the KQL expression as `\\\"`:

```json
"query": "... | WHERE KQL(\"NOT message: \\\"GET /health\\\" AND NOT kubernetes.namespace: \\\"kube-system\\\"\") | ..."
```

```json
"query": "... | WHERE KQL(\"error.message: * AND NOT message: \\\"Known benign warning\\\"\") | ..."
```

### Histogram grouped by a dimension

Break down the trend by a second dimension (e.g. `log.level`, `service.name`) to see which level or entity drives the
spike:

```text
STATS count = COUNT(*) BY bucket = BUCKET(@timestamp, 1m), log.level
```

Use a limited set of group values in the response to avoid explosion (e.g. top N by count, rest as `_other`).

## Examples

### Last hour of logs for a service

```json
POST /_query
{
  "query": "FROM logs-* METADATA _id, _index | WHERE @timestamp >= NOW() - 1 hour AND @timestamp <= NOW() | WHERE KQL(\"service.name: api-gateway\") | SORT @timestamp DESC | LIMIT 20"
}
```

### Error logs with trend and samples

```json
POST /_query
{
  "query": "FROM logs-* METADATA _id, _index | WHERE @timestamp >= NOW() - 2 hours AND @timestamp <= NOW() | WHERE KQL(\"log.level: error\") | FORK (STATS count = COUNT(*) BY bucket = BUCKET(@timestamp, 5m) | SORT bucket) (STATS total = COUNT(*)) (SORT @timestamp DESC | LIMIT 15)"
}
```

### Iterative funnel: NOT and NOT and NOT until the interesting bits

Do not stop after one exclusion. Each round, add more NOTs for the current top noise, then run again.

**Round 1:** `KQL("service.name: advertService")` → e.g. 55k logs; samples show "Returning N ads", "WARNING:
request...", "received ad request".

**Round 2:** Exclude the biggest noise:  
`KQL("service.name: advertService AND NOT message: *Returning* AND NOT message: *WARNING*")` → re-run, check new total
and samples.

**Round 3:** Exclude next noise (e.g. request/cache chatter):  
`KQL("service.name: advertService AND NOT message: *Returning* AND NOT message: *WARNING* AND NOT message: *received ad request* AND NOT message: *Adding* AND NOT message: *Cache miss*")` →
re-run.

**Round 4+:** Keep adding NOTs for whatever still dominates the samples (use fork4/fork5 categorization to see
patterns). Continue until **fewer than 20 log patterns remain**; then what remains is the signal to report (e.g. "error
fetching ads", encoding issues).

Escaping: wrap the KQL string in `\"...\"` in the JSON; for quoted phrases inside KQL use `\\\"`.

## Guidelines

- **Funnel: iterate with NOT.** Do not report findings after a single broad query. Add NOT clauses for dominant noise,
  re-run with the **full** filter (keep all previous NOTs), and repeat until **fewer than 20 log patterns remain** (use
  categorization fork4/fork5 to count). Stopping early yields noise, not signal.
- **Histogram first:** Use the trend (fork1) to see when spikes or drops occur; narrow the time range around the spike
  if needed before adding more NOTs.
- **Context minimization:** KEEP only summary fields in the sample branch; default LIMIT 10–20, cap at 500. Each funnel
  step is for deciding the next call; only the final narrowed result is for context and summary.
- **Request body escaping:** The `query` value is JSON. Escape double quotes in the ES|QL string: `\"` for the KQL
  wrapper, `\\\"` for quotes inside the KQL expression (e.g. phrase values).
- Use Elasticsearch date math for `start` and `end` (e.g. `now-1h`, `now-15m`) when building queries programmatically.
- Choose bucket size from the time range: aim for roughly 20–50 buckets (e.g. 1h window → `1m` or `2m`).
- Prefer ECS field names. In Observability index templates, OTel fields are aliased to ECS; see
  [references/log-search-reference.md](references/log-search-reference.md) for resource metadata field fallbacks
  (container, host, cluster, namespace, pod, workload).
- **`log.level`:** Filtering or grouping by it can be OK but is often unreliable when levels are missing or mis-set;
  prefer message content or `error.message` for finding failures.
- **Keyword searches:** Searching only for words like "error" or "fail" is often flawed (e.g. "no error", "error code
  0"); prefer scoping by entity and funneling with NOT on real message patterns.

## References

- [references/log-search-reference.md](references/log-search-reference.md) — ECS/OTel field mapping and index patterns
