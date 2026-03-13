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
  "organization": [{ "role_id": "<org-role-id>" }],
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

**`application_roles`** (optional, array of strings): When provided, the user is granted these application roles (custom
roles created in the project) when signing into the project, instead of the default stack role mapped to `role_id`.
Serverless only. The custom role must already exist in the project (created via `PUT /_security/role/{name}`).

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

**Request body fields:**

| Field              | Type   | Required | Description                                                    |
| ------------------ | ------ | -------- | -------------------------------------------------------------- |
| `description`      | string | No       | Human-readable label for the key                               |
| `expiration`       | string | No       | Duration string (for example, `1d`, `30d`, `3h`). Default: 3mo |
| `role_assignments` | object | No       | Roles scoped to the key (same schema as above)                 |

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
