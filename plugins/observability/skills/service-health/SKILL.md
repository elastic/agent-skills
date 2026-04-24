---
name: observability-service-health
description: >
  Assess APM service health using SLOs, alerts, ML, throughput, latency, error rate,
  and dependencies. Use when checking service status, performance, or when the user
  asks about service health.
metadata:
  author: elastic
  version: 0.1.0
---

# APM Service Health

Assess APM service health using [Observability APIs](https://www.elastic.co/docs/solutions/observability/apis),
**ES|QL** against APM indices, Elasticsearch APIs, and (for correlation and APM-specific logic) the Kibana repo. Use
SLOs, firing alerts, ML anomalies, throughput, latency (avg/p95/p99), error rate, and dependency health.

## Where to look

- **Observability APIs** ([Observability APIs](https://www.elastic.co/docs/solutions/observability/apis)): Use the
  **SLOs API** ([Stack](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-slo) |
  [Serverless](https://www.elastic.co/docs/api/doc/serverless/group/endpoint-slo)) to get SLO definitions, status, burn
  rate, and error budget. Use the **Alerting API**
  ([Stack](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-alerting) |
  [Serverless](https://www.elastic.co/docs/api/doc/serverless/group/endpoint-alerting)) to list and manage alerting
  rules and their alerts for the service. Use **APM annotations API** to create or search annotations when needed.
- **ES|QL and Elasticsearch:** Query `traces*apm*,traces*otel*` and `metrics*apm*,metrics*otel*` with **ES|QL** (see
  [Using ES|QL for APM metrics](#using-esql-for-apm-metrics)) for throughput, latency, error rate, and dependency-style
  aggregations. Use Elasticsearch APIs (e.g. `POST _query` for ES|QL, or Query DSL) as documented in the Elasticsearch
  repo for indices and search.
- **APM Correlations:** Run the **apm-correlations** script to get attributes that correlate with high-latency or failed
  transactions for a given service. It tries the Kibana internal APM correlations API first, then falls back to
  Elasticsearch significant_terms on `traces*apm*,traces*otel*`. See
  [APM Correlations script](#apm-correlations-script).
- **Infrastructure:** Correlate via **resource attributes** (e.g. `k8s.pod.name`, `container.id`, `host.name`) in
  traces; query infrastructure or metrics indices with ES|QL/Elasticsearch for CPU and memory. **OOM** and **CPU
  throttling** directly impact APM health.
- **Logs:** Use **ES|QL** or Elasticsearch search on log indices filtered by `service.name` or `trace.id` to explain
  behavior and root cause.
- **Observability Labs:** [Observability Labs](https://www.elastic.co/observability-labs) and
  [APM tag](https://www.elastic.co/observability-labs/blog/tag/apm) for patterns and troubleshooting.

## Health criteria

Synthesize health from all of the following when available:

| Signal                | What to check                                                             |
| --------------------- | ------------------------------------------------------------------------- |
| **SLOs**              | Burn rate, status (healthy/degrading/violated), error budget.             |
| **Firing alerts**     | Open or recently fired alerts for the service or dependencies.            |
| **ML anomalies**      | Anomaly jobs; score and severity for latency, throughput, or error rate.  |
| **Throughput**        | Request rate; compare to baseline or previous period.                     |
| **Latency**           | Avg, p95, p99; compare to SLO targets or history.                         |
| **Error rate**        | Failed/total requests; spikes or sustained elevation.                     |
| **Dependency health** | Downstream latency, error rate, availability (ES\|QL, APIs, Kibana repo). |
| **Infrastructure**    | CPU usage, memory; OOM and CPU throttling on pods/containers/hosts.       |
| **Logs**              | App logs filtered by service or trace ID for context and root cause.      |

Treat a service as **unhealthy** if SLOs are violated, critical alerts are firing, or ML anomalies indicate severe
degradation. Correlate with infrastructure (OOM, CPU throttling), dependencies, and logs (service/trace context) to
explain _why_ and suggest next steps.

## Using ES|QL for APM metrics

When querying APM data from Elasticsearch (`traces*apm*,traces*otel*`, `metrics*apm*,metrics*otel*`), use **ES|QL by
default** where available.

- **Availability:** ES|QL is available in **Elasticsearch 8.11+** (technical preview; GA in 8.14). It is **always
  available** in
  [Elastic Observability Serverless Complete tier](https://www.elastic.co/docs/solutions/observability/observability-serverless-feature-tiers).
- **Scoping to a service:** Always filter by `service.name` (and `service.environment` when relevant). Combine with a
  time range on `@timestamp`:

```esql
WHERE service.name == "my-service-name" AND service.environment == "production"
  AND @timestamp >= "2025-03-01T00:00:00Z" AND @timestamp <= "2025-03-01T23:59:59Z"
```

- **Example patterns:** Throughput, latency, and error rate over time: see Kibana `trace_charts_definition.ts`
  (`getThroughputChart`, `getLatencyChart`, `getErrorRateChart`). Use `from(index)` → `where(...)` → `stats(...)` /
  `evaluate(...)` with `BUCKET(@timestamp, ...)` and `WHERE service.name == "<service_name>"`.
- **Performance:** Add `LIMIT n` to cap rows and token usage. Prefer coarser `BUCKET(@timestamp, ...)` (e.g. 1 hour)
  when only trends are needed; finer buckets increase work and result size.

## APM Correlations script

When only a **subpopulation** of transactions has high latency or failures, run the **apm-correlations** script to list
attributes that correlate with those transactions (e.g. host, service version, pod, region). The script tries the Kibana
internal APM correlations API first; if unavailable (e.g. 404), it falls back to Elasticsearch significant_terms on
`traces*apm*,traces*otel*`.

```bash
# Latency correlations (attributes over-represented in slow transactions)
node skills/observability/service-health/scripts/apm-correlations.js latency-correlations --service-name <name> [--start <iso>] [--end <iso>] [--last-minutes 60] [--transaction-type <t>] [--transaction-name <n>] [--space <id>] [--json]

# Failed transaction correlations
node skills/observability/service-health/scripts/apm-correlations.js failed-correlations --service-name <name> [--start <iso>] [--end <iso>] [--last-minutes 60] [--transaction-type <t>] [--transaction-name <n>] [--space <id>] [--json]

# Test Kibana connection
node skills/observability/service-health/scripts/apm-correlations.js test [--space <id>]
```

**Environment:** `KIBANA_URL` and `KIBANA_API_KEY` (or `KIBANA_USERNAME`/`KIBANA_PASSWORD`) for Kibana; for fallback,
`ELASTICSEARCH_URL` and `ELASTICSEARCH_API_KEY`. Use the same time range as the investigation.

## Workflow

```text
Service health progress:
- [ ] Step 1: Identify the service (and time range)
- [ ] Step 2: Check SLOs and firing alerts
- [ ] Step 3: Check ML anomalies (if configured)
- [ ] Step 4: Review throughput, latency (avg/p95/p99), error rate
- [ ] Step 5: Assess dependency health (ES|QL/APIs / Kibana repo)
- [ ] Step 6: Correlate with infrastructure and logs
- [ ] Step 7: Summarize health and recommend actions
```

### Step 1: Identify the service

Confirm service name and time range. Resolve the service from the request; if multiple are in scope, target the most
relevant. Use ES|QL on `traces*apm*,traces*otel*` or `metrics*apm*,metrics*otel*` (e.g.
`WHERE service.name == "<name>"`) or Kibana repo APM routes to obtain service-level data. If the user has not provided
the time range, assume last hour.

### Step 2: Check SLOs and firing alerts

**SLOs:** Call the **SLOs API** to get SLO definitions and status for the service (latency, availability),
healthy/degrading/violated, burn rate, error budget. **Alerts:** For active APM alerts, call
`/api/alerting/rules/_find?search=apm&search_fields=tags&per_page=100&filter=alert.attributes.executionStatus.status:active`.
When checking one service, include both rules where `params.serviceName` matches the service and rules where
`params.serviceName` is absent (all-services rules). Do not query `.alerts*` indices for active-state checks. Correlate
with SLO violations or metric changes.

### Step 3: Check ML anomalies

If ML anomaly detection is used, query ML job results or anomaly records (via Elasticsearch ML APIs or indices) for the
service and time range. Note high-severity anomalies (latency, throughput, error rate); use anomaly time windows to
narrow Steps 4–5.

### Step 4: Review throughput, latency, and error rate

Use **ES|QL** against `traces*apm*,traces*otel*` or `metrics*apm*,metrics*otel*` for the service and time range to get
**throughput** (e.g. req/min), **latency** (avg, p95, p99), **error rate** (failed/total or 5xx/total). Example:
`FROM traces*apm*,traces*otel* | WHERE service.name == "<service_name>" AND @timestamp >= ... AND @timestamp <= ... | STATS ...`.
Compare to prior period or SLO targets. See [Using ES|QL for APM metrics](#using-esql-for-apm-metrics).

### Step 5: Assess dependency health

Obtain dependency and service-map data via **ES|QL** on `traces*apm*,traces*otel*`/`metrics*apm*,metrics*otel*` (e.g.
downstream service/span aggregations) or via APM route handlers in the **Kibana repo** that expose
dependency/service-map data. For the service and time range, note downstream latency and error rate; flag slow or
failing dependencies as likely causes.

### Step 6: Correlate with infrastructure and logs

- **APM Correlations (when only a subpopulation is affected):** Run
  `node skills/observability/service-health/scripts/apm-correlations.js latency-correlations|failed-correlations --service-name <name> [--start ...] [--end ...]`
  to get correlated attributes. Filter by those attributes and fetch trace samples or errors to confirm root cause. See
  [APM Correlations script](#apm-correlations-script).
- **Infrastructure:** Use **resource attributes** from traces (e.g. `k8s.pod.name`, `container.id`, `host.name`) and
  query infrastructure/metrics indices with **ES|QL** or Elasticsearch for **CPU** and **memory**. **OOM** and **CPU
  throttling** directly impact APM health; correlate their time windows with APM degradation.
- **Logs:** Use **ES|QL** or Elasticsearch on log indices with `service.name == "<service_name>"` or
  `trace.id == "<trace_id>"` to explain behavior and root cause (exceptions, timeouts, restarts).

### Step 7: Summarize and recommend

State health (**healthy** / **degraded** / **unhealthy**) with reasons; list concrete next steps.

## Examples

### Example: ES|QL for a specific service

Scope with `WHERE service.name == "<service_name>"` and time range. Throughput and error rate (1-hour buckets; `LIMIT`
caps rows and tokens):

```esql
FROM traces*apm*,traces*otel*
| WHERE service.name == "api-gateway"
  AND @timestamp >= "2025-03-01T00:00:00Z" AND @timestamp <= "2025-03-01T23:59:59Z"
| STATS request_count = COUNT(*), failures = COUNT(*) WHERE event.outcome == "failure" BY BUCKET(@timestamp, 1 hour)
| EVAL error_rate = failures / request_count
| SORT @timestamp
| LIMIT 500
```

Latency percentiles and exact field names: see Kibana `trace_charts_definition.ts`.

### Example: "Is service X healthy?"

1. Resolve service X and time range. Call **SLOs API** and **Alerting API**; run **ES|QL** on
   `traces*apm*,traces*otel*`/`metrics*apm*,metrics*otel*` for throughput, latency, error rate; query
   dependency/service-map data (ES|QL or Kibana repo).
2. Evaluate SLO status (violated/degrading?), firing rules, ML anomalies, and dependency health.
3. Answer: Healthy / Degraded / Unhealthy with reasons and next steps (e.g.
   [Observability Labs](https://www.elastic.co/observability-labs)).

### Example: "Why is service Y slow?"

1. Service Y and slowness time range. Call **SLOs API** and **Alerting API**; run **ES|QL** for Y and dependencies;
   query ML anomaly results.
2. Compare latency (avg/p95/p99) to prior period via ES|QL; from dependency data identify high-latency or failing deps.
3. Summarize (e.g. p99 up; dependency Z elevated) and recommend (investigate Z; Observability Labs for latency).

### Example: Correlate service to infrastructure (OpenTelemetry)

Use **resource attributes** on spans/traces to get the runtimes (pods, containers, hosts) for the service. Then check
CPU and memory for those resources in the same time window as the APM issue:

- From the service’s traces or metrics, read resource attributes such as `k8s.pod.name`, `k8s.namespace.name`,
  `container.id`, or `host.name`.
- Run **ES|QL** or Elasticsearch search on infrastructure/metrics indices filtered by those resource values and the
  incident time range. Check **CPU usage** and **memory consumption** (e.g. `system.cpu.total.norm.pct`); look for
  **OOMKilled** events, **CPU throttling**, or sustained high CPU/memory that align with APM latency or error spikes.

### Example: Filter logs by service or trace ID

To understand behavior for a specific service or a single trace, filter logs accordingly:

- **By service:** Run **ES|QL** or Elasticsearch search on log indices with `service.name == "<service_name>"` and time
  range to get application logs (errors, warnings, restarts) in the service context.
- **By trace ID:** When investigating a specific request, take the `trace.id` from the APM trace and filter logs by
  `trace.id == "<trace_id>"` (or equivalent field in your log schema). Logs with that trace ID show the full request
  path and help explain failures or latency.

## Guidelines

- Use **Observability APIs** ([SLOs API](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-slo),
  [Alerting API](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-alerting)) and **ES|QL** on
  `traces*apm*,traces*otel*`/`metrics*apm*,metrics*otel*` (8.11+ or Serverless), filtering by `service.name` (and
  `service.environment` when relevant). For active APM alerts, call
  `/api/alerting/rules/_find?search=apm&search_fields=tags&per_page=100&filter=alert.attributes.executionStatus.status:active`.
  When checking one service, evaluate both rule types: rules where `params.serviceName` matches the target service, and
  rules where `params.serviceName` is absent (all-services rules). Treat either as applicable to the service before
  declaring health. Do not query `.alerts*` indices when determining currently active alerts; use the Alerting API
  response above as the source of truth. For APM correlations, run the **apm-correlations** script (see
  [APM Correlations script](#apm-correlations-script)); for dependency/service-map data, use ES|QL or Kibana repo route
  handlers. For Elasticsearch index and search behavior, see the **Elasticsearch** APIs in the Elasticsearch repo.
- Always use the **user's time range**; avoid assuming "last 1 hour" if the issue is historical.
- When SLOs exist, anchor the health summary to SLO status and burn rate; when they do not, rely on alerts, anomalies,
  throughput, latency, error rate, and dependencies.
- When analyzing **only application metrics ingested via OpenTelemetry**, use the ES|QL **TS** (time series) command for
  efficient metrics queries. The TS command is available in **Elasticsearch 9.3+** and is **always available** in
  Elastic Observability Serverless.
- Summary: one short health verdict plus bullet points for evidence and next steps.
