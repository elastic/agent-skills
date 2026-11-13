# Universal Alerting Action Policies

Action policies turn Universal Alerting alerts into notifications. A rule never names its destinations; policies match
its alerts and dispatch them to workflows.

## Contents

- [How action policies work](#how-action-policies-work)
- [Requirements](#requirements)
- [Find policies](#find-policies)
- [Matcher](#matcher)
- [Link rules and policies with routing tags](#link-rules-and-policies-with-routing-tags)
- [Grouping and throttle](#grouping-and-throttle)
- [Create or upsert a policy](#create-or-upsert-a-policy)
- [Update a policy](#update-a-policy)
- [Lifecycle](#lifecycle)
- [Bulk changes](#bulk-changes)
- [Ownership and portability](#ownership-and-portability)
- [Common failure modes](#common-failure-modes)

## How action policies work

An **action policy** is a space-scoped saved object. One policy can match alerts from many rules, and one rule's alerts
can match many policies.

- **Matcher** — selects alerts. `matcher.tags` matches a rule's `metadata.routing_tags` (any-of, exact, case-sensitive).
  `matcher.expression` is KQL evaluated against each alert. When both are set, an alert must satisfy both. A policy
  without a matcher is a **catch-all** that matches every alert in the space.
- **Grouping** — how many notifications matched alerts produce: `per_alert` (one per alert, default), `all` (one
  notification that contains every matching alert), or `per_field` (one per distinct value of up to 16 alert fields).
- **Throttle** — how often a group notifies: `on_status_change`, `per_status_interval`, `time_interval`, or
  `every_time`. The allowed strategies depend on the grouping mode.
- **Destinations** — one to ten workflows, each `{ "type": "workflow", "id": "<workflow_id>" }`. See
  [universal-workflow-destinations.md](universal-workflow-destinations.md).

**Dispatch.** Rules with `kind: alert` produce alerts with a status of `pending`, `active`, `recovering`, or `inactive`.
A dispatcher in each space evaluates every enabled, non-snoozed policy against those alerts, groups and throttles the
matches, and schedules each destination workflow with the grouped alerts as `inputs.payload`. Delivery is at-least-once.
Rules with `kind: signal` produce no alerts and never notify. Field-level detail is in
[universal-matching-grouping-throttle.md](universal-matching-grouping-throttle.md).

## Requirements

- **License** — notifications need an active Enterprise (or trial) license: action policies and Kibana Workflows, which
  every policy dispatches to, both require it. Rules run and open alerts on any license.
  - Creating, upserting, updating, and enabling a policy is license-gated; a write without a qualifying license fails
    with 403 `ACTION_POLICY_LICENSE_NOT_SUPPORTED`. Reading, disabling, snoozing, deleting, and rotating the API key
    work on any license.
  - The license is checked again at dispatch time. If it lapses, matched alerts are recorded as dispatch failures and no
    workflow is scheduled.
  - Check with `GET /_license`: continue only when `license.type` is `enterprise` or `trial` and `license.status` is
    `active`.
- **Privileges** — the **Action Policies** feature (`alerting_v2_action_policies`): `read` to list and get, `all` to
  write. Create, upsert, and update also require `read` on the **Rules** feature (`alerting_v2_rules`). Verifying a
  destination requires the **Workflows** feature (`workflowsManagement`) **Read** sub-privilege.
- **Workflows** — Kibana Workflows must be available, because every destination is a workflow.
- **Spaces** — policies are space-scoped and only match alerts and dispatch workflows in their own space. Prefix paths
  with `kbn:/s/<space_id>/` for a non-default space.

## Find policies

Call `GET kbn:/api/alerting/v2/action_policies`:

- **Filter** with KQL on `id`, `name`, `description`, or `enabled` (for example `filter=enabled: true`).
- **Search** free text in `name` and `description` with `search`.
- **Page** with `page` and `per_page` (max 100; `page × per_page` must not exceed 10,000).
- **Sort** with `sort_field` (`name`, `created_at`, `updated_at`) and `sort_order`.

Read one policy with `GET kbn:/api/alerting/v2/action_policies/{id}`. Report ids, names, enabled state, matcher, and
destinations. Policies cannot be searched or filtered by matcher or destination, so finding them by those fields means
reading every page; do that only when the user asks to find policies by those criteria or to reuse an existing policy
that meets them. Creating a policy does not require searching first.

**Every policy that applies to a rule.** An alert can match several policies, so changing where a rule's alerts go means
finding all of them, not just one. Page through every policy and keep:

- policies whose `matcher.tags` share a value with the rule's `metadata.routing_tags`,
- catch-all policies (no `matcher`), and
- expression-only policies whose `matcher.expression` can match the rule's alerts.

Show the list with each policy's destinations and confirm which ones to change before writing.

## Matcher

| User names                                                 | Matcher                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A routing tag ("rules with routing tag team-payments")     | `"matcher": { "tags": ["team-payments"] }`. `matcher.tags` matches values in a rule's `metadata.routing_tags`. If no rule carries the tag yet, the policy still applies to rules that get it later; tell the user.                                                     |
| A plain tag ("rules tagged team-payments")                 | Find the rules first with `GET kbn:/api/alerting/v2/rules` and `filter=metadata.tags:"team-payments"`, then match their `metadata.routing_tags`. If they have no routing tags, ask whether to add one to those rules before creating the policy.                       |
| Specific rules (names or ids)                              | Read each with `GET kbn:/api/alerting/v2/rules/{id}`. For one rule, reuse a routing tag only that rule carries; otherwise add `notify-<rule-slug>` (lowercase kebab case of the rule name) to both the rule's `metadata.routing_tags` and the policy's `matcher.tags`. |
| Alert content                                              | `matcher.expression`, for example `severity: "critical"`; combine with `tags` to scope it to a set of rules.                                                                                                                                                           |
| A group without a tag or rule names ("the payments rules") | Ask for the routing tag or the specific rules before writing anything. Do not search rule names to guess the set.                                                                                                                                                      |
| No scope                                                   | Ask. Omit `matcher` (every alert in the space) only after the user confirms a catch-all.                                                                                                                                                                               |

A rule without routing tags only matches catch-all and expression-only policies. Routing tags are replaced whole on a
rule PATCH (`PATCH kbn:/api/alerting/v2/rules/{id}`), so re-send the existing ones:

```json
{ "metadata": { "routing_tags": ["production", "notify-high-cpu-prod"] } }
```

Write `matcher.expression` against the documented alert fields only (`alert_id`, `alert_status`, `group_hash`,
`last_event_timestamp`, `severity`, `data.*`). Rule fields are not available — scope by rule with `matcher.tags`. An
expression that fails to evaluate matches nothing, so quote string values.

## Link rules and policies with routing tags

A rule and a policy are linked only by a shared string: a value in the rule's `metadata.routing_tags` that also appears
in the policy's `matcher.tags`. Neither object stores the other's id, and matching happens when alerts are dispatched,
so the rule and the policy can be written in either order; the link applies to alerts dispatched once both exist.
Kibana's rule authoring UI uses the same mechanism — it previews the policies a rule's routing tags match and lets the
user create a policy while composing the rule. Signal rules cannot carry routing tags.

1. **New rule, existing policy.** When the user names a policy ("send it through the on-call policy"), read it with
   `GET kbn:/api/alerting/v2/action_policies/{id}` and put one of its `matcher.tags` in the new rule's
   `metadata.routing_tags`. Check its `matcher.expression` as well — an expression can still exclude the rule's alerts.
   A policy without `matcher.tags` (catch-all or expression-only) needs no routing tag on the rule. When the user
   describes a policy without naming it, find it with [Find policies](#find-policies) or ask; policies cannot be
   filtered by matcher, so finding one by tag means reading every page.
2. **New rule, policy later.** When the user wants the rule now and notifications later, or names a team routing tag
   (`team-payments`), set that tag in `metadata.routing_tags` when creating the rule. Its alerts match no policy until
   one with the same value in `matcher.tags` exists; tell the user. Creating that policy later needs no rule update.
3. **Rule and policy together.** When one request asks for the rule and its notification, choose the tag once — a
   dedicated `notify-<rule-slug>` for a single rule, a shared team tag for a group — create the rule with it in
   `metadata.routing_tags`, prepare the destination workflow, then create the policy with the same value in
   `matcher.tags`. Read both back and confirm the rule's `metadata.routing_tags` and the policy's `matcher.tags` share
   the value.

## Grouping and throttle

The pair must be compatible:

| Grouping            | Valid throttle strategies                               | When `throttle` is omitted |
| ------------------- | ------------------------------------------------------- | -------------------------- |
| `per_alert`         | `on_status_change`, `per_status_interval`, `every_time` | `on_status_change`         |
| `all` / `per_field` | `time_interval`, `every_time`                           | Unthrottled                |

- `per_status_interval` and `time_interval` require `interval` (for example `"15m"`, max `"365d"`); the other strategies
  reject it.
- For `all` and `per_field`, always send `throttle`: without it the dispatcher notifies on every new alert event, like
  `every_time`.
- `per_field` fields are paths on the alert: rule query columns live under `data.` (for example `data.service.name`),
  and a path that does not resolve groups as `null`.
- Use `per_alert` + `on_status_change` for paging and incident tools, `per_field` or `all` with `time_interval` for
  digests, and `every_time` only when the user accepts one notification per evaluation.

## Create or upsert a policy

**Before every create, upsert, or update** — including a description-only `PATCH` — run the destination checks in
[universal-workflow-destinations.md](universal-workflow-destinations.md#use-an-existing-workflow) for every destination
the policy will have. Each of these writes makes the caller the policy's API key owner, so dispatched workflows run with
that user's privileges from then on. The license requirement is in [Requirements](#requirements).

Required fields: `name` and `destinations`. Optional: `description`, `matcher`, `grouping`, `throttle`. Every field and
bound is in [universal-action-policy-api-fields.md](universal-action-policy-api-fields.md).

- `POST kbn:/api/alerting/v2/action_policies` → server-generated id, 201.
- `PUT kbn:/api/alerting/v2/action_policies/{id}` → client-supplied id (`[a-zA-Z0-9_-]`, max 150 characters); 201 when
  created, 200 when it replaces an existing policy.

New policies start enabled and unsnoozed. Create, upsert, and update bodies accept only configuration fields; a body
containing `enabled` or `snoozed_until` returns 400. To start a policy paused, create it and then call `_disable` or
`_snooze`. After the write, call `GET kbn:/api/alerting/v2/action_policies/{id}` and report the live id, name, enabled
state, and matcher.

Name shared policies by intent ("Page on critical", "Notify production alerts") and single-rule policies after the rule
(`Notify on <rule-name>`).

**One rule to an on-call workflow:**

```json
{
  "name": "Notify on high-cpu-prod",
  "description": "Default notification for high-cpu-prod",
  "destinations": [{ "type": "workflow", "id": "wf-oncall-email" }],
  "matcher": { "tags": ["notify-high-cpu-prod"] },
  "grouping": { "mode": "per_alert" },
  "throttle": { "strategy": "on_status_change" }
}
```

**Page on critical alerts from production rules:**

```json
{
  "name": "Page on critical production alerts",
  "destinations": [{ "type": "workflow", "id": "wf-pagerduty" }],
  "matcher": { "tags": ["production"], "expression": "severity: \"critical\"" },
  "grouping": { "mode": "per_alert" },
  "throttle": { "strategy": "on_status_change" }
}
```

**Hourly digest per service:**

```json
{
  "name": "Hourly payments digest",
  "destinations": [{ "type": "workflow", "id": "wf-slack-digest" }],
  "matcher": { "tags": ["team-payments"] },
  "grouping": { "mode": "per_field", "fields": ["data.service.name"] },
  "throttle": { "strategy": "time_interval", "interval": "1h" }
}
```

## Update a policy

**Before every create, upsert, or update** — including a description-only `PATCH` — run the destination checks in
[universal-workflow-destinations.md](universal-workflow-destinations.md#use-an-existing-workflow) for every destination
the policy has after the update. Each of these writes makes the caller the policy's API key owner, so dispatched
workflows run with that user's privileges from then on. The license requirement is in [Requirements](#requirements).

Prefer `PATCH kbn:/api/alerting/v2/action_policies/{id}` for partial changes:

- Omitted fields are unchanged; `null` clears `description`, `matcher`, `grouping`, or `throttle`.
- `matcher` leaves merge independently: `{ "matcher": { "expression": null } }` removes the KQL and keeps the tags.
- `destinations`, `grouping`, and `throttle` are replaced whole — re-send `interval` when changing a throttle.
- The merged result is re-validated, so an incompatible grouping and throttle pair returns 400.

Use `PUT` only to replace the full configuration; fields left out of a PUT body are removed. Both PATCH and PUT keep the
policy's enabled and snooze state. On **409** `ACTION_POLICY_VERSION_CONFLICT`, another caller changed the policy —
re-read it with `GET` and retry. The id is permanent; to change it, create a new policy and delete the old one.

## Lifecycle

- **Snooze** — a pause with a known end. `POST kbn:/api/alerting/v2/action_policies/{id}/_snooze` with
  `{ "snoozed_until": "<ISO-8601>" }`. The timestamp must be in the future; convert durations ("for 2 hours") to an
  absolute UTC time. Snooze works on enabled and disabled policies and leaves `enabled` unchanged. Snoozing again
  replaces the end time; dispatch resumes on its own once it passes. End it early with
  `POST kbn:/api/alerting/v2/action_policies/{id}/_unsnooze`.
- **Disable** — an open-ended stop. `POST kbn:/api/alerting/v2/action_policies/{id}/_disable`; resume with
  `POST kbn:/api/alerting/v2/action_policies/{id}/_enable` (license-gated).
- **Rotate the API key** — `POST kbn:/api/alerting/v2/action_policies/{id}/_update_api_key` binds the policy to the
  caller's credentials. Use it when the original owner lost privileges or left, after the destination requirements in
  [universal-workflow-destinations.md](universal-workflow-destinations.md) hold for the caller.
- **Delete** — `DELETE kbn:/api/alerting/v2/action_policies/{id}` (204). Confirm with the user first.

## Bulk changes

Resolve ids with [Find policies](#find-policies) first, then send `{ "ids": [...] }` (1–100 unique ids) to the matching
endpoint:

- `POST kbn:/api/alerting/v2/action_policies/_bulk_enable` (license-gated)
- `POST kbn:/api/alerting/v2/action_policies/_bulk_disable`
- `POST kbn:/api/alerting/v2/action_policies/_bulk_snooze` (also takes `snoozed_until`)
- `POST kbn:/api/alerting/v2/action_policies/_bulk_unsnooze`
- `POST kbn:/api/alerting/v2/action_policies/_bulk_update_api_key`
- `POST kbn:/api/alerting/v2/action_policies/_bulk_delete` (confirm with the user first)

The response is 200 even when some ids fail — read `affected_count` and every entry in `errors` (`id`, `error.code`,
`error.message`) and report each failure.

## Ownership and portability

- Every create, upsert, update (including a description-only `PATCH`), and key rotation binds the policy to the caller's
  credentials, and dispatched workflows run with those privileges. Re-check the destination requirements before each of
  these writes, even when `destinations` does not change.
- Anyone who can edit a destination workflow can run steps with the owner's privileges, so own policies with a user
  whose privileges match what the destination workflows need, not an administrator.
- Authenticate as a user or with an Elasticsearch API key; Elastic Cloud (UIAM) API keys are rejected with 400
  `ACTION_POLICY_CLOUD_API_KEY_NOT_SUPPORTED`.
- The stored API key is encrypted, and policies are not part of saved-object import or export. Recreate them with `PUT`
  (stable ids) in each space or cluster.
- The `elasticstack` Terraform provider has no action policy resource. Manage policies as code by storing request bodies
  and applying them with `PUT` and a stable id.

## Common failure modes

1. **Unverified destination** — writing a policy before checking the workflow; the API accepts any id.
2. **Tag missing from routing tags** — `matcher.tags` only matches tags in a rule's `metadata.routing_tags`.
3. **Accidental catch-all** — omitting `matcher` without the user confirming it.
4. **Unthrottled digest** — `all` or `per_field` without `throttle` notifies on every new alert event.
5. **Lifecycle fields in a write body** — `enabled` or `snoozed_until` in a create or update returns 400.
6. **PUT for a partial change** — removes every field left out of the body.
7. **Treating bulk 200 as success** — per-id failures are only in `errors`.
