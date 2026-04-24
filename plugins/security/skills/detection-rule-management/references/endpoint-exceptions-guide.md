# Endpoint Exceptions – Quick Reference

- **Docs:**
  [Add and manage exceptions – Endpoint rule exceptions](https://www.elastic.co/docs/solutions/security/detect-and-alert/add-manage-exceptions#endpoint-rule-exceptions)
- **Where they live:** Endpoint exceptions are in **Security → Exceptions → Endpoint Security Exception List**
  (`/app/security/exceptions`). They are **not** the same as SIEM/detection rule exceptions (which are tied to a
  specific rule).
- **API:** Add items via `POST /api/endpoint_list/items`. The list has `list_id: endpoint_list`,
  `namespace_type: agnostic`. Items apply to Elastic Endpoint (and to detection rules that use the Endpoint exception
  list).

## Nested fields (use in conditions)

For exceptions that need code signature or token details, use **nested conditions** in the Kibana UI. Supported nested
objects include:

- `process.Ext.code_signature`
- `process.parent.Ext.code_signature`
- `process.Ext.token.privileges`
- `file.Ext.code_signature`
- `Target.process.Ext.code_signature`
- (See full list in
  [Exceptions with nested conditions](https://www.elastic.co/docs/solutions/security/detect-and-alert/add-manage-exceptions#exceptions-with-nested-conditions).)

Example: exclude processes with trusted code signature – add a condition on `process.Ext.code_signature` with nested
condition `subject_name` or use the trusted/status field as required by your Kibana version.

## Resilient exception design

| Do                                                                                     | Avoid                                                                                                            |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Always include `rule.id` or `rule.name`** so the exception applies only to that rule | Adding only process/parent/file conditions (applies to all rules using the list)                                 |
| Use **full path** when known (e.g. `C:\Python39\python.exe`)                           | Generic patterns like `*\python.exe` or `*\binary.exe`                                                           |
| Use `process.executable` (path)                                                        | Rely only on `process.name` (evadable by rename)                                                                 |
| Wildcards only for variable path segments (e.g. version dirs)                          | Broad wildcards (e.g. `*\*.exe`)                                                                                 |
| Combine path + parent path + code_signature when possible                              | Single-field exceptions for high-risk rules                                                                      |
| **Run single-host deep (entity cross-check) before adding** — mandatory                | Skipping Step 4b; excluding a process that appears in other rules/event types (e.g. memory_signature, shellcode) |

## Searching the alerts index for endpoint rules

When querying `.alerts-security.alerts-*` for endpoint behavior rules, use **`rule.name`** (e.g. in ES|QL
`rule.name == "Suspicious PowerShell Execution"` or in KQL `rule.name:<name>`). Use `rule.id` in aggregations once you
have it from a sample alert.

## Rule logic and existing exclusions

- Prepackaged behavior rules:
  [elastic/protections-artifacts/behavior/rules](https://github.com/elastic/protections-artifacts/tree/main/behavior/rules)
  (windows, linux, macos, cross-platform).
- Rule content (query and built-in exclusions) is not stored in Elasticsearch; use `fetch_endpoint_rule_from_github.py`
  or Kibana Detection Engine rule get by rule ID to see existing exclusion patterns.
