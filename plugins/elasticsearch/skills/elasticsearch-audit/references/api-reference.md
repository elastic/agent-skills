# Elasticsearch Audit Logging API Reference

Quick reference for Elasticsearch audit logging configuration via the cluster settings API and audit event querying. For
Kibana audit logging, see the **kibana-audit** skill. For full documentation, see the linked Elastic docs.

## Cluster Settings — Audit Configuration

```text
PUT /_cluster/settings
```

All audit settings are configured under the `xpack.security.audit` namespace in `persistent` (survives restart) or
`transient` (cleared on restart) cluster settings.

[Full documentation](https://www.elastic.co/guide/en/elasticsearch/reference/current/auditing-settings.html)

### Core settings

| Setting                        | Type    | Default     | Description                             |
| ------------------------------ | ------- | ----------- | --------------------------------------- |
| `xpack.security.audit.enabled` | boolean | `false`     | Enable or disable audit logging         |
| `xpack.security.audit.outputs` | list    | `[logfile]` | Output destinations: `logfile`, `index` |

### Event selection settings

| Setting                                                 | Type | Default | Description                          |
| ------------------------------------------------------- | ---- | ------- | ------------------------------------ |
| `xpack.security.audit.logfile.events.include`           | list | all     | Event types to record (whitelist)    |
| `xpack.security.audit.logfile.events.exclude`           | list | none    | Event types to suppress (blacklist)  |
| `xpack.security.audit.logfile.events.emit_request_body` | bool | `false` | Include request body in audit events |

When both `include` and `exclude` are set, `include` is applied first, then `exclude` removes from that set.

### Filter policy settings

Filter policies are nested under `xpack.security.audit.logfile.events.ignore_filters.<policy_name>`:

| Field     | Type | Description                                          |
| --------- | ---- | ---------------------------------------------------- |
| `users`   | list | Usernames to exclude (supports wildcards like `*`)   |
| `realms`  | list | Realm names to exclude                               |
| `roles`   | list | Role names to exclude                                |
| `indices` | list | Index names or patterns to exclude                   |
| `actions` | list | Action names to exclude (e.g. `indices:data/read/*`) |

An event is filtered out only when it matches **all** non-empty fields in the policy. Empty fields are ignored (match
anything).

## Audit Event Types

| Event                     | Description                                          | Key fields                            |
| ------------------------- | ---------------------------------------------------- | ------------------------------------- |
| `authentication_failed`   | Credentials were rejected by all realms              | `user.name`, `source.ip`, `realm`     |
| `authentication_success`  | User authenticated successfully                      | `user.name`, `source.ip`, `realm`     |
| `access_granted`          | An authorized action was performed                   | `user.name`, `indices`, `action`      |
| `access_denied`           | An action was denied (insufficient privileges)       | `user.name`, `indices`, `action`      |
| `anonymous_access_denied` | An unauthenticated request was rejected              | `source.ip`, `action`                 |
| `tampered_request`        | A request was detected as tampered with              | `source.ip`, `action`                 |
| `connection_granted`      | A transport-layer node connection was accepted       | `source.ip`, `node.name`              |
| `connection_denied`       | A transport-layer node connection was rejected       | `source.ip`                           |
| `run_as_granted`          | A run-as impersonation was authorized                | `user.name`, `run_as.user`, `action`  |
| `run_as_denied`           | A run-as impersonation was denied                    | `user.name`, `run_as.user`, `action`  |
| `security_config_change`  | A security resource was created, updated, or deleted | `user.name`, `action`, `request.body` |

### security_config_change sub-events

The `security_config_change` event captures changes to security resources. The `event.type` field indicates the
operation:

| `event.type` | Trigger                                             |
| ------------ | --------------------------------------------------- |
| `change`     | A role, user, role mapping, or API key was modified |
| `creation`   | A new security resource was created                 |
| `deletion`   | A security resource was deleted                     |

## Audit Index Schema

When the `index` output is enabled, audit events are stored in `.security-audit-<date>` indices. Key fields:

| Field          | Type    | Description                                        |
| -------------- | ------- | -------------------------------------------------- |
| `@timestamp`   | date    | Event timestamp                                    |
| `event.action` | keyword | Event type (e.g. `authentication_failed`)          |
| `event.type`   | keyword | Sub-type for config changes (`change`, `creation`) |
| `user.name`    | keyword | Authenticated username                             |
| `user.realm`   | keyword | Realm that authenticated the user                  |
| `user.roles`   | keyword | Roles assigned to the user                         |
| `source.ip`    | ip      | Client IP address                                  |
| `action`       | keyword | Elasticsearch action name                          |
| `indices`      | keyword | Target index names or patterns                     |
| `request.name` | keyword | Request type (e.g. `SearchRequest`)                |
| `request.body` | text    | Request body (only if `emit_request_body` is true) |
| `node.name`    | keyword | Node that handled the request                      |
| `node.id`      | keyword | Node ID                                            |

## Query Examples

### Failed logins in the last 24 hours

```json
POST /.security-audit-*/_search
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "event.action": "authentication_failed" } },
        { "range": { "@timestamp": { "gte": "now-24h" } } }
      ]
    }
  },
  "sort": [{ "@timestamp": "desc" }],
  "size": 50
}
```

### Access denied events for a specific user

```json
POST /.security-audit-*/_search
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "event.action": "access_denied" } },
        { "term": { "user.name": "joe" } },
        { "range": { "@timestamp": { "gte": "now-7d" } } }
      ]
    }
  },
  "sort": [{ "@timestamp": "desc" }],
  "size": 20
}
```

### All security config changes (role/user/key creation and deletion)

```json
POST /.security-audit-*/_search
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "event.action": "security_config_change" } },
        { "range": { "@timestamp": { "gte": "now-30d" } } }
      ]
    }
  },
  "sort": [{ "@timestamp": "desc" }],
  "size": 100
}
```

### Top denied actions by user (aggregation)

```json
POST /.security-audit-*/_search
{
  "size": 0,
  "query": {
    "bool": {
      "filter": [
        { "term": { "event.action": "access_denied" } },
        { "range": { "@timestamp": { "gte": "now-7d" } } }
      ]
    }
  },
  "aggs": {
    "by_user": {
      "terms": { "field": "user.name", "size": 10 },
      "aggs": {
        "denied_actions": {
          "terms": { "field": "action", "size": 5 }
        }
      }
    }
  }
}
```

### Count events by type over the last 24 hours

```json
POST /.security-audit-*/_search
{
  "size": 0,
  "query": {
    "range": { "@timestamp": { "gte": "now-24h" } }
  },
  "aggs": {
    "event_types": {
      "terms": { "field": "event.action", "size": 20 }
    }
  }
}
```

### Brute-force detection (repeated failed logins by source IP)

```json
POST /.security-audit-*/_search
{
  "size": 0,
  "query": {
    "bool": {
      "filter": [
        { "term": { "event.action": "authentication_failed" } },
        { "range": { "@timestamp": { "gte": "now-1h" } } }
      ]
    }
  },
  "aggs": {
    "by_source": {
      "terms": { "field": "source.ip", "size": 10, "min_doc_count": 5 }
    }
  }
}
```

Returns source IPs with 5+ failed authentication attempts in the last hour.
