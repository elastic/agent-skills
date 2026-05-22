# Log Search Reference

Reference for Observability log search: index patterns, ECS/OpenTelemetry field mapping, and resource metadata
fallbacks.

## Log index patterns

- `logs-*-*,logs-*,filebeat-*` — common pattern for log data streams
- `logs.*`- to also include wired streams

## ECS and OpenTelemetry

Observability index templates provide **field aliases** that map OpenTelemetry fields to ECS. Query using **ECS field
names** only; aliases handle the mapping.

| ECS field              | OTel / other notes       |
| ---------------------- | ------------------------ |
| `message`              | `body.text` (OTel)       |
| `log.level`            | `severity_text`          |
| `trace.id`             | `trace_id`               |
| `span.id`              | `span_id`                |
| `service.name`         | Service name             |
| `service.environment`  | `deployment.environment` |
| `host.name`            | Host name                |
| `kubernetes.pod.name`  | `k8s.pod.name`           |
| `kubernetes.namespace` | `k8s.namespace.name`     |
| `@timestamp`           | Event time               |

## Resource metadata field fallbacks

For display or grouping, use the first available in each line (ECS then OTel aliases):

| Resource  | Preferred field(s) — try in order                                                                                                                                                                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service   | `service.name`                                                                                                                                                                                                                                                                                                   |
| Container | `kubernetes.container.name` → `k8s.container.name` → `container.name`                                                                                                                                                                                                                                            |
| Host/Node | `kubernetes.node.name` → `k8s.node.name` → `host.name`                                                                                                                                                                                                                                                           |
| Cluster   | `orchestrator.cluster.name` → `k8s.cluster.name`                                                                                                                                                                                                                                                                 |
| Namespace | `kubernetes.namespace` → `k8s.namespace.name`                                                                                                                                                                                                                                                                    |
| Pod       | `kubernetes.pod.name` → `k8s.pod.name`                                                                                                                                                                                                                                                                           |
| Workload  | One of: `kubernetes.deployment.name`, `k8s.deployment.name`, `kubernetes.replicaset.name`, `k8s.replicaset.name`, `kubernetes.statefulset.name`, `k8s.statefulset.name`, `kubernetes.daemonset.name`, `k8s.daemonset.name`, `kubernetes.job.name`, `k8s.job.name`, `kubernetes.cronjob.name`, `k8s.cronjob.name` |

## Message field fallback order

When building a single “message” for display from a log document, use the first non-empty of:

1. `body.text` (OTel message)
2. `message`
3. `error.message`
4. `event.original`
5. `exception.message`
6. `error.exception.message`
7. `attributes.exception.message` (OTel)

## ES|QL query shape for logs

Typical shape when using `POST /_query`:

1. `FROM <index_pattern> METADATA _id, _index` — include index and id for samples
2. `WHERE @timestamp >= ... AND @timestamp <= ...` — time range (ISO or date math)
3. Optional: `| WHERE KQL("...")` — KQL filter (escape `\"` in JSON)
4. For histogram + total + samples in one call:
   `| FORK (STATS ... BY bucket = BUCKET(@timestamp, <size>) ...) (STATS total = COUNT(*)) (SORT @timestamp DESC | LIMIT n | KEEP ...)`

Bucket size examples: `30s`, `1m`, `5m`, `1h`. Keep sample LIMIT small (10–20 default; cap 500).

## Related documentation

- [ES|QL FORK command](https://www.elastic.co/docs/reference/query-languages/esql/commands/fork) — branch limits,
  default LIMIT behavior, preview status
- [ES|QL CATEGORIZE function](https://www.elastic.co/docs/reference/query-languages/esql/functions-operators/grouping-functions/categorize)
  — license requirement, grouping constraints
- [ES|QL KQL function](https://www.elastic.co/docs/reference/query-languages/esql/functions-operators/search-functions/kql)
  — syntax and options
- [Use the ES|QL REST API](https://www.elastic.co/docs/reference/query-languages/esql/esql-rest) — `POST /_query`
  endpoint, async queries, response formats
