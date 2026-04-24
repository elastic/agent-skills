#!/usr/bin/env node

/**
 * CRUD operations for Kibana dashboards and Vega visualizations.
 *
 * Usage:
 *   ./kibana-vega.js dashboards list                      - List all dashboards
 *   ./kibana-vega.js dashboards get <id>                  - Get dashboard by ID
 *   ./kibana-vega.js dashboards create <title> [file]     - Create dashboard
 *   ./kibana-vega.js dashboards update <id> <file>        - Update dashboard
 *   ./kibana-vega.js dashboards delete <id>               - Delete dashboard
 *
 *   ./kibana-vega.js visualizations list [type]           - List visualizations
 *   ./kibana-vega.js visualizations get <id>              - Get visualization
 *   ./kibana-vega.js visualizations create <title> <file|-> - Create Vega visualization (use - for stdin)
 *   ./kibana-vega.js visualizations update <id> <file|->  - Update Vega visualization (use - for stdin)
 *   ./kibana-vega.js visualizations delete <id>           - Delete visualization
 *
 *   ./kibana-vega.js test                                 - Test Kibana connection
 */

import { readFileSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import hjson from "hjson";

// =============================================================================
// Stdin Reading
// =============================================================================

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";

    // Set encoding
    process.stdin.setEncoding("utf8");

    // Check if stdin is a TTY (no piped input)
    if (process.stdin.isTTY) {
      reject(new Error("No input provided via stdin. Use a file path or pipe JSON input."));
      return;
    }

    process.stdin.on("readable", () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });

    process.stdin.on("end", () => {
      resolve(data);
    });

    process.stdin.on("error", (err) => {
      reject(err);
    });
  });
}

// =============================================================================
// Kibana Client Setup
// =============================================================================

function getKibanaConfig() {
  const cloudId = process.env.KIBANA_CLOUD_ID || process.env.ELASTICSEARCH_CLOUD_ID;
  let url = process.env.KIBANA_URL;

  if (!url && cloudId) {
    try {
      const parts = cloudId.split(":");
      if (parts.length === 2) {
        const decoded = Buffer.from(parts[1], "base64").toString("utf8");
        const decodedParts = decoded.split("$");
        if (decodedParts.length >= 3 && decodedParts[2]) {
          const domain = decodedParts[0];
          const kibanaUuid = decodedParts[2];

          let host = domain;
          let port = "";
          if (domain.includes(":")) {
            const splitDomain = domain.split(":");
            host = splitDomain[0];
            port = `:${splitDomain[1]}`;
          } else {
            port = ":443";
          }

          url = `https://${kibanaUuid}.${host}${port}`;
        }
      }
    } catch (e) {
      console.error("Error parsing Cloud ID:", e.message);
    }
  }

  const username = process.env.KIBANA_USERNAME || process.env.ELASTICSEARCH_USERNAME;
  const password = process.env.KIBANA_PASSWORD || process.env.ELASTICSEARCH_PASSWORD;
  const apiKey = process.env.KIBANA_API_KEY || process.env.ELASTICSEARCH_API_KEY;
  const spaceId = process.env.KIBANA_SPACE_ID;
  const insecure = process.env.KIBANA_INSECURE === "true";

  if (!url) {
    console.error("Error: No Kibana connection configured.");
    console.error("");
    console.error("Set one of these environment variable combinations:");
    console.error("  1. Elastic Cloud: KIBANA_CLOUD_ID + KIBANA_API_KEY");
    console.error("  2. URL + API Key: KIBANA_URL + KIBANA_API_KEY");
    console.error("  3. Basic Auth: KIBANA_URL + KIBANA_USERNAME + KIBANA_PASSWORD");
    console.error("");
    console.error("For local development, use start-local to run Elasticsearch and Kibana via Docker:");
    console.error("  https://github.com/elastic/start-local");
    console.error("");
    console.error("  curl -fsSL https://elastic.co/start-local | sh");
    console.error("");
    console.error("Then configure the environment:");
    console.error("  source elastic-start-local/.env");
    console.error('  export KIBANA_URL="$KB_LOCAL_URL"');
    console.error('  export KIBANA_USERNAME="elastic"');
    console.error('  export KIBANA_PASSWORD="$ES_LOCAL_PASSWORD"');
    process.exit(1);
  }

  return { url, username, password, apiKey, spaceId, insecure };
}

function getHeaders(config) {
  const headers = {
    "Content-Type": "application/json",
    "kbn-xsrf": "true",
    "User-Agent": "elastic-agentic",
  };

  if (config.apiKey) {
    headers["Authorization"] = `ApiKey ${config.apiKey}`;
  } else if (config.username && config.password) {
    const auth = Buffer.from(`${config.username}:${config.password}`).toString("base64");
    headers["Authorization"] = `Basic ${auth}`;
  }

  return headers;
}

function getBasePath(config) {
  let basePath = config.url.replace(/\/$/, "");
  if (config.spaceId && config.spaceId !== "default") {
    basePath += `/s/${config.spaceId}`;
  }
  return basePath;
}

async function kibanaFetch(path, options = {}) {
  const config = getKibanaConfig();
  const basePath = getBasePath(config);
  const url = `${basePath}${path}`;

  const fetchOptions = {
    ...options,
    headers: {
      ...getHeaders(config),
      ...options.headers,
    },
  };

  // Handle insecure TLS
  if (config.insecure && typeof process !== "undefined") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  try {
    const response = await fetch(url, fetchOptions);
    const contentType = response.headers.get("content-type");

    let data;
    if (contentType && contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: data.message || data.error || `HTTP ${response.status}`,
        details: data,
      };
    }

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      details: error,
    };
  }
}

// =============================================================================
// Import API (serverless-compatible upsert for saved objects)
// =============================================================================

async function importSavedObjects(objects) {
  const config = getKibanaConfig();
  const basePath = getBasePath(config);
  const url = `${basePath}/api/saved_objects/_import?overwrite=true`;

  const ndjson = objects.map((obj) => JSON.stringify(obj)).join("\n");
  const blob = new Blob([ndjson], { type: "application/x-ndjson" });

  const formData = new FormData();
  formData.append("file", blob, "import.ndjson");

  const headers = getHeaders(config);
  delete headers["Content-Type"];

  if (config.insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  try {
    const response = await fetch(url, { method: "POST", headers, body: formData });
    const data = await response.json();

    if (!response.ok || !data.success) {
      const errors = data.errors?.map((e) => e.error?.message || JSON.stringify(e.error)).join("; ");
      return {
        success: false,
        status: response.status,
        error: errors || data.message || `HTTP ${response.status}`,
        details: data,
      };
    }

    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message, details: error };
  }
}

async function upsertSavedObject(type, id, attributes, references = []) {
  const result = await importSavedObjects([{ type, id, attributes, references }]);
  if (!result.success) return result;

  const successResult = result.data.successResults?.[0];
  return {
    success: true,
    data: { id: successResult?.id || id, type, attributes, references },
  };
}

// =============================================================================
// Export API (serverless-compatible read for saved objects)
// =============================================================================

async function exportSavedObjects(typeOrObjects, includeRefs = false) {
  const body = Array.isArray(typeOrObjects)
    ? { objects: typeOrObjects, includeReferencesDeep: includeRefs }
    : { type: typeOrObjects, includeReferencesDeep: includeRefs };

  const result = await kibanaFetch("/api/saved_objects/_export", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!result.success) return result;

  const lines = (typeof result.data === "string" ? result.data : "").trim().split("\n");
  const objects = [];
  let summary = {};

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.exportedCount !== undefined) {
        summary = obj;
      } else if (obj.type) {
        objects.push(obj);
      }
    } catch {
      // skip unparseable lines
    }
  }

  return { success: true, data: { saved_objects: objects, total: summary.exportedCount || objects.length } };
}

async function exportSavedObjectById(type, id) {
  const result = await exportSavedObjects([{ type, id }]);
  if (!result.success) return result;

  const obj = result.data.saved_objects.find((o) => o.id === id);
  if (!obj) {
    return { success: false, error: `${type} ${id} not found` };
  }
  return { success: true, data: obj };
}

// =============================================================================
// Delete (serverless-compatible: try direct DELETE, then fallback to _bulk_delete)
// =============================================================================

async function deleteSavedObject(type, id) {
  const directResult = await kibanaFetch(`/api/saved_objects/${type}/${id}`, { method: "DELETE" });
  if (directResult.success) return directResult;

  const bulkResult = await kibanaFetch("/api/saved_objects/_bulk_delete?force=true", {
    method: "POST",
    body: JSON.stringify([{ type, id }]),
  });
  if (bulkResult.success) return bulkResult;

  return {
    success: false,
    error: `Delete not available on this Kibana instance (serverless). Remove the object manually via Kibana UI: Stack Management > Saved Objects.`,
  };
}

// =============================================================================
// Dashboard Operations
// =============================================================================

async function listDashboards(searchTerm = "") {
  const result = await exportSavedObjects("dashboard");
  if (!result.success) return result;

  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    result.data.saved_objects = result.data.saved_objects.filter((obj) =>
      (obj.attributes?.title || "").toLowerCase().includes(term),
    );
    result.data.total = result.data.saved_objects.length;
  }

  return result;
}

async function getDashboard(id) {
  return exportSavedObjectById("dashboard", id);
}

async function createDashboard(title, panels = [], options = {}) {
  return upsertSavedObject("dashboard", randomUUID(), {
    title,
    description: "",
    panelsJSON: JSON.stringify(panels),
    optionsJSON: JSON.stringify({
      useMargins: true,
      syncColors: true,
      syncTooltips: true,
      syncCursor: true,
      ...options,
    }),
    timeRestore: false,
    kibanaSavedObjectMeta: { searchSourceJSON: "{}" },
  });
}

async function updateDashboard(id, attributes) {
  return upsertSavedObject("dashboard", id, attributes);
}

async function deleteDashboard(id) {
  return deleteSavedObject("dashboard", id);
}

// =============================================================================
// Visualization Operations (Import/Export API — serverless-compatible)
// =============================================================================

async function listVisualizations(type = "") {
  const result = await exportSavedObjects("visualization");
  if (!result.success) return result;

  if (type) {
    result.data.saved_objects = result.data.saved_objects.filter((obj) => {
      try {
        const visState = JSON.parse(obj.attributes?.visState || "{}");
        return visState.type === type;
      } catch {
        return false;
      }
    });
    result.data.total = result.data.saved_objects.length;
  }

  return result;
}

async function getVisualization(id) {
  return exportSavedObjectById("visualization", id);
}

function buildVegaVisAttributes(title, spec) {
  const specString = typeof spec === "string" ? spec : JSON.stringify(spec, null, 2);
  const visState = { title, type: "vega", params: { spec: specString }, aggs: [] };

  return {
    title,
    visState: JSON.stringify(visState),
    uiStateJSON: "{}",
    description: "",
    kibanaSavedObjectMeta: { searchSourceJSON: "{}" },
  };
}

async function createVegaVisualization(title, spec) {
  return upsertSavedObject("visualization", randomUUID(), buildVegaVisAttributes(title, spec));
}

async function updateVegaVisualization(id, title, spec) {
  return upsertSavedObject("visualization", id, buildVegaVisAttributes(title, spec));
}

async function deleteVisualization(id) {
  return deleteSavedObject("visualization", id);
}

// =============================================================================
// Add Visualization to Dashboard
// =============================================================================

async function addVisualizationToDashboard(dashboardId, visualizationId, gridConfig = {}) {
  // First get the current dashboard
  const dashboardResult = await getDashboard(dashboardId);
  if (!dashboardResult.success) {
    return dashboardResult;
  }

  const dashboard = dashboardResult.data;
  let panels = [];

  // Parse existing panels from saved_objects format
  try {
    panels = JSON.parse(dashboard.attributes?.panelsJSON || "[]");
  } catch {
    panels = [];
  }

  // Calculate next available position (only if y not specified)
  let maxY = 0;
  for (const panel of panels) {
    const gridData = panel.gridData || {};
    const panelBottom = (gridData.y || 0) + (gridData.h || 0);
    if (panelBottom > maxY) {
      maxY = panelBottom;
    }
  }

  // Panel index is a string number
  const panelIndex = String(panels.length + 1);
  const panelRefName = `panel_${panels.length}`;

  // Create new panel in Kibana's expected format
  // Default to full width (48) for better layouts
  // Hide panel titles by default — Vega specs include their own titles
  const newPanel = {
    embeddableConfig: { hidePanelTitles: true },
    gridData: {
      x: gridConfig.x ?? 0,
      y: gridConfig.y ?? maxY,
      w: gridConfig.w ?? 48,
      h: gridConfig.h ?? 15,
      i: panelIndex,
    },
    panelIndex: panelIndex,
    panelRefName: panelRefName,
    type: "visualization",
  };

  panels.push(newPanel);

  // Build new reference
  const newReference = {
    id: visualizationId,
    name: panelRefName,
    type: "visualization",
  };

  // Update dashboard with new attributes
  const updatedAttributes = {
    title: dashboard.attributes?.title || "Untitled",
    description: dashboard.attributes?.description || "",
    panelsJSON: JSON.stringify(panels),
    optionsJSON: dashboard.attributes?.optionsJSON || '{"useMargins":true}',
    timeRestore: dashboard.attributes?.timeRestore || false,
    kibanaSavedObjectMeta: dashboard.attributes?.kibanaSavedObjectMeta || {
      searchSourceJSON: '{"query":{"language":"kuery","query":""}}',
    },
  };

  return upsertSavedObject("dashboard", dashboardId, updatedAttributes, [
    ...(dashboard.references || []),
    newReference,
  ]);
}

// Apply a complete layout to a dashboard (replaces all panels)
async function applyDashboardLayout(dashboardId, layoutConfig) {
  const dashboardResult = await getDashboard(dashboardId);
  if (!dashboardResult.success) {
    return dashboardResult;
  }

  const dashboard = dashboardResult.data;
  const panels = [];
  const references = [];

  for (let i = 0; i < layoutConfig.panels.length; i++) {
    const panelConfig = layoutConfig.panels[i];
    const panelIndex = String(i + 1);
    const panelRefName = `panel_${i}`;

    panels.push({
      embeddableConfig: { hidePanelTitles: true },
      gridData: {
        x: panelConfig.x ?? 0,
        y: panelConfig.y ?? i * 15,
        w: panelConfig.w ?? 48,
        h: panelConfig.h ?? 15,
        i: panelIndex,
      },
      panelIndex: panelIndex,
      panelRefName: panelRefName,
      type: "visualization",
    });

    references.push({
      id: panelConfig.visualization,
      name: panelRefName,
      type: "visualization",
    });
  }

  const updatedAttributes = {
    title: layoutConfig.title || dashboard.attributes?.title || "Untitled",
    description: layoutConfig.description || dashboard.attributes?.description || "",
    panelsJSON: JSON.stringify(panels),
    optionsJSON: dashboard.attributes?.optionsJSON || '{"useMargins":true}',
    timeRestore: dashboard.attributes?.timeRestore || false,
    kibanaSavedObjectMeta: dashboard.attributes?.kibanaSavedObjectMeta || {
      searchSourceJSON: '{"query":{"language":"kuery","query":""}}',
    },
  };

  return upsertSavedObject("dashboard", dashboardId, updatedAttributes, references);
}

// =============================================================================
// Test Connection
// =============================================================================

function parseVersion(versionString) {
  if (!versionString) return { major: 0, minor: 0, patch: 0, snapshot: false, raw: "unknown" };
  const clean = versionString.replace(/-SNAPSHOT.*$/, "");
  const [major, minor, patch] = clean.split(".").map(Number);
  return { major, minor, patch: patch || 0, snapshot: versionString.includes("-SNAPSHOT"), raw: versionString };
}

async function testConnection() {
  const result = await kibanaFetch("/api/status");

  if (result.success) {
    const status = result.data;
    const versionString = status.version?.number || "unknown";
    const buildFlavor = status.version?.build_flavor || "default";

    // Serverless Kibana can be identified by build_flavor or a non-semver version string
    const isSemver = /^\d+\.\d+\.\d+/.test(versionString);
    const isServerless = buildFlavor === "serverless" || (!isSemver && versionString !== "unknown");

    const parsed = isSemver ? parseVersion(versionString) : parseVersion("8.11.0");

    return {
      success: true,
      version: isServerless && !isSemver ? `${versionString} (Serverless)` : versionString,
      parsed,
      buildFlavor: isServerless ? "serverless" : buildFlavor,
      isServerless,
      status: status.status?.overall?.level || "unknown",
      name: status.name || "unknown",
    };
  }

  return result;
}

// =============================================================================
// Spec File Loading
// =============================================================================

function loadSpecFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = readFileSync(filePath, "utf-8");
  return parseSpec(content);
}

async function loadSpec(filePathOrStdin) {
  let content;

  if (filePathOrStdin === "-" || filePathOrStdin === "--stdin") {
    content = await readStdin();
  } else {
    if (!existsSync(filePathOrStdin)) {
      throw new Error(`File not found: ${filePathOrStdin}`);
    }
    content = readFileSync(filePathOrStdin, "utf-8");
  }

  return parseSpec(content);
}

function parseSpec(content) {
  // Try HJSON first (more permissive), then JSON
  try {
    return hjson.parse(content);
  } catch {
    try {
      return JSON.parse(content);
    } catch {
      // Return as string if neither works (raw Vega spec)
      return content;
    }
  }
}

// =============================================================================
// Output Formatting
// =============================================================================

function formatDashboardList(savedObjects) {
  if (!savedObjects || savedObjects.length === 0) {
    return "No dashboards found.";
  }

  const lines = ["ID".padEnd(40) + " | " + "Title"];
  lines.push("-".repeat(40) + "-+-" + "-".repeat(50));

  for (const obj of savedObjects) {
    const id = obj.id || "unknown";
    const title = obj.attributes?.title || "Untitled";
    lines.push(`${id.padEnd(40)} | ${title}`);
  }

  return lines.join("\n");
}

function formatVisualizationList(savedObjects) {
  if (!savedObjects || savedObjects.length === 0) {
    return "No visualizations found.";
  }

  const lines = ["ID".padEnd(40) + " | " + "Type".padEnd(15) + " | " + "Title"];
  lines.push("-".repeat(40) + "-+-" + "-".repeat(15) + "-+-" + "-".repeat(40));

  for (const obj of savedObjects) {
    const id = obj.id || "unknown";
    const title = obj.attributes?.title || "Untitled";
    let type = "unknown";

    try {
      const visState = JSON.parse(obj.attributes?.visState || "{}");
      type = visState.type || "unknown";
    } catch {
      // ignore
    }

    lines.push(`${id.padEnd(40)} | ${type.padEnd(15)} | ${title}`);
  }

  return lines.join("\n");
}

function formatDashboard(dashboard) {
  const lines = [];
  lines.push("=== Dashboard ===");
  lines.push(`ID: ${dashboard.id}`);
  lines.push(`Title: ${dashboard.attributes?.title || "Untitled"}`);
  lines.push(`Description: ${dashboard.attributes?.description || "(none)"}`);

  let panels = [];
  try {
    panels = JSON.parse(dashboard.attributes?.panelsJSON || "[]");
  } catch {
    panels = [];
  }

  lines.push(`\nPanels: ${panels.length}`);

  if (panels.length > 0) {
    lines.push("\n--- Panels ---");
    for (const panel of panels) {
      const grid = panel.gridData || {};
      const gridInfo = `[${grid.x || 0},${grid.y || 0}] ${grid.w || 0}x${grid.h || 0}`;
      lines.push(`  ${panel.panelIndex || "unknown"}: ${panel.type} ${gridInfo}`);
      if (panel.panelRefName) {
        // Find referenced visualization
        const ref = (dashboard.references || []).find((r) => r.name === panel.panelRefName);
        if (ref) {
          lines.push(`    -> ${ref.type}: ${ref.id}`);
        }
      }
    }
  }

  return lines.join("\n");
}

function formatVisualization(visualization) {
  const lines = [];
  lines.push("=== Visualization ===");
  lines.push(`ID: ${visualization.id}`);
  lines.push(`Title: ${visualization.attributes?.title || "Untitled"}`);

  try {
    const visState = JSON.parse(visualization.attributes?.visState || "{}");
    lines.push(`Type: ${visState.type || "unknown"}`);

    if (visState.type === "vega" && visState.params?.spec) {
      lines.push("\n--- Vega Spec ---");
      // Try to pretty print the spec
      try {
        const spec = hjson.parse(visState.params.spec);
        lines.push(JSON.stringify(spec, null, 2));
      } catch {
        lines.push(visState.params.spec);
      }
    }
  } catch {
    lines.push("Type: unknown");
  }

  return lines.join("\n");
}

// =============================================================================
// Main CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const [resource, action, ...params] = args;

  try {
    switch (resource) {
      case "test":
        await handleTest();
        break;

      case "dashboards":
      case "dashboard":
        await handleDashboards(action, params);
        break;

      case "visualizations":
      case "visualization":
      case "vis":
        await handleVisualizations(action, params);
        break;

      default:
        console.error(`Unknown resource: ${resource}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

async function handleTest() {
  console.log("=== Testing Kibana Connection ===\n");

  const result = await testConnection();

  if (result.success) {
    const { parsed, isServerless, buildFlavor } = result;
    const { major, minor } = parsed;

    console.log("✓ Connected successfully!");
    console.log(`  Name:         ${result.name}`);
    console.log(`  Version:      ${result.version}`);
    console.log(`  Build flavor: ${buildFlavor}`);
    if (parsed.snapshot) console.log(`  Snapshot:     yes (treating as ${major}.${minor})`);
    if (isServerless) console.log("  NOTE: Serverless — features available regardless of reported version");
    console.log(`  Status:       ${result.status}`);

    const isSupportedVersion = isServerless || major > 9 || (major === 9 && minor >= 4);
    if (!isSupportedVersion) {
      console.log(
        "\n⚠ WARNING: This skill requires Serverless Kibana or version 9.4+ (SNAPSHOT) for proper ES|QL Vega support.",
      );
      console.log(`  Current version (${major}.${minor}) may lack necessary ES|QL data source capabilities.`);
      console.log("  Ensure you strictly use ES|QL for data queries if you proceed.");
    } else {
      console.log("\n✓ ES|QL Vega data source features are fully supported on this instance.");
    }
  } else {
    console.error("✗ Connection failed:", result.error);
    if (result.details) {
      console.error("Details:", JSON.stringify(result.details, null, 2));
    }
    process.exit(1);
  }
}

async function handleDashboards(action, params) {
  switch (action) {
    case "list":
    case "ls": {
      const searchTerm = params[0] || "";
      const result = await listDashboards(searchTerm);

      if (result.success) {
        console.log("=== Dashboards ===\n");
        console.log(formatDashboardList(result.data.saved_objects));
        console.log(`\nTotal: ${result.data.total || 0}`);
      } else {
        console.error("Error:", result.error);
        process.exit(1);
      }
      break;
    }

    case "get": {
      const id = params[0];
      if (!id) {
        console.error("Error: Dashboard ID required");
        console.error("Usage: ./kibana-vega.js dashboards get <id>");
        process.exit(1);
      }

      const result = await getDashboard(id);

      if (result.success) {
        console.log(formatDashboard(result.data));
      } else {
        console.error("Error:", result.error);
        process.exit(1);
      }
      break;
    }

    case "create": {
      const title = params[0];
      if (!title) {
        console.error("Error: Dashboard title required");
        console.error("Usage: ./kibana-vega.js dashboards create <title> [panels-file.json]");
        process.exit(1);
      }

      let panels = [];
      if (params[1]) {
        panels = loadSpecFile(params[1]);
      }

      const result = await createDashboard(title, panels);

      if (result.success) {
        console.log("✓ Dashboard created successfully!");
        console.log(`  ID: ${result.data.id}`);
        console.log(`  Title: ${result.data.attributes?.title || title}`);
      } else {
        console.error("Error:", result.error);
        if (result.details) {
          console.error("Details:", JSON.stringify(result.details, null, 2));
        }
        process.exit(1);
      }
      break;
    }

    case "update": {
      const id = params[0];
      const file = params[1];

      if (!id || !file) {
        console.error("Error: Dashboard ID and file required");
        console.error("Usage: ./kibana-vega.js dashboards update <id> <file.json>");
        process.exit(1);
      }

      const data = loadSpecFile(file);
      const result = await updateDashboard(id, data);

      if (result.success) {
        console.log("✓ Dashboard updated successfully!");
      } else {
        console.error("Error:", result.error);
        process.exit(1);
      }
      break;
    }

    case "delete":
    case "rm": {
      const id = params[0];
      if (!id) {
        console.error("Error: Dashboard ID required");
        console.error("Usage: ./kibana-vega.js dashboards delete <id>");
        process.exit(1);
      }

      const result = await deleteDashboard(id);

      if (result.success) {
        console.log("✓ Dashboard deleted successfully!");
      } else {
        console.error("Error:", result.error);
        process.exit(1);
      }
      break;
    }

    case "add-panel": {
      const dashboardId = params[0];
      const visualizationId = params[1];

      if (!dashboardId || !visualizationId) {
        console.error("Error: Dashboard ID and Visualization ID required");
        console.error(
          "Usage: ./kibana-vega.js dashboards add-panel <dashboard-id> <visualization-id> [--x N] [--y N] [--w N] [--h N]",
        );
        process.exit(1);
      }

      // Parse grid options from remaining params
      const gridConfig = {};
      for (let i = 2; i < params.length; i++) {
        if (params[i] === "--x" && params[i + 1]) {
          gridConfig.x = parseInt(params[++i], 10);
        } else if (params[i] === "--y" && params[i + 1]) {
          gridConfig.y = parseInt(params[++i], 10);
        } else if (params[i] === "--w" && params[i + 1]) {
          gridConfig.w = parseInt(params[++i], 10);
        } else if (params[i] === "--h" && params[i + 1]) {
          gridConfig.h = parseInt(params[++i], 10);
        }
      }

      const result = await addVisualizationToDashboard(dashboardId, visualizationId, gridConfig);

      if (result.success) {
        const grid = gridConfig;
        const posInfo =
          Object.keys(grid).length > 0
            ? ` at [${grid.x ?? 0},${grid.y ?? "auto"}] ${grid.w ?? 48}x${grid.h ?? 15}`
            : "";
        console.log(`✓ Panel added to dashboard successfully!${posInfo}`);
      } else {
        console.error("Error:", result.error);
        process.exit(1);
      }
      break;
    }

    case "apply-layout": {
      const dashboardId = params[0];
      const layoutFile = params[1];

      if (!dashboardId || !layoutFile) {
        console.error("Error: Dashboard ID and layout file/stdin required");
        console.error("Usage: ./kibana-vega.js dashboards apply-layout <dashboard-id> <layout-file.json>");
        console.error("       ./kibana-vega.js dashboards apply-layout <dashboard-id> - < layout.json");
        process.exit(1);
      }

      const layoutConfig = await loadSpec(layoutFile);

      if (!layoutConfig.panels || !Array.isArray(layoutConfig.panels)) {
        console.error('Error: Layout must contain a "panels" array');
        process.exit(1);
      }

      const result = await applyDashboardLayout(dashboardId, layoutConfig);

      if (result.success) {
        console.log(`✓ Dashboard layout applied successfully!`);
        console.log(`  Panels: ${layoutConfig.panels.length}`);
      } else {
        console.error("Error:", result.error);
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown dashboard action: ${action}`);
      console.error("Available actions: list, get, create, update, delete, add-panel");
      process.exit(1);
  }
}

async function handleVisualizations(action, params) {
  switch (action) {
    case "list":
    case "ls": {
      const typeFilter = params[0] || "";
      const result = await listVisualizations(typeFilter);

      if (result.success) {
        console.log("=== Visualizations ===\n");
        console.log(formatVisualizationList(result.data.saved_objects));
        console.log(`\nTotal: ${result.data.total || 0}`);
      } else {
        console.error("Error:", result.error);
        process.exit(1);
      }
      break;
    }

    case "get": {
      const id = params[0];
      if (!id) {
        console.error("Error: Visualization ID required");
        console.error("Usage: ./kibana-vega.js visualizations get <id>");
        process.exit(1);
      }

      const result = await getVisualization(id);

      if (result.success) {
        console.log(formatVisualization(result.data));
      } else {
        console.error("Error:", result.error);
        process.exit(1);
      }
      break;
    }

    case "create": {
      const title = params[0];
      const file = params[1];

      if (!title || !file) {
        console.error("Error: Title and spec file/stdin required");
        console.error("Usage: ./kibana-vega.js visualizations create <title> <spec-file.hjson>");
        console.error("       ./kibana-vega.js visualizations create <title> - < spec.json");
        console.error("       echo '{\"$schema\":...}' | ./kibana-vega.js visualizations create <title> -");
        process.exit(1);
      }

      const spec = await loadSpec(file);
      const result = await createVegaVisualization(title, spec);

      if (result.success) {
        console.log("✓ Vega visualization created successfully!");
        console.log(`  ID: ${result.data.id}`);
        console.log(`  Title: ${title}`);
      } else {
        console.error("Error:", result.error);
        if (result.details) {
          console.error("Details:", JSON.stringify(result.details, null, 2));
        }
        process.exit(1);
      }
      break;
    }

    case "update": {
      const id = params[0];
      const file = params[1];

      if (!id || !file) {
        console.error("Error: Visualization ID and spec file/stdin required");
        console.error("Usage: ./kibana-vega.js visualizations update <id> <spec-file.hjson>");
        console.error("       ./kibana-vega.js visualizations update <id> - < spec.json");
        console.error("       echo '{\"$schema\":...}' | ./kibana-vega.js visualizations update <id> -");
        process.exit(1);
      }

      // Get current visualization to preserve title
      const current = await getVisualization(id);
      if (!current.success) {
        console.error("Error: Could not fetch visualization:", current.error);
        process.exit(1);
      }

      const title = current.data.attributes?.title || "Untitled";
      const spec = await loadSpec(file);
      const result = await updateVegaVisualization(id, title, spec);

      if (result.success) {
        console.log("✓ Vega visualization updated successfully!");
      } else {
        console.error("Error:", result.error);
        process.exit(1);
      }
      break;
    }

    case "delete":
    case "rm": {
      const id = params[0];
      if (!id) {
        console.error("Error: Visualization ID required");
        console.error("Usage: ./kibana-vega.js visualizations delete <id>");
        process.exit(1);
      }

      const result = await deleteVisualization(id);

      if (result.success) {
        console.log("✓ Visualization deleted successfully!");
      } else {
        console.error("Error:", result.error);
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown visualization action: ${action}`);
      console.error("Available actions: list, get, create, update, delete");
      process.exit(1);
  }
}

function printUsage() {
  console.log(`
Kibana Vega - Dashboard and Visualization Manager

Usage:
  ./kibana-vega.js <resource> <action> [options]

Resources:
  dashboards      Manage Kibana dashboards
  visualizations  Manage Vega visualizations
  test            Test Kibana connection

Dashboard Actions:
  list [search]                          List dashboards (optional search filter)
  get <id>                               Get dashboard by ID
  create <title> [panels-file]           Create a new dashboard
  update <id> <file>                     Update dashboard from file
  delete <id>                            Delete dashboard
  add-panel <dash-id> <vis-id> [opts]    Add visualization with position options
  apply-layout <dash-id> <file|->        Apply complete layout (use - for stdin)

Visualization Actions:
  list [type]                            List visualizations (optional type filter: vega)
  get <id>                               Get visualization by ID (returns JSON spec)
  create <title> <file|->                Create Vega visualization (use - for stdin)
  update <id> <file|->                   Update Vega visualization (use - for stdin)
  delete <id>                            Delete visualization

Environment Variables:
  KIBANA_CLOUD_ID            Elastic Cloud deployment ID (if KIBANA_URL is not set)
  KIBANA_URL                 Kibana URL (required if KIBANA_CLOUD_ID is not set)
  KIBANA_USERNAME            Username for basic auth (or ELASTICSEARCH_USERNAME)
  KIBANA_PASSWORD            Password for basic auth (or ELASTICSEARCH_PASSWORD)
  KIBANA_API_KEY             API key for authentication (or ELASTICSEARCH_API_KEY)
  KIBANA_SPACE_ID            Kibana space ID (optional, default: "default")
  KIBANA_INSECURE            Set to "true" to skip TLS verification

Grid System:
  Kibana uses a 48-column grid. Common widths:
    48 = full width    24 = half width
    16 = third width   12 = quarter width

Examples:
  # Test connection
  ./kibana-vega.js test

  # List all dashboards
  ./kibana-vega.js dashboards list

  # Create visualization from file
  ./kibana-vega.js visualizations create "My Chart" ./my-chart.hjson

  # Create visualization from stdin (no intermediate file needed)
  echo '{"$schema":"https://vega.github.io/schema/vega-lite/v6.json",...}' | \\
    ./kibana-vega.js visualizations create "My Chart" -

  # Update visualization from stdin
  ./kibana-vega.js visualizations update <id> - <<< '{"$schema":...}'

  # Get visualization spec, modify, and update (pipe workflow)
  ./kibana-vega.js visualizations get <id>  # Review current spec
  # Then update with new spec via stdin

  # Add panel with explicit grid position
  ./kibana-vega.js dashboards add-panel <dashboard-id> <vis-id> --x 0 --y 0 --w 24 --h 15

  # Apply layout from stdin
  echo '{"panels":[...]}' | ./kibana-vega.js dashboards apply-layout <dashboard-id> -

  # List only Vega visualizations
  ./kibana-vega.js visualizations list vega
`);
}

main().catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
