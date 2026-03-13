# Cloud Network Security — API Reference

All Serverless traffic filter API calls use base URL `https://api.elastic-cloud.com` and require the header
`Authorization: ApiKey $EC_API_KEY`.

> **Note:** The API uses the term "traffic filters" in endpoint paths and JSON fields. The parent skill uses "network
> security" as the umbrella term. Both refer to the same concept.

## Table of Contents

- [Traffic Filters](#traffic-filters)
  - [List traffic filters](#list-traffic-filters)
  - [Create a traffic filter](#create-a-traffic-filter)
  - [Get a traffic filter](#get-a-traffic-filter)
  - [Update a traffic filter](#update-a-traffic-filter)
  - [Delete a traffic filter](#delete-a-traffic-filter)
- [PrivateLink Metadata](#privatelink-metadata)
  - [List PrivateLink region metadata](#list-privatelink-region-metadata)
- [Schemas](#schemas)
  - [TrafficFilterRequest](#trafficfilterrequest)
  - [PatchTrafficFilterRequest](#patchtrafficfilterrequest)
  - [TrafficFilterRule](#trafficfilterrule)
  - [TrafficFilterInfo](#trafficfilterinfo)
- [Project Association](#project-association)

---

## Traffic Filters

### List traffic filters

```text
GET /api/v1/serverless/traffic-filters
```

Returns all traffic filters for the authenticated organization.

**Query parameters:**

| Parameter            | Type    | Required | Description                             |
| -------------------- | ------- | -------- | --------------------------------------- |
| `region`             | string  | No       | Limit results to this region only       |
| `include_by_default` | boolean | No       | Filter by the `include_by_default` flag |

**Response (200):**

```json
{
  "items": [
    {
      "id": "tf-12345",
      "name": "Office IP allowlist",
      "description": "Allow office network",
      "type": "ip",
      "include_by_default": false,
      "region": "us-east-1",
      "rules": [{ "source": "203.0.113.0/24", "description": "Office network" }]
    }
  ]
}
```

### Create a traffic filter

```text
POST /api/v1/serverless/traffic-filters
```

Creates a traffic filter consisting of a set of rules.

**Request body:** [TrafficFilterRequest](#trafficfilterrequest)

**Response (201):** [TrafficFilterInfo](#trafficfilterinfo) — includes the generated `id`.

**Example — IP filter:**

```json
{
  "name": "Office IPs",
  "description": "Corporate office allowlist",
  "type": "ip",
  "region": "us-east-1",
  "include_by_default": false,
  "rules": [
    { "source": "203.0.113.0/24", "description": "Office network" },
    { "source": "198.51.100.5", "description": "VPN gateway" }
  ]
}
```

**Example — VPC filter (AWS PrivateLink):**

```json
{
  "name": "Production VPC",
  "description": "Restrict to production VPC endpoint",
  "type": "vpce",
  "region": "us-east-1",
  "include_by_default": false,
  "rules": [{ "source": "vpce-0abc123def456", "description": "Production VPC endpoint" }]
}
```

### Get a traffic filter

```text
GET /api/v1/serverless/traffic-filters/{id}
```

Retrieves a single traffic filter by ID.

**Path parameters:**

| Parameter | Type   | Required | Description           |
| --------- | ------ | -------- | --------------------- |
| `id`      | string | Yes      | The traffic filter ID |

**Response (200):** [TrafficFilterInfo](#trafficfilterinfo)

### Update a traffic filter

```text
PATCH /api/v1/serverless/traffic-filters/{id}
```

Partially updates a traffic filter. Only include the fields to change.

**Path parameters:**

| Parameter | Type   | Required | Description           |
| --------- | ------ | -------- | --------------------- |
| `id`      | string | Yes      | The traffic filter ID |

**Request body:** [PatchTrafficFilterRequest](#patchtrafficfilterrequest)

**Response (200):** [TrafficFilterInfo](#trafficfilterinfo)

> **Important:** When updating `rules`, provide the **complete** rule set. Any rules not included in the update are
> removed. To add a rule, include all existing rules plus the new one.

### Delete a traffic filter

```text
DELETE /api/v1/serverless/traffic-filters/{id}
```

Deletes a traffic filter by ID. Fails with `400` if the filter is still associated with a project. Disassociate the
filter from all projects first using the project PATCH endpoint.

**Path parameters:**

| Parameter | Type   | Required | Description           |
| --------- | ------ | -------- | --------------------- |
| `id`      | string | Yes      | The traffic filter ID |

**Response (200):** Empty response on success.

**Error (400):** Returns an error if the filter is associated with a project:

```json
{
  "errors": [{ "message": "traffic filter is associated with <project-id>, remove the association first" }]
}
```

---

## PrivateLink Metadata

### List PrivateLink region metadata

```text
GET /api/v1/serverless/traffic-filters/metadata
```

Returns region-specific PrivateLink connectivity metadata (service names, domain names, availability zones). Use this to
look up the VPC service name needed when creating a VPC endpoint in the AWS console.

**Query parameters:**

| Parameter | Type   | Required | Description                          |
| --------- | ------ | -------- | ------------------------------------ |
| `region`  | string | No       | Filter metadata to a specific region |

**Response (200):**

```json
{
  "regions": [
    {
      "region": "us-east-1",
      "service_name": "com.amazonaws.vpce.us-east-1.vpce-svc-...",
      "domain_name": "private.us-east-1.aws.elastic.cloud",
      "availability_zones": ["use1-az2", "use1-az4", "use1-az6"]
    }
  ]
}
```

---

## Schemas

### TrafficFilterRequest

Used when creating a traffic filter (`POST`).

| Field                | Type    | Required | Description                                                         |
| -------------------- | ------- | -------- | ------------------------------------------------------------------- |
| `name`               | string  | Yes      | Display name for the filter                                         |
| `description`        | string  | No       | Human-readable description                                          |
| `type`               | string  | No       | `ip` (default) or `vpce`                                            |
| `region`             | string  | Yes      | AWS region the filter applies to                                    |
| `include_by_default` | boolean | No       | Auto-associate with all new projects in the region (default: false) |
| `rules`              | array   | No       | List of [TrafficFilterRule](#trafficfilterrule) objects             |

### PatchTrafficFilterRequest

Used when updating a traffic filter (`PATCH`). All fields are optional; only included fields are updated.

| Field                | Type    | Required | Description                                                                  |
| -------------------- | ------- | -------- | ---------------------------------------------------------------------------- |
| `name`               | string  | No       | Updated display name                                                         |
| `description`        | string  | No       | Updated description                                                          |
| `include_by_default` | boolean | No       | Updated auto-association flag                                                |
| `rules`              | array   | No       | Complete replacement list of [TrafficFilterRule](#trafficfilterrule) objects |

> `type` and `region` cannot be changed after creation.

### TrafficFilterRule

A single rule within a traffic filter.

| Field         | Type   | Required | Description                                                                  |
| ------------- | ------ | -------- | ---------------------------------------------------------------------------- |
| `source`      | string | No       | IP address, CIDR block (for `ip` type), or VPC endpoint ID (for `vpce` type) |
| `description` | string | No       | Human-readable description of this rule                                      |

### TrafficFilterInfo

Returned by all read and write operations. Extends [TrafficFilterRequest](#trafficfilterrequest) with an `id` field.

| Field                | Type    | Description                                             |
| -------------------- | ------- | ------------------------------------------------------- |
| `id`                 | string  | Unique traffic filter ID (generated by the API)         |
| `name`               | string  | Display name                                            |
| `description`        | string  | Human-readable description                              |
| `type`               | string  | `ip` or `vpce`                                          |
| `include_by_default` | boolean | Auto-association flag                                   |
| `region`             | string  | AWS region                                              |
| `rules`              | array   | List of [TrafficFilterRule](#trafficfilterrule) objects |

---

## Project Association

Traffic filters are associated with Serverless projects using the **project PATCH endpoint**, not through the traffic
filter API. This is handled by the **cloud-manage-project** skill.

### Associate a filter with a project

```text
PATCH /api/v1/serverless/projects/{type}/{id}
```

Include the `traffic_filters` field with the **complete list** of filter IDs to associate:

```json
{
  "traffic_filters": [{ "id": "tf-12345" }, { "id": "tf-67890" }]
}
```

Any filter ID not included in the list is disassociated from the project. To remove all filters, send an empty array.

### List projects associated with a filter

```text
GET /api/v1/serverless/projects/{type}?traffic_filter={filter-id}
```

Returns projects that have the specified filter associated.

### Include filters at project creation

```text
POST /api/v1/serverless/projects/{type}
```

Include `traffic_filters` in the creation request body to associate filters from the start:

```json
{
  "name": "my-project",
  "region_id": "us-east-1",
  "traffic_filters": [{ "id": "tf-12345" }]
}
```

For full project creation and management schemas, see the **cloud-create-project** and **cloud-manage-project** skills.
