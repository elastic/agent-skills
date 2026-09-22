---
name: observability-csp-investigation
description: >
  Investigate cloud-provider (CSP) service issues — AWS today (the reasoning applies
  to any AWS service; schema and failure signatures are deepest for RDS, Lambda, SQS,
  ALB, EC2), and in future GCP and Azure — using OTel-schema cloud metrics in Elastic.
  Use when diagnosing cloud-resource problems, whether alert-triggered or ad hoc:
  database connection/CPU/memory pressure, function error rates and throttling, queue
  backlog and consumer lag, load-balancer 5xx, instance saturation. Correlates the
  resource under investigation against its own baseline, classifies the failure mode,
  and rules out co-occurring but unrelated conditions.
compatibility: >
  Requires the `elastic` CLI (>= 0.2) with an Elasticsearch context, and cloud-provider
  metrics ingested through EDOT (the OpenTelemetry `awscloudwatch` receiver) into
  `metrics-aws.<service>.otel-*` data streams. The base floor is Elasticsearch 8.11
  or later, or Serverless; every query is ES|QL. Alert-state and SLO lookups additionally
  need a Kibana context on the same deployment. Read-only.
metadata:
  author: elastic
  version: 0.2.0
  universal: true
---

# Cloud Provider (CSP) Investigation

Diagnose cloud-provider service issues from OTel-schema metrics and logs in Elastic. The guidelines, flow, and synthesis
below are provider-agnostic and apply to every investigation. The per-provider **reference** carries the schema facts
and failure-mode signatures that cannot be guessed — read it first.

This is the CSP **domain layer**: which index holds a resource's telemetry, what shape its metrics take, and how to read
them into a diagnosis. It assumes the harness can already author ES|QL — it does not teach query syntax, null handling,
or function usage. Keep that split: this skill tells you _what_ to query and _how to interpret_ it; writing the query
itself is the harness's job.

<!-- begin-partial: preamble -->

## Environment Configuration

This skill executes Elasticsearch operations through the `elastic` CLI. If the
[`elastic` CLI](https://github.com/elastic/cli#configuration) is not installed, tell the user what it is needed for. Do
not guess credentials, call the HTTP API directly, or attempt other workarounds.

This skill references operations in HTTP-shorthand form (e.g., `GET /`, `GET /_cat/indices`, `GET /{index}/_mapping`,
`GET /{index}/_settings/index.mode`, `POST /_query`). The [Operations](#operations) table at the end of this document
maps each shorthand to the equivalent `elastic` CLI command — always use the CLI rather than calling the HTTP API
directly.

<!-- end-partial: preamble -->

### Analysis without cluster access

The CLI check above gates _querying the cluster_ — it does not gate analysis. When the user has already supplied the
evidence in their question (metric values, alert payloads, log lines, dimension names), reason from that evidence and
deliver the conclusion.

When you genuinely do need data the user has not provided, still say what you would check and how — name the specific
query, index, and field that would settle the question — and then ask for CLI setup. An answer that names the check is
useful without a cluster; one that only asks for setup is not.

Every ES|QL query in this skill and in the provider references runs via `POST /_query`. Discovering which data streams
and fields a deployment actually has uses `GET /_resolve/index/<pattern>` and `GET /_field_caps` (the way to learn
whether a sparse counter has ever been mapped — see Guidelines). Active alerts are read with
`GET kbn:/api/alerting/rules/_find`; shipped SLOs with `GET kbn:/api/observability/slos`. The [Operations](#operations)
table maps each to its `elastic` CLI equivalent. Express predicates natively in ES|QL; do not use Query DSL or the `KQL`
function.

## Router — read the provider reference first

Identify the provider from the resource under investigation, then read its reference before writing any query (the index
patterns, field shapes, and stat/aggregation rules there are unguessable, and a query written without them fails or
silently corrupts its aggregates):

| Provider   | Resource types                                                                                      | Reference                              |
| ---------- | --------------------------------------------------------------------------------------------------- | -------------------------------------- |
| AWS        | Any service under `metrics-aws.*`; failure signatures documented for RDS, Lambda, SQS, ALB/ELB, EC2 | [references/aws.md](references/aws.md) |
| GCP, Azure | —                                                                                                   | not yet covered (see below)            |

If the provider is unclear, determine it from the data before assuming: `GET /_resolve/index/metrics-*` lists the data
streams that exist, and the provider is in their names. For a provider without a reference yet, apply the
provider-agnostic guidance below, discover the schema empirically (list data streams → field mapping → probe query), cap
confidence at medium, and say the reference was unavailable — never transplant another provider's schema.

The same applies _within_ a provider. For an AWS service the reference doesn't detail (DynamoDB, ECS, API Gateway,
Kinesis, ElastiCache, …), the general guidance and the AWS-wide conventions still hold — the `metrics-aws.*` index
family, backticked dotted/slashed field names, and per-`attributes.stat` filtering — so apply those, discover that
service's specific metrics empirically, and cap confidence where no documented failure-mode signature exists. The
guidelines below are service-agnostic by design; only the tuned signatures are per-service.

## Guidelines

**Investigate the named resource before anything else — the one the alert fired on, or the one the request names.**
Shared clusters carry many systems' telemetry (Kubernetes workloads, other teams' accounts, demo apps). Signals from
co-resident systems are not evidence about this alert unless a dependency between them is demonstrated. Do not promote a
louder co-resident anomaly to root cause.

**The alert's own metric, compared to its own baseline, outranks everything else.** Before considering any other metric,
quantify the alerting metric's incident-window value against a representative window of the same resource's own normal
(how to choose that window — trailing vs same-time-prior-day — is in Flow below; the point is it must be
_representative_, not merely adjacent). A 10×+ delta on the alert's metric is the primary thread; small wiggles in other
metrics are secondary until the primary thread is exhausted. "High" is only meaningful relative to this resource's
normal.

**Counters up ≠ failing harder. Always compute the rate.** For error counters, divide by the volume counter
(errors/invocations, 5xx/requests) in BOTH windows. Volume up with rate flat = load change, not a failure. Rate up with
volume flat = a real failure in the resource's own code/config path.

**One instance degrading while its fleet siblings stay healthy = the cause is scoped to that instance.** Check the same
metric on sibling resources. Healthy siblings rule out platform-wide issues, shared event sources, and shared downstream
dependencies — the fault is in the affected instance's own code, configuration, or deployment.

**Co-occurring incidents are not causally linked by timing alone.** Attribute cross-service causation only when (a) a
dependency actually exists (the service calls that resource), and (b) the upstream degradation preceded the downstream
symptom. Two resources alerting in the same window on a busy cluster is the norm, not a clue. When you notice another
resource anomalous in the same window, TEST the dependency before linking: does the affected resource actually call it?
A worker that only touches a queue cannot be broken by a database incident. If you cannot demonstrate the dependency
from the data, report the other incident as concurrent-and-unrelated and keep diagnosing the named resource on its own
signals.

**A healthy verdict is a first-class outcome, not a failure to find the problem.** Many workloads run with an ambient
error rate of several percent at all times. If the named resource's incident-window numbers are indistinguishable from
its baseline (rate ratio near 1×; volume, duration, throttles, backlog at baseline), the correct conclusion is that the
alert is spurious or already resolved (or, for an ad-hoc check with no alert, that there is no problem): state it
plainly — "ALERT FIRED BUT SYSTEM APPEARS HEALTHY", or "NO PROBLEM FOUND — `<resource>` IS AT BASELINE" — show the
incident-vs-baseline numbers, and stop. Constructing a root-cause story out of ambient fluctuation is a worse failure
than reporting no incident.

**Name exactly one primary cause; everything else is an effect, a contributor, or unrelated.** When one resource
saturates (e.g. CPU pinned at 100%), the metrics it drives rise with it — IO, latency, queue depth. Those are downstream
effects, not co-equal causes. A conclusion naming two "co-primary" bottlenecks is usually an unfinished diagnosis:
determine which one explains the other and say so.

**Logs carry the "why" that metrics cannot — cite them when available.** Metrics localize _which_ component failed and
rule failure modes in or out; the specific cause (the exception, the failing query, the bad config) lives in the
resource's logs. After classifying from metrics, check the implicated resource's logs and cite the concrete error — turn
"the function's code path is failing" into "RuntimeError at index.py:11". Logs arrive in one of two shapes and you
should check both: OTel-native `logs-*.otel-*` (filter by `service.name`, line in `body.text`) and the classic
cloud-integration shape (e.g. AWS `logs-aws_logs.*`, line in the `message` field). Zero rows in one shape is not "no
errors" — the logs may be in the other, or not shipped at all; say which you checked. Reading a log line does not excuse
misattribution: if a function logs its own exception, that is the cause, even when another resource is alerting in the
same window.

**Absence of a metric field is data.** Cloud providers omit zero-valued sparse counters (error counts, per-code 5xx,
throttle counts), so the field may be unmapped in Elastic until the first such event ever occurs — and ES|QL fails the
whole query on an unknown column. Check the field with `GET /_field_caps` before referencing it, or query sparse fields
in separate small queries; a verification failure or empty result on a sparse counter means "no such events ever
recorded," never "data missing."

**Report insufficient evidence rather than manufacturing a conclusion.** If the named resource has zero datapoints in
the window, say so, list the exact index patterns and filters you tried, and stop. Recent windows may simply not be
ingested yet (cloud-metric pipelines typically lag by minutes — the provider reference gives the number).

## Flow

1. **Orient: resolve the resource and the two windows.** The incident window brackets the time of interest — the alert
   time, or the reported symptom time. The baseline is a _representative_ span of the same resource's normal, chosen to
   match its rhythm: a short trailing window (~30–60m before the incident) is fine for a steady workload, but for
   anything with daily or weekly seasonality widen the window or compare against the same time-of-day on a prior
   comparable day — a half-hour adjacent baseline makes normal diurnal variation read as the incident. Windows must not
   overlap. When the resource's rhythm is unknown, look back far enough to see at least one full normal cycle before
   trusting "high". Decision: which data stream, which dimension value, which two time ranges every later query uses.
   Data: `GET /_resolve/index/<pattern>` for the streams that exist; the alert payload or request for the resource name.

2. **Quantify the alert's own metric against its baseline.** One `POST /_query` per window (or one query with a
   per-window `CASE`), using the stat filter and backticked field names from the provider reference. Decision: is the
   delta material (roughly ≥2× the resource's own baseline rate, or 10×+ on an absolute metric), or is the resource at
   baseline? If at baseline, go to step 5 with a healthy verdict.

3. **Classify against the provider reference's failure-mode signatures.** Pull the discriminating metrics the signature
   table names (the ceiling plateau, the throttle counter, the deleted-vs-sent ratio, the target-vs-ELB 5xx split) and
   compute the rates. Decision: exactly one named mode, or "no documented signature matches" with confidence capped at
   medium.

4. **Corroborate.** Siblings (`POST /_query` for the same metric across the fleet); dependent or upstream resources only
   where a real dependency exists; the implicated resource's logs in both shapes; shipped SLOs
   (`GET kbn:/api/observability/slos`) and active alerting rules (`GET kbn:/api/alerting/rules/_find`, filtering
   client-side for rules whose params name this resource) to anchor severity. Decision: does anything contradict the
   classification? Anchor severity on a VIOLATED SLO or an active alert when present; never invent one.

5. **Synthesize and stop.** Terminate as soon as the evidence supports a classification at known confidence; exhaustive
   exploration is a failure mode.

## Synthesis

State: root cause (one sentence, named mode + resource), evidence with concrete numbers (incident vs baseline), causal
chain, scope (which resources affected, which ruled out and why), recommended action targeting the actual mode, and
confidence. Downgrade confidence when a discriminating signal was unavailable and say which. "ALERT FIRED BUT THE SYSTEM
APPEARS HEALTHY" (or "no problem found" for an ad-hoc check) and "insufficient evidence for the named resource" are
valid, complete conclusions when the data supports them.

## Examples

### "The RDS connections alert fired on `orders-db` — what's wrong?"

Orient on `metrics-aws.rds.otel-*` filtered by `attributes.DBInstanceIdentifier == "orders-db"`, incident window around
the alert, baseline the same hour on the prior day (databases are diurnal). Quantify `DatabaseConnections` (stat
`Maximum`) in both windows. If it climbed far above baseline and plateaued while CPU, memory, storage and IO stayed
nominal, that is the connection-exhaustion signature — RDS emits no `max_connections`, so infer the ceiling from the
plateau. Corroborate on sibling instances (healthy siblings scope the cause to this instance's callers), then pull the
callers' logs for the concrete error (`too many connections`, pool timeouts). Recommend the fix for the mode: raise the
ceiling or shrink the callers' pools, not a restart.

### "Lambda `order-worker` error rate jumped, and the database is alerting at the same time"

Compute the rate, not the count: `Errors / Invocations` (stat `Sum`) in both windows. If the rate rose at flat volume,
the function's own code path is failing. Before linking it to the database incident, test the dependency: a queue
consumer that never calls the database cannot be broken by it. Pull the function's own logs (`logs-aws_logs.*` or
`logs-*.otel-*`) and cite the exception. Report the database incident as concurrent-and-unrelated unless the logs show
the function calling it and failing on that call. If volume rose and the rate did not, it is a load surge — nothing is
broken.

### "Alert fired but everything looks healthy"

A first-class outcome. Show the incident-vs-baseline numbers for the alerting metric and its volume counter; if the
ratio is near 1× and the discriminating metrics are at baseline, state `ALERT FIRED BUT SYSTEM APPEARS HEALTHY`, list
what you checked, and recommend tuning the rule (window, threshold relative to the resource's own normal) rather than
constructing a cause from ambient fluctuation.

## Operations

| HTTP API (shorthand)                | `elastic` CLI command                                                  |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `GET /`                             | `elastic es info`                                                      |
| `POST /_query`                      | `elastic es esql query --format tsv --query '<esql>'`                  |
| `GET /_resolve/index/<pattern>`     | `elastic es indices resolve-index --name '<pattern>'`                  |
| `GET /<index>/_mapping`             | `elastic es indices get-mapping --index '<index>'`                     |
| `GET /_field_caps`                  | `elastic es field-caps --index '<index>' --fields '<fields>'`          |
| `GET kbn:/api/alerting/rules/_find` | `elastic kb alerting get-alerting-rules-find --filter '<filter>'`      |
| `GET kbn:/api/observability/slos`   | `elastic kb slo find-slos-op --space-id '<space>' --kql-query '<kql>'` |
