#!/usr/bin/env node
/**
 * Run arbitrary queries against Elasticsearch.
 * Supports both KQL (Kibana Query Language) and ES|QL queries.
 */

import { readFileSync } from "fs";
import { createClient } from "./es-client.js";

function parseArgs(argv) {
  const args = {
    query: null,
    queryFile: null,
    type: "kql",
    index: "logs-*",
    size: 100,
    days: null,
    json: false,
    full: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--query-file" || a === "-q") args.queryFile = argv[++i] ?? null;
    else if (a === "--type" || a === "-t") args.type = argv[++i] ?? "kql";
    else if (a === "--index" || a === "-i") args.index = argv[++i] ?? "logs-*";
    else if (a === "--size" || a === "-s") args.size = parseInt(argv[++i], 10) || 100;
    else if (a === "--days" || a === "-d") args.days = argv[++i] ? parseInt(argv[i], 10) : null;
    else if (a === "--json" || a === "-j") args.json = true;
    else if (a === "--full") args.full = true;
    else if (!a.startsWith("-")) positional.push(a);
  }
  args.query = positional[0] ?? null;
  return args;
}

async function runKqlQuery(client, index, kqlQuery, opts = {}) {
  const {
    timeField = "@timestamp",
    startTime = null,
    endTime = null,
    size = 100,
    sortField = null,
    sortOrder = "desc",
  } = opts;

  const queryBody = {
    bool: {
      must: [{ query_string: { query: kqlQuery, analyze_wildcard: true } }],
    },
  };

  if (startTime || endTime) {
    const timeRange = {};
    if (startTime) timeRange.gte = startTime.toISOString();
    if (endTime) timeRange.lte = endTime.toISOString();
    queryBody.bool.must.push({ range: { [timeField]: timeRange } });
  }

  const sortBy = sortField ?? timeField;
  const sort = [{ [sortBy]: { order: sortOrder } }];

  return client.search({ index, query: queryBody, sort, size });
}

async function runEsqlQuery(client, esqlQuery) {
  return client.esql.query({ query: esqlQuery, format: "json" });
}

function formatKqlResults(response, showSource = false) {
  const hits = response.hits?.hits ?? [];
  const total = response.hits?.total;
  const totalCount = typeof total === "object" ? (total?.value ?? 0) : (total ?? 0);
  const relation = typeof total === "object" ? (total?.relation ?? "eq") : "eq";
  const took = response.took ?? 0;

  const output = [
    `Query took: ${took}ms`,
    `Total hits: ${totalCount} (${relation})`,
    `Returned: ${hits.length} documents`,
    "-".repeat(80),
  ];

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    output.push(`\n--- Document ${i + 1} ---`);
    output.push(`Index: ${hit._index}`);
    output.push(`ID: ${hit._id}`);
    if (showSource) {
      output.push("Source:");
      output.push(JSON.stringify(hit._source, null, 2));
    } else {
      const source = hit._source ?? {};
      output.push(`Timestamp: ${source["@timestamp"] ?? "N/A"}`);
      if (source.message) {
        let msg = source.message;
        if (msg.length > 200) msg = msg.slice(0, 200) + "...";
        output.push(`Message: ${msg}`);
      }
      if (source.event) {
        output.push(`Event: ${JSON.stringify(source.event)}`);
      }
    }
  }
  return output.join("\n");
}

function formatEsqlResults(response) {
  const columns = response.columns ?? [];
  const values = response.values ?? [];
  const colNames = columns.map((col) => col.name);
  const output = [
    `Columns: ${columns.length}`,
    `Rows: ${values.length}`,
    "-".repeat(80),
    colNames.join(" | "),
    "-".repeat(80),
  ];
  for (const row of values) {
    const formatted = row.map((val) => {
      if (val === null || val === undefined) return "null";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    });
    output.push(formatted.join(" | "));
  }
  return output.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let query;
  if (args.queryFile) {
    query = readFileSync(args.queryFile, "utf8").trim();
  } else if (args.query) {
    query = args.query;
  } else {
    console.error("Either provide a query as argument or use --query-file");
    process.exit(1);
  }

  const client = createClient();

  let startTime = null;
  let endTime = null;
  if (args.days) {
    endTime = new Date();
    startTime = new Date(endTime.getTime() - args.days * 24 * 60 * 60 * 1000);
  }

  try {
    if (args.type === "kql") {
      const response = await runKqlQuery(client, args.index, query, {
        startTime,
        endTime,
        size: args.size,
      });
      if (args.json) {
        console.log(JSON.stringify(response, null, 2));
      } else {
        console.log(formatKqlResults(response, args.full));
      }
    } else if (args.type === "esql") {
      const response = await runEsqlQuery(client, query);
      if (args.json) {
        console.log(JSON.stringify(response, null, 2));
      } else {
        console.log(formatEsqlResults(response));
      }
    } else {
      console.error(`Unknown query type: ${args.type}. Use kql or esql.`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Query failed: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
