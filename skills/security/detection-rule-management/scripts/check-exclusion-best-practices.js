#!/usr/bin/env node
/*
 * Copyright Elastic Technologies Inc. and/or licensed to Elastic Technologies Inc. under one
 * or more contributor license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elastic Technologies Inc. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * Print the endpoint rule exclusion best-practices checklist.
 * Use when designing Endpoint exceptions or contributing rule changes to ensure
 * evasion-resilient, performant exclusions. Full guide: references/endpoint-rule-exclusion-best-practices.md
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REF_DIR = join(SCRIPT_DIR, "..", "references");
const BEST_PRACTICES_FILE = join(REF_DIR, "endpoint-rule-exclusion-best-practices.md");

const EMBEDDED_CHECKLIST = `\
- [ ] Paths: ?:\\\\ for drive-agnostic; : for case-insensitivity; wildcards ONLY for variable segments
- [ ] LOLBins/scripting: combine name or path WITH args or cmdline; prefer args + path over command_line wildcards
- [ ] API rules: no process-only exclusions; use call_stack_final_user_module or call_stack_summary for benign patterns
- [ ] User-writable paths: not excluded unconditionally; gate by trust/code signature when used
- [ ] No in-query comments that duplicate the PR/description
- [ ] When contributing rule changes: updated_date set; sample alerts (if ≤3–5 patterns) in description with <details>/<summary>; PII stripped`;

const fullMode = process.argv.includes("--full");

if (!existsSync(BEST_PRACTICES_FILE)) {
  console.log("Checklist (see references/endpoint-rule-exclusion-best-practices.md for full guide):\n");
  console.log(EMBEDDED_CHECKLIST);
  process.exit(0);
}

const content = readFileSync(BEST_PRACTICES_FILE, "utf8");

if (fullMode) {
  console.log(content);
  process.exit(0);
}

let inChecklist = false;
let found = false;
for (const line of content.split("\n")) {
  if (line.trim().startsWith("## Checklist")) {
    inChecklist = true;
    found = true;
    console.log(line);
    console.log();
    continue;
  }
  if (inChecklist) {
    if (line.startsWith("## ") && !line.startsWith("## Checklist")) break;
    console.log(line);
  }
}

if (!found) {
  console.log(EMBEDDED_CHECKLIST);
  console.log("\nFull guide: references/endpoint-rule-exclusion-best-practices.md");
}
