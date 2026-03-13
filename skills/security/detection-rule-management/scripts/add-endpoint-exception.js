#!/usr/bin/env node
/**
 * Add an exception item to the Endpoint Security Exception List.
 *
 * Endpoint exceptions are stored in the Endpoint Security Exception List
 * (Security → Exceptions → Endpoint Security Exception List, /app/security/exceptions).
 * They are separate from SIEM/detection rule exceptions. This script uses
 * POST /api/endpoint_list/items to add an item directly to that list.
 *
 * See: https://www.elastic.co/docs/solutions/security/detect-and-alert/add-manage-exceptions#endpoint-rule-exceptions
 * API: https://www.elastic.co/docs/api/doc/kibana/operation/operation-createexceptionlistitem
 */

import { kibanaPost, kibanaDelete as kibanaDeleteReq } from "./kibana-client.js";
import { createInterface } from "readline";

const ENDPOINT_LIST_ITEMS_API = "/api/endpoint_list/items";

function promptConfirm(message) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

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

function parseEntry(entryStr) {
  const parts = entryStr.split(":");
  let field, operator, value;

  if (parts.length >= 3) {
    field = parts[0];
    operator = parts[1];
    value = parts.slice(2).join(":");
  } else if (parts.length === 2) {
    [field, value] = parts;
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

function makeItemId(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^\w-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const rand = crypto.randomUUID().slice(0, 8);
  return slug ? `${slug}-${rand}` : `endpoint-exception-${rand}`;
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-y") {
      result.yes = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-/g, "_");
      const values = [];
      let j = i + 1;
      while (j < argv.length && !argv[j].startsWith("--") && argv[j] !== "-y") {
        values.push(argv[j]);
        j++;
      }
      result[key] = values.length === 0 ? true : values.length === 1 ? values[0] : values;
      i = j - 1;
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const yes = args.yes === true;

  if (args.delete) {
    if (!args.item_id && !args.id) {
      console.error("Error: provide --item-id or --id to delete");
      process.exit(1);
    }
    if (!yes) {
      const ok = await promptConfirm(`Delete endpoint exception ${args.item_id || args.id}? This cannot be undone.`);
      if (!ok) {
        console.log("Aborted.");
        process.exit(0);
      }
    }
    const qs = args.item_id ? `?item_id=${args.item_id}` : `?id=${args.id}`;
    const result = await kibanaDeleteReq(`${ENDPOINT_LIST_ITEMS_API}${qs}`, args.space);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!args.name || !args.entries) {
    console.error("Error: --name and --entries are required when adding an exception");
    console.error("");
    console.error('Usage: node add-endpoint-exception.js --name "Exception name" --entries field:operator:value ...');
    console.error("");
    console.error("IMPORTANT: To limit the exception to a specific rule, always include rule.id or rule.name");
    console.error("as one of the entries: rule.id:is:<uuid> or rule.name:is:<exact rule name>.");
    console.error("");
    console.error("Operators: is, is_not, is_one_of, is_not_one_of, matches, does_not_match, exists, does_not_exist");
    process.exit(1);
  }

  const entryStrs = Array.isArray(args.entries) ? args.entries : [args.entries];
  const parsed = entryStrs.map(parseEntry);

  let desc = args.description || "";
  if (args.comment) {
    desc = desc ? `${desc}\nComment: ${args.comment}` : args.comment;
  }

  const item = {
    name: args.name,
    item_id: args.item_id || makeItemId(args.name),
    description: desc,
    type: "simple",
    entries: parsed,
    namespace_type: "agnostic",
    list_id: "endpoint_list",
  };

  if (args.tags) {
    item.tags = Array.isArray(args.tags) ? args.tags : [args.tags];
  }
  if (args.os_types) {
    const types = Array.isArray(args.os_types) ? args.os_types : [args.os_types];
    item.os_types = types.map((t) => t.trim().toLowerCase());
  }

  if (!yes) {
    const ok = await promptConfirm(`Add endpoint exception "${args.name}"?`);
    if (!ok) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  const result = await kibanaPost(ENDPOINT_LIST_ITEMS_API, item, args.space);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
