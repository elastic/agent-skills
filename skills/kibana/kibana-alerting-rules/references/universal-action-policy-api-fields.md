# Action Policy API Fields

Field reference for `kbn:/api/alerting/v2/action_policies`. Every request body is strict: unknown keys return 400.

## Policy id

- Path parameter `{id}`: 1–150 characters, `[a-zA-Z0-9_-]` only.
- `POST` generates the id; `PUT` takes it from the path.
- Ids are permanent. Reusing the id of a deleted policy is allowed but discouraged.

## Create (`POST`) and upsert (`PUT`) body

| Field          | Type   | Required | Bounds and notes                                                                |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------- |
| `name`         | string | yes      | 1–256 characters, trimmed                                                       |
| `description`  | string | no       | 1–1024 characters, trimmed                                                      |
| `destinations` | array  | yes      | 1–10 items, no duplicate `type` + `id` pairs                                    |
| `matcher`      | object | no       | Omit for a catch-all; when present, set at least one of `tags` or `expression`  |
| `grouping`     | object | no       | Defaults to `{ "mode": "per_alert" }`                                           |
| `throttle`     | object | no       | `per_alert`: `on_status_change`. Other modes: none (unthrottled); always set it |

`PUT` on an existing id replaces `name`, `description`, `destinations`, `matcher`, `grouping`, and `throttle` with the
body (omitted optional fields are removed) and leaves `enabled`, `snoozed_until`, `created_by`, and `created_at`
unchanged.

### `destinations[]`

| Field  | Type   | Notes                         |
| ------ | ------ | ----------------------------- |
| `type` | string | `workflow`                    |
| `id`   | string | Workflow id, 1–150 characters |

### `matcher`

| Field        | Type     | Notes                                                                                         |
| ------------ | -------- | --------------------------------------------------------------------------------------------- |
| `tags`       | string[] | 1–50 items, each 1–128 characters. Matches rule `metadata.routing_tags` (any-of, exact match) |
| `expression` | string   | KQL, 1–4096 characters, trimmed. Evaluated per alert at dispatch time                         |

### `grouping`

| Variant                                    | Notes                                   |
| ------------------------------------------ | --------------------------------------- |
| `{ "mode": "per_alert" }`                  | One notification group per alert        |
| `{ "mode": "all" }`                        | One group for every matching alert      |
| `{ "mode": "per_field", "fields": [...] }` | 1–16 field paths, each 1–256 characters |

### `throttle`

| Variant                                                      | Valid with         |
| ------------------------------------------------------------ | ------------------ |
| `{ "strategy": "on_status_change" }`                         | `per_alert`        |
| `{ "strategy": "per_status_interval", "interval": "<dur>" }` | `per_alert`        |
| `{ "strategy": "time_interval", "interval": "<dur>" }`       | `all`, `per_field` |
| `{ "strategy": "every_time" }`                               | all modes          |

`interval` is a duration string such as `30s`, `15m`, `1h`, or `1d` (max 32 characters, max `365d`). It is required for
`per_status_interval` and `time_interval` and rejected for the other strategies. An incompatible grouping and throttle
pair returns 400 `Strategy "<strategy>" is not valid for grouping mode "<mode>"`.

When `throttle` is omitted, `per_alert` policies behave as `on_status_change`. `all` and `per_field` policies are
unthrottled: the dispatcher falls back to `time_interval` with no `interval` and treats it as no limit, so every new
alert event notifies. The API does not store a default, and the Kibana UI always fills in `5m`, so only API-created
policies hit this.

## Update (`PATCH`) body

All fields are optional. Send only the fields being changed.

| Field          | Accepts `null` | Merge behavior                                                        |
| -------------- | -------------- | --------------------------------------------------------------------- |
| `name`         | no             | Replaced                                                              |
| `description`  | yes            | Replaced; `null` clears it                                            |
| `destinations` | no             | Replaced whole                                                        |
| `matcher`      | yes            | `tags` and `expression` merge independently; each accepts `null`      |
| `grouping`     | yes            | Replaced whole; `null` restores the default                           |
| `throttle`     | yes            | Replaced whole; `null` removes it (unthrottled for `all`/`per_field`) |

The merged policy is validated against the create rules. Clearing both matcher leaves, or setting `matcher: null`, makes
the policy a catch-all.

Examples:

```json
{ "description": "Pages the payments on-call" }
```

```json
{ "matcher": { "expression": null } }
```

```json
{ "throttle": { "strategy": "time_interval", "interval": "30m" } }
```

## Lifecycle bodies

| Endpoint                                                                                         | Body                                                        |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `POST …/{id}/_snooze`                                                                            | `{ "snoozed_until": "<ISO-8601, strictly in the future>" }` |
| `POST …/{id}/_enable`, `_disable`, `_unsnooze`, `_update_api_key`                                | none                                                        |
| `POST …/_bulk_enable`, `_bulk_disable`, `_bulk_unsnooze`, `_bulk_update_api_key`, `_bulk_delete` | `{ "ids": [...] }` (1–100 unique ids)                       |
| `POST …/_bulk_snooze`                                                                            | `{ "ids": [...], "snoozed_until": "<ISO-8601>" }`           |

Single lifecycle endpoints return the updated policy. `DELETE …/{id}` returns 204.

## List query parameters (`GET kbn:/api/alerting/v2/action_policies`)

| Parameter    | Type    | Default | Notes                                                   |
| ------------ | ------- | ------- | ------------------------------------------------------- |
| `page`       | integer | 1       | 1–10,000                                                |
| `per_page`   | integer | 20      | 1–100; `page × per_page` ≤ 10,000                       |
| `filter`     | string  | —       | KQL on `id`, `name`, `description`, `enabled`; max 4096 |
| `search`     | string  | —       | Free text over `name` and `description`; max 256        |
| `sort_field` | string  | `name`  | `name`, `created_at`, or `updated_at`                   |
| `sort_order` | string  | `asc`   | `asc` or `desc`                                         |

The response is `{ "items": [...], "total": <n>, "page": <n>, "per_page": <n> }`. `total` is capped at 10,000.

## Policy response

| Field           | Notes                                                       |
| --------------- | ----------------------------------------------------------- |
| `id`, `name`    | Always present                                              |
| `description`   | Present when set                                            |
| `enabled`       | `true` after create; changed only by `_enable` / `_disable` |
| `destinations`  | As stored                                                   |
| `matcher`       | Present when set                                            |
| `grouping`      | Present when set                                            |
| `throttle`      | Present when set                                            |
| `snoozed_until` | Present while a snooze time is stored                       |
| `created_by`    | `{ "profile_uid": "<uid>" }` or `null`                      |
| `updated_by`    | `{ "profile_uid": "<uid>" }` or `null`                      |
| `created_at`    | ISO-8601                                                    |
| `updated_at`    | ISO-8601                                                    |

API key material is never returned.

## Bulk response

```json
{
  "affected_count": 2,
  "errors": [{ "id": "missing-policy", "error": { "code": "ACTION_POLICY_NOT_FOUND", "message": "..." } }]
}
```

The HTTP status is 200 whether or not `errors` is empty.

## Errors

Error bodies have `code`, `error`, `message`, and optional `details` (`details.action_policy_id` names the policy).

| Status | `code`                                      | Cause and response                                                                         |
| ------ | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 400    | `BAD_REQUEST`                               | Body or query failed validation; read `details.errors`                                     |
| 400    | `ACTION_POLICY_CLOUD_API_KEY_NOT_SUPPORTED` | Called with an Elastic Cloud API key; use a user session or an Elasticsearch API key       |
| 403    | `ACTION_POLICY_LICENSE_NOT_SUPPORTED`       | Enterprise license required; `details` has `required_license` and `current_license`        |
| 403    | —                                           | Missing Action Policies `all` or Rules `read` privilege                                    |
| 404    | `ACTION_POLICY_NOT_FOUND`                   | No policy with that id in this space                                                       |
| 409    | `ACTION_POLICY_VERSION_CONFLICT`            | Another caller changed the policy; re-read and retry                                       |
| 409    | `ACTION_POLICY_ALREADY_EXISTS`              | A concurrent create used the same id; read the existing policy                             |
| 500    | `API_KEY_INVALIDATION_FAILED`               | Delete could not queue the old API key for invalidation; the policy was not deleted; retry |
| 503    | `ALERTING_DISABLED`                         | The `alerting:v2:enabled` advanced setting is off                                          |
