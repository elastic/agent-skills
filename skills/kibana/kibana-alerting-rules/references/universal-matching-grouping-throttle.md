# Matching, Grouping, and Throttling

How an action policy selects alerts, batches them into notification groups, and decides when each group notifies.

## Dispatch flow

1. A rule with `kind: alert` evaluates its ES|QL query and records alerts, one per group (`group_hash`).
2. The dispatcher runs every few seconds and reads new alert events.
3. It loads every enabled action policy in the alert's space and skips policies whose `snoozed_until` is in the future.
4. **Matcher** — each policy's matcher is tested against each alert.
5. **Grouping** — matched alerts are batched per policy according to `grouping.mode`.
6. **Throttle** — each group is compared with its notification history and kept or held back.
7. **Dispatch** — each kept group is sent to every destination workflow as `inputs.payload`.
8. The workflow runs its steps (email, Slack, PagerDuty, HTTP, and so on).

## Alert status

| Status       | Meaning                                                      |
| ------------ | ------------------------------------------------------------ |
| `pending`    | Breached, but not yet for the rule's required number of runs |
| `active`     | Firing                                                       |
| `recovering` | Breach stopped; the rule's recovery condition is not yet met |
| `inactive`   | Recovered                                                    |

## Matcher

```json
{ "tags": ["<routing-tag>"], "expression": "<KQL>" }
```

### `tags`

- Matches when the alert's rule has at least one of the listed tags in `metadata.routing_tags`.
- Exact, case-sensitive match. No wildcards or prefixes.
- A rule with no routing tags never matches a policy that sets `tags`.

### `expression`

KQL evaluated against each alert. Only these fields are available:

| Field                  | Type                                          | Description                                                |
| ---------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| `alert_id`             | string                                        | Alert identifier                                           |
| `alert_status`         | `inactive`, `pending`, `active`, `recovering` | Current alert status                                       |
| `group_hash`           | string                                        | Hash of the rule's grouping values                         |
| `last_event_timestamp` | string                                        | Timestamp of the most recent event                         |
| `severity`             | `info`, `low`, `medium`, `high`, `critical`   | Present when the rule query outputs a `severity` column    |
| `data.*`               | object                                        | The rule's ES\|QL output row, for example `data.host.name` |

Rule identifiers and names are not in the expression context; scope by rule with `tags`. An expression that fails to
evaluate is treated as no match, so quote string values (`severity: "critical"`) and use `data.*` columns that the rule
query actually returns.

### Combining `tags` and `expression`

| `tags` | `expression` | Result                                                      |
| ------ | ------------ | ----------------------------------------------------------- |
| set    | set          | Both must match                                             |
| set    | absent       | Routing tag match only                                      |
| absent | set          | Any rule's alerts in the space, filtered by the KQL         |
| absent | absent       | Catch-all: every alert in the space, including future rules |

### Matcher patterns

```json
{ "tags": ["notify-high-cpu-prod"] }
```

```json
{ "tags": ["production", "payments"] }
```

```json
{ "expression": "severity: \"critical\"" }
```

```json
{ "tags": ["production"], "expression": "severity: \"critical\" and alert_status: \"active\"" }
```

### Linking one rule to one policy

1. Read the rule with `GET kbn:/api/alerting/v2/rules/{id}` and confirm `kind` is `alert`.
2. Pick a routing tag that only this rule carries, or add `notify-<rule-slug>` (lowercase kebab case of the rule name).
3. Update the rule with `PATCH kbn:/api/alerting/v2/rules/{id}` and
   `{ "metadata": { "routing_tags": [<existing routing tags>, "notify-<rule-slug>"] } }`. The array is replaced whole,
   and a rule holds at most 20 routing tags.
4. Create the policy with `matcher: { "tags": ["notify-<rule-slug>"] }`.

## Grouping modes

| Mode        | Notification groups                                     | Typical use                        |
| ----------- | ------------------------------------------------------- | ---------------------------------- |
| `per_alert` | One per alert (default)                                 | Paging, incident tools, tickets    |
| `all`       | One per policy, containing every matching alert         | A single combined summary          |
| `per_field` | One per distinct combination of the listed field values | Digests per service, host, or team |

`per_field` paths resolve against the alert. Rule query columns live under `data.` (`data.service.name`); a path that
does not resolve contributes `null` to the group key, so every alert lands in the same group.

## Throttle strategies

| Strategy              | Behavior                                                                | Valid with         |
| --------------------- | ----------------------------------------------------------------------- | ------------------ |
| `on_status_change`    | Notify when the alert status changes (default for `per_alert`)          | `per_alert`        |
| `per_status_interval` | Notify on status changes and again every `interval` while status holds  | `per_alert`        |
| `time_interval`       | Notify at most once per `interval` per group                            | `all`, `per_field` |
| `every_time`          | Notify on every dispatcher cycle that has matching alerts (high volume) | all modes          |

Omitting `throttle` defaults `per_alert` to `on_status_change`. For `all` and `per_field` it applies no limit: every new
alert event notifies, as with `every_time`. Always set `time_interval` with an `interval` for these modes.

Choosing a strategy:

- Paging or ticketing tools that open and close incidents → `per_alert` + `on_status_change`.
- Reminders while an alert stays active → `per_alert` + `per_status_interval` with an interval such as `1h`.
- Periodic summaries → `per_field` or `all` + `time_interval` with an interval such as `15m` or `1h`.
- Audit or forwarding pipelines that must see every event → `every_time`.
