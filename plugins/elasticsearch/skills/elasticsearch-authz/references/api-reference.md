# Elasticsearch Authorization API Reference

Quick reference for the user, role, and role mapping APIs. For full documentation, see the linked Elastic docs.

## Users — Create or Update

```text
PUT /_security/user/{username}
POST /_security/user/{username}
```

Create a new native user or update an existing one.

[Full documentation](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-security-put-user)

### Required privileges

`manage_security` cluster privilege.

### Request body

```json
{
  "password": "X9k#mP2vL!qR7wZn",
  "roles": ["role-a", "role-b"],
  "full_name": "Jane Doe",
  "email": "jane@example.com",
  "enabled": true,
  "metadata": {}
}
```

| Field           | Type          | Description                                              |
| --------------- | ------------- | -------------------------------------------------------- |
| `password`      | string        | Required for new users; at least 6 characters            |
| `password_hash` | string        | Pre-hashed password (mutually exclusive with `password`) |
| `roles`         | array[string] | Roles to assign (required)                               |
| `full_name`     | string        | Display name                                             |
| `email`         | string        | Email address                                            |
| `enabled`       | boolean       | Active status (default: `true`)                          |
| `metadata`      | object        | Arbitrary metadata; keys with `_` prefix are reserved    |

### Response

| Field     | Type | Description                                    |
| --------- | ---- | ---------------------------------------------- |
| `created` | bool | `true` if new user; `false` if existing update |

## Users — Change Password

```text
POST /_security/user/{username}/_password
```

### Request body

```json
{ "password": "new-strong-password" }
```

## Users — Enable / Disable

```text
PUT /_security/user/{username}/_enable
PUT /_security/user/{username}/_disable
```

## Users — Get / Delete

```text
GET /_security/user/{username}
GET /_security/user
DELETE /_security/user/{username}
```

## Roles — Create or Update (Elasticsearch API)

```text
PUT /_security/role/{name}
POST /_security/role/{name}
```

Create or update a role. Default choice when the role only needs `cluster` and `indices` privileges. This API **cannot**
set Kibana feature grants, space scoping, or base privileges — use the Kibana role API below when Kibana access is
required.

[Full documentation](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-security-put-role)

### Required privileges

`manage_security` cluster privilege.

### Request body

```json
{
  "description": "Logs Reader",
  "cluster": [],
  "indices": [
    {
      "names": ["index-pattern-*"],
      "privileges": ["read", "view_index_metadata"],
      "field_security": { "grant": ["field1", "field2"] },
      "query": "{\"term\": {\"department\": \"marketing\"}}"
    }
  ],
  "applications": [],
  "run_as": [],
  "metadata": {}
}
```

| Field                      | Type          | Description                                           |
| -------------------------- | ------------- | ----------------------------------------------------- |
| `description`              | string        | Short display name shown in Kibana UI                 |
| `cluster`                  | array[string] | Cluster privileges                                    |
| `indices`                  | array[object] | Index privilege entries                               |
| `indices[].names`          | array[string] | Index names or patterns                               |
| `indices[].privileges`     | array[string] | Named index privileges                                |
| `indices[].field_security` | object        | Field-level security grants and exceptions            |
| `indices[].query`          | string        | Document-level security query (Query DSL JSON string) |
| `applications`             | array[object] | Application privilege entries (e.g. Kibana features)  |
| `run_as`                   | array[string] | Users this role can impersonate                       |
| `metadata`                 | object        | Arbitrary metadata                                    |

## Roles — Create or Update (Kibana API)

```text
PUT <KIBANA_URL>/api/security/role/{name}
```

Create or update a role via Kibana. Required when the role includes Kibana feature or space privileges. Falls back to
the Elasticsearch API if the Kibana endpoint is unavailable. Requires the `kbn-xsrf` header.

### Request body

```json
{
  "description": "Logs Dashboard Viewer",
  "elasticsearch": {
    "cluster": [],
    "indices": [{ "names": ["logs-*"], "privileges": ["read", "view_index_metadata"] }]
  },
  "kibana": [
    {
      "base": [],
      "feature": { "discover": ["read"], "dashboard": ["read"] },
      "spaces": ["*"]
    }
  ]
}
```

| Field                   | Type          | Description                                                     |
| ----------------------- | ------------- | --------------------------------------------------------------- |
| `description`           | string        | Short display name shown in Kibana UI                           |
| `elasticsearch.cluster` | array[string] | Cluster privileges                                              |
| `elasticsearch.indices` | array[object] | Index privilege entries (same structure as the ES role API)     |
| `kibana`                | array[object] | Kibana privilege entries                                        |
| `kibana[].base`         | array[string] | Base Kibana privileges (`all`, `read`); empty for feature-level |
| `kibana[].feature`      | object        | Feature-level privileges keyed by feature ID                    |
| `kibana[].spaces`       | array[string] | Space IDs to scope to; `["*"]` for all spaces                   |

### Common Kibana feature IDs

| Feature ID      | Application          |
| --------------- | -------------------- |
| `discover`      | Discover             |
| `dashboard`     | Dashboards           |
| `visualize`     | Visualize Library    |
| `maps`          | Maps                 |
| `canvas`        | Canvas               |
| `ml`            | Machine Learning     |
| `apm`           | APM                  |
| `siem`          | Security (SIEM)      |
| `observability` | Observability        |
| `fleet`         | Fleet                |
| `actions`       | Connectors and Rules |

Feature privilege values: `all`, `read`, `minimal_all`, `minimal_read`.

## Roles — Get / Delete

```text
GET /_security/role/{name}
GET /_security/role
DELETE /_security/role/{name}
GET <KIBANA_URL>/api/security/role/{name}
GET <KIBANA_URL>/api/security/role
```

Built-in roles cannot be deleted.

## Role Mappings — Create or Update

```text
PUT /_security/role_mapping/{name}
POST /_security/role_mapping/{name}
```

Assign roles to users from external realms based on matching rules.

[Full documentation](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-security-put-role-mapping)

### Required privileges

`manage_security` cluster privilege.

### Request body

```json
{
  "roles": ["viewer"],
  "enabled": true,
  "rules": { "field": { "realm.name": "saml1" } },
  "metadata": {}
}
```

| Field            | Type          | Description                                                                |
| ---------------- | ------------- | -------------------------------------------------------------------------- |
| `roles`          | array[string] | Static roles to assign; mutually exclusive with `role_templates`           |
| `role_templates` | array[object] | Mustache templates for dynamic role names; mutually exclusive with `roles` |
| `enabled`        | boolean       | Whether the mapping is active (default: `true`)                            |
| `rules`          | object        | Rule tree using `all`, `any`, `field`, `except` operators                  |
| `metadata`       | object        | Arbitrary metadata                                                         |

### Rule operators

| Operator | Description                                          |
| -------- | ---------------------------------------------------- |
| `all`    | True if every child rule is true (logical AND)       |
| `any`    | True if at least one child rule is true (logical OR) |
| `field`  | Matches a user attribute against a value or pattern  |
| `except` | Negates a child rule; only valid inside `all`        |

### User fields available in rules and templates

| Field      | Description                        |
| ---------- | ---------------------------------- |
| `username` | Elasticsearch username             |
| `dn`       | Distinguished Name (LDAP/PKI)      |
| `groups`   | Group memberships (array)          |
| `realm`    | Realm object with `name` sub-field |
| `metadata` | User metadata key-value pairs      |

### Mustache template patterns

Map LDAP groups directly to role names:

```json
{
  "role_templates": [{ "template": { "source": "{{#tojson}}groups{{/tojson}}" }, "format": "json" }],
  "rules": { "field": { "realm.name": "ldap1" } }
}
```

Derive a role from realm and username:

```json
{
  "role_templates": [{ "template": { "source": "{{realm.name}}-{{username}}" } }],
  "rules": { "field": { "realm.name": "saml1" } }
}
```

Base role plus group-derived roles:

```json
{
  "role_templates": [
    {
      "template": { "source": "[\"viewer\"{{#groups}},\"{{.}}\"{{/groups}}]" },
      "format": "json"
    }
  ],
  "rules": { "field": { "realm.name": "saml1" } }
}
```

## Role Mappings — Get / Delete

```text
GET /_security/role_mapping/{name}
GET /_security/role_mapping
DELETE /_security/role_mapping/{name}
```

## Named Index Privileges

| Privilege             | Grants                                       |
| --------------------- | -------------------------------------------- |
| `read`                | Read and search documents                    |
| `view_index_metadata` | View index and data stream metadata          |
| `write`               | Index, update, and delete documents          |
| `create`              | Index documents (but not update or delete)   |
| `create_index`        | Create indices and data streams              |
| `index`               | Index and update documents                   |
| `delete`              | Delete documents                             |
| `delete_index`        | Delete indices and data streams              |
| `manage`              | Manage index settings, aliases, and mappings |
| `monitor`             | Monitor index stats and status               |
| `all`                 | Full control over the index                  |

## Common Cluster Privileges

Prefer fine-grained privileges. Only use `manage` or `all` when no specific privilege covers the required access.

| Privilege                 | Grants                                    |
| ------------------------- | ----------------------------------------- |
| `monitor`                 | Read-only cluster monitoring              |
| `manage_ingest_pipelines` | Manage ingest pipelines                   |
| `manage_index_templates`  | Manage index and component templates      |
| `manage_ilm`              | Manage index lifecycle policies           |
| `manage_ml`               | Manage machine learning jobs              |
| `manage_security`         | Manage users, roles, and API keys         |
| `manage_own_api_key`      | Manage API keys owned by the current user |
| `manage`                  | Cluster management (excluding security)   |
| `all`                     | Full cluster access                       |

For the authoritative list, call `GET /_security/privilege/_builtin`.

## Document-Level Security (DLS)

The `query` field on an index privilege entry restricts which documents the role can access. The value is a JSON string
containing a Query DSL filter. The filter is applied transparently to all searches, gets, and aggregations.

### Static DLS query

```json
{
  "indices": [
    {
      "names": ["logs-*"],
      "privileges": ["read"],
      "query": "{\"term\": {\"region\": \"emea\"}}"
    }
  ]
}
```

### Templated DLS query (ABAC)

Use Mustache templates to inject user metadata into the query at runtime. Reference user attributes with
`{{_user.metadata.<key>}}`.

**Single-value attribute** — user sees only documents matching their department:

```json
{
  "query": "{\"template\": {\"source\": \"{\\\"term\\\": {\\\"department\\\": \\\"{{_user.metadata.department}}\\\"}}\"}}"
}
```

User metadata: `{"department": "engineering"}` -> filter: `{"term": {"department": "engineering"}}`.

**Multi-value attribute with `terms_set`** — user must hold all required programs listed on the document:

```json
{
  "query": "{\"template\": {\"source\": \"{\\\"terms_set\\\": {\\\"required_programs\\\": {\\\"terms\\\": {{#toJson}}_user.metadata.programs{{/toJson}}, \\\"minimum_should_match_field\\\": \\\"min_required_programs\\\"}}}\"}}"
}
```

Documents must include a `min_required_programs` numeric field. The `terms_set` query checks that the user's `programs`
list contains at least that many of the document's `required_programs`.

**Combined ABAC: security level + programs + certification date:**

```json
{
  "query": "{\"template\": {\"source\": \"{\\\"bool\\\": {\\\"filter\\\": [{\\\"range\\\": {\\\"security_level\\\": {\\\"lte\\\": \\\"{{_user.metadata.level}}\\\"}}}, {\\\"terms_set\\\": {\\\"required_programs\\\": {\\\"terms\\\": {{#toJson}}_user.metadata.programs{{/toJson}}, \\\"minimum_should_match_field\\\": \\\"min_required_programs\\\"}}}, {\\\"script\\\": {\\\"script\\\": {\\\"source\\\": \\\"LocalDateTime.parse(params['cert_date']).plusYears(1).isAfter(LocalDateTime.now())\\\", \\\"params\\\": {\\\"cert_date\\\": \\\"{{_user.metadata.certification_date}}\\\"}}}}]}}\"}}"
}
```

This enforces three conditions per document:

1. User's `level` >= document's `security_level`.
1. User's `programs` list covers the document's `required_programs`.
1. User's `certification_date` is within the last year (script-based check).

All three conditions use a single role — no per-user or per-level roles needed. Store the attributes in each user's
`metadata` field:

```json
PUT /_security/user/analyst
{
  "password": "...",
  "roles": ["program-access"],
  "metadata": {
    "level": 2,
    "programs": ["alpha", "beta"],
    "certification_date": "2025-06-15T00:00:00"
  }
}
```

## Field-Level Security (FLS)

The `field_security` object on an index privilege entry restricts which fields the role can access.

| Field    | Type          | Description                                               |
| -------- | ------------- | --------------------------------------------------------- |
| `grant`  | array[string] | Fields to include (whitelist). Use `["*"]` for all.       |
| `except` | array[string] | Fields to exclude from the grant set. Cannot use `["*"]`. |

### Whitelist specific fields

```json
{
  "field_security": {
    "grant": ["name", "email", "department"]
  }
}
```

### Blacklist sensitive fields

```json
{
  "field_security": {
    "grant": ["*"],
    "except": ["ssn", "credit_card", "salary"]
  }
}
```

### Wildcard patterns

```json
{
  "field_security": {
    "grant": ["*"],
    "except": ["pii.*", "internal_*"]
  }
}
```

FLS applies to search results, `_source`, stored fields, and doc-value fields. Aggregations on excluded fields return
empty results.
