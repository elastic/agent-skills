---
name: cloud-network-security
description: >
  Manage Serverless network security (traffic filters): create, update, and delete
  IP filters and AWS PrivateLink VPC filters. Use when restricting network access
  or configuring private connectivity.
compatibility: >
  Requires Python 3.8+, network access to the Elastic Cloud API (api.elastic-cloud.com).
  Environment variables: EC_API_KEY (required, set by cloud-setup), EC_BASE_URL (optional,
  defaults to https://api.elastic-cloud.com).
metadata:
  author: elastic
  version: 0.1.0
---

# Cloud Network Security

Manage network security policies for Elastic Cloud Serverless projects: IP filters to allowlist specific IPs or CIDRs,
and VPC filters (AWS PrivateLink) to restrict traffic to specific VPC endpoints.

> **Prerequisite:** This skill assumes the **cloud-setup** skill has already run — `EC_API_KEY` is set in the
> environment and the organization context is established. If `EC_API_KEY` is missing, instruct the agent to invoke
> **cloud-setup** first. Do NOT prompt the user for an API key directly.

For project creation and day-2 operations (including associating filters with projects), see **cloud-create-project**
and **cloud-manage-project**. For identity and access management (users, roles, API keys), see
**cloud-access-management**.

For detailed API endpoints and request schemas, see [references/api-reference.md](references/api-reference.md).

## Terminology

This skill uses **network security** as the umbrella term, aligned with the Elastic Cloud UI direction. The underlying
API uses **traffic filters** — you will see `traffic-filters` in endpoint paths and `traffic_filters` in JSON fields.
When a user or agent says "traffic filter," they mean the same thing as "network security policy." The two filter types
are **IP filters** (type `ip`) and **VPC filters** (type `vpce`).

## Jobs to Be Done

- Create an IP filter to restrict ingress to specific IPs or CIDR blocks
- Create a VPC filter (AWS PrivateLink) to restrict traffic to specific VPC endpoint IDs
- List, inspect, update, and delete network security policies
- Look up PrivateLink region metadata (service names, domain names, availability zones)
- Associate or disassociate filters with Serverless projects (delegates to **cloud-manage-project**)
- Audit the current network security posture for an organization

## Prerequisites

| Item            | Description                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------- |
| **EC_API_KEY**  | Cloud API key (set by **cloud-setup**). Required for all operations.                        |
| **Region**      | Filters are region-scoped. The user must specify the target region when creating filters.   |
| **Project IDs** | Required only when associating filters with projects (handled by **cloud-manage-project**). |

Run `python3 skills/cloud/network-security/scripts/cloud_network_security.py list-filters` to verify that `EC_API_KEY`
is valid before proceeding with any operation.

## Decomposing Network Security Requests

When the user describes a network security need in natural language (for example, "restrict my search project to our
office IP"), break the request into discrete tasks before executing.

### Step 1 — Identify the components

| Component       | Question to answer                                                     |
| --------------- | ---------------------------------------------------------------------- |
| **Filter type** | IP filter (public IPs/CIDRs) or VPC filter (AWS PrivateLink endpoint)? |
| **Region**      | Which AWS region are the target projects in?                           |
| **Rules**       | What source IPs, CIDRs, or VPC endpoint IDs should be allowed?         |
| **Scope**       | Apply to all new projects by default, or specific projects only?       |
| **Projects**    | Which existing projects should this filter be associated with?         |

### Step 2 — Check existing state

Before creating a new filter, check what already exists:

```bash
python3 skills/cloud/network-security/scripts/cloud_network_security.py list-filters --region us-east-1
```

**Filter hygiene:** If an existing filter already covers the same source rules **for the same purpose**, reuse it
instead of creating a duplicate. Filters are region-scoped and can be associated with multiple projects, so a single
filter with the right rules serves many projects. Two filters with identical source rules are fine when they serve
different purposes (for example, different teams managing their own policies), but creating a second filter for the same
purpose is unnecessary.

### Step 3 — Create the filter

Run the appropriate command from `skills/cloud/network-security/scripts/cloud_network_security.py`.

### Step 4 — Associate with projects

Filter association is managed using the project PATCH endpoint. Use **cloud-manage-project** to associate or
disassociate filters:

```text
PATCH /api/v1/serverless/projects/{type}/{id}
Body: { "traffic_filters": [{ "id": "filter-id-1" }, { "id": "filter-id-2" }] }
```

When updating associations, provide the **complete list** of filter IDs. Any filter not included in the list is
disassociated from the project.

### Step 5 — Verify

After execution, list filters again or GET the project to confirm the change took effect.

## IP Filters versus VPC Filters

| Aspect            | IP Filter (`ip`)                                   | VPC Filter (`vpce`)                                      |
| ----------------- | -------------------------------------------------- | -------------------------------------------------------- |
| **Purpose**       | Allowlist public IP addresses or CIDR blocks       | Restrict traffic to specific AWS VPC endpoint IDs        |
| **Use case**      | Office IPs, CI/CD runners, partner access          | Private connectivity without public internet exposure    |
| **Source format** | IP address or CIDR (for example, `203.0.113.0/24`) | AWS VPC endpoint ID (for example, `vpce-0abc123def456`)  |
| **Network path**  | Public internet                                    | AWS PrivateLink (private, never leaves AWS network)      |
| **Prerequisite**  | None                                               | VPC endpoint and DNS record created in AWS console first |

> **Key concept:** Private connectivity in AWS is accepted by default in Elastic Cloud. Creating a VPC filter is only
> needed to **restrict** traffic to specific VPC endpoint IDs. If you only need private connectivity (without
> filtering), create the VPC endpoint and DNS record in AWS — no filter is needed on the Elastic Cloud side.

## Examples

### Allowlist an office IP range

**Prompt:** "Only allow traffic from our office network 203.0.113.0/24 to projects in us-east-1."

```bash
python3 skills/cloud/network-security/scripts/cloud_network_security.py create-filter \
  --name "Office IP allowlist" \
  --type ip \
  --region us-east-1 \
  --rules '[{"source": "203.0.113.0/24", "description": "Office network"}]'
```

Then associate the filter with specific projects using **cloud-manage-project**.

### Restrict traffic to a VPC endpoint

**Prompt:** "Lock down my observability project to only accept traffic from our VPC endpoint."

```bash
python3 skills/cloud/network-security/scripts/cloud_network_security.py create-filter \
  --name "Production VPC" \
  --type vpce \
  --region us-east-1 \
  --rules '[{"source": "vpce-0abc123def456", "description": "Production VPC endpoint"}]'
```

### List all filters in a region

**Prompt:** "Show me all network security policies in eu-west-1."

```bash
python3 skills/cloud/network-security/scripts/cloud_network_security.py list-filters --region eu-west-1
```

### Update a filter to add a new IP

**Prompt:** "Add the VPN IP 198.51.100.5 to our existing office filter."

```bash
python3 skills/cloud/network-security/scripts/cloud_network_security.py get-filter --filter-id tf-12345
# Review current rules, then update with the complete rule set:
python3 skills/cloud/network-security/scripts/cloud_network_security.py update-filter \
  --filter-id tf-12345 \
  --body '{"rules": [{"source": "203.0.113.0/24", "description": "Office network"}, {"source": "198.51.100.5", "description": "VPN"}]}'
```

### Look up PrivateLink metadata for a region

**Prompt:** "What PrivateLink service name do I need for us-east-1?"

```bash
python3 skills/cloud/network-security/scripts/cloud_network_security.py get-metadata --region us-east-1
```

### Delete an unused filter

**Prompt:** "Remove the old staging IP filter."

```bash
python3 skills/cloud/network-security/scripts/cloud_network_security.py delete-filter --filter-id tf-67890 --dry-run
# Review what would be deleted, then confirm:
python3 skills/cloud/network-security/scripts/cloud_network_security.py delete-filter --filter-id tf-67890
```

## Guidelines

- If `EC_API_KEY` is not set, do not prompt the user — instruct the agent to invoke **cloud-setup** first.
- Always confirm destructive actions (delete filter) with the user before executing.
- Filters are **region-scoped**: a filter created in `us-east-1` can only be associated with projects in that region.
- **Filter hygiene — reuse, scope, and clean up:**
  - Before creating a filter, always run `list-filters` and check whether an existing filter **for the same purpose**
    already has the required source rules. Filters can be associated with multiple projects, so one filter with the
    right rules is better than duplicates.
  - Duplicate filters means filters for the same purpose with identical source rules — not merely overlapping IPs. Two
    filters covering different project groups with the same CIDR are legitimate.
  - Review unused filters periodically. If a filter is no longer associated with any project, prompt the user to delete
    it to reduce clutter.
- **Updating rules replaces the entire rule set.** When adding a rule using PATCH, include all existing rules plus the
  new one. Omitting an existing rule removes it.
- **Deleting a filter fails if it is still associated with a project.** Disassociate first using
  **cloud-manage-project** (PATCH the project with the filter removed from the `traffic_filters` list), then delete.
- `include_by_default` automatically associates the filter with all new projects in the region. Use with caution — it
  affects every future project.
- For project association and disassociation, delegate to the **cloud-manage-project** skill. This skill manages filter
  definitions only.
- For identity and access management (users, roles, API keys), see **cloud-access-management**.
- For Elasticsearch-level security (native users, role mappings, DLS/FLS), see **elasticsearch-authz**.
