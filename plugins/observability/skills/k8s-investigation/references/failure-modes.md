# Failure-mode taxonomy

Vocabulary for classifying a Kubernetes failure, not a decision tree. Use the pivotal-signal column to recognize which
mode you are looking at; use "Investigate" to know what else should corroborate. Field names appear here in their short
form — see [Key fields in SKILL.md](../SKILL.md#key-fields) for the fully qualified paths and which data stream carries
each.

## Workload layer

| Mode                                | Pivotal signal                                                                   | Investigate                                                                                                                                                                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OOMKilled**                       | `last_terminated_reason == "OOMKilled"` + `memory_limit_utilization → 1.0`       | Monotonic rise (leak) versus load-driven spike? Compare current trend to 7-day baseline. Check heap metrics (JVM, Go, Node) for GC pressure.                                                                                                                     |
| **CPU throttling → Error exit**     | `cpu_limit_utilization > 1.0` + `last_terminated_reason == "Error"`              | Liveness/readiness probe timeouts from CFS throttling. Average CPU can look fine (40–60%) while p99 throttle is severe. Check probe timeouts versus observed startup/health latency.                                                                             |
| **Liveness probe misconfiguration** | Restarts without resource pressure; `initialDelaySeconds` < startup time         | K8s events show `Unhealthy` / `Killing`. `kubectl logs --previous` typically shows healthy startup before kill.                                                                                                                                                  |
| **CrashLoopBackOff (generic)**      | `BackOff` events + rising `k8s.container.restarts`                               | Branch on `last_terminated_reason` — this is a meta-mode. OOMKilled → memory path; Error → logs + throttling; ContainerCannotRun → image/exec.                                                                                                                   |
| **ImagePullBackOff**                | K8s events `Failed` with image name + `429` or `not found`                       | Registry rate limit? Missing tag? Wrong imagePullSecret? Check recency of `Pulling`/`Pulled` events.                                                                                                                                                             |
| **Stuck rollout**                   | New pods `Pending`/not-Ready > `progressDeadlineSeconds`; old pods still serving | Check `k8s.deployment.available` against `.desired`. Admission rejection? Readiness probe failing on new pods? HPA not scaling?                                                                                                                                  |
| **Termination signal race**         | Brief 5xx bursts correlated with rolling deploys                                 | Endpoint removal races termination. New requests can reach the pod after SIGTERM starts. NGINX gotcha: `STOPSIGNAL SIGTERM` triggers _fast_ shutdown, not graceful — use `STOPSIGNAL SIGQUIT` for graceful drain. Check ingress 502 rate against rollout timing. |

## Node layer

| Mode                                | Pivotal signal                                                          | Investigate                                                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Node NotReady cascade**           | `k8s.node.condition_ready == 0` + mass `Evicted` events                 | Memory pressure? Disk pressure? Network partition from API server? Inspect kubelet logs, `k8s.node.condition_*` history.                   |
| **Resource eviction**               | `status_reason == "Evicted"` + `condition_memory_pressure == 1` on node | Node-level noisy neighbor. QoS order: BestEffort → Burstable → Guaranteed. Identify which pod drove node memory up.                        |
| **Node affinity/selector conflict** | Mass unschedulable pods after label change                              | K8s events show `FailedScheduling`. Often triggered by cluster upgrades (for example, `node-role.kubernetes.io/master` → `control-plane`). |

## Control plane

| Mode                          | Pivotal signal                                                     | Investigate                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **etcd I/O cascade**          | API server latency spike + cluster-wide kubelet heartbeat failures | Disk IOPS, fsync latency (must be <10ms). Cloud-burst-credit exhaustion is common.                                                      |
| **Admission webhook block**   | Mass `FailedCreate` across namespaces; deployments frozen          | `failurePolicy:Fail` webhook pod crashed. Check webhook pod health + API server TCP connection cache (caches dead connections ~15 min). |
| **Priority preemption storm** | Production pods terminating with `preempted-by` annotation         | New `PriorityClass` with `globalDefault:true` caused cascade. Check `kube-scheduler` events.                                            |
| **PDB drain deadlock**        | Node drain stuck indefinitely; HTTP 429 from Eviction API          | PDB `minAvailable`/`maxUnavailable` too strict. No default drain timeout. Manual PDB deletion unblocks.                                 |

## Autoscaling & admission

| Mode                          | Pivotal signal                                                     | Investigate                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HPA unready-pod dampening** | Load rising, HPA not scaling; unready pods included in calculation | HPA averages CPU across all replicas including unready (0% contribution). Check `k8s.hpa.current_replicas` against `.desired_replicas` + pod readiness. |
| **Resource quota silent 403** | Deployment stuck at n-1/n; `FailedCreate` on ReplicaSet            | Namespace quota exhausted (often CronJob accumulation). Check `k8s.resource_quota.used` against `.hard_limit`.                                          |

## Networking

| Mode                        | Pivotal signal                                           | Investigate                                                                                                           |
| --------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **StatefulSet split-brain** | Duplicate pod identities across partitioned nodes        | Network partition + eviction timeout race. Two instances of same ordinal running. No fencing by default.              |
| **CoreDNS OOMKill**         | CoreDNS restarts + cluster-wide DNS timeouts in app logs | Default CoreDNS memory (~170Mi) insufficient under query amplification (ndots:5, each external lookup → ~10 lookups). |

## When classification is ambiguous

Real incidents often match two modes. Examples:

- OOMKilled pod with simultaneous CPU throttling — memory usually drives the kill, but verify by checking whether memory
  or CPU reached its limit first.
- Stuck rollout with HPA dampening and resource quota near-exhaustion — both can freeze a deploy. Check which constraint
  is binding.
- Node NotReady with pods that were already crashing — the node issue might be incidental.

When two modes fit, name both in the synthesis and say which one you believe is causal and why. Do not force a single
hypothesis when the evidence supports two.
