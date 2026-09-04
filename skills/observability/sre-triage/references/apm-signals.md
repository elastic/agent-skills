# APM Signals

ES|QL patterns for the trace- and metric-derived signals used in triage: throughput, latency, error rate, dependency
health, subpopulation correlation, ML anomalies, and infrastructure saturation. Every query here was executed against
Elasticsearch 9.6.0 with live OpenTelemetry data. Run them with `POST /_query`.

## Scoping rules

- Filter by `service.name` and a bounded `@timestamp` range on every query.
- Add `kind == "Server"` when measuring a service's own throughput and latency. Without it, client spans emitted by the
  same service are counted as inbound traffic and both the rate and the percentiles are wrong.
- `duration` on OTel spans is in **nanoseconds**. Divide by `1000000.0` for milliseconds.
- Prefer `event.outcome == "failure"` to identify failed spans. `status.code == "Error"` marks the same spans but is
  `null` on successful ones, so aggregating it requires a `CASE`.
- Cap every query with `LIMIT`. Choose a bucket size that yields roughly 20-50 buckets over the window.

## Throughput, latency, and error rate over time

```esql
FROM traces-*.otel-*
| WHERE service.name == "frontend" AND kind == "Server"
  AND @timestamp >= NOW() - 1 hour
| STATS requests = COUNT(*),
        failures = COUNT(*) WHERE event.outcome == "failure",
        p95_ms = ROUND(PERCENTILE(duration, 95) / 1000000.0, 2)
    BY bucket = BUCKET(@timestamp, 5 minute)
| EVAL error_rate = ROUND(COALESCE(failures, 0)::double / requests, 4)
| SORT bucket DESC
| LIMIT 500
```

`COALESCE` matters: `COUNT(*) WHERE ...` returns `null`, not `0`, when nothing matches, and a `null` error rate reads as
missing data rather than as zero failures.

## Current window against the prior window

A single window of absolute numbers does not support a verdict. Split one query into two comparable windows:

```esql
FROM traces-*.otel-*
| WHERE service.name == "frontend" AND kind == "Server"
  AND @timestamp >= NOW() - 2 hours
| EVAL window = CASE(@timestamp >= NOW() - 1 hour, "current", "previous")
| STATS requests = COUNT(*),
        avg_ms = ROUND(AVG(duration) / 1000000.0, 2),
        p95_ms = ROUND(PERCENTILE(duration, 95) / 1000000.0, 2),
        p99_ms = ROUND(PERCENTILE(duration, 99) / 1000000.0, 2),
        failures = COUNT(*) WHERE event.outcome == "failure"
    BY window
| EVAL error_rate = ROUND(COALESCE(failures, 0)::double / requests, 4)
| KEEP window, requests, avg_ms, p95_ms, p99_ms, error_rate
```

Reading it:

- **p99 up, p50/avg flat** — a tail problem. A subset of requests is affected; go to subpopulation correlation.
- **All percentiles up together** — a whole-service change: a deploy, a saturated resource, or a slow dependency on the
  hot path.
- **Requests down sharply, error rate flat** — the callers stopped calling. The change is upstream, not here.
- **Requests up and latency up** — load-driven. Check saturation before blaming code.

## Error rate by route

Localize errors to a route before going deeper:

```esql
FROM traces-*.otel-*
| WHERE service.name == "checkout" AND kind == "Server"
  AND @timestamp >= NOW() - 1 hour
| STATS requests = COUNT(*),
        failures = COUNT(*) WHERE event.outcome == "failure"
    BY span.name
| EVAL error_rate = ROUND(COALESCE(failures, 0)::double / requests, 4)
| WHERE requests >= 20
| SORT error_rate DESC
| LIMIT 20
```

`transaction.name` is available on transaction documents and is often coarser (for example the HTTP method); `span.name`
carries the operation. Group by whichever is populated for the service at hand.

## Dependency health

Downstream call volume, latency, and failure rate come from the 1-minute dependency rollup:

```esql
FROM metrics-service_destination.1m.otel-*
| WHERE service.name == "frontend" AND @timestamp >= NOW() - 1 hour
| STATS calls = SUM(span.destination.service.response_time.count),
        total_us = SUM(span.destination.service.response_time.sum.us),
        failed = SUM(span.destination.service.response_time.count) WHERE event.outcome == "failure"
    BY span.destination.service.resource
| EVAL avg_ms = ROUND(total_us / calls / 1000.0, 2),
       failure_rate = ROUND(COALESCE(failed, 0)::double / calls, 4)
| KEEP span.destination.service.resource, calls, avg_ms, failure_rate
| SORT calls DESC
| LIMIT 20
```

**Zero rows is a finding, not a pass.** A service with no rows in `metrics-service_destination.1m.otel-*` is not
APM-instrumented for dependencies. Report insufficient dependency data and give the verdict from the signals that do
exist. Never translate an empty dependency result into "upstreams are healthy".

For a service-map-style view of which services call which, aggregate the destination rollup across services:

```esql
FROM metrics-service_destination.1m.otel-*
| WHERE @timestamp >= NOW() - 1 hour
| STATS calls = SUM(span.destination.service.response_time.count)
    BY service.name, span.destination.service.resource
| SORT calls DESC
| LIMIT 50
```

## Subpopulation correlation

Replaces the correlations technique that previously required a bespoke script. When only part of the traffic is slow or
failing, the question is: **which attribute value is over-represented in the affected set relative to the population as
a whole?**

Compute the overall rate and the per-attribute rate in one query, using `FORK` so both come back from a single call.
`FORK` is GA on Serverless; on Stack it is preview in 9.1-9.3 and GA from 9.4, and it does not parse below 9.1. Where it
is unavailable, run the two branches as two queries and compute the lift yourself — `FORK` saves a round trip here,
nothing more:

```esql
FROM traces-*.otel-*
| WHERE service.name == "frontend" AND kind == "Server"
  AND @timestamp >= NOW() - 3 hours
| EVAL affected = CASE(duration > 100000000, 1, 0)
| FORK (STATS total = COUNT(*), affected = SUM(affected) | EVAL scope = "overall", attribute_value = "*")
       (STATS total = COUNT(*), affected = SUM(affected) BY attribute_value = transaction.name | EVAL scope = "by-attribute")
| EVAL rate = ROUND(affected::double / total, 4)
| KEEP scope, attribute_value, total, affected, rate
| SORT rate DESC
| LIMIT 20
```

The `SORT` and `LIMIT` here apply to both branches combined, so on a service with more than twenty distinct
`transaction.name` values the `overall` row competes with the per-attribute rows and can be pushed out of the result —
leaving you the subpopulations with no baseline to compare them against. Raise the `LIMIT` above the expected
cardinality, or read the baseline from the separate error-rate query instead. This is the same combined-limit behaviour
that silently drops whole branches in [the log funnel](log-investigation.md#the-one-call-funnel-query); it is worth
knowing wherever `FORK` is followed by a limit.

Swap the `affected` expression for the symptom under investigation:

- Failures: `EVAL affected = CASE(event.outcome == "failure", 1, 0)`
- Slow requests: `EVAL affected = CASE(duration > 100000000, 1, 0)` — pick the nanosecond threshold from the p95 of the
  healthy window, not from a round number.

Repeat the query once per candidate attribute, changing only the `BY attribute_value = ...` clause. Candidates worth
testing, in the order they usually pay off:

`service.version` · `k8s.pod.name` · `host.name` · `k8s.deployment.name` · `container.id` · `cloud.region` ·
`cloud.availability_zone` · `service.environment` · `span.name` · `transaction.name` · `http.response.status_code`

### What makes an attribute correlated

An attribute value is correlated when all three hold:

1. **Lift.** Its rate is meaningfully higher than the overall rate — roughly 2x or more. Small differences on a busy
   service are noise.
2. **Volume.** It has enough events to be stable. Discard groups below about 20 events; a single failure out of three
   requests is a 33% rate and means nothing.
3. **Concentration.** It accounts for a substantial share of the total affected events. An attribute with a 90% failure
   rate that explains 4 of 500 failures is a curiosity, not the cause.

An attribute that shows high lift **and** covers most of the affected events is the localization. On live data, frontend
server spans grouped by route gave a 3.8% slow rate for `POST` against a 0.9% overall rate — a 4x lift covering half the
slow requests, which localizes the problem to write paths.

Two traps:

- **Cardinality artifacts.** Attributes near-unique per request (trace ID, user ID, session ID) always look correlated.
  Only test attributes shared by many events.
- **Proxy attributes.** If a single pod is running the only instance of a bad version, `k8s.pod.name` and
  `service.version` both light up. Prefer the explanation with a mechanism — a version rollout beats a pod name — and
  check whether the attribute values move together.

When no attribute shows lift, the degradation is uniform across the population. That is itself a result: report that the
problem is service-wide and look at dependencies or infrastructure instead of hunting for a slice.

## ML anomalies

Anomaly detection describes deviation from a learned baseline, not from a target, so it corroborates and time-bounds a
finding rather than setting the verdict.

1. `GET /_ml/anomaly_detectors` — find jobs whose configuration references the service.
2. `GET /_ml/anomaly_detectors/_stats` — confirm the job state is `opened` and the datafeed is running. A stopped job
   produces no records, which is not the same as no anomaly. Report the job as unavailable in that case.
3. `GET /_ml/anomaly_detectors/{id}/results/records` — read scored records. Treat `record_score` at or above 75 as
   significant, 50-75 as worth corroborating, below 50 as background.

Use the anomaly's start time to narrow the trace and log windows in the rest of the triage.

## Infrastructure saturation

Read the resource attributes off the service's own spans first, so infrastructure is scoped to the instances actually
serving traffic:

```esql
FROM traces-*.otel-*
| WHERE service.name == "cart" AND @timestamp >= NOW() - 1 hour
| STATS spans = COUNT(*) BY k8s.pod.name, k8s.namespace.name, host.name
| SORT spans DESC
| LIMIT 20
```

That result decides which branch to take, and the branch matters because the two paths share no field names. Pod and
namespace attributes mean the service is Kubernetes-hosted and the kubeletstats fields apply. A populated `host.name`
with no pod attributes means the service runs on a VM or a bare host, where every `k8s.*` field is empty — read the host
metrics instead. Do not conclude that a service is unsaturated because the Kubernetes query returned nothing.

### Kubernetes-hosted services

Check limit utilization per container for the pods that serve the traffic:

```esql
FROM metrics-kubeletstatsreceiver.otel-*
| WHERE @timestamp >= NOW() - 1 hour AND k8s.namespace.name == "otel-demo"
| STATS cpu_limit_pct = ROUND(MAX(k8s.container.cpu_limit_utilization) * 100, 1),
        mem_limit_pct = ROUND(MAX(k8s.container.memory_limit_utilization) * 100, 1)
    BY k8s.pod.name, k8s.container.name
| SORT mem_limit_pct DESC
| LIMIT 20
```

Memory limit utilization approaching 100% precedes OOM kills; sustained CPU limit utilization at 100% means throttling,
which shows up in APM as latency without any error-rate change. Container restarts and OOM events are also visible in
`logs-k8seventsreceiver.otel-*` when the Kubernetes events receiver is deployed — absence of that data stream means the
receiver is not installed, not that no restarts happened.

The container-level fields are the measure to use, and the pod-level pair `k8s.pod.cpu_limit_utilization` /
`k8s.pod.memory_limit_utilization` is not a substitute for them. See
[Container-level against pod-level limit utilization](#container-level-against-pod-level-limit-utilization) below for
what separates them and why the container fields are the default. **observability-k8s-investigation** applies the same
rule.

`k8s.container.cpu_limit_utilization` and `k8s.container.memory_limit_utilization` are only populated when the container
declares the corresponding limit. A `null` result means no limit is set, not that the container is idle.

**These two fields fail in two different ways, and only one of them returns `null`.** Where the receiver emits the
metric, an undeclared limit gives `null` per the paragraph above. Where the metric is not enabled at all, the field is
absent from the mapping and the query above **fails with HTTP 400 `Unknown column`** rather than returning `null`. On a
Stack 9.4.4 cluster `k8s.container.memory_limit_utilization` was absent from `metrics-kubeletstatsreceiver.otel-*`
entirely while `k8s.container.cpu_limit_utilization` was present, so the query above returned
`Unknown column [k8s.container.memory_limit_utilization], did you mean [k8s.container.cpu_limit_utilization]?` — and
both fields were present on a Serverless comparator, so this is a collector-configuration difference rather than a
flavour one. Run `GET /_field_caps` on the two field names before building the query, and drop whichever is unmapped
rather than reading the error as missing data.

Two fall-backs, in order of preference:

- `k8s.pod.cpu.node.utilization` and `k8s.pod.memory.node.utilization` express consumption as a fraction of node
  capacity and are emitted regardless of whether limits are declared. They answer "is this pod a heavy tenant of its
  node?" rather than "is this pod at its own ceiling." Both were populated on the Stack cluster above and returned
  sensible values where the container-level fields were unusable.
- `container.cpu.usage` and `container.memory.usage` give absolute consumption, which is only interpretable against a
  baseline for the same workload. `container.memory.usage` is itself absent on some collector builds — the Stack cluster
  above carried `container.memory.working_set` instead — so confirm which of the two exists before using it.

Both fall-backs sit on the pod-level documents, not the container-level ones, so query them grouped by `k8s.pod.name`
rather than by `k8s.container.name`.

Saturation is the mechanism, not the verdict. When the finding is a restart loop, an OOM kill to confirm, node pressure,
an admission failure, or a stuck rollout, stop here and hand off to the **observability-k8s-investigation** skill, which
owns workload, node, and control-plane diagnosis.

#### Container-level against pod-level limit utilization

Both field families exist in the kubeletstats receiver and they are not interchangeable. The receiver emits them on
**separate documents in the same data stream**: pod-level fields appear on documents that carry no `k8s.container.name`,
and container-level fields appear only on documents that do. A `STATS ... BY k8s.container.name` therefore returns
`null` for every pod-level field, and the reverse holds too. Measured over one hour on a live 9.6.0 cluster: of 42,240
documents without a container name, 360 carried `k8s.pod.cpu_limit_utilization` and none carried
`k8s.container.cpu_limit_utilization`; of 18,240 documents with a container name, 900 carried the container field and
none carried the pod field.

Availability differs as well. Container-level utilization is emitted for each container that declares the limit, while
the pod-level aggregate requires **every** container in the pod to declare it. Across two live clusters over three
hours, no pod carried the pod-level field without also carrying the container-level one, while 27 pods carried the
container-level field with the pod-level field absent — every one of them a multi-container pod in which only some
containers declared limits.

| Cluster                    | Container level only | Both levels | Neither | Pod level only |
| -------------------------- | -------------------- | ----------- | ------- | -------------- |
| forge-factory (Serverless) | 18                   | 7           | 44      | 0              |
| k8s-demo (Serverless)      | 9                    | 6           | 40      | 0              |
| Stack 9.4.4, CPU           | 0                    | 3           | 19      | 0              |
| Stack 9.4.4, memory        | 0                    | 0           | 18      | 4              |

**The "pod level only: 0" column does not generalize.** On the Stack cluster the container-level memory field was not
mapped at all, so four pods carried pod-level memory limit utilization with no container-level counterpart — the case
both Serverless clusters showed zero of. Where the container-level field exists it remains the right default, because a
limit is enforced per container and the container form is emitted per container that declares one. But "available
strictly more often" is a property of those two Serverless deployments, not a rule: check which of the two families is
mapped before choosing, and be prepared for the pod-level field to be the only one available. Use the pod-level fields
when the question really is about the pod as a whole — total pod consumption against the sum of its containers' limits —
or when the container-level field is absent, and in either case say which level the number came from.

### Host-based services

For a service on a VM or bare host with the OTel hostmetrics receiver collecting, saturation comes from
`metrics-hostmetricsreceiver.otel-*`. CPU utilization there is reported per state, so busy CPU is derived from the
`idle` state rather than read directly:

```esql
FROM metrics-hostmetricsreceiver.otel-*
| WHERE host.name == "prod-app-01" AND @timestamp >= NOW() - 1 hour
| STATS cpu_idle = AVG(system.cpu.utilization) WHERE state == "idle",
        mem_used_pct = ROUND(MAX(system.memory.utilization) * 100, 1) WHERE state == "used",
        load_1m = ROUND(MAX(`system.cpu.load_average.1m`), 2),
        cores = MAX(system.cpu.logical.count)
    BY host.name
| EVAL cpu_busy_pct = ROUND((1 - cpu_idle) * 100, 1)
| KEEP host.name, cpu_busy_pct, mem_used_pct, load_1m, cores
| SORT cpu_busy_pct DESC
| LIMIT 20
```

Two syntax points that cause silent wrong answers. `system.cpu.utilization` and `system.memory.utilization` are both
broken out by a `state` dimension, so an unfiltered `AVG` averages across `idle`, `user`, `system`, `wait`, and `steal`
and means nothing. And `system.cpu.load_average.1m` needs backticks in ES|QL, because the `1m` segment starts with a
digit; without them the query fails to parse.

This query is executed and confirmed on Stack 9.4.4: it returned `cpu_busy_pct` 4.4, `mem_used_pct` 22.2, `load_1m` 1.4
and `cores` 8 for a live host, so the `1 - idle` derivation, the per-aggregate `WHERE` inside `STATS`, and the
backticked load-average field all behave as written on Stack.

Reading it: a host has no enforced ceiling the way a container does, so the pressure signal is `cpu_busy_pct` near 100
sustained, `load_1m` above `cores`, or `mem_used_pct` high enough that the kernel is reclaiming. Load average above core
count with moderate busy CPU means processes are queueing on something other than CPU — usually disk or a lock.

For a full disk, `system.filesystem.utilization` lives in the same data stream **only when the collector's `filesystem`
scraper is enabled**, which is not the default in every distribution. On the Stack 9.4.4 cluster above, `_field_caps`
for `system.filesystem.*` over `metrics-hostmetricsreceiver.otel-*` returned nothing at all while every `system.cpu.*`,
`system.memory.*`, `system.disk.*` and `system.network.*` field was present — so naming it fails the query with
`Unknown column` rather than returning no rows. Where it is absent, `system.disk.io_time` and
`system.disk.pending_operations` are usually collected and answer the I/O-saturation question, though not the capacity
one.

When the host is monitored by the Elastic Agent system integration rather than the hostmetrics receiver, the equivalents
are `system.cpu.total.norm.pct` in `metrics-system.cpu-*` and `system.memory.actual.used.pct` in
`metrics-system.memory-*`. Both are already normalized fractions of capacity, so the `1 - idle` derivation is not
needed. These two names remain documentation-derived: the Stack cluster used to validate the rest of this file had no
System integration installed — `GET /_resolve/index/metrics-system.*` returned zero indices and zero data streams, and
both field names were absent from `_field_caps` across all of `metrics-*` — so they have not been executed against data.
Note also that the two collection paths do **not** share field names, so a query written for one returns
`Unknown column` against the other rather than empty results. Confirm which path exists with
`GET /_resolve/index/metrics-system.*,metrics-hostmetricsreceiver.*` before building on either.

## Aggregate rollups

`metrics-service_summary.1m.otel-*` is the cheapest way to enumerate which services reported telemetry in a window,
which distinguishes "healthy" from "not reporting":

```esql
FROM metrics-service_summary.1m.otel-*
| WHERE @timestamp >= NOW() - 1 hour
| STATS docs = COUNT(*) BY service.name
| SORT docs DESC
| LIMIT 50
```

`metrics-service_transaction.1m.otel-*` and `metrics-transaction.1m.otel-*` hold pre-aggregated transaction latency as
histogram and summary fields (`transaction.duration.histogram`, `transaction.duration.summary`). They are cheaper than
raw spans over long windows; raw `traces-*.otel-*` remains the right source when the investigation needs per-request
attributes for correlation.

For OTel application metrics, the `TS` (time series) command produces more efficient queries than `FROM`. It is GA on
Serverless; on Stack it is preview in 9.2 and GA in 9.4, so on anything below 9.4 use `FROM` with `BUCKET` over the same
data stream. `TS` also rejects `COUNT(*)` — count a specific field instead.
