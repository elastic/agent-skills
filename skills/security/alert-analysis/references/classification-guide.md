# Alert Classification Guide

Detailed criteria for classifying alerts as benign, unknown, or malicious.

## Contents

- Fundamental principle
- Pre-classification checklist
- Classification: Benign
- Classification: Unknown
- Classification: Malicious
- Behavioral weight table
- Common false positive sources
- Sandbox and testing environments

## Fundamental principle

Most alerts are false positives. Your job is to find EVIDENCE, not to confirm suspicions. When in doubt, classify as
"unknown" -- this is better than a wrong malicious classification that wastes IR resources, or a wrong benign
classification that misses a threat.

## Pre-classification checklist

Before making ANY classification, confirm you have:

- [ ] Searched for related alerts on the same agent/user
- [ ] Checked rule frequency across the environment
- [ ] Investigated process tree and parent-child relationships
- [ ] Reviewed network activity (DNS, connections, lateral movement)
- [ ] Checked for persistence mechanisms (registry, scheduled tasks, services)
- [ ] Looked for defense evasion behaviors
- [ ] Verified code signing status of executables involved
- [ ] Identified environment context (production vs sandbox/test)
- [ ] Considered if this matches a known false positive pattern

If you cannot check most of the above, either gather more context or classify as "unknown."

## Classification: Benign (score 0-19)

Confirmed false positive or legitimate activity.

**Use when you have positive evidence of legitimacy:**

- Recognized enterprise software performing expected functions
- Known IT management/deployment activity (SCCM, Group Policy, Intune)
- Security testing with clear test environment indicators
- User-initiated installation of legitimate software
- Rule known to have high FP rate for this specific scenario
- No malicious behaviors observed (no persistence, no C2, no credential theft)

**Examples:**

- SCCM pushing software update via PowerShell
- User installing Discord (large Electron app) from official source
- Atomic Red Team test in designated testing environment
- IT admin using PSExec for legitimate remote management

## Classification: Unknown (score 20-60)

Insufficient information to determine. Needs further investigation.

**Use when:**

- Suspicious indicators BUT lack corroborating evidence of malicious INTENT
- Activity COULD be malicious OR legitimate, and you can't tell which
- Need more context that isn't available in the current data
- First time seeing this pattern with no baseline

**Examples:**

- Unsigned installer running from Temp folder, but no C2/persistence observed
- PowerShell script with obfuscation, but no malicious payload identified
- Process injection APIs used, but target is a child process it spawned itself
- Large binary with WriteProcessMemory, but appears to be Electron/Node.js app

## Classification: Malicious (score 61-100)

Confirmed or highly suspected malicious activity.

**Requires at least ONE high-confidence indicator:**

- Confirmed C2 communication (beaconing to known bad IP/domain)
- Persistence mechanisms established (registry Run keys, scheduled tasks, services)
- Credential theft (LSASS access, credential file access, keylogging)
- Lateral movement (RDP/SMB/WinRM to other internal hosts)
- Active defense evasion (disabling AV, clearing logs, timestomping)
- Known malware hash match
- Data exfiltration observed

**NOT sufficient alone (these require corroboration):**

- Unsigned binary (many legitimate apps are unsigned)
- Large file size (Electron apps are routinely 100MB+)
- Running from Temp folder (installers commonly do this)
- WriteProcessMemory API (used by legitimate apps for child process creation)
- VirtualAlloc RWX (used by JIT compilers in .NET, Java, Node.js)
- Alert severity is "critical" (severity is rule author's opinion, not evidence)
- Rule name contains "Malicious" (rule names are often sensationalized)

## Behavioral weight table

### Strong indicators (can support MALICIOUS)

| Behavior                                               | Score range |
| ------------------------------------------------------ | ----------- |
| Persistence + C2 together                              | 75+         |
| Credential access (actual LSASS memory read)           | 80+         |
| Confirmed C2 beaconing to known-bad infrastructure     | 75+         |
| Lateral movement (connections to other internal hosts) | 75+         |
| Active AV/EDR disabling                                | 80+         |
| Known malware hash match                               | 90+         |

### Weak indicators (alone = UNKNOWN)

| Behavior                                                  | Score range |
| --------------------------------------------------------- | ----------- |
| Process injection APIs without confirmed malicious target | 35-50       |
| Binary padding / large file alone                         | 25-40       |
| WriteProcessMemory to own child process                   | 20-30       |
| VirtualAlloc RWX                                          | 20-35       |
| Unsigned executable                                       | 25-40       |
| Running from Temp/AppData                                 | 25-40       |
| PowerShell execution                                      | 20-35       |
| Network connection alone (without C2 indicators)          | 30-45       |

**Rule**: Single suspicious behaviors without corroborating evidence = UNKNOWN, not MALICIOUS.

## Common false positive sources

### Enterprise management tools

Legitimate IT management often looks suspicious. Examples: SCCM/MECM, Group Policy, Intune/MDM, Ansible/Puppet/Chef,
remote monitoring tools (ConnectWise, Datto, NinjaRMM).

**Legitimacy indicators**: Parent process is a known management agent; activity correlates with IT maintenance windows;
same activity seen across many managed endpoints.

### Security software

Security tools use techniques that look like malware. Examples: DLP agents, EDR agents themselves, vulnerability
scanners, password managers, PAM tools.

**Legitimacy indicators**: Signed by known security vendor; running from Program Files with proper installation; part of
approved security stack.

### Software protection and DRM

Copy protection uses evasive techniques by design. Examples: Denuvo, VMProtect, Themida, game anti-cheat (EasyAntiCheat,
BattlEye, Vanguard), license enforcement.

**Legitimacy indicators**: Associated with known commercial software; no network C2 activity; no persistence beyond the
protected application.

### Large application frameworks

Modern apps are often large and spawn many processes. Examples: Electron apps (Slack, Discord, VS Code, Teams at
100MB+), Node.js apps, game launchers, IDEs.

**Legitimacy indicators**: User intentionally installed; from known vendor; process tree shows normal application
behavior.

### Security testing

Intentional tests trigger real alerts. Examples: Atomic Red Team, Caldera, penetration testing tools, phishing
simulations, malware detonation sandboxes.

**Legitimacy indicators**: Running in designated test environment; parent process is test harness; policy name includes
"test", "detonate", "simulation".

## Sandbox and testing environments

### How to identify

- Policy names containing "detonate", "sandbox", "test", "simulation"
- Parent process patterns like "detonate.py", "sandbox.exe"
- `data_stream.namespace` values like "benign", "test", "simulation"
- Hostnames matching "sandbox-_", "detonation-_", "test-\*"

### Classification rules for sandboxes

Apply the SAME evidence standards as production:

1. MALICIOUS requires strong evidence: actual C2, persistence created, credentials stolen
2. UNKNOWN when behavior is suspicious but lacks corroborating evidence
3. BENIGN when no malicious indicators observed
4. Document the sandbox context in case notes

Being in a sandbox does NOT mean everything detonated is malicious. Many samples are benign/grayware. Suspicious-looking
behavior without outcomes is not malicious.
