#!/usr/bin/env node
/**
 * APM Correlations: attributes that correlate with high-latency or failed transactions.
 * Tries Kibana internal APM correlations API first; falls back to Elasticsearch significant_terms.
 *
 * Usage:
 *   node apm-correlations.js latency-correlations --service-name <name> [--start <iso>] [--end <iso>] [--transaction-type <t>] [--transaction-name <n>] [--space <id>] [--json]
 *   node apm-correlations.js failed-correlations --service-name <name> [--start <iso>] [--end <iso>] [--transaction-type <t>] [--transaction-name <n>] [--space <id>] [--json]
 *   node apm-correlations.js test [--space <id>]
 *
 * Environment:
 *   KIBANA_URL, KIBANA_API_KEY (or KIBANA_USERNAME + KIBANA_PASSWORD) for Kibana internal API.
 *   ELASTICSEARCH_URL, ELASTICSEARCH_API_KEY for fallback (or ELASTICSEARCH_CLOUD_ID + ELASTICSEARCH_API_KEY).
 */

import { kibanaFetch } from "./kibana-client.js";

const DEFAULT_LAST_MINUTES = 60;
const EVENT_OUTCOME = "event.outcome";
const FIELD_CANDIDATE_BATCH_SIZE = 10;

function chunkArray(items, chunkSize) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function parseArgs(argv) {
  const args = {
    serviceName: null,
    start: null,
    end: null,
    lastMinutes: null,
    transactionType: null,
    transactionName: null,
    environment: null,
    space: null,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--service-name" || a === "-s") args.serviceName = argv[++i] ?? null;
    else if (a === "--start") args.start = argv[++i] ?? null;
    else if (a === "--end") args.end = argv[++i] ?? null;
    else if (a === "--last-minutes") args.lastMinutes = parseInt(argv[++i], 10) || null;
    else if (a === "--transaction-type") args.transactionType = argv[++i] ?? null;
    else if (a === "--transaction-name") args.transactionName = argv[++i] ?? null;
    else if (a === "--environment") args.environment = argv[++i] ?? null;
    else if (a === "--space") args.space = argv[++i] ?? null;
    else if (a === "--json" || a === "-j") args.json = true;
  }
  return args;
}

function resolveTimeRange(args) {
  let start = args.start ? new Date(args.start) : null;
  let end = args.end ? new Date(args.end) : null;
  if (args.lastMinutes && !start && !end) {
    end = new Date();
    start = new Date(end.getTime() - args.lastMinutes * 60 * 1000);
  }
  if (!start) start = new Date(Date.now() - DEFAULT_LAST_MINUTES * 60 * 1000);
  if (!end) end = new Date();
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Fetch Kibana APM correlations using the 3-step correlations flow:
 *   1) field candidates
 *   2) field value pairs
 *   3) significant correlations
 */
async function fetchKibanaCorrelations(type, serviceName, timeRange, args) {
  const { start, end } = timeRange;
  const fetchParams = { serviceName, start, end, kuery: "", environment: args.environment || "ENVIRONMENT_ALL" };
  if (args.transactionType) fetchParams.transactionType = args.transactionType;
  if (args.transactionName) fetchParams.transactionName = args.transactionName;

  const fieldCandidatesResult = await kibanaFetch("/internal/apm/correlations/field_candidates/transactions", {
    method: "GET",
    params: fetchParams,
    space: args.space,
  });
  if (!fieldCandidatesResult.success) return fieldCandidatesResult;

  let fieldCandidates = Array.isArray(fieldCandidatesResult.data?.fieldCandidates)
    ? fieldCandidatesResult.data.fieldCandidates
    : [];
  if (type === "failed") {
    fieldCandidates = fieldCandidates.filter((field) => field !== EVENT_OUTCOME);
  }

  if (fieldCandidates.length === 0) {
    return {
      success: true,
      data: type === "latency" ? { latencyCorrelations: [] } : { failedTransactionsCorrelations: [] },
    };
  }

  if (type === "latency") {
    const fieldCandidateBatches = chunkArray(fieldCandidates, FIELD_CANDIDATE_BATCH_SIZE);
    const fieldValuePairsBatchResults = await Promise.all(
      fieldCandidateBatches.map((fieldCandidatesBatch) =>
        kibanaFetch("/internal/apm/correlations/field_value_pairs/transactions", {
          method: "POST",
          body: JSON.stringify({
            ...fetchParams,
            fieldCandidates: fieldCandidatesBatch,
          }),
          space: args.space,
        }),
      ),
    );
    const firstFieldValuePairsError = fieldValuePairsBatchResults.find((result) => !result.success);
    if (firstFieldValuePairsError) return firstFieldValuePairsError;

    const fieldValuePairs = fieldValuePairsBatchResults.flatMap((result) =>
      Array.isArray(result.data?.fieldValuePairs) ? result.data.fieldValuePairs : [],
    );
    if (fieldValuePairs.length === 0) {
      return {
        success: true,
        data: { latencyCorrelations: [] },
      };
    }

    const significantResult = await kibanaFetch("/internal/apm/correlations/significant_correlations/transactions", {
      method: "POST",
      body: JSON.stringify({
        ...fetchParams,
        fieldValuePairs,
      }),
      space: args.space,
    });
    if (!significantResult.success) return significantResult;

    const significantData = significantResult.data ?? {};
    return {
      success: true,
      data: {
        ccsWarning: significantData.ccsWarning,
        latencyCorrelations: Array.isArray(significantData.latencyCorrelations)
          ? significantData.latencyCorrelations.map((correlation) => ({
              fieldName: correlation.fieldName,
              fieldValue: correlation.fieldValue,
              correlation: correlation.correlation,
            }))
          : [],
      },
    };
  }

  const fieldCandidateBatches = chunkArray(fieldCandidates, FIELD_CANDIDATE_BATCH_SIZE);
  const pValuesBatchResults = await Promise.all(
    fieldCandidateBatches.map((fieldCandidatesBatch) =>
      kibanaFetch("/internal/apm/correlations/p_values/transactions", {
        method: "POST",
        body: JSON.stringify({
          ...fetchParams,
          fieldCandidates: fieldCandidatesBatch,
        }),
        space: args.space,
      }),
    ),
  );
  const firstPValuesError = pValuesBatchResults.find((result) => !result.success);
  if (firstPValuesError) return firstPValuesError;

  const failedTransactionsCorrelations = pValuesBatchResults.flatMap((result) =>
    Array.isArray(result.data?.failedTransactionsCorrelations) ? result.data.failedTransactionsCorrelations : [],
  );

  return {
    success: true,
    data: {
      ccsWarning: pValuesBatchResults.some((result) => result.data?.ccsWarning),
      failedTransactionsCorrelations: failedTransactionsCorrelations.map(({ histogram, ...correlation }) => ({
        fieldName: correlation.fieldName,
        fieldValue: correlation.fieldValue,
        correlation: correlation.normalizedScore,
      })),
    },
  };
}

/**
 * Elasticsearch fallback: significant_terms aggregation on traces*apm*,traces*otel* for attributes
 * over-represented in high-latency or failed transactions vs all transactions.
 */
async function fetchEsCorrelations(type, serviceName, timeRange, args) {
  const esUrl = process.env.ELASTICSEARCH_URL || process.env.ELASTICSEARCH_CLOUD_ID;
  const apiKey = process.env.ELASTICSEARCH_API_KEY;
  const username = process.env.ELASTICSEARCH_USERNAME;
  const password = process.env.ELASTICSEARCH_PASSWORD;
  if (!esUrl) {
    return { success: false, error: "ELASTICSEARCH_URL or ELASTICSEARCH_CLOUD_ID required for fallback" };
  }

  const baseFilter = [
    { term: { "service.name": serviceName } },
    { range: { "@timestamp": { gte: timeRange.start, lte: timeRange.end } } },
  ];
  if (args.transactionType) baseFilter.push({ term: { "transaction.type": args.transactionType } });
  if (args.transactionName) baseFilter.push({ term: { "transaction.name": args.transactionName } });

  const foregroundQuery =
    type === "latency"
      ? {
          bool: {
            filter: [...baseFilter, { range: { "transaction.duration.us": { gte: 500000 } } }],
          },
        }
      : {
          bool: {
            filter: [...baseFilter, { term: { "event.outcome": "failure" } }],
          },
        };

  const correlationFields = [
    "host.name",
    "service.version",
    "service.environment",
    "container.id",
    "kubernetes.pod.name",
    "cloud.availability_zone",
    "cloud.region",
  ];

  const aggs = {};
  for (const field of correlationFields) {
    aggs[`correlations_${field.replace(/\./g, "_")}`] = {
      significant_terms: {
        field: `${field}.keyword`,
        min_doc_count: 2,
        background_filter: { bool: { filter: baseFilter } },
        size: 10,
      },
    };
  }

  const body = {
    size: 0,
    query: foregroundQuery,
    aggs,
  };

  const node = esUrl.startsWith("http") ? esUrl : `https://${esUrl}`;
  const headers = { "Content-Type": "application/json", "User-Agent": "elastic-agentic" };
  if (apiKey) headers["Authorization"] = `ApiKey ${apiKey}`;
  else if (username && password) {
    headers["Authorization"] = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  }

  const res = await fetch(`${node}/traces*apm*,traces*otel*/_search`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    return { success: false, error: `Elasticsearch ${res.status}: ${text}` };
  }

  const data = await res.json();
  const bucketsByField = {};
  for (const [aggName, agg] of Object.entries(data.aggregations || {})) {
    if (agg.buckets && agg.buckets.length) {
      const field = aggName.replace("correlations_", "").replace(/_/g, ".");
      bucketsByField[field] = agg.buckets.map((b) => ({
        value: b.key,
        score: b.score,
        doc_count: b.doc_count,
        bg_count: b.bg_count,
      }));
    }
  }
  return {
    success: true,
    source: "elasticsearch",
    type,
    serviceName,
    timeRange: { start: timeRange.start, end: timeRange.end },
    attributes: bucketsByField,
  };
}

async function runLatencyCorrelations(args) {
  const timeRange = resolveTimeRange(args);
  let result = await fetchKibanaCorrelations("latency", args.serviceName, timeRange, args);
  if (!result.success && (result.status === 404 || result.error?.includes("404"))) {
    result = await fetchEsCorrelations("latency", args.serviceName, timeRange, args);
  }
  return result;
}

async function runFailedCorrelations(args) {
  const timeRange = resolveTimeRange(args);
  let result = await fetchKibanaCorrelations("failed", args.serviceName, timeRange, args);
  if (!result.success && (result.status === 404 || result.error?.includes("404"))) {
    result = await fetchEsCorrelations("failed", args.serviceName, timeRange, args);
  }
  return result;
}

function printResult(result, json) {
  if (json) {
    const out = result.success ? (result.data ?? result) : { success: false, error: result.error };
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (!result.success) {
    console.error("Error:", result.error);
    if (result.details) console.error(result.details);
    return;
  }
  const data = result.data ?? result;
  if (data.attributes) {
    console.log("Correlated attributes (over-represented in high-latency or failed transactions):\n");
    for (const [field, buckets] of Object.entries(data.attributes)) {
      if (buckets.length) {
        console.log(`  ${field}:`);
        for (const b of buckets) {
          console.log(`    - ${b.value} (score: ${b.score?.toFixed(4) ?? "N/A"}, count: ${b.doc_count})`);
        }
        console.log("");
      }
    }
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function main() {
  const cmd = process.argv[2];
  const args = parseArgs(process.argv.slice(3));

  if (cmd === "test") {
    const r = await kibanaFetch("/api/status", { method: "GET", space: args.space });
    if (r.success) {
      console.log("Kibana:", r.data?.version?.number ?? "OK");
    } else {
      console.error("Kibana:", r.error);
    }
    return;
  }

  if (cmd !== "latency-correlations" && cmd !== "failed-correlations") {
    console.error(`Usage: ${process.argv[1]} <latency-correlations|failed-correlations|test> [options]`);
    console.error("  --service-name <name>   Service name (required for correlations)");
    console.error("  --start <iso>           Start time");
    console.error("  --end <iso>             End time");
    console.error("  --last-minutes <n>      Last N minutes (default 60)");
    console.error("  --transaction-type      Optional transaction type");
    console.error("  --transaction-name      Optional transaction name");
    console.error("  --environment           Optional environment");
    console.error("  --space <id>            Kibana space");
    console.error("  --json                  JSON output");
    process.exit(1);
  }

  if (!args.serviceName) {
    console.error("Error: --service-name is required");
    process.exit(1);
  }

  let result;
  if (cmd === "latency-correlations") {
    result = await runLatencyCorrelations(args);
  } else {
    result = await runFailedCorrelations(args);
  }

  printResult(result, args.json);
  if (!result.success) process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
