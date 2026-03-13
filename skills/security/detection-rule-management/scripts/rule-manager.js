#!/usr/bin/env node
/**
 * Detection rule management CLI wrapping the Kibana Detection Engine REST API.
 * Supports listing, searching, creating, patching, enabling/disabling rules,
 * and managing rule exceptions for false-positive tuning.
 */

import { readFileSync } from "fs";
import { createInterface } from "readline";
import { kibanaDelete, kibanaFetch, kibanaGet, kibanaPatch, kibanaPost } from "./kibana-client.js";

const RULES_API = "/api/detection_engine/rules";
const EXCEPTIONS_API = "/api/exception_lists";

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

function parseIntArg(val, def) {
  if (val === undefined || val === null) return def;
  const n = Number(val);
  return Number.isNaN(n) ? def : n;
}

function ensureArray(val) {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

// ---------------------------------------------------------------------------
// Query syntax validation
// ---------------------------------------------------------------------------

const KQL_SYNTAX_CHECKS = [
  {
    pattern: /\\\//,
    id: "escaped-forward-slash",
    message: "KQL does not use backslash escaping. Use plain text (e.g. */IM chrome.exe* not *\\/IM chrome.exe*).",
  },
  {
    pattern: /(?:^|\s)AND\s+AND(?:\s|$)|(?:^|\s)OR\s+OR(?:\s|$)/,
    id: "duplicate-operator",
    message: "Duplicate boolean operator (AND AND or OR OR).",
  },
  {
    pattern: /(?:^|\s)AND\s+OR(?:\s|$)|(?:^|\s)OR\s+AND(?:\s|$)/,
    id: "conflicting-operators",
    message: "Conflicting adjacent boolean operators (AND OR or OR AND).",
  },
];

const EQL_SYNTAX_CHECKS = [
  {
    pattern: /\\\//,
    id: "escaped-forward-slash",
    message:
      "Unexpected escaped forward-slash. EQL uses double-backslash (\\\\) for literal backslashes in Windows paths.",
  },
  {
    pattern: /\bwhere\b.*\bwhere\b/i,
    id: "duplicate-where",
    message: "Duplicate 'where' clause in the same event filter.",
  },
];

const ESQL_SYNTAX_CHECKS = [
  {
    pattern: /(?:^|\s)AND\s+AND(?:\s|$)|(?:^|\s)OR\s+OR(?:\s|$)/,
    id: "duplicate-operator",
    message: "Duplicate boolean operator (AND AND or OR OR).",
  },
];

function validateQuerySyntax(query, language) {
  const errors = [];

  let checks;
  if (language === "eql") {
    checks = EQL_SYNTAX_CHECKS;
  } else if (language === "esql") {
    checks = ESQL_SYNTAX_CHECKS;
  } else {
    checks = KQL_SYNTAX_CHECKS;
  }

  for (const check of checks) {
    if (check.pattern.test(query)) {
      errors.push({ id: check.id, message: check.message });
    }
  }

  const openParens = (query.match(/\(/g) || []).length;
  const closeParens = (query.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    errors.push({
      id: "mismatched-parens",
      message: `Mismatched parentheses: ${openParens} open vs ${closeParens} close.`,
    });
  }

  const quoteCount = (query.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    errors.push({ id: "unbalanced-quotes", message: `Unbalanced double-quotes: ${quoteCount} found (must be even).` });
  }

  return errors;
}

async function validateQuery(args) {
  const query = args.query;
  if (!query) {
    console.error("Error: --query is required");
    process.exit(1);
  }
  const language = args.language || "kuery";
  const errors = validateQuerySyntax(query, language);
  if (errors.length === 0) {
    console.log(JSON.stringify({ valid: true, query, language, errors: [] }, null, 2));
  } else {
    console.log(JSON.stringify({ valid: false, query, language, errors }, null, 2));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Rules CRUD
// ---------------------------------------------------------------------------

async function findRules(args, space) {
  const params = {
    per_page: parseIntArg(args.per_page, 20),
    page: parseIntArg(args.page, 1),
    sort_field: args.sort_field || "name",
    sort_order: args.sort_order || "asc",
  };
  if (args.filter) params.filter = args.filter;
  if (args.fields) params.fields = args.fields;

  const result = await kibanaGet(`${RULES_API}/_find`, params, space);
  if (args.brief) {
    const rules = result.data || [];
    const brief = rules.map((r) => ({
      id: r.id,
      rule_id: r.rule_id,
      name: r.name,
      type: r.type,
      enabled: r.enabled,
      severity: r.severity,
      risk_score: r.risk_score,
      tags: r.tags || [],
      immutable: r.immutable,
    }));
    console.log(JSON.stringify({ total: result.total || 0, rules: brief }, null, 2));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
  return result;
}

async function getRule(args, space) {
  const params = {};
  if (args.id) params.id = args.id;
  else if (args.rule_id) params.rule_id = args.rule_id;
  else {
    console.error("Error: provide --id or --rule-id");
    process.exit(1);
  }

  const result = await kibanaGet(RULES_API, params, space);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function createRule(args, space) {
  let body;
  if (args.from_file) {
    body = JSON.parse(readFileSync(args.from_file, "utf8"));
  } else {
    body = {
      name: args.name,
      description: args.description || "",
      type: args.type,
      risk_score: parseIntArg(args.risk_score, 50),
      severity: args.severity || "medium",
      enabled: !args.disabled,
    };
    if (args.query) body.query = args.query;
    if (args.language) body.language = args.language;
    else if (args.type === "query" || args.type === "saved_query") body.language = "kuery";
    else if (args.type === "eql") body.language = "eql";
    else if (args.type === "esql") body.language = "esql";
    if (args.index) body.index = ensureArray(args.index);
    if (args.interval) body.interval = args.interval;
    if (args.from_time) body.from = args.from_time;
    if (args.tags) body.tags = ensureArray(args.tags);
    if (args.threat_file) body.threat = JSON.parse(readFileSync(args.threat_file, "utf8"));
    if (args.false_positives) body.false_positives = ensureArray(args.false_positives);
    if (args.references) body.references = ensureArray(args.references);
    if (args.note) body.note = args.note;
    if (args.rule_id) body.rule_id = args.rule_id;
    if (args.max_signals !== undefined) body.max_signals = parseIntArg(args.max_signals, undefined);
    if (args.type === "threshold" && args.threshold_field) {
      body.threshold = {
        field: args.threshold_field,
        value: parseIntArg(args.threshold_value, 1),
      };
    }
  }

  if (body.query && !args.skip_validation) {
    const lang = body.language || "kuery";
    const syntaxErrors = validateQuerySyntax(body.query, lang);
    if (syntaxErrors.length > 0) {
      console.error("Query syntax validation failed:");
      for (const err of syntaxErrors) {
        console.error(`  - [${err.id}] ${err.message}`);
      }
      console.error(`\nQuery: ${body.query}`);
      console.error(`Language: ${lang}`);
      console.error("\nFix the query before creating the rule. Pass --skip-validation to bypass.");
      process.exit(1);
    }
  }

  const result = await kibanaPost(RULES_API, body, space);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function patchRule(args, space) {
  const body = {};
  if (args.id) body.id = args.id;
  else if (args.rule_id) body.rule_id = args.rule_id;
  else {
    console.error("Error: provide --id or --rule-id");
    process.exit(1);
  }

  if (args.name) body.name = args.name;
  if (args.description) body.description = args.description;
  if (args.query) body.query = args.query;
  if (args.language) body.language = args.language;
  if (args.index) body.index = ensureArray(args.index);
  if (args.interval) body.interval = args.interval;
  if (args.from_time) body.from = args.from_time;
  if (args.tags) body.tags = ensureArray(args.tags);
  if (args.severity) body.severity = args.severity;
  if (args.risk_score !== undefined) body.risk_score = parseIntArg(args.risk_score, 50);
  if (args.false_positives) body.false_positives = ensureArray(args.false_positives);
  if (args.note) body.note = args.note;
  if (args.max_signals !== undefined) body.max_signals = parseIntArg(args.max_signals, undefined);
  if (args.enabled !== undefined) body.enabled = args.enabled === "true";

  if (body.query && !args.skip_validation) {
    const lang = body.language || args.language || "kuery";
    const syntaxErrors = validateQuerySyntax(body.query, lang);
    if (syntaxErrors.length > 0) {
      console.error("Query syntax validation failed:");
      for (const err of syntaxErrors) {
        console.error(`  - [${err.id}] ${err.message}`);
      }
      console.error(`\nQuery: ${body.query}`);
      console.error(`Language: ${lang}`);
      console.error("\nFix the query before patching the rule. Pass --skip-validation to bypass.");
      process.exit(1);
    }
  }

  const result = await kibanaPatch(RULES_API, body, space);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function toggleRule(args, space, enable) {
  const body = { enabled: enable };
  if (args.id) body.id = args.id;
  else if (args.rule_id) body.rule_id = args.rule_id;
  else {
    console.error("Error: provide --id or --rule-id");
    process.exit(1);
  }

  const result = await kibanaPatch(RULES_API, body, space);
  const state = enable ? "enabled" : "disabled";
  console.log(`Rule ${result.name || "?"} is now ${state}`);
  return result;
}

async function deleteRule(args, space) {
  const params = {};
  if (args.id) params.id = args.id;
  else if (args.rule_id) params.rule_id = args.rule_id;
  else {
    console.error("Error: provide --id or --rule-id");
    process.exit(1);
  }

  const qs = new URLSearchParams(params).toString();
  const result = await kibanaDelete(`${RULES_API}?${qs}`, space);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function exportRules(args, space) {
  const params = { exclude_export_details: "false" };
  if (args.file_name) params.file_name = args.file_name;

  let body = undefined;
  if (args.rule_ids) {
    const ids = Array.isArray(args.rule_ids) ? args.rule_ids : [args.rule_ids];
    body = { objects: ids.map((rid) => ({ rule_id: rid })) };
  }

  const result = await kibanaFetch(`${RULES_API}/_export`, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
    params,
    space,
  });

  if (!result.success) {
    throw new Error(result.error || `HTTP ${result.status}`);
  }
  console.log(result.data);
  return result.data;
}

async function bulkAction(args, space) {
  const body = { action: args.action };
  if (args.ids) body.ids = Array.isArray(args.ids) ? args.ids : [args.ids];
  else if (args.query) body.query = args.query;
  else body.query = "";

  if (args.action === "edit" && args.edit_file) {
    body.edit = JSON.parse(readFileSync(args.edit_file, "utf8"));
  }

  const path = args.dry_run ? `${RULES_API}/_bulk_action?dry_run=true` : `${RULES_API}/_bulk_action`;
  const result = await kibanaPost(path, body, space);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

// ---------------------------------------------------------------------------
// Rule exceptions (false-positive tuning)
// ---------------------------------------------------------------------------

const OP_MAP = {
  is: ["match", "included"],
  is_not: ["match", "excluded"],
  is_one_of: ["match_any", "included"],
  is_not_one_of: ["match_any", "excluded"],
  exists: ["exists", "included"],
  does_not_exist: ["exists", "excluded"],
  matches: ["wildcard", "included"],
  does_not_match: ["wildcard", "excluded"],
};

function parseExceptionEntry(entryStr) {
  const parts = entryStr.split(":");
  let field, operator, value;
  if (parts.length >= 3) {
    field = parts[0];
    operator = parts[1];
    value = parts.slice(2).join(":");
  } else if (parts.length === 2) {
    field = parts[0];
    value = parts[1];
    operator = "is";
  } else {
    throw new Error(`Invalid entry format '${entryStr}'. Use field:operator:value or field:value`);
  }

  const mapped = OP_MAP[operator];
  if (!mapped) {
    throw new Error(`Unknown operator '${operator}'. Use: ${Object.keys(OP_MAP).join(", ")}`);
  }

  const [entryType, listOperator] = mapped;
  const entry = { field, type: entryType, operator: listOperator };
  if (entryType === "match") entry.value = value;
  else if (entryType === "match_any") entry.value = value.split(",").map((v) => v.trim());
  else if (entryType === "wildcard") entry.value = value;
  return entry;
}

async function addException(args, space) {
  const entries = [];
  const entryStrs = Array.isArray(args.entries) ? args.entries : [args.entries];
  for (const entryStr of entryStrs) {
    entries.push(parseExceptionEntry(entryStr));
  }

  const item = {
    type: "simple",
    name: args.name || `Exception ${crypto.randomUUID().slice(0, 8)}`,
    description: args.description || "",
    entries,
  };
  if (args.tags) item.tags = ensureArray(args.tags);
  if (args.expire) item.expire_time = args.expire;
  if (args.comment) item.comments = [{ comment: args.comment }];

  const body = { items: [item] };
  const result = await kibanaPost(`${RULES_API}/${args.rule_uuid}/exceptions`, body, space);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function listExceptions(args, space) {
  const params = {
    list_id: args.list_id,
    namespace_type: args.namespace_type || "single",
    per_page: parseIntArg(args.per_page, 20),
    page: parseIntArg(args.page, 1),
  };
  const result = await kibanaGet(`${EXCEPTIONS_API}/items/_find`, params, space);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function createSharedExceptionList(args, space) {
  const body = {
    name: args.name,
    description: args.description || "",
  };
  if (args.tags) body.tags = ensureArray(args.tags);

  const result = await kibanaPost("/api/exceptions/shared", body, space);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

// ---------------------------------------------------------------------------
// Alert volume analysis (for tuning decisions)
// ---------------------------------------------------------------------------

async function noisyRules(args) {
  const { createClient } = await import("./es-client.js");
  const es = createClient();

  const days = parseIntArg(args.days, 7);
  const size = parseIntArg(args.top, 20);

  const query = {
    bool: {
      must: [{ range: { "@timestamp": { gte: `now-${days}d` } } }],
    },
  };
  const aggs = {
    by_rule: {
      terms: {
        field: "kibana.alert.rule.name",
        size,
        order: { _count: "desc" },
      },
      aggs: {
        rule_id: { terms: { field: "kibana.alert.rule.uuid", size: 1 } },
        severity: { terms: { field: "kibana.alert.severity", size: 1 } },
        unique_agents: { cardinality: { field: "agent.id" } },
      },
    },
  };

  const result = await es.search({
    index: ".alerts-security.alerts-*",
    query,
    aggs,
    size: 0,
  });

  const buckets = result.aggregations?.by_rule?.buckets || [];
  const output = buckets.map((b) => {
    const ruleIds = b.rule_id?.buckets || [];
    const sevs = b.severity?.buckets || [];
    return {
      rule_name: b.key,
      alert_count: b.doc_count,
      rule_uuid: ruleIds[0]?.key ?? null,
      severity: sevs[0]?.key ?? null,
      unique_agents: b.unique_agents?.value ?? 0,
    };
  });

  console.log(JSON.stringify(output, null, 2));
  return output;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

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
      case "find":
        await findRules(rawArgs, space);
        break;
      case "get":
        if (!rawArgs.id && !rawArgs.rule_id) {
          console.error("Error: provide --id or --rule-id");
          process.exit(1);
        }
        await getRule(rawArgs, space);
        break;
      case "create":
        if (!yes) {
          const label = rawArgs.name || rawArgs.from_file || "new rule";
          const ok = await promptConfirm(`Create rule "${label}"?`);
          if (!ok) {
            console.log("Aborted.");
            process.exit(0);
          }
        }
        await createRule(rawArgs, space);
        break;
      case "patch":
        if (!rawArgs.id && !rawArgs.rule_id) {
          console.error("Error: provide --id or --rule-id");
          process.exit(1);
        }
        if (!yes) {
          const ok = await promptConfirm(`Patch rule ${rawArgs.id || rawArgs.rule_id}?`);
          if (!ok) {
            console.log("Aborted.");
            process.exit(0);
          }
        }
        await patchRule(rawArgs, space);
        break;
      case "enable":
        if (!rawArgs.id && !rawArgs.rule_id) {
          console.error("Error: provide --id or --rule-id");
          process.exit(1);
        }
        if (!yes) {
          const ok = await promptConfirm(`Enable rule ${rawArgs.id || rawArgs.rule_id}?`);
          if (!ok) {
            console.log("Aborted.");
            process.exit(0);
          }
        }
        await toggleRule(rawArgs, space, true);
        break;
      case "disable":
        if (!rawArgs.id && !rawArgs.rule_id) {
          console.error("Error: provide --id or --rule-id");
          process.exit(1);
        }
        if (!yes) {
          const ok = await promptConfirm(`Disable rule ${rawArgs.id || rawArgs.rule_id}?`);
          if (!ok) {
            console.log("Aborted.");
            process.exit(0);
          }
        }
        await toggleRule(rawArgs, space, false);
        break;
      case "delete":
        if (!rawArgs.id && !rawArgs.rule_id) {
          console.error("Error: provide --id or --rule-id");
          process.exit(1);
        }
        if (!yes) {
          const ok = await promptConfirm(`Delete rule ${rawArgs.id || rawArgs.rule_id}? This cannot be undone.`);
          if (!ok) {
            console.log("Aborted.");
            process.exit(0);
          }
        }
        await deleteRule(rawArgs, space);
        break;
      case "export":
        await exportRules(rawArgs, space);
        break;
      case "bulk-action":
        requireArg("action", "--action is required");
        if (!yes && !rawArgs.dry_run) {
          const ok = await promptConfirm(`Execute bulk ${rawArgs.action}?`);
          if (!ok) {
            console.log("Aborted.");
            process.exit(0);
          }
        }
        await bulkAction(rawArgs, space);
        break;
      case "add-exception":
        requireArg("rule_uuid", "--rule-uuid is required");
        requireArg("entries", "--entries is required");
        if (!yes) {
          const ok = await promptConfirm(`Add exception to rule ${rawArgs.rule_uuid}?`);
          if (!ok) {
            console.log("Aborted.");
            process.exit(0);
          }
        }
        await addException(rawArgs, space);
        break;
      case "list-exceptions":
        requireArg("list_id", "--list-id is required");
        await listExceptions(rawArgs, space);
        break;
      case "create-shared-list":
        requireArg("name", "--name is required");
        if (!yes) {
          const ok = await promptConfirm(`Create shared exception list "${rawArgs.name}"?`);
          if (!ok) {
            console.log("Aborted.");
            process.exit(0);
          }
        }
        await createSharedExceptionList(rawArgs, space);
        break;
      case "noisy-rules":
        await noisyRules(rawArgs);
        break;
      case "validate-query":
        await validateQuery(rawArgs);
        break;
      default:
        console.error(
          "Error: unknown command. Use: find, get, create, patch, enable, disable, delete, export, bulk-action, add-exception, list-exceptions, create-shared-list, noisy-rules, validate-query",
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
