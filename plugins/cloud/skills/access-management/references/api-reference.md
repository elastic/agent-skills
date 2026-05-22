# Cloud Access Management — API Reference

All Cloud API calls use base URL `https://api.elastic-cloud.com/api/v1` and require the header
`Authorization: ApiKey $EC_API_KEY`.

Serverless ES API calls use the project Elasticsearch endpoint and require either basic auth or an Elasticsearch API key
with `manage_security` privileges.

## Table of Contents

- [Organization Discovery](#organization-discovery)
- [Organization Members](#organization-members)
  - [List members](#list-members)
  - [Invite users](#invite-users)
  - [List pending invitations](#list-pending-invitations)
  - [Cancel invitations](#cancel-invitations)
  - [Remove members](#remove-members)
- [Role Assignments](#role-assignments)
  - [Add role assignments to a user](#add-role-assignments-to-a-user)
  - [Role assignments schema](#role-assignments-schema)
  - [Assign a custom role using application_roles](#assign-a-custom-role-using-application_roles)
  - [Remove role assignments](#remove-role-assignments)
- [Cloud API Keys](#cloud-api-keys)
  - [Create an API key](#create-an-api-key)
  - [List all API keys](#list-all-api-keys)
  - [Delete API keys](#delete-api-keys)
- [Serverless Custom Roles (Elasticsearch Security API)](#serverless-custom-roles-elasticsearch-security-api)
  - [Create or update a custom role](#create-or-update-a-custom-role)
  - [Get a custom role](#get-a-custom-role)
  - [List all roles](#list-all-roles)
  - [Delete a custom role](#delete-a-custom-role)

---

## Organization Discovery

> **Official API docs:**
> [List organizations](https://www.elastic.co/docs/api/doc/cloud/operation/operation-list-organizations)

### Get organizations

```text
GET /organizations
```

Returns the list of organizations the authenticated user belongs to. Use to auto-discover `organization_id`.

```bash
curl -s -H "Authorization: ApiKey $EC_API_KEY" \
  "https://api.elastic-cloud.com/api/v1/organizations"
```

**Response** (200):

```json
{
  "organizations": [
    {
      "id": "org-uuid-here",
      "name": "My Organization"
    }
  ]
}
```

---

## Organization Members

> **Official API docs:**
> [List members](https://www.elastic.co/docs/api/doc/cloud/operation/operation-list-organization-members) ·
> [Invite users](https://www.elastic.co/docs/api/doc/cloud/operation/operation-create-organization-invitations) ·
> [List invitations](https://www.elastic.co/docs/api/doc/cloud/operation/operation-list-organization-invitations) ·
> [Delete invitations](https://www.elastic.co/docs/api/doc/cloud/operation/operation-delete-organization-invitations) ·
> [Remove members](https://www.elastic.co/docs/api/doc/cloud/operation/operation-delete-organization-memberships)

### List members

```text
GET /organizations/{organization_id}/members
```

```bash
curl -s -H "Authorization: ApiKey $EC_API_KEY" \
  "https://api.elastic-cloud.com/api/v1/organizations/$ORG_ID/members"
```

**Response** (200):

```json
{
  "members": [
    {
      "user_id": "user-uuid",
      "email": "alice@example.com",
      "name": "Alice",
      "role_assignments": { ... }
    }
  ]
}
```

| Status | Meaning                     |
| ------ | --------------------------- |
| 200    | Members listed successfully |
| 404    | Organization not found      |

### Invite users

```text
POST /organizations/{organization_id}/invitations
```

```bash
curl -s -X POST \
  -H "Authorization: ApiKey $EC_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.elastic-cloud.com/api/v1/organizations/$ORG_ID/invitations" \
  -d '{
    "emails": ["alice@example.com", "bob@example.com"],
    "expires_in": "3d",
    "role_assignments": {
      "organization": [
        { "role_id": "billing-admin" }
      ],
      "deployment": [
        {
          "role_id": "deployment-viewer",
          "organization_id": "'"$ORG_ID"'",
          "all": true
        }
      ]
    }
  }'
```

**Request body fields:**

| Field              | Type            | Required | Description                                                      |
| ------------------ | --------------- | -------- | ---------------------------------------------------------------- |
| `emails`           | array\[string\] | Yes      | Email addresses to invite                                        |
| `expires_in`       | string          | No       | Expiration duration (default: `3d`)                              |
| `role_assignments` | object          | No       | Cloud roles to assign on acceptance (see Role Assignments below) |

| Status | Meaning               | Error code                                       |
| ------ | --------------------- | ------------------------------------------------ |
| 201    | Invitations created   |                                                  |
| 400    | User already in org   | `organization.user_organization_already_belongs` |
| 400    | Invitation exists     | `organization.invitation_already_exists`         |
| 400    | Invalid email         | `organization.invitation_invalid_email`          |
| 403    | Invalid auth          | `root.invalid_authentication`                    |
| 404    | Org or user not found | `organization.not_found`                         |
| 429    | Rate limit exceeded   | `organization.invitations_rate_limit_exceeded`   |

Cloud invitation payloads support Cloud role assignments including `application_roles` for custom roles. However, the
recommended flow is to invite the user first (without project roles) and then assign the custom role separately using
`assign-custom-role` after the invitation is accepted. This avoids accidentally combining a predefined role with a
custom role for the same project.

### List pending invitations

```text
GET /organizations/{organization_id}/invitations
```

```bash
curl -s -H "Authorization: ApiKey $EC_API_KEY" \
  "https://api.elastic-cloud.com/api/v1/organizations/$ORG_ID/invitations"
```

### Cancel invitations

```text
DELETE /organizations/{organization_id}/invitations/{invitation_tokens}
```

`invitation_tokens` is a comma-separated list of invitation token strings.

```bash
curl -s -X DELETE -H "Authorization: ApiKey $EC_API_KEY" \
  "https://api.elastic-cloud.com/api/v1/organizations/$ORG_ID/invitations/$TOKEN"
```

### Remove members

```text
DELETE /organizations/{organization_id}/members/{user_ids}
```

`user_ids` is a comma-separated list of user IDs.

```bash
curl -s -X DELETE -H "Authorization: ApiKey $EC_API_KEY" \
  "https://api.elastic-cloud.com/api/v1/organizations/$ORG_ID/members/$USER_ID"
```

| Status | Meaning                              |
| ------ | ------------------------------------ |
| 200    | Members removed                      |
| 404    | Organization or membership not found |

---

## Role Assignments

> **Official API docs:**
> [Add role assignments](https://www.elastic.co/docs/api/doc/cloud/operation/operation-add-role-assignments) ·
> [Remove role assignments](https://www.elastic.co/docs/api/doc/cloud/operation/operation-remove-role-assignments)

### Add role assignments to a user

```text
POST /users/{user_id}/role_assignments
```

```bash
curl -s -X POST \
  -H "Authorization: ApiKey $EC_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.elastic-cloud.com/api/v1/users/$USER_ID/role_assignments" \
  -d '{
    "organization": [
      { "role_id": "organization-admin" }
    ],
    "deployment": [
      {
        "role_id": "deployment-editor",
        "organization_id": "'"$ORG_ID"'",
        "all": true
      }
    ],
    "project": {
      "elasticsearch": [
        {
          "role_id": "admin",
          "organization_id": "'"$ORG_ID"'",
          "all": false,
          "project_ids": ["project-uuid-here"]
        }
      ],
      "observability": [],
      "security": []
    }
  }'
```

### Role assignments schema

```json
{
  "organization": [
    {
      "role_id": "<org-role-id>",
      "organization_id": "<org-id>",
      "application_roles": ["<predefined-or-custom-role>"]
    }
  ],
  "deployment": [
    {
      "role_id": "<deployment-role-id>",
      "organization_id": "<org-id>",
      "all": true,
      "deployment_ids": []
    }
  ],
  "project": {
    "elasticsearch": [
      {
        "role_id": "<project-role-id>",
        "organization_id": "<org-id>",
        "all": false,
        "project_ids": ["<project-id>"],
        "application_roles": ["<custom-role-name>"]
      }
    ],
    "observability": [],
    "security": []
  }
}
```

**Organization role IDs:** `organization-admin`, `billing-admin`

**Deployment role IDs:** `deployment-admin`, `deployment-editor`, `deployment-viewer`

**Serverless project role IDs (Elasticsearch):** `admin`, `developer`, `viewer`

**Serverless project role IDs (Observability):** `admin`, `editor`, `viewer`

**Serverless project role IDs (Security):** `admin`, `editor`, `viewer`, `t1_analyst`, `t2_analyst`, `t3_analyst`,
`threat_intel_analyst`, `rule_author`, `soc_manager`, `endpoint_operations_analyst`, `platform_engineer`,
`detections_admin`, `endpoint_policy_manager`

For project-scoped assignments that include `application_roles`, use project-type-specific viewer role IDs:
`elasticsearch-viewer`, `observability-viewer`, `security-viewer` (not the generic `viewer`).

**`application_roles`** (optional, array of strings): Specifies which ES/Kibana roles to grant. Accepts predefined role
names (`admin`, `developer`, `viewer`, and solution-specific roles) or custom role names created in the project via
`PUT /_security/role/{name}`. Serverless only. Behavior depends on the principal type:

- **For users:** When set on a project-scoped assignment, the user receives these roles when signing into the project
  instead of the default stack role mapped to `role_id`.
- **For API keys:** Grants ES/Kibana API access. Unlike users, API keys **never** inherit stack roles from `role_id` —
  `application_roles` must be explicitly provided. If omitted or empty, the API key has Cloud API access only and
  receives 403 Forbidden when calling ES/Kibana endpoints.
- **On organization scope:** Grants the specified roles across **all projects (current and future)** in the
  organization. Supported for API keys.

> **Broad access warning:** Organization-scoped `application_roles` is the broadest possible data-plane scope — it
> grants ES/Kibana access to every project in the organization, including projects created after the key. Use
> project-scoped assignments when the key only needs access to specific projects. Reserve org-scoped `application_roles`
> for platform automation keys that genuinely require cross-project access.
>
> **Custom roles with org scope:** When using a custom role name in `application_roles`, the role must be defined in
> each project where the key should have access (via `PUT /_security/role/{name}`). If a project does not have that
> role, the key silently gets no access there — no error is raised. Predefined roles (`admin`, `developer`, `viewer`)
> are available in every project by default and do not have this limitation.

> **Security:** When using `application_roles`, the user automatically receives Viewer-level Cloud access for the
> project. Do not also assign a predefined Cloud role (such as `viewer`) for the same project as a separate role
> assignment — the user would receive the union of both roles on sign-in, which is broader than the custom role intends.

### Assign a custom role using application_roles

```bash
curl -s -X POST \
  -H "Authorization: ApiKey $EC_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.elastic-cloud.com/api/v1/users/$USER_ID/role_assignments" \
  -d '{
    "project": {
      "elasticsearch": [
        {
          "role_id": "elasticsearch-viewer",
          "organization_id": "'"$ORG_ID"'",
          "all": false,
          "project_ids": ["'"$PROJECT_ID"'"],
          "application_roles": ["marketing-reader"]
        }
      ]
    }
  }'
```

This grants the user Viewer-level Cloud access (project visible in the console) and **only** the `marketing-reader`
custom role when they SSO into the project — not the full Viewer stack role. Use the project-type-specific Viewer role
ID (`elasticsearch-viewer`, `observability-viewer`, or `security-viewer`) for the `role_id` value.

### Remove role assignments

```text
DELETE /users/{user_id}/role_assignments
```

Uses the same body schema as `POST`. Removes the specified role assignments from the user.

---

## Cloud API Keys

> **Official API docs:** [Create API key](https://www.elastic.co/docs/api/doc/cloud/operation/operation-create-api-key)
> · [List API keys](https://www.elastic.co/docs/api/doc/cloud/operation/operation-get-api-keys) ·
> [Delete API keys](https://www.elastic.co/docs/api/doc/cloud/operation/operation-delete-api-keys)

Only Organization owners (`organization-admin` role) can create and manage Cloud API keys. Non-owner requests
return 403.

### Create an API key

```text
POST /users/auth/keys
```

```bash
curl -s -X POST \
  -H "Authorization: ApiKey $EC_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.elastic-cloud.com/api/v1/users/auth/keys" \
  -d '{
    "description": "CI/CD pipeline key",
    "expiration": "30d",
    "role_assignments": {
      "organization": [
        { "role_id": "billing-admin" }
      ],
      "deployment": [
        {
          "role_id": "deployment-editor",
          "organization_id": "'"$ORG_ID"'",
          "all": true
        }
      ]
    }
  }'
```

**Project-scoped API key with ES access** (grants developer access to all Elasticsearch projects):

```bash
curl -s -X POST \
  -H "Authorization: ApiKey $EC_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.elastic-cloud.com/api/v1/users/auth/keys" \
  -d '{
    "description": "CI pipeline with ES access",
    "expiration": "30d",
    "role_assignments": {
      "project": {
        "elasticsearch": [
          {
            "role_id": "developer",
            "organization_id": "'"$ORG_ID"'",
            "all": true,
            "application_roles": ["developer"]
          }
        ]
      }
    }
  }'
```

**Organization-scoped API key with ES access** (grants admin access to ALL current and future projects):

```bash
curl -s -X POST \
  -H "Authorization: ApiKey $EC_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.elastic-cloud.com/api/v1/users/auth/keys" \
  -d '{
    "description": "Platform automation key",
    "expiration": "7d",
    "role_assignments": {
      "organization": [
        {
          "role_id": "organization-admin",
          "organization_id": "'"$ORG_ID"'",
          "application_roles": ["admin"]
        }
      ]
    }
  }'
```

> **Caution:** This grants admin-level ES/Kibana access to every project in the organization, including projects created
> after the key. Use project-scoped assignments for narrower access.

**Request body fields:**

| Field                                                 | Type          | Required | Description                                                                                                                                                                                                                               |
| ----------------------------------------------------- | ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`                                         | string        | No       | Human-readable label for the key                                                                                                                                                                                                          |
| `expiration`                                          | string        | No       | Duration string (for example, `1d`, `30d`, `3h`). Default: 3mo                                                                                                                                                                            |
| `role_assignments`                                    | object        | No       | Roles scoped to the key (same schema as above)                                                                                                                                                                                            |
| `role_assignments.organization[].application_roles`   | array[string] | No       | ES/Kibana role names for stack access across all projects (org-scoped). If omitted or empty, the key has Cloud API access only. Predefined: `admin`, `developer`, `viewer`, and solution-specific roles. Custom role names also accepted. |
| `role_assignments.project.<type>[].application_roles` | array[string] | No       | ES/Kibana role names for stack access on specific projects (project-scoped). Same values as above. Required for ES/Kibana API calls — without it, the key receives 403.                                                                   |

> **403 on ES/Kibana calls:** If an API key without `application_roles` calls an Elasticsearch or Kibana endpoint, the
> request returns 403 Forbidden. Unlike users, API keys never inherit stack roles from `role_id`. Add explicit
> `application_roles` when the key needs data-plane access.

**Response** (201):

```json
{
  "id": "key-uuid",
  "key": "the-actual-api-key-value",
  "description": "CI/CD pipeline key",
  "creation_date": "2026-02-27T10:00:00Z",
  "expiration_date": "2026-03-29T10:00:00Z",
  "organization_id": "org-uuid",
  "user_id": "user-uuid",
  "role_assignments": { ... }
}
```

The `key` field is returned **only once** at creation. Store it securely.

### List all API keys

```text
GET /users/auth/keys
```

```bash
curl -s -H "Authorization: ApiKey $EC_API_KEY" \
  "https://api.elastic-cloud.com/api/v1/users/auth/keys"
```

### Delete API keys

```text
DELETE /users/auth/keys
```

```bash
curl -s -X DELETE \
  -H "Authorization: ApiKey $EC_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.elastic-cloud.com/api/v1/users/auth/keys" \
  -d '{"keys": ["key-id-1", "key-id-2"]}'
```

| Status | Meaning      |
| ------ | ------------ |
| 200    | Keys deleted |

---

## Serverless Custom Roles (Elasticsearch Security API)

> **Official API docs:**
> [Create/update role](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-security-put-role) ·
> [Get role](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-security-get-role) ·
> [Delete role](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-security-delete-role)

These endpoints run against the **project Elasticsearch endpoint**, not the Cloud API. They require an Elasticsearch API
key or credentials with `manage_security` cluster privilege.

### Create or update a custom role

```text
PUT /_security/role/{name}
```

```bash
curl -s -X PUT \
  -H "Authorization: ApiKey $ELASTICSEARCH_API_KEY" \
  -H "Content-Type: application/json" \
  "$ELASTICSEARCH_URL/_security/role/marketing-analyst" \
  -d '{
    "cluster": [],
    "indices": [
      {
        "names": ["marketing-*"],
        "privileges": ["read", "view_index_metadata"]
      }
    ],
    "applications": [
      {
        "application": "kibana-.kibana",
        "privileges": ["feature_discover.read", "feature_dashboard.read"],
        "resources": ["*"]
      }
    ]
  }'
```

**Request body fields:**

| Field          | Type            | Description                                          |
| -------------- | --------------- | ---------------------------------------------------- |
| `cluster`      | array\[string\] | Cluster-level privileges                             |
| `indices`      | array\[object\] | Index privilege entries (names, privileges, DLS/FLS) |
| `applications` | array\[object\] | Kibana feature privileges                            |

**Naming rules:** Must start with a letter or digit. Only letters, digits, `_`, `-`, `.` are allowed.

**Limitation:** Run-as privileges are not available in Serverless.

### Get a custom role

```text
GET /_security/role/{name}
```

```bash
curl -s -H "Authorization: ApiKey $ELASTICSEARCH_API_KEY" \
  "$ELASTICSEARCH_URL/_security/role/marketing-analyst"
```

### List all roles

```text
GET /_security/role
```

```bash
curl -s -H "Authorization: ApiKey $ELASTICSEARCH_API_KEY" \
  "$ELASTICSEARCH_URL/_security/role"
```

### Delete a custom role

```text
DELETE /_security/role/{name}
```

```bash
curl -s -X DELETE -H "Authorization: ApiKey $ELASTICSEARCH_API_KEY" \
  "$ELASTICSEARCH_URL/_security/role/marketing-analyst"
```
