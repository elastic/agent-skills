---
name: cloud-access-management
description: >
  Manage Elastic Cloud organization access: invite users, assign roles to Serverless
  projects, and create or revoke Cloud API keys. Use when granting, modifying, or
  auditing user access.
compatibility: >
  Requires Python 3.8+, network access to the Elastic Cloud API (api.elastic-cloud.com)
  and optionally to a Serverless Elasticsearch endpoint for custom role operations.
  Environment variables: EC_API_KEY (required, set by cloud-setup), ELASTICSEARCH_URL
  and ELASTICSEARCH_API_KEY (required only for custom roles).
metadata:
  author: elastic
  version: 0.1.0
---

# Cloud Access Management

Manage identity and access for an Elastic Cloud organization and its Serverless projects: invite users, assign
predefined or custom roles, and manage Cloud API keys.

> **Prerequisite:** This skill assumes the **cloud-setup** skill has already run — `EC_API_KEY` is set in the
> environment and the organization context is established. If `EC_API_KEY` is missing, instruct the agent to invoke
> **cloud-setup** first. Do NOT prompt the user for an API key directly.

For project creation, see the **cloud-create-project** skill. For day-2 project operations (list, update, delete), see
**cloud-manage-project**. For Elasticsearch-level role management (native users, role mappings, DLS/FLS), see the
**elasticsearch-authz** skill.

For detailed API endpoints and request schemas, see [references/api-reference.md](references/api-reference.md).

## Jobs to Be Done

- Invite a user to the organization and assign them a Serverless project role
- List organization members and their current role assignments
- Update a user's roles (org-level or project-level)
- Remove a user from the organization
- Create an additional Cloud API key with scoped roles and expiration
- List and revoke Cloud API keys
- Create a custom role inside a Serverless project with ES cluster, index, and Kibana privileges
- Assign or remove a custom role for a user on a Serverless project using the Cloud API's `application_roles`
- Translate a natural-language access request into invite, role, and API key tasks

## Prerequisites

| Item                 | Description                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| **EC_API_KEY**       | Cloud API key (set by **cloud-setup**). Required for all operations.                                    |
| **Organization ID**  | Auto-discovered using `GET /organizations`. Do not ask the user for it.                                 |
| **Project endpoint** | Elasticsearch endpoint of a Serverless project. Required only for custom role operations.               |
| **ES credentials**   | API key or credentials with `manage_security` privilege on the project. Required only for custom roles. |
| **Org owner role**   | Only Organization owners can create and manage Cloud API keys. Required for API key operations.         |

Run `python3 skills/cloud/access-management/scripts/cloud_access.py list-members` to verify that `EC_API_KEY` is valid
and auto-discover the org ID before proceeding with any operation.

## Decomposing Access Requests

When the user describes access in natural language (for example, "add Alice to my search project as a developer"), break
the request into discrete tasks before executing.

### Step 1 — Identify the components

| Component        | Question to answer                                                  |
| ---------------- | ------------------------------------------------------------------- |
| **Who**          | New org member (invite) or existing member (role update)?           |
| **What**         | Which Serverless project(s) or org-level access?                    |
| **Access level** | Predefined role (Admin/Developer/Viewer/Editor) or custom role?     |
| **API key?**     | Does the request also need a Cloud API key for programmatic access? |

### Step 2 — Check if a predefined role fits

Consult the [predefined roles table](#predefined-roles) below. Prefer predefined roles — only create a custom role when
predefined roles do not provide the required granularity.

### Step 3 — Check existing state

Before creating or inviting, check what already exists:

```bash
python3 skills/cloud/access-management/scripts/cloud_access.py list-members
python3 skills/cloud/access-management/scripts/cloud_access.py list-api-keys
```

If the user is already a member, skip the invitation and update their roles instead.

**For API key requests**, only Organization owners can create and manage Cloud API keys. If the authenticated user does
not have the `organization-admin` role, API key operations will fail with a 403 error. Review the existing keys returned
by `list-api-keys`. If an active key already exists **for the same purpose or task** with the required roles and
sufficient remaining lifetime, reuse it instead of creating a new one. Two keys with identical permissions are fine when
they serve different purposes (for example, separate CI pipelines), but creating a second key for the same task is
unnecessary and increases the management burden.

### Step 4 — Run

Run the appropriate command(s) from `skills/cloud/access-management/scripts/cloud_access.py`. Confirm destructive
actions (remove member, revoke key) with the user before executing.

### Step 5 — Verify

After execution, list members or keys again to confirm the change took effect.

## Predefined Roles

### Organization-level roles

| Role               | Cloud API `role_id`  | Description                                |
| ------------------ | -------------------- | ------------------------------------------ |
| Organization owner | `organization-admin` | Full admin over org, deployments, projects |
| Billing admin      | `billing-admin`      | Manage billing details only                |

### Serverless project-level roles

| Role           | Cloud API `role_id` | Available on          | Description                                          |
| -------------- | ------------------- | --------------------- | ---------------------------------------------------- |
| Admin          | `admin`             | Search, Obs, Security | Full project management, superuser on sign-in        |
| Developer      | `developer`         | Search only           | Create indices, API keys, connectors, visualizations |
| Viewer         | `viewer`            | Search, Obs, Security | Read-only access to project data and features        |
| Editor         | `editor`            | Obs, Security         | Configure project features, read-only data indices   |
| Tier 1 analyst | `t1_analyst`        | Security only         | Alert triage, general read, create dashboards        |
| Tier 2 analyst | `t2_analyst`        | Security only         | Alert triage, begin investigations, create cases     |
| Tier 3 analyst | `t3_analyst`        | Security only         | Deep investigation, rules, lists, response actions   |
| SOC manager    | `soc_manager`       | Security only         | Alerts, cases, endpoint policy, response actions     |
| Rule author    | `rule_author`       | Security only         | Detection engineering, rule creation                 |

Project-level roles are assigned during invitation (`POST /organizations/{org_id}/invitations`) or using the role
assignment update (`POST /users/{user_id}/role_assignments`). See
[references/api-reference.md](references/api-reference.md) for the `role_assignments` JSON schema including the
`project` scope.

## Custom Roles (Serverless)

When predefined roles lack the required granularity, create a custom role inside the Serverless project using the
Elasticsearch security API and assign it to users through the Cloud API's `application_roles` field.

> **Security: do not assign a predefined Cloud role separately when using a custom role.** Custom roles implicitly grant
> Viewer-level Cloud access for the project scope. If you also assign `viewer` (or any other predefined role) as a
> separate Cloud role assignment for the same project, the user receives the **union** of both roles when they SSO into
> the project — the Viewer stack role is broader than most custom roles and will override the restrictions you intended.

### How custom role assignment works

- **Predefined roles** (`viewer`, `developer`, `admin`, etc.) are assigned via Cloud APIs (`invite-user`,
  `assign-role`). When the user SSOs into the project, they receive the stack role mapped to their Cloud role (for
  example, Cloud `viewer` maps to the `viewer` stack role).
- **Custom roles** are created in the project via the Elasticsearch security API (`create-custom-role`) and assigned via
  the Cloud API's `application_roles` field (`assign-custom-role`). When `application_roles` is set, the user gets
  **only** the specified custom role on SSO — not the default stack role for their Cloud role.
- The `assign-custom-role` command sets `role_id` to the project-type Viewer role (`elasticsearch-viewer`,
  `observability-viewer`, or `security-viewer`) and sets `application_roles` to the custom role name. This ensures the
  user can see and access the project in the Cloud console but receives only the custom role's restricted permissions
  inside the project.
- Cloud API keys (`create-api-key`) currently carry Cloud roles only. Support for assigning custom roles to Cloud API
  keys is planned and will be documented here once available in production.

### Canonical custom-role onboarding flow

1. Create the custom role in the project (`create-custom-role`).
2. Invite the user to the organization if they are not already a member (`invite-user`). Do **not** include project role
   assignments in the invitation — the custom role assignment in the next step handles project access.
3. Assign the custom role to the user (`assign-custom-role --user-id ... --project-id ... --custom-role-name ...`).
4. Verify with `list-members` and `list-roles`.

### Create a custom role

```bash
python3 skills/cloud/access-management/scripts/cloud_access.py create-custom-role \
  --role-name marketing-analyst \
  --body '{"cluster":[],"indices":[{"names":["marketing-*"],"privileges":["read","view_index_metadata"]}]}'
```

This calls `PUT /_security/role/{name}` on the project Elasticsearch endpoint.

### Naming constraints

Role names must begin with a letter or digit and contain only letters, digits, `_`, `-`, and `.`. Run-as privileges are
not available in Serverless.

### When to use custom roles versus predefined

| Scenario                                   | Use             |
| ------------------------------------------ | --------------- |
| Standard admin/developer/viewer access     | Predefined role |
| Read-only access to specific index pattern | Custom role     |
| DLS or FLS restrictions                    | Custom role     |
| Kibana feature-level access control        | Custom role     |

For advanced DLS/FLS patterns (templated queries, ABAC), see the **elasticsearch-authz** skill.

## Examples

### Invite a user as a Viewer on a search project

**Prompt:** "Add `alice@example.com` to my search project with read-only access."

```bash
python3 skills/cloud/access-management/scripts/cloud_access.py invite-user \
  --emails alice@example.com \
  --roles '{"project":{"elasticsearch":[{"role_id":"viewer","organization_id":"$ORG_ID","all":false,"project_ids":["$PROJECT_ID"]}]}}'
```

Replace `$ORG_ID` and `$PROJECT_ID` with the actual IDs. The Viewer role is assigned when the invitation is accepted.
For custom role access, use `assign-custom-role` after the user has accepted the invitation — do not combine a
predefined role assignment with a custom role for the same project.

### Create a CI/CD API key

**Prompt:** "Create an API key for our CI pipeline that expires in 30 days with editor access to all deployments."

```bash
python3 skills/cloud/access-management/scripts/cloud_access.py create-api-key \
  --description "CI/CD pipeline" \
  --expiration "30d" \
  --roles '{"deployment":[{"role_id":"deployment-editor","all":true}]}'
```

The actual key value is written to a secure temp file (0600 permissions). The stdout JSON contains a `_secret_file` path
instead of the raw secret. Tell the user to retrieve the key from that file — it is shown only once. When the CI
pipeline no longer needs this key, revoke it using `delete-api-key` to avoid unused keys accumulating.

### Create a custom role for marketing data

**Prompt:** "Create a role that gives read-only access to marketing-\* indices on my search project."

```bash
python3 skills/cloud/access-management/scripts/cloud_access.py create-custom-role \
  --role-name marketing-reader \
  --body '{"cluster":[],"indices":[{"names":["marketing-*"],"privileges":["read","view_index_metadata"]}]}'
```

Then assign the custom role to a user using the `assign-custom-role` command, which sets `application_roles` in the
Cloud API role assignment.

### Full custom-role flow for read-only dashboards

**Prompt:** "Add `bob@example.com` to my search project with read-only dashboard access."

```bash
# 1) Create custom role in the project
python3 skills/cloud/access-management/scripts/cloud_access.py create-custom-role \
  --role-name dashboard-reader \
  --body '{"cluster":[],"indices":[],"applications":[{"application":"kibana-.kibana","privileges":["feature_dashboard.read"],"resources":["*"]}]}'

# 2) Invite user to the organization (no project roles — custom role handles access)
python3 skills/cloud/access-management/scripts/cloud_access.py invite-user \
  --emails bob@example.com

# 3) After invitation is accepted, assign the custom role via application_roles
python3 skills/cloud/access-management/scripts/cloud_access.py assign-custom-role \
  --user-id "$USER_ID" \
  --project-id "$PROJECT_ID" \
  --project-type elasticsearch \
  --custom-role-name dashboard-reader
```

The user receives Viewer-level Cloud access (can see the project in the console) and **only** `dashboard-reader`
permissions when they SSO into the project. Do not also assign `viewer` as a separate Cloud role for this project —
doing so would grant the broader Viewer stack role and override the custom role's restrictions.

### Update a user's project role

**Prompt:** "Promote Bob to admin on our observability project."

```bash
python3 skills/cloud/access-management/scripts/cloud_access.py assign-role \
  --user-id "$USER_ID" \
  --roles '{"project":{"observability":[{"role_id":"admin","organization_id":"$ORG_ID","all":false,"project_ids":["$PROJECT_ID"]}]}}'
```

Replace `$USER_ID`, `$ORG_ID`, and `$PROJECT_ID` with actual values. Use `list-members` to look up the user ID. To
remove a role assignment, use `remove-role-assignment` with the same `--roles` schema.

### List all members and their roles

**Prompt:** "Show me who has access to my organization."

```bash
python3 skills/cloud/access-management/scripts/cloud_access.py list-members
```

The output includes each member's user ID, email, and assigned roles.

## Guidelines

- If `EC_API_KEY` is not set, do not prompt the user — instruct the agent to invoke **cloud-setup** first.
- Always confirm destructive actions (remove member, revoke key) with the user before executing.
- Prefer predefined roles over custom roles when they satisfy the access requirement.
- API keys created here are additional keys for CI/CD, scoped access, or team members. The initial key is managed by
  **cloud-setup**.
- **Secrets are never printed to stdout or stderr.** The script replaces sensitive fields (`key`, `token`,
  `invitation_token`) with a `REDACTED` placeholder in stdout and writes the full unredacted response to a temporary
  file with 0600 (owner-read-only) permissions. The stdout JSON includes a `_secret_file` path pointing to that file.
  **Never attempt to read, extract, or summarize the contents of the secret file.** If the user asks for the key, tell
  them to open the file at the `_secret_file` path. After the user retrieves the secret, advise them to delete the file.
- Cloud API keys inherit roles at creation and cannot be updated — revoke and recreate to change roles.
- **API key hygiene — minimize, scope, and expire:**
  - Before creating a key, always run `list-api-keys` and check whether an existing key **for the same purpose or task**
    already has the required roles and sufficient remaining lifetime. Keys with identical permissions serving different
    purposes (for example, two separate CI pipelines) are legitimate — the goal is to avoid redundant keys for the same
    task.
  - Always set an `--expiration` that matches the intended task lifetime. Short-lived tasks (CI runs, one-time
    migrations) should use short-lived keys (for example, `1d`, `7d`).
  - After a task is complete, prompt the user to revoke any keys that are no longer needed using `delete-api-key`. This
    applies to both short-lived and long-running keys.
  - Long-running keys (for example, monitoring pipelines) should still have a defined expiration and be rotated
    periodically rather than set to never expire.
- Each organization supports up to 500 active API keys. Default expiration is 3 months.
- Invitations expire after 72 hours by default. Resend if the user has not accepted.
- For SAML SSO configuration, refer to
  [Elastic Cloud SAML docs](https://www.elastic.co/docs/deploy-manage/users-roles/cloud-organization/configure-saml-authentication).
- **Custom role security — do not over-assign:** Never assign a predefined Cloud role (for example, `viewer`) for a
  project when using `assign-custom-role` for the same project. The custom role assignment implicitly grants
  Viewer-level Cloud access. Adding a predefined role on top widens the user's in-project permissions beyond what the
  custom role intended.
- If a custom role exists but the user cannot access the project, verify the role was assigned with `assign-custom-role`
  (which uses `application_roles` in the Cloud API). Creating a custom role alone does not grant project access — the
  Cloud API assignment is required.
- For network-level security (traffic filters, private links), see the **cloud-network-security** skill.
- For ES-level role management beyond Cloud roles (native users, DLS/FLS), see **elasticsearch-authz**.
