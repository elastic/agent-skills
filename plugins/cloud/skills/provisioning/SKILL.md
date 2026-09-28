---
name: cloud-provisioning
description: >
  Provision and operate Elastic Cloud infrastructure: create, connect to, update,
  and delete Serverless projects (Elasticsearch, Observability, Security); manage
  traffic filters (IP and AWS PrivateLink network security); and manage the lifecycle
  of Elastic Cloud Hosted deployments. Use when creating or performing day-2 operations
  on serverless projects or hosted deployments, or restricting their network access.
compatibility: >
  Requires the `elastic` CLI (>= 0.2) with `cloud serverless` and `cloud hosted` support
  and network access to the Elastic Cloud API (api.elastic-cloud.com). Serverless
  operations apply to Elastic Cloud Serverless; deployment operations apply to Elastic
  Cloud Hosted. Depends on a configured Cloud context (see cloud-onboarding).
metadata:
  author: elastic
  version: 0.3.0
  universal: true
---

# Cloud Provisioning

Provision and run Elastic Cloud infrastructure through the Cloud API: **Serverless projects** (create and day-2
operations), **traffic filters** (network security for those projects), and **Elastic Cloud Hosted deployments**. For
configuring Cloud authentication and managing organization access, use the **cloud-onboarding** skill.

<!-- begin-partial: cloud-preamble -->

## Environment Configuration

This skill operates the Elastic Cloud control plane through the `elastic` CLI. If the
[`elastic` CLI](https://github.com/elastic/cli#configuration) is not installed, tell the user what it is needed for. Do
not guess credentials, bypass the CLI to call the HTTP API directly, or attempt other workarounds.

Control-plane operations authenticate against the Elastic Cloud API (organization scope), not a single stack deployment.
The `elastic` CLI reads this from its active context, which stores an Elastic Cloud API key in the OS keychain. If a
control-plane call fails with an authentication error, the context is missing or lacks a Cloud API key — instruct the
user to add one, and **never** ask the user to paste an API key into the chat:

> "Configure an Elastic Cloud context for the `elastic` CLI, then re-run. Generate an Organization-level key at
> [Elastic Cloud API keys](https://cloud.elastic.co/account/keys) and register it without echoing the secret in chat."

This skill references control-plane operations in HTTP-shorthand form with the `cloud:` prefix (e.g.,
`GET cloud:/api/v1/organizations`, `POST cloud:/api/v1/serverless/projects/elasticsearch`). The
[Operations](#operations) table at the end of this document maps each shorthand to the equivalent `elastic cloud`
command — always use the CLI rather than calling the HTTP API directly. Discover the organization ID from
`GET cloud:/api/v1/organizations`; do not ask the user for it.

<!-- end-partial: cloud-preamble -->

## Critical principles

- **Never display secrets in chat.** Do not echo, log, or repeat passwords or API keys in conversation or agent
  thinking. Persist credentials into a CLI context (OS keychain) and direct the user there.
- **Confirm before creating or destroying.** A project's or deployment's region is permanent; deletion is irreversible.
  Present the configuration and get explicit confirmation before creating, deleting, or resetting credentials.
- **Admin credentials are bootstrap-only.** The `admin` password returned on creation or reset exists solely to create a
  scoped API key. Never use admin credentials for ongoing Elasticsearch operations — mint a scoped key first.
- **Wait for readiness.** A new project or deployment starts `initializing`; wait until `initialized` before using it.
- **Two kinds of credentials.** The **Cloud context** (Cloud API key) authorizes control-plane operations here. A
  project's or deployment's **Elasticsearch API key** authorizes data-plane operations against its Elasticsearch
  endpoint — do not confuse the two. See [references/credentials-and-context.md](references/credentials-and-context.md).

---

## Serverless projects

### Project types

| Type            | Description                               | Included services                |
| --------------- | ----------------------------------------- | -------------------------------- |
| `elasticsearch` | Search, analytics, and vector workloads   | Elasticsearch, Kibana            |
| `observability` | Logs, metrics, traces, and APM            | Elasticsearch, Kibana, APM, OTLP |
| `security`      | SIEM, endpoint protection, cloud security | Elasticsearch, Kibana, OTLP      |

Map the user's request to the correct type; never silently default — infer from context and confirm, or ask when
ambiguous. "search"/"elasticsearch"/vector search → `elasticsearch`; "o11y"/logs/metrics/traces/APM → `observability`;
"SIEM"/detections/endpoint → `security`.

**Tiers and optimization.** Elasticsearch: set `optimized_for` to `general_purpose` (default) unless the user explicitly
requests `vector`. Observability: set `product_tier` to `complete` (default) or `logs_essentials`. Security: set
`product_types` tiers to `complete` (default) or `essentials` per product line (`security`, `cloud`, `endpoint`). See
[references/api-reference.md](references/api-reference.md) for the full request-body schema of each type.

### Process: create a serverless project

1. **Confirm the project type.** Infer it from the conversation and propose it, or ask the user to choose. Do not
   proceed on an assumed type.
2. **Confirm the configuration.** Present a summary — name (required; ask if missing), region (default
   `gcp-us-central1`), and the tier/optimization for the type — and get explicit confirmation. If the region is
   uncertain, list options with `GET cloud:/api/v1/serverless/regions` first; only regions with
   `project_creation_enabled: true` accept new projects. Region is permanent.
3. **Create the project.** Call `POST cloud:/api/v1/serverless/projects/{type}` with the confirmed body. Wait for the
   `initialized` phase and persist the returned credentials into a named CLI context (the password goes to the OS
   keychain, never to stdout or chat).
4. **Verify readiness.** If creation did not block until ready, poll
   `GET cloud:/api/v1/serverless/projects/{type}/{id}/status` until `phase` is `initialized`. The Elasticsearch and
   Kibana endpoints in the creation response are safe to share; the password is not.
5. **Bootstrap a scoped API key.** Using the project context, create a scoped Elasticsearch API key with only the
   privileges the user needs via `POST /_security/api_key` (the project's Elasticsearch endpoint), then rely on that key
   for all data-plane work. If the **elasticsearch-authn** skill is available, use it for full key lifecycle handling.

### Workflow: connect to an existing project

Use this when the user asks to query or manage a project not created in the current session. It applies to **Elastic
Cloud Serverless projects only** — if the cluster is self-managed or Elastic Cloud Hosted, use the Hosted deployment
workflow or skip. If unsure, ask: "Is your Elasticsearch instance an Elastic Cloud Serverless project?"

1. **Resolve the project.** Infer the type and list projects with `GET cloud:/api/v1/serverless/projects/{type}`. Match
   the user's reference (name or alias). If multiple or none match, present candidates and ask.
2. **Load endpoints and credentials.** Fetch the project with `GET cloud:/api/v1/serverless/projects/{type}/{id}` to get
   its Elasticsearch and Kibana endpoints, and select or create a CLI context bound to it.
3. **Acquire Elasticsearch credentials.** Verify any existing project API key with `GET /_security/_authenticate`
   (expect `"authentication_type": "api_key"`). If none works, confirm with the user, reset the admin bootstrap
   credentials with `POST cloud:/api/v1/serverless/projects/{type}/{id}/_reset-credentials`, use the admin password once
   to create a scoped key via `POST /_security/api_key`, persist it to the context, re-verify, and drop the admin
   credentials.

### Day-2: list, get, update, delete, resume

- **List** projects of a type: `GET cloud:/api/v1/serverless/projects/{type}`.
- **Get** one project: `GET cloud:/api/v1/serverless/projects/{type}/{id}`.
- **Update** (PATCH semantics — only supplied fields change): `PATCH cloud:/api/v1/serverless/projects/{type}/{id}`.
- **Reset credentials** (confirm first): `POST cloud:/api/v1/serverless/projects/{type}/{id}/_reset-credentials`.
- **Delete** (confirm first — permanent): `DELETE cloud:/api/v1/serverless/projects/{type}/{id}`.
- **Resume** a suspended project, then poll status until `initialized`:
  `POST cloud:/api/v1/serverless/projects/{type}/{id}/_resume`.

**Update fields and their risks.** Supported PATCH fields: `name`, `alias`, `metadata.tags`, `traffic_filters`, and —
for Elasticsearch — `search_lake.search_power` (28–3000) and `search_lake.boost_window` (1–180 days); for Security —
data-retention limits.

- **Alias changes rewrite every endpoint URL**, breaking existing clients. Warn before changing it.
- **Tags replace the whole tag set.** Read current tags with a `GET` first and include any the user wants to keep.
- **`search_power` drives cost.** Higher values increase VCU consumption. Warn and confirm before raising it (presets:
  28 on-demand, 100 performant, 250 high availability).
- **Reducing max retention permanently deletes data** older than the new limit. Warn and confirm before lowering it.

---

## Traffic filters (network security)

Traffic filters restrict network access to Serverless projects. The Elastic Cloud UI calls this **network security**;
the Cloud API uses **traffic filters** (`traffic-filters` in paths, `traffic_filters` in project JSON). The two types
are **IP filters** (type `ip`, allowlist IPs/CIDRs) and **VPC filters** (type `vpce`, AWS PrivateLink endpoint IDs).

> Private connectivity in AWS is accepted by default. A VPC filter is only needed to **restrict** traffic to specific
> endpoint IDs. If you only need private connectivity (not filtering), create the VPC endpoint and DNS record in AWS —
> no filter is required. Use `GET cloud:/api/v1/serverless/traffic-filters/metadata` to look up the PrivateLink service
> name for a region before creating the endpoint in AWS.

### Process: create and attach a filter

1. **Identify components.** Filter type (IP vs VPC), target region, source rules (IPs/CIDRs or VPC endpoint IDs), and
   which projects the filter should apply to.
2. **Check existing state.** List current filters with `GET cloud:/api/v1/serverless/traffic-filters` (optionally scoped
   by region). If a filter already covers the same sources **for the same purpose**, reuse it — filters are
   region-scoped and can attach to many projects.
3. **Create the filter.** Call `POST cloud:/api/v1/serverless/traffic-filters` with the `type`, `region`, and `rules`.
   The response contains the generated filter `id`.
4. **Associate with projects.** Filter-to-project association is done through the project PATCH endpoint
   (`PATCH cloud:/api/v1/serverless/projects/{type}/{id}` with a `traffic_filters` array). Provide the **complete** list
   of filter IDs; any ID omitted is disassociated.
5. **Verify.** List filters again or `GET` the project to confirm the change took effect.

**Filter guidance:** filters are region-scoped (a filter can only attach to projects in its region). Updating rules
replaces the entire rule set — include all existing rules plus the new one. A filter cannot be deleted while still
associated with a project — disassociate first, then `DELETE cloud:/api/v1/serverless/traffic-filters/{id}`.
`include_by_default` auto-attaches a filter to all new projects in the region — use with caution. See
[references/traffic-filters.md](references/traffic-filters.md) for the full schemas.

---

## Hosted deployments

Elastic Cloud Hosted deployments are full stack deployments (Elasticsearch, Kibana, and optional APM/Integrations
Server/Enterprise Search) sized from a deployment template, distinct from Serverless projects. Manage their lifecycle
through the Cloud API's deployment endpoints.

### Process: create a hosted deployment

1. **Choose a region and template.** List deployment templates with `GET cloud:/api/v1/deployments/templates` for the
   target region and confirm the template and stack version with the user. Region is permanent.
2. **Confirm the configuration** (name, region, template, version, sizing) and get explicit confirmation before
   creating.
3. **Create the deployment.** Call `POST cloud:/api/v1/deployments` with the resource definition (or a `template_id`).
   The response returns the deployment ID and a one-time `elastic` user password and endpoints — persist the credentials
   into a CLI context (keychain), never to chat.
4. **Verify readiness and bootstrap a scoped key.** Poll `GET cloud:/api/v1/deployments/{id}` until healthy, then mint a
   scoped Elasticsearch API key via `POST /_security/api_key` and stop using the bootstrap `elastic` password. See
   [references/hosted-deployments.md](references/hosted-deployments.md) for the create body and template schema.

### Day-2: get, update, shut down, restore

- **List** deployments: `GET cloud:/api/v1/deployments`.
- **Get** one deployment: `GET cloud:/api/v1/deployments/{id}`.
- **Update** (resize, upgrade version, change resources): `PUT cloud:/api/v1/deployments/{id}`.
- **Shut down** (confirm first — stops the deployment): `POST cloud:/api/v1/deployments/{id}/_shutdown`.
- **Restore** a shut-down deployment: `POST cloud:/api/v1/deployments/{id}/_restore`.

Hosted deployments use their own **traffic-filter rulesets**, managed separately from the Serverless traffic filters
above — do not mix the two. See [references/hosted-deployments.md](references/hosted-deployments.md).

---

## Examples

**"Create a search project called acme-search"** — confirm type `elasticsearch`, present the summary (name
`acme-search`, region `gcp-us-central1`, `optimized_for general_purpose`), and on confirmation call
`POST cloud:/api/v1/serverless/projects/elasticsearch`, wait for `initialized`, persist credentials, then create a
scoped API key with `POST /_security/api_key`.

**"List my security projects"** — call `GET cloud:/api/v1/serverless/projects/security` and present the names and IDs;
treat it as a read-only day-2 request.

**"Connect to my search project prod-search"** — list Elasticsearch projects, match `prod-search`, `GET` it for
endpoints, then verify or mint a scoped Elasticsearch API key before any data-plane work.

**"Bump search power to 500 on my search project"** — warn about the cost increase, confirm, then
`PATCH cloud:/api/v1/serverless/projects/elasticsearch/{id}` with `search_lake.search_power = 500`.

**"Only allow our office network 203.0.113.0/24 to projects in us-east-1"** — list existing filters for `us-east-1`,
create an `ip` filter with `POST cloud:/api/v1/serverless/traffic-filters` (rule source `203.0.113.0/24`), then attach
the filter ID to the target projects via `PATCH cloud:/api/v1/serverless/projects/{type}/{id}`.

**"Spin up a hosted deployment in us-east-1"** — list templates with `GET cloud:/api/v1/deployments/templates`, confirm
the template and stack version, then `POST cloud:/api/v1/deployments`, wait until healthy, and mint a scoped API key.

## Guidelines

- Validate the Cloud context first (see [Environment Configuration](#environment-configuration)); use
  **cloud-onboarding** to configure it when validation fails.
- Never display passwords or API keys in chat — persist them to a CLI context (OS keychain), and mint a scoped API key
  instead of relying on bootstrap admin credentials.
- Never silently default a project type; infer and confirm. Default to `general_purpose` optimization and the `complete`
  tier; only change on explicit request.
- Region cannot be changed after creation, and deletion/shutdown is permanent — confirm before proceeding.
- Traffic filters are region-scoped; updating rules replaces the whole set; disassociate a filter from all projects
  before deleting it.
- Keep Serverless traffic filters and Hosted deployment traffic-filter rulesets separate — they are different APIs.
- For granting user access and Cloud API keys, see **cloud-onboarding**; for Elasticsearch data-plane key lifecycle, see
  **elasticsearch-authn**.

## Operations

| HTTP API (shorthand)                                                           | `elastic` CLI command                                                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `GET cloud:/api/v1/serverless/regions`                                         | `elastic cloud serverless regions list-regions`                                                     |
| `POST cloud:/api/v1/serverless/projects/elasticsearch`                         | `elastic cloud serverless projects search create --input-file <json> --wait --save-as <ctx>`        |
| `POST cloud:/api/v1/serverless/projects/observability`                         | `elastic cloud serverless projects observability create --input-file <json> --wait --save-as <ctx>` |
| `POST cloud:/api/v1/serverless/projects/security`                              | `elastic cloud serverless projects security create --input-file <json> --wait --save-as <ctx>`      |
| `GET cloud:/api/v1/serverless/projects/elasticsearch`                          | `elastic cloud serverless projects search list`                                                     |
| `GET cloud:/api/v1/serverless/projects/elasticsearch/{id}`                     | `elastic cloud serverless projects search get --id <id>`                                            |
| `GET cloud:/api/v1/serverless/projects/elasticsearch/{id}/status`              | `elastic cloud serverless projects search get-status --id <id>`                                     |
| `PATCH cloud:/api/v1/serverless/projects/elasticsearch/{id}`                   | `elastic cloud serverless projects search patch --id <id> --input-file <json>`                      |
| `DELETE cloud:/api/v1/serverless/projects/elasticsearch/{id}`                  | `elastic cloud serverless projects search delete --id <id>`                                         |
| `POST cloud:/api/v1/serverless/projects/elasticsearch/{id}/_reset-credentials` | `elastic cloud serverless projects search reset-credentials --id <id> --save-as <ctx>`              |
| `POST cloud:/api/v1/serverless/projects/elasticsearch/{id}/_resume`            | `elastic cloud serverless projects search resume --id <id>`                                         |
| `GET cloud:/api/v1/serverless/traffic-filters`                                 | `elastic cloud serverless traffic-filters list-traffic-filters --region <region>`                   |
| `POST cloud:/api/v1/serverless/traffic-filters`                                | `elastic cloud serverless traffic-filters create-traffic-filter --input-file <json>`                |
| `GET cloud:/api/v1/serverless/traffic-filters/{id}`                            | `elastic cloud serverless traffic-filters get-traffic-filter --id <id>`                             |
| `PATCH cloud:/api/v1/serverless/traffic-filters/{id}`                          | `elastic cloud serverless traffic-filters patch-traffic-filter --id <id> --input-file <json>`       |
| `DELETE cloud:/api/v1/serverless/traffic-filters/{id}`                         | `elastic cloud serverless traffic-filters delete-traffic-filter --id <id>`                          |
| `GET cloud:/api/v1/serverless/traffic-filters/metadata`                        | `elastic cloud serverless traffic-filters get-traffic-filter-metadata --region <region>`            |
| `GET cloud:/api/v1/deployments/templates`                                      | `elastic cloud hosted deployment-templates get-deployment-templates-v2`                             |
| `GET cloud:/api/v1/deployments`                                                | `elastic cloud hosted deployments list-deployments`                                                 |
| `POST cloud:/api/v1/deployments`                                               | `elastic cloud hosted deployments create-deployment --input-file <json>`                            |
| `GET cloud:/api/v1/deployments/{id}`                                           | `elastic cloud hosted deployments get-deployment --deployment-id <id>`                              |
| `PUT cloud:/api/v1/deployments/{id}`                                           | `elastic cloud hosted deployments update-deployment --deployment-id <id> --input-file <json>`       |
| `POST cloud:/api/v1/deployments/{id}/_shutdown`                                | `elastic cloud hosted deployments shutdown-deployment --deployment-id <id>`                         |
| `POST cloud:/api/v1/deployments/{id}/_restore`                                 | `elastic cloud hosted deployments restore-deployment --deployment-id <id>`                          |
| `GET /_security/_authenticate`                                                 | `elastic es security authenticate`                                                                  |
| `POST /_security/api_key`                                                      | `elastic es security create-api-key --input-file <json>`                                            |

Use the matching `projects observability …` / `projects security …` commands for observability and security project
types.
