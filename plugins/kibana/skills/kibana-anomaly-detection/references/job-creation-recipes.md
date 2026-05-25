# Job creation recipes

Worked examples for creating Elastic ML anomaly detection jobs and datafeeds via Agent Builder workflow tools.

> For the high-level process, see the **Manage** section of the parent `SKILL.md`. For detector function selection, see
> [anomaly-detection-functions.md](anomaly-detection-functions.md).

---

## API call sequence

```text
PUT  _ml/anomaly_detectors/<job_id>          # 1. Define job + detectors        (ad_create_job)
PUT  _ml/datafeeds/datafeed-<job_id>         # 2. Define datafeed (source + query) (ad_create_datafeed)
POST _ml/anomaly_detectors/<job_id>/_open    # 3a. Open job                      (ad_open_job)
POST _ml/datafeeds/datafeed-<job_id>/_start  # 3b. Start datafeed                (ad_manage_datafeed action=_start)
GET  _ml/anomaly_detectors/<job_id>/results/records   # 4. Read results
```

To stop: `ad_manage_datafeed` (`action=_stop`) → `POST _ml/anomaly_detectors/<job_id>/_close`.

For **batch analysis on historical data**, pass `start` and `end` to the datafeed start call:

```json
POST _ml/datafeeds/datafeed-revenue_over_users_api/_start
{ "start": "2024-01-01T00:00:00Z", "end": "2024-03-01T00:00:00Z" }
```

---

## Key `analysis_config` fields

| Field                              | Description                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `bucket_span`                      | Analysis interval (e.g. `15m`, `1h`). Align with data granularity and detection window.                                    |
| `detectors[].function`             | Analysis function (`high_sum`, `rare`, `mean`, etc). See [anomaly-detection-functions.md](anomaly-detection-functions.md). |
| `detectors[].field_name`           | Numeric field to analyze.                                                                                                  |
| `detectors[].over_field_name`      | Population analysis — each entity compared to its peers in the same bucket.                                                |
| `detectors[].by_field_name`        | Per-entity modeling — each entity compared to its own history.                                                             |
| `detectors[].partition_field_name` | Fully independent sub-model per entity with its own score normalization.                                                   |
| `influencers`                      | Fields to track as anomaly contributors (shown as `influencer_score`).                                                     |
| `data_description.time_field`      | Timestamp field for time series ordering (e.g. `@timestamp`, `order_date`).                                                |

## Key datafeed fields

| Field         | Description                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `indices`     | Array of index patterns containing source data.                                                                                   |
| `query`       | Elasticsearch DSL to filter source documents. Defaults to `match_all`.                                                            |
| `query_delay` | How far behind real time the datafeed queries. Set to P95 ingest latency + buffer (default `60s`–`120s`). Too low → missing docs. |
| `scroll_size` | Documents fetched per scroll request. Default `1000`.                                                                             |
| `frequency`   | How often the datafeed polls. Defaults to `min(query_delay, bucket_span / 2)`.                                                    |

---

## Recipe 1 — `rare` detector: rare usernames

**User query:** "Create an ML job to detect rare usernames in login events across logs-\*"

Verify `user.name` (keyword) and `@timestamp` (date) exist via `platform.core.get_index_mapping`. Validate with
`ad_validate_job_spec`. Then `ad_create_job` → `ad_create_datafeed` → `ad_open_job` → `ad_manage_datafeed`
(`action=_start`).

**Job body:**

```json
{
  "description": "Detects rare values of user.name during login activity",
  "analysis_config": {
    "bucket_span": "15m",
    "detectors": [
      { "function": "rare", "by_field_name": "user.name", "detector_description": "Rare user.name values" }
    ],
    "influencers": ["user.name", "source.ip"]
  },
  "data_description": { "time_field": "@timestamp" }
}
```

**Datafeed body:**

```json
{ "job_id": "rare-login-usernames", "indices": ["logs-*"], "query": { "match_all": {} } }
```

---

## Recipe 2 — `high_mean` detector: DNS exfiltration with datafeed filter

**User query:** "detect hosts with unusually high DNS query volume per domain, only for external DNS traffic on port 53"

Verify `dns.question.count` (numeric), `host.name` (keyword), `dns.question.name` (keyword), `@timestamp` (date).

**Job body:**

```json
{
  "description": "Detects unusually high DNS query volume per host, partitioned by queried domain",
  "analysis_config": {
    "bucket_span": "15m",
    "detectors": [
      {
        "function": "high_mean",
        "field_name": "dns.question.count",
        "over_field_name": "host.name",
        "partition_field_name": "dns.question.name",
        "detector_description": "High DNS query volume per host per domain"
      }
    ],
    "influencers": ["host.name", "dns.question.name", "source.ip"]
  },
  "data_description": { "time_field": "@timestamp" }
}
```

**Datafeed body:**

```json
{
  "job_id": "high-dns-query-volume-per-host",
  "indices": ["logs-*"],
  "query": {
    "bool": { "filter": [{ "term": { "network.transport": "udp" } }, { "term": { "destination.port": 53 } }] }
  }
}
```

---

## Recipe 3 — `high_sum` detector: large downloads with time range

**User query:** "detect users downloading unusually large amounts of data for sshd and sftp processes in the last 30
days"

Verify `destination.bytes` (numeric), `user.name` (keyword), `process.name` (keyword), `@timestamp` (date).

**Job body:**

```json
{
  "description": "Detects unusually high total bytes downloaded per user for specific processes",
  "analysis_config": {
    "bucket_span": "1h",
    "detectors": [
      {
        "function": "high_sum",
        "field_name": "destination.bytes",
        "by_field_name": "user.name",
        "detector_description": "High total bytes downloaded per user"
      }
    ],
    "influencers": ["user.name", "process.name", "source.ip"]
  },
  "data_description": { "time_field": "@timestamp" }
}
```

**Datafeed body:**

```json
{
  "job_id": "high-download-volume-per-user",
  "indices": ["logs-*"],
  "query": {
    "bool": {
      "filter": [
        { "terms": { "process.name": ["sshd", "sftp"] } },
        { "range": { "@timestamp": { "gte": "now-30d", "lte": "now" } } }
      ]
    }
  }
}
```

---

## Retrieving results

| Result type | Endpoint                                                 | Description                                                         |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| Buckets     | `GET _ml/anomaly_detectors/<job_id>/results/buckets`     | Aggregate anomaly score per time bucket                             |
| Records     | `GET _ml/anomaly_detectors/<job_id>/results/records`     | Individual anomaly records with `actual`, `typical`, `record_score` |
| Influencers | `GET _ml/anomaly_detectors/<job_id>/results/influencers` | Entity contribution scores                                          |
| Forecast    | `POST _ml/anomaly_detectors/<job_id>/_forecast`          | Predict future values; specify `duration` (e.g. `"10d"`)            |

> Forecasts are **not supported** for population analysis jobs (`over_field_name` set).
