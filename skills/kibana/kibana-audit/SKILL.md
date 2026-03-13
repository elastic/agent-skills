---
name: kibana-audit
description: >
  Enable and configure Kibana audit logging for saved object access, logins, and space
  operations. Use when setting up Kibana audit, filtering events, or correlating Kibana
  and ES audit logs.
metadata:
  author: elastic
  version: 0.1.0
---

# Kibana Audit Logging

Enable and configure audit logging for Kibana via `kibana.yml`. Kibana audit logs cover application-layer security
events that Elasticsearch does not see: saved object CRUD (dashboards, visualizations, index patterns, rules, cases),
login/logout, session expiry, space operations, and Kibana-level RBAC enforcement.

For Elasticsearch audit logging (authentication failures, access grants/denials, security config changes), see
**elasticsearch-audit**. For authentication and API key management, see **elasticsearch-authn**. For roles and user
management, see **elasticsearch-authz**.

For detailed event types, schema, and correlation queries, see
[references/api-reference.md](references/api-reference.md).

> **Deployment note:** Kibana audit configuration differs across deployment types. See
> [Deployment Compatibility](#deployment-compatibility) for details.

## Jobs to Be Done

- Enable or disable Kibana audit logging
- Configure audit log output (rolling file, console)
- Filter out noisy events (e.g. `saved_object_find`)
- Investigate saved object access or deletion events
- Track Kibana login/logout and session activity
- Monitor space creation, modification, and deletion
- Correlate Kibana audit events with Elasticsearch audit logs via `trace.id`
- Ship Kibana audit logs to Elasticsearch for unified querying

## Prerequisites

| Item                  | Description                                                                    |
| --------------------- | ------------------------------------------------------------------------------ |
| **Kibana access**     | Filesystem access to `kibana.yml` (self-managed) or Cloud console access (ECH) |
| **License**           | Audit logging requires a gold, platinum, enterprise, or trial license          |
| **Elasticsearch URL** | Cluster endpoint for correlation queries against `.security-audit-*`           |

Prompt the user for any missing values.

## Enable Kibana Audit Logging

Kibana audit is configured statically in `kibana.yml` (not via API). A Kibana restart is required after changes.

```yaml
xpack.security.audit.enabled: true
xpack.security.audit.appender:
  type: rolling-file
  fileName: /path/to/kibana/data/audit.log
  policy:
    type: time-interval
    interval: 24h
  strategy:
    type: numeric
    max: 10
```

To disable, set `xpack.security.audit.enabled` to `false` and restart Kibana.

### Appender types

| Type           | Description                                             |
| -------------- | ------------------------------------------------------- |
| `rolling-file` | Writes to a file with rotation policy. Recommended.     |
| `console`      | Writes to stdout. Useful for containerized deployments. |

## Event Types

Kibana audit events use ECS format with the same core fields as ES audit (`event.action`, `event.outcome`, `user.name`,
`trace.id`, `@timestamp`) plus Kibana-specific fields like `kibana.saved_object.type`, `kibana.saved_object.id`, and
`kibana.space_id`.

Key event actions:

| Event action                       | Description                                  | Category       |
| ---------------------------------- | -------------------------------------------- | -------------- |
| `saved_object_create`              | A saved object was created                   | database       |
| `saved_object_get`                 | A saved object was read                      | database       |
| `saved_object_update`              | A saved object was updated                   | database       |
| `saved_object_delete`              | A saved object was deleted                   | database       |
| `saved_object_find`                | A saved object search was performed          | database       |
| `saved_object_open_point_in_time`  | A PIT was opened on saved objects            | database       |
| `saved_object_close_point_in_time` | A PIT was closed on saved objects            | database       |
| `saved_object_resolve`             | A saved object was resolved (alias redirect) | database       |
| `login`                            | A user logged in (success or failure)        | authentication |
| `logout`                           | A user logged out                            | authentication |
| `session_cleanup`                  | An expired session was cleaned up            | authentication |
| `access_agreement_acknowledged`    | A user accepted the access agreement         | authentication |
| `space_create`                     | A Kibana space was created                   | web            |
| `space_update`                     | A Kibana space was updated                   | web            |
| `space_delete`                     | A Kibana space was deleted                   | web            |
| `space_get`                        | A Kibana space was retrieved                 | web            |

See [references/api-reference.md](references/api-reference.md) for the complete event schema.

## Filter Policies

Suppress noisy events using `ignore_filters` in `kibana.yml`:

```yaml
xpack.security.audit.ignore_filters:
  - actions: [saved_object_find]
    categories: [database]
```

| Filter field | Type | Description                |
| ------------ | ---- | -------------------------- |
| `actions`    | list | Event actions to ignore    |
| `categories` | list | Event categories to ignore |

An event is filtered out if it matches **all** specified fields within a single filter entry.

## Correlate with Elasticsearch Audit Logs

When Kibana makes requests to Elasticsearch on behalf of a user, both systems record the same `trace.id` (passed via the
`X-Opaque-Id` header). This is the primary key for correlating events across the two audit logs.

> **Prerequisite:** Elasticsearch audit must be enabled via the cluster settings API. See the **elasticsearch-audit**
> skill for setup instructions, event types, and ES-specific filter policies.

### Correlation workflow

1. Find the suspicious event in the Kibana audit log.
2. Extract its `trace.id` value.
3. Search the ES audit index (`.security-audit-*`) for all events with the same `trace.id`.
4. Review the combined timeline to understand what ES-level operations the Kibana action triggered.

The **elasticsearch-audit** skill also documents this workflow from the ES side — use it when starting from an ES audit
event and looking for the originating Kibana action.

### Search ES audit by trace ID

Given a suspicious Kibana event (e.g. a saved object deletion), extract its `trace.id` and search the ES audit index:

```bash
curl -X POST "${ELASTICSEARCH_URL}/.security-audit-*/_search" \
  <auth_flags> \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "bool": {
        "filter": [
          { "term": { "trace.id": "'"${TRACE_ID}"'" } },
          { "range": { "@timestamp": { "gte": "now-24h" } } }
        ]
      }
    },
    "sort": [{ "@timestamp": { "order": "asc" } }]
  }'
```

Secondary correlation fields: `user.name`, `source.ip`, and `@timestamp` (time-window joins).

### Ship Kibana audit logs to Elasticsearch

To query Kibana audit events alongside ES audit events, ship the Kibana audit log file to an Elasticsearch index using
Filebeat:

```yaml
filebeat.inputs:
  - type: log
    paths: ["/path/to/kibana/data/audit.log"]
    json.keys_under_root: true
    json.add_error_key: true

output.elasticsearch:
  hosts: ["https://localhost:9200"]
  index: "kibana-audit-%{+yyyy.MM.dd}"
```

Once indexed, both `.security-audit-*` (ES) and `kibana-audit-*` (Kibana) can be searched together using a multi-index
query filtered by `trace.id`.

## Examples

### Enable Kibana audit for compliance

**Request:** "Enable Kibana audit logging and keep 10 rotated log files."

```yaml
xpack.security.audit.enabled: true
xpack.security.audit.appender:
  type: rolling-file
  fileName: /var/log/kibana/audit.log
  policy:
    type: time-interval
    interval: 24h
  strategy:
    type: numeric
    max: 10
```

Restart Kibana after applying.

### Investigate a deleted dashboard

**Request:** "Someone deleted a dashboard. Check the Kibana audit log."

Search the Kibana audit log (or the indexed `kibana-audit-*` data) for `saved_object_delete` events with
`kibana.saved_object.type: dashboard`. Extract the `trace.id` and cross-reference with the ES audit index to see the
underlying Elasticsearch operations.

### Reduce audit noise from saved object searches

**Request:** "Kibana audit logs are too large because of constant saved_object_find events."

```yaml
xpack.security.audit.ignore_filters:
  - actions: [saved_object_find]
    categories: [database]
```

This suppresses high-volume read operations while preserving create, update, and delete events.

## Guidelines

### Always enable alongside Elasticsearch audit

For full coverage, enable audit in both `kibana.yml` and Elasticsearch. Without Kibana audit, saved object access and
Kibana login events are invisible. Without ES audit, cluster-level operations are invisible. See the
**elasticsearch-audit** skill for ES-side setup.

### Use trace.id for correlation

When investigating a Kibana event, always extract `trace.id` and search the ES audit index (`.security-audit-*`). This
reveals the full chain of operations triggered by a single Kibana action. See
[Correlate with Elasticsearch Audit Logs](#correlate-with-elasticsearch-audit-logs) above for queries.

### Filter noisy read events

`saved_object_find` generates very high volume on busy Kibana instances. Suppress it unless you specifically need to
audit read access.

### Ship logs to Elasticsearch for unified querying

Kibana audit logs are written to files by default. Ship them to Elasticsearch via Filebeat for programmatic querying
alongside ES audit events.

### Rotate and retain appropriately

Configure rolling-file rotation to avoid filling the disk. A 30-90 day retention is typical for compliance.

## Deployment Compatibility

| Capability                  | Self-managed | ECH          | Serverless    |
| --------------------------- | ------------ | ------------ | ------------- |
| Kibana audit (`kibana.yml`) | Yes          | Via Cloud UI | Not available |
| Rolling-file appender       | Yes          | Via Cloud UI | Not available |
| Console appender            | Yes          | Yes          | Not available |
| Ignore filters              | Yes          | Via Cloud UI | Not available |
| Correlate via `trace.id`    | Yes          | Yes          | Not available |
| Ship to ES via Filebeat     | Yes          | Yes          | Not available |

**ECH notes:** Kibana audit is enabled via the deployment edit page in the Cloud console. Log files are accessible
through the Cloud console deployment logs.

**Serverless notes:**

- Kibana audit logging is not user-configurable on Serverless. Security events are managed by Elastic as part of the
  platform.
- If a user asks about Kibana auditing on Serverless, direct them to the Elastic Cloud console or their account team.
