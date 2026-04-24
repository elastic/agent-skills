#!/usr/bin/env node
/**
 * Acknowledge Elastic Security alerts by updating workflow status.
 *
 * Uses the Kibana Detection Engine API (POST /api/detection_engine/signals/status)
 * instead of direct Elasticsearch updates, which is required for Serverless
 * deployments where direct writes to data streams are rejected.
 *
 * Supports:
 * - Single alert acknowledgment by ID
 * - Bulk acknowledgment of related alerts (same agent + time window)
 * - Bulk acknowledgment by query (agent, time range, rule)
 */

import { createClient } from "./es-client.js";
import { kibanaPost } from "./kibana-client.js";
import { createInterface } from "readline";

function promptConfirm(message) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function parseArgs(argv) {
  const args = {
    related: false,
    query: false,
    alertId: null,
    index: ".alerts-security.alerts-*",
    agent: null,
    host: null,
    timestamp: null,
    window: 60,
    timeStart: null,
    timeEnd: null,
    rule: null,
    dryRun: false,
    yes: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--related" || a === "-r") args.related = true;
    else if (a === "--query" || a === "-q") args.query = true;
    else if (a === "--index" || a === "-i") args.index = argv[++i] ?? args.index;
    else if (a === "--agent" || a === "-a") args.agent = argv[++i] ?? null;
    else if (a === "--host" || a === "-h") args.host = argv[++i] ?? null;
    else if (a === "--timestamp" || a === "-t") args.timestamp = argv[++i] ?? null;
    else if (a === "--window" || a === "-w") args.window = parseInt(argv[++i], 10) || 60;
    else if (a === "--time-start") args.timeStart = argv[++i] ?? null;
    else if (a === "--time-end") args.timeEnd = argv[++i] ?? null;
    else if (a === "--rule") args.rule = argv[++i] ?? null;
    else if (a === "--dry-run" || a === "--dryRun") args.dryRun = true;
    else if (a === "--yes" || a === "-y") args.yes = true;
    else if (!a.startsWith("-")) positional.push(a);
  }
  args.alertId = positional[0] ?? null;
  return args;
}

/**
 * Set workflow status to "acknowledged" for alerts matching the given IDs
 * via the Kibana Detection Engine API.
 */
async function acknowledgeByIds(alertIds) {
  return kibanaPost("/api/detection_engine/signals/status", {
    signal_ids: alertIds,
    status: "acknowledged",
  });
}

/**
 * Build an ES query for matching open alerts by agent/host/rule/time.
 */
function buildMatchQuery(opts = {}) {
  const mustClauses = [{ term: { "kibana.alert.workflow_status": "open" } }];

  if (opts.agentId) mustClauses.push({ term: { "agent.id": opts.agentId } });
  if (opts.hostName) mustClauses.push({ term: { "host.name": opts.hostName } });
  if (opts.ruleName) mustClauses.push({ match_phrase: { "kibana.alert.rule.name": opts.ruleName } });
  if (opts.timeStart || opts.timeEnd) {
    const timeRange = {};
    if (opts.timeStart) timeRange.gte = opts.timeStart;
    if (opts.timeEnd) timeRange.lte = opts.timeEnd;
    mustClauses.push({ range: { "@timestamp": timeRange } });
  }

  return { bool: { must: mustClauses } };
}

/**
 * Count matching alerts (used for dry-run and preview).
 */
async function countMatchingAlerts(query, index) {
  const client = createClient();
  try {
    const response = await client.count({ index, query });
    return response.count;
  } finally {
    await client.close();
  }
}

/**
 * Find alert IDs matching the query (used to collect IDs for the Kibana API).
 */
async function findMatchingAlertIds(query, index) {
  const client = createClient();
  try {
    const response = await client.search({
      index,
      query,
      size: 10000,
      _source: false,
    });
    return (response.hits?.hits || []).map((h) => h._id);
  } finally {
    await client.close();
  }
}

async function acknowledgeByQuery(opts = {}) {
  const { index = ".alerts-security.alerts-*", dryRun = false } = opts;

  const query = buildMatchQuery(opts);

  if (dryRun) {
    const count = await countMatchingAlerts(query, index);
    return { dry_run: true, matching_alerts: count, query };
  }

  const alertIds = await findMatchingAlertIds(query, index);
  if (!alertIds.length) {
    return { total: 0, updated: 0, failures: [], query };
  }

  await acknowledgeByIds(alertIds);
  return { total: alertIds.length, updated: alertIds.length, failures: [], query };
}

async function acknowledgeRelatedAlerts(agentId, timestamp, windowSeconds, index, dryRun) {
  const ts = new Date(timestamp.replace("Z", "+00:00"));
  const timeStart = new Date(ts.getTime() - windowSeconds * 1000).toISOString().replace("+00:00", "Z");
  const timeEnd = new Date(ts.getTime() + windowSeconds * 1000).toISOString().replace("+00:00", "Z");

  return acknowledgeByQuery({
    agentId,
    timeStart,
    timeEnd,
    index,
    dryRun,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    if (args.related) {
      if (!args.agent || !args.timestamp) {
        console.error("--related requires --agent and --timestamp");
        process.exit(1);
      }

      if (!args.dryRun && !args.yes) {
        const ok = await promptConfirm("Acknowledge all related alerts for this agent?");
        if (!ok) {
          console.log("Aborted.");
          process.exit(0);
        }
      }

      const response = await acknowledgeRelatedAlerts(args.agent, args.timestamp, args.window, args.index, args.dryRun);

      if (args.dryRun) {
        console.log(`DRY RUN: Would acknowledge ${response.matching_alerts} related alerts`);
      } else {
        console.log(`Acknowledged ${response.updated} of ${response.total} related alerts`);
        if (response.failures?.length) {
          console.log(`Failures: ${response.failures.length}`);
        }
      }
    } else if (args.query) {
      if (!args.dryRun && !args.yes) {
        const ok = await promptConfirm("Acknowledge all matching alerts?");
        if (!ok) {
          console.log("Aborted.");
          process.exit(0);
        }
      }

      const response = await acknowledgeByQuery({
        agentId: args.agent,
        hostName: args.host,
        timeStart: args.timeStart,
        timeEnd: args.timeEnd,
        ruleName: args.rule,
        index: args.index,
        dryRun: args.dryRun,
      });

      if (args.dryRun) {
        console.log(`DRY RUN: Would acknowledge ${response.matching_alerts} alerts`);
      } else {
        console.log(`Acknowledged ${response.updated} of ${response.total} alerts`);
        if (response.failures?.length) {
          console.log(`Failures: ${response.failures.length}`);
        }
      }
    } else {
      if (!args.alertId) {
        console.error("alert_id required for single mode (or use --related/--query)");
        process.exit(1);
      }

      if (args.dryRun) {
        const client = createClient();
        try {
          const response = await client.get({ index: args.index, id: args.alertId, _source: true });
          const status = response._source?.["kibana.alert.workflow_status"] ?? "unknown";
          console.log(`DRY RUN: Would acknowledge alert ${args.alertId} (current status: ${status})`);
          console.log(JSON.stringify(response, null, 2));
        } finally {
          await client.close();
        }
      } else {
        if (!args.yes) {
          const ok = await promptConfirm(`Acknowledge alert ${args.alertId}?`);
          if (!ok) {
            console.log("Aborted.");
            process.exit(0);
          }
        }

        const response = await acknowledgeByIds([args.alertId]);
        console.log("Alert acknowledged successfully");
        console.log(JSON.stringify(response, null, 2));
      }
    }
  } catch (err) {
    console.error(`Failed to acknowledge alert(s): ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
