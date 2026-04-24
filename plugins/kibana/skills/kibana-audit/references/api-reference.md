# Kibana Audit Logging Reference

Reference for Kibana audit logging configuration, event types, event schema, and correlation with Elasticsearch audit
logs. For full documentation, see the linked Elastic docs.

[Full documentation](https://www.elastic.co/guide/en/kibana/current/xpack-security-audit-logging.html)

## Configuration (`kibana.yml`)

All Kibana audit settings are configured in `kibana.yml`. A restart is required after changes.

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
xpack.security.audit.ignore_filters:
  - actions: [saved_object_find]
    categories: [database]
```

### Core settings

| Setting                              | Type    | Default | Description                                 |
| ------------------------------------ | ------- | ------- | ------------------------------------------- |
| `xpack.security.audit.enabled`       | boolean | `false` | Enable Kibana audit logging                 |
| `xpack.security.audit.appender`      | object  | —       | Log output configuration (file type/policy) |
| `xpack.security.audit.appender.type` | string  | —       | `rolling-file` or `console`                 |

### Rolling-file appender settings

| Setting                                         | Type   | Default | Description                           |
| ----------------------------------------------- | ------ | ------- | ------------------------------------- |
| `xpack.security.audit.appender.fileName`        | string | —       | Path to the audit log file            |
| `xpack.security.audit.appender.policy.type`     | string | —       | `time-interval` or `size-limit`       |
| `xpack.security.audit.appender.policy.interval` | string | —       | Rotation interval (e.g. `24h`)        |
| `xpack.security.audit.appender.strategy.type`   | string | —       | `numeric`                             |
| `xpack.security.audit.appender.strategy.max`    | number | —       | Max number of rotated files to retain |

### Ignore filter settings

| Setting                                            | Type | Default | Description                |
| -------------------------------------------------- | ---- | ------- | -------------------------- |
| `xpack.security.audit.ignore_filters`              | list | `[]`    | Array of filter rules      |
| `xpack.security.audit.ignore_filters[].actions`    | list | —       | Event actions to ignore    |
| `xpack.security.audit.ignore_filters[].categories` | list | —       | Event categories to ignore |

An event is filtered out if it matches **all** non-empty fields within a single filter entry.

## Event Types

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

## Event Schema

Key ECS and Kibana-specific fields in each audit event:

| Field                            | Type    | Description                                           |
| -------------------------------- | ------- | ----------------------------------------------------- |
| `@timestamp`                     | date    | Event timestamp                                       |
| `event.action`                   | keyword | Event type (e.g. `saved_object_create`)               |
| `event.category`                 | keyword | Category (`authentication`, `database`, `web`)        |
| `event.outcome`                  | keyword | `success`, `failure`, or `unknown`                    |
| `user.name`                      | keyword | Authenticated username                                |
| `user.roles`                     | keyword | Roles assigned to the user                            |
| `trace.id`                       | keyword | Correlation ID shared with Elasticsearch requests     |
| `kibana.saved_object.type`       | keyword | Saved object type (e.g. `dashboard`, `index-pattern`) |
| `kibana.saved_object.id`         | keyword | Saved object ID                                       |
| `kibana.space_id`                | keyword | Kibana space where the event occurred                 |
| `kibana.authentication_provider` | keyword | Auth provider used (e.g. `saml1`, `basic`)            |
| `http.request.method`            | keyword | HTTP method for web events                            |
| `url.path`                       | keyword | Request path                                          |
| `source.ip`                      | ip      | Client IP address                                     |

## Correlating with Elasticsearch Audit Logs

The `trace.id` field is the primary correlation key. When Kibana makes a request to Elasticsearch on behalf of a user,
it passes an `X-Opaque-Id` header that both systems record as `trace.id`.

### Correlation workflow

1. Find the suspicious event in the Kibana audit log (from the log file or shipped to an index).
2. Extract the `trace.id` value.
3. Search the ES audit index for all events with the same `trace.id`.
4. Review the combined timeline to understand what ES-level operations the Kibana action triggered.

### Find all ES audit events for a Kibana trace

```json
POST /.security-audit-*/_search
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "trace.id": "abc123-trace-id" } }
      ]
    }
  },
  "sort": [{ "@timestamp": "asc" }]
}
```

### Correlate by user and time window

When `trace.id` is not available (e.g. direct API calls), fall back to user + time correlation:

```json
POST /.security-audit-*/_search
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "user.name": "joe" } },
        { "range": { "@timestamp": { "gte": "2025-06-15T10:00:00Z", "lte": "2025-06-15T10:05:00Z" } } }
      ]
    }
  },
  "sort": [{ "@timestamp": "asc" }]
}
```

### Ship Kibana audit logs to Elasticsearch for unified querying

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
