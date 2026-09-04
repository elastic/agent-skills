---
name: cloud-onboarding
description: >
  Onboard an Elastic Cloud organization: configure the `elastic` CLI's Cloud context
  and API key, establish a default region, then invite users, assign predefined or
  custom Serverless project roles, and create or revoke Cloud API keys. Use when setting
  up Cloud authentication or when granting, modifying, or auditing user access to
  an organization and its projects.
compatibility: >
  Requires the `elastic` CLI (>= 0.2) with `cloud` support and network access to the
  Elastic Cloud API (api.elastic-cloud.com). Custom-role operations additionally need
  an Elasticsearch context on the target Serverless project with `manage_security`.
  Targets the Elastic Cloud control plane; not applicable to self-managed clusters.
metadata:
  author: elastic
  version: 0.3.0
  universal: true
---

# Cloud Onboarding

Stand up access to an Elastic Cloud organization end to end: configure the `elastic` CLI so it can operate the control
plane, then manage identity and access — invite users, assign predefined or custom roles to Serverless projects, and
manage Cloud API keys. For creating and operating projects and deployments, use the **cloud-provisioning** skill.

## Environment Configuration

This skill configures the `elastic` CLI itself, so its setup lives here rather than being assumed. If the
[`elastic` CLI](https://github.com/elastic/cli#configuration) is not installed, tell the user what it is needed for.

Cloud control-plane access is authenticated by an **Elastic Cloud API key** (organization scope), stored in a CLI
**context**. Register it without ever having the user paste the secret into the chat:

- Only **Organization owners** can create Cloud API keys. Direct the user to generate one at
  [Elastic Cloud API keys](https://cloud.elastic.co/account/keys) with **Project Admin** privileges or higher so it can
  manage serverless projects.
- If the user has no Elastic Cloud account, propose the free
  [Elastic Cloud trial](https://cloud.elastic.co/registration) (14 days, no credit card). Once registered, continue with
  key generation.
- Add the key to a context (the secret is stored in the OS keychain, not echoed):
  `elastic config context add cloud --cloud-url https://api.elastic-cloud.com --cloud-api-key <KEY>`, then make it
  active with `elastic config current-context set cloud`.

Do not guess credentials, bypass the CLI to call the HTTP API directly, or ask the user to reveal the key. This skill
references control-plane operations in HTTP-shorthand form with the `cloud:` prefix (for example,
`GET cloud:/api/v1/organizations`); the [Operations](#operations) table maps each to the equivalent `elastic cloud`
command.

For detailed API schemas (role assignments, Cloud API keys, custom roles), see
[references/api-reference.md](references/api-reference.md). For Elasticsearch-level role management beyond Cloud roles
(native users, role mappings, DLS/FLS) see **elasticsearch-authz**.

## Jobs to be done

- Configure and validate a Cloud context; establish a default region for later project creation
- Invite a user and assign a Serverless project role; list members and their roles; update or remove access
- Create, list, and revoke Cloud API keys, optionally with Elasticsearch/Kibana API access on projects
- Create a custom role in a Serverless project and assign it via the Cloud API's `application_roles`
- Translate a natural-language access request into invite, role, and API key tasks

## Process: validate the environment

1. **Validate the Cloud context.** Confirm the active context can reach the control plane by calling
   `GET cloud:/api/v1/organizations`. A successful response lists the organizations the key belongs to and yields the
   organization ID other steps need. If it returns an authentication error, the context is missing or the key is invalid
   or expired — return to [Environment Configuration](#environment-configuration) and register a valid key. Do not
   proceed until validation succeeds, and never ask the user for the organization ID — discover it here.

2. **Establish a default region (optional).** When the user plans to create projects, list the available regions with
   `GET cloud:/api/v1/serverless/regions` and confirm a default. Default to `gcp-us-central1` unless the user requests
   otherwise; only regions with `project_creation_enabled: true` accept new projects. Region choice is permanent per
   project, so surface it early.

## Permissions

This skill does not pre-check roles; it attempts the operation and lets the API enforce authorization. On a `403`, stop
and ask the user to verify the API key's permissions.

| Operation                          | Required permission                                            |
| ---------------------------------- | -------------------------------------------------------------- |
| Invite / remove members            | Organization owner (`organization-admin`)                      |
| Assign or remove roles             | Organization owner (`organization-admin`)                      |
| Create / revoke Cloud API keys     | Organization owner (`organization-admin`)                      |
| List members, invitations, or keys | Any organization member                                        |
| Create / delete custom roles       | `manage_security` cluster privilege on the project ES endpoint |

## Predefined roles

Prefer predefined roles; only create a custom role when they lack the required granularity.

**Organization:** `organization-admin` (full admin), `billing-admin` (billing only).

**Serverless project roles** (assign at invitation or via role-assignment update):

| Role      | `role_id`                                                              | Available on          |
| --------- | ---------------------------------------------------------------------- | --------------------- |
| Admin     | `admin`                                                                | Search, Obs, Security |
| Developer | `developer`                                                            | Search                |
| Viewer    | `viewer`                                                               | Search, Obs, Security |
| Editor    | `editor`                                                               | Obs, Security         |
| Analysts  | `t1_analyst`, `t2_analyst`, `t3_analyst`, `soc_manager`, `rule_author` | Security              |

See [references/api-reference.md](references/api-reference.md) for the full `role_assignments` schema (organization,
deployment, and project scopes) and the complete Security role list.

## Process: decompose an access request

When the user describes access in natural language (for example, "add Alice to my search project as a developer"), break
it down before executing.

1. **Identify components.** Who (new invite vs existing member), what (which project or org-level), access level
   (predefined vs custom role), and whether an API key is also needed.

2. **Check existing state first.** List members with `GET cloud:/api/v1/organizations/{org_id}/members` and, for key
   requests, existing keys with `GET cloud:/api/v1/users/auth/keys`. If the user is already a member, update their roles
   instead of inviting. If an active key already exists **for the same purpose** with the right roles and enough
   remaining lifetime, reuse it.

3. **Execute the smallest sufficient change.**
   - **Invite** a new member with `POST cloud:/api/v1/organizations/{org_id}/invitations` (include project role
     assignments, or invite without roles when a custom role will follow).
   - **Update** an existing member's roles with `POST cloud:/api/v1/users/{user_id}/role_assignments`; remove with the
     `DELETE` variant.
   - **Remove** a member with `DELETE cloud:/api/v1/organizations/{org_id}/members/{user_ids}` (confirm first).
   - **Create a Cloud API key** with `POST cloud:/api/v1/users/auth/keys`; revoke with
     `DELETE cloud:/api/v1/users/auth/keys` (confirm first). Confirm destructive actions (remove member, revoke key)
     with the user before executing.

4. **Verify.** List members or keys again to confirm the change took effect.

## Custom roles (Serverless)

When predefined roles lack the granularity, create a custom role in the project via the Elasticsearch security API and
assign it through the Cloud API's `application_roles`:

1. Create the role in the project with `PUT /_security/role/{name}` (runs against the project's Elasticsearch endpoint;
   requires `manage_security`). Role names must start with a letter or digit and contain only letters, digits, `_`, `-`,
   `.`. Run-as privileges are not available in Serverless.
2. Invite the user if needed — **without** project role assignments (the custom role handles project access).
3. Assign the custom role by setting `application_roles` on a project-scoped role assignment
   (`POST cloud:/api/v1/users/{user_id}/role_assignments`) with `role_id` set to the project-type viewer
   (`elasticsearch-viewer`, `observability-viewer`, `security-viewer`).

> **Do not also assign a predefined Cloud role for the same project.** A custom role already grants Viewer-level Cloud
> access; adding `viewer` (or another predefined role) gives the user the union of both, widening access beyond what the
> custom role intends.

## Cloud API keys with stack access

Cloud API keys can also call Elasticsearch and Kibana APIs on Serverless projects by including `application_roles` in
their `role_assignments`. Unlike users, **API keys never inherit stack roles from `role_id`** — without
`application_roles` the key has Cloud-API-only access and receives `403` on ES/Kibana calls.

- **Default to project-scoped** assignments (`project` key) so the key only reaches named projects or all projects of a
  type.
- **Organization-scoped** assignments (`organization` key) grant ES/Kibana access to **all current and future** projects
  — the broadest data-plane scope. Only use it for genuine cross-project automation, and confirm with the user first.
- Custom role names in `application_roles` must exist in each target project, or the key silently gets no access there.
  Predefined roles (`admin`, `developer`, `viewer`) exist in every project by default.

## Examples

**"Set up my cloud environment"** — verify a Cloud context exists, then validate it with
`GET cloud:/api/v1/organizations`. If it fails, walk the user through generating an Organization-level Cloud API key and
registering it as a context (never in chat), then re-validate and report the discovered organization.

**"Set up cloud in the EU region"** — after validating the context, list regions with
`GET cloud:/api/v1/serverless/regions`, pick an EU region (for example `aws-eu-west-1`), and confirm it as the default
for subsequent project creation.

**"Add `alice@example.com` to my search project with read-only access"** — check members with
`GET cloud:/api/v1/organizations/{org_id}/members`; if Alice is new,
`POST cloud:/api/v1/organizations/{org_id}/invitations` with a project-scoped `viewer` role for the Elasticsearch
project.

**"Create a 30-day CI key that can index into our search projects"** — list keys with
`GET cloud:/api/v1/users/auth/keys` to avoid duplicates, then `POST cloud:/api/v1/users/auth/keys` with a project-scoped
`developer` role assignment including `application_roles: ["developer"]` and `expiration: "30d"`. The secret is shown
once — never repeat it in chat.

**"Give `bob@example.com` read-only access to marketing-\* on my search project"** — create a custom role with
`PUT /_security/role/marketing-reader` (read on `marketing-*`), invite Bob without project roles, then assign the custom
role via `application_roles` on `POST cloud:/api/v1/users/{user_id}/role_assignments`. Do not also assign `viewer`.

**"Show who has access to my organization"** — `GET cloud:/api/v1/organizations/{org_id}/members` and present each
member's ID, email, and roles.

## Guidelines

- Validate the Cloud context first; discover the organization ID from `GET cloud:/api/v1/organizations` — do not ask for
  it.
- **Never receive, echo, or log credentials in chat.** Register the Cloud API key into a CLI context so the secret goes
  to the OS keychain; if the user offers to paste a key, decline and point them to context registration instead. A
  created key's secret is shown only once — tell the user to store it securely; never repeat it.
- **Default region is `gcp-us-central1`** — only change it when the user requests a different region.
- Confirm destructive actions (remove member, revoke key) before executing.
- Prefer predefined roles; reach for custom roles only when needed, and never stack a predefined Cloud role on the same
  project as a custom role.
- **API key hygiene:** check existing keys before creating; set an `expiration` matching the task lifetime; prompt the
  user to revoke keys no longer needed. Each organization supports up to 500 active keys; default expiration is 3
  months. Invitations expire after 72 hours by default. Cloud API keys inherit roles at creation and cannot be updated —
  revoke and recreate to change roles.
- For creating and operating projects, traffic filters, and deployments, see **cloud-provisioning**; for ES-level role
  management see **elasticsearch-authz**.

## Operations

| HTTP API (shorthand)                                               | `elastic` CLI command                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `GET cloud:/api/v1/organizations`                                  | `elastic cloud orgs list-organizations`                                                                   |
| `GET cloud:/api/v1/serverless/regions`                             | `elastic cloud serverless regions list-regions`                                                           |
| `GET cloud:/api/v1/organizations/{org_id}/members`                 | `elastic cloud orgs list-organization-members --organization-id <org_id>`                                 |
| `POST cloud:/api/v1/organizations/{org_id}/invitations`            | `elastic cloud orgs create-organization-invitations --organization-id <org_id> --input-file <json>`       |
| `GET cloud:/api/v1/organizations/{org_id}/invitations`             | `elastic cloud orgs list-organization-invitations --organization-id <org_id>`                             |
| `DELETE cloud:/api/v1/organizations/{org_id}/invitations/{tokens}` | `elastic cloud orgs delete-organization-invitations --organization-id <org_id> --invitation-tokens <csv>` |
| `DELETE cloud:/api/v1/organizations/{org_id}/members/{user_ids}`   | `elastic cloud orgs delete-organization-memberships --organization-id <org_id> --user-ids <csv>`          |
| `POST cloud:/api/v1/users/{user_id}/role_assignments`              | `elastic cloud users add-role-assignments --user-id <user_id> --input-file <json>`                        |
| `DELETE cloud:/api/v1/users/{user_id}/role_assignments`            | `elastic cloud users remove-role-assignments --user-id <user_id> --input-file <json>`                     |
| `POST cloud:/api/v1/users/auth/keys`                               | `elastic cloud auth create-api-key --input-file <json>`                                                   |
| `GET cloud:/api/v1/users/auth/keys`                                | `elastic cloud auth get-api-keys`                                                                         |
| `DELETE cloud:/api/v1/users/auth/keys`                             | `elastic cloud auth delete-api-keys --input-file <json>`                                                  |
| `PUT /_security/role/{name}`                                       | `elastic es security put-role --name <name> --input-file <json>`                                          |
| `GET /_security/role`                                              | `elastic es security get-role`                                                                            |
| `DELETE /_security/role/{name}`                                    | `elastic es security delete-role --name <name>`                                                           |
