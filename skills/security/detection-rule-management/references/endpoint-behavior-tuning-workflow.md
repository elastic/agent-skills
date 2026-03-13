# Endpoint Behavior Rules Tuning Workflow

Analyze alerts from **Elastic Endpoint behavior rules** and add **Endpoint exceptions** to reduce false positives.
Endpoint exceptions live in **Security → Exceptions → Endpoint Security Exception List** (`/app/security/exceptions`),
not under individual SIEM rules. Use the scripts in this skill for rule lookup, GitHub rule fetch, and adding endpoint
list items.

**Reference:**
[Add and manage exceptions (Endpoint)](https://www.elastic.co/docs/solutions/security/detect-and-alert/add-manage-exceptions#endpoint-rule-exceptions).
Rule logic:
[protections-artifacts/behavior/rules](https://github.com/elastic/protections-artifacts/tree/main/behavior/rules) or
Kibana rule get by ID.

## Critical principles (endpoint behavior)

- **Start with rule definition from protections-artifacts** (Step 1b) to understand query logic and exclusions; avoid
  broad exclusions.
- **When in doubt, do not add an exception** — return your conclusion and let the user confirm.
- **Always scope to the rule:** Include `rule.id:is:<uuid>` or `rule.name:is:<name>` first; otherwise the exception
  applies to all rules.
- **Use full path over process name** (e.g. `C:\Python39\python.exe`); wildcards only for variable segments. See
  [endpoint-rule-exclusion-best-practices.md](endpoint-rule-exclusion-best-practices.md).
- **Step 4b is mandatory:** Run entity cross-check before any endpoint exception; skipping can exclude true positives.
- **Validate before applying:** Simulate (Step 5b); aim for ≥60% noise reduction.

## Endpoint tuning progress

```text
- [ ] Step 1: Identify the noisy rule and get definition (Kibana)
- [ ] Step 1b: Pull rule content from GitHub (query + exclusions)
- [ ] Step 2: FP likelihood (host/user spread, 24h)
- [ ] Step 3: Top noisy patterns (ES|QL)
- [ ] Step 4: Single-host entity_id check
- [ ] Step 4b: Single-host deep investigation (entity cross-check) — MANDATORY; do not skip
- [ ] Step 5: Design exception (aligned with rule logic; use full path for resilience)
- [ ] Step 5b: Simulate exception impact (before/after)
- [ ] Step 6: Add endpoint exception and verify
```

## Step 1 & 1b: Identify rule and pull from GitHub

Endpoint behavior rule definitions live in the protections-artifacts repo, not in Kibana. To get the **rule id** (UUID)
and the rule definition:

1. **Get rule.id from the alerts index** by querying with the rule name (from noisy-rules or the UI). Replace
   `<rule_name>` with the exact behavior rule name (e.g. `Suspicious PowerShell Execution`):

```esql
FROM .alerts-security.alerts-*
| WHERE rule.name == "<rule_name>"
| STATS count = COUNT(*) BY rule.id
| SORT count DESC
| LIMIT 1
```

1. **Fetch the rule definition** from protections-artifacts using the rule id:

```bash
node skills/security/detection-rule-management/scripts/fetch-endpoint-rule-from-github.js --rule-id <rule_id>
```

Use the printed **query** from GitHub to see fields and existing exclusions; then proceed to Step 2–5b. For SIEM rules
(not endpoint behavior), use `rule-manager.js find --filter "alert.attributes.name: ..."` to look up by name on the
stack.

## Step 2–4b: FP likelihood, patterns, entity cross-check

**When searching the alerts index for endpoint rules, use `rule.name`** (e.g. in ES|QL
`rule.name == "Suspicious PowerShell Execution"` or in KQL `rule.name:<name>`). Use `rule.id` in aggregations once you
have it from a sample alert.

- **Step 2:** ES|QL on `.alerts-security.alerts-*` with `rule.name == "<rule_name>"` (or `rule.id == "<rule_id>"`) and
  `@timestamp >= now() - 24 hours`;
  `STATS n_hosts = COUNT_DISTINCT(host.id), n_users = COUNT_DISTINCT(user.name) BY rule.id`. ≥10 hosts or ≥5 users →
  likely broad FP.
- **Step 3:** Top patterns by `process.executable`, `process.parent.executable`, `user.name`, `host.name` (filter by
  `rule.name` or `rule.id`).
- **Step 4:** For single host, check `process.entity_id` across alerts: `WHERE process.entity_id == "<id>"` and
  `STATS ... BY rule.id, event.code`.
- **Step 4b (mandatory — do not skip):** Single-host deep investigation. Take one sample alert; run entity cross-check
  by `rule.name` and `event.code`. If the same `process.entity_id` or `process.parent.entity_id` appears in other rules
  or event types (e.g. memory_signature, shellcode_thread, ransomware) → treat as TP, do not add exception. You must
  complete this step before adding any endpoint exception. Entity cross-check query:

```esql
FROM .alerts-security.alerts-*
| WHERE (process.entity_id == "<entity_id>" OR process.parent.entity_id == "<entity_id>")
  AND @timestamp >= NOW() - 7 days
| STATS alert_count = COUNT(*) BY rule.name, event.code
| SORT alert_count DESC
```

## Step 5 & 5b: Design exception and simulate impact

Match the rule's event type and exclusion style. Use full path when known; wildcards only for variable segments. For
LOLBins use path + args. **Simulate before applying:** baseline count, then same query with
`AND NOT (process.executable LIKE "...")`. Aim for ≥60% reduction.

Baseline query:

```esql
FROM .alerts-security.alerts-*
| WHERE rule.name == "<rule_name>"
  AND @timestamp >= NOW() - 24 hours
| STATS alert_count = COUNT(*), distinct_hosts = COUNT_DISTINCT(host.id)
```

After-exception query (add your exclusion condition):

```esql
FROM .alerts-security.alerts-*
| WHERE rule.name == "<rule_name>"
  AND @timestamp >= NOW() - 24 hours
  AND NOT (process.executable LIKE "<exception_pattern>")
| STATS alert_count = COUNT(*), distinct_hosts = COUNT_DISTINCT(host.id)
```

## Step 6: Add endpoint exception

Only after Step 5b shows meaningful reduction and you are confident the pattern is FP. **Always include rule scope**
(`rule.id` or `rule.name` first):

```bash
node skills/security/detection-rule-management/scripts/add-endpoint-exception.js \
  --name "Exclude <short description> (<rule name>)" \
  --entries "rule.id:is:<rule_uuid>" "process.executable:matches:C:\\Program Files\\Vendor\\*\\agent.exe" \
  --comment "FP: Legitimate agent; path + parent verified" \
  --os-types windows
```

Verify in Kibana: **Security → Exceptions** → Endpoint Security Exception List.

For full workflow detail, event-type strategies (single-event vs API/call stack), and LOLBin guidance, see
[endpoint-exceptions-guide.md](endpoint-exceptions-guide.md) and
[endpoint-rule-exclusion-best-practices.md](endpoint-rule-exclusion-best-practices.md).
