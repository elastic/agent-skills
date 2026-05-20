# Elastic ML Anomaly Detection Functions

Functions marked with `*` support **high/low one-sided variants** (e.g., `high_count`, `low_mean`) to detect anomalies
in only one direction.

---

## Count Functions

Analyze the **occurrence rate** of events or documents over time.

| Function            | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| `count` \*          | Number of documents in a bucket                                       |
| `non_zero_count` \* | Like `count` but ignores zero-count buckets — use for **sparse data** |
| `distinct_count` \* | Cardinality (uniqueness) of values for a specific field               |

### `count` vs `non_zero_count`

| Scenario                                                      | Use                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| Events arrive in every bucket (e.g., web traffic, heartbeats) | `count` — zero buckets are meaningful (outage signal) |
| Events arrive intermittently (e.g., batch jobs, error logs)   | `non_zero_count` — zeros are expected, not anomalous  |
| Detecting a **drop to zero** as an outage                     | `count` with `low_count` variant                      |
| Detecting **bursts** in normally sparse traffic               | `non_zero_count` with `high_non_zero_count` variant   |

**Example:** An intrusion detection log index gets events only when triggered. Using `count` means the model learns that
zero-event buckets are normal overnight — making it impossible to distinguish a genuine quiet night from a monitoring
gap. Use `non_zero_count` so the model only learns from buckets that had events, and flags when event volumes spike
unexpectedly.

### `distinct_count`

Counts the number of unique values for a field within each bucket. Useful for detecting credential stuffing (unusually
high distinct usernames), data exfiltration (high distinct destination IPs), or DGA activity (high distinct DNS query
names).

---

## Metric Functions

Operate on **numerical fields** within the data.

| Function                  | Description                                                    |
| ------------------------- | -------------------------------------------------------------- |
| `min` / `max`             | Minimum or maximum value in a bucket                           |
| `mean` \*                 | Average value                                                  |
| `median` \*               | Median value                                                   |
| `sum` / `non_null_sum` \* | Total sum of a field; `non_null_sum` is for **sparse data**    |
| `varp` \*                 | Variance / volatility of a metric                              |
| `metric`                  | Shorthand that applies `min`, `max`, and `mean` simultaneously |

### Choosing the right metric function

| Goal                                           | Function                           |
| ---------------------------------------------- | ---------------------------------- |
| Detect **average** latency spike               | `mean` or `high_mean`              |
| Detect **worst-case** latency (tail)           | `max`                              |
| Detect **sustained volume** drop               | `low_sum`                          |
| Detect **unusual volatility** (erratic metric) | `high_varp`                        |
| Detect both high and low deviations            | `mean` (bidirectional, default)    |
| Detect only spikes, not drops                  | `high_mean`                        |
| Monitor noisy metrics with outliers            | `median` (more robust than `mean`) |

### `sum` vs `non_null_sum`

Use `non_null_sum` when the field is frequently absent from documents (sparse). Like `non_zero_count`, it skips empty
buckets so the model learns only from active periods.

### `metric` shorthand

Creates three detectors in one: `min`, `max`, and `mean` on the same field. Convenient for a quick initial setup, but
produces three anomaly records per detection event. Prefer explicit functions once you know which direction matters.

---

## Advanced & Specialized Functions

Handle complex analysis types such as rarity or geographic data.

| Function          | Description                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| `rare`            | Identifies values that occur at **low frequency** compared to the dataset        |
| `freq_rare`       | Finds population members that **cause rare values to occur frequently**          |
| `info_content` \* | Entropy of text strings — useful for detecting **encrypted/obfuscated commands** |
| `lat_long`        | Detects unusual **geographic locations** from latitude/longitude coordinates     |
| `time_of_day`     | Detects behavioral changes relative to **time of day**                           |
| `time_of_week`    | Detects behavioral changes relative to **day of week**                           |

---

### `rare` vs `freq_rare`

These two are often confused but answer different questions:

| Function    | Question answered                                           | Requires `over_field` |
| ----------- | ----------------------------------------------------------- | --------------------- |
| `rare`      | "Which values of the `by_field` are unusual globally?"      | No                    |
| `freq_rare` | "Which entities (over_field) frequently cause rare values?" | Yes                   |

**`rare` example:** Detect rare `process.name` values across all hosts. If `svchost.exe` with unusual arguments appears
only once in 30 days, `rare` flags it. The focus is the rarity of the _value_.

**`freq_rare` example:** Detect which _users_ (`over_field`) frequently trigger rare process executions (`by_field`).
Most users run rare processes occasionally, but a user running rare processes consistently is a lateral movement signal.
The focus is the entity's behavior pattern.

**Practical guidance:**

- Use `rare` for hunting unknown unknowns — values that shouldn't exist at all.
- Use `freq_rare` for insider threat and lateral movement scenarios — who is repeatedly doing unusual things.
- `rare` generates high false-positive rates in noisy environments; use custom rules to suppress known-good rare values.
- `freq_rare` requires an `over_field` (population) — without it, use `rare`.

### Types of rare analysis

Translate business goals to the correct `rare` detector configuration:

| Goal                                                                 | Example                                                                                                   | Detector config                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Find infrequent values for a field                                   | Detect hosts occurring infrequently                                                                       | `rare` `by_field_name: host`                                                          |
| Find infrequent values compared to peers                             | Detect hosts visited by few users vs. other hosts; detect users visiting rare hosts                       | `rare` `by_field_name: host` `over_field_name: user`                                  |
| Find infrequent values segmented by another field                    | Per location, detect infrequently seen hosts                                                              | `rare` `by_field_name: host` `partition_field_name: location`                         |
| Find infrequent values by another field compared to peers, segmented | Per location, detect hosts visited by few users vs. peers; detect users visiting rare hosts in a location | `rare` `by_field_name: host` `over_field_name: user` `partition_field_name: location` |

---

### `info_content`

Measures the **Shannon entropy** of text strings. High entropy = high randomness = potentially encoded, encrypted, or
machine-generated content.

| Entropy range     | Interpretation                       | Example                                            |
| ----------------- | ------------------------------------ | -------------------------------------------------- |
| Low (predictable) | Normal human-readable text           | `GET /api/users HTTP/1.1`                          |
| Medium            | Mixed structured/variable content    | Log messages with variable IDs                     |
| High (random)     | Encoded, encrypted, or DGA-generated | `aGVsbG8gd29ybGQ=` (base64), `zxq7v9abc.com` (DGA) |

**Use cases:**

- **DNS query names** with `by_field_name: "dns.question.name"` — DGA malware generates high-entropy domain names (e.g.,
  `xk9p2mnqabcdef.ru`).
- **User-agent strings** — malware C2 frameworks often use randomized or encoded user agents.
- **URL paths / query strings** — webshell commands embedded in request parameters.
- **Command-line arguments** — base64-encoded PowerShell payloads.

**`high_info_content`** (one-sided): only alerts on unusually high entropy, which is almost always the right choice for
security use cases.

---

### `time_of_day` vs `time_of_week`

Both detect _when_ something happens relative to established patterns, not _how much_.

| Function       | Granularity        | Best for                                                 |
| -------------- | ------------------ | -------------------------------------------------------- |
| `time_of_day`  | Hour/minute of day | Detecting off-hours access (3am login for a 9-5 user)    |
| `time_of_week` | Day of week        | Detecting weekend/holiday activity (batch job on Sunday) |

**`time_of_day` example:** A database admin who always connects between 08:00–18:00 on weekdays. `time_of_day` learns
this pattern. A connection at 02:30 scores anomalous — even if the volume of activity is normal.

**`time_of_week` example:** A data pipeline that runs Monday–Friday. `time_of_week` flags it running on Saturday.
`time_of_day` would not catch this (the time of day, e.g., 08:00, may be normal).

**Choosing between them:**

- Use `time_of_day` when the anomaly is "wrong hour of the day."
- Use `time_of_week` when the anomaly is "wrong day of the week."
- Use both together (two detectors) for comprehensive temporal coverage.
- Neither function cares about _count_ or _metric values_ — use `count`/`mean` detectors in the same job for
  volume-based detection.

---

## One-Sided Variants

Functions marked with `*` support `high_` and `low_` prefixes:

| Variant                  | Detects                                                |
| ------------------------ | ------------------------------------------------------ |
| `high_<function>`        | Only values significantly **above** the expected range |
| `low_<function>`         | Only values significantly **below** the expected range |
| `<function>` (no prefix) | Both directions (bidirectional)                        |

**When to use one-sided:**

- `high_mean(response_time)` — only alert on latency spikes, not drops (a faster response is never a problem).
- `low_count(login_events)` — only alert on unusually low login volume (could indicate authentication system failure).
- `high_distinct_count(destination.ip)` — only alert on abnormally high unique destination IPs (exfiltration signal).

Bidirectional variants (`mean`, `count`) generate alerts for both directions, which can produce noise when only one
direction is operationally relevant.
