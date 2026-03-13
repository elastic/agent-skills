#!/usr/bin/env node
/**
 * Fetch the next unacknowledged Elastic Security alert.
 * Returns the oldest unacknowledged alert from the last N days.
 */

import { createClient } from "./es-client.js";

const ALERTS_INDEX = ".alerts-security.alerts-*";

/**
 * Resolve a dot-notation field path from an object that may store the value
 * either as a flat key ("kibana.alert.rule.name") or as nested objects
 * ({ kibana: { alert: { rule: { name: "..." } } } }).
 */
function getField(obj, path) {
  if (obj == null) return undefined;
  if (path in obj) return obj[path];
  const parts = path.split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

function parseArgs(argv) {
  const args = { days: 7, verbose: false, json: false, full: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days" || a === "-d") args.days = parseInt(argv[++i], 10) || 7;
    else if (a === "--verbose" || a === "-v") args.verbose = true;
    else if (a === "--json" || a === "-j") args.json = true;
    else if (a === "--full") args.full = true;
  }
  return args;
}

async function fetchNextUnacknowledgedAlert(daysBack, verbose) {
  const client = createClient();
  const now = new Date();
  const startTime = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

  const query = {
    bool: {
      must: [{ range: { "@timestamp": { gte: startTime.toISOString(), lte: now.toISOString() } } }],
      must_not: [
        { term: { "kibana.alert.workflow_status": "acknowledged" } },
        { term: { "kibana.alert.workflow_status": "closed" } },
      ],
    },
  };

  if (verbose) {
    console.log(`Searching index: ${ALERTS_INDEX}`);
    console.log(`Time range: ${startTime.toISOString()} to ${now.toISOString()}`);
    console.log(`Query: ${JSON.stringify(query, null, 2)}`);
  }

  const response = await client.search({
    index: ALERTS_INDEX,
    query,
    sort: [{ "@timestamp": { order: "asc" } }],
    size: 1,
  });

  const hits = response.hits?.hits ?? [];
  const total = response.hits?.total;
  const totalCount = typeof total === "object" ? (total?.value ?? 0) : (total ?? 0);

  if (verbose) {
    console.log(`Total unacknowledged alerts: ${totalCount}`);
  }

  if (hits.length > 0) {
    const alert = hits[0];
    return {
      id: alert._id,
      index: alert._index,
      source: alert._source,
      total_unacknowledged: totalCount,
    };
  }
  return null;
}

function formatAlertSummary(alert) {
  if (!alert) {
    return "No unacknowledged alerts found.";
  }
  const source = alert.source;
  const agentId = getField(source, "agent.id") ?? "Unknown";
  const hostName = getField(source, "host.name") ?? "Unknown";
  const userName = getField(source, "user.name") ?? "Unknown";

  return `
================================================================================
ALERT SUMMARY
================================================================================
Alert ID:       ${alert.id}
Index:          ${alert.index}
Timestamp:      ${getField(source, "@timestamp") ?? "Unknown"}

RULE INFORMATION
----------------
Rule Name:      ${getField(source, "kibana.alert.rule.name") ?? "Unknown Rule"}
Severity:       ${getField(source, "kibana.alert.severity") ?? "unknown"}
Risk Score:     ${getField(source, "kibana.alert.risk_score") ?? "N/A"}

ENTITY INFORMATION
------------------
Agent ID:       ${agentId}
Host:           ${hostName}
User:           ${userName}

ALERT REASON
------------
${getField(source, "kibana.alert.reason") ?? "No reason provided"}

REMAINING UNACKNOWLEDGED
------------------------
Total alerts pending: ${alert.total_unacknowledged}
================================================================================
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const alert = await fetchNextUnacknowledgedAlert(args.days, args.verbose);

  if (args.json) {
    if (alert && !args.full) {
      const output = {
        id: alert.id,
        index: alert.index,
        timestamp: getField(alert.source, "@timestamp"),
        rule_name: getField(alert.source, "kibana.alert.rule.name"),
        severity: getField(alert.source, "kibana.alert.severity"),
        agent_id: getField(alert.source, "agent.id"),
        host: getField(alert.source, "host.name"),
        user: getField(alert.source, "user.name"),
        total_unacknowledged: alert.total_unacknowledged,
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(JSON.stringify(alert, null, 2));
    }
  } else {
    console.log(formatAlertSummary(alert));
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
