---
name: cloud-setup
description: >
  Configures Elastic Cloud authentication and environment defaults. Use when setting
  up EC_API_KEY, configuring Cloud API access, or when another cloud skill requires
  credentials.
metadata:
  author: elastic
  version: 0.1.0
---

# Cloud Environment Setup

Configure Elastic Cloud authentication and preferences. All other `cloud/*` skills depend on this setup.

## Workflow

```text
Setup Progress:
- [ ] Step 1: Verify API key
- [ ] Step 2: Set defaults
- [ ] Step 3: Validate connection
```

### Step 1: Verify API key

Check whether `EC_API_KEY` is already set:

```bash
echo "${EC_API_KEY:?Not set}"
```

If not set, instruct the user to set it. **Never ask the user to paste an API key into the chat** — secrets must not
appear in conversation history.

Direct the user to:

1. Generate a key at [Elastic Cloud API keys](https://cloud.elastic.co/account/keys). The key must have **Project
   Admin** privileges or higher (Org Owner) to create and manage serverless projects.
2. Create a `.env` file in the project root (recommended — works in sandboxed agent shells):

```bash
EC_API_KEY=your-api-key
```

All `cloud/*` scripts auto-load `.env` from the working directory — no manual sourcing needed.

1. Alternatively, export directly in the terminal:

```bash
export EC_API_KEY="your-api-key"
```

Terminal exports might not be visible to sandboxed agents running in a separate shell session. Prefer the `.env` file
when working with an agent.

Remind the user that storing secrets in local files is acceptable for development, but for production or shared
environments, use a centralized secrets manager (for example, HashiCorp Vault, AWS Secrets Manager, 1Password CLI) to
avoid secrets sprawl.

### Step 2: Set defaults

Export the base URL and default region:

```bash
export EC_BASE_URL="https://api.elastic-cloud.com"
export EC_REGION="gcp-us-central1"
```

Ask the user if they want a different region. To list available regions:

```bash
curl -s -H "Authorization: ApiKey ${EC_API_KEY}" \
  "${EC_BASE_URL}/api/v1/serverless/regions" | python3 -m json.tool
```

### Step 3: Validate connection

Confirm the API key works by calling the regions endpoint:

```bash
curl -sf -H "Authorization: ApiKey ${EC_API_KEY}" \
  "${EC_BASE_URL}/api/v1/serverless/regions" > /dev/null && echo "Authenticated." || echo "Authentication failed."
```

If validation fails, check:

- The API key is valid and not expired
- Network connectivity to `api.elastic-cloud.com`

## Examples

### First-time setup

```text
User: set up my cloud environment
Agent: Check if EC_API_KEY is set in your terminal. If not, generate a key at
       https://cloud.elastic.co/account/keys and run:
       export EC_API_KEY="your-key"
       Then confirm and I'll validate the connection.
```

### Setup with custom region

```text
User: set up cloud with eu region
Agent: [runs setup, sets EC_REGION to user's preferred EU region]
```

## Guidelines

- Never receive, echo, or log API keys, passwords, or any credentials in the chat. Instruct the user to manage secrets
  in their terminal or using files directly.
- Always validate the connection after setting the key.
- Default region is `gcp-us-central1` — only change if the user requests a different region.
- This skill is a prerequisite. Other cloud skills should refer here when `EC_API_KEY` is missing.

## Environment variables

| Variable      | Required | Description                                                   |
| ------------- | -------- | ------------------------------------------------------------- |
| `EC_API_KEY`  | Yes      | Elastic Cloud API key                                         |
| `EC_BASE_URL` | No       | Cloud API base URL (default: `https://api.elastic-cloud.com`) |
| `EC_REGION`   | No       | Default region (default: `gcp-us-central1`)                   |

## Troubleshooting

| Problem              | Fix                                                |
| -------------------- | -------------------------------------------------- |
| `401 Unauthorized`   | API key is invalid or expired — generate a new one |
| `connection refused` | Check network access to `api.elastic-cloud.com`    |
