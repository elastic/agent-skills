#!/usr/bin/env node
/**
 * Case management CLI wrapping the Kibana Cases REST API.
 * Creates, searches, updates cases and attaches alerts/comments.
 */

import { createInterface } from "readline";
import { kibanaGet, kibanaPatch, kibanaPost } from "./kibana-client.js";

const OWNER = "securitySolution";

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
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-y") {
      result.yes = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-/g, "_");
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        const values = [];
        let j = i + 1;
        while (j < argv.length && !argv[j].startsWith("--")) {
          values.push(argv[j]);
          j++;
        }
        result[key] = values.length === 1 ? values[0] : values;
        i = j - 1;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

async function createCase(args, space) {
  const syncAlerts = args.sync_alerts !== "false";
  const body = {
    title: args.title,
    description: args.description || "",
    tags: Array.isArray(args.tags) ? args.tags : args.tags ? [args.tags] : [],
    severity: args.severity || "medium",
    owner: OWNER,
    connector: { id: "none", name: "none", type: ".none", fields: null },
    settings: { syncAlerts },
  };
  if (args.assignees) {
    const assigneeList = Array.isArray(args.assignees) ? args.assignees : [args.assignees];
    body.assignees = assigneeList.map((uid) => ({ uid }));
  }
  const result = await kibanaPost("/api/cases", body, space);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function getCase(args, space) {
  const result = await kibanaGet(`/api/cases/${args.case_id}`, undefined, space);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function findCases(args, space) {
  const params = { owner: OWNER, sortField: "createdAt", sortOrder: "desc" };
  if (args.tags) params.tags = args.tags;
  if (args.status) params.status = args.status;
  if (args.severity) params.severity = args.severity;
  if (args.search) params.search = args.search;
  if (args.per_page) params.perPage = args.per_page;
  if (args.page) params.page = args.page;

  const result = await kibanaGet("/api/cases/_find", params, space);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function listCases(args, space) {
  const listArgs = { ...args, search: null, tags: null, severity: null };
  if (!listArgs.per_page) listArgs.per_page = 10;
  if (!listArgs.page) listArgs.page = 1;
  return findCases(listArgs, space);
}

async function addComment(args, space) {
  const body = { type: "user", comment: args.comment, owner: OWNER };
  const result = await kibanaPost(`/api/cases/${args.case_id}/comments`, body, space);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function attachAlert(args, space) {
  const body = {
    type: "alert",
    alertId: args.alert_id,
    index: args.alert_index,
    owner: OWNER,
    rule: {
      id: args.rule_id || "unknown",
      name: args.rule_name || "unknown",
    },
  };
  const result = await kibanaPost(`/api/cases/${args.case_id}/comments`, body, space);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function attachAlertsBatch(args, space) {
  const alertIds = Array.isArray(args.alert_ids) ? args.alert_ids : [args.alert_ids];
  const index = args.alert_index;
  const ruleId = args.rule_id || "unknown";
  const ruleName = args.rule_name || "unknown";

  const attachments = alertIds.map((aid) => ({
    type: "alert",
    alertId: aid,
    index,
    owner: OWNER,
    rule: { id: ruleId, name: ruleName },
  }));

  const result = await kibanaPost(`/internal/cases/${args.case_id}/attachments/_bulk_create`, attachments, space, {
    "x-elastic-internal-origin": "kibana",
  });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function updateCase(args, space) {
  const current = await kibanaGet(`/api/cases/${args.case_id}`, undefined, space);
  const version = current.version;

  const update = { id: args.case_id, version };
  if (args.status) update.status = args.status;
  if (args.severity) update.severity = args.severity;
  if (args.tags) {
    const newTags = Array.isArray(args.tags) ? args.tags : [args.tags];
    const merged = [...new Set([...(current.tags || []), ...newTags])];
    update.tags = merged;
  }
  if (args.title) update.title = args.title;
  if (args.description) update.description = args.description;

  const result = await kibanaPatch("/api/cases", { cases: [update] }, space);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function casesForAlert(args, space) {
  const result = await kibanaGet(`/api/cases/alerts/${args.alert_id}`, undefined, space);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const cmd = process.argv[2];
  const rawArgs = parseArgs(process.argv.slice(3));
  const space = rawArgs.space;
  const yes = rawArgs.yes === true;

  const requireArg = (name, msg) => {
    const val = rawArgs[name];
    if (val === undefined || val === null || val === "") {
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
    return val;
  };

  try {
    switch (cmd) {
      case "create": {
        requireArg("title", "--title is required");
        if (!yes) {
          const ok = await promptConfirm(`Create case "${rawArgs.title}"?`);
          if (!ok) {
            console.log("Aborted.");
            process.exit(0);
          }
        }
        await createCase(rawArgs, space);
        break;
      }
      case "get": {
        requireArg("case_id", "--case-id is required");
        await getCase(rawArgs, space);
        break;
      }
      case "find":
        await findCases(rawArgs, space);
        break;
      case "list":
        await listCases(rawArgs, space);
        break;
      case "add-comment": {
        requireArg("case_id", "--case-id is required");
        requireArg("comment", "--comment is required");
        if (!yes) {
          const ok = await promptConfirm(`Add comment to case ${rawArgs.case_id}?`);
          if (!ok) {
            console.log("Aborted.");
            process.exit(0);
          }
        }
        await addComment(rawArgs, space);
        break;
      }
      case "attach-alert": {
        requireArg("case_id", "--case-id is required");
        requireArg("alert_id", "--alert-id is required");
        requireArg("alert_index", "--alert-index is required");
        if (!yes) {
          const ok = await promptConfirm(`Attach alert ${rawArgs.alert_id} to case ${rawArgs.case_id}?`);
          if (!ok) {
            console.log("Aborted.");
            process.exit(0);
          }
        }
        await attachAlert(rawArgs, space);
        break;
      }
      case "attach-alerts": {
        requireArg("case_id", "--case-id is required");
        requireArg("alert_ids", "--alert-ids is required");
        requireArg("alert_index", "--alert-index is required");
        const ids = Array.isArray(rawArgs.alert_ids) ? rawArgs.alert_ids : [rawArgs.alert_ids];
        if (!yes) {
          const ok = await promptConfirm(`Attach ${ids.length} alert(s) to case ${rawArgs.case_id}?`);
          if (!ok) {
            console.log("Aborted.");
            process.exit(0);
          }
        }
        await attachAlertsBatch(rawArgs, space);
        break;
      }
      case "update": {
        requireArg("case_id", "--case-id is required");
        if (!yes) {
          const ok = await promptConfirm(`Update case ${rawArgs.case_id}?`);
          if (!ok) {
            console.log("Aborted.");
            process.exit(0);
          }
        }
        await updateCase(rawArgs, space);
        break;
      }
      case "cases-for-alert": {
        requireArg("alert_id", "--alert-id is required");
        await casesForAlert(rawArgs, space);
        break;
      }
      default:
        console.error(
          "Error: unknown command. Use: create, get, find, list, add-comment, attach-alert, attach-alerts, update, cases-for-alert",
        );
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
