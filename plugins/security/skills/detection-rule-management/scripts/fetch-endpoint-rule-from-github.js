#!/usr/bin/env node
/**
 * Fetch endpoint behavior rule content from elastic/protections-artifacts by rule_id.
 * Rule logic is not stored in Elasticsearch; the repo holds the TOML source
 * (description, EQL query with built-in exclusions, threat mapping).
 * Use this after identifying a noisy endpoint rule to understand what it detects and
 * how existing exclusions are expressed before adding an endpoint exception.
 */

import { writeFileSync } from "fs";

const REPO = "elastic/protections-artifacts";
const BRANCH = "main";
const BASE_URL = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const SEARCH_URL = "https://api.github.com/search/code";
const CONTENTS_URL = `https://api.github.com/repos/${REPO}/contents`;

function headers() {
  const h = { Accept: "application/vnd.github.v3+json", "User-Agent": "elastic-agentic" };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function apiGet(url) {
  const resp = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`GitHub API ${resp.status}: ${resp.statusText}`);
  return resp.json();
}

async function fetchFile(path) {
  const resp = await fetch(BASE_URL + path, { headers: headers(), signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`Failed to fetch ${path}: ${resp.status}`);
  return resp.text();
}

async function walkBehaviorRulesFind(ruleId) {
  const top = await apiGet(`${CONTENTS_URL}/behavior/rules`);
  const dirs = top.filter((x) => x?.type === "dir");

  for (const d of dirs) {
    let files;
    try {
      files = await apiGet(`${CONTENTS_URL}/${encodeURIComponent(d.path)}`);
    } catch {
      continue;
    }
    for (const f of files) {
      if (f?.type !== "file" || !f.name?.endsWith(".toml")) continue;
      const filePath = f.path || `${d.path}/${f.name}`;
      try {
        const raw = await fetchFile(filePath);
        if (raw.includes(ruleId)) return filePath;
      } catch {
        continue;
      }
    }
  }

  throw new Error(
    `No rule file found with rule_id=${ruleId} in ${REPO} behavior/rules. ` +
      "Check that the UUID is the rule's id (TOML id / rule.id in alerts), not the rule's internal id.",
  );
}

async function searchRuleFile(ruleId) {
  const q = `"${ruleId}" repo:${REPO} path:behavior/rules`;
  const url = `${SEARCH_URL}?${new URLSearchParams({ q })}`;

  let data;
  try {
    data = await apiGet(url);
  } catch (e) {
    if (e.message.includes("401") || e.message.includes("403")) {
      return walkBehaviorRulesFind(ruleId);
    }
    throw e;
  }

  const items = data.items || [];
  if (!items.length) return walkBehaviorRulesFind(ruleId);

  const path = items[0].path;
  if (!path?.endsWith(".toml")) return walkBehaviorRulesFind(ruleId);
  return path;
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2).replace(/-/g, "_");
      const next = argv[i + 1];
      result[key] = next && !next.startsWith("--") ? (i++, next) : true;
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.rule_id) {
    console.error("Usage: node fetch-endpoint-rule-from-github.js --rule-id <uuid>");
    console.error("");
    console.error("For endpoint behavior rules use the rule's id (the UUID in the TOML and rule.id");
    console.error("in alerts), not kibana.alert.rule.rule_id.");
    process.exit(1);
  }

  const ruleId = args.rule_id.trim();
  const path = await searchRuleFile(ruleId);
  const content = await fetchFile(path);

  if (args.output) {
    writeFileSync(args.output, content, "utf8");
    console.error(`Written to ${args.output}`);
  } else {
    console.log(content);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
