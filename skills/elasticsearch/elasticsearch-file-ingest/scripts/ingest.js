#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import transformer from "node-es-transformer";
import { Client } from "@elastic/elasticsearch";

const args = process.argv.slice(2);

function showUsage() {
  console.log("Usage: ingest.js <command> [options]");
  console.log("\nCommands:");
  console.log("  test                     Test Elasticsearch connection");
  console.log("  ingest [options]         Ingest data into Elasticsearch");
  console.log("  help                     Show this help message");
  console.log("\nRequired (ingest):");
  console.log("  --target <index>         Target index name");
  console.log("\nSource (choose one):");
  console.log("  --file <path>            Source file (supports wildcards, e.g., logs/*.json)");
  console.log("  --stdin                  Read NDJSON/CSV from stdin");
  console.log("\nElasticsearch Connection (environment variables only):");
  console.log("  ELASTICSEARCH_API_KEY, ELASTICSEARCH_USERNAME, ELASTICSEARCH_PASSWORD");
  console.log("  ELASTICSEARCH_CLOUD_ID, ELASTICSEARCH_URL, ELASTICSEARCH_INSECURE");
  console.log("\nIndex Configuration:");
  console.log("  --mappings <file.json>   Mappings file");
  console.log("  --infer-mappings         Infer mappings/pipeline from file/stream");
  console.log("  --infer-mappings-options <file>  Options for inference (JSON file)");
  console.log("  --delete-index           Delete target index if exists");
  console.log("  --pipeline <name>        Ingest pipeline name");
  console.log("\nProcessing:");
  console.log("  --transform <file.js>    Transform function (export as default or module.exports)");
  console.log("  --source-format <fmt>    Source format: ndjson|csv|parquet|arrow (default: ndjson)");
  console.log("  --csv-options <file>     CSV parser options (JSON file)");
  console.log("  --skip-header            Skip first line (e.g., CSV header)");
  console.log("\nPerformance:");
  console.log("  --buffer-size <kb>       Buffer size in KB (default: 5120)");
  console.log("  --total-docs <n>         Total docs for progress bar (file/stream)");
  console.log("  --stall-warn-seconds <n> Stall warning threshold (default: 30)");
  console.log("  --progress-mode <mode>   Progress output: auto|line|newline (default: auto)");
  console.log("  --debug-events           Log pause/resume/stall events");
  console.log("  --quiet                  Disable progress bars");
  console.log("\nExamples:");
  console.log("  # Test connection");
  console.log("  ingest.js test");
  console.log("");
  console.log("  # Ingest a JSON file");
  console.log("  ingest.js ingest --file data.json --target my-index");
  console.log("");
  console.log("  # Ingest with custom mappings");
  console.log("  ingest.js ingest --file data.json --target my-index --mappings mappings.json");
  console.log("");
  console.log("  # Ingest with transformation");
  console.log("  ingest.js ingest --file data.json --target my-index --transform transform.js");
  process.exit(1);
}

function getDefaultClientConfig() {
  const cloudId = process.env.ELASTICSEARCH_CLOUD_ID;
  const apiKey = process.env.ELASTICSEARCH_API_KEY;
  const url = process.env.ELASTICSEARCH_URL;
  const username = process.env.ELASTICSEARCH_USERNAME;
  const password = process.env.ELASTICSEARCH_PASSWORD;
  const insecure = process.env.ELASTICSEARCH_INSECURE === "true";

  const config = {};

  if (cloudId) {
    config.cloud = { id: cloudId };
  } else if (url) {
    config.node = url;
  } else {
    config.node = "http://localhost:9200";
  }

  if (apiKey) {
    config.auth = { apiKey };
  } else if (username && password) {
    config.auth = { username, password };
  }

  if (insecure) {
    config.tls = { rejectUnauthorized: false };
  }

  config.headers = { "User-Agent": "elastic-agentic" };

  return config;
}

function parseArgs(args) {
  const options = {
    sourceClientConfig: getDefaultClientConfig(),
    targetClientConfig: null,
    verbose: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--file":
        if (!next) showUsage();
        options.fileName = next;
        i++;
        break;

      case "--stdin":
        options.stream = process.stdin;
        break;

      case "--target":
        if (!next) showUsage();
        options.targetIndexName = next;
        i++;
        break;

      case "--mappings":
        if (!next) showUsage();
        try {
          const content = fs.readFileSync(next, "utf8");
          options.mappings = JSON.parse(content);
        } catch (err) {
          console.error(`Error reading mappings file ${next}:`, err.message);
          process.exit(1);
        }
        i++;
        break;

      case "--infer-mappings":
        options.inferMappings = true;
        break;

      case "--infer-mappings-options":
        if (!next) showUsage();
        try {
          const content = fs.readFileSync(next, "utf8");
          options.inferMappingsOptions = JSON.parse(content);
        } catch (err) {
          console.error(`Error reading infer mappings options file ${next}:`, err.message);
          process.exit(1);
        }
        i++;
        break;

      case "--delete-index":
        options.deleteIndex = true;
        break;

      case "--pipeline":
        if (!next) showUsage();
        options.pipeline = next;
        i++;
        break;

      case "--transform":
        if (!next) showUsage();
        try {
          const transformPath = path.resolve(process.cwd(), next);
          // Dynamic import for ES modules
          import(transformPath)
            .then((mod) => {
              options.transform = mod.default || mod;
            })
            .catch((err) => {
              // Fallback to require for CommonJS
              try {
                options.transform = require(transformPath);
              } catch (requireErr) {
                console.error(`Error loading transform file ${next}:`, err.message);
                process.exit(1);
              }
            });
        } catch (err) {
          console.error(`Error loading transform file ${next}:`, err.message);
          process.exit(1);
        }
        i++;
        break;

      case "--source-format":
        if (!next) showUsage();
        options.sourceFormat = next;
        i++;
        break;

      case "--csv-options":
        if (!next) showUsage();
        try {
          const content = fs.readFileSync(next, "utf8");
          options.csvOptions = JSON.parse(content);
        } catch (err) {
          console.error(`Error reading CSV options file ${next}:`, err.message);
          process.exit(1);
        }
        i++;
        break;

      case "--skip-header":
        options.skipHeader = true;
        break;

      case "--buffer-size":
        if (!next) showUsage();
        options.bufferSize = parseInt(next, 10);
        i++;
        break;

      case "--total-docs":
        if (!next) showUsage();
        options.totalDocs = parseInt(next, 10);
        i++;
        break;

      case "--stall-warn-seconds":
        if (!next) showUsage();
        options.stallWarnSeconds = parseInt(next, 10);
        i++;
        break;

      case "--progress-mode":
        if (!next) showUsage();
        options.progressMode = next;
        i++;
        break;

      case "--debug-events":
        options.debugEvents = true;
        break;

      case "--quiet":
        options.verbose = false;
        break;

      case "--help":
      case "-h":
        showUsage();
        break;

      default:
        console.error(`Unknown option: ${arg}\n`);
        showUsage();
    }
  }

  // Auto-detect source format from file extension when not explicitly set
  if (!options.sourceFormat && options.fileName) {
    const ext = path.extname(options.fileName).toLowerCase();
    const formatMap = {
      ".csv": "csv",
      ".json": "ndjson",
      ".ndjson": "ndjson",
      ".parquet": "parquet",
      ".arrow": "arrow",
    };
    if (formatMap[ext]) {
      options.sourceFormat = formatMap[ext];
    }
  }

  // Validation
  if (!options.targetIndexName) {
    console.error("Error: --target is required\n");
    showUsage();
  }

  if (!options.fileName && !options.stream) {
    console.error("Error: Either --file or --stdin is required\n");
    showUsage();
  }

  if (options.fileName && options.stream) {
    console.error("Error: Only one of --file or --stdin can be used\n");
    showUsage();
  }

  return options;
}

async function testConnection(clientConfig) {
  const client = new Client(clientConfig);
  try {
    const info = await client.info();
    return {
      success: true,
      cluster: info.cluster_name,
      version: info.version.number,
      node: clientConfig.node || clientConfig.cloud?.id || "cloud",
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      node: clientConfig.node || clientConfig.cloud?.id || "cloud",
    };
  }
}

function printConnectionHelp() {
  console.error("");
  console.error("Set one of these environment variable combinations:");
  console.error("  1. Elastic Cloud: ELASTICSEARCH_CLOUD_ID + ELASTICSEARCH_API_KEY");
  console.error("  2. Direct URL + API Key: ELASTICSEARCH_URL + ELASTICSEARCH_API_KEY");
  console.error("  3. Basic Auth: ELASTICSEARCH_URL + ELASTICSEARCH_USERNAME + ELASTICSEARCH_PASSWORD");
  console.error("");
  console.error("For self-signed certs: set ELASTICSEARCH_INSECURE=true");
  console.error("");
  console.error("For local development, see:");
  console.error("  https://www.elastic.co/guide/en/elasticsearch/reference/current/run-elasticsearch-locally.html");
  console.error("");
  console.error("Then re-run: node scripts/ingest.js test");
}

async function runTest(clientConfig) {
  console.log("=== Testing Elasticsearch Connection ===\n");
  const connTest = await testConnection(clientConfig);

  if (!connTest.success) {
    console.error(`✗ Connection failed to ${connTest.node}`);
    console.error(`  Error: ${connTest.error}`);
    printConnectionHelp();
    process.exit(1);
  }

  console.log("✓ Connected successfully!");
  console.log(`  Cluster: ${connTest.cluster}`);
  console.log(`  Version: ${connTest.version}`);
  console.log(`  Node:    ${connTest.node}`);

  // Test bulk indexing capability with a dummy check
  const client = new Client(clientConfig);
  try {
    const health = await client.cluster.health();
    console.log(`  Status:  ${health.status}`);
    console.log(`  Nodes:   ${health.number_of_nodes}`);
  } catch {
    // cluster.health may fail with limited permissions — not critical
  } finally {
    await client.close();
  }

  console.log("\n✓ Ready for ingestion");
}

async function main() {
  if (args.length === 0 || args.includes("--help") || args.includes("-h") || args[0] === "help") {
    showUsage();
  }

  // Handle "test" subcommand before parsing ingest options
  if (args[0] === "test") {
    await runTest(getDefaultClientConfig());
    return;
  }

  // Require "ingest" subcommand
  if (args[0] !== "ingest") {
    console.error(`Unknown command: ${args[0]}\n`);
    showUsage();
  }

  const options = parseArgs(args.slice(1));

  // Test connection before starting ingestion
  console.log("Testing Elasticsearch connection...");
  const connTest = await testConnection(options.sourceClientConfig);

  if (!connTest.success) {
    console.error(`\n✗ Connection failed to ${connTest.node}`);
    console.error(`  Error: ${connTest.error}`);
    printConnectionHelp();
    process.exit(1);
  }

  console.log(`✓ Connected to ${connTest.cluster} (ES ${connTest.version})\n`);

  try {
    console.log("Starting ingestion...");
    console.log(`Target index: ${options.targetIndexName}`);

    if (options.fileName) {
      console.log(`Source: File ${options.fileName}`);
    } else {
      console.log(`Source: stdin`);
    }

    const result = await transformer(options);

    const enableProgress = options.verbose !== false && Boolean(options.fileName || options.stream);
    const envTotal = Number.parseInt(process.env.ES_TRANSFORMER_TOTAL_DOCS || "", 10);
    const totalDocs = Number.isFinite(options.totalDocs)
      ? options.totalDocs
      : Number.isFinite(envTotal)
        ? envTotal
        : null;

    let processed = 0;
    let lastRate = 0;
    let paused = false;
    let pauseStartedAt = null;
    let lastProgressAt = Date.now();
    let stallLogged = false;
    const startTime = Date.now();
    const debugEvents = options.debugEvents || process.env.ES_TRANSFORMER_DEBUG_EVENTS === "1";
    const progressMode = options.progressMode || process.env.ES_TRANSFORMER_PROGRESS_MODE || "auto";
    const stallWarnSeconds = Number.isFinite(options.stallWarnSeconds)
      ? options.stallWarnSeconds
      : Number.parseInt(process.env.ES_TRANSFORMER_STALL_WARN_SECONDS || "30", 10);

    function formatNumber(value) {
      return new Intl.NumberFormat("en-US").format(value);
    }

    const progressStream = process.stdout.isTTY ? process.stdout : process.stderr;
    const autoLineMode =
      progressMode === "auto" && (progressStream.isTTY || (process.env.TERM && process.env.TERM !== "dumb"));
    const lineMode = progressMode === "line" || autoLineMode;
    let lastLineLength = 0;

    function writeProgressLine(line) {
      if (lineMode) {
        if (progressStream.isTTY) {
          progressStream.clearLine(0);
          progressStream.cursorTo(0);
          progressStream.write(line);
        } else {
          const pad = Math.max(0, lastLineLength - line.length);
          progressStream.write(`\r${line}${" ".repeat(pad)}`);
        }
        lastLineLength = Math.max(lastLineLength, line.length);
        return;
      }
      progressStream.write(`${line}\n`);
    }

    function renderProgress(final = false) {
      const elapsedSeconds = Math.max((Date.now() - startTime) / 1000, 1);
      const avgRate = processed / elapsedSeconds;
      const processedStr = formatNumber(processed);
      const totalStr = totalDocs ? formatNumber(totalDocs) : null;
      const pct = totalDocs && totalDocs > 0 ? Math.min(processed / totalDocs, 1) * 100 : null;
      const statusStr =
        paused && pauseStartedAt ? ` | paused ${Math.round((Date.now() - pauseStartedAt) / 1000)}s` : "";

      const columns = progressStream.isTTY ? progressStream.columns : null;

      let rateStr = `${lastRate.toFixed(1)} docs/s`;
      let avgStr = `avg ${avgRate.toFixed(1)} docs/s`;
      let barWidth = 30;
      let includeAvg = true;
      let includeBar = Boolean(totalDocs && totalDocs > 0);

      function buildLine() {
        if (includeBar && pct !== null) {
          const filled = Math.round((pct / 100) * barWidth);
          const bar = `${"#".repeat(filled)}${" ".repeat(barWidth - filled)}`;
          const base = `[${bar}] ${processedStr}/${totalStr} (${pct.toFixed(1)}%)`;
          const rates = includeAvg ? ` | ${rateStr} (${avgStr})` : ` | ${rateStr}`;
          return `${base}${rates}${statusStr}`;
        }
        const rates = includeAvg ? ` | ${rateStr} (${avgStr})` : ` | ${rateStr}`;
        return `${processedStr} docs${rates}${statusStr}`;
      }

      let line = buildLine();

      if (columns && line.length > columns) {
        while (includeBar && barWidth > 10 && line.length > columns) {
          barWidth -= 5;
          line = buildLine();
        }
      }

      if (columns && line.length > columns && includeAvg) {
        includeAvg = false;
        line = buildLine();
      }

      if (columns && line.length > columns) {
        rateStr = `${lastRate.toFixed(0)}/s`;
        avgStr = `avg ${avgRate.toFixed(0)}/s`;
        line = buildLine();
      }

      if (columns && line.length > columns && includeBar) {
        includeBar = false;
        line = buildLine();
      }

      if (columns && line.length > columns && pct !== null) {
        line = `${processedStr}/${totalStr} ${pct.toFixed(1)}%${statusStr}`;
      }

      writeProgressLine(line);

      if (final && lineMode) {
        progressStream.write("\n");
      }
    }

    let stallTimer = null;

    if (enableProgress) {
      result.events.on("docsPerSecond", (dps) => {
        processed += dps;
        lastRate = dps;
        if (dps > 0) {
          lastProgressAt = Date.now();
          stallLogged = false;
        }
        renderProgress();
      });

      result.events.on("pause", () => {
        paused = true;
        pauseStartedAt = Date.now();
        if (debugEvents) {
          progressStream.write(`\n[event] pause at ${new Date().toISOString()}\n`);
        }
        renderProgress();
      });

      result.events.on("resume", () => {
        paused = false;
        pauseStartedAt = null;
        if (debugEvents) {
          progressStream.write(`\n[event] resume at ${new Date().toISOString()}\n`);
        }
        renderProgress();
      });

      stallTimer = setInterval(() => {
        if (!enableProgress) return;
        if (paused) return;
        const since = (Date.now() - lastProgressAt) / 1000;
        if (since >= stallWarnSeconds && !stallLogged) {
          stallLogged = true;
          const msg = `\n⚠️  No docs indexed for ${Math.round(since)}s. Check ES cluster health or bulk errors.\n`;
          progressStream.write(msg);
          if (debugEvents) {
            progressStream.write(
              `[event] stall detected at ${new Date().toISOString()} (since ${Math.round(since)}s)\n`,
            );
          }
        }
      }, 1000);
    }

    result.events.on("finish", () => {
      if (stallTimer) clearInterval(stallTimer);
      if (enableProgress) {
        renderProgress(true);
      }
      if (debugEvents) {
        progressStream.write(`[event] finish at ${new Date().toISOString()}\n`);
      }
      console.log("✓ Ingestion complete!");
    });
  } catch (err) {
    console.error("✗ Error:", err.message);
    process.exit(1);
  }
}

main();
