---
name: elasticsearch-cluster-health
description: >
  Diagnose a non-green Elasticsearch cluster and surface the single most likely cause
  with remediation. Use when an operator reports yellow or red status, unassigned
  shards, allocation failures, or wants read-only triage before deeper investigation.
  Teaches replica-vs-primary impact, allocation decider classification, and data-loss
  awareness.
metadata:
  author: elastic
  version: 0.1.0
  universal: true
compatibility: Elasticsearch 8.x or 9.x, self-managed or Elastic Cloud Hosted; not
  applicable to Elastic Cloud Serverless, where cluster, shard, and allocation APIs
  are managed internally. Requires the `elastic` CLI ≥ 0.2 with `stack es` support.
---

# Diagnose Cluster Health

Triage a non-green Elasticsearch cluster read-only: localize the problem, classify the allocation decider, and report
the single most likely cause with remediation. Never mutate cluster state — surface findings and let the operator act.

<!-- begin-partial: preamble -->

## Environment Configuration

This skill executes Elasticsearch operations through the `elastic` CLI. If the
[`elastic` CLI](https://github.com/elastic/cli#configuration) is not installed, tell the user what it is needed for. Do
not guess credentials, call the HTTP API directly, or attempt other workarounds.

This skill references operations in HTTP-shorthand form (e.g., `GET /`, `GET /_cat/indices`, `GET /{index}/_mapping`,
`GET /{index}/_settings/index.mode`, `POST /_query`). The [Operations](#operations) table at the end of this document
maps each shorthand to the equivalent `elastic` CLI command — always use the CLI rather than calling the HTTP API
directly.

<!-- end-partial: preamble -->

## Process

1. **Read the overall status.** Call `GET /_cluster/health`. The `status` field is the verdict:
   - `green` — every primary and replica is assigned. Report healthy and stop.
   - `yellow` — every **primary** is assigned but at least one **replica** is not. Data remains readable; redundancy is
     degraded. This is **not** data loss.
   - `red` — at least one **primary** is unassigned. Data for that shard is **unavailable**; treat as urgent.

   Also read `unassigned_shards`, `initializing_shards`, and `relocating_shards`. The decision: continue only when
   status is yellow or red. If `initializing_shards > 0` and `unassigned_shards == 0`, the cluster is recovering on its
   own — call `GET /_cat/recovery` to confirm progress, wait, and re-check `GET /_cluster/health` before escalating.

   Data needed: cluster-wide `status` and shard counters.

2. **Localize the problem to one index.** Call `GET /_cluster/health?level=indices` and pick the index that drives the
   cluster-wide status:
   - Any **red** index outranks every yellow index.
   - Among reds or yellows, prefer the index with the most `unassigned_shards`.
   - A red **system** index (`.security`, `.kibana*`, `.fleet-*`) outranks application indices because the rest of the
     stack depends on it.

   Optionally call `GET /_cat/shards/{index}?h=index,shard,prirep,state,unassigned.reason` to list every unassigned
   shard on that index and see whether failures are primaries (`prirep=p`) or replicas (`prirep=r`).

   The decision: focus the next steps on exactly **one** index — the one whose recovery unblocks the cluster.

   Data needed: per-index `status` and `unassigned_shards`; shard role (primary vs replica) when available.

3. **Separate trigger from root cause.** Call `POST /_cluster/allocation/explain` with no body so Elasticsearch selects
   an unassigned shard, or target the worst shard explicitly:

   ```json
   { "index": "<index>", "shard": <id>, "primary": <true|false> }
   ```

   Read these fields in order:
   - `primary` — `false` means a **replica** is unassigned (typical yellow); `true` means a **primary** is unassigned
     (typical red).
   - `can_allocate` — top-level allocation verdict (`no`, `yes`, `throttled`, `no_valid_shard_copy`, …).
   - `unassigned_info.reason` — what **triggered** reassignment (e.g. `NODE_LEFT`, `INDEX_CREATED`). This is **not** the
     root cause when `can_allocate` is `no`; it only explains why the shard became unassigned.
   - `allocate_explanation` — human-readable summary; quote it verbatim in the report.
   - `node_allocation_decisions[].deciders[]` — per-node decider results. Find deciders with `decision: "NO"`; the
     **decider name** (e.g. `disk_threshold`, `filter`, `awareness`) is the root cause class.

   The decision:
   - **Yellow + `primary: false`** — impact is limited to replica redundancy; no data loss. Continue to step 4 to name
     the blocking decider (do **not** stop at `NODE_LEFT`).
   - **Red + `primary: true`** — data for that shard is missing. Continue to step 4; if `can_allocate` is
     `no_valid_shard_copy`, treat as potential **data loss** immediately.

   Data needed: allocation-explain response for one representative unassigned shard on the chosen index.

4. **Classify the decider.** Map the blocking signal to a cause class. Prefer the decider with `decision: "NO"` over the
   `unassigned_info.reason` trigger.

   | Signal                                                                             | Cause class                                  | Typical remediation (operator applies)                                                                                                                         |
   | ---------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `decider: disk_threshold`, `decision: NO`                                          | Disk high/low watermark exceeded             | Free disk on the named node, add data-node capacity, or adjust `cluster.routing.allocation.disk.watermark.*` after confirming usage via `GET /_cat/allocation` |
   | `decider: filter` or `decider: awareness`, `decision: NO`                          | Allocation filtering or zone awareness       | Add a node that satisfies `index.routing.allocation.*` / awareness attributes, or adjust index/cluster allocation settings                                     |
   | `decider: throttling` or recovery in progress                                      | Transient recovery                           | Wait; monitor `GET /_cat/recovery` and re-check `GET /_cluster/health`                                                                                         |
   | `can_allocate: no_valid_shard_copy` (often with empty `node_allocation_decisions`) | No surviving shard copy                      | See step 5 — **data loss** scenario                                                                                                                            |
   | `can_allocate: yes` but shard still unassigned                                     | Delayed allocation or cluster state catch-up | Check `unassigned_info.at` delay; wait and re-check                                                                                                            |

   For disk pressure (common yellow scenario after `NODE_LEFT`): replicas relocate to remaining nodes; if a survivor is
   above the **high watermark** (`cluster.routing.allocation.disk.watermark.high`, default 90%), the `disk_threshold`
   decider blocks replica allocation even though primaries stay assigned. The fix is disk capacity or watermark relief —
   **not** deleting the index or forcing an empty primary.

   Data needed: decider name, `explanation` text, and affected node names from `node_allocation_decisions`.

5. **Recommend remediation — read-only triage ends here.** Report the **single most likely cause** (decider class +
   verbatim `allocate_explanation`) and one primary remediation path. Match urgency to color and shard role.

   **Yellow / replica unassigned (no data loss):**
   - State clearly: all primaries are assigned; only replicas are missing; **no data loss**.
   - Name the real decider (e.g. disk high watermark on `es-node-2`), not merely “a node left”.
   - Recommend: free disk space, expand storage, add data nodes, or adjust disk watermarks after reviewing
     `GET /_cat/allocation`.
   - Do **not** recommend: deleting the index, `allocate_empty_primary`, force-allocating over a healthy primary, or
     restarting the entire cluster without evidence.

   **Red / primary unassigned with `no_valid_shard_copy` (data loss risk):**
   - State clearly: a **primary** shard is unassigned; queries/routing for that shard fail; treat as **urgent** and
     localized to the named index.
   - Explain: the only copy was on the departed node; Elasticsearch cannot allocate a primary because no valid copy
     exists on any remaining node (`can_allocate: no_valid_shard_copy`).
   - Recovery paths in order:
     1. **Bring the departed node back** if its data directory is intact — the shard copy returns.
     2. **Restore from snapshot** into the index (or a new index followed by reindex) when snapshots exist.
     3. **Last resort only:** `POST /_cluster/reroute` with `allocate_empty_primary` — **this creates an empty primary
        and permanently loses all documents on that shard**. State data loss explicitly; never present this as the first
        or casual fix.
   - Do **not** recommend: deleting the index without discussing data loss, or `allocate_empty_primary` without the
     data-loss warning.

   **Self-healing in progress:**
   - When deciders show throttling or active peer recovery, recommend waiting and re-checking read-only APIs above.

   Do not execute reroutes, snapshot restores, or settings changes — surface cause and remediation only.

## Guidelines

- **Read-only:** Use only GET/POST explain APIs for triage. Remediation is advice; the operator performs writes.
- **Trigger ≠ cause:** `unassigned_info.reason: NODE_LEFT` explains the event; `node_allocation_decisions` deciders
  explain why allocation still fails.
- **Replica vs primary:** Yellow + `primary: false` = redundancy gap, not data loss. Red + `primary: true` = missing
  data for that shard.
- **One index, one cause:** Pick the highest-impact index and the strongest NO decider; avoid listing every shard.
- **Cat helpers:** Use `GET /_cat/allocation` for disk percentages per node and `GET /_cat/recovery` for ongoing
  recoveries when the decider class is unclear or recovery is in progress.

## Examples

**Yellow — disk watermark after node departure.** Health shows yellow with unassigned replicas on `logs-2025-07`.
Allocation explain returns `primary: false`, `unassigned_info.reason: NODE_LEFT`, but `disk_threshold` decider NO on
`es-node-2` (“above the high watermark … 90%”). Report: no data loss; root cause is disk pressure on the receiving node;
remediate disk/watermark — not “node left” alone.

**Red — primary with no valid copy.** Health shows red on `orders-2025` with one unassigned shard. Explain returns
`primary: true`, `can_allocate: no_valid_shard_copy`, `last_allocation_status: no_valid_shard_copy`. Report: urgent;
primary data missing; restore node or snapshot; mention `allocate_empty_primary` only as last resort with explicit data
loss.

## Operations

| HTTP API (shorthand)                                                    | `elastic` CLI command                                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /_cluster/health`                                                  | `elastic es cluster health`                                                                              |
| `GET /_cluster/health?level=indices`                                    | `elastic es cluster health --level indices`                                                              |
| `POST /_cluster/allocation/explain`                                     | `elastic es cluster allocation-explain`                                                                  |
| `POST /_cluster/allocation/explain` (specific shard)                    | `elastic es cluster allocation-explain --index '<index>' --shard <id> --primary true` (replica: `false`) |
| `GET /_cat/allocation`                                                  | `elastic es cat allocation`                                                                              |
| `GET /_cat/recovery`                                                    | `elastic es cat recovery`                                                                                |
| `GET /_cat/shards/{index}?h=index,shard,prirep,state,unassigned.reason` | `elastic es cat shards --index '<index>' --h index,shard,prirep,state,unassigned.reason`                 |
| `POST /_cluster/reroute` (last-resort empty primary — operator only)    | `elastic es cluster reroute --commands '<json>'`                                                         |
