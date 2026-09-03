---
name: observability-k8s-investigation
description: >
  Investigate Kubernetes workload, node, and control-plane issues using OTel telemetry
  (EDOT). Use when diagnosing pod failures (CrashLoopBackOff, OOMKilled, Error), node
  pressure, resource exhaustion, image pull failures, admission rejections, autoscaling
  anomalies, or correlating K8s state with application signals. OTel ingest path only
  — the legacy ECS Kubernetes integration shape is out of scope.
metadata:
  author: elastic
  version: 0.2.0
---

# Kubernetes Investigation

Diagnose Kubernetes issues using OTel telemetry collected via EDOT (Elastic Distribution of OpenTelemetry) and the
kube-stack collector. Correlate cluster state, pod runtime metrics, K8s events, application logs, and APM to identify
root cause across the workload, node, and control-plane layers.

## Scope

**In scope:** OTel-receiver-namespaced indices (`metrics-kubeletstatsreceiver.otel-*`,
`metrics-k8sclusterreceiver.otel-*`, `logs-k8seventsreceiver.otel-*`, `logs-k8sobjectsreceiver.otel-*`) and OTel
semantic conventions (`k8s.pod.name`, `k8s.namespace.name`, `k8s.container.restarts`).

**Out of scope:**

- The legacy Elastic Agent Kubernetes integration (`metrics-kubernetes.*`, `logs-kubernetes.*`, `kubernetes.*` fields).
  Being deprecated — do not author queries against these paths.
- APM-layer analysis (service SLO breaches, transaction error rates, upstream dependency health). Different domain —
  once a K8s root cause is ruled in or out, APM investigation continues outside this skill.
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

**OOMKilled ≠ memory leak by default.** The limit may simply be undersized for the workload's working set. Compare
against a 7-day baseline at the same hour-of-day before claiming a leak.

**Error-termination ≠ application bug by default.** Check `k8s.pod.cpu_limit_utilization` first. CFS throttling driving
liveness probe timeouts is the most common misdiagnosis in this space.

**Average CPU hides throttling.** A pod can look healthy at 40–60% average `cpu_limit_utilization` while being throttled
severely at p99. Linux enforces CPU limits in 100ms periods; bursty workloads hit quota mid-period and stall. Look at
max and p95, not just average.

**Restart count is boolean, not a counter.** `k8s.container.restarts` is pulled directly from the K8s API and may be
pruned by the kubelet at any time, so the absolute value is unreliable. Treat it as `== 0` (no recent restarts) vs `> 0`
(recently restarting); do not derive backoff timing or "linear vs exponential" patterns from it. Confirm the restart
pattern via K8s `Killing` / `BackOff` events instead.

**Prefer to report uncertainty over manufacturing confidence.** If the evidence is ambiguous, the synthesis should say
so. Competing hypotheses are a valid output.

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
| `k8s.namespace.name`                             | all k8s                     | Namespace                                               |
| `k8s.container.name`                             | all k8s                     | Container within pod                                    |
| `k8s.deployment.name`                            | k8sclusterreceiver + others | Parent deployment                                       |
| `k8s.pod.phase`                                  | k8sclusterreceiver          | Pending=1/Running=2/Succeeded=3/Failed=4/Unknown=5      |
| `k8s.container.restarts`                         | k8sclusterreceiver          | Total container restart count                           |
| `k8s.container.status.last_terminated_reason`    | k8sclusterreceiver          | `OOMKilled`, `Error`, `Completed`, `ContainerCannotRun` |
| `k8s.pod.status_reason`                          | k8sclusterreceiver          | Pod-level reason (`Evicted`, `NodeLost`)                |
| `k8s.pod.memory_limit_utilization`               | kubeletstatsreceiver        | 0.0–1.0+ (can exceed 1 transiently before OOM)          |
| `k8s.pod.cpu_limit_utilization`                  | kubeletstatsreceiver        | 0.0–N (frequently >1 under CFS throttling)              |
| `k8s.pod.memory.usage` / `.working_set`          | kubeletstatsreceiver        | Bytes                                                   |
| `k8s.node.condition_memory_pressure`             | k8sclusterreceiver          | 1 = pressure, 0 = ok                                    |
| `k8s.node.condition_ready`                       | k8sclusterreceiver          | 0 = NotReady                                            |
| `k8s.hpa.current_replicas` / `.desired_replicas` | k8sclusterreceiver          | HPA state                                               |
| `attributes.k8s.event.reason`                    | k8seventsreceiver           | Event reason (filter on this)                           |
| `body.text`                                      | k8seventsreceiver / logs    | Event message / log message                             |
| `k8s.object.name`                                | k8seventsreceiver           | involvedObject name (log attribute, use flat form)      |

### Field availability

Several fields above are off by default in stock kube-stack collectors and require explicit configuration. Verify
presence before relying on them; if absent, fall back as noted and call out the substitution in the synthesis.

| Field                                                        | Why it might be missing                                                                                    | Fall-back                                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `k8s.container.status.last_terminated_reason`                | Optional metric in k8sclusterreceiver; gated behind `metrics_collected.metadata` config.                   | Infer from K8s `Killing` / `OOMKilling` events in `logs-k8seventsreceiver.otel-*` and exit codes in app logs.                 |
| `k8s.pod.status_reason`                                      | Same — optional metric on k8sclusterreceiver.                                                              | Infer from events: `Evicted`, `NodeLost`, `Preempted`.                                                                        |
| `k8s.pod.cpu_limit_utilization` / `memory_limit_utilization` | Only emitted when the pod has the corresponding limit set, and the kubeletstatsreceiver metric is enabled. | Compute manually as `k8s.pod.cpu.usage / <limit>` from k8sclusterreceiver, or use absolute usage trending against a baseline. |
| `k8s.node.condition_memory_pressure`                         | Gated behind k8sclusterreceiver `node_conditions_to_report` (default omits this).                          | Compare `k8s.node.memory.usage` against `k8s.node.allocatable_memory`, or look for `Evicted` events on the node.              |

If a fall-back is used, note it in the synthesis (e.g. `(via memory.usage; limit_utilization not collected)`) so the
reader knows the signal is indirect.

## ES|QL gotchas

Before writing queries, know these. Each of them silently produces wrong answers rather than failing loudly.

**`VALUES()` returns scalar for single distinct value, array for multiple.** Templating that assumes array shape (e.g.
`| first`) extracts the first character of the string when scalar. Use `MV_FIRST(VALUES(...))` or handle both.

**`PERCENTILE` does not work on OTel `histogram` type** (as of 8.15). For APM duration percentiles, use `AVG` on the
`aggregate_metric_double` summary field (`AVG(transaction.duration.summary)` divides sum by value_count). For true
percentiles, fall back to Kibana Query DSL.

**`COUNT(agg_metric_double)` returns `value_count` (events), not doc count.** `SUM(field)` gives the sum component;
`AVG(field)` gives sum/value_count. Do not use `SUM(transaction.duration.summary)` as an event-count proxy — it returns
total duration.

**K8s metrics use flat OTel field paths in ES|QL.** `k8s.pod.name`, not `resource.attributes.k8s.pod.name`. The nested
form is for raw log documents.

## Failure-mode taxonomy

Vocabulary for classification, not a decision tree. Use the pivotal-signal column to recognize which mode you're looking
at; use "Investigate" to know what else should corroborate.

### Workload layer

| Mode                                | Pivotal signal                                                                   | Investigate                                                                                                                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OOMKilled**                       | `last_terminated_reason == "OOMKilled"` + `memory_limit_utilization → 1.0`       | Monotonic rise (leak) vs. load-driven spike? Compare current trend to 7-day baseline. Check heap metrics (JVM, Go, Node) for GC pressure.                                                                                                                 |
| **CPU throttling → Error exit**     | `cpu_limit_utilization > 1.0` + `last_terminated_reason == "Error"`              | Liveness/readiness probe timeouts from CFS throttling. Average CPU can look fine (40–60%) while p99 throttle is severe. Check probe timeouts vs observed startup/health latency.                                                                          |
| **Liveness probe misconfiguration** | Restarts without resource pressure; `initialDelaySeconds` < startup time         | K8s events show `Unhealthy` / `Killing`. `kubectl logs --previous` typically shows healthy startup before kill.                                                                                                                                           |
| **CrashLoopBackOff (generic)**      | `BackOff` events + rising `k8s.container.restarts`                               | Branch on `last_terminated_reason` — this is a meta-mode. OOMKilled → memory path; Error → logs + throttling; ContainerCannotRun → image/exec.                                                                                                            |
| **ImagePullBackOff**                | K8s events `Failed` with image name + `429` or `not found`                       | Registry rate limit? Missing tag? Wrong imagePullSecret? Check recency of `Pulling`/`Pulled` events.                                                                                                                                                      |
| **Stuck rollout**                   | New pods `Pending`/not-Ready > `progressDeadlineSeconds`; old pods still serving | Check `k8s.deployment.available` vs `.desired`. Admission rejection? Readiness probe failing on new pods? HPA not scaling?                                                                                                                                |
| **Termination signal race**         | Brief 5xx bursts correlated with rolling deploys                                 | Endpoint removal races termination. New requests can hit the pod after SIGTERM starts. NGINX gotcha: `STOPSIGNAL SIGTERM` triggers _fast_ shutdown, not graceful — use `STOPSIGNAL SIGQUIT` for graceful drain. Check ingress 502 rate vs rollout timing. |

### Node layer

| Mode                                | Pivotal signal                                                          | Investigate                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Node NotReady cascade**           | `k8s.node.condition_ready == 0` + mass `Evicted` events                 | Memory pressure? Disk pressure? Network partition from API server? Inspect kubelet logs, `k8s.node.condition_*` history.           |
| **Resource eviction**               | `status_reason == "Evicted"` + `condition_memory_pressure == 1` on node | Node-level noisy neighbor. QoS order: BestEffort → Burstable → Guaranteed. Identify which pod drove node memory up.                |
| **Node affinity/selector conflict** | Mass unschedulable pods after label change                              | K8s events show `FailedScheduling`. Often triggered by cluster upgrades (e.g. `node-role.kubernetes.io/master` → `control-plane`). |

### Control plane

| Mode                          | Pivotal signal                                                     | Investigate                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **etcd I/O cascade**          | API server latency spike + cluster-wide kubelet heartbeat failures | Disk IOPS, fsync latency (must be <10ms). Cloud-burst-credit exhaustion is common.                                                      |
| **Admission webhook block**   | Mass `FailedCreate` across namespaces; deployments frozen          | `failurePolicy:Fail` webhook pod crashed. Check webhook pod health + API server TCP connection cache (caches dead connections ~15 min). |
| **Priority preemption storm** | Production pods terminating with `preempted-by` annotation         | New `PriorityClass` with `globalDefault:true` caused cascade. Check `kube-scheduler` events.                                            |
| **PDB drain deadlock**        | Node drain stuck indefinitely; HTTP 429 from Eviction API          | PDB `minAvailable`/`maxUnavailable` too strict. No default drain timeout. Manual PDB deletion unblocks.                                 |

### Autoscaling & admission

| Mode                          | Pivotal signal                                                     | Investigate                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HPA unready-pod dampening** | Load rising, HPA not scaling; unready pods included in calculation | HPA averages CPU across all replicas including unready (0% contribution). Check `k8s.hpa.current_replicas` vs `.desired_replicas` + pod readiness. |
| **Resource quota silent 403** | Deployment stuck at n-1/n; `FailedCreate` on ReplicaSet            | Namespace quota exhausted (often CronJob accumulation). Check `k8s.resource_quota.used` vs `.hard_limit`.                                          |

### Networking

| Mode                        | Pivotal signal                                           | Investigate                                                                                                           |
| --------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **StatefulSet split-brain** | Duplicate pod identities across partitioned nodes        | Network partition + eviction timeout race. Two instances of same ordinal running. No fencing by default.              |
| **CoreDNS OOMKill**         | CoreDNS restarts + cluster-wide DNS timeouts in app logs | Default CoreDNS memory (~170Mi) insufficient under query amplification (ndots:5, each external lookup → ~10 lookups). |

### When classification is ambiguous

Real incidents often match two modes. Examples:

- OOMKilled pod with simultaneous CPU throttling — memory usually drives the kill, but verify by checking whether memory
  or CPU hit limit first.
- Stuck rollout with HPA dampening and resource quota near-exhaustion — both can freeze a deploy. Check which constraint
  is binding.
- Node NotReady with pods that were already crashing — the node issue may be incidental.

When two modes fit, name both in the synthesis and say which one you believe is causal and why. Do not force a single
hypothesis when the evidence supports two.

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

If the alert payload already tells you the failure mode (e.g., it fires specifically on `OOMKilled`), note that and skip
classification; move to confirmation and baseline comparison.

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

```esql
FROM metrics-kubeletstatsreceiver.otel-*
| WHERE k8s.pod.name == "<pod>" AND @timestamp > NOW() - 15 minutes
| STATS mem_pct = ROUND(MAX(k8s.pod.memory_limit_utilization) * 100, 1),
        cpu_pct = ROUND(MAX(k8s.pod.cpu_limit_utilization) * 100, 1)
```

### Classify

Use the taxonomy. The pivotal signal should match; the "Investigate" column tells you what corroboration to seek.

When two modes fit, note both and proceed with the one that has the stronger pivotal signal. You may revise during
corroboration.

### Corroborate

Pull the evidence your classification predicts you'll find. Typical sources:

**K8s events** for the namespace and window:

```esql
FROM logs-k8seventsreceiver.otel-*
| WHERE k8s.namespace.name == "<ns>"
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
every section above — investigation terminates when either:

- You have a high-confidence hypothesis with corroboration, or
- You have a low/medium-confidence hypothesis and further queries are unlikely to change the picture (e.g., logs are
  unavailable, APM isn't instrumented, no recent changes found).

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

### Most-restarting pods in a namespace

```esql
FROM metrics-k8sclusterreceiver.otel-*
| WHERE k8s.namespace.name == "<ns>" AND @timestamp > NOW() - 1 hour
| STATS restarts = MAX(k8s.container.restarts) BY k8s.pod.name, k8s.container.status.last_terminated_reason
| WHERE restarts > 0
| SORT restarts DESC
| LIMIT 20
```

### CPU throttling check for a pod

```esql
FROM metrics-kubeletstatsreceiver.otel-*
| WHERE k8s.pod.name == "<pod>" AND @timestamp > NOW() - 30 minutes
| STATS max_cpu_ratio = ROUND(MAX(k8s.pod.cpu_limit_utilization), 2),
        avg_cpu_ratio = ROUND(AVG(k8s.pod.cpu_limit_utilization), 2),
        max_cpu_cores = ROUND(MAX(k8s.pod.cpu.usage), 3)
```

Sustained ratio >1.0 = throttling. Transient >1.0 with avg <0.5 is usually benign burst.

### Nodes under memory pressure (right now)

```esql
FROM metrics-k8sclusterreceiver.otel-*
| WHERE @timestamp > NOW() - 15 minutes AND k8s.node.condition_memory_pressure == 1
| STATS ts = MAX(@timestamp) BY k8s.node.name
| SORT ts DESC
```

### Admission denials (webhook or quota) last hour

```esql
FROM logs-k8seventsreceiver.otel-*
| WHERE @timestamp > NOW() - 1 hour
  AND (attributes.k8s.event.reason == "FailedCreate"
       OR body.text LIKE "*admission webhook*"
       OR body.text LIKE "*exceeded quota*")
| SORT @timestamp DESC
| KEEP @timestamp, k8s.namespace.name, attributes.k8s.event.reason, body.text
| LIMIT 30
```

### Firing K8s alerts

```text
GET /api/alerting/rules/_find?search=k8s&search_fields=tags&filter=alert.attributes.executionStatus.status:active
```

## Examples

### "Why is my pod CrashLoopBackOff-ing?"

Characterize first: get restart count, termination reason, memory and CPU utilization.

- If `last_terminated_reason == "OOMKilled"` and memory utilization hit 1.0 → memory path. Corroborate with 7-day
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
- Is the alert tuned appropriately (e.g., too-short evaluation window)?

Output: `ALERT FIRED BUT SYSTEM APPEARS HEALTHY` with what you checked. Recommend alert tuning if the pattern is
recurrent.

## Related

- **Workflow:** `K8s CrashLoopBackOff Investigation` — alert-triggered automated version of the pod-level path above.
  Runs deterministic ESQL + branches; this skill provides the interpretation layer the workflow lacks.
- **Forge genome library:** 16 K8s failure scenarios (OOMKill cascade, CPU throttling, probe misconfig, node NotReady,
  admission webhook block, etc.) validating this skill's coverage.
