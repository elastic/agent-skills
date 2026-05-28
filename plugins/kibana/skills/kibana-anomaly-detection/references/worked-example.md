# Worked Investigation Example

End-to-end walkthrough of a multi-job anomaly investigation using the [14-step protocol](protocols/investigation.md).

---

## Scenario

**Alert received:** `rcaeval-ob-cpu` — `partition_field_value: frontend` — `record_score: 72` — `2024-03-15T14:30:00Z`

The on-call engineer receives this alert and needs to determine: Is `frontend` the root cause, or a victim of something
upstream?

---

## Phase 1: Discovery

### Step 1 — Discover available jobs

Call `ad_get_available_metadata` (no parameters).

**Result summary:**

```text
job_count: 6
job_ids: [rcaeval-ob-cpu, rcaeval-ob-latency, rcaeval-ob-memory,
          rcaeval-ob-errors, rcaeval-nw-throughput, rcaeval-logs-app]
functions: [mean, high_mean, count, rare]
partition_fields: [service]
bucket_spans: [5m]
```

**Interpretation:** 6 jobs all partitioned by `service`. All likely monitor the same system from different angles.

---

### Step 2 — Find related jobs

Call `ad_discover_jobs_by_datafeed_index` with `job_id: rcaeval-ob-cpu`.

**Result:**

```text
Jobs sharing index rcaeval-re1-ob:
  rcaeval-ob-cpu, rcaeval-ob-latency, rcaeval-ob-memory, rcaeval-ob-errors
  match_count: 4

Jobs sharing index rcaeval-re1-nw:
  rcaeval-nw-throughput
  match_count: 1
```

Then call `ad_discover_related_jobs` with `job_id: rcaeval-ob-cpu`.

**Result:**

```text
entity_field: service
  jobs: [rcaeval-ob-cpu, rcaeval-ob-latency, rcaeval-ob-memory,
         rcaeval-ob-errors, rcaeval-nw-throughput]
  job_count: 5
```

**Interpretation:** 5 jobs all split by `service`. The `rcaeval-logs-app` job uses `mlcategory` (log categorization),
not `service`. The 5 observability jobs are our related group.

---

### Step 3 — Scope the incident

Call `ad_query_anomaly_timeline` with:

- `job_id_pattern: rcaeval-*`
- `min_score: 25`
- `start_time: 2024-03-15T13:00:00Z`
- `end_time: 2024-03-15T16:00:00Z`

**Result:**

```text
timestamp              max_score  job_count  composite_score  jobs
2024-03-15T14:00:00Z      48          2           76         [rcaeval-ob-cpu, rcaeval-ob-latency]
2024-03-15T14:15:00Z      61          3          138         [rcaeval-ob-cpu, rcaeval-ob-latency, rcaeval-ob-memory]
2024-03-15T14:30:00Z      78          4          198         [rcaeval-ob-cpu, rcaeval-ob-latency, rcaeval-ob-memory, rcaeval-ob-errors]
2024-03-15T14:45:00Z      72          4          201         [rcaeval-ob-cpu, rcaeval-ob-latency, rcaeval-ob-memory, rcaeval-ob-errors]
2024-03-15T15:00:00Z      45          3          112         [rcaeval-ob-latency, rcaeval-ob-memory, rcaeval-ob-errors]
```

**Interpretation:** Peak at 14:30 with 4 jobs co-firing (composite score 198). Incident started ~14:00, peak 14:30,
declining by 15:00. This is a 1-hour incident, not a transient spike. CPU was first to fire (14:00).

---

## Phase 2: Entity Attribution

### Step 4 — Expand from alert

Call `ad_rca_cross_job_entity_match` with:

- `entity_value: frontend`
- `min_score: 10`
- `start_time: 2024-03-15T13:30:00Z`
- `end_time: 2024-03-15T15:30:00Z`

**Result:**

```text
job_id                  max_score  anomaly_count  first_anomaly              functions
rcaeval-ob-cpu              78          8         2024-03-15T14:00:00Z      [high_mean]
rcaeval-ob-latency          74          7         2024-03-15T14:05:00Z      [high_mean]
rcaeval-ob-memory           61          5         2024-03-15T14:15:00Z      [high_mean]
rcaeval-ob-errors           52          4         2024-03-15T14:20:00Z      [high_count]
```

**Interpretation:** `frontend` is anomalous in 4 jobs. CPU was first (14:00), then latency (14:05), then memory (14:15),
then errors (14:20). This cascading pattern suggests CPU is upstream — high CPU caused latency, which caused memory
pressure, which caused errors.

---

### Step 5 — Multi-job entities

Call `ad_rca_multi_job_entities` with:

- `min_score: 25`
- `min_job_count: 2`
- `start_time: 2024-03-15T14:00:00Z`
- `end_time: 2024-03-15T15:00:00Z`

**Result:**

```text
partition_field_value  job_count  max_score  functions
frontend                   4          78     [high_mean, high_count]
backend                    1          31     [high_mean]
```

**Interpretation:** `frontend` is the only entity anomalous in 4+ jobs — confirmed prime suspect. `backend` appears in
only 1 job at score 31 — likely incidental.

---

### Step 6 — Fingerprint

Call `ad_rca_detector_fingerprint` with:

- `job_id_pattern: rcaeval-ob-*`
- `min_score: 25`
- `start_time: 2024-03-15T14:00:00Z`
- `end_time: 2024-03-15T15:00:00Z`

**Result:**

```text
job_id              function    field_name          max_score  count
rcaeval-ob-cpu      high_mean   system.cpu.percent      78       8
rcaeval-ob-latency  high_mean   http.response_time       74       7
rcaeval-ob-memory   high_mean   system.memory.used       61       5
rcaeval-ob-errors   high_count  http.error_count         52       4
```

**Interpretation:** Classic resource exhaustion pattern: CPU spike → latency increase → memory pressure → errors. All
metrics elevated on `frontend` simultaneously.

---

## Phase 3: Deep Analysis

### Steps 7–10 — Drill down, attribute, profile, characterize

`ad_query_anomaly_records` for `rcaeval-ob-cpu` with `min_score: 50`:

```text
record_score: 78
actual: 94.7 (% CPU)
typical: 31.2
multi_bucket_impact: 4
initial_record_score: 79
```

`multi_bucket_impact: 4` → sustained shift across 4+ buckets, not a transient spike. `initial ≈ current` → no
renormalization; score is stable and genuine.

---

## Phase 4: Root Cause Confirmation

### Step 11 — Cascade

Call `ad_rca_correlation` with:

- `job_id_pattern: rcaeval-ob-*`
- `min_score: 25`
- Window: 13:30–15:30

**Result (sorted by timestamp):**

```text
timestamp              job_id             record_score  function    field_name
2024-03-15T14:00:00Z  rcaeval-ob-cpu         78        high_mean   cpu.percent       → FIRST
2024-03-15T14:05:00Z  rcaeval-ob-latency     74        high_mean   response_time
2024-03-15T14:15:00Z  rcaeval-ob-memory      61        high_mean   memory.used
2024-03-15T14:20:00Z  rcaeval-ob-errors      52        high_count  error_count
```

**Interpretation:** CPU anomaly at 14:00 is the earliest — this is the root cause signal.

### Step 12 — Evidence

Get source index from `ad_get_job_datafeed_config` → `rcaeval-re1-ob`.

Call `ad_rca_source_evidence`:

- `source_index: rcaeval-re1-ob`
- Window: 13:50–14:10

**Sample raw docs (14:00):**

```json
{"service": "frontend", "system.cpu.percent": 96.2, "event": "metricset", "@timestamp": "2024-03-15T14:00:34Z"}
{"service": "frontend", "system.cpu.percent": 93.8, "event": "metricset", "@timestamp": "2024-03-15T14:01:05Z"}
{"service": "frontend", "system.cpu.percent": 94.1, "event": "metricset", "@timestamp": "2024-03-15T14:01:41Z"}
```

**Interpretation:** CPU is genuinely at ~95% on `frontend` starting at 14:00, confirming the ML anomaly matches reality.

---

## Step 14 — RCA Report

**Root cause:** `frontend` service experienced CPU exhaustion starting at 2024-03-15T14:00Z.

**Evidence:**

- CPU rose from baseline 31% to 94–97% at 14:00 (score: 78, `multi_bucket_impact: 4` — sustained shift)
- CPU anomaly preceded all other anomalies by 5–20 minutes
- `frontend` was the only entity anomalous in 4 jobs simultaneously — no other service implicated

**Cascading impact:**

1. **14:00** — CPU saturates (94%+)
2. **14:05** — HTTP latency climbs (CPU-bound request processing)
3. **14:15** — Memory rises (queued/retried requests consuming heap)
4. **14:20** — Error rate spikes (timeouts from downstream callers)

**Fault type:** Resource exhaustion — CPU-bound processing on `frontend` pod(s)

**Recommended actions:**

1. Check `frontend` deployment for runaway process or CPU-hungry code path (profiling)
2. Review recent deploys to `frontend` in the 30 min before 14:00
3. Horizontal scale or vertical CPU limit increase as immediate mitigation
4. Add CPU throttling alert at 80% to catch before next saturation

**Severity:** Score 78, `multi_bucket_impact: 4`, duration ~1 hour — **high severity**

---

## See Also

- [protocols/investigation.md](protocols/investigation.md) — Full 14-step protocol
- [score-reference.md](score-reference.md) — Score field definitions and severity bands
- [anomaly-detection-functions.md](anomaly-detection-functions.md) — Function selection guide
