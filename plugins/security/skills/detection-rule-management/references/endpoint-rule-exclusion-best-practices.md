# Endpoint rule exclusion best practices

Best practices for designing **evasion-resilient exclusions** when tuning Elastic Defend behavior rules—whether you add
**Endpoint exceptions** (Security → Exceptions) or contribute **rule changes** (e.g. to a rule repo). These improve
detection quality and EQL performance.

**Reference:** [EQL syntax](https://www.elastic.co/docs/reference/query-languages/eql/eql-syntax). Endpoint rules use
EQL in the rule `query`; exceptions use the same field semantics.

---

## Paths and wildcards

- **Use full path for resilience:** When the path is known, use the **full process path** (e.g.
  `C:\Python39\python.exe`, `C:\Program Files\Vendor\agent.exe`). Do **not** use generic patterns like `*\python.exe` or
  `*\binary.exe`—they are less resilient and can match unintended locations.
- **Use `?:\\` for drive-agnostic paths** (e.g. `?:\\Program Files\\Vendor\\*\\bin\\agent.exe`), not fixed `C:\\`.
- **Case-insensitive matching:** Use the **`:`** operator for paths (process executable, file path, DLL path)—attackers
  can control casing. Prefer `process.executable : ("path1", "path2")` over `==` or `in`.
- **Wildcards only where necessary:** Use wildcards **only for variable path segments** (e.g. version number, GUID). Do
  **not** wildcard non-variable segments (e.g. `Program Files` is not user-writable; use literal `Program Files` unless
  you have observed the same pattern from different folders). Overuse of wildcards can hurt **EQL execution
  performance** and weakens specificity.
- **User-writable paths** (e.g. `?:\\Users\\*\\AppData\\*`): Do **not** exclude unconditionally—an attacker can drop a
  binary there to evade. Either avoid excluding those paths or **gate them behind trust signals** (e.g.
  `process.code_signature.trusted == true` and `process.code_signature.subject_name : ("Expected Vendor")`).

---

## Scripting utilities / LOLBins (cmd, powershell, bash, wscript, mshta, etc.)

- **Never exclude by path only or by cmdline/args only.** Attackers use the same binaries. **Always combine**
  `process.name` or `process.parent.name` or **executable path** with **args or cmdline**.
- **Prefer `process.args` / `process.parent.args` + path** when the pattern is **not** random or variable:
  - **Good:** `not (process.args : "a" and process.args : "b" and process.parent.executable : "path")`
  - **Avoid when possible:** `not (process.command_line like~ "*a*b*" and process.parent.executable : "path")`
- **Overuse of wildcards on `command_line`** when unnecessary can hurt **endpoint EQL execution performance**. Use
  cmdline with wildcards only when you truly need substring or variable patterns (e.g. random tokens). Otherwise use
  **args + path**.
- **Windows LOLBins:** Prefer `process.pe.original_file_name` for resilience; use **`:`** for case-insensitivity (e.g.
  `process.pe.original_file_name : "curl.exe"`).

---

## API rules (events from `api where`)

- **Do not** base exclusions on **process-level** fields only (e.g. `process.code_signature.trusted` +
  `process.code_signature.subject_name`). An attacker can **sideload a malicious DLL** into a signed process and trigger
  the API from that DLL, bypassing the rule.
- **Do not** exclude solely on **`process.thread.Ext.call_stack_final_user_module.path`** or **`.hash`** for the same
  reason (the “final user module” could be the injected DLL).
- **Prefer** **`process.thread.Ext.call_stack_final_user_module.path`** or **`.hash`** when they give a good, narrow
  option (e.g. known benign DLL). If no good option, **then** use **`process.thread.Ext.call_stack_summary`** (and
  `_arraysearch(process.thread.Ext.call_stack, ...)` on `symbol_info`) to exclude known benign **call patterns** (e.g.
  specific DLL sequences), not a single module path/hash or the process signature.

---

## Code signature and context

- **Code signature subject_name:** Use **`:`** (case-insensitive) for vendor names—casing varies across deployments
  (e.g. "TeamViewer" vs "Teamviewer"). `process.code_signature.subject_name : ("Vendor Name", ...)`.
- **Resilient exclusions:** When the alert includes **code signature** and **rule-relevant context** (e.g.
  `process.Ext.desktop_name` for hidden-window rules), combine them: e.g. exclude when
  `process.code_signature.trusted == true` **and** `process.code_signature.subject_name : ("Vendor", ...)` **and**
  `process.Ext.desktop_name : ("WinSta0\\Winlogon", ...)` rather than path alone. Use the same fields the rule already
  relies on to narrow the exclusion to the benign scenario.

---

## Rule query hygiene (when editing rule source)

- **Do not** add comments in the rule query that duplicate the PR or ticket (e.g. `/* resilient FP exclusions */`). Keep
  rationale in the PR or change description.
- **Limit changes to excluding false positives;** do not extend detection scope (e.g. adding new “or” conditions that
  broaden what the rule fires on).

---

## PR / change description (when contributing rule changes)

- **Title format:** `[Rule Tuning] <rule_name>`.
- **updated_date:** Set to the **current date** (YYYY-MM-DD) when you change the rule.
- **Sample alerts for review:** When the number of excluded FP patterns is **low (≤ 3–5)**, include **one sample alert
  per FP pattern** in the PR/description, not as a separate file. Use **`<details>` / `<summary>`** so the JSON is
  collapsed by default (e.g. under "## FP sample alerts", wrap the ```json block in `<details><summary>…</summary> …
  </details>`). Strip PII (host, user, cluster, agent id, policy/artifacts); keep fields that justify the exclusion
  (process, rule, code signature, command_line/args, parent, rule-specific context).

---

## Checklist (exclusions)

- [ ] Paths: `?:\\` where appropriate; **`:`** for case-insensitivity; wildcards **only** for variable segments.
- [ ] LOLBins/scripting: **combined** name or path **with** args or cmdline; prefer **args + path** over command_line
      wildcards when pattern is not variable.
- [ ] API rules: no process-only exclusions; use **call_stack_final_user_module** or **call_stack_summary** for benign
      call patterns.
- [ ] User-writable paths: not excluded unconditionally; gated by trust/code signature when used.
- [ ] No in-query comments that duplicate the PR/description.
- [ ] When contributing rule changes: **updated_date** set; sample alerts (if ≤ 3–5 patterns) in description with
      `<details>`/`<summary>`; PII stripped.
