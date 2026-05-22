# Kibana Cases API Reference

Reference for the Kibana Cases REST API endpoints used by the case-management skill. Full documentation:
[Kibana Cases API](https://www.elastic.co/docs/api/doc/kibana/group/endpoint-cases)

## Contents

- Create a case
- Search/find cases
- Get case details
- Update cases
- Add comments
- Attach alerts
- Get alerts for a case
- Find cases for an alert

## Create a case

`POST /api/cases`

```json
{
  "title": "Malicious DLL sideloading on host1",
  "description": "Crypto clipper malware detected...",
  "tags": ["classification:malicious", "confidence:88", "mitre:T1574.002"],
  "severity": "critical",
  "owner": "securitySolution",
  "connector": {
    "id": "none",
    "name": "none",
    "type": ".none",
    "fields": null
  },
  "settings": {
    "syncAlerts": true
  }
}
```

**Response** returns the full case object with `id`, `version`, `created_at`, etc.

**Severity values**: `low`, `medium`, `high`, `critical`

**Owner**: Use `securitySolution` for Elastic Security cases.

## Search/find cases

`GET /api/cases/_find`

Query parameters:

| Param       | Description                                                         |
| ----------- | ------------------------------------------------------------------- |
| `search`    | Free-text search across title, description, comments                |
| `tags`      | Filter by tags (repeat for multiple)                                |
| `status`    | `open`, `in-progress`, `closed`                                     |
| `severity`  | `low`, `medium`, `high`, `critical`                                 |
| `sortField` | `createdAt`, `updatedAt`, `closedAt`, `title`, `severity`, `status` |
| `sortOrder` | `asc`, `desc`                                                       |
| `page`      | Page number (1-based)                                               |
| `perPage`   | Results per page (default 20, max 100)                              |
| `owner`     | Filter by owner (e.g., `securitySolution`)                          |

Example:

```text
GET /api/cases/_find?tags=classification:malicious&status=open&sortField=createdAt&sortOrder=desc
```

## Get case details

`GET /api/cases/{caseId}`

Returns the full case object including comments count, alerts count, and connector info.

## Update cases

`PATCH /api/cases`

Body is an array of case updates:

```json
{
  "cases": [
    {
      "id": "<case_id>",
      "version": "<case_version>",
      "status": "closed",
      "severity": "low",
      "tags": ["classification:benign", "confidence:10"]
    }
  ]
}
```

The `version` field is required for optimistic concurrency control. Get it from a prior GET request.

## Add comments

`POST /api/cases/{caseId}/comments`

User comment:

```json
{
  "type": "user",
  "comment": "Process tree analysis shows legitimate Lenovo utility loading unsigned DLL..."
}
```

## Attach alerts

`POST /api/cases/{caseId}/comments`

Alert attachment (one alert):

```json
{
  "type": "alert",
  "alertId": "<alert_doc_id>",
  "index": ".ds-.alerts-security.alerts-default-2025.12.01-000013",
  "rule": {
    "id": "<rule_id>",
    "name": "Malicious Behavior Detection Alert"
  },
  "owner": "securitySolution"
}
```

Multiple alerts can be attached by repeating the call or using bulk attachment.

## Get alerts for a case

`GET /api/cases/{caseId}/alerts`

Returns all alerts linked to the case.

## Find cases for an alert

`GET /api/cases/alerts/{alertId}`

Returns all cases that contain the given alert ID. Useful for checking if an alert is already part of a case before
creating a new one.

## Required headers

All requests require:

```text
Content-Type: application/json
kbn-xsrf: true
Authorization: ApiKey <base64_api_key>
```

These are handled automatically by `kibana-client.js` in the shared directory.

## Spaces

If using Kibana Spaces, prefix paths with `/s/<space_name>`:

```text
POST /s/security-ops/api/cases
```

The `KibanaClient` accepts a `space` parameter for this.
