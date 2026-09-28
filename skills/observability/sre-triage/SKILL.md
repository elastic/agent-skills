---
name: observability-sre-triage
description: >
  Triage a degraded or suspect service end to end: read SLO status and burn rate,
  check active alerting rules and ML anomalies, measure throughput, latency, and error
  rate, assess dependency health and infrastructure saturation, and funnel logs down
  to the failures that explain it. Use when someone asks whether a service is healthy,
  why it is slow or erroring, what is in its logs, or which attribute distinguishes
  the requests that are failing. Also use when someone asks for the query behind any
  of those signals — throughput, latency percentiles, error rate, dependency health,
  or log volume — over APM/OTel traces, metrics, or logs.
compatibility: >
  Requires the `elastic` CLI (>= 0.2) with Elasticsearch and Kibana contexts on the
  same cluster. Base floor is Elasticsearch 8.11+ or Serverless. Three ES|QL features
  need more, each with a fallback at its point of use: `FORK` (Stack GA 9.4), `CATEGORIZE`
  (Stack GA 9.1, Platinum licence) and `TS` (Stack GA 9.4); all are GA on Serverless.
  Reads APM/OTel traces, metrics and logs, the Kibana SLO and Alerting APIs, and the
  Elasticsearch ML APIs. Read-only.
metadata:
  author: elastic
  version: 0.5.1
  universal: true
---

# SRE Service Triage

Decide whether a service is healthy, degraded, or unhealthy, and say why. Triage is a hierarchy, not a checklist: SLOs
and alerts define whether the service is failing its contract, trace-derived golden signals describe how it is failing,
dependencies and infrastructure explain where the failure comes from, and logs supply the sentence you put in the
incident channel. Work down the hierarchy until the evidence supports a verdict, then stop.

For authoring and tuning SLO definitions, burn-rate rules, and alert thresholds, use the
**observability-service-reliability** skill. This skill only reads that state. For Kubernetes workload, node, or
control-plane diagnosis — restart loops, OOM kill confirmation, node pressure, admission rejections, stuck rollouts —
hand off to the **observability-k8s-investigation** skill. This skill checks whether a Kubernetes-hosted service is
saturated; it does not diagnose why the pod or the node behind it is failing.

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

Everything here is expressed in ES|QL (`POST /_query`) or the Kibana Observability APIs. Do not use Query DSL, and do
not use the ES|QL `KQL` search function — express predicates natively (`WHERE service.name == "checkout"`).

## Jobs to be done

- Answer "is service X healthy?" with a verdict and the evidence behind it
- Answer "why is service X slow / erroring / quiet?" by localizing the change to the service, a dependency, or its
  infrastructure
- Read SLO status, burn rate, and remaining error budget during an incident
- Determine which alerting rules currently apply to a service, including all-services rules
- Funnel a noisy log stream down to the failures that explain the degradation
- Identify which attribute (version, host, pod, region, route) distinguishes the failing or slow subpopulation
- Distinguish a healthy service from a service with no telemetry

## Output discipline

Applies to every response produced under this skill.

- **Commit to the best-supported conclusion.** When the evidence points one way, say so. Do not downgrade confidence to
  sound cautious — hedging on unambiguous evidence is a defect, not humility.
- **Commit to a verdict**: healthy, degraded, or unhealthy, followed by the reason. A triage answer that does not name
  one of the three has not done the job.
- **State confidence once**, in the conclusion. Do not restate it per bullet.
- **Do not speculate past the evidence.** If the telemetry did not show a cause, it does not go in the answer. Name what
  is unknown and stop. Never offer a mechanism ("probably a GC pause", "likely a noisy neighbor") that no signal
  measured.
- **Report absence as absence.** Zero rows means the data is missing or not collected; it never means the underlying
  condition is healthy. "No dependency metrics" is not "dependencies are fine".
- **Do not pad.** No restating the question, no narrating which queries were run unless the result mattered, no
  summarizing the summary.
- **End on the finding.** No trailing offers such as "want me to dig deeper?". Actionable follow-ups belong in a
  recommendations list, phrased as recommendations, not as questions.

## Signal hierarchy

Signals disagree constantly. This ordering decides which one wins.

| Rank | Signal                                | Authority                                                                                   |
| ---- | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1    | **SLO status and burn rate**          | Authoritative when SLOs exist. They encode the agreed definition of "good" for this service |
| 2    | **Active alerting rules**             | Authoritative when no SLO covers the symptom. Sourced from the Alerting API                 |
| 3    | **Error rate, latency, throughput**   | Describes the degradation. Decisive only when nothing above it exists                       |
| 4    | **Dependency health**                 | Locates the cause upstream or downstream; does not by itself set the verdict                |
| 5    | **ML anomalies**                      | Deviation from learned baseline, not from a target. Corroborates and time-bounds            |
| 6    | **Infrastructure (CPU, memory, OOM)** | Explains a mechanism. A saturated pod with healthy golden signals is a risk, not an outage  |
| 7    | **Logs**                              | Explain, never decide. Log volume is not health                                             |

Conflict rules:

- **SLO healthy, latency elevated** → degraded but within error budget. The verdict follows the SLO; report the trend as
  a risk with the burn rate.
- **SLO violated, current-window metrics look fine** → trust the SLO and check its window. SLOs are evaluated over hours
  or days; a 15-minute ES|QL window can look clean while the budget is already spent.
- **Alerts firing, no SLO defined** → the alerts are the verdict. Resolve each rule's `params` to confirm it actually
  targets this service before attributing it.
- **Logs noisy, golden signals flat** → not degraded. High log volume without an error-rate or latency change is a
  logging-configuration finding, not a health finding.
- **Throughput collapsed, error rate flat** → the caller stopped calling. Look upstream before blaming this service.
- **Any query returns zero rows** → missing data. Say which signal is unavailable and lower the scope of the verdict
  accordingly; never convert silence into health.

## Routing: symptom to first signal

| Presenting symptom                      | Pull first                                                           | Reference                                               |
| --------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| "Is X healthy?" / unclear               | SLO status, then active rules, then golden signals                   | [slo-and-alerts.md](references/slo-and-alerts.md)       |
| "X is slow"                             | Latency percentiles versus the prior period, then dependency latency | [apm-signals.md](references/apm-signals.md)             |
| "X is erroring" / 5xx                   | Error rate by route, then failed-transaction correlation             | [apm-signals.md](references/apm-signals.md)             |
| "X is down" / no traffic                | Throughput, then confirm the service still ingests at all            | [apm-signals.md](references/apm-signals.md)             |
| "Only some requests are bad"            | Subpopulation correlation over candidate attributes                  | [apm-signals.md](references/apm-signals.md)             |
| "An alert fired" / "the SLO is burning" | Rule `params` and SLO burn rate, then the metric the rule watches    | [slo-and-alerts.md](references/slo-and-alerts.md)       |
| "What is in the logs?" / noisy logs     | The log funnel — iterate with `NOT` exclusions                       | [log-investigation.md](references/log-investigation.md) |
| Suspected OOM, throttling, restarts     | Container CPU and memory limit utilization                           | [apm-signals.md](references/apm-signals.md)             |
| "Is it saturated?" on a non-K8s host    | Host CPU, memory, and load average from the hostmetrics receiver     | [apm-signals.md](references/apm-signals.md)             |
| "Which downstream is hurting X?"        | Per-destination call volume, latency, and failure rate               | [apm-signals.md](references/apm-signals.md)             |

## Data sources

OTel-native data streams, verified against Elasticsearch 9.6.0:

| Data                          | Index pattern                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Traces (spans, transactions)  | `traces-*.otel-*`; classic Elastic APM agent ingest also lands in `traces*apm*`                             |
| Logs                          | `logs-*.otel-*`                                                                                             |
| Raw metrics                   | `metrics-*.otel-*`; classic APM agent ingest also lands in `metrics*apm*`                                   |
| Service inventory (1m rollup) | `metrics-service_summary.1m.otel-*`                                                                         |
| Transaction rollups (1m)      | `metrics-service_transaction.1m.otel-*`, `metrics-transaction.1m.otel-*`                                    |
| Dependency rollups (1m)       | `metrics-service_destination.1m.otel-*`                                                                     |
| Kubernetes                    | `metrics-kubeletstatsreceiver.otel-*`, `metrics-k8sclusterreceiver.otel-*`, `logs-k8seventsreceiver.otel-*` |
| Host (VM, bare metal)         | `metrics-hostmetricsreceiver.otel-*`; the Elastic Agent system integration lands in `metrics-system.*`      |

`service.name` is populated on traces, metrics, and logs, so it is the join key across all three. Use flat OTel field
paths in ES|QL (`k8s.pod.name`, not `resource.attributes.k8s.pod.name`). When analyzing OTel application metrics, the
ES|QL `TS` (time series) command gives more efficient metric queries. It is GA on Serverless; on Stack it is preview in
9.2 and GA in 9.4, so below 9.4 use `FROM` with `BUCKET` instead. `TS` also rejects `COUNT(*)` — count a field instead.

The recipes in this skill and its references are written against the OTel-native streams above. A service instrumented
with the classic Elastic APM agent ships to `traces-apm*` and `metrics-apm*` under different field names
(`transaction.duration.us`, `event.outcome`), so these recipes return no rows for it. An empty result on a service that
is otherwise clearly alive is therefore a scope boundary, not evidence of an outage: check which index family the
service actually writes (`GET /_cat/indices`) and report the ingest path rather than concluding from silence.

## ES|QL feature availability

Three features this skill uses are newer than its 8.11 base floor. Check `GET /` before relying on them:
`build_flavor: "serverless"` means all three are available; otherwise compare `version.number` against the Stack column.
Never report "no data" when the real answer is that the query did not run — say which feature was unavailable and use
the fallback.

| Feature      | Serverless | Stack                    | Licence      | Used by                                          | Fallback                                                                  |
| ------------ | ---------- | ------------------------ | ------------ | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `FORK`       | GA         | preview 9.1-9.3, GA 9.4+ | any          | The log funnel, and the subpopulation comparison | Run each branch as a separate query and combine the results yourself      |
| `CATEGORIZE` | GA         | preview 9.0, GA 9.1      | **Platinum** | Message categorization inside the log funnel     | Group by a truncated message prefix, or funnel on structured error fields |
| `TS`         | GA         | preview 9.2, GA 9.4      | any          | OTel application metric queries                  | `FROM` with `BUCKET` over the same data stream                            |

The Platinum requirement on `CATEGORIZE` is not a version check. A 9.6 Stack cluster on a Basic or Gold licence fails it
exactly as an 8.11 cluster fails `FORK`, and the error names the licence rather than the syntax. On Serverless the
function is GA with no separate licence gate.

## Process: triage a degraded service

1. **Fix the service and the window.** Resolve the service name and the time range from the request. Use the user's time
   range — do not silently assume the last hour when the complaint is historical. If no range is given, use the last
   hour and say so. Confirm the service actually exists in telemetry with a `COUNT(*) BY service.name` over
   `traces-*.otel-*` via `POST /_query`; if the name does not appear, resolve the ambiguity before querying further.

   Decision: which service and window every later query is scoped to. Data: distinct `service.name` values in range.

2. **Read SLO status and burn rate.** List SLOs with `GET kbn:/api/observability/slos` and fetch the ones bound to this
   service with `GET kbn:/api/observability/slos/{id}`. Read status, current SLI, burn rate, and remaining error budget.

   Decision: does an agreed contract exist, and is it being violated? If yes, the verdict is already determined and the
   remaining steps only explain it. If no SLO covers this service, say so once and fall through to step 3.

3. **Determine which alerting rules apply to this service, and which of them are firing.** Call
   `GET kbn:/api/alerting/rules/_find` with `per_page=100&filter=alert.attributes.enabled:true`, paging with `page` if
   `total` exceeds what you received. Then filter the response **client-side**. **Do not query `.alerts*` indices to
   determine active state** — the Alerting API response is the source of truth. Fetch a rule's full definition with
   `GET kbn:/api/alerting/rule/{id}` when its `params` are needed.

   **Do not narrow this call server-side.** The `_find` `filter` parameter is KQL over saved-object _attributes_, and
   `params` is not among them — `filter=alert.attributes.params.serviceName:<name>` returns zero rules on a cluster that
   has them. Narrowing by `search=apm&search_fields=tags`, by `alertTypeId`, or by `consumer` is worse: it drops rules
   on a naming convention or a rule-type allowlist, and the rules it drops are disproportionately the all-services ones.
   See [references/slo-and-alerts.md](references/slo-and-alerts.md) for the measured failure.

   From the fetched set, evaluate **both** rules whose `params.serviceName` matches the service **and** rules where
   `params.serviceName` is absent, because the latter are all-services rules that apply to it too. Read
   `execution_status.status` on each: `active` means the rule's last run produced alerts, `ok` means it ran and produced
   none, and `error` means it is not evaluating at all — a blind spot, not a pass.

   Decision: what covers this service, and is any of it currently firing? Data: rule `params.serviceName`, rule type,
   and execution status.

4. **Check ML anomalies, if any jobs exist.** List jobs with `GET /_ml/anomaly_detectors` and confirm they are running
   with `GET /_ml/anomaly_detectors/_stats` — a stopped job produces no anomalies, which is not the same as no anomaly.
   Pull scored records with `GET /_ml/anomaly_detectors/{id}/results/records`.

   Decision: did latency, throughput, or error rate deviate from its learned baseline, and when? Use the anomaly window
   to narrow steps 5 and 6.

5. **Measure the golden signals.** Run ES|QL over `traces-*.otel-*` for throughput, latency (avg, p95, p99), and error
   rate, bucketed over the window and compared against the immediately preceding window of equal length. See
   [references/apm-signals.md](references/apm-signals.md).

   Decision: is the service actually changed relative to itself, and in which dimension? Data: request count, latency
   percentiles, and failure ratio for the current and prior windows.

6. **Localize: dependencies, then subpopulation, then infrastructure.**
   - **Dependencies** — aggregate `metrics-service_destination.1m.otel-*` by `span.destination.service.resource` for
     call volume, average latency, and failure rate. If this query returns zero rows for the service, the service is
     **not APM-instrumented for dependencies**; report insufficient dependency data and do not claim upstreams are
     healthy.
   - **Subpopulation** — when only part of the traffic is bad, compare the failure or slow rate per candidate attribute
     against the overall rate to find which attribute is over-represented. See
     [references/apm-signals.md](references/apm-signals.md).
   - **Infrastructure** — read the resource attributes on the service's spans (`k8s.pod.name`, `container.id`,
     `host.name`) first, then branch on what they contain. Pod and namespace attributes mean the service is
     Kubernetes-hosted: check `k8s.container.cpu_limit_utilization` and `k8s.container.memory_limit_utilization` in
     `metrics-kubeletstatsreceiver.otel-*`. A `host.name` with no pod attributes means the service runs on a VM or bare
     host, where every `k8s.*` field is empty: check `system.cpu.utilization`, `system.memory.utilization`, and
     `system.cpu.load_average.1m` in `metrics-hostmetricsreceiver.otel-*` instead. OOM kills, CPU throttling, and host
     saturation degrade APM health directly. See [references/apm-signals.md](references/apm-signals.md).
   - **Recent change** — a deploy is the most common cause of a step change. Search deploy annotations for the service
     with `GET kbn:/api/apm/services/{serviceName}/annotation/search` over the incident window, and compare the failure
     or latency rate by `service.version` in the subpopulation query. An annotation inside the onset window is a strong
     correlation; confirm it plausibly explains the symptom before attributing.

   Decision: is the cause inside this service, in something it calls, in one slice of its instances, under it, or in a
   change that landed?

   When the Kubernetes branch shows saturation, restarts, or an OOM kill, the mechanism is established and the remaining
   diagnosis — why the pod is being killed, whether the node is under pressure, whether a rollout is stuck — belongs to
   the **observability-k8s-investigation** skill. Hand off rather than continuing here.

7. **Explain with logs.** Scope logs by `service.name`, or by `trace.id` when a specific failing trace is in hand, and
   run the funnel until the remaining set is small enough to read. See
   [references/log-investigation.md](references/log-investigation.md). Logs confirm and articulate the cause; they do
   not overturn steps 2 and 3.

8. **State the verdict.** Healthy, degraded, or unhealthy, with the reason and one statement of confidence, followed by
   recommendations. Name any signal that was unavailable.

## Examples

**"Is checkout healthy?"** — resolve the window, read its SLOs, then the active rules including all-services rules, then
throughput, latency percentiles, and error rate over `traces-*.otel-*` against the prior window. If the availability SLO
is at 99.2% against a 99.5% target with a burn rate above 1, the verdict is unhealthy on SLO violation, and the golden
signals are the explanation, not the verdict.

**"Why is the frontend slow?"** — compare p95 and p99 for the current window against the previous window of equal
length. If service-level latency rose while per-destination latency in `metrics-service_destination.1m.otel-*` is flat,
the added time is inside the service; if one destination's average response time rose in step with it, the dependency is
the cause and the frontend is a victim.

**"Only some checkout requests fail"** — run the subpopulation comparison: failure rate grouped by `service.version`,
`k8s.pod.name`, `host.name`, and `cloud.region` alongside the overall failure rate. An attribute value whose failure
rate is several times the overall rate, on a volume large enough to matter, is the correlated attribute. On live data,
grouping frontend server spans by route showed a 3.8% slow rate for `POST` against a 0.9% overall rate — a 4x lift that
localizes the problem to write paths.

**"The cart service logs look bad"** — run the funnel over `logs-*.otel-*` scoped to `service.name == "cart"`: get
trend, total, samples, and message categorization in one `FORK`, then add `NOT ... LIKE` exclusions for each dominant
pattern and re-run with the full accumulated filter until fewer than 20 patterns remain. High log volume alone is not a
health verdict — check the golden signals before calling the service degraded.

**"Is the payment service's upstream healthy?"** — query `metrics-service_destination.1m.otel-*` for it. Zero rows means
the service does not emit dependency metrics. Report that dependency data is unavailable for this service and give the
verdict from the signals that do exist; do not report the upstreams as healthy.

**"An alert fired on api-gateway"** — fetch the enabled rules with no server-side narrowing, then match in memory on
`params.serviceName == "api-gateway"` **and** on rules with no `params.serviceName`, reading `execution_status.status`
to see which are firing. Read the firing rule's threshold from `GET kbn:/api/alerting/rule/{id}`, then query the same
metric over the same window in ES|QL to confirm the rule is describing a real change rather than a threshold that is set
too tight.

## Guidelines

- Work the signal hierarchy in order and stop when the evidence supports a verdict. Do not run every query in this
  document on every request.
- Anchor to SLO status and burn rate when SLOs exist. When they do not, fall back to alerts, ML anomalies, throughput,
  latency, error rate, dependencies, infrastructure, and logs — and say that no SLO covers the service.
- Use the Alerting API for active-alert state. **Never** query `.alerts*` indices for it. Always evaluate both
  service-scoped rules and rules with no `params.serviceName`.
- Fetch alerting rules unnarrowed and filter client-side. `_find` cannot filter on `params`, tag search drops rules that
  do not follow a naming convention, and `executionStatus.status:active` returns only rules that are firing right now —
  each of those silently hides the all-services rules the bullet above requires.
- Always use the user's time range. Compare every metric against the immediately preceding window of equal length —
  absolute numbers without a baseline do not support a verdict.
- Zero rows is missing data. Say which signal is unavailable rather than treating silence as a pass.
- Scope every query by `service.name` and a bounded `@timestamp` range, and cap output with `LIMIT`. Prefer coarse
  buckets when only a trend is needed.
- Prefer `event.outcome == "failure"` for failed spans; `status.code == "Error"` is equivalent on OTel traces but is
  null on successes, so it cannot be counted directly.
- Filter server-side traffic with `kind == "Server"` when measuring a service's own throughput and latency, so client
  spans do not double-count.
- Treat `log.level` and `severity_text` as hints, never as filters you rely on. On real OTel data most log records carry
  no level at all and those that do disagree on case and vocabulary (`INFO`, `Information`, `SEVERE`, `Normal`). In
  particular **never write `log.level == "error"`** — the lowercase ECS vocabulary is not what the OTel SDKs emit, so it
  returns zero rows with no error even on a service that is logging errors, and reports the service healthy. Use the
  normalized numeric `severity_number >= 17` if you need a severity predicate at all.
- Logs explain; they do not decide. Never issue a verdict whose only support is log content.
- Do not invent field names. If a field might not exist in this deployment, confirm the data stream exists with
  `GET /_resolve/index/{pattern}` before building on it.
- Establish where the service runs before checking saturation. Kubernetes and host telemetry share no field names, so a
  Kubernetes query against a VM-hosted service returns zero rows and says nothing about whether it is saturated.
- Pass `--drop-null-columns` on `POST /_query` when a result is mostly empty columns. Infrastructure metrics are sparse
  by nature — limit utilization is absent wherever no limit is declared — and the flag collapses the noise while listing
  the suppressed column names under `all_columns`, so nothing is hidden.

## Operations

| HTTP API (shorthand)                                        | `elastic` CLI command                                                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                                                     | `elastic es info`                                                                                                                  |
| `POST /_query`                                              | `elastic es esql query --format tsv --query '<esql>'`                                                                              |
| `GET /_resolve/index/{pattern}`                             | `elastic es indices resolve-index --name '<pattern>'`                                                                              |
| `GET /_ml/anomaly_detectors`                                | `elastic es ml get-jobs`                                                                                                           |
| `GET /_ml/anomaly_detectors/_stats`                         | `elastic es ml get-job-stats`                                                                                                      |
| `GET /_ml/anomaly_detectors/{id}/results/records`           | `elastic es ml get-records --job-id '<id>'`                                                                                        |
| `GET kbn:/api/observability/slos`                           | `elastic kb slo find-slos-op --space-id '<space>' --kql-query '<kql>'`                                                             |
| `GET kbn:/api/observability/slos/{id}`                      | `elastic kb slo get-slo-op --space-id '<space>' --slo-id '<id>'`                                                                   |
| `GET kbn:/api/alerting/rules/_find`                         | `elastic kb alerting get-alerting-rules-find --filter '<filter>'`                                                                  |
| `GET kbn:/api/alerting/rule/{id}`                           | `elastic kb alerting get-alerting-rule-id --id '<id>'`                                                                             |
| `GET kbn:/api/apm/services/{serviceName}/annotation/search` | `elastic kb apm-annotations get-annotation --service-name '<service>' --environment '<env>' --start '<iso8601>' --end '<iso8601>'` |

The SLO find command takes a KQL query string because that is the API's contract; it is not an exception to the ES|QL
rule for data queries.

The annotation search route rejects a request that omits `environment`, so pass `ENVIRONMENT_ALL` when the service's
environment is not known. Only the search direction is in scope: this skill is read-only, so the companion
create-annotation operation is deliberately not bound.
