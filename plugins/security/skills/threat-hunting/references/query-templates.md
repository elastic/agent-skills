# Hunting query templates

Starting-point ES|QL templates for common hunts. These mirror the templates in Kibana's Agent Builder threat-hunting
skill. Adjust index patterns, time windows, and thresholds to the data you have. Run `POST /_query` for each one.

## Lateral movement

### Remote service creation

```esql
FROM logs-endpoint.events.process-*, winlogbeat-*
| WHERE @timestamp >= NOW() - 7 DAYS
| WHERE event.action IN ("start", "Process Create")
  AND process.name IN ("psexec.exe", "psexesvc.exe", "wmic.exe", "mstsc.exe", "schtasks.exe")
| STATS host_count = COUNT_DISTINCT(host.name), exec_count = COUNT(*) BY process.name, user.name
| WHERE host_count > 1
| SORT host_count DESC
| LIMIT 50
```

### Suspicious logon types

```esql
FROM winlogbeat-*, logs-system.security-*
| WHERE @timestamp >= NOW() - 7 DAYS
| WHERE event.code IN ("4624", "4625")
  AND winlog.event_data.LogonType IN ("3", "10")
| STATS attempt_count = COUNT(*), unique_sources = COUNT_DISTINCT(source.ip) BY user.name, host.name
| WHERE unique_sources > 3
| SORT unique_sources DESC
| LIMIT 50
```

## C2 beaconing

### Periodic connection analysis

```esql
FROM logs-endpoint.events.network-*, packetbeat-*
| WHERE @timestamp >= NOW() - 7 DAYS
| WHERE event.action == "connection_attempted"
  AND NOT CIDR_MATCH(destination.ip, "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
| STATS conn_count = COUNT(*), first_seen = MIN(@timestamp), last_seen = MAX(@timestamp)
    BY process.name, destination.ip, host.name
| WHERE conn_count > 50
| SORT conn_count DESC
| LIMIT 50
```

### Low-frequency DNS to rare domains

```esql
FROM packetbeat-*, logs-endpoint.events.network-*
| WHERE @timestamp >= NOW() - 7 DAYS
| WHERE dns.question.name IS NOT NULL
| STATS query_count = COUNT(*), host_count = COUNT_DISTINCT(host.name) BY dns.question.name
| WHERE query_count < 5 AND host_count == 1
| SORT query_count ASC
| LIMIT 100
```

## Brute force and credential spraying

### Failed authentication spike

```esql
FROM winlogbeat-*, logs-system.security-*, filebeat-*
| WHERE @timestamp >= NOW() - 24 HOURS
| WHERE event.outcome == "failure" AND event.category == "authentication"
| STATS fail_count = COUNT(*), target_count = COUNT_DISTINCT(user.name) BY source.ip
| WHERE fail_count > 10
| SORT fail_count DESC
| LIMIT 50
```

### Credential spraying (many users, few attempts each)

```esql
FROM winlogbeat-*, logs-system.security-*
| WHERE @timestamp >= NOW() - 24 HOURS
| WHERE event.outcome == "failure" AND event.category == "authentication"
| STATS fail_count = COUNT(*), user_count = COUNT_DISTINCT(user.name) BY source.ip
| WHERE user_count > 5 AND fail_count / user_count < 3
| SORT user_count DESC
| LIMIT 50
```

## Rare process execution

### Statistically rare processes

```esql
FROM logs-endpoint.events.process-*
| WHERE @timestamp >= NOW() - 7 DAYS
| WHERE event.action == "start"
| STATS host_count = COUNT_DISTINCT(host.name), exec_count = COUNT(*) BY process.executable
| WHERE host_count == 1 AND exec_count < 3
| SORT exec_count ASC
| LIMIT 100
```

### Processes running from unusual directories

```esql
FROM logs-endpoint.events.process-*
| WHERE @timestamp >= NOW() - 7 DAYS
| WHERE event.action == "start"
  AND NOT STARTS_WITH(process.executable, "C:\\Windows\\")
  AND NOT STARTS_WITH(process.executable, "C:\\Program Files")
  AND NOT STARTS_WITH(process.executable, "/usr/")
  AND NOT STARTS_WITH(process.executable, "/bin/")
| STATS exec_count = COUNT(*), host_count = COUNT_DISTINCT(host.name) BY process.executable, process.name
| WHERE host_count == 1
| SORT exec_count ASC
| LIMIT 100
```
