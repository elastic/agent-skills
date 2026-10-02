# Kibana Cases API Reference

Reference for the Kibana Cases REST API endpoints used by the `kibana-cases` skill. Full documentation:
[Kibana Cases API](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-cases).

Cases are partitioned by solution via the `owner` field: `securitySolution` (Security), `observability` (Observability),
or `cases` (Stack Management). Every create sets `owner`; every read filters by it. Authentication, content-type, and
CSRF headers are handled by the `elastic` CLI — do not set them by hand. See the [Operations](../SKILL.md#operations)
table for the CLI command that maps to each endpoint below.

## Contents

- Create a case
- Search/find cases
- Get case details
- Update cases (bulk)
- Delete cases
- Add comments and attach alerts
- List a case's attachments
- Get alerts for a case / find cases for an alert
- Configuration (templates, custom fields)
- Observables (IOCs)

## Create a case

`POST /api/cases`

```json
{
  "title": "Malicious DLL sideloading on host1",
  "description": "Crypto clipper malware detected...",
  "tags": ["classification:malicious", "mitre:T1574.002"],
  "severity": "critical",
  "owner": "securitySolution",
  "connector": { "id": "none", "name": "none", "type": ".none", "fields": null },
  "settings": { "syncAlerts": true }
}
```

Response returns the full case object with `id`, `version`, `created_at`, etc.

- **Severity values**: `low`, `medium`, `high`, `critical`
- **Owner**: `securitySolution`, `observability`, or `cases` — set from the confirmed solution context.

## Search/find cases

`GET /api/cases/_find`

| Param       | Description                                                         |
| ----------- | ------------------------------------------------------------------- |
| `owner`     | Solution filter (`securitySolution`, `observability`, `cases`)      |
| `search`    | Free-text across title, description, comments                       |
| `tags`      | Filter by tags (exact match; repeat for multiple)                   |
| `status`    | `open`, `in-progress`, `closed`                                     |
| `severity`  | `low`, `medium`, `high`, `critical`                                 |
| `sortField` | `createdAt`, `updatedAt`, `closedAt`, `title`, `severity`, `status` |
| `sortOrder` | `asc`, `desc`                                                       |
| `page`      | Page number (1-based)                                               |
| `perPage`   | Results per page (default 20, max 100)                              |

Example:
`GET /api/cases/_find?owner=securitySolution&tags=classification:malicious&status=open&sortField=createdAt&sortOrder=desc`

## Get case details

`GET /api/cases/{caseId}` — returns the full case object including comment and alert counts, `version`, and connector.

## Update cases (bulk)

`PATCH /api/cases`

```json
{
  "cases": [
    {
      "id": "<case_id>",
      "version": "<case_version>",
      "status": "closed",
      "severity": "low",
      "tags": ["classification:benign"]
    }
  ]
}
```

`version` is required for optimistic concurrency — read it from a prior GET. Update two or more cases by adding entries
to the `cases` array in a single request. Assignee-only changes use the same endpoint with an `assignees` array of user
profile UIDs.

## Delete cases

`DELETE /api/cases?ids=["<case_id>", ...]`

## Add comments and attach alerts

`POST /api/cases/{caseId}/comments`

User comment:

```json
{ "type": "user", "comment": "Process tree analysis shows...", "owner": "securitySolution" }
```

Alert attachment (one alert per call; `rule.id`/`rule.name` required):

```json
{
  "type": "alert",
  "alertId": "<alert_doc_id>",
  "index": ".ds-.alerts-security.alerts-default-2025.12.01-000013",
  "rule": { "id": "<rule_id>", "name": "Malicious Behavior Detection Alert" },
  "owner": "securitySolution"
}
```

The bulk attachment endpoint (`POST /internal/cases/{caseId}/attachments/_bulk_create`) is internal — attach alerts one
at a time through the public endpoint above.

## List a case's attachments

`GET /api/cases/{caseId}/comments/_find` — returns the case's attachments (comments, alerts, events). Filter to
`type === "user"` for discussion comments.

## Get alerts for a case / find cases for an alert

- `GET /api/cases/{caseId}/alerts` — all alerts linked to the case.
- `GET /api/cases/alerts/{alertId}` — all cases containing the given alert. Use before creating a case to avoid a
  duplicate.

## Configuration (templates, custom fields)

`GET /api/cases/configure?owner=<owner>` — returns the solution's case configuration, including templates and custom
field definitions. To apply a template, merge its fields (and `customFields`) into the create payload.

## Observables (IOCs)

Available on 9.x Kibana. Primarily used for Security cases.

- `POST /api/cases/{caseId}/observables` — add an observable (e.g., IP, domain, file hash, URL).
- `PATCH /api/cases/{caseId}/observables/{observableId}` — update an observable.
- `DELETE /api/cases/{caseId}/observables/{observableId}` — remove an observable.

## Spaces

For non-default Kibana Spaces, prefix paths with `/s/<space_id>`:

```text
POST /s/security-ops/api/cases
```
