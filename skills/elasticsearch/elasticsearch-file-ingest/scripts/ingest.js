#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import transformer from "node-es-transformer";
import { Client } from "@elastic/elasticsearch";

const args = process.argv.slice(2);

function showUsage() {
  console.log("Usage: ingest.js [options]");
  console.log("\nRequired:");
  console.log("  --target <index>         Target index name");
  console.log("\nSource (choose one):");
  console.log("  --file <path>            Source file (supports wildcards, e.g., logs/*.json)");
  console.log("  --source-index <name>    Source Elasticsearch index");
  console.log("  --stdin                  Read NDJSON/CSV from stdin");
  console.log("\nElasticsearch Connection:");
  console.log("  --node <url>             Elasticsearch node URL (default: http://localhost:9200)");
  console.log("  --api-key <key>          API key authentication");
  console.log("  --username <user>        Basic auth username");
  console.log("  --password <pass>        Basic auth password");
  console.log("\nTarget Connection (for cross-cluster reindexing):");
  console.log("  --target-node <url>      Target ES node URL (uses --node if not specified)");
  console.log("  --target-api-key <key>   Target API key");
  console.log("  --target-username <user> Target username");
  console.log("  --target-password <pass> Target password");
  console.log("\nIndex Configuration:");
  console.log("  --mappings <file.json>   Mappings file (auto-copy from source if reindexing)");
  console.log("  --infer-mappings         Infer mappings/pipeline from file/stream");
  console.log("  --infer-mappings-options <file>  Options for inference (JSON file)");
  console.log("  --delete-index           Delete target index if exists");
  console.log("  --pipeline <name>        Ingest pipeline name");
  console.log("\nProcessing:");
  console.log("  --transform <file.js>    Transform function (export as default or module.exports)");
  console.log("  --query <file.json>      Query file to filter source documents");
  console.log("  --source-format <fmt>    Source format: ndjson|csv|parquet|arrow (default: ndjson)");
  console.log("  --csv-options <file>     CSV parser options (JSON file)");
  console.log("  --skip-header            Skip first line (e.g., CSV header)");
  console.log("\nPerformance:");
  console.log("  --buffer-size <kb>       Buffer size in KB (default: 5120)");
  console.log("  --search-size <n>        Docs per search when reindexing (default: 100)");
  console.log("  --total-docs <n>         Total docs for progress bar (file/stream)");
  console.log("  --stall-warn-seconds <n> Stall warning threshold (default: 30)");
  console.log("  --progress-mode <mode>   Progress output: auto|line|newline (default: auto)");
  console.log("  --debug-events           Log pause/resume/stall events");
  console.log("  --quiet                  Disable progress bars");
  console.log("\nExamples:");
  console.log("  # Ingest a JSON file");
  console.log("  ingest.js --file data.json --target my-index");
  console.log("");
  console.log("  # Ingest with custom mappings");
  console.log("  ingest.js --file data.json --target my-index --mappings mappings.json");
  console.log("");
  console.log("  # Ingest with transformation");
  console.log("  ingest.js --file data.json --target my-index --transform transform.js");
  console.log("");
  console.log("  # Reindex from another index");
  console.log("  ingest.js --source-index old-index --target new-index");
  console.log("");
  console.log("  # Cross-cluster reindex (ES 8.x → 9.x)");
  console.log("  ingest.js --source-index logs \\");
  console.log("    --node https://es8.example.com:9200 --api-key es8-key \\");
  console.log("    --target new-logs \\");
  console.log("    --target-node https://es9.example.com:9200 --target-api-key es9-key");
  console.log("");
  console.log("  # Ingest with query filter");
  console.log("  ingest.js --source-index logs --target filtered-logs --query filter.json");
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

      case "--source-index":
        if (!next) showUsage();
        options.sourceIndexName = next;
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

      case "--node":
        if (!next) showUsage();
        options.sourceClientConfig.node = next;
        i++;
        break;

      case "--api-key":
        if (!next) showUsage();
        options.sourceClientConfig.auth = { apiKey: next };
        i++;
        break;

      case "--username":
        if (!next) showUsage();
        if (!options.sourceClientConfig.auth) options.sourceClientConfig.auth = {};
        options.sourceClientConfig.auth.username = next;
        i++;
        break;

      case "--password":
        if (!next) showUsage();
        if (!options.sourceClientConfig.auth) options.sourceClientConfig.auth = {};
        options.sourceClientConfig.auth.password = next;
        i++;
        break;

      case "--target-node":
        if (!next) showUsage();
        if (!options.targetClientConfig) options.targetClientConfig = {};
        options.targetClientConfig.node = next;
        i++;
        break;

      case "--target-api-key":
        if (!next) showUsage();
        if (!options.targetClientConfig) options.targetClientConfig = {};
        options.targetClientConfig.auth = { apiKey: next };
        i++;
        break;

      case "--target-username":
        if (!next) showUsage();
        if (!options.targetClientConfig) options.targetClientConfig = {};
        if (!options.targetClientConfig.auth) options.targetClientConfig.auth = {};
        options.targetClientConfig.auth.username = next;
        i++;
        break;

      case "--target-password":
        if (!next) showUsage();
        if (!options.targetClientConfig) options.targetClientConfig = {};
        if (!options.targetClientConfig.auth) options.targetClientConfig.auth = {};
        options.targetClientConfig.auth.password = next;
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

      case "--query":
        if (!next) showUsage();
        try {
          const content = fs.readFileSync(next, "utf8");
          options.query = JSON.parse(content);
        } catch (err) {
          console.error(`Error reading query file ${next}:`, err.message);
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

      case "--search-size":
        if (!next) showUsage();
        options.searchSize = parseInt(next, 10);
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

  // Validation
  if (!options.targetIndexName) {
    console.error("Error: --target is required\n");
    showUsage();
  }

  if (!options.fileName && !options.sourceIndexName && !options.stream) {
    console.error("Error: Either --file, --source-index, or --stdin is required\n");
    showUsage();
  }

  const sources = [options.fileName, options.sourceIndexName, options.stream].filter(Boolean);
  if (sources.length > 1) {
    console.error("Error: Only one of --file, --source-index, or --stdin can be used\n");
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

async function main() {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    showUsage();
  }

  const options = parseArgs(args);

  // Test connection before starting ingestion
  console.log("Testing Elasticsearch connection...");
  const connTest = await testConnection(options.sourceClientConfig);

  if (!connTest.success) {
    console.error(`\n✗ Connection failed to ${connTest.node}`);
    console.error(`  Error: ${connTest.error}`);
    console.error("");
    console.error("Set one of these environment variable combinations:");
    console.error("  1. Elastic Cloud: ELASTICSEARCH_CLOUD_ID + ELASTICSEARCH_API_KEY");
    console.error("  2. Direct URL + API Key: ELASTICSEARCH_URL + ELASTICSEARCH_API_KEY");
    console.error("  3. Basic Auth: ELASTICSEARCH_URL + ELASTICSEARCH_USERNAME + ELASTICSEARCH_PASSWORD");
    console.error("");
    console.error("Or use CLI flags: --node, --api-key, --username, --password");
    console.error("For self-signed certs: set ELASTICSEARCH_INSECURE=true");
    console.error("");
    console.error("For local development, use start-local to run Elasticsearch via Docker:");
    console.error("  https://github.com/elastic/start-local");
    console.error("");
    console.error("  curl -fsSL https://elastic.co/start-local | sh");
    console.error("");
    console.error("Then configure the environment:");
    console.error("  source elastic-start-local/.env");
    console.error('  export ELASTICSEARCH_URL="$ES_LOCAL_URL"');
    console.error('  export ELASTICSEARCH_API_KEY="$ES_LOCAL_API_KEY"');
    process.exit(1);
  }

  console.log(`✓ Connected to ${connTest.cluster} (ES ${connTest.version})\n`);

  // Test target connection if different from source
  if (options.targetClientConfig) {
    console.log("Testing target Elasticsearch connection...");
    const targetTest = await testConnection(options.targetClientConfig);

    if (!targetTest.success) {
      console.error(`\n✗ Target connection failed to ${targetTest.node}`);
      console.error(`  Error: ${targetTest.error}`);
      process.exit(1);
    }

    console.log(`✓ Connected to target ${targetTest.cluster} (ES ${targetTest.version})\n`);
  }

  try {
    console.log("Starting ingestion...");
    console.log(`Target index: ${options.targetIndexName}`);

    if (options.fileName) {
      console.log(`Source: File ${options.fileName}`);
    } else {
      console.log(`Source: Index ${options.sourceIndexName}`);
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
