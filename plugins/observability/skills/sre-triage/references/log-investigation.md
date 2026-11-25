# Log Investigation

The log funnel: how to get from a raw log stream to the handful of messages that explain a degradation. Logs explain a
verdict; they never set one. Every query here is ES|QL run with `POST /_query`. Do not use Query DSL, and do not use the
ES|QL `KQL` search function — write predicates natively.

## The funnel workflow

**You must iterate.** Do not stop after one query. Keep excluding noise with `NOT` until **fewer than 20 log patterns**
(distinct message categories) remain. **Always keep the full filter when iterating:** concatenate new exclusions onto
the previous predicate; do not zoom out or drop earlier exclusions.

1. **Round 1 — broad.** Run a query with only the scope filter (for example `service.name == "cart"`) and the time
   range. Get total count, histogram, sample logs, and message categorization (common and rare patterns) in one call.
2. **Inspect.** Look at the **histogram** (when spikes or drops occur), the **sample messages**, and the **categorized
   patterns**. If the histogram shows a sharp spike at a specific time, narrow the time range around that spike for the
   next round. Count how many distinct patterns remain and identify the high-volume noise to exclude.
3. **Round 2 — exclude noise.** Add `NOT ... LIKE` clauses for the dominant noise patterns. Re-run with the **full**
   predicate — all previous exclusions plus the new ones.
4. **Repeat.** Keep adding exclusions and re-running with the full predicate. Do **not** stop after one or two rounds.
   Continue until **fewer than 20 log patterns remain**. The remaining set is small enough to interpret as the
   interesting bits: errors, anomalies, root cause.
5. **Pivot (optional).** Once the funnel isolates a specific entity (`container.id`, `k8s.pod.name`, `host.name`), run
   one more query focused on that entity to see its dying words and surrounding context.
6. **Step back (if needed).** If the funnel does not reveal the cause, view logs in context around the key document
   (preceding and following it in time), or pivot to a different entity and start a fresh funnel.

If you stop before reaching fewer than 20 log patterns, you will report noise instead of the actual failures. Each
intermediate result exists only to decide the next call; only the final narrowed result belongs in context and in the
summary.

## Query conventions

| Parameter | Type   | Description                                                             |
| --------- | ------ | ----------------------------------------------------------------------- |
| `start`   | string | Start of the time range (Elasticsearch date math, for example `now-1h`) |
| `end`     | string | End of the time range (for example `now`)                               |
| `limit`   | number | Maximum log samples to return (10-20 by default; cap at 500)            |
| `groupBy` | string | Optional field to group the histogram by (for example `service.name`)   |

Narrowing is expressed as an **ES|QL predicate** in a `WHERE` clause, not as a separate filter string. Combine scope and
exclusions with `AND`:

```esql
WHERE service.name == "checkout" AND severity_number >= 17
WHERE NOT message LIKE "*GET /health*"
WHERE error.exception.message IS NOT NULL AND NOT message LIKE "*Known benign warning*"
```

The first predicate deliberately does not say `log.level == "error"`; see
[the `log.level` caveat](#two-caveats-that-decide-whether-a-funnel-works) for why that particular comparison returns
nothing on most OTel data.

Use flat OTel field paths (`k8s.pod.name`, `k8s.namespace.name`). Observability index templates alias ECS names onto
OTel documents, so `kubernetes.pod.name` and `service.environment` also resolve; when a field can be absent in the
deployment at hand, confirm it before building a funnel on it.

### Null-safety when excluding

`NOT msg LIKE "*noise*"` evaluates to `null` — and therefore drops the row — when `msg` itself is `null`. On real OTel
data a large share of log records have no `message` at all, so a naive exclusion silently deletes most of the stream.
Guard it:

```esql
| EVAL msg = COALESCE(body.text, message, error.exception.message)
| WHERE msg IS NOT NULL AND NOT msg LIKE "*ValkeyCartStore*"
```

Or keep the unmatched rows explicitly with `WHERE msg IS NULL OR NOT msg LIKE "*...*"` when the records without a
message body still matter.

## Context minimization

Keep the context window small. In the sample branch of the query, **`KEEP` only a subset of fields**; do not return full
documents by default. A small summary (10 documents with `KEEP`) stays under roughly 1000 tokens; a single full JSON
document can exceed 4000.

**Recommended `KEEP` list for sample logs:** `@timestamp`, `message`, `service.name`, `k8s.container.name`,
`k8s.node.name`, `k8s.namespace.name`, `k8s.pod.name`, `host.name`, `container.id`, `agent.name`, `trace.id`.

**Limit samples:** default to 10-20 logs per query. Cap at 500; do not fetch thousands in one call. Each funnel step
only decides the next call — only the final narrowed result is worth keeping in context and summarizing.

## Message field fallback order

When building a single message value for display or categorization, use the first non-empty of:

1. `body.text` (OTel)
2. `message`
3. `error.message`
4. `event.original`
5. `exception.message`
6. `error.exception.message`
7. `attributes.exception.message` (OTel)

Express it as `COALESCE(...)` over the fields that exist in the deployment. `COALESCE` on a field absent from the
mapping fails the query, so confirm the fields first when working against unfamiliar data.

**Do not assume the whole list is available.** On a Stack 9.4.4 cluster carrying EDOT OTel logs, `_field_caps` over
`logs-*.otel-*` found `body.text`, `message`, `exception.message`, `error.exception.message` and
`attributes.exception.message`, but `error.message` and `event.original` were **absent from the mapping entirely** —
naming either in a `COALESCE` or a `WHERE` fails the whole query with `Unknown column`. `error.message` is an ECS field
that arrives via the ECS-to-OTel aliasing on integration-sourced logs; it is not created by the OTel index templates
alone. Run `GET logs-*/_field_caps?fields=body.text,message,error.message,error.exception.message,exception.message` and
build the `COALESCE` from what comes back.

## The one-call funnel query

Always return, in a single request: a time-series histogram, the total count, a small sample of logs, and message
categorization (common and rare patterns). The histogram is the primary signal — it shows when spikes or drops occur and
guides the next filter. `FORK` computes all five branches in one query.

```esql
FROM logs-*.otel-* METADATA _id, _index
| WHERE @timestamp >= NOW() - 1 hour AND service.name == "cart"
| FORK (STATS count = COUNT(*) BY bucket = BUCKET(@timestamp, 1 minute) | SORT bucket)
       (STATS total = COUNT(*))
       (SORT @timestamp DESC | LIMIT 10 | KEEP _id, _index, @timestamp, message, service.name, k8s.pod.name)
       (LIMIT 10000 | STATS pattern_count = COUNT(*) BY pattern = CATEGORIZE(message) | SORT pattern_count DESC | LIMIT 20)
       (LIMIT 10000 | STATS pattern_count = COUNT(*) BY pattern = CATEGORIZE(message) | SORT pattern_count ASC | LIMIT 20)
| LIMIT 500
```

**The trailing `LIMIT` applies across all branches combined, and when it truncates it drops whole branches silently.**
`FORK` concatenates the branches in order, so the outer limit is spent on `fork1` first. With a 1-minute bucket over a
one-hour window the branches are 60 + 1 + 10 + 20 + 20 = 111 rows, which already exceeds the `LIMIT 100` this query
carried until now; a 30-second bucket makes it 120 + 1 + 10 + 20 + 20. Measured on Stack 9.4.4 over a one-hour window
with a 30-second bucket, the two limits return:

| Outer `LIMIT` | Rows | `fork1` | `fork2` | `fork3` | `fork4` | `fork5` |
| ------------- | ---- | ------- | ------- | ------- | ------- | ------- |
| 100           | 100  | 99      | 1       | 0       | 0       | 0       |
| 500           | 169  | 120     | 1       | 10      | 19      | 19      |

At `LIMIT 100` the samples and both categorization branches are **absent entirely** — no error, no partial rows, no
indication that three of five branches were discarded. An agent reading that result concludes the logs have no message
patterns when they have nineteen. This is not version- or flavour-specific: it reproduces identically on Serverless
9.6.0 and Stack 9.4.4. Keep the outer limit above the sum of the branch limits, and if you shrink the bucket size, raise
it again.

### Before you run this: two availability gates

This one query depends on the two newest features in the skill, and both fail in ways that are easy to misread as "the
service has no logs".

- **`FORK`** is GA on Serverless. On Stack it is preview in 9.1-9.3 and GA from 9.4, and it does not parse at all on 8.x
  or 9.0. Below 9.1, run the five branches as five separate queries against the same `WHERE` clause and combine them
  yourself — you lose the single-round-trip property, not the workflow. On Stack 9.1-9.3 the command parses but adds an
  implicit `LIMIT 1000` to each branch, so the `LIMIT 10000` on the categorization branches is silently capped and the
  pattern counts under-report.
- **`CATEGORIZE`** is GA on Serverless, and on Stack it is preview in 9.0 and GA from 9.1 — but it **requires a Platinum
  licence** on Stack at every version. This is not a version check: a 9.6 cluster on Basic or Gold fails it, and the
  error names the licence. When it is unavailable, drop the two categorization branches and group by a truncated message
  prefix instead:

  ```esql
  | STATS n = COUNT(*) BY pattern = LEFT(msg, 60)
  | SORT n DESC
  | LIMIT 20
  ```

  The prefix form is coarser: it splits one logical pattern into several when the variable part appears early in the
  message. On live OTel data it still surfaced the same dominant noise patterns that `CATEGORIZE` found, which is enough
  to drive the exclusion loop. Say in the answer that categorization was approximate.

Check `GET /` first. `build_flavor: "serverless"` means both are available; otherwise read `version.number` and, on
Stack, confirm the licence before using `CATEGORIZE`. If either is unavailable, say which one and that the funnel ran in
degraded form. Never let a parse or licence error become "log data is unavailable".

**Fork interpretation.** The response carries a `_fork` column identifying each branch:

| Branch    | Contents                                                | How to use it                                              |
| --------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| **fork1** | Trend — count per time bucket                           | Spot spikes and drops; narrow the time range around them   |
| **fork2** | Total count, single row                                 | See how much noise remains after each round                |
| **fork3** | Sample logs                                             | Decide which exclusions to add next                        |
| **fork4** | Common patterns — top 20 by count, from up to 10k logs  | Add exclusions for the dominant noise                      |
| **fork5** | Rare patterns — bottom 20 by count, from up to 10k logs | Find the needles: the one-off exception, the first failure |

Count distinct patterns across fork4 and fork5 and **continue iterating until fewer than 20 patterns remain**.

Adjust the index pattern (`logs-*.otel-*`, `logs-*`), the time range, and the bucket size (`30s`, `1m`, `5m`, `1h`) to
the investigation. `logs-*.otel-*` covers EDOT/OTel ingest only: logs shipped by Filebeat or an Elastic Agent
integration land in `filebeat-*` and `logs-*-*`, and wired streams in `logs.*` — when the service's ingest path is
unknown, start wide with `logs-*,filebeat-*` and narrow from what returns. Aim for roughly 20-50 buckets over the
window: a 1-hour window suits a `1m` or `2m` bucket.

## Excluding noise

Add exclusions to the same `WHERE` clause and re-run the whole `FORK` query with the accumulated predicate:

```esql
FROM logs-*.otel-*
| WHERE @timestamp >= NOW() - 1 hour AND service.name == "cart"
| EVAL msg = COALESCE(body.text, message)
| WHERE msg IS NOT NULL
  AND NOT msg LIKE "*ValkeyCartStore*"
  AND NOT msg LIKE "*called with userId*"
| STATS n = COUNT(*) BY pattern = CATEGORIZE(msg)
| SORT n DESC
| LIMIT 20
```

`LIKE` uses `*` and `?` wildcards on keyword fields. For regular-expression exclusions use `RLIKE`. For full-text
matching on analyzed fields, `MATCH` is available — but prefer `LIKE` on the message field for funnel work, because it
is literal and predictable.

Every round keeps every earlier exclusion. Dropping one and re-adding another later re-admits noise you already ruled
out and makes the pattern count meaningless.

## Histogram grouped by a dimension

Break the trend down by a second dimension to see which entity drives a spike:

```esql
FROM logs-*.otel-*
| WHERE @timestamp >= NOW() - 1 hour AND k8s.namespace.name == "otel-demo"
| STATS count = COUNT(*) BY bucket = BUCKET(@timestamp, 1 minute), service.name
| SORT count DESC
| LIMIT 200
```

Keep the number of group values bounded — take the top N by count rather than every value — or the result explodes.

## Two caveats that decide whether a funnel works

**`log.level` is unreliable, and `log.level == "error"` is worse than unreliable — it is a silent empty.** Many logs
have missing or incorrect level metadata: everything logged as `info`, or the level present only in the message text. On
live OTel data roughly three-quarters of log records carried no level at all, and the records that did have one
disagreed on case and spelling.

On Stack 9.4.4, `log.level` is mapped as a `keyword` and mirrors `severity_text` value for value, so the field exists
and the query is valid — it just matches nothing. Measured over the full retention of one cluster:

| `log.level` value | Records   |
| ----------------- | --------- |
| _(empty)_         | 1,081,170 |
| `Information`     | 208,272   |
| `SEVERE`          | 3,035     |
| `Warning`         | 553       |
| `Normal`          | 280       |
| `INFO`            | 15        |

There is no `error` value anywhere, so `WHERE log.level == "error"` returns zero rows with no error on a cluster holding
3,035 error-severity records — it reports a healthy service. The lowercase ECS vocabulary (`error`, `warn`, `info`) is
not what the OTel SDKs emit; each language SDK writes its own `severity_text` (`SEVERE` from Java, `Information` from
.NET, `Normal` from the Kubernetes events receiver), and the ECS-to-OTel aliasing copies that string through unchanged
rather than normalizing it.

When you need a severity predicate, use the numeric `severity_number`, which **is** normalized by the OTel
specification: `>= 17` is error and above, `>= 13` warning and above, `>= 9` info and above. On the cluster above it
lined up exactly — `9` for all three of `INFO`, `Normal` and `Information`, `13` for `Warning`, `17` for `SEVERE` — and
`WHERE severity_number >= 17` returned the 3,035 records that the `log.level` comparison missed. Note that
`severity_number` is null on the same records that have no `severity_text`, so it fixes the vocabulary problem but not
the coverage one: a severity predicate of any kind still only sees the quarter of records that carry a level at all.
Otherwise treat `log.level` and `severity_text` as hints only, and funnel by message content or by the structured error
fields instead. If you must use the text form, enumerate the values that exist first with
`STATS COUNT(*) BY severity_text` rather than assuming a vocabulary.

**Bare keyword searches for "error" are flawed.** Searching for words like `error` or `fail` matches harmless mentions:
"no error", "error code 0", stack traces that merely reference the word, and healthy retry messages. They also miss
failures that never use the word. Scope by service or entity and iterate with exclusions on real message patterns rather
than trusting a single keyword.

## Finding actual failures

Prefer structured error fields over keyword matching:

```esql
FROM logs-*.otel-*
| WHERE @timestamp >= NOW() - 1 hour AND service.name == "payment"
| WHERE error.exception.message IS NOT NULL OR exception.type IS NOT NULL
| EVAL msg = COALESCE(error.exception.message, exception.message, body.text, message)
| KEEP @timestamp, service.name, error.exception.type, msg, trace.id
| SORT @timestamp DESC
| LIMIT 20
```

Zero rows here means no structured exceptions were recorded — the application might not be logging them, or might be
writing them into the message body. It does not mean nothing failed. Fall back to the funnel.

## Pivoting to a single trace

When a failing trace is in hand from the APM signals, pull every log that shares its ID. This is the single most direct
way to explain one failure:

```esql
FROM logs-*.otel-*
| WHERE @timestamp >= NOW() - 1 hour AND trace.id == "5158cfc84aa0e3d4a16365c81c21bf0e"
| EVAL msg = COALESCE(body.text, message)
| KEEP @timestamp, service.name, k8s.pod.name, msg
| SORT @timestamp ASC
| LIMIT 100
```

`trace.id` is populated on OTel log records that were emitted inside an instrumented request, and it spans services — so
one query returns the whole request path, in order, across every service that touched it.

## Resource metadata field fallbacks

For display or grouping, use the first field that exists in the deployment:

| Resource  | Try in order                                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Service   | `service.name`                                                                                                                      |
| Container | `k8s.container.name` → `kubernetes.container.name` → `container.name`                                                               |
| Host/Node | `k8s.node.name` → `kubernetes.node.name` → `host.name`                                                                              |
| Cluster   | `k8s.cluster.name` → `orchestrator.cluster.name`                                                                                    |
| Namespace | `k8s.namespace.name` → `kubernetes.namespace`                                                                                       |
| Pod       | `k8s.pod.name` → `kubernetes.pod.name`                                                                                              |
| Workload  | `k8s.deployment.name` → `k8s.replicaset.name` → `k8s.statefulset.name` → `k8s.daemonset.name` → `k8s.job.name` → `k8s.cronjob.name` |

| ECS field             | OTel equivalent          |
| --------------------- | ------------------------ |
| `message`             | `body.text`              |
| `log.level`           | `severity_text`          |
| `trace.id`            | `trace_id`               |
| `span.id`             | `span_id`                |
| `service.environment` | `deployment.environment` |

## Related documentation

- [ES|QL FORK command](https://www.elastic.co/docs/reference/query-languages/esql/commands/fork) — branch limits,
  default `LIMIT` behavior, preview status
- [ES|QL CATEGORIZE function](https://www.elastic.co/docs/reference/query-languages/esql/functions-operators/grouping-functions/categorize)
  — license requirement and grouping constraints
- [Use the ES|QL REST API](https://www.elastic.co/docs/reference/query-languages/esql/esql-rest) — `POST /_query`, async
  queries, response formats
