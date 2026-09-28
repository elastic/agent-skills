# Reading SLO and Alert State

How to read SLO status and active alerting rules during triage. This is about **reading** state under time pressure —
for authoring SLO definitions, burn-rate rules, and alert thresholds, use the **observability-service-reliability**
skill.

## Why these rank first

An SLO is the only signal that encodes an agreed definition of "good" for a service. Every other signal describes a
change; the SLO says whether the change matters. When an SLO covers the symptom, it decides the verdict and the rest of
the triage exists to explain it. When no SLO covers the symptom, active alerting rules are the next best proxy for an
agreed threshold, because someone chose that threshold deliberately.

## Reading SLO state

List SLOs with `GET kbn:/api/observability/slos` and read the individual definition with
`GET kbn:/api/observability/slos/{id}`. Match SLOs to the service through the indicator's filter — SLOs are not tagged
with `service.name` in a uniform way, so read the indicator params rather than assuming a naming convention.

| Field                             | Meaning                                                | How to read it                                                                     |
| --------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `summary.status`                  | `HEALTHY`, `DEGRADING`, `VIOLATED`, or `NO_DATA`       | `VIOLATED` is the verdict. `NO_DATA` is missing telemetry, **not** health          |
| `summary.sliValue`                | Current SLI over the SLO's own time window             | Compare against `objective.target`; a negative value means no data                 |
| `objective.target`                | The target, as a fraction (`0.995` = 99.5%)            | The line the SLI must stay above                                                   |
| `summary.errorBudget.remaining`   | Fraction of budget left (`1` = untouched, `0` = spent) | Below 0 means the budget is overspent and the SLO is violated                      |
| `summary.errorBudget.consumed`    | Fraction of budget already used                        | Read alongside how far into the window you are                                     |
| `summary.errorBudget.isEstimated` | Whether the budget is extrapolated                     | True for occurrences-based SLOs early in a window; treat the number as provisional |
| `timeWindow`                      | Rolling window length, or calendar-aligned             | Governs how far back the SLI is computed                                           |

### Burn rate

Burn rate is how fast the error budget is being consumed relative to the rate that would exactly exhaust it over the
full window. A burn rate of 1 spends the budget precisely at the end of the window; 10 spends it in a tenth of the time.

- **Burn rate < 1, status healthy** — sustainable. Nothing to escalate.
- **Burn rate 1-2, status degrading** — the budget will run out if this continues. Report as degraded with a trend.
- **Burn rate > 2** — the budget is being consumed materially faster than planned. Report as unhealthy on trajectory
  even while `summary.status` still reads healthy; that field reflects consumption to date, not the current rate.
- **Burn rate very high over a short window** — a sharp incident. Anchor the trace and log queries to that window.

Long and short burn-rate windows disagree by design: the short window catches fast incidents, the long window catches
slow bleeds. When they disagree, the short window is describing now and the long window is describing the last day.

### Common SLO reading errors

- **`NO_DATA` reported as healthy.** It means the SLI query returned nothing. That is missing telemetry, and it hides
  outages rather than proving their absence.
- **SLO window versus query window.** An SLO evaluated over 30 days can be violated while the last 15 minutes look
  perfect. Do not use a short ES|QL window to contradict a violated SLO — the SLO's window is longer, and it is right.
- **Assuming an SLO exists.** If no SLO covers the service, say so explicitly and move down the signal hierarchy. Do not
  narrate the absence more than once.
- The SLO API's `sli.kql.custom` indicator takes a KQL string. That is the API's contract, not an exception to the rule
  that data queries in this skill are written in ES|QL.

## Reading active alerting rules

**Determine active alert state from the Alerting API, not from indices.** Call `GET kbn:/api/alerting/rules/_find` with:

```text
per_page=100&filter=alert.attributes.enabled:true
```

Page with `page=2`, `page=3` and so on while `total` exceeds what you have received, then do all remaining narrowing on
the response in memory.

**Do not query `.alerts*` indices to determine whether an alert is currently active.** Those indices hold alert
documents whose lifecycle state can lag or be interpreted incorrectly; the Alerting API response is the source of truth.

### Why the call is deliberately unnarrowed

Server-side narrowing on this endpoint drops exactly the rules triage needs. Measured against a live Kibana project
(9.6.0) holding two enabled rules — `[Kubernetes OTel] Pod CrashLoopBackOff` (a `.es-query` rule tagged `kubernetes`,
`pod-health`, `errors`) and `[Kubernetes OTel] Availability — fast burn` (a `slo.rules.burnRate` rule tagged `k8s-otel`,
`demo`), neither carrying `params.serviceName`:

| Query                                                          | Rules returned |
| -------------------------------------------------------------- | -------------- |
| `per_page=100` (no filter)                                     | 2 of 2         |
| `per_page=100&filter=alert.attributes.enabled:true`            | 2 of 2         |
| `search=apm&search_fields=tags`                                | 0 of 2         |
| `filter=alert.attributes.executionStatus.status:active`        | 0 of 2         |
| `search=apm&search_fields=tags` + the `executionStatus` filter | 0 of 2         |
| `filter=alert.attributes.params.serviceName:cart`              | 0 of 2         |

Three separate reasons, each sufficient on its own:

- **`search_fields=tags` filters on a user convention.** `tags` is a free-text array the rule author chooses. Nothing
  requires an observability rule to be tagged `apm`, and neither of these two is.
- **`executionStatus.status:active` means "firing", not "enabled".** Kibana sets the status to `ok` when the last run
  produced zero alert instances and `active` when it produced one or more — the assignment is
  `alertIds.length === 0 ? 'ok' : 'active'` in `rule_execution_status.ts`. The full enum is `ok`, `active`, `error`,
  `pending`, `unknown`, `warning`. Filtering on `active` therefore returns only rules that are firing right now and
  hides every healthy rule, so it cannot answer "what covers this service".
- **`params` is not filterable.** The `filter` parameter is documented as KQL over saved-object attributes; rule
  `params` are stored but not mapped for query, so `alert.attributes.params.serviceName:<name>` matches nothing even
  when a rule has that exact value. Service matching has to happen client-side regardless.

Narrowing by `alertTypeId` or `consumer` fails the same way for a different reason: the CrashLoopBackOff rule above is a
generic `.es-query` stack rule watching Kubernetes OTel data, so an observability-rule-type allowlist returns 1 of 2.

### The all-services rule trap

When checking a single service, evaluate **both**:

1. Rules whose `params.serviceName` matches the target service, and
2. Rules where **`params.serviceName` is absent** — these are all-services rules and they apply to the target service
   too.

Filtering only on a matching `params.serviceName` silently drops the environment-wide latency and error-rate rules,
which are exactly the ones most likely to be firing during a broad incident. Treat either kind as applicable to the
service before declaring health. This is the requirement that the tag-and-status narrowing above makes unsatisfiable:
both rules in the measured project are all-services rules, and every narrowed query returned none of them.

Fetch a rule's full definition with `GET kbn:/api/alerting/rule/{id}` when its thresholds or params are needed.

### Separating coverage from firing

The two questions have one answer set. Fetch the enabled rules once, then partition in memory:

- **Coverage** — every fetched rule whose `params.serviceName` matches the service or is absent.
- **Firing** — the subset of those whose `execution_status.status` is `active`.
- **Blind spots** — the subset whose status is `error`, plus any rule with `mute_all: true`.

Do not issue a second, `active`-filtered call for the firing question. The status is already on every rule in the
response, and a second narrowed call reintroduces the possibility of the two answers disagreeing.

### Reading a rule

| Field                            | What it tells you                                                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rule_type_id`                   | Which signal the rule watches (APM latency, APM error rate, custom threshold, SLO burn rate)                                                                                                       |
| `params.serviceName`             | The scoped service, or absent for an all-services rule                                                                                                                                             |
| `params.environment`             | The scoped environment; `ENVIRONMENT_ALL` means every environment                                                                                                                                  |
| `params.threshold`               | The value that triggers it — needed to judge whether firing means much                                                                                                                             |
| `params.windowSize`/`windowUnit` | The evaluation window; a 1-minute window fires on transients                                                                                                                                       |
| `execution_status.status`        | One of `ok`, `active`, `error`, `pending`, `unknown`, `warning`. `active` means the last run produced alerts; `ok` means it ran and produced none; `error` means the rule is not evaluating at all |
| `mute_all` / `muted_alert_ids`   | Whether the rule is muted — a muted rule that would be firing is a finding                                                                                                                         |

A rule in `execution_status.status: error` is **not** a healthy rule. It is a blind spot: report it as a signal that is
unavailable rather than as an absence of alerts.

## Putting the two together

- **SLO violated and rules firing** — unhealthy, high confidence. Use the rule's threshold and window to time-bound the
  rest of the investigation.
- **SLO violated, no rules firing** — unhealthy on the SLO. The absence of alerts means alerting coverage is thinner
  than the SLO, which is a recommendation to make, not evidence of health.
- **Rules firing, no SLO** — the rules are the verdict. Confirm the threshold is meaningful before escalating: a latency
  rule at a threshold well below normal operating latency fires constantly and means nothing.
- **Neither exists** — say so once and triage on golden signals, comparing against the prior window. A verdict from raw
  metrics alone is legitimate; it carries lower confidence than one anchored to an agreed target.
