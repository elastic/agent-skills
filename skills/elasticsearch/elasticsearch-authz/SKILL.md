---
name: elasticsearch-authz
description: >
  Manage Elasticsearch RBAC: native users, roles, role mappings, document- and field-level
  security. Use when creating users or roles, assigning privileges, or mapping external
  realms like LDAP/SAML.
compatibility: >
  Requires network access to Elasticsearch. Kibana endpoint needed for Kibana role
  API. Serverless role assignment requires the cloud-access-management skill.
metadata:
  author: elastic
  version: 0.1.1
---

# Elasticsearch Authorization

Manage Elasticsearch role-based access control: native users, roles, role assignment, and role mappings for external
realms.

For authentication methods and API key management, see the **elasticsearch-authn** skill.

For detailed API endpoints, see [references/api-reference.md](references/api-reference.md).

> **Deployment note:** Feature availability differs between self-managed, ECH, and Serverless. See
> [Deployment Compatibility](#deployment-compatibility) for details.

## Jobs to Be Done

- Create a native user with a specific set of privileges
- Define a custom role with least-privilege index and cluster access
- Assign one or more roles to an existing user
- Create a role with Kibana feature or space privileges
- Configure a role mapping for external realm users (SAML, LDAP, PKI)
- Derive role assignments dynamically from user attributes (Mustache templates)
- Restrict document visibility per user or department (document-level security)
- Hide sensitive fields like PII from certain roles (field-level security)
- Implement attribute-based access control (ABAC) using templated role queries
- Translate a natural-language access request into user, role, and role mapping tasks

## Prerequisites

| Item                   | Description                                                                |
| ---------------------- | -------------------------------------------------------------------------- |
| **Elasticsearch URL**  | Cluster endpoint (e.g. `https://localhost:9200` or a Cloud deployment URL) |
| **Kibana URL**         | Required only when setting Kibana feature/space privileges                 |
| **Authentication**     | Valid credentials (see the elasticsearch-authn skill)                      |
| **Cluster privileges** | `manage_security` is required for user and role management operations      |

Prompt the user for any missing values.

## Decomposing Access Requests

When the user describes access in natural language (e.g. "create a user that has read-only access to `logs-*`"), break
the request into discrete tasks before executing. Follow this workflow:

### Step 1 — Identify the components

Extract from the prompt:

| Component        | Question to answer                                                        |
| ---------------- | ------------------------------------------------------------------------- |
| **Who**          | New native user, existing user, or external realm user (LDAP, SAML, etc.) |
| **What**         | Which indices, data streams, or Kibana features                           |
| **Access level** | Read, write, manage, or a specific set of privileges                      |
| **Scope**        | All documents/fields, or restricted by region, department, sensitivity?   |
| **Kibana?**      | Does the request mention any Kibana feature (dashboards, Discover, etc.)  |
| **Deployment?**  | Self-managed, ECH, or Serverless? Serverless has a different user model.  |

### Step 2 — Check for existing roles

Before creating a new role, check if an existing role already grants the required access:

```bash
curl "${ELASTICSEARCH_URL}/_security/role" <auth_flags>
```

If a matching role exists, skip role creation and reuse it.

### Step 3 — Create the role (if needed)

Derive a role name and display name from the request. Use the Elasticsearch API for pure index/cluster roles. Use the
Kibana API if Kibana features are involved (see [Choosing the right API](#choosing-the-right-api)).

### Step 4 — Create or update the user

| Scenario                 | Action                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **New native user**      | Create the user with the role and a strong generated password. (Self-managed / ECH only.)                                            |
| **Existing native user** | Fetch current roles, append the new role, update the user with the full array. (Self-managed / ECH only.)                            |
| **External realm user**  | Create a role mapping that matches the user's realm attributes to the role. (Self-managed / ECH only.)                               |
| **Serverless user**      | Use the **cloud-access-management** skill. Assign a predefined role or create a custom role first, then assign it via the Cloud API. |

### Example decomposition

**Prompt:** "Create a user `analyst` with read-only access to `logs-*` and `metrics-*` and view dashboards in Kibana."

1. Identify: new user `analyst`, indices `logs-*`/`metrics-*`, dashboards, read access.
1. Check roles: `GET /_security/role` — no match.
1. Create role via Kibana API (dashboards involved): `logs-metrics-dashboard-viewer`.
1. Create user: `POST /_security/user/analyst` with `roles: ["logs-metrics-dashboard-viewer"]`.

Confirm each step with the user if the request is ambiguous.

## Manage Native Users

> Native user management applies to self-managed and ECH deployments. On Serverless, users are managed at the
> organization level — skip this section.

### Create a user

```bash
curl -X POST "${ELASTICSEARCH_URL}/_security/user/${USERNAME}" \
  <auth_flags> \
  -H "Content-Type: application/json" \
  -d '{
    "password": "'"${PASSWORD}"'",
    "roles": ["'"${ROLE_NAME}"'"],
    "full_name": "'"${FULL_NAME}"'",
    "email": "'"${EMAIL}"'",
    "enabled": true
  }'
```

### Update a user

Use `PUT /_security/user/${USERNAME}` with the fields to change. Omit `password` to keep the existing one.

### Other user operations

```bash
curl -X POST "${ELASTICSEARCH_URL}/_security/user/${USERNAME}/_password" \
  <auth_flags> -H "Content-Type: application/json" \
  -d '{"password": "'"${NEW_PASSWORD}"'"}'
curl -X PUT "${ELASTICSEARCH_URL}/_security/user/${USERNAME}/_disable" <auth_flags>
curl -X PUT "${ELASTICSEARCH_URL}/_security/user/${USERNAME}/_enable" <auth_flags>
curl "${ELASTICSEARCH_URL}/_security/user/${USERNAME}" <auth_flags>
curl -X DELETE "${ELASTICSEARCH_URL}/_security/user/${USERNAME}" <auth_flags>
```

## Manage Roles

### Choosing the right API

Use the **Elasticsearch API** (`PUT /_security/role/{name}`) when the role only needs `cluster` and `indices`
privileges. This is the default — no Kibana endpoint is required.

Use the **Kibana role API** (`PUT /api/security/role/{name}`) when the role includes any Kibana feature or space
privileges. The Elasticsearch API cannot set Kibana feature grants, space scoping, or base privileges, so if the user
mentions Kibana features like Discover, Dashboards, Maps, Visualize, Canvas, or any other Kibana application, the Kibana
API is required.

If the Kibana endpoint is not available or API key authentication to Kibana fails, fall back to the Elasticsearch API
for the `cluster` and `indices` portion and warn the user that Kibana privileges could not be set. Prompt for a Kibana
URL or alternative credentials before giving up.

### Create or update a role (Elasticsearch API)

Default choice when the role has only index and cluster privileges:

```bash
curl -X PUT "${ELASTICSEARCH_URL}/_security/role/${ROLE_NAME}" \
  <auth_flags> \
  -H "Content-Type: application/json" \
  -d '{
    "description": "'"${ROLE_DISPLAY_NAME}"'",
    "cluster": [],
    "indices": [
      {
        "names": ["'"${INDEX_PATTERN}"'"],
        "privileges": ["read", "view_index_metadata"]
      }
    ]
  }'
```

### Create or update a role (Kibana API)

Required when the role includes Kibana feature or space privileges:

```bash
curl -X PUT "${KIBANA_URL}/api/security/role/${ROLE_NAME}" \
  <auth_flags> \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "'"${ROLE_DISPLAY_NAME}"'",
    "elasticsearch": {
      "cluster": [],
      "indices": [
        {
          "names": ["'"${INDEX_PATTERN}"'"],
          "privileges": ["read", "view_index_metadata"]
        }
      ]
    },
    "kibana": [
      {
        "base": [],
        "feature": {
          "discover": ["read"],
          "dashboard": ["read"]
        },
        "spaces": ["*"]
      }
    ]
  }'
```

### Get, list, and delete roles

```bash
curl "${ELASTICSEARCH_URL}/_security/role/${ROLE_NAME}" <auth_flags>
curl "${ELASTICSEARCH_URL}/_security/role" <auth_flags>
curl -X DELETE "${ELASTICSEARCH_URL}/_security/role/${ROLE_NAME}" <auth_flags>
```

## Document-Level and Field-Level Security

Roles can restrict access at the document and field level within an index, going beyond index-level privileges.

### Field-level security (FLS)

Restrict which fields a role can see. Use `grant` to whitelist or `except` to blacklist fields:

```bash
curl -X PUT "${ELASTICSEARCH_URL}/_security/role/pii-redacted-reader" \
  <auth_flags> \
  -H "Content-Type: application/json" \
  -d '{
    "description": "PII Redacted Reader",
    "indices": [
      {
        "names": ["customers-*"],
        "privileges": ["read"],
        "field_security": {
          "grant": ["*"],
          "except": ["ssn", "credit_card", "date_of_birth"]
        }
      }
    ]
  }'
```

Users with this role see all fields except the PII fields. FLS is enforced on search, get, and aggregation results.

### Document-level security (DLS)

Restrict which documents a role can see by attaching a query filter:

```bash
curl -X PUT "${ELASTICSEARCH_URL}/_security/role/emea-logs-reader" \
  <auth_flags> \
  -H "Content-Type: application/json" \
  -d '{
    "description": "EMEA Logs Reader",
    "indices": [
      {
        "names": ["logs-*"],
        "privileges": ["read"],
        "query": "{\"term\": {\"region\": \"emea\"}}"
      }
    ]
  }'
```

The `query` field is a JSON string containing a Query DSL filter. Users with this role only see documents where `region`
equals `emea`.

### Templated DLS queries (ABAC)

DLS queries support Mustache templates that inject user metadata at query time, enabling attribute-based access control
(ABAC) on top of RBAC. Store user-specific attributes in the user's `metadata` field, then reference them in the role
query template with `{{_user.metadata.<key>}}`.

```bash
curl -X PUT "${ELASTICSEARCH_URL}/_security/role/department-reader" \
  <auth_flags> \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Department Reader",
    "indices": [
      {
        "names": ["records-*"],
        "privileges": ["read"],
        "query": "{\"template\": {\"source\": \"{\\\"term\\\": {\\\"department\\\": \\\"{{_user.metadata.department}}\\\"}}\"}}"
      }
    ]
  }'
```

A user with `"metadata": {"department": "engineering"}` only sees documents where `department` equals `engineering`. The
same role works for all departments — no per-department role needed.

For multi-valued attributes (e.g. a list of required programs), use `terms_set` with `minimum_should_match_field` to
ensure the user holds all required attributes listed on the document. This enables complex ABAC policies — combining
security levels, program lists, and certification dates — using a single role. See
[references/api-reference.md](references/api-reference.md) for full `terms_set` ABAC examples including combined
multi-condition policies and user metadata setup.

### Combining DLS and FLS

A single index privilege entry can include both `query` (DLS) and `field_security` (FLS). See the
[HR department example](#restrict-hr-data-by-department-dls--fls) for a practical combined use case.

When users hold multiple roles, DLS queries are combined with OR and FLS grants are unioned. A broad role without
DLS/FLS can unintentionally widen access. When combining roles, always verify effective permissions and ensure no
unrestricted role overrides DLS/FLS intent.

## Assign Roles to Users

> Self-managed and ECH only. On Serverless, use the **cloud-access-management** skill — see
> [Serverless User Access](#serverless-user-access).

Update the user with the new `roles` array:

```bash
curl -X PUT "${ELASTICSEARCH_URL}/_security/user/${USERNAME}" \
  <auth_flags> \
  -H "Content-Type: application/json" \
  -d '{
    "roles": ["role-a", "role-b"]
  }'
```

The `roles` array is **replaced entirely** — include all roles the user should have. Fetch the user first to see current
roles before updating.

### Verify effective permissions

After role or user updates, verify effective access with:

```bash
curl -X POST "${ELASTICSEARCH_URL}/_security/user/_has_privileges" \
  <auth_flags> \
  -H "Content-Type: application/json" \
  -d '{
    "cluster": ["monitor"],
    "index": [
      {
        "names": ["'"${INDEX_PATTERN}"'"],
        "privileges": ["read", "view_index_metadata"]
      }
    ]
  }'
```

## Manage Role Mappings

> Role mappings are **not available** on Serverless (both ES API and Kibana UI are disabled). Use the
> **cloud-access-management** skill instead — see [Serverless User Access](#serverless-user-access).

Role mappings assign external-realm users (LDAP, AD, SAML, PKI) to roles based on attribute rules. Self-managed and ECH
only. For supported rule operators and resource fields, see
[role mapping resource properties](https://www.elastic.co/docs/deploy-manage/users-roles/cluster-or-deployment-auth/role-mapping-resources).

### Static role mapping

```bash
curl -X PUT "${ELASTICSEARCH_URL}/_security/role_mapping/saml-default-access" \
  <auth_flags> \
  -H "Content-Type: application/json" \
  -d '{
    "roles": ["viewer"],
    "enabled": true,
    "rules": {
      "field": { "realm.name": "saml1" }
    }
  }'
```

### LDAP group-based mapping

```bash
curl -X PUT "${ELASTICSEARCH_URL}/_security/role_mapping/ldap-admins" \
  <auth_flags> \
  -H "Content-Type: application/json" \
  -d '{
    "roles": ["superuser"],
    "enabled": true,
    "rules": {
      "all": [
        { "field": { "realm.name": "ldap1" } },
        { "field": { "groups": "cn=admins,ou=groups,dc=example,dc=com" } }
      ]
    }
  }'
```

### Dynamic role assignment with Mustache templates

Use `role_templates` instead of `roles` to derive role names from user attributes. Scripting must be enabled.

```bash
curl -X PUT "${ELASTICSEARCH_URL}/_security/role_mapping/ldap-group-roles" \
  <auth_flags> \
  -H "Content-Type: application/json" \
  -d '{
    "role_templates": [
      {
        "template": { "source": "{{#tojson}}groups{{/tojson}}" },
        "format": "json"
      }
    ],
    "enabled": true,
    "rules": {
      "field": { "realm.name": "ldap1" }
    }
  }'
```

See [references/api-reference.md](references/api-reference.md) for more Mustache patterns including realm-username
derived roles and tiered group access.

### Get, list, and delete role mappings

```bash
curl "${ELASTICSEARCH_URL}/_security/role_mapping/saml-default-access" <auth_flags>
curl "${ELASTICSEARCH_URL}/_security/role_mapping" <auth_flags>
curl -X DELETE "${ELASTICSEARCH_URL}/_security/role_mapping/saml-default-access" <auth_flags>
```

## Serverless User Access

On Serverless, there are no native users or role mappings. Users receive project access through Cloud-level role
assignments.

- **Predefined roles** (e.g. `admin`, `developer`, `viewer`) cover common access patterns. If one fits, assign it
  directly via the Cloud API — no custom role creation needed.
- **Custom roles** are required when the user needs fine-grained access (specific indices, Kibana features, DLS/FLS).
  Create the custom role using the Elasticsearch API or Kibana API (same as self-managed — see
  [Manage Roles](#manage-roles)), then assign it to the user alongside a predefined base role via the Cloud API.
- **Run-as** privileges are unavailable in Serverless custom roles.

Use the **cloud-access-management** skill for the full workflow (inviting users, assigning roles, managing Cloud API
keys, and verifying access). This skill handles only role definition; cloud-access-management handles user assignment.

## Examples

### Create a read-only user for logs

**Request:** "Create a user `joe` with read-only access to `logs-*`."

1. Create the role via `PUT /_security/role/logs-reader` with `"description": "Logs Reader"` and
   `indices: [{ names: ["logs-*"], privileges: ["read", "view_index_metadata"] }]`.
1. Create the user via `POST /_security/user/joe` with `"roles": ["logs-reader"]` and a strong generated password.

### Create a role with Kibana dashboard access

**Request:** "Let users read `logs-*` and view dashboards in Kibana."

Use the Kibana API (`PUT <KIBANA_URL>/api/security/role/logs-dashboard-viewer`) with `elasticsearch.indices` for data
access and `kibana[].feature` for dashboard and Discover read access on all spaces. See
[Create or update a role (Kibana API)](#create-or-update-a-role-kibana-api) for the full request structure.

### Add a role to an existing user

**Request:** "Give Alice access to `apm-*` in addition to her current roles."

1. `GET /_security/user/alice` — response shows `"roles": ["viewer"]`.
1. Create `apm-reader` role with `indices: [{ names: ["apm-*"], privileges: ["read", "view_index_metadata"] }]`.
1. `PUT /_security/user/alice` with `"roles": ["viewer", "apm-reader"]` (include all roles).

### Grant a Serverless user read-write access with Kibana dashboards

**Request:** "Give `alice@example.com` read-write access to the `colors` index and let her use dashboards and Discover."

1. Create a custom role via the Kibana API: `PUT <KIBANA_URL>/api/security/role/colors-rw-kibana` with
   `elasticsearch.indices` for `read`, `write`, `view_index_metadata` on `colors` and `kibana[].feature` for
   `dashboard`, `discover`.
1. Use the **cloud-access-management** skill to assign the user the custom role `colors-rw-kibana`.

### Restrict HR data by department (DLS + FLS)

**Request:** "Each manager should only see HR records from their own department, and PII fields should be hidden."

1. Create a user with department metadata: `POST /_security/user/manager_a` with
   `"metadata": {"department": "engineering"}`.
1. Create a role with DLS + FLS:

```json
PUT /_security/role/hr-department-viewer
{
  "description": "HR Department Viewer",
  "indices": [
    {
      "names": ["hr-*"],
      "privileges": ["read"],
      "field_security": { "grant": ["*"], "except": ["ssn", "salary", "date_of_birth"] },
      "query": "{\"template\": {\"source\": \"{\\\"term\\\": {\\\"department\\\": \\\"{{_user.metadata.department}}\\\"}}\"}}"
    }
  ]
}
```

The same role works for every department — each user sees only their department's records with PII fields removed.

## Guidelines

### Least-privilege principles

- Never use the `elastic` superuser for day-to-day operations. Create dedicated minimum-privilege roles and reserve
  `elastic` for initial setup and emergency recovery.
- Use `read` and `view_index_metadata` for read-only data access. Leave `cluster` empty unless explicitly required.
- Use DLS (`query`) and FLS (`field_security`) to restrict access within an index.

### Named privileges only

Never use internal action names (e.g. `indices:data/read/search`). Always use officially documented named privileges.
Prefer fine-grained privileges (`manage_ingest_pipelines`, `monitor`) over broad ones (`manage`, `all`). See
[references/api-reference.md](references/api-reference.md) for the full privilege reference tables.

### Role naming conventions

- Use short lowercase names with hyphens: `logs-reader`, `apm-data-viewer`, `metrics-writer`.
- Avoid generic names like `custom-role` or `new-role`.
- Set `description` to a short, human-readable display name — not a long sentence. It is shown in the Kibana UI as the
  role's label. Good: `"Logs Reader"`, `"APM Data Viewer"`. Bad:
  `"Read-only access to all logs-* indices for the operations team"`.

### User management

- Generate strong passwords by default: at least 16 characters mixing uppercase, lowercase, digits, and symbols (e.g.
  `X9k#mP2vL!qR7wZn`). Never use placeholder values like `changeme` or `password123`.
- Prefer disabling users over deleting them to preserve audit trail.
- The `roles` array on a user is **replaced entirely** on update. Always fetch current roles before modifying.

### Role mapping best practices

- Use static `roles` for simple, fixed assignments (e.g. all SAML users get `viewer`).
- Use `role_templates` with Mustache only when roles must be derived dynamically from user attributes.
- Combine `all`, `any`, `field`, and `except` rules to express complex conditions without duplicating mappings.
- Test new mappings with `enabled: false` first, then enable once verified.

## Deployment Compatibility

See [references/deployment-compatibility.md](references/deployment-compatibility.md) for a feature matrix and detailed
notes on self-managed, ECH, and Serverless deployment differences.
