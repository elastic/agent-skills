---
name: observability-k8s-investigation
description: >
  Investigate Kubernetes workload, node, and control-plane issues using OTel telemetry
  (EDOT). Use when diagnosing pod failures (CrashLoopBackOff, OOMKilled, Error), node
  pressure, resource exhaustion, image pull failures, admission rejections, autoscaling
  anomalies, or correlating K8s state with application signals. OTel ingest path only
  — the legacy ECS Kubernetes integration shape is out of scope.
compatibility: >
  Requires the `elastic` CLI (>= 0.2) with an Elasticsearch context, and Kubernetes
  telemetry ingested through EDOT / the OpenTelemetry kube-stack collector into OTel-receiver-namespaced
  data streams. The base floor is Elasticsearch 8.11 or later, or Serverless. One
  query uses the `VALUES()` aggregation, which is GA on Serverless but preview from
  8.14 and GA only in 9.4 on Stack; a `VALUES()`-free rewrite is given at the point
  of use. Alert-state lookups additionally need a Kibana context.
metadata:
  author: elastic
  version: 0.5.1
  universal: true
---

# Kubernetes Investigation

Diagnose Kubernetes issues using OTel telemetry collected via EDOT (Elastic Distribution of OpenTelemetry) and the
kube-stack collector. Correlate cluster state, pod runtime metrics, K8s events, application logs, and APM to identify
root cause across the workload, node, and control-plane layers.

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
evidence in their question (metric values, counts, status reasons, log lines, alert payloads, configuration), reason
from that evidence and deliver the conclusion.

When you genuinely do need data the user has not provided, still say what you would check and how — name the specific
query, index, and field that would settle the question — and then ask for CLI setup. An answer that names the check is
useful without a cluster; one that only asks for setup is not.

Every ES|QL query in this skill and in [references/query-recipes.md](references/query-recipes.md) runs via
`POST /_query`. Alert state is read with `GET kbn:/api/alerting/rules/_find`. Field-presence checks use
`GET /<index>/_mapping` or `GET /_field_caps`. The [Operations](#operations) table maps each to its `elastic` CLI
equivalent.

## Scope

**In scope:** OTel-receiver-namespaced indices (`metrics-kubeletstatsreceiver.otel-*`,
`metrics-k8sclusterreceiver.otel-*`, `logs-k8seventsreceiver.otel-*`, `logs-k8sobjectsreceiver.otel-*`) and OTel
semantic conventions (`k8s.pod.name`, `k8s.namespace.name`, `k8s.container.restarts`).

**Out of scope:**

- The legacy Elastic Agent Kubernetes integration (`metrics-kubernetes.*`, `logs-kubernetes.*`, `kubernetes.*` fields).
  Being deprecated — do not author queries against these paths.
- APM-layer analysis (service SLO breaches, transaction error rates, upstream dependency health). Different domain —
  once a K8s root cause is ruled in or out, hand off to the **observability-sre-triage** skill, which owns SLO status
  and burn rate, active alerting rules, throughput, latency, error rate, dependency health, and log funnelling. That is
  also the skill to use when the workload turns out not to be Kubernetes-hosted at all.
- Cluster provisioning, capacity planning, cost optimization. Different domain.

## Guidelines

These apply to every investigation. When in doubt, re-read them before writing the synthesis.

**Absence of evidence is not evidence. Do not confabulate from empty results.** If log queries return 0 rows, logs are
likely not collected or the pod has no recent lines — this does _not_ mean "dependency unavailable" or any other
specific failure mode. Report `no_logs_available` and weight remaining signals accordingly.

**Empty dependency data ≠ upstream healthy.** Services without APM instrumentation (load generators, workers) emit no
destination metrics. Report `insufficient_dependency_data`, not "upstreams OK."

**Co-symptoms are not causes.** Two services degrading simultaneously usually share an upstream, not a causal link. Only
attribute causation when (a) one service's degradation clearly precedes the other's, and (b) the delta is large (>5×
error rate, >3× latency).

**OOMKilled ≠ memory leak by default.** The limit might simply be undersized for the workload's working set. Tell them
apart by the shape of the memory curve: a monotonic climb to the limit that resets on each restart, with load flat
against the prior week and no recent deploy, is the leak signature — commit to it at high confidence. Reach for a 7-day
same-hour baseline when the shape is ambiguous — spiky, diurnal, or load-correlated — not as a precondition for every
OOMKilled finding.

**Error-termination ≠ application bug by default.** Check `k8s.container.cpu_limit_utilization` first. CFS throttling
driving liveness probe timeouts is the most common misdiagnosis in this space.

**Average CPU hides throttling.** A pod can look healthy at 40–60% average `cpu_limit_utilization` while being throttled
severely at p99. Linux enforces CPU limits in 100ms periods; bursty workloads reach quota mid-period and stall. Look at
max and p95, not only the average.

**Restart count is boolean, not a counter.** `k8s.container.restarts` is pulled directly from the K8s API and can be
pruned by the kubelet at any time, so the absolute value is unreliable. Treat it as `== 0` (no recent restarts) versus
`> 0` (recently restarting); do not derive backoff timing or "linear versus exponential" patterns from it. Confirm the
restart pattern via K8s `Killing` / `BackOff` events instead.

**Prefer to report uncertainty over manufacturing confidence.** If the evidence is ambiguous, the synthesis should say
so. Competing hypotheses are a valid output.

**Equally, do not manufacture uncertainty.** The rule above is about ambiguous evidence, not about tone. When the
pivotal signal is present and corroborated, commit to it at high confidence. Hedging an unambiguous finding down to
"medium" is as much a defect as overclaiming.

**Deliver the synthesis and stop.** State confidence once, in the HYPOTHESIS line — not again per bullet. Do not narrate
which queries were run unless a result changed the conclusion, and do not restate the alert back to the reader. End on
RECOMMENDED NEXT STEPS or DOWNSTREAM IMPACT; never close with an offer such as "want me to look further?". Follow-up
work belongs in the recommendations list, phrased as a recommendation.

## Indices and fields

### Where to look

| Signal                | Index pattern                                       | Use                                                                 |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| Pod/container runtime | `metrics-kubeletstatsreceiver.otel-*`               | CPU, memory, network, filesystem. Utilization ratios.               |
| Cluster state         | `metrics-k8sclusterreceiver.otel-*`                 | Restarts, phase, last-terminated reason, HPA, quota, node condition |
| K8s events            | `logs-k8seventsreceiver.otel-*`                     | Killing, BackOff, FailedScheduling, Evicted, image pull events      |
| K8s object snapshots  | `logs-k8sobjectsreceiver.otel-*`                    | Deployment/service/configmap state over time                        |
| Application logs      | `logs-*.otel-*`                                     | `body.text`, `severity_text`, filtered by `k8s.pod.name`            |
| APM                   | `traces-*.otel-*`, `metrics-service_*.otel-default` | Correlate via `service.name` + K8s resource attrs                   |
| ML anomalies          | `.ml-anomalies-*`                                   | Memory-growth, restart-rate, throttle jobs (if configured)          |

### Key fields

Flat OTel paths work in ES|QL. Prefer the flat form for readability; the nested `resource.attributes.*` form is for raw
log documents only.

| Field                                            | Index                       | What it is                                              |
| ------------------------------------------------ | --------------------------- | ------------------------------------------------------- |
| `k8s.pod.name`                                   | all k8s                     | Pod name                                                |
| `k8s.namespace.name`                             | metrics only                | Namespace. Mapped but **null** on k8seventsreceiver     |
| `attributes.k8s.namespace.name`                  | k8seventsreceiver           | Namespace on events — filter on this form there         |
| `k8s.container.name`                             | all k8s                     | Container within pod                                    |
| `k8s.deployment.name`                            | k8sclusterreceiver + others | Parent deployment                                       |
| `k8s.pod.phase`                                  | k8sclusterreceiver          | Pending=1/Running=2/Succeeded=3/Failed=4/Unknown=5      |
| `k8s.container.restarts`                         | k8sclusterreceiver          | Total container restart count                           |
| `k8s.container.status.last_terminated_reason`    | k8sclusterreceiver          | `OOMKilled`, `Error`, `Completed`, `ContainerCannotRun` |
| `k8s.pod.status_reason`                          | k8sclusterreceiver          | Pod-level reason (`Evicted`, `NodeLost`)                |
| `k8s.container.memory_limit_utilization`         | kubeletstatsreceiver        | 0.0–1.0+ (can exceed 1 transiently before OOM)          |
| `k8s.container.cpu_limit_utilization`            | kubeletstatsreceiver        | 0.0–N (frequently >1 under CFS throttling)              |
| `k8s.pod.memory_limit_utilization`               | kubeletstatsreceiver        | Whole-pod aggregate; see the note below before using it |
| `k8s.pod.cpu_limit_utilization`                  | kubeletstatsreceiver        | Whole-pod aggregate; see the note below before using it |
| `k8s.pod.memory.usage` / `.working_set`          | kubeletstatsreceiver        | Bytes                                                   |
| `k8s.node.condition_memory_pressure`             | k8sclusterreceiver          | 1 = pressure, 0 = ok                                    |
| `k8s.node.condition_ready`                       | k8sclusterreceiver          | 0 = NotReady                                            |
| `k8s.hpa.current_replicas` / `.desired_replicas` | k8sclusterreceiver          | HPA state                                               |
| `attributes.k8s.event.reason`                    | k8seventsreceiver           | Event reason (filter on this)                           |
| `body.text`                                      | k8seventsreceiver / logs    | Event message / log message                             |
| `k8s.object.name`                                | k8seventsreceiver           | involvedObject name (log attribute, use flat form)      |

### Container-level against pod-level limit utilization

Read limit utilization at the **container** level. `k8s.container.cpu_limit_utilization` and
`k8s.container.memory_limit_utilization` are the default; the pod-level pair is a different measurement, not a synonym.

The receiver emits the two families on **separate documents in the same data stream**: pod-level fields appear on
documents that carry no `k8s.container.name`, and container-level fields appear only on documents that do. A
`STATS ... BY k8s.container.name` therefore returns `null` for every pod-level field, and the reverse holds too.
Measured over one hour on a live 9.6.0 cluster: of 42,240 documents without a container name, 360 carried
`k8s.pod.cpu_limit_utilization` and none carried the container field; of 18,240 documents with a container name, 900
carried the container field and none carried the pod field.

Availability differs too. Container-level utilization is emitted for each container that declares the limit, while the
pod-level aggregate requires **every** container in the pod to declare it. Across two live clusters over three hours, no
pod carried the pod-level field without also carrying the container-level one, while 27 pods carried the container-level
field with the pod-level field absent — every one of them a multi-container pod in which only some containers declared
limits. A pod-level throttling check on a sidecar-injected pod silently returns `null`.

| Cluster       | Container level only | Both levels | Neither | Pod level only |
| ------------- | -------------------- | ----------- | ------- | -------------- |
| forge-factory | 18                   | 7           | 44      | 0              |
| k8s-demo      | 9                    | 6           | 40      | 0              |

Use the pod-level fields only when the question is genuinely about the pod as a whole — total consumption against the
sum of its containers' limits — and only after confirming they are populated. **observability-sre-triage** applies the
same rule, so the two skills return the same answer for the same pod.

### Field availability

Several fields above are off by default in stock kube-stack collectors and require explicit configuration. Verify
presence with `GET /<index>/_mapping` or `GET /_field_caps` before relying on them; if absent, fall back as noted and
call out the substitution in the synthesis.

| Field                                                              | Why it might be missing                                                                                                       | Fall-back                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `k8s.container.status.last_terminated_reason`                      | Optional metric in k8sclusterreceiver; gated behind `metrics_collected.metadata` config.                                      | Infer from K8s `Killing` / `OOMKilling` events in `logs-k8seventsreceiver.otel-*` and exit codes in app logs.                                                                                                                                                                                                                                                           |
| `k8s.pod.status_reason`                                            | Same — optional metric on k8sclusterreceiver.                                                                                 | Infer from events: `Evicted`, `NodeLost`, `Preempted`.                                                                                                                                                                                                                                                                                                                  |
| `k8s.container.cpu_limit_utilization` / `memory_limit_utilization` | Only emitted for a container that declares the corresponding limit, and only when the kubeletstatsreceiver metric is enabled. | `k8s.pod.cpu.node.utilization` / `k8s.pod.memory.node.utilization` express consumption as a fraction of node capacity and are emitted whether or not limits are declared; or trend absolute `container.cpu.usage` / `container.memory.usage` against a baseline. Both fall-backs live on the pod-level documents, so group by `k8s.pod.name`, not `k8s.container.name`. |
| `k8s.pod.cpu_limit_utilization` / `memory_limit_utilization`       | Requires every container in the pod to declare the limit, so it is absent on most multi-container pods.                       | Use the container-level fields, which are available strictly more often.                                                                                                                                                                                                                                                                                                |
| `k8s.node.condition_memory_pressure`                               | Gated behind k8sclusterreceiver `node_conditions_to_report` (default omits this).                                             | Compare `k8s.node.memory.usage` against `k8s.node.allocatable_memory`, or look for `Evicted` events on the node.                                                                                                                                                                                                                                                        |

If a fall-back is used, note it in the synthesis (for example, `(via memory.usage; limit_utilization not collected)`) so
the reader knows the signal is indirect.

## ES|QL gotchas

Before writing queries, know these. Each of them silently produces wrong answers rather than failing loudly.

**`VALUES()` returns scalar for single distinct value, array for multiple.** Templating that assumes array shape (for
example, `| first`) extracts the first character of the string when scalar. Use `MV_FIRST(VALUES(...))` or handle both.

**`VALUES()` is newer than this skill's base floor.** It is GA on Serverless, but on Stack it is preview from 8.14.0 and
GA only in 9.4.0, and it does not exist at all below 8.14. Check `GET /` before using it: `build_flavor: "serverless"`
means it is available, otherwise read `version.number`. Where it is not available, move the field into the `BY` clause
instead of aggregating it — one row per distinct value carries the same information:

```esql
| STATS restarts = MAX(k8s.container.restarts), phase = MAX(k8s.pod.phase)
    BY term_reason = k8s.container.status.last_terminated_reason
| SORT restarts DESC
| LIMIT 10
```

**`PERCENTILE` does not work on OTel `histogram` type** (as of 8.15). For APM duration percentiles, use `AVG` on the
`aggregate_metric_double` summary field (`AVG(transaction.duration.summary)` divides sum by value_count). For true
percentiles, fall back to Kibana Query DSL.

**`COUNT(agg_metric_double)` returns `value_count` (events), not doc count.** `SUM(field)` gives the sum component;
`AVG(field)` gives sum/value_count. Do not use `SUM(transaction.duration.summary)` as an event-count proxy — it returns
total duration.

**K8s metrics use flat OTel field paths in ES|QL.** `k8s.pod.name`, not `resource.attributes.k8s.pod.name`. The nested
form is for raw log documents.

## Failure-mode taxonomy

The classification vocabulary — pivotal signal and corroborating checks for each mode across the workload, node, control
plane, autoscaling and networking layers, plus what to do when two modes fit — lives in
[references/failure-modes.md](references/failure-modes.md). Read it before classifying.

## Signal interpretation

### Memory

- **Monotonic rise over 30–60 min** → leak. Check GC metrics for the language: JVM `jvm.gc.duration`, Go
  `process.runtime.go.gc.pause_ns`, Node `v8js_gc_duration`. Rising GC frequency/pause with stable live-set is the
  canonical leak signature.
- **Diurnal / load-correlated spikes** → load-driven, not leak. Consider HPA tuning or limit increase.
- **Hits 1.0, then restart** → OOMKilled confirmed. Exit code 137 (SIGKILL) in app logs consistent.

### CPU

- `cpu_limit_utilization > 1.0` sustained → CFS throttling. Node has spare CPU; the pod is quota-blocked.
- Symptoms of throttling (not the throttle metric itself): liveness probe timeouts, p99 latency 4–16× p50, queue
  backpressure upstream, Error-reason container terminations.
- Average can look healthy while p95 is throttled. Do not trust average alone.

### Restart patterns

- `restarts > 0` recently → workload has been restarting. Don't read magnitude into the count (see _Restart count is
  boolean_); confirm the pattern from K8s `Killing` / `BackOff` event timestamps in `logs-k8seventsreceiver.otel-*`.
- Restarts correlated with memory pressure (`memory_limit_utilization → 1.0`) → OOMKilled path.
- Restarts without memory/CPU pressure → probe misconfig, app bug, or startup dependency failure. Pull events for
  `Unhealthy` and `Killing`.

### Termination reasons

- `OOMKilled` → memory path.
- `Error` → non-zero exit. Check app logs; if empty/minimal, check CPU throttling before attributing to app logic.
- `Completed` → ran to completion. Normal for Jobs/CronJobs/init containers; anomalous otherwise.
- `ContainerCannotRun` → runtime/image/exec issue. Check image pull events.

## Investigation flow

> An investigation is not a checklist. The sections below describe a _typical_ arc — **compress, skip, or revisit them
> based on what you find.** Terminate as soon as you have enough evidence to synthesize at a known confidence. Chasing
> signals past the point of diminishing returns is a failure mode, not thoroughness.

### Orient

Resolve the target: `k8s.pod.name`, `k8s.namespace.name`, optionally `k8s.deployment.name` and `service.name`. If no
time window is given, default to the last hour for pod-level investigations, last 2 hours for event correlation, last 6
hours for ongoing/unresolved incidents.

If the alert payload already tells you the failure mode (for example, it fires specifically on `OOMKilled`), note that
and skip classification; move to confirmation and baseline comparison.

### Characterize

Get the shape of the workload's recent behavior: restart count, termination reasons, phase, utilization. One or two
queries usually suffice.

```esql
FROM metrics-k8sclusterreceiver.otel-*
| WHERE k8s.pod.name == "<pod>" AND k8s.namespace.name == "<ns>"
  AND @timestamp > NOW() - 1 hour
| STATS restarts = MAX(k8s.container.restarts),
        term_reasons = VALUES(k8s.container.status.last_terminated_reason),
        phase = MAX(k8s.pod.phase)
```

`VALUES()` needs Serverless or Stack 8.14+ (GA 9.4). On an older Stack cluster use the `BY`-clause rewrite in
[ES|QL gotchas](#esql-gotchas) rather than dropping the termination reason from the query.

```esql
FROM metrics-kubeletstatsreceiver.otel-*
| WHERE k8s.pod.name == "<pod>" AND @timestamp > NOW() - 15 minutes
| STATS mem_pct = ROUND(MAX(k8s.container.memory_limit_utilization) * 100, 1),
        cpu_pct = ROUND(MAX(k8s.container.cpu_limit_utilization) * 100, 1)
    BY k8s.container.name
```

Group by container: a sidecar-injected pod has several, and only the ones that declare limits report utilization. If
every column comes back `null`, no limits are declared — fall back as described under
[Field availability](#field-availability) rather than reading `null` as idle.

### Classify

Use the taxonomy in [references/failure-modes.md](references/failure-modes.md). The pivotal signal should match; the
"Investigate" column tells you what corroboration to seek.

When two modes fit, note both and proceed with the one that has the stronger pivotal signal. You can revise during
corroboration.

### Corroborate

Pull the evidence your classification predicts you'll find. Typical sources:

**K8s events** for the namespace and window:

```esql
FROM logs-k8seventsreceiver.otel-*
| WHERE attributes.k8s.namespace.name == "<ns>"
  AND @timestamp > NOW() - 2 hours
  AND attributes.k8s.event.reason IN (
    "BackOff", "Killing", "Unhealthy", "Failed",
    "FailedScheduling", "Evicted", "SuccessfulRescale",
    "Pulling", "Pulled", "Started", "Created"
  )
| SORT @timestamp DESC
| KEEP @timestamp, attributes.k8s.event.reason, body.text, k8s.object.name
| LIMIT 30
```

**Namespace is a log attribute on this receiver, not a resource attribute.** Filter `attributes.k8s.namespace.name`, not
the flat `k8s.namespace.name`. The flat form is mapped on this data stream, so a query using it parses and executes and
returns **zero rows with no error** — on a Stack 9.4.4 cluster the flat field was populated on 0 of 832 events while the
`attributes.` form carried the namespace on all of them, so the flat filter discarded 300 matching `BackOff`, `Killing`
and `Unhealthy` events. The flat `k8s.*` paths do work on `metrics-kubeletstatsreceiver.otel-*` and
`metrics-k8sclusterreceiver.otel-*`, where namespace is a resource attribute; the events receiver is the exception.
Confirm with `COUNT(attributes.k8s.namespace.name)` against `COUNT(*)` before trusting an empty event result.

**Application logs** if available — look at the 200 most recent lines before the termination timestamp. If absent, flag
`no_logs_available`; do not invent a log pattern.

**APM** if the pod runs an instrumented service — resolve `service.name` from pod resource attributes for later
correlation. SLO / latency / error-rate analysis itself is APM-layer work and out of scope for this skill.

**Baseline comparison** — for utilization-based findings, compare current values to 7-day-prior at the same hour-of-day.
"High memory" is meaningful only relative to what's normal for this workload.

### Check for upstream cause (conditional)

Only pursue if the symptom pattern suggests it. Threshold: upstream error rate >5× baseline _or_ latency >3× baseline,
AND degradation started before the symptom on the target service. Co-symptoms do not establish causation.

If `metrics-service_destination.1m.otel-default` has no rows for the service, report `insufficient_dependency_data` —
not "upstreams healthy."

### Check for recent change (conditional)

`SuccessfulCreate` / `Pulled` events in the last 2 hours often correlate with deploys. `logs-k8sobjectsreceiver.otel-*`
shows configmap/secret/deployment spec changes. A change within 15 minutes of the symptom onset is a strong correlation,
but still a correlation — verify it plausibly explains the mode you've classified.

### Synthesize and stop

Synthesize as soon as you have enough evidence to support a hypothesis at known confidence. You do not need to complete
every preceding section — investigation terminates when either:

- You have a high-confidence hypothesis with corroboration, or
- You have a low/medium-confidence hypothesis and further queries are unlikely to change the picture (for example, logs
  are unavailable, APM isn't instrumented, no recent changes found).

## Synthesis

Default structure:

```text
HYPOTHESIS (confidence: high | medium | low)
<One paragraph: service, symptom, most likely cause. Name the failure mode from the taxonomy.>

EVIDENCE
- <Finding from characterization, with the concrete metric or value.>
- <Finding from events / logs / APM.>
- <Finding from baseline comparison, dependency check, or change correlation if pursued.>

CONFIDENCE NOTE
<Only if not 'high'. What specific evidence is missing or ambiguous.>

RECOMMENDED NEXT STEPS
1. <Most actionable — typically a config check or metric to observe.>
2. <Secondary.>

DOWNSTREAM IMPACT
<Services depending on this workload, or 'No downstream dependencies identified.'>
```

**Scale.** The whole synthesis runs 250–400 words. HYPOTHESIS is two or three sentences. EVIDENCE is three to five
single-line bullets, each citing a concrete value rather than re-explaining it. RECOMMENDED NEXT STEPS is two or three
single-line items — the ones you would actually do first, not everything that could be done. DOWNSTREAM IMPACT is one or
two sentences. A well-evidenced alert fits inside this comfortably; length is not thoroughness, and the on-call reader
scanning mid-incident will not get past the first screen.

**When two hypotheses are live:** replace HYPOTHESIS with COMPETING HYPOTHESES; list both, say which you lean toward and
why, and list the evidence that would disambiguate them.

**When no incident is found** (symptom resolved, or alert appears spurious): say so directly.
`ALERT FIRED BUT SYSTEM APPEARS HEALTHY` is a valid output. List what you checked and what you didn't find.

### Confidence calibration

Start at **high** and downgrade based on what's missing:

- Downgrade to **medium** if: primary signal is clear but corroboration is missing (no logs, no APM, no baseline
  comparison possible). Or: two modes fit and you can't disambiguate.
- Downgrade to **low** if: only a single signal supports the hypothesis, signals conflict, or the mode requires evidence
  you couldn't fetch.

Never return **high** when application log data was absent and the hypothesis depends on application behavior. Absence
of evidence does not corroborate a hypothesis.

## Query recipes

Ready-made queries for the most-restarting-pods, CPU-throttling, node-memory-pressure, admission-denial, and
firing-alert paths live in [references/query-recipes.md](references/query-recipes.md).

## Examples

### "Why is my pod CrashLoopBackOff-ing?"

Characterize first: get restart count, termination reason, memory and CPU utilization.

- If `last_terminated_reason == "OOMKilled"` and memory utilization reached 1.0 → memory path. Corroborate with 7-day
  baseline: monotonic rise over days = leak; spiky = load-driven. Check GC metrics if language is known.
- If `last_terminated_reason == "Error"` and `cpu_limit_utilization > 1.0` → CPU throttling path. Corroborate with
  liveness probe config (initialDelaySeconds, timeoutSeconds) and K8s events for `Unhealthy`.
- If `last_terminated_reason == "Error"` and CPU is fine → application-logic path. Pull recent logs before termination.
- If `last_terminated_reason == "ContainerCannotRun"` → image/exec path. Check K8s events for `Failed` pull events.

Synthesize with appropriate confidence. If logs were unavailable on the Error path, downgrade to medium and say so.

### "Is my rollout stuck?"

Authoritative signal: `k8s.deployment.available < k8s.deployment.desired` for > 10 minutes.

Diagnose the constraint:

- K8s events on the new ReplicaSet: `FailedCreate` → admission rejection (quota, webhook, PSP). `FailedScheduling` → no
  node fits.
- New-pod utilization: all at 0% memory → never started (image pull failure); high CPU with low memory → slow startup
  hitting readiness probe.
- HPA state: stable `current_replicas < desired_replicas` under load → unready-pod dampening.

### "Alert fired but everything looks healthy"

Possible and worth naming explicitly. Check:

- Has the symptom resolved? Compare current utilization/restart rate to the alert trigger point.
- Was the alert a transient spike that's already decayed?
- Is the alert tuned appropriately (for example, a too-short evaluation window)?

Output: `ALERT FIRED BUT SYSTEM APPEARS HEALTHY` with what you checked. Recommend alert tuning if the pattern is
recurrent.

## Related

- **Workflow:** `K8s CrashLoopBackOff Investigation` — alert-triggered automated version of the pod-level path above.
  Runs deterministic ESQL + branches; this skill provides the interpretation layer the workflow lacks.
- **Forge genome library:** 16 K8s failure scenarios (OOMKill cascade, CPU throttling, probe misconfig, node NotReady,
  admission webhook block, and so on) validating this skill's coverage.

## Operations

| HTTP API (shorthand)                | `elastic` CLI command                                             |
| ----------------------------------- | ----------------------------------------------------------------- |
| `GET /`                             | `elastic es info`                                                 |
| `POST /_query`                      | `elastic es esql query --format tsv --query '<esql>'`             |
| `GET /<index>/_mapping`             | `elastic es indices get-mapping --index '<index>'`                |
| `GET /_field_caps`                  | `elastic es field-caps --index '<index>' --fields '<fields>'`     |
| `GET kbn:/api/alerting/rules/_find` | `elastic kb alerting get-alerting-rules-find --filter '<filter>'` |
