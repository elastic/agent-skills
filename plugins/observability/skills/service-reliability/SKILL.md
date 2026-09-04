---
name: observability-service-reliability
description: >
  Design and operate service reliability targets in Elastic Observability: choose
  an SLI type and a defensible target, pick a time window and budgeting method, create
  and maintain SLOs through the Kibana API, attach burn-rate alert rules, and decide
  when an SLO is the wrong instrument and a threshold rule, anomaly job, or synthetics
  monitor is right. Use when defining or reviewing SLOs and error budgets, tuning
  burn-rate alerting, reducing alert noise, or setting up availability monitoring
  for a user-facing endpoint.
compatibility: >
  Requires Kibana 8.x or 9.x with a matching Elasticsearch cluster (self-managed,
  Elastic Cloud Hosted, or Serverless) and the Observability solution enabled. The
  cluster must have nodes carrying both the `transform` and `ingest` roles, since
  every SLO is backed by a continuous transform. Needs the `elastic` CLI >= 0.2 with
  `stack kb` and `stack es` support. Synthetics SLIs additionally require the Synthetics
  app and at least one configured monitor location.
metadata:
  author: elastic
  version: 0.4.1
  universal: true
---

# Service Reliability

Design reliability targets that people will actually act on, then operate them. This skill covers the judgment before
the API call — which service-level indicator fits the data you have, what target is achievable rather than aspirational,
whether an SLO is even the right instrument — and then the mechanics of creating, alerting on, resetting, and retiring
SLOs through the Kibana API.

Reliability instruments are not interchangeable. An SLO measures a user-visible outcome against a spendable budget; a
threshold rule fires on a raw condition; an anomaly job finds deviations where no fixed threshold exists; a synthetics
monitor is the only one of the four that can see a service that has stopped emitting telemetry entirely. Choosing wrong
produces alerts that are technically correct and operationally useless. For diagnosing a service that is already
degraded, and for the incident workflow itself, use the **observability-sre-triage** skill; for general rule lifecycle
mechanics use the **kibana-alerting-rules** skill.

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

SLO and alerting operations run against Kibana and use the `kbn:` prefix (for example,
`POST kbn:/api/observability/slos`); data validation runs against Elasticsearch with a bare path (for example,
`POST /_query`). Kibana SLO commands are space-scoped — pass the space explicitly. For non-default spaces the HTTP path
becomes `kbn:/s/<space_id>/api/observability/slos`.

Full request-body schemas for every SLI type live in [references/slo-api-schemas.md](references/slo-api-schemas.md), the
burn-rate rule schema in [references/burn-rate-rules.md](references/burn-rate-rules.md), and curated official
documentation in [references/documentation.md](references/documentation.md).

## Jobs to be done

- Translate a reliability concern into the right instrument: SLO, burn-rate rule, threshold rule, anomaly job, or
  synthetics monitor
- Choose an SLI type for a given service and data shape, and validate the underlying fields before committing
- Set a target, time window, and budgeting method that are defensible against measured history
- Decide whether to group an SLO, and refuse high-cardinality grouping
- Create, verify, update, reset, disable, and delete SLOs
- Attach burn-rate alert rules with fast-burn and slow-burn windows routed to different severities
- Keep the alerting surface signal-dense: remove duplicate coverage, snooze instead of disable, delete unactionable
  rules
- Monitor availability of user-facing endpoints with synthetics and feed that into an availability SLI

## Output discipline

Applies to every response produced under this skill.

- **Commit to the best-supported conclusion.** Recommend one SLI design and defend it. Do not enumerate every SLI type
  with equal weight and leave the choice to the user — that is not a recommendation, it is a menu.
- **State the target and window you chose, and why, once.** Do not restate the justification per bullet.
- **Do not invent field names.** Verify every field against the mapping before writing it into an indicator. If a field
  cannot be confirmed, say so and stop; a plausible-looking field name is worse than an admitted gap.
- **Do not speculate past the evidence.** If the measured history does not support a target, say what it does support.
- **Report absence as absence.** Zero events means the data is missing or the service is not emitting; it never means
  the service is healthy. An SLI ratio computed over zero total events is undefined, not 100%.
- **Do not pad.** No restating the question, no narrating which queries were run unless the result mattered.
- **End on the finding.** No trailing offers such as "want me to set this up?". Actionable follow-ups belong in a
  recommendations list, phrased as recommendations, not as questions.

## Process: route the reliability concern to an instrument

Do this before designing anything. Most bad SLOs are threshold rules wearing a costume.

1. **Name the user-visible symptom.** Ask what a user or downstream consumer would notice and complain about. If the
   answer is a resource number rather than an experience — disk at 90%, heap climbing, replica lag — the concern is a
   capacity ceiling, not a reliability target. Route it to a threshold rule.

2. **Check whether coverage already exists.** List SLOs with `GET kbn:/api/observability/slos`, alerting rules with
   `GET kbn:/api/alerting/rules/_find`, and anomaly jobs with `GET /_ml/anomaly_detectors`. Adding a second instrument
   on a signal that is already covered is the most common source of duplicate pages.

3. **Pick the instrument.**

   | Concern                                                                      | Instrument               | Why, and what it costs                                                                                                                                                      |
   | ---------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | A user-visible success or latency outcome you want to budget over weeks      | SLO + burn-rate rule     | Gives a spendable budget and history, and paces change velocity. Costs a transform, needs steady traffic, and is deliberately slow — even fast-burn uses a one-hour window. |
   | A hard bound with a known safe value and an immediate operator action        | Threshold or custom rule | Fires within one schedule interval, no transform. But it has no budget and no memory, so it re-fires for as long as the condition holds.                                    |
   | A signal with no fixed threshold, strong seasonality, or many entities       | Anomaly detection job    | Finds unknown-unknowns and adapts to seasonality. Needs weeks of history to be trustworthy and emits scores, not outcomes, so it is a poor pager.                           |
   | Reachability of a user-facing endpoint from outside your own telemetry       | Synthetics monitor       | The only instrument that detects a total outage. Costs a check budget (see the synthetics section) and cannot explain an internal partial failure.                          |
   | An internal job with no consumer contract, or a service still changing daily | None                     | An SLO with no owner and no stable baseline becomes permanently red and is then ignored, which is worse than no SLO.                                                        |

4. **Do not skip the outage case.** An SLI built from a service's own logs or traces cannot see the service disappear:
   with zero events there is no `total`, so the ratio is undefined and the SLO neither burns nor recovers. Pair every
   request-based SLO on a user-facing service with either a synthetics availability monitor or a no-data threshold rule.
   This is the one place where two instruments on one signal is correct rather than duplicative.

## Process: design the SLO

1. **Locate the data and confirm the fields exist.** Resolve the index pattern with `GET /_resolve/index/<pattern>`,
   then confirm every field the indicator will reference with `GET /<index>/_mapping` or `GET /_field_caps`. OTel-native
   data lives in `traces-*.otel-*`, `metrics-*.otel-*`, and `logs-*.otel-*`, with `service.name` populated on all three;
   APM aggregate metrics live in `metrics-service_summary.1m.otel-*`, `metrics-service_transaction.1m.otel-*`,
   `metrics-transaction.1m.otel-*`, and `metrics-service_destination.1m.otel-*`. Do not assume a status-code, duration,
   or outcome field exists because it is conventional — confirm it. A wrong field name produces an SLO that computes
   cleanly and means nothing; [How a missing field fails](#how-a-missing-field-fails) shows exactly how.

   Two field placements are worth knowing because they are commonly guessed wrong: `http.response.status_code` is on
   `traces-*.otel-*` and not on `logs-*.otel-*`, and `transaction.duration.us` is on `traces-*.otel-*` and not on the
   `metrics-*.1m.otel-*` rollups, which carry `transaction.duration.histogram` and `transaction.duration.summary`
   instead. Confirm both against the deployment in front of you rather than trusting this list.

2. **Validate the SLI with ES|QL before creating anything.** Run the good/total ratio over recent history with
   `POST /_query` so you know the measured baseline. This query is exploratory and is written in ES|QL, not KQL:

   ```esql
   FROM traces-*.otel-*
   | WHERE service.name == "cart" AND kind == "Server" AND @timestamp >= NOW() - 30 day
   | STATS total = COUNT(*), good = COUNT(*) WHERE http.response.status_code < 500
   | EVAL achieved = good::DOUBLE / total
   ```

   Against an OTel demo cluster this returns `total: 1393887`, `good: 1393887`, `achieved: 1.0`. That is the measured
   input to step 4, not a target to copy — a clean 30 days argues for a target below 100%, not at it.

   **HTTP status lives on traces, not on logs.** `http.response.status_code` is populated on `traces-*.otel-*`. OTel log
   records do not carry an HTTP status, so the field does not exist in `logs-*.otel-*` at all, and its coverage on
   traces is per-service: only spans emitted by an HTTP server carry it. Filtering `kind == "Server"` keeps the
   service's own inbound requests and drops the client spans that report the status of calls it made to others. Confirm
   coverage for the specific service before building an indicator on it:

   ```esql
   FROM traces-*.otel-*
   | WHERE service.name == "cart" AND kind == "Server" AND @timestamp >= NOW() - 24 hour
   | STATS spans = COUNT(*), with_status = COUNT(http.response.status_code)
   ```

   On the same cluster `cart` returns `spans: 46420, with_status: 46420`, while `checkout` — a gRPC service — returns
   `spans: 4887, with_status: 0`. When `with_status` is 0 there is no HTTP status to budget. Use
   `sli.apm.transactionErrorRate`, or build the ratio on `event.outcome`, which is populated on every OTel span
   regardless of protocol:

   ```esql
   FROM traces-*.otel-*
   | WHERE service.name == "checkout" AND kind == "Server" AND @timestamp >= NOW() - 30 day
   | STATS total = COUNT(*), good = COUNT(*) WHERE event.outcome == "success"
   | EVAL achieved = good::DOUBLE / total
   ```

   That returns `total: 147009`, `good: 146996`, `achieved: 0.9999`. Write `good` in the positive form (`== "success"`),
   not as a negation of `"failure"` — a null outcome must not count as good.

   This split is not specific to Serverless or to one demo application. The same measurement across every service on a
   Stack 9.4.4 cluster, over `traces-*.otel-*` with `kind == "Server"`:

   | Service         | Server spans | `http.response.status_code` coverage | `event.outcome` coverage |
   | --------------- | ------------ | ------------------------------------ | ------------------------ |
   | catalog         | 49,271       | 0%                                   | 100%                     |
   | gateway         | 37,773       | 100%                                 | 100%                     |
   | orders          | 37,754       | 100%                                 | 100%                     |
   | payments        | 34,710       | 100%                                 | 100%                     |
   | recommendations | 34,692       | 0%                                   | 100%                     |
   | shipping        | 34,531       | 100%                                 | 100%                     |

   Two of six services have no HTTP status at all while every one of the six has `event.outcome` on every span. An
   availability SLO built on `http.response.status_code < 500` for `catalog` would compute `good: 0` against
   `total: 49271` — an achieved SLI of 0%, a fully consumed error budget, and a burn-rate rule that pages continuously
   against a healthy service. Nothing in the API response or the SLO UI flags this; the numerator is simply always zero.
   Run the coverage check above for the specific service every time, and prefer `event.outcome` when you are writing one
   indicator to cover several services.

   Never substitute a plausible-looking status field for a missing one — see
   [How a missing field fails](#how-a-missing-field-fails) for what that costs.

   Also check that traffic is thick enough for a ratio to be meaningful. If the thinnest buckets carry only a handful of
   events, a single failure swings the SLI by whole percentage points and the SLO will be noise:

   ```esql
   FROM traces-*.otel-*
   | WHERE service.name == "cart" AND kind == "Server" AND @timestamp >= NOW() - 7 day
   | STATS events = COUNT(*) BY bucket = BUCKET(@timestamp, 1 hour)
   | SORT events ASC
   | LIMIT 10
   ```

   Bound this one explicitly. Without a `@timestamp` predicate it buckets the entire retention of the trace data
   streams, which is cheap on a demo cluster and expensive on a customer's.

3. **Choose the SLI type from the data shape, not from preference.**

   | SLI type                       | Use when                                                                            |
   | ------------------------------ | ----------------------------------------------------------------------------------- |
   | `sli.kql.custom`               | Raw logs or documents where good and total are expressible as filters over events   |
   | `sli.metric.custom`            | Pre-aggregated metric fields where good and total are equations over sums or counts |
   | `sli.metric.timeslice`         | A metric compared against a threshold per slice, such as a p95 latency ceiling      |
   | `sli.histogram.custom`         | Histogram fields, using a range for good and a value count for total                |
   | `sli.apm.transactionDuration`  | APM transaction latency against a millisecond threshold                             |
   | `sli.apm.transactionErrorRate` | APM transaction success rate                                                        |
   | `sli.synthetics.availability`  | Synthetics monitor uptime for a user-facing endpoint                                |

   Prefer an APM or synthetics type when it fits: they encode the service, environment, and transaction dimensions for
   you and stay correct when the underlying index layout changes. Reach for `sli.kql.custom` when the outcome is only
   visible in raw events, and for `sli.metric.custom` when the service already emits its own counters.

4. **Set a target you can meet.** Take the measured baseline from step 2 and set the target at or just below it, then
   ratchet upward once the service earns it. A target above the measured baseline burns the entire budget on day one,
   the SLO stays red permanently, and the team stops looking at it. `objective.target` is a decimal between 0 and 1 —
   `0.995`, not `99.5`. Sanity-check the target against the budget it implies over 30 days:

   | Target | Error budget over 30 days |
   | ------ | ------------------------- |
   | 99%    | 7h 12m                    |
   | 99.5%  | 3h 36m                    |
   | 99.9%  | 43m 12s                   |
   | 99.95% | 21m 36s                   |
   | 99.99% | 4m 19s                    |

   If a single rolling deploy, a node restart, or one dependency blip costs more than the whole budget, the target is
   unachievable and should be rejected, not accepted with a caveat.

5. **Choose the time window.** `timeWindow.type` is `rolling` (`7d`, `30d`, `90d`) or `calendarAligned` (`1w`, `1M`).
   Rolling windows move continuously, so budget recovers gradually and burn-rate alerting stays meaningful — this is the
   default for anything operational. Calendar-aligned windows reset at the period boundary, which matches contractual or
   monthly-reporting language but produces a budget cliff on the first of the month. Use rolling for paging, and add a
   calendar-aligned SLO alongside it only when someone genuinely reports on calendar periods.

6. **Choose the budgeting method.** `occurrences` divides good events by total events across the whole window, so a
   high-traffic hour dominates and a quiet overnight outage barely registers. `timeslices` chops the window into slices,
   marks each slice good or bad against `objective.timesliceTarget`, and divides good slices by total slices, so every
   period counts equally. Choose `timeslices` when low-traffic periods matter or when the indicator is a threshold on an
   aggregate rather than a countable good/total. **`sli.metric.timeslice` requires `budgetingMethod: "timeslices"`** —
   the pairing is not optional, and `objective.timesliceTarget` and `objective.timesliceWindow` become required.

7. **Decide grouping deliberately.** `groupBy` creates one independent SLO instance per unique value, each with its own
   transform buckets and its own alerts. Measure the cardinality before setting it:

   ```esql
   FROM traces-*.otel-*
   | WHERE @timestamp >= NOW() - 24 hour
   | STATS instances = COUNT_DISTINCT(service.name)
   ```

   Keep the `@timestamp` bound. A cardinality aggregation with no time predicate runs over the whole retention of the
   trace data streams; a recent window answers the same question at a fraction of the cost.

   Cardinality is not the only check — the dimension also has to be **populated**. `groupBy` on a field that is mapped
   but null produces one degenerate instance covering everything, which looks like a working grouped SLO and is not.
   Confirm with `COUNT(<field>)` alongside `COUNT(*)` before setting it.

   Group on stable, bounded dimensions such as `service.name`, `service.environment`, or `k8s.namespace.name`. Refuse
   high-cardinality fields — `trace.id`, `url.full`, `user.id`, and churning identifiers like `k8s.pod.name` — and say
   why rather than creating the SLO and warning afterward. If per-entity visibility is genuinely needed on a wide
   dimension, filter to the entities that matter instead of grouping across all of them. **Synthetics SLOs are
   auto-grouped by monitor and location; do not set `groupBy` manually.**

8. **Create and verify.** Build the body per [references/slo-api-schemas.md](references/slo-api-schemas.md) and
   `POST kbn:/api/observability/slos`. Then read it back with `GET kbn:/api/observability/slos/{id}` and confirm it is
   computing before reporting success — a created SLO whose transform has not started yet returns no summary data.

## KQL is an API contract here, not a style choice

ES|QL is the query language for Observability, and every exploratory query you run to validate an SLI — baselines,
cardinality checks, traffic distribution — must be ES|QL against `POST /_query`.

The exception is inside the SLO request body. The `good`, `total`, and `filter` fields of `sli.kql.custom` (and the
`filter` fields of the other indicator types, plus the `--kql-query` parameter on SLO search) are **KQL strings, because
the SLO API defines them that way**. There is no ES|QL form of those fields. Write KQL there, and only there:

```json
{
  "type": "sli.kql.custom",
  "params": {
    "index": "traces-*.otel-*",
    "filter": "service.name : \"cart\" and kind : \"Server\"",
    "good": "http.response.status_code < 500",
    "total": "*",
    "timestampField": "@timestamp"
  }
}
```

Do not translate these fields to ES|QL — the API will reject or silently mis-parse them. Do not translate exploratory
queries to KQL either.

## How a missing field fails

The reason step 1 insists on confirming the field is that the two dialects fail in opposite ways, and the dangerous one
is the dialect that ends up in the SLO.

The exploratory ES|QL query fails loudly. Pointing the step 2 query at `logs-*.otel-*`, where
`http.response.status_code` does not exist, returns HTTP 400:

```text
line 3:49: Unknown column [http.response.status_code]
```

**The KQL in the indicator body does not fail at all.** KQL compiles a numeric comparison on an unmapped field to a
range query that matches nothing, and the SLO API accepts the definition without complaint. Over the same one-hour
window on a cluster holding 101,920,257 documents in `logs-*.otel-*`, the `good` clause matched **0** documents while
`total: "*"` matched **93,847**. The SLO computes cleanly, reports an SLI of 0% against its target, and burns the entire
error budget on the first transform run. Attach the burn-rate rule from the next section and the fast-burn window pages
continuously on an indicator that measures nothing.

Do not try to sanity-check the field with a Lucene `query_string` instead. The same predicate as Lucene returns 3,250
matches on that cluster — not because the field exists, but because Lucene tokenizes the expression and full-text
matches the fragments against the default fields. A non-zero count from Lucene is not evidence that a field is mapped.

Confirm with `GET /_field_caps` or `GET /<index>/_mapping`, which answer the question directly, and with a
`COUNT(<field>)` in ES|QL, which additionally tells you whether a mapped field is actually populated.

## Process: alert on the SLO without adding noise

Creating an SLO does not create any alerting. **Burn-rate rules are never auto-created by the SLO API** and must be set
up separately with `POST kbn:/api/alerting/rule/{id}`, rule type `slo.rules.burnRate`.

1. **Use multiple windows with different severities.** A burn rate of 1 means the budget is being spent exactly fast
   enough to exhaust at the end of the window. Fast-burn windows (roughly 14x over a one-hour long window with a
   five-minute short window) catch outages and are worth paging on. Slow-burn windows (roughly 1x-3x over 24 to 72
   hours) catch chronic degradation and belong in a ticket queue. Routing all windows to the same paging connector is
   the single fastest way to make the SLO ignored. Window values and action groups are in
   [references/burn-rate-rules.md](references/burn-rate-rules.md).

2. **Keep the short window.** Each window pairs a long window (does the burn rate justify alerting) with a short window
   (is it still happening). The short window is what lets a resolved incident stop alerting on its own instead of
   requiring someone to mute it.

3. **Remove duplicate coverage.** If a burn-rate rule and a raw threshold rule both watch the same signal, one incident
   produces two pages. Find the overlap with `GET kbn:/api/alerting/rules/_find` before adding anything. Keep the
   burn-rate rule as the pager and demote or delete the raw threshold — unless the threshold covers the no-data case the
   SLO structurally cannot see, which is a real gap and should stay.

4. **Snooze, do not disable.** For a bounded pause on one rule use `POST kbn:/api/alerting/rule/{id}/_snooze_schedule`;
   for planned change affecting many rules use a maintenance window via `POST kbn:/api/maintenance_window`. Both expire
   on their own. Disabling a rule loses its alert history and depends on someone remembering to re-enable it, so reserve
   `POST kbn:/api/alerting/rule/{id}/_disable` for rules that are wrong rather than rules that are temporarily
   inconvenient.

5. **Apply the actionability test.** A rule that fires correctly but has no action the responder can take is a defect,
   not a success. For each rule, name the first step the on-call would take. If the honest answer is "look at it later",
   it is not a page — move it to a slow-burn window or a ticket, or delete it.

## Process: monitor availability with synthetics

A synthetics monitor probes an endpoint on a schedule from one or more locations and writes results to `synthetics-*`.
It is the instrument that answers "is it up from the outside", which telemetry emitted by the service itself can never
answer. Manage monitors with `GET kbn:/api/synthetics/monitors` and `POST kbn:/api/synthetics/monitors`.

1. **Budget the checks before choosing a target.** Availability is measured in checks, not requests, so the check
   frequency sets the resolution of the SLI. A ten-minute frequency over 30 days is 4,320 checks; at a 99.99% target the
   entire error budget is under half a check, so one transient failure exhausts it. Require the budget to be worth at
   least ten checks — raise the frequency or lower the target until it is.

2. **Use at least three locations.** A single-location monitor cannot distinguish a down service from a bad network path
   out of one region. Three or more makes that call obvious and removes a whole class of false pages.

3. **Feed it into an SLI.** Create the SLO with `sli.synthetics.availability`, scoped by monitor ids, projects, or tags.
   Leave `groupBy` unset; the indicator already produces one instance per monitor and location.

## Process: operate and repair

- **Update carefully.** `PUT kbn:/api/observability/slos/{id}` **resets the underlying transform and recomputes
  history** from scratch. Changing the target or the indicator therefore discards the existing budget picture. Say so
  before doing it, and prefer creating a second SLO when the old history still matters.
- **Reset when stuck.** `POST kbn:/api/observability/slos/{id}/_reset` rebuilds the transform and rollup data. Use it
  when an SLO stops updating, after index mapping changes, or after an upgrade leaves a definition outdated —
  `GET kbn:/api/observability/slos/_definitions` reports which definitions are outdated.
- **Pause versus retire.** `POST kbn:/api/observability/slos/{id}/disable` stops computation but keeps the definition;
  `POST kbn:/api/observability/slos/{id}/enable` resumes it. `DELETE kbn:/api/observability/slos/{id}` is permanent —
  confirm with the user first.
- **Check the cluster shape.** Every SLO is backed by a continuous transform, so the cluster needs nodes carrying both
  the `transform` and `ingest` roles. If SLOs never leave "no data", check this before debugging the indicator.

## Examples

**"Set up an SLO for the checkout service"** — resolve `traces-*.otel-*` and confirm `service.name` and the outcome
field exist, measure the trailing 30-day success ratio with `POST /_query`, then recommend one design: if the measured
baseline is 99.6%, propose `sli.apm.transactionErrorRate` at `0.995` on a 30-day rolling window with `occurrences`
budgeting, and say that 99.9% is rejected because its 43-minute budget is smaller than the service's observed monthly
degradation. Create it, read it back, then create the burn-rate rule separately.

**"We want a 99.99% SLO on the payments API"** — measure first. If the trailing baseline is 99.7%, reject 99.99%
outright: it allows 4 minutes 19 seconds of budget over 30 days, less than a single rolling deploy. Recommend 99.5% now
with a ratchet plan, and state that the constraint is the deploy process rather than the target.

**"Alert us when p95 latency goes above 500 ms"** — this is a threshold on an aggregate, so it is `sli.metric.timeslice`
with a percentile metric, `comparator: "LT"`, `threshold: 500`, and — required by that indicator —
`budgetingMethod: "timeslices"` with `timesliceTarget` and `timesliceWindow` set. Confirm the duration field and its
unit in the mapping first; a threshold written in milliseconds against a microsecond field is off by a thousand.

**"Create an SLO per pod so we can see which pods are unreliable"** — refuse the grouping. `k8s.pod.name` churns on
every deploy, so each `groupBy` value creates an SLO instance that is orphaned within days while the transform carries
the cardinality forever. Recommend grouping on `k8s.namespace.name` or `service.name` instead, and point out that
per-pod reliability is a symptom to investigate, not a target to budget.

**"Disk on the log nodes keeps filling up — can we SLO that?"** — no. Disk utilization is a capacity ceiling with a
known safe bound and an immediate operator action, so it is a threshold rule, not a reliability target. There is no
user-visible outcome to budget and no meaningful notion of spending 0.5% of disk-full.

**"Our request rate looks weird but there is no threshold we can name"** — no fixed bound means no SLO and no threshold
rule. Route it to an anomaly detection job, which learns the seasonal baseline, and note that it needs several weeks of
history before its scores are trustworthy.

**"Why are we getting paged twice for every checkout incident?"** — list rules with `GET kbn:/api/alerting/rules/_find`
and look for a burn-rate rule and a raw threshold rule on the same signal. Keep the burn-rate rule as the pager, demote
the threshold to a ticket, and verify no slow-burn window is routed to the paging connector.

## Guidelines

- Choose the instrument before designing the SLO; a capacity ceiling is a threshold rule and an unbounded signal is an
  anomaly job.
- Confirm every field against `GET /<index>/_mapping` or `GET /_field_caps` before writing it into an indicator. Never
  infer a field name from convention.
- Validate the SLI with ES|QL through `POST /_query` first; set the target from the measured baseline, not from
  ambition.
- `objective.target` is a decimal between 0 and 1 — `0.995` for 99.5%.
- Timeslice metric indicators require `budgetingMethod: "timeslices"`.
- The `good`, `total`, and `filter` fields of `sli.kql.custom` are KQL because the API defines them that way. Everything
  else you query is ES|QL.
- Updating an SLO resets the underlying transform and recomputes history — warn the user before doing it.
- The cluster needs nodes with both the `transform` and `ingest` roles.
- Use the reset operation when an SLO is stuck or after index mapping changes.
- Group-by SLOs create one instance per unique value — refuse high-cardinality fields rather than creating and warning.
- Synthetics SLOs are auto-grouped by monitor and location; do not set `groupBy` manually.
- Burn-rate alert rules are not created by the SLO API — set them up separately, with fast-burn and slow-burn windows
  routed to different severities.
- Prefer snoozing a rule or opening a maintenance window over disabling it.
- Confirm deletions before executing them.

## Operations

| HTTP API (shorthand)                                | `elastic` CLI command                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /_query`                                      | `elastic es esql query --format tsv --query '<esql>'`                                         |
| `GET /_resolve/index/<pattern>`                     | `elastic es indices resolve-index --name '<pattern>'`                                         |
| `GET /<index>/_mapping`                             | `elastic es indices get-mapping --index '<index>'`                                            |
| `GET /_field_caps`                                  | `elastic es field-caps --index '<index>' --fields '<fields>'`                                 |
| `GET /_ml/anomaly_detectors`                        | `elastic es ml get-jobs`                                                                      |
| `GET kbn:/api/observability/slos`                   | `elastic kb slo find-slos-op --space-id '<space>' --kql-query '<kql>'`                        |
| `POST kbn:/api/observability/slos`                  | `elastic kb slo create-slo-op --space-id '<space>' --input-file <json>`                       |
| `GET kbn:/api/observability/slos/{id}`              | `elastic kb slo get-slo-op --space-id '<space>' --slo-id '<id>'`                              |
| `PUT kbn:/api/observability/slos/{id}`              | `elastic kb slo update-slo-op --space-id '<space>' --slo-id '<id>' --input-file <json>`       |
| `DELETE kbn:/api/observability/slos/{id}`           | `elastic kb slo delete-slo-op --space-id '<space>' --slo-id '<id>'`                           |
| `POST kbn:/api/observability/slos/{id}/_reset`      | `elastic kb slo reset-slo-op --space-id '<space>' --slo-id '<id>'`                            |
| `POST kbn:/api/observability/slos/{id}/enable`      | `elastic kb slo enable-slo-op --space-id '<space>' --slo-id '<id>'`                           |
| `POST kbn:/api/observability/slos/{id}/disable`     | `elastic kb slo disable-slo-op --space-id '<space>' --slo-id '<id>'`                          |
| `GET kbn:/api/observability/slos/_definitions`      | `elastic kb slo get-definitions-op --space-id '<space>'`                                      |
| `GET kbn:/api/alerting/rules/_find`                 | `elastic kb alerting get-alerting-rules-find --filter '<kql>'`                                |
| `POST kbn:/api/alerting/rule/{id}`                  | `elastic kb alerting post-alerting-rule-id --id '<id>' --input-file <json>`                   |
| `POST kbn:/api/alerting/rule/{id}/_snooze_schedule` | `elastic kb alerting post-alerting-rule-id-snooze-schedule --id '<id>' --input-file <json>`   |
| `POST kbn:/api/alerting/rule/{id}/_disable`         | `elastic kb alerting post-alerting-rule-id-disable --id '<id>'`                               |
| `POST kbn:/api/maintenance_window`                  | `elastic kb maintenance-window post-maintenance-window --title '<title>' --input-file <json>` |
| `GET kbn:/api/synthetics/monitors`                  | _no CLI binding — see CLI gaps below_                                                         |
| `POST kbn:/api/synthetics/monitors`                 | _no CLI binding — see CLI gaps below_                                                         |

**CLI gaps.** As of `elastic` CLI 0.2.0 there is no binding for the Synthetics monitor management API — the `stack kb`
namespace exposes no synthetics commands. The HTTP shorthand above is still the correct contract and remains portable,
so keep using it when describing what must happen, but do not invent a CLI invocation for it. Create and edit monitors
through the Synthetics app in Kibana, through a Synthetics project, or by calling the Kibana API directly from tooling
that already holds credentials. Everything else in this skill, including the burn-rate rule and every SLO operation, has
a working CLI binding.
