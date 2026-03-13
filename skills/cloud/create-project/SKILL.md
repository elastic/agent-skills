---
name: cloud-create-project
description: >
  Creates Elastic Cloud Serverless projects (Elasticsearch, Observability, or Security)
  via the REST API, saves credentials to file, and bootstraps a scoped Elasticsearch
  API key. Use when creating a new serverless project, provisioning a search or observability
  environment, or spinning up a new Elastic Cloud project.
compatibility: >
  Requires Python 3.8+, network access to the Elastic Cloud API (api.elastic-cloud.com).
  Environment variables: EC_API_KEY (required, set by cloud-setup).
metadata:
  author: elastic
  version: 0.1.0
---

# Create Serverless Project

Create Elastic Cloud Serverless projects using the Serverless REST API. Use the `cloud-manage-project` skill for day-2
operations like listing, updating, or deleting projects.

## Prerequisites and permissions

- Ensure `EC_API_KEY` is configured. If not, run `cloud-setup` skill first.
- Creating projects requires a Cloud API key with **Admin** or **Organization owner** role.
- This skill does not perform a separate role pre-check. Attempt the requested operation and let the API enforce
  authorization. If the API returns an authorization error (for example, `403 Forbidden`), stop and ask the user to
  verify the provided API key permissions.

### Manual setup fallback (when `cloud-setup` is unavailable)

If this skill is installed standalone and `cloud-setup` is not available, instruct the user to configure Cloud
environment variables manually before running commands. Never ask the user to paste API keys in chat.

| Variable      | Required | Description                                                    |
| ------------- | -------- | -------------------------------------------------------------- |
| `EC_API_KEY`  | Yes      | Elastic Cloud API key used for project creation operations.    |
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
  **never** appear in chat history, thinking traces, or agent output.
- **Confirm before creating.** Always present the project configuration to the user and ask for confirmation before
  running the creation script.
- **Admin credentials are for API key creation only.** The script saves the `admin` password to `.elastic-credentials`
  for bootstrapping a scoped API key. The `admin` user has full privileges and cannot be modified in serverless. Never
  use admin credentials for direct Elasticsearch operations (querying, indexing, etc.) — always create a scoped API key
  first (see Step 8). The `load-credentials` command excludes admin credentials by default — use `--include-admin`
  **only** during Step 7/8, then reload without it once the API key is created. Never read or display the contents of
  `.elastic-credentials` in chat.
- **Recover lost credentials.** If the script fails to write `.elastic-credentials` (disk full, permissions, etc.), the
  save may be incomplete. Check `.elastic-credentials` for the password first. If missing, use the
  `cloud-manage-project` skill's `reset-credentials` command to generate a new password.
- **Region is permanent.** A project's region cannot be changed after creation.
- **Prefer automatic readiness checks.** Pass `--wait` to the creation script so it polls until the phase changes from
  `initializing` to `initialized`. Only fall back to manually polling the status endpoint if `--wait` is unavailable.

## Project types

| Type            | Description                               | Key endpoints                    |
| --------------- | ----------------------------------------- | -------------------------------- |
| `elasticsearch` | Search, analytics, and vector workloads   | Elasticsearch, Kibana            |
| `observability` | Logs, metrics, traces, and APM            | Elasticsearch, Kibana, APM, OTLP |
| `security`      | SIEM, endpoint protection, cloud security | Elasticsearch, Kibana, OTLP      |

### Project type inference

Map the user's request to the correct `--type` value:

| User says                                                   | `--type`        |
| ----------------------------------------------------------- | --------------- |
| "search project", "elasticsearch project", vector search    | `elasticsearch` |
| "observability project", "o11y", logs, metrics, traces, APM | `observability` |
| "security project", "SIEM", detections, endpoint protection | `security`      |

Do **not** silently default to any type. If the user does not specify a type, infer it from the conversation context
(for example, discussing log ingestion suggests `observability`, discussing detections or SIEM suggests `security`,
discussing search or vector workloads suggests `elasticsearch`). Always present the inferred type to the user and ask
for confirmation before proceeding. If context is insufficient to infer a type, ask the user to choose.

### Product tiers

Observability and security projects support a `--product-tier` flag. Default to `complete` unless the user explicitly
requests a different tier.

| Project type    | Tier              | Description                                           |
| --------------- | ----------------- | ----------------------------------------------------- |
| `observability` | `complete`        | Full observability suite (logs, metrics, traces, APM) |
| `observability` | `logs_essentials` | Log management only                                   |
| `security`      | `complete`        | Full security suite (SIEM, cloud, endpoint)           |
| `security`      | `essentials`      | Core SIEM only                                        |

Elasticsearch projects do not have a product tier — use `--optimized-for` instead.

## Sensible defaults

Present these defaults to the user before creation. Ask if they want to use or change them:

| Setting | Default           |
| ------- | ----------------- |
| Region  | `gcp-us-central1` |

Project type must be confirmed with the user — do not assume a default. See "Project type inference" above.

Always use `--optimized-for general_purpose` unless the user explicitly requests `vector`. Do not proactively offer the
`vector` option.

If the user does not specify a name, ask for one — it is required.

## Workflow: Create a project

```text
Project Creation:
- [ ] Step 1: Verify API key is set
- [ ] Step 2: Present defaults and confirm with user
- [ ] Step 3: List available regions (optional)
- [ ] Step 4: Create the project
- [ ] Step 5: Save credentials and endpoints
- [ ] Step 6: Wait for project to initialize
- [ ] Step 7: Set environment variables
- [ ] Step 8: Recommend creating a scoped API key
```

### Step 1: Verify API key is set

```bash
echo "${EC_API_KEY:?Not set}"
```

If `EC_API_KEY` is not set, run the `cloud-setup` skill first to configure authentication and defaults.

### Step 2: Present summary and confirm with user

Before presenting the summary, ensure the project type has been explicitly confirmed by the user. If no type was
specified, infer one from the conversation context and propose it. If the context is ambiguous, ask the user to choose
from `elasticsearch`, `observability`, or `security`.

Always show a confirmation summary before creating. Include different fields depending on project type:

**Elasticsearch project:**

```text
Project Summary:
  Type:          elasticsearch
  Name:          my-project
  Region:        gcp-us-central1
```

**Observability project:**

```text
Project Summary:
  Type:          observability
  Name:          my-project
  Region:        gcp-us-central1
  Product tier:  complete
```

**Security project:**

```text
Project Summary:
  Type:          security
  Name:          my-project
  Region:        gcp-us-central1
  Product tier:  complete
```

Ask the user to confirm or override any values before proceeding.

### Step 3: List available regions (optional)

```bash
python3 skills/cloud/create-project/scripts/create-project.py list-regions
```

The output is grouped by cloud provider (AWS, Azure, GCP) and sorted alphabetically. Regions marked with `*` do not
support project creation.

### Step 4: Create the project

```bash
python3 skills/cloud/create-project/scripts/create-project.py create \
  --type elasticsearch \
  --name "my-project" \
  --region gcp-us-central1 \
  --optimized-for general_purpose \
  --wait
```

Always pass `--optimized-for general_purpose` for Elasticsearch projects. Only use `vector` if the user explicitly
requests it.

For observability and security projects, pass `--product-tier complete` unless the user explicitly requests a different
tier.

Always pass `--wait` so the script automatically polls until the project is ready.

### Step 5: Save credentials and endpoints

The script automatically writes credentials to `.elastic-credentials` in the working directory. The password is redacted
from the JSON output on stdout.

**If saving succeeds**, tell the user:

```text
Credentials saved to .elastic-credentials — open that file to retrieve your password.
```

Do **not** read, cat, or display the contents of `.elastic-credentials` in chat.

**If saving fails**, the script prints an error to stderr. Check whether `.elastic-credentials` exists and contains a
password (a partial write is possible). If the password is missing or the file does not exist, immediately run the
`cloud-manage-project` skill's `reset-credentials` command to generate a new password.

The creation response also contains:

- **Project ID** — needed for all subsequent operations
- **Cloud ID** — for client libraries
- **Elasticsearch and Kibana endpoints** — safe to display in chat

The admin credentials are for initial bootstrap only. Recommend creating a scoped API key for ongoing access (Step 8).

### Step 6: Wait for project to initialize

When `--wait` is passed (recommended), the script polls automatically until the project phase becomes `initialized`. No
manual polling is needed.

If the agent ran without `--wait`, poll manually:

```bash
python3 skills/cloud/create-project/scripts/create-project.py status \
  --type elasticsearch \
  --id <project-id>
```

Repeat until `phase` changes from `initializing` to `initialized`.

### Step 7: Set environment variables

The creation script saves credentials and endpoints to `.elastic-credentials` with the project name in the header. Load
them into the current shell **with `--include-admin`** so admin credentials are available for API key creation in Step
8:

```bash
eval $(python3 skills/cloud/manage-project/scripts/manage-project.py load-credentials \
  --name "<project-name>" --include-admin)
```

This sets `ELASTICSEARCH_URL`, `KIBANA_URL`, any project-type specific endpoints (`APM_URL`, `INGEST_URL`), and the
admin `ELASTICSEARCH_USERNAME`/`ELASTICSEARCH_PASSWORD` needed to bootstrap an API key.

### Step 8: Create a scoped API key

The `admin` user has full privileges and cannot be modified in serverless projects. **Do not proceed with Elasticsearch
operations using admin credentials.** Create a scoped Elasticsearch API key with only the permissions the user needs.

If the `elasticsearch-authn` skill is available, use it for API key creation — it covers the full lifecycle (create,
grant, invalidate, query) and handles scoping privileges correctly. If the skill is not installed, ask the user to
either install it or create the API key manually through **Kibana > Stack Management > API keys**. After creation, save
the API key to `.elastic-credentials` using the project-specific header format (see `manage-project` skill's "Credential
file format" section), then reload **without `--include-admin`** to drop admin credentials from the environment:

```bash
eval $(python3 skills/cloud/manage-project/scripts/manage-project.py load-credentials \
  --name "<project-name>")
```

## Examples

### Create an Elasticsearch project with defaults

```bash
python3 skills/cloud/create-project/scripts/create-project.py create \
  --type elasticsearch \
  --name "my-search-project" \
  --region gcp-us-central1 \
  --optimized-for general_purpose \
  --wait
```

### Create an observability project

```bash
python3 skills/cloud/create-project/scripts/create-project.py create \
  --type observability \
  --name "prod-o11y" \
  --region aws-eu-west-1 \
  --product-tier complete \
  --wait
```

### Create a security project

```bash
python3 skills/cloud/create-project/scripts/create-project.py create \
  --type security \
  --name "siem-prod" \
  --region gcp-us-central1 \
  --product-tier complete \
  --wait
```

## Guidelines

- Run the `cloud-setup` skill first if `EC_API_KEY` is not set.
- Always confirm the project configuration with the user before creating.
- Never display passwords or API keys in chat. Direct the user to `.elastic-credentials`.
- Never silently default to a project type. Infer from context and confirm with the user.
- Default to `general_purpose` optimization. Only use `vector` if the user explicitly requests it.
- Default to `complete` product tier for observability and security projects. Only use `logs_essentials` or `essentials`
  if the user explicitly requests it.
- Always pass `--wait` so the script polls until the project is ready.
- If credential saving fails, immediately reset credentials using the `cloud-manage-project` skill.
- After creation, recommend creating a scoped API key instead of relying on admin credentials.
- Region cannot be changed after creation — confirm the choice before proceeding.

## Script reference

| Command        | Description                       |
| -------------- | --------------------------------- |
| `create`       | Create a new serverless project   |
| `status`       | Get project initialization status |
| `list-regions` | List available regions            |

| Flag              | Commands       | Description                                                |
| ----------------- | -------------- | ---------------------------------------------------------- |
| `--type`          | create, status | Project type: `elasticsearch`, `observability`, `security` |
| `--name`          | create         | Project name (required)                                    |
| `--region`        | create         | Region ID (default: `gcp-us-central1`)                     |
| `--id`            | status         | Project ID                                                 |
| `--optimized-for` | create         | Elasticsearch subtype: `general_purpose` or `vector`       |
| `--product-tier`  | create         | Observability/security tier (see "Product tiers" section)  |
| `--wait`          | create         | Poll until project is initialized before exiting           |

## Environment variables

| Variable                | Required | Description                                                              |
| ----------------------- | -------- | ------------------------------------------------------------------------ |
| `EC_API_KEY`            | Yes      | Elastic Cloud API key                                                    |
| `EC_BASE_URL`           | No       | Cloud API base URL (default: `https://api.elastic-cloud.com`)            |
| `ELASTICSEARCH_URL`     | Output   | Elasticsearch URL (loaded via `load-credentials` after creation)         |
| `KIBANA_URL`            | Output   | Kibana URL (loaded via `load-credentials` after creation)                |
| `APM_URL`               | Output   | APM endpoint (observability projects only)                               |
| `INGEST_URL`            | Output   | OTLP ingest endpoint (observability and security projects)               |
| `ELASTICSEARCH_API_KEY` | Output   | Elasticsearch API key (created in Step 8, loaded via `load-credentials`) |

## Additional resources

- For full API details, request/response schemas, and project-type options, see
  [references/api-reference.md](references/api-reference.md)
