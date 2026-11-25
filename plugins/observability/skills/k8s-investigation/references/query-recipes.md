# Query recipes

Ready-made queries for the common investigation paths. Every ES|QL query here runs via `POST /_query`; the alert lookup
runs via `GET kbn:/api/alerting/rules/_find`. See the `## Operations` table in `SKILL.md` for the CLI bindings.

## Most-restarting pods in a namespace

```esql
FROM metrics-k8sclusterreceiver.otel-*
| WHERE k8s.namespace.name == "<ns>" AND @timestamp > NOW() - 1 hour
| STATS restarts = MAX(k8s.container.restarts) BY k8s.pod.name, k8s.container.status.last_terminated_reason
| WHERE restarts > 0
| SORT restarts DESC
| LIMIT 20
```

## CPU throttling check for a pod

```esql
FROM metrics-kubeletstatsreceiver.otel-*
| WHERE k8s.pod.name == "<pod>" AND @timestamp > NOW() - 30 minutes
| STATS max_cpu_ratio = ROUND(MAX(k8s.container.cpu_limit_utilization), 2),
        avg_cpu_ratio = ROUND(AVG(k8s.container.cpu_limit_utilization), 2),
        max_cpu_cores = ROUND(MAX(container.cpu.usage), 3)
    BY k8s.container.name
```

Sustained ratio >1.0 = throttling. Transient >1.0 with avg <0.5 is usually benign burst.

Limit utilization is read at the container level, not the pod level — see
[Container-level against pod-level limit utilization](../SKILL.md#container-level-against-pod-level-limit-utilization).
All-`null` ratios mean no CPU limit is declared on any container in the pod, not that the pod is idle. In that case use
node-relative consumption, which is emitted regardless of limits:

```esql
FROM metrics-kubeletstatsreceiver.otel-*
| WHERE k8s.pod.name == "<pod>" AND @timestamp > NOW() - 30 minutes
| STATS max_cpu_node_pct = ROUND(MAX(k8s.pod.cpu.node.utilization) * 100, 2),
        max_mem_node_pct = ROUND(MAX(k8s.pod.memory.node.utilization) * 100, 2),
        max_cpu_cores = ROUND(MAX(k8s.pod.cpu.usage), 3)
```

## Nodes under memory pressure (right now)

```esql
FROM metrics-k8sclusterreceiver.otel-*
| WHERE @timestamp > NOW() - 15 minutes AND k8s.node.condition_memory_pressure == 1
| STATS ts = MAX(@timestamp) BY k8s.node.name
| SORT ts DESC
```

## Admission denials (webhook or quota) last hour

```esql
FROM logs-k8seventsreceiver.otel-*
| WHERE @timestamp > NOW() - 1 hour
  AND (attributes.k8s.event.reason == "FailedCreate"
       OR body.text LIKE "*admission webhook*"
       OR body.text LIKE "*exceeded quota*")
| SORT @timestamp DESC
| KEEP @timestamp, attributes.k8s.namespace.name, attributes.k8s.event.reason, body.text
| LIMIT 30
```

Namespace on the events receiver is the log attribute `attributes.k8s.namespace.name`. The flat `k8s.namespace.name` is
mapped on this data stream but null, so keeping or filtering on it yields an all-null column or a silent zero-row result
— see [the note under Corroborate](../SKILL.md#corroborate).

## Firing K8s alerts

Fetch the enabled rules unnarrowed and partition the response in memory:

```text
GET kbn:/api/alerting/rules/_find?per_page=100&filter=alert.attributes.enabled:true
```

Page with `page=2`, `page=3` and so on while `total` exceeds what you have received. Read `execution_status.status` on
each rule: `active` means its last run produced alerts, `ok` means it ran and produced none, and `error` means it is not
evaluating at all — a blind spot, not a pass.

**Do not narrow this call server-side.** Measured against a Serverless Kibana project holding two enabled Kubernetes
rules — `[Kubernetes OTel] Pod CrashLoopBackOff` (tags `kubernetes`, `pod-health`, `errors`) and
`[Kubernetes OTel] Availability — fast burn` (tags `k8s-otel`, `demo`) — the unnarrowed call above returns 2 of 2, while
`search=k8s&search_fields=tags&filter=alert.attributes.executionStatus.status:active` returns **0 of 2**. Tag search
filters on a naming convention neither rule follows, and `executionStatus.status:active` returns only rules firing at
this instant and hides every healthy rule. Both rules were `ok` at the time of measurement, so the narrowed form reports
no Kubernetes alerting coverage on a cluster that has two Kubernetes rules.
