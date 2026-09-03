#!/usr/bin/env node
/**
 * Agent Builder CLI wrapping the Kibana Agent Builder REST API.
 * Manages agents and custom tools: list, get, create, update, delete, test, and chat.
 */

import { kibanaGet, kibanaPost, kibanaPut, kibanaDelete, getKibanaConfig } from "./kibana-client.js";

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-/g, "_");
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

const API_BASE = "/api/agent_builder";

async function listTools() {
  const data = await kibanaGet(`${API_BASE}/tools`);
  const tools = data.results || data;

  console.log(`Available tools (${tools.length}):`);
  console.log("");

  for (const tool of tools) {
    const tags = (tool.tags || []).length > 0 ? `  [${tool.tags.join(", ")}]` : "";
    const desc = tool.description ? ` — ${tool.description}` : "";
    console.log(`  ${tool.id}${tags}${desc}`);
  }
}

async function listAgents() {
  const data = await kibanaGet(`${API_BASE}/agents`);
  const agents = data.results || data;

  console.log(`Existing agents (${agents.length}):`);
  console.log("");

  if (agents.length === 0) {
    console.log("  (none)");
    return;
  }

  for (const agent of agents) {
    const toolCount = agent.configuration?.tools?.[0]?.tool_ids?.length || 0;
    const readonly = agent.readonly ? "readonly" : "editable";
    console.log(`  ${agent.id}\t${agent.name}\t${toolCount} tools\t${readonly}`);
  }
}

async function getAgent(args) {
  const id = args.id;
  if (!id) {
    console.error("Error: --id is required.");
    process.exit(1);
  }

  const data = await kibanaGet(`${API_BASE}/agents/${encodeURIComponent(id)}`);
  console.log(JSON.stringify(data, null, 2));
}

async function createAgent(args) {
  const name = args.name;
  if (!name) {
    console.error("Error: --name is required.");
    process.exit(1);
  }

  const toolIds = args.tool_ids;
  if (!toolIds) {
    console.error("Error: --tool-ids is required.");
    process.exit(1);
  }

  const description = args.description || name;
  const instructions = args.instructions || "";

  // Generate an ID from the name: lowercase, replace spaces/underscores with hyphens, strip non-alphanumeric
  const agentId = name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  const toolIdList = toolIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (toolIdList.length === 0) {
    console.error("Error: --tool-ids must contain at least one non-empty tool ID.");
    process.exit(1);
  }

  const payload = {
    id: agentId,
    name,
    description,
    configuration: {
      instructions,
      tools: [{ tool_ids: toolIdList }],
    },
  };

  const result = await kibanaPost(`${API_BASE}/agents`, payload);
  console.log("Agent created successfully!");
  console.log(JSON.stringify(result, null, 2));
}

async function updateAgent(args) {
  const id = args.id;
  if (!id) {
    console.error("Error: --id is required.");
    process.exit(1);
  }

  // Fetch current agent to merge with updates
  const current = await kibanaGet(`${API_BASE}/agents/${encodeURIComponent(id)}`);

  // Build payload — only description, configuration, and tags are accepted by PUT
  const payload = {};

  if (args.description) {
    payload.description = args.description;
  }

  const config = { ...current.configuration };
  if (args.instructions) {
    config.instructions = args.instructions;
  }
  if (args.tool_ids) {
    const toolIdList = args.tool_ids
      .split(",")
      .map((tid) => tid.trim())
      .filter(Boolean);
    config.tools = [{ tool_ids: toolIdList }];
  }
  payload.configuration = config;

  const result = await kibanaPut(`${API_BASE}/agents/${encodeURIComponent(id)}`, payload);
  console.log("Agent updated successfully!");
  console.log(JSON.stringify(result, null, 2));
}

async function deleteAgent(args) {
  const id = args.id;
  if (!id) {
    console.error("Error: --id is required.");
    process.exit(1);
  }

  await kibanaDelete(`${API_BASE}/agents/${encodeURIComponent(id)}`);
  console.log(`Agent "${id}" deleted successfully.`);
}

async function chat(args) {
  const id = args.id;
  if (!id) {
    console.error("Error: --id is required.");
    process.exit(1);
  }

  const message = args.message;
  if (!message) {
    console.error("Error: --message is required.");
    process.exit(1);
  }

  const payload = { agent_id: id, input: message };
  if (args.conversation_id) {
    payload.conversation_id = args.conversation_id;
  }

  const config = getKibanaConfig();
  let baseUrl = config.url.replace(/\/$/, "");
  if (config.spaceId && config.spaceId !== "default") {
    baseUrl += `/s/${config.spaceId}`;
  }

  const headers = { "Content-Type": "application/json", "kbn-xsrf": "true", "User-Agent": "elastic-agentic" };
  if (config.apiKey) {
    headers["Authorization"] = `ApiKey ${config.apiKey}`;
  } else if (config.username && config.password) {
    const auth = Buffer.from(`${config.username}:${config.password}`).toString("base64");
    headers["Authorization"] = `Basic ${auth}`;
  }

  if (config.insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  const response = await fetch(`${baseUrl}${API_BASE}/converse/async`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  let eventType = "";
  let buffer = "";

  for await (const chunk of response.body) {
    buffer += new TextDecoder().decode(chunk);
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const raw of lines) {
      const line = raw.replace(/\r$/, "");

      if (line.startsWith(":") || line === "") continue;

      if (line.startsWith("event: ")) {
        eventType = line.slice(7);
        continue;
      }

      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6)).data;

        switch (eventType) {
          case "conversation_id_set":
            console.log(`[Conversation] ${data.conversation_id}`);
            console.log("");
            break;
          case "reasoning":
            if (data.reasoning) {
              console.log(`[Reasoning] ${data.reasoning}`);
            }
            break;
          case "tool_call":
            console.log(`[Tool Call] ${data.tool_id} ${JSON.stringify(data.params || {})}`);
            break;
          case "tool_result": {
            let summary = JSON.stringify(data.results || []);
            if (summary.length > 500) {
              summary = summary.slice(0, 500) + "... (truncated)";
            }
            console.log(`[Tool Result] ${data.tool_id} -> ${summary}`);
            break;
          }
          case "tool_progress":
            if (data.message) {
              console.log(`[Tool Progress] ${data.message}`);
            }
            break;
          case "thinking_complete":
            console.log("");
            break;
          case "message_complete":
            console.log("[Response]");
            console.log(data.message_content);
            break;
          case "round_complete":
            console.log("");
            console.log(`[Round Complete] Status: ${data.round?.status || "unknown"}`);
            break;
        }

        eventType = "";
      }
    }
  }
}

async function listCustomTools() {
  const data = await kibanaGet(`${API_BASE}/tools`);
  const tools = data.results || data;

  const platformTools = [];
  const customTools = [];

  for (const tool of tools) {
    if (tool.id.startsWith("platform.core.")) {
      platformTools.push(tool);
    } else {
      customTools.push(tool);
    }
  }

  console.log(`Platform tools (${platformTools.length}):`);
  console.log("");
  for (const tool of platformTools) {
    const desc = tool.description ? ` — ${tool.description}` : "";
    console.log(`  ${tool.id}${desc}`);
  }

  console.log("");
  console.log(`Custom tools (${customTools.length}):`);
  console.log("");
  for (const tool of customTools) {
    const type = tool.type ? `[${tool.type}]` : "";
    const desc = tool.description ? ` — ${tool.description}` : "";
    console.log(`  ${tool.id}  ${type}${desc}`);
  }
}

async function getTool(args) {
  const id = args.id;
  if (!id) {
    console.error("Error: --id is required.");
    process.exit(1);
  }

  const data = await kibanaGet(`${API_BASE}/tools/${encodeURIComponent(id)}`);
  console.log(JSON.stringify(data, null, 2));
}

async function createTool(args) {
  const id = args.id;
  const type = args.type;
  const description = args.description;

  if (!id) {
    console.error("Error: --id is required.");
    process.exit(1);
  }
  if (!type) {
    console.error("Error: --type is required (esql, index_search, or workflow).");
    process.exit(1);
  }
  if (!description) {
    console.error("Error: --description is required.");
    process.exit(1);
  }

  const payload = { id, type, description, configuration: {} };

  if (type === "esql") {
    if (!args.query) {
      console.error("Error: --query is required for esql tools.");
      process.exit(1);
    }
    payload.configuration.query = args.query;
    payload.configuration.params = args.params ? JSON.parse(args.params) : {};
  } else if (type === "index_search") {
    if (!args.pattern) {
      console.error("Error: --pattern is required for index_search tools.");
      process.exit(1);
    }
    payload.configuration.pattern = args.pattern;
  } else if (type === "workflow") {
    if (!args.workflow_id) {
      console.error("Error: --workflow-id is required for workflow tools.");
      process.exit(1);
    }
    payload.configuration.workflow_id = args.workflow_id;
  } else {
    console.error(`Error: Unsupported --type "${type}". Allowed values: esql, index_search, workflow.`);
    process.exit(1);
  }

  if (args.tags) {
    payload.tags = args.tags.split(",").map((t) => t.trim());
  }

  const result = await kibanaPost(`${API_BASE}/tools`, payload);
  console.log("Tool created successfully!");
  console.log(JSON.stringify(result, null, 2));
}

async function updateTool(args) {
  const id = args.id;
  if (!id) {
    console.error("Error: --id is required.");
    process.exit(1);
  }

  // Fetch current tool to merge configuration
  const current = await kibanaGet(`${API_BASE}/tools/${encodeURIComponent(id)}`);

  // Only description, configuration, and tags are accepted by PUT
  const payload = {};

  if (args.description) {
    payload.description = args.description;
  }

  const config = { ...current.configuration };
  if (args.query) {
    config.query = args.query;
  }
  if (args.params) {
    config.params = JSON.parse(args.params);
  }
  if (args.pattern) {
    config.pattern = args.pattern;
  }
  if (args.workflow_id) {
    config.workflow_id = args.workflow_id;
  }
  payload.configuration = config;

  if (args.tags) {
    payload.tags = args.tags.split(",").map((t) => t.trim());
  }

  const result = await kibanaPut(`${API_BASE}/tools/${encodeURIComponent(id)}`, payload);
  console.log("Tool updated successfully!");
  console.log(JSON.stringify(result, null, 2));
}

async function deleteTool(args) {
  const id = args.id;
  if (!id) {
    console.error("Error: --id is required.");
    process.exit(1);
  }

  await kibanaDelete(`${API_BASE}/tools/${encodeURIComponent(id)}`);
  console.log(`Tool "${id}" deleted successfully.`);
}

async function testTool(args) {
  const id = args.id;
  if (!id) {
    console.error("Error: --id is required.");
    process.exit(1);
  }

  const payload = {
    tool_id: id,
    tool_params: args.params ? JSON.parse(args.params) : {},
  };

  const result = await kibanaPost(`${API_BASE}/tools/_execute`, payload);

  for (const r of result.results || []) {
    if (r.type === "esql_results" && r.data) {
      const cols = (r.data.columns || []).map((c) => c.name);
      const rows = r.data.values || [];
      console.log(`Columns: ${cols.join(", ")}`);
      console.log(`Rows returned: ${rows.length}`);
      if (rows.length > 0) {
        console.log("");
        console.log("Sample (first 3 rows):");
        for (const row of rows.slice(0, 3)) {
          const obj = {};
          cols.forEach((col, i) => {
            obj[col] = row[i];
          });
          console.log(`  ${JSON.stringify(obj)}`);
        }
      }
    } else {
      console.log(JSON.stringify(r, null, 2));
    }
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (command) {
    case "list-tools":
      await listTools();
      break;
    case "list-agents":
      await listAgents();
      break;
    case "get-agent":
      await getAgent(args);
      break;
    case "create-agent":
      await createAgent(args);
      break;
    case "update-agent":
      await updateAgent(args);
      break;
    case "delete-agent":
      await deleteAgent(args);
      break;
    case "chat":
      await chat(args);
      break;
    case "list-custom-tools":
      await listCustomTools();
      break;
    case "get-tool":
      await getTool(args);
      break;
    case "create-tool":
      await createTool(args);
      break;
    case "update-tool":
      await updateTool(args);
      break;
    case "delete-tool":
      await deleteTool(args);
      break;
    case "test-tool":
      await testTool(args);
      break;
    default:
      console.error("Usage: agent-builder.js <command> [options]");
      console.error("");
      console.error("Agent commands:");
      console.error("  list-tools                                   List available tools");
      console.error("  list-agents                                  List existing agents");
      console.error("  get-agent --id <id>                          Get agent details");
      console.error("  create-agent --name <n> --tool-ids <ids>     Create an agent");
      console.error("  update-agent --id <id> [--description ...]   Update an agent");
      console.error("  delete-agent --id <id>                       Delete an agent");
      console.error("  chat --id <id> --message <msg>               Chat with an agent");
      console.error("");
      console.error("Tool commands:");
      console.error("  list-custom-tools                            List tools by platform/custom");
      console.error("  get-tool --id <id>                           Get tool details");
      console.error("  create-tool --id <id> --type <t>             Create a tool");
      console.error("  update-tool --id <id> [...]                  Update a tool");
      console.error("  delete-tool --id <id>                        Delete a tool");
      console.error("  test-tool --id <id>                          Execute a tool for testing");
      console.error("");
      console.error("Agent create options:");
      console.error("  --name          Agent display name (required)");
      console.error("  --tool-ids      Comma-separated tool IDs (required)");
      console.error("  --description   Agent description (defaults to name)");
      console.error("  --instructions  System instructions for the agent");
      console.error("");
      console.error("Agent update options:");
      console.error("  --id            Agent ID (required)");
      console.error("  --description   New description");
      console.error("  --instructions  New system instructions");
      console.error("  --tool-ids      New comma-separated tool IDs");
      console.error("");
      console.error("Chat options:");
      console.error("  --id               Agent ID (required)");
      console.error("  --message          Message to send (required)");
      console.error("  --conversation-id  Continue an existing conversation");
      console.error("");
      console.error("Tool create options:");
      console.error("  --id            Tool ID (required)");
      console.error("  --type          Tool type: esql, index_search, workflow (required)");
      console.error("  --description   Tool description (required)");
      console.error("  --query         ES|QL query (esql type)");
      console.error("  --params        JSON params object (esql type)");
      console.error("  --pattern       Index pattern (index_search type)");
      console.error("  --workflow-id   Workflow ID (workflow type)");
      console.error("  --tags          Comma-separated tags");
      console.error("");
      console.error("Tool test options:");
      console.error("  --id            Tool ID (required)");
      console.error("  --params        JSON params for execution");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
