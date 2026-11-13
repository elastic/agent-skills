# Threat Hunting Guide

Detailed hunting patterns, examples, and reference material for proactive threat hunting with Elastic Security. For
ready-to-run starter queries, see [query-templates.md](query-templates.md).

## Hunting query design principles

### ES|QL best practices

1. **Narrow the index**: Use specific index patterns (`logs-endpoint.events.process-*`) instead of broad ones (`logs-*`)
2. **Filter first**: Put the most selective `WHERE` clauses first to reduce processing
3. **Use `KEEP`**: Select only fields needed for `STATS` or review
4. **Aggregate with `STATS`**: Use `COUNT(*)`, `COUNT_DISTINCT(host.id)`, `VALUES()` to find outliers
5. **Normalize paths**: Use `REPLACE()` to normalize user-specific paths and GUIDs for better aggregation
6. **Limit output**: Always include a `LIMIT` clause

### Frequency analysis pattern

The core data-driven hunting pattern: aggregate by a field, count occurrences and unique hosts, then filter for rare
items.

```esql
FROM <index>
| WHERE @timestamp > NOW() - <N> day
  AND <base_filters>
| KEEP <fields_for_aggregation>
| EVAL normalized_field = REPLACE(field, "<pattern>", "<replacement>")
| STATS count = COUNT(*), hosts = COUNT_DISTINCT(host.id) BY <group_by_fields>
| WHERE hosts == 1 AND count <= <threshold>
| SORT count ASC
| LIMIT <N>
```

**Why `hosts == 1`?** If something appears on only one host, it's either unique legitimate software or a potential
indicator. Multi-host occurrence typically means fleet-wide software.

### Path normalization

User-specific paths and GUIDs create artificial uniqueness. Normalize before aggregating:

```esql
| EVAL normalized = REPLACE(process.executable,
    """[cC]:\\[uU][sS][eE][rR][sS]\\[a-zA-Z0-9._\-$~ ]+\\""",
    "C:\\users\\user\\"
  )
| EVAL normalized = REPLACE(normalized,
    """[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}""",
    "<GUID>"
  )
```

## Hunting examples by MITRE tactic

### Persistence (TA0003)

#### Run key persistence (T1547.001)

Hunt for rare programs adding themselves to registry Run keys:

```esql
FROM logs-endpoint.events.registry-*
| WHERE @timestamp > NOW() - 7 day
  AND host.os.family == "windows"
  AND event.category == "registry"
  AND event.action == "modification"
  AND ENDS_WITH(registry.key, "\\Microsoft\\Windows\\CurrentVersion\\Run")
  AND NOT registry.data.strings RLIKE """(.{1,2}[c-fC-F]:\\Program Files.+)"""
| KEEP registry.key, registry.data.strings, process.name, host.id
| EVAL registry_data = REPLACE(registry.data.strings,
    """[cC]:\\[uU][sS][eE][rR][sS]\\[a-zA-Z0-9._\-$~ ]+\\""",
    "C:\\users\\user\\"
  )
| STATS cc = COUNT(*), hosts = COUNT_DISTINCT(host.id) BY process.name, registry_data
| WHERE hosts == 1 AND cc == 1
```

#### Scheduled task persistence (T1053.005)

Hunt for rare scheduled task actions:

```esql
FROM logs-endpoint.events.registry-*
| WHERE @timestamp > NOW() - 7 day
  AND host.os.family == "windows"
  AND event.category == "registry"
  AND event.action == "modification"
  AND registry.path LIKE """*\\Actions\\*"""
  AND registry.key LIKE """*\\Schedule\\TaskCache\\Tasks\\*"""
| KEEP registry.data.strings, process.name, host.id
| EVAL task_action = REPLACE(registry.data.strings,
    """[cC]:\\[uU][sS][eE][rR][sS]\\[a-zA-Z0-9._\-$~ ]+\\""",
    "C:\\users\\user\\"
  )
| STATS cc = COUNT(*), hosts = COUNT_DISTINCT(host.id) BY process.name, task_action
| WHERE hosts <= 2 AND cc <= 5
| SORT cc ASC
| LIMIT 50
```

#### Linux cron persistence (T1053.003)

```esql
FROM logs-endpoint.events.file-*
| WHERE @timestamp > NOW() - 30 day
  AND host.os.type == "linux"
  AND event.type IN ("creation", "change")
  AND (
    file.path IN ("/etc/cron.allow", "/etc/cron.deny", "/etc/crontab")
    OR file.path LIKE "/etc/cron.*/*"
    OR file.path LIKE "/var/spool/cron/crontabs/*"
  )
  AND NOT process.name IN ("dpkg", "dockerd", "yum", "dnf", "snapd", "pacman")
| STATS count = COUNT(*), agent_count = COUNT_DISTINCT(agent.id) BY process.executable, file.path
| WHERE count <= 20 AND agent_count <= 3
| SORT count ASC
| LIMIT 100
```

### Defense Evasion (TA0005)

#### DLL sideloading (T1574.002)

Hunt for rare DLLs loaded by legitimate processes:

```esql
FROM logs-endpoint.events.library-*
| WHERE @timestamp > NOW() - 7 day
  AND host.os.family == "windows"
  AND event.action == "load"
  AND (dll.code_signature.exists == false OR dll.code_signature.trusted == false)
  AND process.code_signature.trusted == true
| KEEP dll.name, dll.path, process.name, host.id
| EVAL dll_path_norm = REPLACE(dll.path,
    """[cC]:\\[uU][sS][eE][rR][sS]\\[a-zA-Z0-9._\-$~ ]+\\""",
    "C:\\users\\user\\"
  )
| STATS cc = COUNT(*), hosts = COUNT_DISTINCT(host.id) BY process.name, dll.name, dll_path_norm
| WHERE hosts == 1 AND cc <= 3
| SORT cc ASC
| LIMIT 50
```

#### Masquerading (T1036)

Hunt for processes pretending to be native Windows binaries but running from unusual paths:

```esql
FROM logs-endpoint.events.process-*
| WHERE @timestamp > NOW() - 7 day
  AND host.os.family == "windows"
  AND event.action == "start"
  AND process.name IN ("svchost.exe", "csrss.exe", "lsass.exe", "services.exe", "smss.exe", "wininit.exe", "winlogon.exe")
  AND NOT process.executable RLIKE """[cC]:\\Windows\\(System32|SysWOW64|WinSxS)\\.*"""
| KEEP @timestamp, process.name, process.executable, process.command_line, host.name, agent.id
| SORT @timestamp
| LIMIT 50
```

### Command and Control (TA0011)

#### Beaconing detection (T1071)

Hunt for processes with unusually regular network connections (potential C2 beaconing):

```esql
FROM logs-endpoint.events.network-*
| WHERE @timestamp > NOW() - 7 day
  AND host.os.family == "windows"
  AND event.action == "connection_attempted"
  AND NOT CIDR_MATCH(destination.ip, "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16")
| STATS conn_count = COUNT(*), unique_destinations = COUNT_DISTINCT(destination.ip) BY process.name, agent.id
| WHERE conn_count >= 100 AND unique_destinations <= 3
| SORT conn_count DESC
| LIMIT 50
```

#### DNS over LOLBins (T1071.004)

```esql
FROM logs-endpoint.events.network-*
| WHERE @timestamp > NOW() - 7 day
  AND host.os.family == "windows"
  AND event.category == "network"
  AND event.action IN ("lookup_requested", "DNSEvent (DNS query)")
  AND process.name IN ("powershell.exe", "rundll32.exe", "certutil.exe", "mshta.exe", "wscript.exe", "cscript.exe", "regsvr32.exe", "msbuild.exe")
  AND dns.question.name RLIKE """.+\.[a-zA-Z]{2,3}"""
| KEEP process.name, dns.question.name, host.id
| STATS occurrences = COUNT(*), hosts = COUNT_DISTINCT(host.id) BY process.name, dns.question.name
| WHERE hosts == 1
| SORT occurrences ASC
| LIMIT 50
```

### Credential Access (TA0006)

#### LSASS access (T1003.001)

Hunt for unusual processes accessing LSASS memory:

```esql
FROM logs-endpoint.events.api-*
| WHERE @timestamp > NOW() - 7 day
  AND host.os.family == "windows"
  AND process.Ext.api.name IN ("OpenProcess", "OpenThread")
  AND Target.process.name == "lsass.exe"
| KEEP process.name, process.executable, host.id
| STATS cc = COUNT(*), hosts = COUNT_DISTINCT(host.id) BY process.executable
| WHERE hosts <= 3
| SORT cc ASC
| LIMIT 50
```

### Lateral Movement (TA0008)

#### SMB file transfers (T1021.002)

```esql
FROM logs-endpoint.events.file-*
| WHERE @timestamp > NOW() - 7 day
  AND host.os.family == "windows"
  AND event.action == "creation"
  AND (file.Ext.header_bytes LIKE "4d5a*" OR file.extension IN ("exe", "dll", "sys", "bat", "cmd", "ps1", "vbs"))
  AND process.name == "System"
  AND file.path LIKE """C:\\Windows\\*"""
| KEEP @timestamp, file.name, file.path, host.id
| STATS cc = COUNT(*), hosts = COUNT_DISTINCT(host.id) BY file.name, file.path
| SORT cc ASC
| LIMIT 50
```

### Cloud Hunting (AWS)

#### Unusual IAM API calls

```esql
FROM logs-aws.cloudtrail-*
| WHERE @timestamp > NOW() - 7 day
  AND event.provider == "iam.amazonaws.com"
  AND event.outcome == "success"
| STATS action_count = COUNT(*), unique_users = COUNT_DISTINCT(aws.cloudtrail.user_identity.arn) BY event.action
| WHERE unique_users == 1 AND action_count <= 3
| SORT action_count ASC
| LIMIT 50
```

#### S3 data exfiltration indicators

```esql
FROM logs-aws.cloudtrail-*
| WHERE @timestamp > NOW() - 7 day
  AND event.provider == "s3.amazonaws.com"
  AND event.action IN ("GetObject", "ListBucket", "ListObjects")
| STATS object_count = COUNT(*), unique_buckets = COUNT_DISTINCT(aws.cloudtrail.request_parameters) BY aws.cloudtrail.user_identity.arn, source.ip
| WHERE object_count >= 50
| SORT object_count DESC
| LIMIT 50
```

## Investigation pivot patterns

When a hunt returns results, use these pivot queries to build the full picture.

### From process finding --> full process tree

```esql
FROM logs-endpoint.events.process-*
| WHERE agent.id == "<agent_id>"
  AND @timestamp >= "<time - 5min>"
  AND @timestamp <= "<time + 10min>"
  AND process.parent.name IS NOT NULL
| KEEP @timestamp, process.name, process.command_line, process.pid, process.parent.name, process.parent.pid
| SORT @timestamp
| LIMIT 80
```

### From network finding --> process + destination context

```esql
FROM logs-endpoint.events.network-*
| WHERE agent.id == "<agent_id>"
  AND process.name == "<process>"
  AND @timestamp >= "<time - 1hr>"
| KEEP @timestamp, destination.ip, destination.port, network.direction, dns.question.name
| SORT @timestamp
| LIMIT 50
```

### From file finding --> who wrote it and what happened next

```esql
FROM logs-endpoint.events.file-*
| WHERE agent.id == "<agent_id>"
  AND file.path == "<file_path>"
| KEEP @timestamp, event.action, process.name, process.executable, file.path
| SORT @timestamp
| LIMIT 20
```
