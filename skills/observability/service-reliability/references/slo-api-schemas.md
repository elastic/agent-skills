# SLO API request-body schemas

Request bodies for `POST kbn:/api/observability/slos` (create) and `PUT kbn:/api/observability/slos/{id}` (update). The
update body accepts the same fields as create, minus `id`; any field omitted keeps its current value, and **any change
resets the transform and recomputes history**.

Verify the exact schema for your stack version against
[Create an SLO](https://www.elastic.co/docs/api/doc/kibana/operation/operation-createsloop) before relying on an
optional field.

## Envelope

```json
{
  "id": "checkout-availability",
  "name": "Checkout availability",
  "description": "Successful checkout requests over 30 days",
  "indicator": { "type": "<sli type>", "params": {} },
  "timeWindow": { "duration": "30d", "type": "rolling" },
  "budgetingMethod": "occurrences",
  "objective": { "target": 0.995 },
  "groupBy": "service.environment",
  "tags": ["checkout", "tier-1"],
  "settings": { "syncDelay": "1m", "frequency": "1m", "preventInitialBackfill": false }
}
```

| Field             | Notes                                                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | Optional. 8-36 characters. Supply a deterministic id when the SLO is managed as code.                                                                                                                     |
| `indicator`       | Required. One of the seven types below.                                                                                                                                                                   |
| `timeWindow`      | Required. `type` is `rolling` (`7d`, `30d`, `90d`) or `calendarAligned` (`1w`, `1M`).                                                                                                                     |
| `budgetingMethod` | Required. `occurrences` or `timeslices`.                                                                                                                                                                  |
| `objective`       | Required. `target` is a decimal in `(0, 1)`. Timeslices adds `timesliceTarget` and `timesliceWindow`.                                                                                                     |
| `groupBy`         | Optional. A field name or array of field names. One SLO instance per distinct value. Keep cardinality low, and confirm the field is populated — a mapped-but-null field produces one degenerate instance. |
| `settings`        | Optional. `syncDelay` waits for late-arriving data; `frequency` is the transform run interval.                                                                                                            |

### Timeslices objective

Required whenever `budgetingMethod` is `timeslices`, and therefore always required for `sli.metric.timeslice`:

```json
{
  "budgetingMethod": "timeslices",
  "objective": {
    "target": 0.995,
    "timesliceTarget": 0.95,
    "timesliceWindow": "5m"
  }
}
```

`timesliceTarget` is the bar a single slice must clear to count as good; `target` is the fraction of slices that must
clear it across the whole window.

## KQL fields

The `good`, `total`, and `filter` string fields below are **KQL**, because the SLO API defines them that way. This is an
API contract, not a style preference — there is no ES|QL form of these fields. Exploratory queries used to validate an
indicator before creating it are ES|QL against `POST /_query`.

`total: "*"` means "every document matching `filter` and the time range".

## `sli.kql.custom`

Good and total expressed as KQL filters over raw documents. The most flexible type and the right default when the
outcome only exists in raw events.

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

`http.response.status_code` is on `traces-*.otel-*`, **not** on `logs-*.otel-*` — OTel log records carry no HTTP status,
and the field is absent from the OTel logs mapping entirely. Even on traces it is populated only on spans emitted by an
HTTP server, so a gRPC service has none. Confirm it with `GET /_field_caps` and with `COUNT(http.response.status_code)`
in ES|QL for the specific service before using it.

This matters more here than anywhere else in the API. KQL against an unmapped field matches nothing and raises no error,
so `good` silently evaluates to 0 while `total: "*"` evaluates to everything, and the SLO reports 0% for a service that
is fine.

When the service emits no HTTP status, use `event.outcome`, which is present on every OTel span:

```json
{
  "type": "sli.kql.custom",
  "params": {
    "index": "traces-*.otel-*",
    "filter": "service.name : \"checkout\" and kind : \"Server\"",
    "good": "event.outcome : \"success\"",
    "total": "*",
    "timestampField": "@timestamp"
  }
}
```

## `sli.metric.custom`

Good and total as equations over metric aggregations. Use when the service already emits its own counters. Each entry in
`metrics` gets a single-letter `name` referenced by `equation`; `aggregation` is `sum` or `doc_count`, and each metric
can carry its own KQL `filter`.

```json
{
  "type": "sli.metric.custom",
  "params": {
    "index": "metrics-*.otel-*",
    "filter": "service.name : \"ingest-worker\"",
    "good": {
      "metrics": [{ "name": "A", "aggregation": "sum", "field": "messages.processed" }],
      "equation": "A"
    },
    "total": {
      "metrics": [{ "name": "B", "aggregation": "sum", "field": "messages.received" }],
      "equation": "B"
    },
    "timestampField": "@timestamp"
  }
}
```

`messages.processed` and `messages.received` are **placeholders for whatever counters the service actually emits** —
they are not standard OTel or ECS fields and exist in no Elastic data stream. Resolve the real counter names from the
mapping before writing this body.

## `sli.metric.timeslice`

A single metric compared against a threshold once per slice. **Requires `budgetingMethod: "timeslices"`.** `aggregation`
supports `avg`, `min`, `max`, `sum`, `cardinality`, `last_value`, `std_deviation`, `doc_count`, and `percentile` (which
takes an extra `percentile` value). `comparator` is `GT`, `GTE`, `LT`, or `LTE`.

```json
{
  "type": "sli.metric.timeslice",
  "params": {
    "index": "traces-*.otel-*",
    "filter": "service.name : \"cart\" and kind : \"Server\"",
    "metric": {
      "metrics": [{ "name": "A", "aggregation": "percentile", "field": "transaction.duration.us", "percentile": 95 }],
      "equation": "A",
      "comparator": "LT",
      "threshold": 500000
    },
    "timestampField": "@timestamp"
  }
}
```

The threshold is expressed in the field's own unit. `transaction.duration.us` is microseconds, so a 500 ms ceiling is
`500000`. Check the unit in the mapping — a threshold off by a factor of a thousand produces an SLO that is always green
or always red.

**`transaction.duration.us` is on `traces-*.otel-*`, not on the 1m rollups.** `metrics-transaction.1m.otel-*` and
`metrics-service_transaction.1m.otel-*` carry `transaction.duration.histogram` (mapped `histogram` or
`exponential_histogram`) and `transaction.duration.summary` (mapped `aggregate_metric_double`) instead — pointing a
`percentile` aggregation at `transaction.duration.us` on a rollup index fails with `Unknown column`. Neither rollup
field supports a `percentile` aggregation either: `aggregate_metric_double` exposes only min, max, sum, value_count and
avg, and a data stream that rolled over across a `histogram` → `exponential_histogram` mapping change becomes
unqueryable on that field altogether. For a p95 latency SLI, run it against raw spans. Verified on an OTel demo cluster:
a `percentiles` aggregation on `transaction.duration.us` over `cart` server spans returns p95 = 3,263 µs.

## `sli.histogram.custom`

Good and total derived from histogram fields. `aggregation` is `range` (with `from` and `to`) or `value_count`.

```json
{
  "type": "sli.histogram.custom",
  "params": {
    "index": "metrics-*.otel-*",
    "filter": "service.name : \"checkout\"",
    "good": {
      "field": "latency_histogram",
      "aggregation": "range",
      "from": 0,
      "to": 300,
      "filter": ""
    },
    "total": {
      "field": "latency_histogram",
      "aggregation": "value_count",
      "filter": ""
    },
    "timestampField": "@timestamp"
  }
}
```

`latency_histogram` is a **placeholder** for the deployment's own histogram field; it is not a standard field name.
Confirm the real one, and confirm it is mapped `histogram` consistently across every backing index of the data stream —
a mapping that changed to `exponential_histogram` at a rollover makes the field unqueryable for the whole stream.

## `sli.apm.transactionDuration`

APM transaction latency against a threshold **in milliseconds**. Use `*` for a dimension you do not want to constrain.

```json
{
  "type": "sli.apm.transactionDuration",
  "params": {
    "service": "checkout",
    "environment": "production",
    "transactionType": "request",
    "transactionName": "GET /api/cart",
    "threshold": 500,
    "filter": "",
    "index": "metrics-apm*"
  }
}
```

## `sli.apm.transactionErrorRate`

APM transaction success rate. Same dimensions as the latency indicator, without a threshold.

```json
{
  "type": "sli.apm.transactionErrorRate",
  "params": {
    "service": "checkout",
    "environment": "production",
    "transactionType": "request",
    "transactionName": "*",
    "filter": "",
    "index": "metrics-apm*"
  }
}
```

### `index` for the APM indicators

`metrics-apm*` is the classic pattern. OTel-native deployments carry APM aggregate metrics in
`metrics-service_transaction.1m.otel-*` and `metrics-transaction.1m.otel-*` instead. Resolve the pattern with
`GET /_resolve/index/<pattern>` in the target deployment and set `index` to what actually exists — do not copy a pattern
across environments. On the OTel-native verification cluster, `GET /_resolve/index/metrics-apm*` returns no indices,
aliases, or data streams at all, so an APM indicator left on the default pattern there produces an SLO with no data
rather than an error.

## `sli.synthetics.availability`

Uptime from synthetics monitor check results. Scope by monitor ids, projects, or tags; `{"value": "*", "label": "*"}`
matches all. **Leave `groupBy` unset on the SLO** — this indicator already produces one instance per monitor and
location.

```json
{
  "type": "sli.synthetics.availability",
  "params": {
    "monitorIds": [{ "value": "checkout-homepage", "label": "checkout-homepage" }],
    "projects": [],
    "tags": [{ "value": "tier-1", "label": "tier-1" }],
    "index": "synthetics-*",
    "filter": ""
  }
}
```

## Worked example: end-to-end create body

A 30-day rolling availability SLO on raw OTel server spans:

```json
{
  "id": "cart-availability",
  "name": "Cart availability",
  "description": "Non-5xx cart server responses, 30-day rolling",
  "indicator": {
    "type": "sli.kql.custom",
    "params": {
      "index": "traces-*.otel-*",
      "filter": "service.name : \"cart\" and kind : \"Server\"",
      "good": "http.response.status_code < 500",
      "total": "*",
      "timestampField": "@timestamp"
    }
  },
  "timeWindow": { "duration": "30d", "type": "rolling" },
  "budgetingMethod": "occurrences",
  "objective": { "target": 0.995 },
  "tags": ["cart", "tier-1"],
  "settings": { "syncDelay": "1m", "frequency": "1m" }
}
```

The equivalent ES|QL ratio was measured before creating this: 1,393,887 server spans over 30 days, all with
`http.response.status_code < 500`, so the observed baseline is 100% and 99.5% is a target the service already clears.

**`groupBy` is deliberately absent.** The obvious candidate, `service.environment`, is mapped on `traces-*.otel-*` but
null on all 46,398 `cart` server spans in the verification cluster, and so are `deployment.environment.name`,
`k8s.namespace.name` and `service.version`. Grouping on a field that is mapped but empty yields a single instance keyed
on the missing value — an SLO that looks grouped and is not. Run `COUNT(<field>)` against `COUNT(*)` for the candidate
dimension and only set `groupBy` when it is genuinely populated.
