# Rule Types and Parameters

Use this reference when choosing `rule_type_id`, `consumer`, and `params` for a new rule.

## Common metric and threshold rule types

| Rule type                      | `rule_type_id`            | Typical `consumer`            | Use when                                                                                                                             |
| ------------------------------ | ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Index threshold                | `.index-threshold`        | `stackAlerts`                 | Aggregate a numeric field over a time window, compare to a threshold, optionally group by a term field (per-host/per-service alerts) |
| Elasticsearch query            | `.es-query`               | `stackAlerts`                 | Count or aggregate via Query DSL / ES\|QL embedded in params                                                                         |
| Observability metric threshold | `metrics.alert.threshold` | `metrics` or `infrastructure` | Observability UI metric rules on infrastructure/metrics data                                                                         |

For **"metric exceeds X for Y minutes, grouped by host"**, prefer `.index-threshold` with `stackAlerts` unless the
deployment exposes only the Observability metric threshold type.

## Index threshold params (`.index-threshold`)

| Param                               | Purpose                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `index`                             | Array of index patterns to query                                                                  |
| `timeField`                         | Time field (usually `@timestamp`)                                                                 |
| `aggType`                           | Aggregation: `avg`, `max`, `min`, `sum`, `count`                                                  |
| `aggField`                          | Numeric field to aggregate (omit for `count`)                                                     |
| `groupBy`                           | `all` (single series) or `top` (per-term series)                                                  |
| `termField`                         | Field to group by when `groupBy` is `top` (e.g., `host.name`)                                     |
| `termSize`                          | Max terms when grouping (use a generous value for "any host")                                     |
| `threshold`                         | Array of threshold values (match field scale: `0.9` for fractional CPU pct, `90` for 0–100 scale) |
| `thresholdComparator`               | `>`, `>=`, `<`, `<=`, `between`, etc.                                                             |
| `timeWindowSize` / `timeWindowUnit` | Lookback window (`5` + `m` = five minutes)                                                        |

**Example — CPU > 90% on any host for 5 minutes:**

```json
{
  "index": ["eval-alert-metrics"],
  "timeField": "@timestamp",
  "aggType": "avg",
  "aggField": "system.cpu.total.pct",
  "groupBy": "top",
  "termField": "host.name",
  "termSize": 1000,
  "threshold": [0.9],
  "thresholdComparator": ">",
  "timeWindowSize": 5,
  "timeWindowUnit": "m"
}
```

Pair with `"schedule": { "interval": "5m" }` so the check interval aligns with the lookback window.

## Elasticsearch query params (`.es-query`)

| Param                               | Purpose                            |
| ----------------------------------- | ---------------------------------- |
| `index`                             | Index patterns                     |
| `timeField`                         | Time field                         |
| `esQuery`                           | JSON string of Query DSL query     |
| `threshold` / `thresholdComparator` | Hit count or aggregation threshold |
| `timeWindowSize` / `timeWindowUnit` | Lookback window                    |
| `size`                              | Documents to evaluate              |

## Valid `consumer` values

`alerts`, `apm`, `discover`, `infrastructure`, `logs`, `metrics`, `ml`, `monitoring`, `securitySolution`, `siem`,
`stackAlerts`, `uptime`

Using the wrong consumer for a rule type returns **400**. Match the consumer to the rule type's owning application
(Stack rules → `stackAlerts`; Observability metrics → `metrics` or `infrastructure`).

## Action groups

Each rule type defines action **groups** (trigger states). Common Stack threshold groups:

- `.index-threshold` — `"threshold met"`, `"Recovered"`
- `.es-query` — `"query matched"`, `"Recovered"`

Discover valid groups for a rule type in Kibana **Stack Management → Rules → Rule types**, or in the rule-type metadata
returned by the Kibana Alerting API (not yet exposed as an `elastic kb alerting` subcommand).

## Required and optional rule body fields

| Field                      | Required   | Notes                                                         |
| -------------------------- | ---------- | ------------------------------------------------------------- |
| `name`                     | yes        | Display name                                                  |
| `rule_type_id`             | yes        | Immutable after create                                        |
| `consumer`                 | yes        | Immutable after create                                        |
| `schedule`                 | yes        | e.g., `{"interval": "5m"}` — minimum typically `1m`           |
| `params`                   | yes        | Rule-type-specific                                            |
| `enabled`                  | no         | Default `true`                                                |
| `tags`                     | no         | For filtering via find API                                    |
| `actions`                  | no         | Omit when the user only asks to create the rule condition     |
| `alert_delay`              | no         | e.g., `{"active": 3}` — fire only after N consecutive matches |
| `flapping`                 | no         | Override flapping detection                                   |
| `notify_when` / `throttle` | deprecated | Set `frequency` per action instead                            |
