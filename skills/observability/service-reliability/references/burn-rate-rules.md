# SLO burn-rate alert rules

Creating an SLO creates no alerting. Burn-rate rules are separate alerting rules created with
`POST kbn:/api/alerting/rule/{id}`.

## What a burn rate is

Burn rate is the multiple of the budget-exhaustion pace. A burn rate of 1 spends the entire error budget exactly at the
end of the SLO time window. A burn rate of 14.4 on a 30-day window spends the whole budget in just over two days — and
about 2% of it in the first hour, which is why 14.4 over a one-hour window is the conventional paging threshold.

Each window pairs two lookbacks:

- **Long window** — decides whether the burn is sustained enough to be worth alerting on.
- **Short window** — decides whether it is still happening. Without it, an alert stays active long after the incident
  ends and has to be muted by hand.

Both must exceed the threshold for the alert to fire.

## Rule envelope

```json
{
  "name": "Checkout availability — burn rate",
  "rule_type_id": "slo.rules.burnRate",
  "consumer": "slo",
  "schedule": { "interval": "1m" },
  "tags": ["slo", "checkout"],
  "params": {
    "sloId": "checkout-availability",
    "windows": []
  }
}
```

`consumer` is `slo`. The rule references the SLO by `sloId`; it does not restate the indicator, so a change to the SLO
target automatically changes what the rule considers a burn.

## Window objects

```json
{
  "id": "fast-burn-1h",
  "burnRateThreshold": 14.4,
  "maxBurnRateThreshold": 720,
  "longWindow": { "value": 1, "unit": "h" },
  "shortWindow": { "value": 5, "unit": "m" },
  "actionGroup": "slo.burnRate.alert"
}
```

| Field                  | Notes                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `burnRateThreshold`    | The multiple that triggers this window.                                                             |
| `maxBurnRateThreshold` | Ceiling for the window, computed as SLO window hours divided by long-window hours.                  |
| `longWindow`           | Sustained-burn lookback.                                                                            |
| `shortWindow`          | Still-happening lookback. Conventionally one twelfth of the long window.                            |
| `actionGroup`          | `slo.burnRate.alert` (critical), `.high`, `.medium`, `.low` — this is what lets you route severity. |

## Default four-window set for a 30-day SLO

These are the values Kibana proposes for a 30-day window. They are a good starting point; adjust the thresholds if the
service's traffic pattern makes the fast window jumpy.

| Severity | Burn rate | Long window | Short window | `maxBurnRateThreshold` | Action group          | Budget consumed before firing |
| -------- | --------- | ----------- | ------------ | ---------------------- | --------------------- | ----------------------------- |
| Critical | 14.4      | 1h          | 5m           | 720                    | `slo.burnRate.alert`  | ~2%                           |
| High     | 6         | 6h          | 30m          | 120                    | `slo.burnRate.high`   | ~5%                           |
| Medium   | 3         | 24h         | 2h           | 30                     | `slo.burnRate.medium` | ~10%                          |
| Low      | 1         | 72h         | 6h           | 10                     | `slo.burnRate.low`    | ~10%                          |

**Route these differently.** Critical and high are worth paging. Medium and low describe chronic degradation over days
and belong in a ticket queue — sending all four to the same paging connector is the fastest way to get the SLO ignored.

## Full example

```json
{
  "name": "Checkout availability — burn rate",
  "rule_type_id": "slo.rules.burnRate",
  "consumer": "slo",
  "schedule": { "interval": "1m" },
  "tags": ["slo", "checkout"],
  "params": {
    "sloId": "checkout-availability",
    "windows": [
      {
        "id": "fast-burn-1h",
        "burnRateThreshold": 14.4,
        "maxBurnRateThreshold": 720,
        "longWindow": { "value": 1, "unit": "h" },
        "shortWindow": { "value": 5, "unit": "m" },
        "actionGroup": "slo.burnRate.alert"
      },
      {
        "id": "fast-burn-6h",
        "burnRateThreshold": 6,
        "maxBurnRateThreshold": 120,
        "longWindow": { "value": 6, "unit": "h" },
        "shortWindow": { "value": 30, "unit": "m" },
        "actionGroup": "slo.burnRate.high"
      },
      {
        "id": "slow-burn-24h",
        "burnRateThreshold": 3,
        "maxBurnRateThreshold": 30,
        "longWindow": { "value": 24, "unit": "h" },
        "shortWindow": { "value": 2, "unit": "h" },
        "actionGroup": "slo.burnRate.medium"
      },
      {
        "id": "slow-burn-72h",
        "burnRateThreshold": 1,
        "maxBurnRateThreshold": 10,
        "longWindow": { "value": 72, "unit": "h" },
        "shortWindow": { "value": 6, "unit": "h" },
        "actionGroup": "slo.burnRate.low"
      }
    ]
  }
}
```

Attach `actions` only when the user asks for notification wiring, and give each action a `frequency` object — rule-level
`notify_when` and `throttle` are deprecated.

## Grouped SLOs

A burn-rate rule on a grouped SLO evaluates every instance, so one rule can produce many simultaneous alerts. This is
another reason to keep `groupBy` cardinality low: a grouped SLO with hundreds of instances turns a single dependency
outage into hundreds of pages.

## Sanity checks before saving

- The SLO exists and is computing. A burn-rate rule on an SLO with no rollup data never fires and looks healthy.
- The paging connector is attached only to the critical and high action groups.
- No raw threshold rule already pages on the same signal — check with `GET kbn:/api/alerting/rules/_find`. The one
  legitimate overlap is a no-data rule, which covers the outage case an event-ratio SLO structurally cannot see.
- Every window has a named first response step. A window nobody acts on should be removed, not tuned.
