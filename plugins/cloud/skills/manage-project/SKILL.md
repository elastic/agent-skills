---
name: cloud-manage-project
description: >
  Manages existing Elastic Cloud Serverless projects: list, get, update, delete, reset
  credentials, resume, and load saved credentials. Connects to existing projects by
  resolving endpoints and acquiring scoped Elasticsearch API keys. Use when performing
  day-2 operations on serverless projects, connecting to an existing project, loading
  or resetting project credentials, or looking up project details.
compatibility: >
  Requires Python 3.8+, network access to the Elastic Cloud API (api.elastic-cloud.com)
  for API commands; load-credentials works locally without network access. Environment
  variables: EC_API_KEY (required for API commands, set by cloud-setup).
metadata:
  author: elastic
  version: 0.1.0
---

# Manage Serverless Project

Perform day-2 operations on Elastic Cloud Serverless projects using the Serverless REST API.

## Prerequisites and permissions

- Ensure `EC_API_KEY` is configured. If not, run `cloud-setup` skill first.
- Updating project settings requires **Admin** or **Editor** role on the target project.
- This skill does not perform a separate role pre-check. Attempt the requested operation and let the API enforce
  authorization. If the API returns an authorization error (for example, `403 Forbidden`), stop and ask the user to
  verify the provided API key permissions.

### Manual setup fallback (when `cloud-setup` is unavailable)

If this skill is installed standalone and `cloud-setup` is not available, instruct the user to configure Cloud
environment variables manually before running commands. Never ask the user to paste API keys in chat.

| Variable      | Required | Description                                                    |
| ------------- | -------- | -------------------------------------------------------------- |
| `EC_API_KEY`  | Yes      | Elastic Cloud API key used for project management operations.  |
| `EC_BASE_URL` | No       | Cloud API base URL (default: `https://api.elastic-cloud.com`). |

> **Note:** If `EC_API_KEY` is missing, or the user does not have a Cloud API key yet, direct the user to generate one
> at [Elastic Cloud API keys](https://cloud.elastic.co/account/keys), then configure it locally using the steps below.

Preferred method (agent-friendly): create a `.env` file in the project root:

```bash
EC_API_KEY=your-api-key
EC_BASE_URL=https://api.elastic-cloud.com
```

All `cloud/*` scripts auto-load `.env` from the working directory.

Alternative: export directly in the terminal:

```bash
export EC_API_KEY="<your-cloud-api-key>"
export EC_BASE_URL="https://api.elastic-cloud.com"
```

Terminal exports may not be visible to sandboxed agents running in separate shell sessions, so prefer `.env` when using
an agent.

## Critical principles

- **Never display secrets in chat.** Do not echo, log, or repeat API keys, passwords, or credentials in conversation
  messages or agent thinking. Direct the user to the `.elastic-credentials` file instead. The admin password must
  **never** appear in chat history, thinking traces, or agent output — even when using it to create an API key, pass it
  directly via shell variable substitution without echoing.
- **Confirm before destructive actions.** Always ask the user to confirm before deleting a project or resetting
  credentials.
- **Credentials are saved to file.** After a credential reset, the script writes the new password to
  `.elastic-credentials` automatically. The password is redacted from stdout. Never read or display the contents of
  `.elastic-credentials` in chat.
- **Admin credentials are for API key creation only.** The `admin` password saved by `create-project` and
  `reset-credentials` exists solely to bootstrap a scoped API key — never use it for direct Elasticsearch operations.
  `load-credentials` excludes admin credentials by default; pass `--include-admin` only for key creation.
- **Always prefer API keys.** Do not proceed with Elasticsearch operations until an `ELASTICSEARCH_API_KEY` is set. If
  only admin credentials are available, create a scoped API key via `elasticsearch-authn`. If that skill is not
  installed, ask the user to install it or create the key manually in **Kibana > Stack Management > API keys**.
- **Identify projects by type and ID.** Every command requires both `--type` and `--id` (except `list`, which only needs
  `--type`).
- **Two kinds of API keys.** This skill uses the **Cloud API key** (`EC_API_KEY`) for project management operations
  (list, get, update, delete). Elasticsearch operations require a separate **Elasticsearch API key**
  (`ELASTICSEARCH_API_KEY`) that authenticates against the project's Elasticsearch endpoint. Do not confuse the two.

## Workflow: Connect to an existing project

Use this workflow when the user asks to query or manage a project the agent did not create in the current session. It
resolves the project, saves its endpoints, and ensures working Elasticsearch credentials before proceeding.

This workflow only applies to **Elastic Cloud Serverless projects**. If the user's Elasticsearch instance is
self-managed or Elastic Cloud Hosted, this skill does not apply — skip it and proceed with the relevant skill directly.
If unsure, ask the user: **"Is your Elasticsearch instance an Elastic Cloud Serverless project?"**

```text
Connect to Existing Project:
- [ ] Step 1: Resolve the project
- [ ] Step 2: Get project details and load credentials
- [ ] Step 3: Acquire Elasticsearch credentials
```

### Step 1: Resolve the project

Ask the user for the **project name** if not already provided. Infer the project type from the user's request:

| User says                                                   | `--type`        |
| ----------------------------------------------------------- | --------------- |
| "search project", "elasticsearch project", vector search    | `elasticsearch` |
| "observability project", "o11y", logs, metrics, traces, APM | `observability` |
| "security project", "SIEM", detections, endpoint protection | `security`      |

If the type is ambiguous, list all three types to find the project.

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py list \
  --type elasticsearch
```

Match the user's reference (name, partial name, or alias) against the list results. If multiple projects match or none
match, present the candidates and ask the user to pick.

### Step 2: Get project details and load credentials

Once a single project is identified, check whether `.elastic-credentials` already has entries for this project (from a
previous session). If so, load them with `load-credentials`:

```bash
eval $(python3 skills/cloud/manage-project/scripts/manage-project.py load-credentials \
  --name "<project-name>")
```

This sets all saved environment variables for the project — endpoints and any previously created Elasticsearch API keys
— in a single command. Admin credentials (`ELASTICSEARCH_USERNAME`/`ELASTICSEARCH_PASSWORD`) are intentionally excluded.
Later sections for the same project automatically overwrite earlier values, so the most recent credentials always win.

If `load-credentials` reports no matching entries, fetch the project details from the API and export endpoints manually:

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py get \
  --type elasticsearch \
  --id <project-id>
```

Then export the endpoint URLs from the response. The available endpoints depend on the project type.

**All project types:**

```bash
export ELASTICSEARCH_URL="<elasticsearch_endpoint>"
export KIBANA_URL="<kibana_endpoint>"
```

**Observability projects** (additional):

```bash
export APM_URL="<apm_endpoint>"
export INGEST_URL="<ingest_endpoint>"
```

**Security projects** (additional):

```bash
export INGEST_URL="<ingest_endpoint>"
```

### Step 3: Acquire Elasticsearch credentials

If `load-credentials` set `ELASTICSEARCH_API_KEY`, verify the credentials work:

```bash
curl -H "Authorization: ApiKey ${ELASTICSEARCH_API_KEY}" \
  "${ELASTICSEARCH_URL}/_security/_authenticate"
```

Confirm the response contains a valid `username` and `"authentication_type": "api_key"` before proceeding. If
verification succeeds, skip the rest of this step.

If no credentials were loaded, or verification fails, ask the user: **"Do you have an existing Elasticsearch API key for
this project?"**

**If yes** — have the user add it to `.elastic-credentials` (see "Credential file format"). Do not accept keys in chat.
Reload and verify:

```bash
eval $(python3 skills/cloud/manage-project/scripts/manage-project.py load-credentials \
  --name "<project-name>")
curl -H "Authorization: ApiKey ${ELASTICSEARCH_API_KEY}" \
  "${ELASTICSEARCH_URL}/_security/_authenticate"
```

**If no** — follow this recovery path:

1. Confirm with the user, then reset the admin bootstrap credentials:

   ```bash
   python3 skills/cloud/manage-project/scripts/manage-project.py reset-credentials \
     --type elasticsearch \
     --id <project-id>
   ```

   The new password is saved to `.elastic-credentials` with the project name in the header. Direct the user to that file
   — do not display its contents.

2. Load credentials **with `--include-admin`** so the admin password is available for API key creation:

   ```bash
   eval $(python3 skills/cloud/manage-project/scripts/manage-project.py load-credentials \
     --name "<project-name>" --include-admin)
   ```

   Use the admin credentials to create a scoped Elasticsearch API key via `elasticsearch-authn` if available. If that
   skill is not installed, ask the user to install it or create the key manually in **Kibana > Stack Management > API
   keys**. Scope the key to only the privileges the user needs.

3. After creating the API key, save it to `.elastic-credentials` using the project-specific header format (see
   "Credential file format" below). Then reload **without `--include-admin`** to drop admin credentials from the
   environment and verify:

   ```bash
   eval $(python3 skills/cloud/manage-project/scripts/manage-project.py load-credentials \
     --name "<project-name>")
   curl -H "Authorization: ApiKey ${ELASTICSEARCH_API_KEY}" \
     "${ELASTICSEARCH_URL}/_security/_authenticate"
   ```

   Confirm the response shows a valid `username` and `"authentication_type": "api_key"` before proceeding.

## Credential file format

See [references/credential-file-format.md](references/credential-file-format.md) for the full format specification.

## Workflow: Load project credentials

```bash
eval $(python3 skills/cloud/manage-project/scripts/manage-project.py load-credentials \
  --name "<project-name>")
```

Or by project ID:

```bash
eval $(python3 skills/cloud/manage-project/scripts/manage-project.py load-credentials \
  --id <project-id>)
```

Parses `.elastic-credentials`, merges all sections for the matching project, and prints `export` statements. Admin
credentials (`ELASTICSEARCH_USERNAME`/`ELASTICSEARCH_PASSWORD`) are excluded by default — only endpoints and API keys
are exported. Add `--include-admin` when you need admin credentials to create an API key.

## Workflow: List projects

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py list \
  --type elasticsearch
```

Use `--type observability` or `--type security` to list other project types.

## Workflow: Get project details

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py get \
  --type elasticsearch \
  --id <project-id>
```

## Workflow: Update a project

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py update \
  --type elasticsearch \
  --id <project-id> \
  --name "new-project-name"
```

Only the fields provided are updated (PATCH semantics). Supported fields: `--name`, `--alias`, `--tag`,
`--search-power`, `--boost-window`, `--max-retention-days`, `--default-retention-days`.

### Alias

The alias is an RFC-1035 domain label (lowercase alphanumeric and hyphens, max 50 chars) that becomes part of the
project's endpoint URLs. **Changing the alias changes all endpoint URLs**, which breaks existing clients pointing to the
old URLs. Warn the user about this before applying.

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py update \
  --type elasticsearch \
  --id <project-id> \
  --alias "prod-search"
```

### Tags

Tags are key-value metadata pairs for team tracking, cost attribution, and organization. Pass `--tag KEY:VALUE` for each
tag. Multiple tags can be set in a single update.

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py update \
  --type elasticsearch \
  --id <project-id> \
  --tag env:prod \
  --tag team:search
```

Tags are sent as `metadata.tags` in the API request. Setting tags replaces all existing tags on the project — include
any existing tags the user wants to keep.

### Elasticsearch search_lake settings

For Elasticsearch projects, two fields control query performance and data caching in the Search AI Lake. Ingested data
is stored in cost-efficient general storage. A cache layer on top provides faster search speed for recent and frequently
queried data — this cached data is considered **search-ready**.

| Flag             | Range   | Description                                                                  |
| ---------------- | ------- | ---------------------------------------------------------------------------- |
| `--search-power` | 28–3000 | Query performance level. Higher values improve performance but increase cost |
| `--boost-window` | 1–180   | Days of data eligible for boosted caching (default: 7)                       |

#### Search Power

Search Power controls the speed of searches by provisioning more or fewer query resources. Common presets (matching the
Cloud UI):

| Value | Preset            | Behavior                                                                       |
| ----- | ----------------- | ------------------------------------------------------------------------------ |
| 28    | On-demand         | Autoscales with lower baseline. More variable latency, reduced max throughput  |
| 100   | Performant        | Consistently low latency, autoscales for moderately high throughput            |
| 250   | High availability | Optimized for high-throughput scenarios, maintains low latency at high volumes |

When the user asks for a preset by name, map it to the corresponding value. Custom values within 28–3000 are also valid.

**Warn the user about cost implications before updating `search_power`.** Higher values increase VCU consumption and may
result in higher bills. Confirm the new value with the user before applying.

#### Search Boost Window

Non-time-series data is always search-ready. The boost window determines how much **time-series** data (documents with a
`@timestamp` field) is also kept in the fast cache layer. Increasing the window means a larger portion of time-series
data becomes search-ready, which improves query speed for recent data but increases the search-ready data volume.

### Security data retention settings

For security projects, two fields control how long data is retained in the Search AI Lake. Retention is configured per
data stream, but these project-level settings enforce global boundaries.

| Flag                       | Unit | Description                                                    |
| -------------------------- | ---- | -------------------------------------------------------------- |
| `--max-retention-days`     | days | Maximum retention period for any data stream in the project    |
| `--default-retention-days` | days | Default retention applied to data streams without a custom one |

- **Maximum retention** — enforces an upper bound across all data streams. When lowered, it replaces the retention for
  any stream that currently has a longer period. Data older than the new maximum is **permanently deleted**.
- **Default retention** — automatically applied to data streams that do not have a custom retention period set. Does not
  affect streams with an existing custom retention.

**Warn the user before reducing `max-retention-days`.** Lowering the maximum permanently deletes data older than the new
limit. Confirm the new value with the user before applying.

## Workflow: Reset project credentials

**Always confirm with the user before resetting.**

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py reset-credentials \
  --type elasticsearch \
  --id <project-id>
```

The new password is saved to `.elastic-credentials` automatically. Tell the user to open that file — do not display its
contents in chat.

## Workflow: Delete a project

**Always confirm with the user before deleting.**

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py delete \
  --type elasticsearch \
  --id <project-id>
```

## Workflow: Resume a suspended project

Projects can be automatically suspended after their trial period expires. Resume with:

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py resume \
  --type elasticsearch \
  --id <project-id>
```

After resuming, poll the project status until the phase changes from `initializing` to `initialized`.

## Examples

### List all security projects

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py list --type security
```

### Update search power on an Elasticsearch project

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py update \
  --type elasticsearch \
  --id abc123def456abc123def456abc12345 \
  --search-power 500
```

### Set data retention on a security project

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py update \
  --type security \
  --id abc123def456abc123def456abc12345 \
  --max-retention-days 396 \
  --default-retention-days 396
```

### Change project alias

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py update \
  --type elasticsearch \
  --id abc123def456abc123def456abc12345 \
  --alias "prod-search"
```

### Tag a project for cost tracking

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py update \
  --type observability \
  --id abc123def456abc123def456abc12345 \
  --tag env:prod \
  --tag team:platform
```

### Rename an observability project

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py update \
  --type observability \
  --id abc123def456abc123def456abc12345 \
  --name "production-logs"
```

### Connect to an existing project (credentials on file)

```text
User: I want to run a query against my search project "prod-search"
Agent: Let me find that project.
       [runs: list --type elasticsearch]
       I found "prod-search" (ID: abc123...). Loading saved credentials...
       [runs: eval $(load-credentials --name prod-search)]
       Credentials loaded. Verifying...
       [runs: curl -H "Authorization: ApiKey ..." "${ELASTICSEARCH_URL}/_security/_authenticate"]
       Verified — authenticated as user "my-service" via API key. You're all set.
```

### Connect to a project (no saved credentials)

```text
User: let's ingest some logs into my o11y project "siem-prod"
Agent: Let me find that project.
       [runs: list --type observability]
       Found "siem-prod" (ID: def456...). No saved credentials found for this project.
       [runs: get --type observability --id def456...]
       Endpoints set. Since there are no Elasticsearch credentials on file, I can reset the
       admin bootstrap password to get initial access. Shall I proceed?
User: yes
Agent: [runs: reset-credentials --type observability --id def456...]
       Credentials saved to .elastic-credentials — open that file to retrieve the password.
       [runs: eval $(load-credentials --name siem-prod --include-admin)]
       Admin credentials loaded for API key creation. Creating a scoped Elasticsearch API key
       now — what access does it need?
User: read-only on logs-*
Agent: [creates scoped API key via elasticsearch-authn using admin credentials]
       [appends API key to .elastic-credentials with project header]
       [runs: eval $(load-credentials --name siem-prod)]
       [verifies against ELASTICSEARCH_URL]
       API key created and verified. Admin credentials removed from environment.
```

### Delete a project after confirmation

```text
User: delete my elasticsearch project abc123...
Agent: Are you sure you want to delete project abc123...? This cannot be undone.
User: yes
```

```bash
python3 skills/cloud/manage-project/scripts/manage-project.py delete \
  --type elasticsearch \
  --id abc123def456abc123def456abc12345
```

## Guidelines

- Run the `cloud-setup` skill first if `EC_API_KEY` is not set.
- Use the `cloud-create-project` skill to create new projects — this skill handles existing projects only.
- When the user refers to a project the agent did not create, follow the "Connect to an existing project" workflow.
- Deletion is permanent. Always confirm with the user before proceeding.
- After resetting credentials, remind the user to update any stored passwords or environment variables.
- Warn about cost implications before increasing `search_power`. Confirm the new value with the user first.
- Warn about data loss before reducing `max-retention-days`. Data older than the new maximum is permanently deleted.
- Warn users that changing a project alias changes all endpoint URLs, which breaks existing clients.
- Setting tags replaces all existing tags. Retrieve current tags with `get` first and include any the user wants to
  keep.

## Script reference

| Command             | Description                                                    |
| ------------------- | -------------------------------------------------------------- |
| `list`              | List projects by type                                          |
| `get`               | Get project details by ID                                      |
| `update`            | Update project name, alias, tags, or search_lake settings      |
| `reset-credentials` | Reset project credentials (new password)                       |
| `delete`            | Delete a project                                               |
| `resume`            | Resume a suspended project                                     |
| `load-credentials`  | Load a project's saved credentials from `.elastic-credentials` |

| Flag                       | Commands                                                         | Description                                                  |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `--type`                   | list, get, update, reset-credentials, delete, resume             | Project type: `elasticsearch`, `observability`, `security`   |
| `--id`                     | get, update, reset-credentials, delete, resume, load-credentials | Project ID                                                   |
| `--name`                   | update, load-credentials                                         | Project name (update: new name; load-credentials: lookup)    |
| `--alias`                  | update                                                           | New project alias                                            |
| `--tag`                    | update                                                           | Tag as KEY:VALUE (repeatable, replaces all tags)             |
| `--search-power`           | update                                                           | Search power 28–3000 (elasticsearch only)                    |
| `--boost-window`           | update                                                           | Boost window 1–180 days (elasticsearch only)                 |
| `--max-retention-days`     | update                                                           | Max data retention in days (security only)                   |
| `--default-retention-days` | update                                                           | Default data retention in days (security only)               |
| `--include-admin`          | load-credentials                                                 | Include admin username/password (API key bootstrapping only) |
| `--wait-seconds`           | reset-credentials                                                | Seconds to wait for credential propagation (0 to skip)       |

## Environment variables

| Variable                | Required | Description                                                             |
| ----------------------- | -------- | ----------------------------------------------------------------------- |
| `EC_API_KEY`            | Yes      | Elastic Cloud API key (project management operations)                   |
| `EC_BASE_URL`           | No       | Cloud API base URL (default: `https://api.elastic-cloud.com`)           |
| `ELASTICSEARCH_URL`     | Output   | Elasticsearch URL (set after resolving a project for downstream skills) |
| `KIBANA_URL`            | Output   | Kibana URL (set after resolving a project for downstream skills)        |
| `APM_URL`               | Output   | APM endpoint (observability projects only)                              |
| `INGEST_URL`            | Output   | OTLP ingest endpoint (observability and security projects)              |
| `ELASTICSEARCH_API_KEY` | Output   | Elasticsearch API key (for stack-level operations)                      |

## Additional resources

- For full API details, request/response schemas, and project-type options, see the
  [Serverless Projects API](https://www.elastic.co/docs/api/doc/elastic-cloud-serverless)
- For official documentation on Search AI Lake settings, data retention, and project features, see
  [Project settings](https://www.elastic.co/docs/deploy-manage/deploy/elastic-cloud/project-settings)
