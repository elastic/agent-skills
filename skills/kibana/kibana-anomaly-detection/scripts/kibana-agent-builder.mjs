#!/usr/bin/env node
/**
 * Kibana Agent Builder helpers for anomaly-detection — connection pattern aligned with
 * elastic/agent-skills `kibana-dashboards.js`.
 *
 * Requires Node.js 18+ (global fetch). Optional `node:undici` / `undici` for TLS bypass without
 * mutating process-wide NODE_TLS_REJECT_UNAUTHORIZED when available.
 *
 * Usage (run from repo root; script lives under skills/kibana/kibana-anomaly-detection/scripts/):
 *   node skills/kibana/kibana-anomaly-detection/scripts/kibana-agent-builder.mjs test
 *   node skills/kibana/kibana-anomaly-detection/scripts/kibana-agent-builder.mjs tools register [--dry-run]
 *   node skills/kibana/kibana-anomaly-detection/scripts/kibana-agent-builder.mjs skills register [--dry-run]
 *   node skills/kibana/kibana-anomaly-detection/scripts/kibana-agent-builder.mjs all register [--dry-run]   # tools → workflows → skills → merge skill_ids on elastic-ai-agent
 *
 * Kibana compatibility: targets **9.4+** Agent Builder / Workflows. Tool and skill updates use PUT when the API
 * supports it (9.5+); if PUT is missing or returns 404/405, registration falls back to DELETE + POST so idempotent
 * runs still succeed on older minors.
 *
 * Environment variables (same as kibana-dashboards.js):
 *   KIBANA_URL, KIBANA_CLOUD_ID / ELASTICSEARCH_CLOUD_ID,
 *   KIBANA_USERNAME / ELASTICSEARCH_USERNAME,
 *   KIBANA_PASSWORD / ELASTICSEARCH_PASSWORD,
 *   KIBANA_API_KEY / ELASTICSEARCH_API_KEY,
 *   KIBANA_SPACE_ID, KIBANA_INSECURE
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIBANA_REF_DIR = join(__dirname, "..", "references", "kibana");
const AGENT_DIR = join(KIBANA_REF_DIR, "agent");
const TOOLS_DIR = join(KIBANA_REF_DIR, "tools");
const WORKFLOWS_DIR = join(KIBANA_REF_DIR, "workflows");
const PLUGIN_ROOT = join(__dirname, "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const CONSTANTS_PATH = join(__dirname, "agent_builder_constants.json");

const CONSTANTS = JSON.parse(readFileSync(CONSTANTS_PATH, "utf8"));
const DEFAULT_AGENT_ID = CONSTANTS.default_agent_id ?? "elastic-ai-agent";
/** When true (default), PUT sets configuration.enable_elastic_capabilities so bundle skills are active in the Elastic AI Agent. Set false in agent_builder_constants.json to skip. */
const DEFAULT_AGENT_ENABLE_ELASTIC_CAPABILITIES = CONSTANTS.default_agent_enable_elastic_capabilities !== false;
const WORKFLOW_TOOL_EXCLUSIONS = new Set(CONSTANTS.workflow_tool_exclusions);
const WORKFLOW_PREFIXES = CONSTANTS.workflow_prefixes;
const BUILTIN_TOOLS = CONSTANTS.builtin_tools;
const FALLBACK_TOOLS = CONSTANTS.fallback_tools || {};
const BUILTIN_TOOLS_SET = new Set(BUILTIN_TOOLS);

/** Kibana Agent Builder rejects skills with more than this many tool_ids. */
const MAX_SKILL_TOOL_IDS = 5;

let kibanaFetchImpl = globalThis.fetch.bind(globalThis);
let insecureDispatcher = null;
try {
  const u = require("node:undici");
  kibanaFetchImpl = u.fetch.bind(u);
  insecureDispatcher = new u.Agent({ connect: { rejectUnauthorized: false } });
} catch {
  try {
    const u = require("undici");
    kibanaFetchImpl = u.fetch.bind(u);
    insecureDispatcher = new u.Agent({ connect: { rejectUnauthorized: false } });
  } catch {
    insecureDispatcher = null;
  }
}

/**
 * HTTP fetch for Kibana: uses undici Agent for insecure TLS when possible (no global env toggle).
 */
async function kibanaHttpFetch(url, config, init = {}) {
  const merged = {
    ...init,
    headers: { ...init.headers },
  };

  if (config.insecure && insecureDispatcher) {
    merged.dispatcher = insecureDispatcher;
    return kibanaFetchImpl(url, merged);
  }

  if (config.insecure && !insecureDispatcher) {
    const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    try {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      return await globalThis.fetch(url, merged);
    } finally {
      if (prev === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
      }
    }
  }

  return globalThis.fetch(url, merged);
}

/**
 * Read JSON from a fetch Response body; keeps raw text if JSON.parse fails.
 */
async function readJsonBody(res) {
  const text = await res.text();
  if (!text?.trim()) return { text: "", parsed: null };
  try {
    return { text, parsed: JSON.parse(text) };
  } catch {
    return { text, parsed: null };
  }
}

// -----------------------------------------------------------------------------
// Kibana client (aligned with kibana-dashboards.js)
// -----------------------------------------------------------------------------

function kibanaUrlFromCloudId(cloudId) {
  try {
    const parts = cloudId.split(":");
    if (parts.length !== 2) return null;
    const decoded = Buffer.from(parts[1], "base64").toString("utf8");
    const decodedParts = decoded.split("$");
    if (decodedParts.length < 3 || !decodedParts[2]) return null;
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
    return `https://${kibanaUuid}.${host}${port}`;
  } catch {
    return null;
  }
}

function resolveApiKey(cli) {
  if (cli.apiKeyFromCli) {
    const t = (cli.apiKey ?? "").trim();
    return { apiKey: t || undefined, apiKeyCliEmpty: !t };
  }
  for (const name of ["KIBANA_API_KEY", "ELASTICSEARCH_API_KEY"]) {
    const raw = process.env[name];
    if (raw == null) continue;
    const t = String(raw).trim();
    if (t) return { apiKey: t, apiKeyCliEmpty: false };
  }
  return { apiKey: undefined, apiKeyCliEmpty: false };
}

const DEFAULT_KIBANA_URL = "http://localhost:5601";

export function getKibanaConfig(cli = {}) {
  const cloudId = process.env.KIBANA_CLOUD_ID || process.env.ELASTICSEARCH_CLOUD_ID;
  let url = cli.kibanaUrl || process.env.KIBANA_URL;

  if (!url && cloudId) {
    url = kibanaUrlFromCloudId(cloudId);
  }

  const usingDefaults = !url && !cloudId;
  if (usingDefaults) url = DEFAULT_KIBANA_URL;

  const { apiKey, apiKeyCliEmpty } = resolveApiKey(cli);
  const username =
    cli.username ??
    process.env.KIBANA_USERNAME ??
    process.env.ELASTICSEARCH_USERNAME ??
    (apiKey ? undefined : "elastic");
  const password =
    cli.password ??
    process.env.KIBANA_PASSWORD ??
    process.env.ELASTICSEARCH_PASSWORD ??
    (apiKey ? undefined : "changeme");
  let spaceId = cli.spaceId ?? process.env.KIBANA_SPACE_ID;
  if (spaceId === "default") spaceId = undefined;

  const insecureFlag =
    cli.insecure === true || ["1", "true", "yes"].includes((process.env.KIBANA_INSECURE || "").toLowerCase());

  return {
    url,
    username,
    password,
    apiKey,
    apiKeyCliEmpty,
    spaceId,
    insecure: insecureFlag,
    usingDefaults,
  };
}

function warnUsingDefaults() {
  console.log(`No Kibana URL configured — using default: ${DEFAULT_KIBANA_URL} (elastic/changeme)`);
  console.log("");
  console.log("If you want to override Kibana configuration, you can set one of:");
  console.log("  1. Elastic Cloud: KIBANA_CLOUD_ID + KIBANA_API_KEY");
  console.log("  2. URL + API Key: KIBANA_URL + KIBANA_API_KEY");
  console.log("  3. Basic Auth:    KIBANA_URL + KIBANA_USERNAME + KIBANA_PASSWORD");
  console.log("  4. CLI flags:     --kibana-url, --username, --password, --api-key");
  console.log("");
}

function getHeaders(config) {
  const headers = {
    "Content-Type": "application/json",
    "kbn-xsrf": "true",
    "x-elastic-internal-origin": "kibana",
    "User-Agent": "elastic-agentic-anomaly-detection",
  };

  if (config.apiKey) {
    headers.Authorization = `ApiKey ${config.apiKey}`;
  } else if (config.username && config.password) {
    const auth = Buffer.from(`${config.username}:${config.password}`).toString("base64");
    headers.Authorization = `Basic ${auth}`;
  }

  return headers;
}

function getBasePath(config) {
  let basePath = (config.url || "").replace(/\/$/, "");
  if (config.spaceId && config.spaceId !== "default") {
    basePath += `/s/${config.spaceId}`;
  }
  return basePath;
}

function validateConfig(config, { dryRun }) {
  if (config.apiKeyCliEmpty) {
    console.error("Error: --api-key cannot be empty or whitespace-only.");
    return false;
  }
  if (config.apiKey) return true;
  if (config.username && config.password) return true;
  if (dryRun) return true;
  console.error("Error: Authentication required (API key or username + password).");
  return false;
}

async function kibanaFetch(config, path, options = {}) {
  const basePath = getBasePath(config);
  const url = `${basePath}${path}`;

  const fetchOptions = {
    ...options,
    headers: {
      ...getHeaders(config),
      ...options.headers,
    },
  };

  const response = await kibanaHttpFetch(url, config, fetchOptions);
  const contentType = response.headers.get("content-type");
  let data;
  if (contentType && contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return { ok: response.ok, status: response.status, data };
}

async function kibanaEsRequest(config, method, esPath, body) {
  const query = new URLSearchParams({
    path: esPath,
    method: method.toUpperCase(),
  }).toString();

  const options = { method: "POST" };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  return kibanaFetch(config, `/api/console/proxy?${query}`, options);
}

// -----------------------------------------------------------------------------
// Tool registration
// -----------------------------------------------------------------------------

function loadToolDefs() {
  const tools = [];
  for (const subdir of ["esql"]) {
    const dir = join(TOOLS_DIR, subdir);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".json")) continue;
      try {
        const def = JSON.parse(readFileSync(join(dir, name), "utf8"));
        def._sourceFile = `${subdir}/${name}`;
        tools.push(def);
      } catch (e) {
        console.warn(`Skipping ${subdir}/${name}: ${e.message}`);
      }
    }
  }
  return tools;
}

function transformToolDef(def) {
  const { _sourceFile: _, ...rest } = def;
  const payload = {
    id: rest.name || rest.id || "unnamed",
    type: rest.type || "esql",
    description: rest.description || "",
  };
  if (rest.tags) payload.tags = rest.tags;
  const config = { ...(rest.configuration || {}) };
  if (payload.type === "esql") config.params = rest.parameters || {};
  payload.configuration = config;
  return payload;
}

/**
 * True when PUT failed because the update route/method is unavailable (older Kibana), not request validation.
 * In that case we fall back to DELETE + POST with the full create payload.
 */
function agentBuilderPutUnsupported(status, errorText) {
  const t = (errorText || "").slice(0, 800);
  if (status === 404 || status === 405 || status === 501) return true;
  if (status === 400 && /\b(route not found|method not allowed|no handler|cannot\s+(PUT|patch))\b/i.test(t)) {
    return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry Kibana Agent Builder writes when SNAPSHOT / testcontainers stacks return transient errors during bulk
 * registration (common after many consecutive tool POSTs).
 */
async function kibanaHttpFetchWithRetry(url, config, init, { attempts = 5 } = {}) {
  let res;
  for (let attempt = 0; attempt < attempts; attempt++) {
    res = await kibanaHttpFetch(url, config, init);
    if (res.ok) return res;
    if (![408, 429, 502, 503, 504].includes(res.status)) return res;
    try {
      await res.text();
    } catch {
      /* ignore body read errors */
    }
    const backoff = 150 * 2 ** attempt + Math.floor(Math.random() * 100);
    await sleep(backoff);
  }
  return res;
}

async function registerTool(config, def, dryRun) {
  const payload = transformToolDef(def);
  console.log(`Tool: ${payload.id} (${def._sourceFile})`);

  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return true;
  }

  const basePath = getBasePath(config);
  const toolsUrl = `${basePath}/api/agent_builder/tools`;
  const toolByIdUrl = `${toolsUrl}/${encodeURIComponent(payload.id)}`;
  const headers = { ...getHeaders(config), "kbn-xsrf": "true" };

  /** PUT body — id comes from path; `type` is immutable (POST-only). */
  const updateBody = {
    description: payload.description,
    configuration: payload.configuration,
  };
  if (payload.tags) updateBody.tags = payload.tags;

  let res = await kibanaHttpFetchWithRetry(
    toolsUrl,
    config,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
    { attempts: 5 },
  );

  if (res.ok) {
    console.log(`  Registered: ${payload.id}`);
    return true;
  }

  const text = await res.text();
  const alreadyExists = res.status === 409 || (res.status === 400 && /already exists|duplicate/i.test(text));

  if (alreadyExists) {
    console.log(`  Already exists — updating (PUT): ${payload.id}`);
    const putRes = await kibanaHttpFetchWithRetry(
      toolByIdUrl,
      config,
      {
        method: "PUT",
        headers,
        body: JSON.stringify(updateBody),
      },
      { attempts: 5 },
    );
    if (putRes.ok) {
      console.log(`  Updated: ${payload.id}`);
      return true;
    }
    const putText = await putRes.text();
    if (agentBuilderPutUnsupported(putRes.status, putText)) {
      console.log(`  PUT unsupported — deleting and re-creating: ${payload.id}`);
      await kibanaHttpFetchWithRetry(toolByIdUrl, config, { method: "DELETE", headers }, { attempts: 3 });
      const recRes = await kibanaHttpFetchWithRetry(
        toolsUrl,
        config,
        {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        },
        { attempts: 5 },
      );
      if (recRes.ok) {
        console.log(`  Re-created: ${payload.id}`);
        return true;
      }
      const recText = await recRes.text();
      console.error(`  Failed: ${recRes.status} ${recText.slice(0, 200)}`);
      return false;
    }
    console.error(`  Failed to update tool: ${putRes.status} ${putText.slice(0, 200)}`);
    return false;
  }

  console.error(`  Failed: ${res.status} ${text.slice(0, 200)}`);
  return false;
}

async function cmdToolsRegister(argv) {
  let dryRun = false;
  const cli = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--kibana-url") cli.kibanaUrl = argv[++i];
    else if (a === "--username") cli.username = argv[++i];
    else if (a === "--password") cli.password = argv[++i];
    else if (a === "--api-key") {
      cli.apiKeyFromCli = true;
      cli.apiKey = argv[++i];
    } else if (a === "--space-id") cli.spaceId = argv[++i];
    else if (a === "--insecure") cli.insecure = true;
  }

  const config = getKibanaConfig(cli);
  if (!validateConfig(config, { dryRun })) process.exit(1);
  if (config.usingDefaults && !dryRun) warnUsingDefaults();

  const defs = loadToolDefs();
  console.log(`Loaded ${defs.length} tool definitions`);

  if (!dryRun) {
    const st = await kibanaFetch(config, "/api/status");
    if (!st.ok) {
      console.error("Cannot reach Kibana:", st.status, st.data);
      process.exit(1);
    }
    console.log("Connected to Kibana", st.data?.version?.number || "?");
  }

  let succeeded = 0,
    failed = 0,
    skipped = 0;
  for (const def of defs) {
    const primaryBuiltin = FALLBACK_TOOLS[def.name];
    if (primaryBuiltin && BUILTIN_TOOLS_SET.has(primaryBuiltin)) {
      console.log(`  Skipping fallback tool: ${def.name} (${primaryBuiltin} is available as a builtin)`);
      skipped++;
      continue;
    }
    const ok = await registerTool(config, def, dryRun);
    ok ? succeeded++ : failed++;
    if (!dryRun) await sleep(120);
  }

  if (!dryRun) {
    console.log(`\nRegistration complete: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped`);
  }
}

// -----------------------------------------------------------------------------
// ML job scaffolding
// -----------------------------------------------------------------------------

function parseJobsCreateServiceHealthArgs(argv) {
  const cli = {};
  const opts = {
    prefix: "svc",
    metricsIndex: "metrics-*",
    logsIndex: "logs-*",
    apmIndex: "apm-*",
    bucketSpan: "15m",
    queryDelay: "120s",
    memoryLimit: "256mb",
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--prefix") opts.prefix = argv[++i];
    else if (a === "--metrics-index") opts.metricsIndex = argv[++i];
    else if (a === "--logs-index") opts.logsIndex = argv[++i];
    else if (a === "--apm-index") opts.apmIndex = argv[++i];
    else if (a === "--bucket-span") opts.bucketSpan = argv[++i];
    else if (a === "--query-delay") opts.queryDelay = argv[++i];
    else if (a === "--memory-limit") opts.memoryLimit = argv[++i];
    else if (a === "--kibana-url") cli.kibanaUrl = argv[++i];
    else if (a === "--username") cli.username = argv[++i];
    else if (a === "--password") cli.password = argv[++i];
    else if (a === "--api-key") {
      cli.apiKeyFromCli = true;
      cli.apiKey = argv[++i];
    } else if (a === "--space-id") cli.spaceId = argv[++i];
    else if (a === "--insecure") cli.insecure = true;
  }

  return { cli, opts };
}

function serviceHealthPlans(opts) {
  const makePlan = (suffix, description, indices, datafeedQuery, detectors, influencers) => {
    const jobId = `${opts.prefix}-${suffix}`;
    const datafeedId = `datafeed-${jobId}`;
    return {
      jobId,
      datafeedId,
      jobBody: {
        description,
        analysis_config: {
          bucket_span: opts.bucketSpan,
          detectors,
          influencers,
        },
        analysis_limits: {
          model_memory_limit: opts.memoryLimit,
        },
        data_description: {
          time_field: "@timestamp",
        },
      },
      datafeedBody: {
        datafeed_id: datafeedId,
        job_id: jobId,
        indices,
        query_delay: opts.queryDelay,
        scroll_size: 1000,
        query: datafeedQuery,
      },
    };
  };

  const serviceInfluencers = ["service.name", "host.name", "kubernetes.pod.name"];

  return [
    makePlan(
      "cpu-high-mean",
      "Detect sustained CPU pressure per service from metrics data.",
      [opts.metricsIndex],
      {
        bool: {
          filter: [
            { exists: { field: "@timestamp" } },
            { exists: { field: "service.name" } },
            { exists: { field: "system.cpu.total.norm.pct" } },
          ],
        },
      },
      [
        {
          function: "high_mean",
          field_name: "system.cpu.total.norm.pct",
          partition_field_name: "service.name",
        },
      ],
      serviceInfluencers,
    ),
    makePlan(
      "memory-high-mean",
      "Detect sustained memory pressure per service from metrics data.",
      [opts.metricsIndex],
      {
        bool: {
          filter: [
            { exists: { field: "@timestamp" } },
            { exists: { field: "service.name" } },
            { exists: { field: "system.memory.actual.used.pct" } },
          ],
        },
      },
      [
        {
          function: "high_mean",
          field_name: "system.memory.actual.used.pct",
          partition_field_name: "service.name",
        },
      ],
      serviceInfluencers,
    ),
    makePlan(
      "latency-high-mean",
      "Detect service latency spikes from APM transactions.",
      [opts.apmIndex],
      {
        bool: {
          filter: [
            { exists: { field: "@timestamp" } },
            { exists: { field: "service.name" } },
            { term: { "processor.event": "transaction" } },
            { exists: { field: "transaction.duration.us" } },
          ],
        },
      },
      [
        {
          function: "high_mean",
          field_name: "transaction.duration.us",
          partition_field_name: "service.name",
        },
      ],
      ["service.name", "transaction.type", "host.name"],
    ),
    makePlan(
      "error-rate-high-count",
      "Detect service-level error surges from logs and failed transactions.",
      [opts.logsIndex, opts.apmIndex],
      {
        bool: {
          filter: [{ exists: { field: "@timestamp" } }, { exists: { field: "service.name" } }],
          should: [{ term: { "log.level": "error" } }, { term: { "event.outcome": "failure" } }],
          minimum_should_match: 1,
        },
      },
      [
        {
          function: "high_count",
          partition_field_name: "service.name",
        },
      ],
      ["service.name", "event.dataset", "host.name", "kubernetes.pod.name"],
    ),
  ];
}

async function upsertServiceHealthPlan(config, plan, dryRun) {
  const requests = [
    ["PUT", `/_ml/anomaly_detectors/${encodeURIComponent(plan.jobId)}`, plan.jobBody],
    ["PUT", `/_ml/datafeeds/${encodeURIComponent(plan.datafeedId)}`, plan.datafeedBody],
    ["POST", `/_ml/anomaly_detectors/${encodeURIComponent(plan.jobId)}/_open`],
    ["POST", `/_ml/datafeeds/${encodeURIComponent(plan.datafeedId)}/_start`],
  ];

  console.log(`\nJob: ${plan.jobId}`);
  if (dryRun) {
    for (const [method, path, body] of requests) {
      console.log(`${method} ${path}`);
      if (body !== undefined) console.log(JSON.stringify(body, null, 2));
    }
    return true;
  }

  for (const [method, path, body] of requests) {
    const res = await kibanaEsRequest(config, method, path, body);
    if (res.ok) {
      console.log(`  ${method} ${path} -> ${res.status}`);
      continue;
    }
    const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    const alreadyExists =
      res.status === 409 || (res.status === 400 && /already exists|resource_already_exists_exception/i.test(text));
    const alreadyStarted =
      res.status === 409 || (res.status === 400 && /already open|already started|is started/i.test(text));
    if (alreadyExists || alreadyStarted) {
      console.log(`  ${method} ${path} -> exists/already started; continuing`);
      continue;
    }
    console.error(`  ${method} ${path} -> failed (${res.status}): ${text.slice(0, 350)}`);
    return false;
  }

  return true;
}

async function cmdJobsCreateServiceHealth(argv) {
  const { cli, opts } = parseJobsCreateServiceHealthArgs(argv);
  const config = getKibanaConfig(cli);
  if (!validateConfig(config, { dryRun: opts.dryRun })) process.exit(1);
  if (config.usingDefaults && !opts.dryRun) warnUsingDefaults();

  if (!opts.dryRun) {
    const st = await kibanaFetch(config, "/api/status");
    if (!st.ok) {
      console.error("Cannot reach Kibana:", st.status, st.data);
      process.exit(1);
    }
    console.log("Connected to Kibana", st.data?.version?.number || "?");
  }

  const plans = serviceHealthPlans(opts);
  console.log(
    `Creating ${plans.length} service-health jobs (prefix='${opts.prefix}', bucket_span='${opts.bucketSpan}', query_delay='${opts.queryDelay}')`,
  );

  let okCount = 0;
  let failCount = 0;
  for (const plan of plans) {
    const ok = await upsertServiceHealthPlan(config, plan, opts.dryRun);
    if (ok) okCount++;
    else failCount++;
  }

  console.log(`\nDone: ${okCount} succeeded, ${failCount} failed`);
  if (!opts.dryRun) {
    console.log("Check jobs in Kibana: Stack Management > Machine Learning > Anomaly Detection Jobs");
  }
}

// -----------------------------------------------------------------------------
// Tool classification (skill tool_ids + agent JSON manifests)
// -----------------------------------------------------------------------------

function isWorkflowTool(toolId) {
  if (WORKFLOW_TOOL_EXCLUSIONS.has(toolId)) return true;
  if (toolId in FALLBACK_TOOLS) return true;
  return WORKFLOW_PREFIXES.some((p) => toolId.startsWith(p));
}

/** ES|QL tool IDs that `tools register` would POST (same skip rules as cmdToolsRegister). */
function getRegisterableEsqlToolIds() {
  const ids = new Set();
  for (const def of loadToolDefs()) {
    const primaryBuiltin = FALLBACK_TOOLS[def.name];
    if (primaryBuiltin && BUILTIN_TOOLS_SET.has(primaryBuiltin)) continue;
    ids.add(transformToolDef(def).id);
  }
  return ids;
}

function loadAgentToolNames(jsonBasename) {
  const path = join(AGENT_DIR, jsonBasename);
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(data.tools) ? data.tools : [];
  } catch {
    return [];
  }
}

function mergedCoreAgentToolNames() {
  const a = loadAgentToolNames("anomaly_detective.json");
  const b = loadAgentToolNames("anomaly_explainer.json");
  const c = loadAgentToolNames("anomaly_maintainer.json");
  return [...new Set([...a, ...b, ...c])];
}

/** Maps skill folder id → tool lists from references/kibana/agent/*.json (used only to derive skill tool_ids). */
const SKILL_ID_AGENT_JSON = {
  "investigate-anomaly": "anomaly_detective.json",
  "explain-anomaly-results": "anomaly_explainer.json",
  "troubleshoot-anomaly-detection-jobs": "anomaly_maintainer.json",
  "manage-anomaly-detection-job": "anomaly_maintainer.json",
};

function toolNamesDeclaredForSkill(skillId) {
  if (
    skillId === "kibana-anomaly-detection" ||
    skillId === "observability-anomaly-expert" ||
    skillId === "security-anomaly-expert"
  ) {
    return mergedCoreAgentToolNames();
  }
  const agentJson = SKILL_ID_AGENT_JSON[skillId];
  if (agentJson) return loadAgentToolNames(agentJson);
  return [];
}

/**
 * Full preference list: builtins (in order) then custom ES|QL tools from agent manifests that `tools register`
 * created (workflow-backed tools omitted).
 */
function buildSkillToolIdsFallback(skillId, registeredEsqlIds, missingAccumulator) {
  const declared = toolNamesDeclaredForSkill(skillId);
  const nonWorkflow = declared.filter((t) => !isWorkflowTool(t));
  const nonBuiltin = nonWorkflow.filter((t) => !BUILTIN_TOOLS_SET.has(t));
  const attached = [];
  for (const t of nonBuiltin) {
    if (registeredEsqlIds.has(t)) attached.push(t);
    else missingAccumulator.add(t);
  }
  return [...BUILTIN_TOOLS, ...attached];
}

const TOOL_ID_SCAN_RE = /\b(ad_[a-z][a-z0-9_]*)\b|\b(platform\.core\.[a-z0-9_]+)\b|\b(observability\.[a-z0-9_]+)\b/g;

/**
 * Tool ids appearing in *skillMarkdown* (order = first mention wins). Only includes ids Kibana can attach:
 * builtins from this bundle, or registerable ES|QL tools (non-workflow).
 */
function extractMentionedToolIdsInOrder(skillMarkdown, registeredEsqlIds) {
  const ordered = [];
  const seen = new Set();
  if (!skillMarkdown) return ordered;
  let m;
  TOOL_ID_SCAN_RE.lastIndex = 0;
  while ((m = TOOL_ID_SCAN_RE.exec(skillMarkdown)) !== null) {
    const id = m[1] || m[2] || m[3];
    if (seen.has(id)) continue;
    if (isWorkflowTool(id)) continue;
    if (BUILTIN_TOOLS_SET.has(id)) {
      seen.add(id);
      ordered.push(id);
      continue;
    }
    if (registeredEsqlIds.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  return ordered;
}

/**
 * At most {@link MAX_SKILL_TOOL_IDS} tools: prefer those mentioned in the skill markdown (full SKILL.md text),
 * then fill from the manifest-derived fallback list.
 */
function buildSkillToolIdsCapped(skillId, skillMarkdownScan, registeredEsqlIds, missingAccumulator) {
  const mentioned = extractMentionedToolIdsInOrder(skillMarkdownScan, registeredEsqlIds);
  const fallback = buildSkillToolIdsFallback(skillId, registeredEsqlIds, missingAccumulator);
  const out = [];
  const seen = new Set();
  for (const id of mentioned) {
    if (out.length >= MAX_SKILL_TOOL_IDS) break;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of fallback) {
    if (out.length >= MAX_SKILL_TOOL_IDS) break;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function enrichSkillDefsWithToolIds(defs) {
  const registered = getRegisterableEsqlToolIds();
  const missing = new Set();
  for (const def of defs) {
    const scan = def._toolScanMarkdown ?? "";
    delete def._toolScanMarkdown;
    def.tool_ids = buildSkillToolIdsCapped(def.id, scan, registered, missing);
  }
  if (missing.size > 0) {
    const sample = [...missing].sort().slice(0, 16).join(", ");
    console.warn(
      `  Note: ${missing.size} tool id(s) declared in agent JSON but not in ES|QL bundle (workflows / skipped fallbacks) — omitted from skill tool_ids: ${sample}${missing.size > 16 ? " …" : ""}`,
    );
  }
  return defs;
}

async function cmdWorkflowsRegister(argv) {
  let dryRun = false;
  const cli = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--kibana-url") cli.kibanaUrl = argv[++i];
    else if (a === "--username") cli.username = argv[++i];
    else if (a === "--password") cli.password = argv[++i];
    else if (a === "--api-key") {
      cli.apiKeyFromCli = true;
      cli.apiKey = argv[++i];
    } else if (a === "--space-id") cli.spaceId = argv[++i];
    else if (a === "--insecure") cli.insecure = true;
  }

  const config = getKibanaConfig(cli);
  if (!validateConfig(config, { dryRun })) process.exit(1);
  if (config.usingDefaults && !dryRun) warnUsingDefaults();

  const files = readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();

  if (files.length === 0) {
    console.error("No YAML files found in", WORKFLOWS_DIR);
    process.exit(1);
  }

  const workflows = files.map((f) => ({
    _file: f,
    yaml: readFileSync(join(WORKFLOWS_DIR, f), "utf8"),
  }));

  console.log(`Loaded ${workflows.length} workflow YAML files`);

  if (dryRun) {
    for (const { _file, yaml } of workflows) {
      console.log(`\n--- ${_file} ---`);
      console.log(yaml.slice(0, 200) + (yaml.length > 200 ? "\n  ..." : ""));
    }
    return;
  }

  const st = await kibanaFetch(config, "/api/status");
  if (!st.ok) {
    console.error("Cannot reach Kibana:", st.status, st.data);
    process.exit(1);
  }
  console.log("Connected to Kibana", st.data?.version?.number || "?");

  const basePath = getBasePath(config);
  const url = `${basePath}/api/workflows?overwrite=true`;
  const payload = { workflows: workflows.map(({ yaml }) => ({ yaml })) };

  const res = await kibanaHttpFetch(url, config, {
    method: "POST",
    headers: { ...getHeaders(config), "kbn-xsrf": "true" },
    body: JSON.stringify(payload),
  });

  let body;
  try {
    body = await res.json();
  } catch {
    const text = await res.text().catch(() => "");
    console.error(`Unexpected response ${res.status}: ${text.slice(0, 300)}`);
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`Failed: ${res.status}`, JSON.stringify(body).slice(0, 400));
    process.exit(1);
  }

  for (const { id, name } of body.created ?? []) {
    console.log(`  Registered: ${name} (${id})`);
  }
  for (const failure of body.failures ?? []) {
    console.error(`  Failed: ${JSON.stringify(failure)}`);
  }

  console.log(`\nDone: ${body.created?.length ?? 0} registered, ${body.failures?.length ?? 0} failed`);
}

async function cmdTest(config) {
  if (!validateConfig(config, { dryRun: false })) process.exit(1);
  if (config.usingDefaults) warnUsingDefaults();

  const basePath = getBasePath(config);
  const res = await kibanaHttpFetch(`${basePath}/api/status`, config, {
    headers: { ...getHeaders(config), "kbn-xsrf": "true" },
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error("Connection failed:", res.status, data);
    process.exit(1);
  }

  const version = data.version?.number || "unknown";
  console.log("Connected to Kibana", version);
  console.log("  Base URL:", config.url);
  console.log("  Space:", config.spaceId || "(default)");
  console.log("  Auth:", config.apiKey ? "ApiKey" : "Basic");
}

// -----------------------------------------------------------------------------
// Skill registration
// -----------------------------------------------------------------------------

function parseSkillFrontmatter(raw) {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};
  const lines = fmMatch[1].split("\n");
  const result = {};
  let i = 0;
  while (i < lines.length) {
    const keyMatch = lines[i].match(/^(\w+):\s*(.*)/);
    if (!keyMatch) {
      i++;
      continue;
    }
    const key = keyMatch[1];
    const valueStart = keyMatch[2].trim();
    if (valueStart === ">-" || valueStart === ">") {
      const parts = [];
      i++;
      while (i < lines.length && /^\s/.test(lines[i])) {
        parts.push(lines[i].trim());
        i++;
      }
      result[key] = parts.join(" ");
    } else {
      result[key] = valueStart;
      i++;
    }
  }
  return result;
}

function extractSkillContent(raw) {
  const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
  return match ? match[1].trim() : raw.trim();
}

function readSkillDefFromDir(skillDir, id) {
  const mdPath = join(skillDir, "SKILL.md");
  if (!existsSync(mdPath)) return null;
  let raw;
  try {
    raw = readFileSync(mdPath, "utf8");
  } catch (e) {
    console.warn(`Skipping ${id}: ${e.message}`);
    return null;
  }
  const fm = parseSkillFrontmatter(raw);
  if (!fm.name && !fm.description) {
    console.warn(`Skipping ${id}: no name/description in frontmatter`);
    return null;
  }
  return {
    id,
    name: fm.name || id,
    description: fm.description || "",
    content: extractSkillContent(raw),
    /** Full SKILL.md (for tool mention scan); stripped before POST. */
    _toolScanMarkdown: raw,
  };
}

function loadSkillDefs() {
  const defs = [];

  // Hub skill at plugin root (skills/kibana/kibana-anomaly-detection/SKILL.md)
  const hubId = basename(PLUGIN_ROOT);
  const hubDef = readSkillDefFromDir(PLUGIN_ROOT, hubId);
  if (hubDef) defs.push(hubDef);

  if (!existsSync(SKILLS_DIR)) {
    console.warn(`Skills directory not found: ${SKILLS_DIR}`);
    return defs;
  }
  for (const entry of readdirSync(SKILLS_DIR).sort()) {
    const skillPath = join(SKILLS_DIR, entry);
    const sub = readSkillDefFromDir(skillPath, entry);
    if (sub) defs.push(sub);
  }
  return defs;
}

async function registerSkill(config, def, dryRun) {
  const toolIds = def.tool_ids ?? [];
  const payload = {
    id: def.id,
    name: def.name,
    description: def.description,
    content: def.content,
    tool_ids: toolIds,
  };
  console.log(`Skill: ${payload.id} (${toolIds.length} tool_ids)`);

  if (dryRun) {
    const preview = {
      ...payload,
      content: payload.content.slice(0, 120) + (payload.content.length > 120 ? "..." : ""),
      tool_ids: toolIds,
    };
    console.log(JSON.stringify(preview, null, 2));
    return true;
  }

  const basePath = getBasePath(config);
  const skillsUrl = `${basePath}/api/agent_builder/skills`;
  const skillByIdUrl = `${skillsUrl}/${encodeURIComponent(payload.id)}`;
  const headers = { ...getHeaders(config), "kbn-xsrf": "true" };

  /** PUT body — path carries skill id (see Kibana Agent Builder API). */
  const updateBody = {
    name: payload.name,
    description: payload.description,
    content: payload.content,
    tool_ids: toolIds,
  };

  let res = await kibanaHttpFetch(skillsUrl, config, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    console.log(`  Registered: ${payload.id}`);
    return true;
  }

  const text = await res.text();
  const alreadyExists =
    res.status === 409 ||
    (res.status === 400 && /already exists|duplicate/i.test(text)) ||
    /already exists/i.test(text);

  if (alreadyExists) {
    console.log(`  Already exists — updating (PUT): ${payload.id}`);
    const putRes = await kibanaHttpFetch(skillByIdUrl, config, {
      method: "PUT",
      headers,
      body: JSON.stringify(updateBody),
    });
    if (putRes.ok) {
      console.log(`  Updated: ${payload.id}`);
      return true;
    }
    const putText = await putRes.text();
    if (agentBuilderPutUnsupported(putRes.status, putText)) {
      console.log(`  PUT unsupported — deleting and re-creating: ${payload.id}`);
      await kibanaHttpFetch(skillByIdUrl, config, { method: "DELETE", headers });
      const recRes = await kibanaHttpFetch(skillsUrl, config, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (recRes.ok) {
        console.log(`  Re-created: ${payload.id}`);
        return true;
      }
      const recText = await recRes.text();
      console.error(`  Failed: ${recRes.status} ${recText.slice(0, 200)}`);
      return false;
    }
    console.error(`  Failed to update skill: ${putRes.status} ${putText.slice(0, 200)}`);
    return false;
  }

  console.error(`  Failed: ${res.status} ${text.slice(0, 200)}`);
  return false;
}

/** True if object looks like an Agent Builder agent record (GET /api/agent_builder/agents/{id}). */
function looksLikeAgentRecord(o) {
  if (!o || typeof o !== "object") return false;
  if (typeof o.id === "string") return true;
  if (typeof o.name === "string") return true;
  if (o.configuration != null && typeof o.configuration === "object") return true;
  if (Array.isArray(o.skill_ids)) return true;
  return false;
}

/** Normalize GET /api/agent_builder/agents/{id} JSON (envelope or raw agent). */
function unwrapAgentPayload(data) {
  if (!data || typeof data !== "object") return null;

  const direct = looksLikeAgentRecord(data) ? data : null;
  if (direct) return direct;

  const nestedKeys = ["agent", "item", "attributes", "record", "result"];
  for (const key of nestedKeys) {
    const v = data[key];
    if (looksLikeAgentRecord(v)) return v;
  }

  const d = data.data;
  if (d != null && typeof d === "object") {
    if (looksLikeAgentRecord(d)) return d;
    if (Array.isArray(d) && d.length === 1 && looksLikeAgentRecord(d[0])) return d[0];
  }

  for (const v of Object.values(data)) {
    if (looksLikeAgentRecord(v)) return v;
    if (Array.isArray(v) && v.length && looksLikeAgentRecord(v[0])) return v[0];
    if (v != null && typeof v === "object" && !Array.isArray(v)) {
      for (const inner of Object.values(v)) {
        if (looksLikeAgentRecord(inner)) return inner;
      }
    }
  }

  return null;
}

function buildAgentPutBody(agent, configuration) {
  const payload = { configuration };
  if (agent.name != null) payload.name = agent.name;
  if (agent.description != null) payload.description = agent.description;
  if (agent.avatar_color != null) payload.avatar_color = agent.avatar_color;
  if (agent.avatar_symbol != null) payload.avatar_symbol = agent.avatar_symbol;
  if (agent.labels != null) payload.labels = agent.labels;
  if (agent.visibility != null) payload.visibility = agent.visibility;
  return payload;
}

/**
 * Build agent `configuration` from GET response (supports nested `configuration` or flat fields).
 * Some Kibana versions expose skill_ids / workflow_ids / enable_elastic_capabilities at the top level.
 */
function extractAgentConfiguration(agent) {
  const cfg = {
    ...(agent.configuration && typeof agent.configuration === "object" ? agent.configuration : {}),
  };
  if (!Array.isArray(cfg.skill_ids) && Array.isArray(agent.skill_ids)) {
    cfg.skill_ids = [...agent.skill_ids];
  }
  if (cfg.enable_elastic_capabilities === undefined && typeof agent.enable_elastic_capabilities === "boolean") {
    cfg.enable_elastic_capabilities = agent.enable_elastic_capabilities;
  }
  if (!Array.isArray(cfg.workflow_ids) && Array.isArray(agent.workflow_ids)) {
    cfg.workflow_ids = [...agent.workflow_ids];
  }
  if (!Array.isArray(cfg.skill_ids)) cfg.skill_ids = [];
  if (!Array.isArray(cfg.workflow_ids)) cfg.workflow_ids = [];
  return cfg;
}

/**
 * Merge bundle skill IDs into the default Elastic AI Agent (PUT /api/agent_builder/agents/{id}).
 * Requires agentBuilder:manageAgents on top of skill/tool registration privileges.
 */
async function attachSkillsToDefaultAgent(config, skillIds, agentId, dryRun) {
  const basePath = getBasePath(config);
  const agentUrl = `${basePath}/api/agent_builder/agents/${encodeURIComponent(agentId)}`;
  const headers = { ...getHeaders(config), "kbn-xsrf": "true" };

  if (dryRun) {
    const merged = [...new Set(skillIds)];
    const previewCfg = {
      skill_ids: merged,
      enable_elastic_capabilities: DEFAULT_AGENT_ENABLE_ELASTIC_CAPABILITIES === true,
      workflow_ids: [],
    };
    console.log(`PUT ${agentUrl} (dry-run — no GET; preview configuration merge)`);
    console.log(JSON.stringify({ configuration: previewCfg }, null, 2));
    return true;
  }

  const getRes = await kibanaHttpFetch(agentUrl, config, { method: "GET", headers });
  const { text: getText, parsed: payload } = await readJsonBody(getRes);

  if (!getRes.ok) {
    const snippet =
      payload != null && typeof payload === "object" ? JSON.stringify(payload).slice(0, 280) : getText.slice(0, 280);
    console.warn(`  Could not GET agent "${agentId}" (${getRes.status}): ${snippet.slice(0, 220)}`);
    console.warn(`  Skipping default-agent skill attachment (needs read_onechat / agent read on agents).`);
    return false;
  }

  const agent = unwrapAgentPayload(payload);
  if (!agent || typeof agent !== "object") {
    const keys =
      payload != null && typeof payload === "object" ? Object.keys(payload).join(", ") : getText.slice(0, 80);
    console.warn(
      `  Unexpected GET agent response shape (keys/snippet: ${keys}) — skipping default-agent skill attachment`,
    );
    return false;
  }

  const cfg = extractAgentConfiguration(agent);
  const existing = [...cfg.skill_ids];
  const merged = [...new Set([...existing, ...skillIds])];
  const missing = skillIds.filter((id) => !existing.includes(id));

  const enableWasNotTrue = DEFAULT_AGENT_ENABLE_ELASTIC_CAPABILITIES && cfg.enable_elastic_capabilities !== true;
  const needsSkillMerge = missing.length > 0;

  if (!needsSkillMerge && !enableWasNotTrue) {
    console.log(`  Default agent "${agentId}" already includes all bundle skills and elastic capabilities are enabled`);
    return true;
  }

  if (DEFAULT_AGENT_ENABLE_ELASTIC_CAPABILITIES) {
    cfg.enable_elastic_capabilities = true;
  }
  cfg.skill_ids = merged;

  const putBody = buildAgentPutBody(agent, cfg);

  const reasons = [];
  if (needsSkillMerge) reasons.push(`adding skills: ${missing.join(", ")}`);
  if (enableWasNotTrue) reasons.push("enable_elastic_capabilities → true");

  console.log(`Default agent: updating "${agentId}" (${reasons.join("; ")})`);

  const putRes = await kibanaHttpFetch(agentUrl, config, {
    method: "PUT",
    headers,
    body: JSON.stringify(putBody),
  });

  if (putRes.ok) {
    console.log(`  Updated agent "${agentId}": ${merged.length} skill_id(s) total`);
    return true;
  }

  const { text: putErrRaw, parsed: putPayload } = await readJsonBody(putRes);
  const errText =
    putPayload != null && typeof putPayload === "object"
      ? JSON.stringify(putPayload).slice(0, 450)
      : putErrRaw.slice(0, 450);
  console.error(`  PUT agent "${agentId}" failed (${putRes.status}): ${errText.slice(0, 350)}`);
  console.error(`  (Requires privileges to update agents, e.g. agentBuilder / manage agents.)`);
  return false;
}

async function cmdSkillsRegister(argv) {
  let dryRun = false;
  let skipDefaultAgent = false;
  let defaultAgentId = DEFAULT_AGENT_ID;
  const cli = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--skip-default-agent") skipDefaultAgent = true;
    else if (a === "--default-agent-id") defaultAgentId = argv[++i];
    else if (a === "--kibana-url") cli.kibanaUrl = argv[++i];
    else if (a === "--username") cli.username = argv[++i];
    else if (a === "--password") cli.password = argv[++i];
    else if (a === "--api-key") {
      cli.apiKeyFromCli = true;
      cli.apiKey = argv[++i];
    } else if (a === "--space-id") cli.spaceId = argv[++i];
    else if (a === "--insecure") cli.insecure = true;
  }

  const config = getKibanaConfig(cli);
  if (!validateConfig(config, { dryRun })) process.exit(1);
  if (config.usingDefaults && !dryRun) warnUsingDefaults();

  const defs = enrichSkillDefsWithToolIds(loadSkillDefs());
  console.log(
    `Loaded ${defs.length} skill definitions (tool_ids capped at ${MAX_SKILL_TOOL_IDS}; skill text first, then manifest fallback)`,
  );

  if (defs.length === 0) {
    console.error(`No skills found under ${PLUGIN_ROOT} or ${SKILLS_DIR}`);
    process.exit(1);
  }

  if (!dryRun) {
    const st = await kibanaFetch(config, "/api/status");
    if (!st.ok) {
      console.error("Cannot reach Kibana:", st.status, st.data);
      process.exit(1);
    }
    console.log("Connected to Kibana", st.data?.version?.number || "?");
  }

  let succeeded = 0,
    failed = 0;
  const succeededSkillIds = [];
  for (const def of defs) {
    const ok = await registerSkill(config, def, dryRun);
    if (ok) {
      succeeded++;
      succeededSkillIds.push(def.id);
    } else {
      failed++;
    }
  }

  if (!dryRun) {
    console.log(`\nRegistration complete: ${succeeded} succeeded, ${failed} failed`);
  }

  if (!skipDefaultAgent && succeededSkillIds.length > 0) {
    console.log("\nAttaching registered skills to default agent…");
    await attachSkillsToDefaultAgent(config, succeededSkillIds, defaultAgentId, dryRun);
  } else if (!skipDefaultAgent && succeededSkillIds.length === 0 && !dryRun) {
    console.log("\nSkipping default-agent attachment (no skills registered successfully).");
  }
}

/** Register tools, then workflows, then skills (skills attach `tool_ids` for tools POSTed in step 1). */
async function cmdAllRegister(argv) {
  console.log("=== 1/3 tools register ===\n");
  await cmdToolsRegister(argv);
  console.log("\n=== 2/3 workflows register ===\n");
  await cmdWorkflowsRegister(argv);
  console.log("\n=== 3/3 skills register (+ default agent) ===\n");
  await cmdSkillsRegister(argv);
  console.log("\n=== all register complete ===");
}

function printUsage() {
  console.log(`
Kibana Agent Builder (anomaly-detection)

Commands:
  test                  GET /api/status — verify URL and credentials
  tools register        POST all ES|QL tools to Agent Builder
  workflows register    POST all YAML workflow definitions to Kibana Workflows engine
  skills register       POST hub + skills/; PUT default agent configuration (skill_ids merge, enable_elastic_capabilities, workflow_ids)
  all register          Run tools register, workflows register, skills register (+ default agent)
  jobs create-service-health   Create baseline service issue-detection ML jobs + datafeeds

Options (workflows/tools/skills/all register):
  --dry-run          Print JSON payloads only
  --skip-default-agent   Do not PUT skill_ids on the default Elastic AI Agent
  --default-agent-id ID  Agent id to update (default: from agent_builder_constants.json, usually elastic-ai-agent)
  --kibana-url URL
  --username USER
  --password PASS
  --api-key KEY
  --space-id ID
  --insecure         Skip TLS verification (also KIBANA_INSECURE=true)

Options (jobs create-service-health):
  --prefix ID            Job ID prefix (default: svc)
  --metrics-index PAT    Metrics index pattern (default: metrics-*)
  --logs-index PAT       Logs index pattern (default: logs-*)
  --apm-index PAT        APM index pattern (default: apm-*)
  --bucket-span SPAN     Bucket span (default: 15m)
  --query-delay DELAY    Datafeed query_delay (default: 120s)
  --memory-limit SIZE    model_memory_limit (default: 256mb)

Environment variables match kibana-dashboards.js — see script header.
`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || ["-h", "--help", "help"].includes(argv[0])) {
    printUsage();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const [cmd, sub] = argv;
  if (cmd === "test") {
    await cmdTest(getKibanaConfig({}));
    return;
  }
  if (cmd === "tools" && sub === "register") {
    await cmdToolsRegister(argv.slice(2));
    return;
  }
  if (cmd === "workflows" && sub === "register") {
    await cmdWorkflowsRegister(argv.slice(2));
    return;
  }
  if (cmd === "skills" && sub === "register") {
    await cmdSkillsRegister(argv.slice(2));
    return;
  }
  if (cmd === "all" && sub === "register") {
    await cmdAllRegister(argv.slice(2));
    return;
  }
  if (cmd === "jobs" && sub === "create-service-health") {
    await cmdJobsCreateServiceHealth(argv.slice(2));
    return;
  }

  console.error(`Unknown command: ${cmd}${sub ? ` ${sub}` : ""}`);
  printUsage();
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
