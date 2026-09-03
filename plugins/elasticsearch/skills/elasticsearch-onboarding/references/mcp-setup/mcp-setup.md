---
name: mcp-setup
description:
  MCP server setup, cluster access patterns, and the read/write separation model for the onboarding playbook. Covers the
  Elasticsearch MCP server (read cluster state), the Elastic Docs MCP server (look up API docs before writing), and the
  write confirmation protocol.
---

# MCP and Cluster Access

The onboarding skill separates cluster interaction into **reads** and **writes**. Reads happen automatically to keep the
agent informed. Writes require explicit developer approval so the experience stays educational.

## Reading: Elasticsearch MCP Server

The Elasticsearch MCP server gives the agent read access to the developer's cluster through the Agent Builder API in
Kibana. Use it to proactively inspect cluster state throughout onboarding instead of asking the developer to describe
things you can check yourself:

- Detect the Elasticsearch version (`GET /`)
- List existing indices and their mappings
- Inspect data in existing indices
- Validate that resources were created correctly after the developer runs a write
- Check index health, document counts, and field types

**If MCP tools are already available**, you're connected. Use them throughout. Discover capabilities dynamically; the
tool set may vary by cluster version and configuration.

**When to offer MCP setup:** At the start of the conversation, or in Step 2 if the developer already has data in
Elasticsearch. A live connection lets you understand their cluster without asking them to describe it.

### Setup

#### Option A: Docker (preferred)

1. Confirm Docker is running (`docker --version`)
2. Write the MCP config for their tool:

| Tool              | Config file                                           |
| ----------------- | ----------------------------------------------------- |
| Cursor            | `.cursor/mcp.json` in the project root                |
| VS Code (Copilot) | `.vscode/mcp.json` in the project root                |
| Windsurf          | `~/.codeium/windsurf/mcp_config.json`                 |
| Claude Desktop    | OS-specific Application Support / AppData Claude path |
| Claude Code       | `.mcp.json` in the project root                       |

```json
{
  "mcpServers": {
    "elasticsearch": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "ES_URL", "-e", "ES_API_KEY", "docker.elastic.co/mcp/elasticsearch", "stdio"],
      "env": {
        "ES_URL": "https://YOUR_ELASTICSEARCH_URL",
        "ES_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

Replace `YOUR_ELASTICSEARCH_URL` with their endpoint (Kibana → help icon → Connection details) and `YOUR_API_KEY` with
their API key.

3. Tell them to reload MCP connections via their editor's command palette or MCP settings panel.

#### Option B: npx (if Docker is not available)

```json
{
  "mcpServers": {
    "elasticsearch": {
      "command": "npx",
      "args": ["-y", "@elastic/mcp-server-elasticsearch"],
      "env": {
        "ES_URL": "https://YOUR_ELASTICSEARCH_URL",
        "ES_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

Requires Node.js. Same reload step as above.

**If neither works**, reassure the developer and fall back to generating read commands (curl or scripts) they can run
manually. Everything still works without MCP.

**Add the MCP config file to `.gitignore`** — it contains API credentials.

## Writing: Confirmation Protocol

When the agent needs to make a change to the cluster (create an index, ingest documents, configure an ingest pipeline,
create a synonym set, etc.), **never execute silently**. Follow this protocol:

1. **Use the Elastic Docs MCP** to look up the correct API call (syntax, required fields, version-specific behavior).
2. **Show the developer what you plan to do:**
   > I'll create the index with this API call:
   >
   > ```http
   > PUT /products-v1
   > { "mappings": { ... }, "aliases": { "products": {} } }
   > ```
   >
   > Want me to execute this, or would you prefer a code snippet in [their language] you can run yourself?
3. **Wait for confirmation.** If they say yes, execute. If they want the code snippet, generate it using the standards
   in [code-generation.md](../code-generation/code-generation.md). Remember their choice on whether they want a code
   snippet or not. If not, then future permission requests should not offer code snippets unless the user explicitly
   asks for it.

This ensures the developer understands what is being created and learns the underlying APIs.

**When to use reads vs. writes:**

| Action                    | Read or Write | How                                              |
| ------------------------- | ------------- | ------------------------------------------------ |
| Check version             | Read          | MCP (automatic) or curl                          |
| List indices              | Read          | MCP (automatic) or curl                          |
| Inspect mappings          | Read          | MCP (automatic) or curl                          |
| Run a test search query   | Read          | MCP (automatic) or curl                          |
| Check document count      | Read          | MCP (automatic) or curl                          |
| Create an index           | Write         | Confirm with developer, then execute or generate |
| Ingest documents          | Write         | Confirm with developer, then execute or generate |
| Create/update synonym set | Write         | Confirm with developer, then execute or generate |
| Configure ingest pipeline | Write         | Confirm with developer, then execute or generate |
| Create API key            | Write         | Confirm with developer, then execute or generate |

## Elastic Docs MCP Server

The Elastic Docs MCP server gives the agent access to Elastic documentation from the IDE. Use it to look up API syntax,
field types, model IDs, and client library methods before generating write commands or code. This ensures the agent
produces correct, version-appropriate API calls.

Endpoint: `https://www.elastic.co/docs/_mcp/`

Configuration (Cursor / Claude Code):

```json
{
  "mcpServers": {
    "elastic-docs": {
      "url": "https://www.elastic.co/docs/_mcp/"
    }
  }
}
```

VS Code:

```json
{
  "servers": {
    "elastic-docs": {
      "type": "http",
      "url": "https://www.elastic.co/docs/_mcp/"
    }
  }
}
```

Key tools: `search_docs` and `get_document_by_url` for verifying API syntax before writes.

## Agent Builder

The Elasticsearch MCP server connects through the Agent Builder API. If the developer wants to go further and create or
manage Agent Builder agents and custom tools, point them to the **kibana-agent-builder** skill
(`skills/kibana/agent-builder/SKILL.md`).
