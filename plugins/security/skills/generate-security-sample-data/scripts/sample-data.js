#!/usr/bin/env node
/**
 * Generate realistic ECS-compliant security events for installed packages.
 * Populates dashboards and triggers detection rules so onboarding isn't hollow.
 *
 * Uses RFC 5737 (192.0.2.x, 198.51.100.x, 203.0.113.x) and RFC 2606
 * (example.com) addresses to avoid triggering real security incidents.
 */

import crypto from "node:crypto";
import { createInterface } from "readline";
import { createClient } from "./es-client.js";
import { kibanaDelete, kibanaGet } from "./kibana-client.js";

const FAKE_USERS = ["alice", "bob", "charlie", "dave", "eve", "frank"];
const FAKE_HOSTS = ["web-prod-01", "db-prod-02", "app-staging-03", "jumpbox-01", "ci-runner-04"];
const FAKE_IPS = ["192.0.2.10", "192.0.2.25", "198.51.100.5", "198.51.100.42", "203.0.113.7", "203.0.113.99"];

function promptConfirm(message) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function recentTimestamp(hoursBack = 24) {
  const now = Date.now();
  const offset = Math.random() * hoursBack * 60 * 60 * 1000;
  return new Date(now - offset).toISOString();
}

const DEFAULT_STACK_VERSION = "8.17.0";
const SAMPLE_DATA_MARKER = "elastic-security-sample-data";
const CLEANUP_SOURCE_SCAN_LOOKBACK = "now-14d";
const CLEANUP_SOURCE_SCAN_PAGE_SIZE = 500;

let _stackVersion = DEFAULT_STACK_VERSION;
let _detected = false;

async function detectClusterVersions(client) {
  if (_detected) return;
  _detected = true;

  try {
    const info = await client.info();
    _stackVersion = info.version.number;
    console.log(`  Detected stack version: ${_stackVersion}\n`);
  } catch {
    console.warn(`  Warning: could not detect stack version, using default ${DEFAULT_STACK_VERSION}\n`);
  }
}

function stackVersion() {
  return ecsVersion();
}

function ecsVersion() {
  // ECS expects major.minor.0 (not stack patch versions).
  const [major, minor] = String(_stackVersion).split(".");
  return `${major || "8"}.${minor || "17"}.0`;
}

function fullStackVersion() {
  return _stackVersion;
}

function baseEvent(overrides = {}) {
  return {
    "@timestamp": recentTimestamp(),
    "ecs.version": ecsVersion(),
    tags: [SAMPLE_DATA_MARKER],
    ...overrides,
  };
}

const EVENT_GENERATORS = {
  system: () => {
    const templates = [
      () =>
        baseEvent({
          "event.category": ["authentication"],
          "event.type": ["start"],
          "event.kind": "event",
          "event.outcome": "success",
          "event.module": "system",
          "event.dataset": "system.auth",
          "event.action": "logged-in",
          "user.name": randomFrom(FAKE_USERS),
          "source.ip": randomFrom(FAKE_IPS),
          "host.name": randomFrom(FAKE_HOSTS),
          "host.os.family": "linux",
          message: `Accepted publickey for ${randomFrom(FAKE_USERS)} from ${randomFrom(FAKE_IPS)} port ${randomInt(1024, 65535)}`,
          "data_stream.type": "logs",
          "data_stream.dataset": "system.auth",
          "data_stream.namespace": "default",
        }),
      () =>
        baseEvent({
          "event.category": ["authentication"],
          "event.type": ["start"],
          "event.kind": "event",
          "event.outcome": "failure",
          "event.module": "system",
          "event.dataset": "system.auth",
          "event.action": "logon-failed",
          "user.name": randomFrom(["root", "admin", "test", ...FAKE_USERS]),
          "source.ip": randomFrom(FAKE_IPS),
          "host.name": randomFrom(FAKE_HOSTS),
          "host.os.family": "linux",
          message: `Failed password for invalid user ${randomFrom(["root", "admin"])} from ${randomFrom(FAKE_IPS)} port ${randomInt(1024, 65535)}`,
          "data_stream.type": "logs",
          "data_stream.dataset": "system.auth",
          "data_stream.namespace": "default",
        }),
      () =>
        baseEvent({
          "event.category": ["process"],
          "event.type": ["start"],
          "event.kind": "event",
          "event.module": "system",
          "event.dataset": "system.syslog",
          "host.name": randomFrom(FAKE_HOSTS),
          "host.os.family": "linux",
          "process.name": randomFrom(["sshd", "cron", "systemd", "nginx", "dockerd"]),
          "process.pid": randomInt(1000, 50000),
          message: `${randomFrom(["Started", "Stopped", "Reloaded"])} ${randomFrom(["nginx.service", "docker.service", "sshd.service"])}`,
          "data_stream.type": "logs",
          "data_stream.dataset": "system.syslog",
          "data_stream.namespace": "default",
        }),
    ];
    return randomFrom(templates)();
  },

  endpoint: () => {
    const templates = [
      () =>
        baseEvent({
          "event.category": ["process"],
          "event.type": ["start"],
          "event.kind": "event",
          "event.module": "endpoint",
          "event.dataset": "endpoint.events.process",
          "event.action": "exec",
          "host.name": randomFrom(FAKE_HOSTS),
          "host.os.family": randomFrom(["linux", "windows", "macos"]),
          "process.name": randomFrom(["curl", "wget", "python3", "powershell.exe", "cmd.exe", "bash"]),
          "process.pid": randomInt(1000, 50000),
          "process.executable": randomFrom(["/usr/bin/curl", "/usr/bin/python3", "C:\\Windows\\System32\\cmd.exe"]),
          "process.args": [randomFrom(["-L", "-o", "-c", "/k", "-exec"])],
          "process.parent.name": randomFrom(["bash", "zsh", "explorer.exe", "sshd"]),
          "process.parent.pid": randomInt(500, 5000),
          "user.name": randomFrom(FAKE_USERS),
          "data_stream.type": "logs",
          "data_stream.dataset": "endpoint.events.process",
          "data_stream.namespace": "default",
        }),
      () =>
        baseEvent({
          "event.category": ["network"],
          "event.type": ["connection", "start"],
          "event.kind": "event",
          "event.module": "endpoint",
          "event.dataset": "endpoint.events.network",
          "event.action": "connection_attempted",
          "host.name": randomFrom(FAKE_HOSTS),
          "process.name": randomFrom(["chrome", "firefox", "curl", "python3"]),
          "process.pid": randomInt(1000, 50000),
          "source.ip": "10.0.0." + randomInt(1, 254),
          "destination.ip": randomFrom(FAKE_IPS),
          "destination.port": randomFrom([80, 443, 8080, 8443, 22]),
          "network.transport": "tcp",
          "user.name": randomFrom(FAKE_USERS),
          "data_stream.type": "logs",
          "data_stream.dataset": "endpoint.events.network",
          "data_stream.namespace": "default",
        }),
      () =>
        baseEvent({
          "event.category": ["file"],
          "event.type": ["creation"],
          "event.kind": "event",
          "event.module": "endpoint",
          "event.dataset": "endpoint.events.file",
          "event.action": "creation",
          "host.name": randomFrom(FAKE_HOSTS),
          "file.name": randomFrom(["payload.exe", "report.pdf", "config.yaml", "update.sh", "notes.txt"]),
          "file.path": randomFrom(["/tmp/payload.exe", "/home/user/report.pdf", "C:\\Temp\\update.bat"]),
          "file.extension": randomFrom(["exe", "pdf", "yaml", "sh", "txt"]),
          "process.name": randomFrom(["bash", "explorer.exe", "python3"]),
          "user.name": randomFrom(FAKE_USERS),
          "data_stream.type": "logs",
          "data_stream.dataset": "endpoint.events.file",
          "data_stream.namespace": "default",
        }),
    ];
    return randomFrom(templates)();
  },

  windows: () => {
    const templates = [
      () =>
        baseEvent({
          "event.category": ["authentication"],
          "event.type": ["start"],
          "event.kind": "event",
          "event.code": "4624",
          "event.action": "logged-in",
          "event.outcome": "success",
          "event.module": "windows",
          "event.dataset": "windows.security",
          "event.provider": "Microsoft-Windows-Security-Auditing",
          "winlog.event_id": 4624,
          "winlog.channel": "Security",
          "winlog.logon.type": randomFrom(["Interactive", "Network", "RemoteInteractive"]),
          "host.name": randomFrom(FAKE_HOSTS),
          "host.os.family": "windows",
          "user.name": randomFrom(FAKE_USERS),
          "user.domain": "CORP",
          "source.ip": randomFrom(FAKE_IPS),
          "data_stream.type": "logs",
          "data_stream.dataset": "windows.security",
          "data_stream.namespace": "default",
        }),
      () =>
        baseEvent({
          "event.category": ["authentication"],
          "event.type": ["start"],
          "event.kind": "event",
          "event.code": "4625",
          "event.action": "logon-failed",
          "event.outcome": "failure",
          "event.module": "windows",
          "event.dataset": "windows.security",
          "event.provider": "Microsoft-Windows-Security-Auditing",
          "winlog.event_id": 4625,
          "winlog.channel": "Security",
          "host.name": randomFrom(FAKE_HOSTS),
          "host.os.family": "windows",
          "user.name": randomFrom(["Administrator", "admin", ...FAKE_USERS]),
          "user.domain": "CORP",
          "source.ip": randomFrom(FAKE_IPS),
          "data_stream.type": "logs",
          "data_stream.dataset": "windows.security",
          "data_stream.namespace": "default",
        }),
      () =>
        baseEvent({
          "event.category": ["process"],
          "event.type": ["start"],
          "event.kind": "event",
          "event.code": "4688",
          "event.action": "created-process",
          "event.module": "windows",
          "event.dataset": "windows.security",
          "event.provider": "Microsoft-Windows-Security-Auditing",
          "winlog.event_id": 4688,
          "winlog.channel": "Security",
          "host.name": randomFrom(FAKE_HOSTS),
          "host.os.family": "windows",
          "process.name": randomFrom(["cmd.exe", "powershell.exe", "notepad.exe", "msiexec.exe", "schtasks.exe"]),
          "process.executable": randomFrom([
            "C:\\Windows\\System32\\cmd.exe",
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
          ]),
          "process.pid": randomInt(1000, 50000),
          "process.parent.name": randomFrom(["explorer.exe", "services.exe", "cmd.exe"]),
          "user.name": randomFrom(FAKE_USERS),
          "user.domain": "CORP",
          "data_stream.type": "logs",
          "data_stream.dataset": "windows.security",
          "data_stream.namespace": "default",
        }),
    ];
    return randomFrom(templates)();
  },

  aws: () => {
    const awsAcct = "123456789012";
    const templates = [
      () =>
        baseEvent({
          "event.category": ["authentication"],
          "event.type": ["info"],
          "event.kind": "event",
          "event.action": "ConsoleLogin",
          "event.outcome": randomFrom(["success", "success", "success", "failure"]),
          "event.module": "aws",
          "event.dataset": "aws.cloudtrail",
          "cloud.provider": "aws",
          "cloud.account.id": awsAcct,
          "cloud.region": randomFrom(["us-east-1", "us-west-2", "eu-west-1"]),
          "aws.cloudtrail.event_type": "AwsConsoleSignIn",
          "user.name": randomFrom(FAKE_USERS),
          "source.ip": randomFrom(FAKE_IPS),
          "user_agent.original": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          "data_stream.type": "logs",
          "data_stream.dataset": "aws.cloudtrail",
          "data_stream.namespace": "default",
        }),
      () =>
        baseEvent({
          "event.category": ["iam"],
          "event.type": ["info"],
          "event.kind": "event",
          "event.action": "AssumeRole",
          "event.outcome": "success",
          "event.module": "aws",
          "event.dataset": "aws.cloudtrail",
          "cloud.provider": "aws",
          "cloud.account.id": awsAcct,
          "cloud.region": randomFrom(["us-east-1", "us-west-2"]),
          "aws.cloudtrail.event_type": "AwsApiCall",
          "user.name": randomFrom(FAKE_USERS),
          "source.ip": randomFrom(FAKE_IPS),
          "data_stream.type": "logs",
          "data_stream.dataset": "aws.cloudtrail",
          "data_stream.namespace": "default",
        }),
      () =>
        baseEvent({
          "event.category": ["network"],
          "event.type": ["info"],
          "event.kind": "event",
          "event.action": randomFrom([
            "AuthorizeSecurityGroupIngress",
            "RunInstances",
            "StopInstances",
            "CreateBucket",
          ]),
          "event.outcome": "success",
          "event.module": "aws",
          "event.dataset": "aws.cloudtrail",
          "cloud.provider": "aws",
          "cloud.account.id": awsAcct,
          "cloud.region": randomFrom(["us-east-1", "us-west-2", "eu-west-1"]),
          "aws.cloudtrail.event_type": "AwsApiCall",
          "user.name": randomFrom(FAKE_USERS),
          "source.ip": randomFrom(FAKE_IPS),
          "data_stream.type": "logs",
          "data_stream.dataset": "aws.cloudtrail",
          "data_stream.namespace": "default",
        }),
    ];
    return randomFrom(templates)();
  },

  okta: () => {
    const templates = [
      () =>
        baseEvent({
          "event.category": ["authentication"],
          "event.type": ["start"],
          "event.kind": "event",
          "event.action": "user.session.start",
          "event.outcome": "success",
          "event.module": "okta",
          "event.dataset": "okta.system",
          "okta.event_type": "user.session.start",
          "okta.display_message": "User login to Okta",
          "okta.outcome.result": "SUCCESS",
          "user.name": randomFrom(FAKE_USERS),
          "user.email": `${randomFrom(FAKE_USERS)}@example.com`,
          "source.ip": randomFrom(FAKE_IPS),
          "user_agent.original": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          "data_stream.type": "logs",
          "data_stream.dataset": "okta.system",
          "data_stream.namespace": "default",
        }),
      () =>
        baseEvent({
          "event.category": ["authentication"],
          "event.type": ["info"],
          "event.kind": "event",
          "event.action": "user.authentication.auth_via_mfa",
          "event.outcome": randomFrom(["success", "success", "failure"]),
          "event.module": "okta",
          "event.dataset": "okta.system",
          "okta.event_type": "user.authentication.auth_via_mfa",
          "okta.display_message": "Authentication of user via MFA",
          "okta.outcome.result": randomFrom(["SUCCESS", "SUCCESS", "FAILURE"]),
          "okta.authentication_context.authentication_step": randomInt(1, 3),
          "user.name": randomFrom(FAKE_USERS),
          "user.email": `${randomFrom(FAKE_USERS)}@example.com`,
          "source.ip": randomFrom(FAKE_IPS),
          "data_stream.type": "logs",
          "data_stream.dataset": "okta.system",
          "data_stream.namespace": "default",
        }),
      () =>
        baseEvent({
          "event.category": ["iam"],
          "event.type": ["change"],
          "event.kind": "event",
          "event.action": randomFrom([
            "user.account.lock",
            "user.account.update_password",
            "group.user_membership.add",
          ]),
          "event.outcome": "success",
          "event.module": "okta",
          "event.dataset": "okta.system",
          "okta.event_type": randomFrom(["user.account.lock", "user.account.update_password"]),
          "okta.outcome.result": "SUCCESS",
          "user.name": randomFrom(FAKE_USERS),
          "user.email": `${randomFrom(FAKE_USERS)}@example.com`,
          "user.target.name": randomFrom(FAKE_USERS),
          "source.ip": randomFrom(FAKE_IPS),
          "data_stream.type": "logs",
          "data_stream.dataset": "okta.system",
          "data_stream.namespace": "default",
        }),
    ];
    return randomFrom(templates)();
  },
};

function generateEvents(packageName, count) {
  const generator = EVENT_GENERATORS[packageName];
  if (!generator) return [];
  const events = [];
  for (let i = 0; i < count; i++) {
    events.push(generator());
  }
  return events;
}

function getDataStreamIndex(event) {
  const type = event["data_stream.type"] || "logs";
  const dataset = event["data_stream.dataset"] || "generic";
  const namespace = event["data_stream.namespace"] || "default";
  return `${type}-${dataset}-${namespace}`;
}

async function bulkIndex(client, events) {
  if (!events.length) return { indexed: 0, errors: 0 };

  const body = [];
  for (const event of events) {
    // Ensure every event can be cleaned up via --cleanup, including attack scenarios.
    const tags = Array.isArray(event.tags) ? event.tags : [];
    const enriched = tags.includes(SAMPLE_DATA_MARKER) ? event : { ...event, tags: [...tags, SAMPLE_DATA_MARKER] };

    body.push({ create: { _index: getDataStreamIndex(enriched) } });
    body.push(enriched);
  }

  const result = await client.bulk({ body, refresh: "wait_for" });

  let indexed = 0;
  let errors = 0;
  if (result.items) {
    for (const item of result.items) {
      const op = item.create || item.index;
      if (op?.error) {
        errors++;
      } else {
        indexed++;
      }
    }
  }

  return { indexed, errors, firstError: result.items?.find((i) => (i.create || i.index)?.error) };
}

// ---------------------------------------------------------------------------
// Attack simulation scenarios
// Correlated event sequences designed to trigger prebuilt detection rules.
// Each scenario returns an array of events with coherent timestamps, hosts,
// users, and IPs that tell a recognizable attack story.
// ---------------------------------------------------------------------------

function sequentialTimestamps(count, startHoursBack = 2, intervalMinutes = 1) {
  const start = Date.now() - startHoursBack * 60 * 60 * 1000;
  return Array.from({ length: count }, (_, i) => new Date(start + i * intervalMinutes * 60 * 1000).toISOString());
}

const ATTACK_SCENARIOS = {
  /**
   * Windows credential access chain: failed logins → success → suspicious
   * process execution (mimikatz-like, encoded powershell, scheduled task).
   * Triggers: "Multiple Logon Failure from Same Source",
   *           "Suspicious PowerShell Encoded Command",
   *           "Persistence via Scheduled Task", "Credential Dumping".
   */
  windowsCredentialAccess() {
    const attackerIP = "198.51.100.77";
    const host = "db-prod-02";
    const user = "svc_backup";
    const ts = sequentialTimestamps(15, 1.5, 0.5);
    const events = [];

    for (let i = 0; i < 8; i++) {
      events.push({
        "@timestamp": ts[i],
        "ecs.version": ecsVersion(),
        "event.category": ["authentication"],
        "event.type": ["start"],
        "event.kind": "event",
        "event.code": "4625",
        "event.action": "logon-failed",
        "event.outcome": "failure",
        "event.module": "windows",
        "event.dataset": "windows.security",
        "event.provider": "Microsoft-Windows-Security-Auditing",
        "winlog.event_id": 4625,
        "winlog.channel": "Security",
        "host.name": host,
        "host.os.family": "windows",
        "host.os.type": "windows",
        "user.name": user,
        "user.domain": "CORP",
        "source.ip": attackerIP,
        "data_stream.type": "logs",
        "data_stream.dataset": "windows.security",
        "data_stream.namespace": "default",
      });
    }

    events.push({
      "@timestamp": ts[8],
      "ecs.version": ecsVersion(),
      "event.category": ["authentication"],
      "event.type": ["start"],
      "event.kind": "event",
      "event.code": "4624",
      "event.action": "logged-in",
      "event.outcome": "success",
      "event.module": "windows",
      "event.dataset": "windows.security",
      "event.provider": "Microsoft-Windows-Security-Auditing",
      "winlog.event_id": 4624,
      "winlog.channel": "Security",
      "winlog.logon.type": "Network",
      "host.name": host,
      "host.os.family": "windows",
      "host.os.type": "windows",
      "user.name": user,
      "user.domain": "CORP",
      "source.ip": attackerIP,
      "data_stream.type": "logs",
      "data_stream.dataset": "windows.security",
      "data_stream.namespace": "default",
    });

    const suspiciousProcesses = [
      {
        name: "powershell.exe",
        executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        args: ["-EncodedCommand", "SQBuAHYAbwBrAGUALQBXAGUAYgBSAGUAcQB1AGUAcwB0AA=="],
        parent: "cmd.exe",
        code: "4688",
      },
      {
        name: "schtasks.exe",
        executable: "C:\\Windows\\System32\\schtasks.exe",
        args: ["/create", "/tn", "SystemUpdate", "/tr", "C:\\Temp\\update.exe", "/sc", "onlogon"],
        parent: "powershell.exe",
        code: "4688",
      },
      {
        name: "procdump.exe",
        executable: "C:\\Temp\\procdump.exe",
        args: ["-ma", "lsass.exe", "C:\\Temp\\lsass.dmp"],
        parent: "cmd.exe",
        code: "4688",
      },
      {
        name: "reg.exe",
        executable: "C:\\Windows\\System32\\reg.exe",
        args: ["save", "HKLM\\SAM", "C:\\Temp\\sam.hiv"],
        parent: "cmd.exe",
        code: "4688",
      },
    ];

    suspiciousProcesses.forEach((proc, i) => {
      events.push({
        "@timestamp": ts[9 + i],
        "ecs.version": ecsVersion(),
        "event.category": ["process"],
        "event.type": ["start"],
        "event.kind": "event",
        "event.code": proc.code,
        "event.action": "created-process",
        "event.module": "windows",
        "event.dataset": "windows.security",
        "event.provider": "Microsoft-Windows-Security-Auditing",
        "winlog.event_id": parseInt(proc.code, 10),
        "winlog.channel": "Security",
        "host.name": host,
        "host.os.family": "windows",
        "host.os.type": "windows",
        "process.name": proc.name,
        "process.executable": proc.executable,
        "process.args": proc.args,
        "process.command_line": `${proc.executable} ${proc.args.join(" ")}`,
        "process.pid": randomInt(1000, 50000),
        "process.parent.name": proc.parent,
        "process.parent.pid": randomInt(500, 5000),
        "user.name": user,
        "user.domain": "CORP",
        "data_stream.type": "logs",
        "data_stream.dataset": "windows.security",
        "data_stream.namespace": "default",
      });
    });

    return events;
  },
  /**
   * AWS IAM attack chain: console login from unusual geo → new IAM user →
   * attach admin policy → create access keys → disable CloudTrail.
   * Triggers: "AWS Console Login Without MFA", "AWS IAM User Created",
   *           "AWS CloudTrail Logging Disabled", "Privilege Escalation".
   */
  awsIAMEscalation() {
    const attackerIP = "203.0.113.99";
    const awsAcct = "123456789012";
    const user = "compromised-dev";
    const ts = sequentialTimestamps(8, 1, 2);
    const events = [];

    events.push({
      "@timestamp": ts[0],
      "ecs.version": ecsVersion(),
      "event.category": ["authentication"],
      "event.type": ["info"],
      "event.kind": "event",
      "event.action": "ConsoleLogin",
      "event.outcome": "success",
      "event.module": "aws",
      "event.dataset": "aws.cloudtrail",
      "cloud.provider": "aws",
      "cloud.account.id": awsAcct,
      "cloud.region": "us-east-1",
      "aws.cloudtrail.event_type": "AwsConsoleSignIn",
      "aws.cloudtrail.additional_eventdata.MFAUsed": "No",
      "aws.cloudtrail.response_elements": "ConsoleLogin",
      "user.name": user,
      "source.ip": attackerIP,
      "source.geo.country_iso_code": "RU",
      "user_agent.original": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "data_stream.type": "logs",
      "data_stream.dataset": "aws.cloudtrail",
      "data_stream.namespace": "default",
    });

    events.push({
      "@timestamp": ts[1],
      "ecs.version": ecsVersion(),
      "event.category": ["iam"],
      "event.type": ["creation"],
      "event.kind": "event",
      "event.action": "CreateUser",
      "event.outcome": "success",
      "event.module": "aws",
      "event.dataset": "aws.cloudtrail",
      "cloud.provider": "aws",
      "cloud.account.id": awsAcct,
      "cloud.region": "us-east-1",
      "aws.cloudtrail.event_type": "AwsApiCall",
      "user.name": user,
      "user.target.name": "backdoor-admin",
      "source.ip": attackerIP,
      "data_stream.type": "logs",
      "data_stream.dataset": "aws.cloudtrail",
      "data_stream.namespace": "default",
    });

    events.push({
      "@timestamp": ts[2],
      "ecs.version": ecsVersion(),
      "event.category": ["iam"],
      "event.type": ["change"],
      "event.kind": "event",
      "event.action": "AttachUserPolicy",
      "event.outcome": "success",
      "event.module": "aws",
      "event.dataset": "aws.cloudtrail",
      "cloud.provider": "aws",
      "cloud.account.id": awsAcct,
      "cloud.region": "us-east-1",
      "aws.cloudtrail.event_type": "AwsApiCall",
      "aws.cloudtrail.request_parameters":
        '{"policyArn":"arn:aws:iam::aws:policy/AdministratorAccess","userName":"backdoor-admin"}',
      "user.name": user,
      "source.ip": attackerIP,
      "data_stream.type": "logs",
      "data_stream.dataset": "aws.cloudtrail",
      "data_stream.namespace": "default",
    });

    events.push({
      "@timestamp": ts[3],
      "ecs.version": ecsVersion(),
      "event.category": ["iam"],
      "event.type": ["creation"],
      "event.kind": "event",
      "event.action": "CreateAccessKey",
      "event.outcome": "success",
      "event.module": "aws",
      "event.dataset": "aws.cloudtrail",
      "cloud.provider": "aws",
      "cloud.account.id": awsAcct,
      "cloud.region": "us-east-1",
      "aws.cloudtrail.event_type": "AwsApiCall",
      "user.name": user,
      "user.target.name": "backdoor-admin",
      "source.ip": attackerIP,
      "data_stream.type": "logs",
      "data_stream.dataset": "aws.cloudtrail",
      "data_stream.namespace": "default",
    });

    events.push({
      "@timestamp": ts[4],
      "ecs.version": ecsVersion(),
      "event.category": ["configuration"],
      "event.type": ["change"],
      "event.kind": "event",
      "event.action": "StopLogging",
      "event.outcome": "success",
      "event.module": "aws",
      "event.dataset": "aws.cloudtrail",
      "cloud.provider": "aws",
      "cloud.account.id": awsAcct,
      "cloud.region": "us-east-1",
      "aws.cloudtrail.event_type": "AwsApiCall",
      "user.name": user,
      "source.ip": attackerIP,
      "data_stream.type": "logs",
      "data_stream.dataset": "aws.cloudtrail",
      "data_stream.namespace": "default",
    });

    events.push({
      "@timestamp": ts[5],
      "ecs.version": ecsVersion(),
      "event.category": ["configuration"],
      "event.type": ["change"],
      "event.kind": "event",
      "event.action": "DeleteTrail",
      "event.outcome": "success",
      "event.module": "aws",
      "event.dataset": "aws.cloudtrail",
      "cloud.provider": "aws",
      "cloud.account.id": awsAcct,
      "cloud.region": "us-east-1",
      "aws.cloudtrail.event_type": "AwsApiCall",
      "user.name": user,
      "source.ip": attackerIP,
      "data_stream.type": "logs",
      "data_stream.dataset": "aws.cloudtrail",
      "data_stream.namespace": "default",
    });

    return events;
  },

  /**
   * Okta account takeover: credential stuffing → MFA fatigue → session
   * hijack → admin privilege escalation → policy change.
   * Triggers: "Okta Brute Force", "Okta MFA Bombing",
   *           "Okta Admin Role Assigned", "Okta Policy Rule Modified".
   */
  oktaAccountTakeover() {
    const attackerIP = "198.51.100.88";
    const victim = "charlie";
    const ts = sequentialTimestamps(20, 1, 0.2);
    const events = [];

    for (let i = 0; i < 10; i++) {
      events.push({
        "@timestamp": ts[i],
        "ecs.version": ecsVersion(),
        "event.category": ["authentication"],
        "event.type": ["start"],
        "event.kind": "event",
        "event.action": "user.session.start",
        "event.outcome": "failure",
        "event.module": "okta",
        "event.dataset": "okta.system",
        "okta.event_type": "user.session.start",
        "okta.display_message": "User login to Okta",
        "okta.outcome.result": "FAILURE",
        "okta.outcome.reason": "INVALID_CREDENTIALS",
        "user.name": victim,
        "user.email": `${victim}@example.com`,
        "source.ip": attackerIP,
        "user_agent.original": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "data_stream.type": "logs",
        "data_stream.dataset": "okta.system",
        "data_stream.namespace": "default",
      });
    }

    for (let i = 0; i < 5; i++) {
      events.push({
        "@timestamp": ts[10 + i],
        "ecs.version": ecsVersion(),
        "event.category": ["authentication"],
        "event.type": ["info"],
        "event.kind": "event",
        "event.action": "user.authentication.auth_via_mfa",
        "event.outcome": "failure",
        "event.module": "okta",
        "event.dataset": "okta.system",
        "okta.event_type": "user.authentication.auth_via_mfa",
        "okta.display_message": "Authentication of user via MFA",
        "okta.outcome.result": "FAILURE",
        "okta.outcome.reason": "INVALID_CREDENTIALS",
        "user.name": victim,
        "user.email": `${victim}@example.com`,
        "source.ip": attackerIP,
        "data_stream.type": "logs",
        "data_stream.dataset": "okta.system",
        "data_stream.namespace": "default",
      });
    }

    events.push({
      "@timestamp": ts[15],
      "ecs.version": ecsVersion(),
      "event.category": ["authentication"],
      "event.type": ["start"],
      "event.kind": "event",
      "event.action": "user.session.start",
      "event.outcome": "success",
      "event.module": "okta",
      "event.dataset": "okta.system",
      "okta.event_type": "user.session.start",
      "okta.display_message": "User login to Okta",
      "okta.outcome.result": "SUCCESS",
      "user.name": victim,
      "user.email": `${victim}@example.com`,
      "source.ip": attackerIP,
      "user_agent.original": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "data_stream.type": "logs",
      "data_stream.dataset": "okta.system",
      "data_stream.namespace": "default",
    });

    events.push({
      "@timestamp": ts[16],
      "ecs.version": ecsVersion(),
      "event.category": ["iam"],
      "event.type": ["change"],
      "event.kind": "event",
      "event.action": "user.account.privilege.grant",
      "event.outcome": "success",
      "event.module": "okta",
      "event.dataset": "okta.system",
      "okta.event_type": "user.account.privilege.grant",
      "okta.display_message": "Granted admin role to user",
      "okta.outcome.result": "SUCCESS",
      "user.name": victim,
      "user.email": `${victim}@example.com`,
      "user.target.name": victim,
      "source.ip": attackerIP,
      "data_stream.type": "logs",
      "data_stream.dataset": "okta.system",
      "data_stream.namespace": "default",
    });

    events.push({
      "@timestamp": ts[17],
      "ecs.version": ecsVersion(),
      "event.category": ["configuration"],
      "event.type": ["change"],
      "event.kind": "event",
      "event.action": "policy.rule.update",
      "event.outcome": "success",
      "event.module": "okta",
      "event.dataset": "okta.system",
      "okta.event_type": "policy.rule.update",
      "okta.display_message": "Update policy rule",
      "okta.outcome.result": "SUCCESS",
      "user.name": victim,
      "user.email": `${victim}@example.com`,
      "source.ip": attackerIP,
      "data_stream.type": "logs",
      "data_stream.dataset": "okta.system",
      "data_stream.namespace": "default",
    });

    return events;
  },

  ransomwareChain() {
    const host = "app-staging-03";
    const hostId = "a1b2c3d4-host-staging-03";
    const agentId = "e5f6a7b8-agent-staging-03";
    const user = "dave";
    const c2IP = "203.0.113.42";
    const ts = sequentialTimestamps(16, 1, 0.3);
    const events = [];

    const eid = RANSOMWARE_ENTITY_IDS;

    const hostFields = {
      "host.name": host,
      "host.id": hostId,
      "host.os.type": "windows",
      "host.os.family": "windows",
      "agent.id": agentId,
      "agent.type": "endpoint",
    };

    const ep = (dataset) => ({
      "ecs.version": ecsVersion(),
      "event.kind": "event",
      "event.module": "endpoint",
      "event.dataset": `endpoint.events.${dataset}`,
      ...hostFields,
      "user.name": user,
      "data_stream.type": "logs",
      "data_stream.dataset": `endpoint.events.${dataset}`,
      "data_stream.namespace": "default",
    });

    events.push({
      "@timestamp": ts[0],
      ...ep("process"),
      "event.category": ["process"],
      "event.type": ["start"],
      "event.action": "exec",
      "process.name": "WINWORD.EXE",
      "process.executable": "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
      "process.entity_id": eid.winword,
      "process.pid": 4120,
      "process.args": ["C:\\Users\\dave\\Downloads\\Invoice_Q4_2025.docm"],
      "process.command_line": "WINWORD.EXE C:\\Users\\dave\\Downloads\\Invoice_Q4_2025.docm",
      "process.parent.name": "explorer.exe",
      "process.parent.entity_id": eid.explorer,
      "process.parent.pid": 1024,
    });

    events.push({
      "@timestamp": ts[1],
      ...ep("process"),
      "event.category": ["process"],
      "event.type": ["start"],
      "event.action": "exec",
      "process.name": "powershell.exe",
      "process.executable": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      "process.entity_id": eid.powershell,
      "process.pid": 7832,
      "process.args": [
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
        "SQBFAFgAKAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkA",
      ],
      "process.command_line": "powershell.exe -WindowStyle Hidden -EncodedCommand SQBFAFgA...",
      "process.parent.name": "WINWORD.EXE",
      "process.parent.entity_id": eid.winword,
      "process.parent.pid": 4120,
    });

    events.push({
      "@timestamp": ts[2],
      ...ep("network"),
      "event.category": ["network"],
      "event.type": ["connection", "start"],
      "event.action": "connection_attempted",
      "process.name": "powershell.exe",
      "process.entity_id": eid.powershell,
      "process.pid": 7832,
      "source.ip": "10.0.0.50",
      "destination.ip": c2IP,
      "destination.port": 443,
      "network.transport": "tcp",
      "network.direction": "egress",
    });

    events.push({
      "@timestamp": ts[3],
      ...ep("process"),
      "event.category": ["process"],
      "event.type": ["start"],
      "event.action": "exec",
      "process.name": "rundll32.exe",
      "process.executable": "C:\\Windows\\System32\\rundll32.exe",
      "process.entity_id": eid.rundll32,
      "process.pid": 9104,
      "process.args": ["C:\\Windows\\System32\\comsvcs.dll,MiniDump", "656", "C:\\ProgramData\\lsass.dmp", "full"],
      "process.command_line":
        "rundll32.exe C:\\Windows\\System32\\comsvcs.dll,MiniDump 656 C:\\ProgramData\\lsass.dmp full",
      "process.parent.name": "powershell.exe",
      "process.parent.entity_id": eid.powershell,
      "process.parent.pid": 7832,
    });

    events.push({
      "@timestamp": ts[4],
      ...ep("file"),
      "event.category": ["file"],
      "event.type": ["creation"],
      "event.action": "creation",
      "file.name": "beacon.exe",
      "file.path": "C:\\ProgramData\\beacon.exe",
      "file.extension": "exe",
      "process.name": "powershell.exe",
      "process.entity_id": eid.powershell,
      "process.pid": 7832,
    });

    events.push({
      "@timestamp": ts[5],
      ...ep("process"),
      "event.category": ["process"],
      "event.type": ["start"],
      "event.action": "exec",
      "process.name": "beacon.exe",
      "process.executable": "C:\\ProgramData\\beacon.exe",
      "process.entity_id": eid.beacon,
      "process.pid": 11240,
      "process.parent.name": "powershell.exe",
      "process.parent.entity_id": eid.powershell,
      "process.parent.pid": 7832,
    });

    events.push({
      "@timestamp": ts[6],
      ...ep("process"),
      "event.category": ["process"],
      "event.type": ["start"],
      "event.action": "exec",
      "process.name": "vssadmin.exe",
      "process.executable": "C:\\Windows\\System32\\vssadmin.exe",
      "process.entity_id": eid.vssadmin,
      "process.pid": 12004,
      "process.args": ["delete", "shadows", "/all", "/quiet"],
      "process.command_line": "vssadmin.exe delete shadows /all /quiet",
      "process.parent.name": "beacon.exe",
      "process.parent.entity_id": eid.beacon,
      "process.parent.pid": 11240,
    });

    events.push({
      "@timestamp": ts[7],
      ...ep("process"),
      "event.category": ["process"],
      "event.type": ["start"],
      "event.action": "exec",
      "process.name": "bcdedit.exe",
      "process.executable": "C:\\Windows\\System32\\bcdedit.exe",
      "process.entity_id": eid.bcdedit,
      "process.pid": 12200,
      "process.args": ["/set", "{default}", "recoveryenabled", "no"],
      "process.command_line": "bcdedit.exe /set {default} recoveryenabled no",
      "process.parent.name": "beacon.exe",
      "process.parent.entity_id": eid.beacon,
      "process.parent.pid": 11240,
    });

    const encryptedFiles = [
      "document1.docx.encrypted",
      "budget.xlsx.encrypted",
      "presentation.pptx.encrypted",
      "database.mdb.encrypted",
      "report.pdf.encrypted",
    ];
    encryptedFiles.forEach((fname, i) => {
      events.push({
        "@timestamp": ts[8 + i],
        ...ep("file"),
        "event.category": ["file"],
        "event.type": ["change"],
        "event.action": "modification",
        "file.name": fname,
        "file.path": `C:\\Users\\dave\\Documents\\${fname}`,
        "file.extension": "encrypted",
        "process.name": "beacon.exe",
        "process.entity_id": eid.beacon,
        "process.pid": 11240,
      });
    });

    events.push({
      "@timestamp": ts[13],
      ...ep("file"),
      "event.category": ["file"],
      "event.type": ["creation"],
      "event.action": "creation",
      "file.name": "README_RESTORE_FILES.txt",
      "file.path": "C:\\Users\\dave\\Desktop\\README_RESTORE_FILES.txt",
      "file.extension": "txt",
      "process.name": "beacon.exe",
      "process.entity_id": eid.beacon,
      "process.pid": 11240,
    });

    return events;
  },
};

export const AVAILABLE_SCENARIOS = Object.keys(ATTACK_SCENARIOS);

export async function runAttackScenarios(scenarioNames) {
  const client = createClient();
  await detectClusterVersions(client);
  const results = {};
  let totalIndexed = 0;
  let totalErrors = 0;

  const toRun = scenarioNames.length ? scenarioNames : [...AVAILABLE_SCENARIOS];

  for (const name of toRun) {
    const generator = ATTACK_SCENARIOS[name];
    if (!generator) {
      results[name] = { status: "skipped", reason: "unknown scenario" };
      continue;
    }

    const events = generator();
    console.log(`  Scenario "${name}": ${events.length} correlated events...`);

    try {
      const { indexed, errors, firstError } = await bulkIndex(client, events);
      totalIndexed += indexed;
      totalErrors += errors;
      results[name] = { status: "ok", indexed, errors, eventCount: events.length };
      if (errors > 0 && firstError) {
        const errDetail = (firstError.create || firstError.index)?.error;
        console.error(
          `    Warning: ${errors} event(s) failed. First error: ${errDetail?.reason || JSON.stringify(errDetail)}`,
        );
      }
      console.log(`    ${indexed} indexed, ${errors} failed`);
    } catch (e) {
      totalErrors += events.length;
      results[name] = { status: "error", error: e.message };
      console.error(`    Error: ${e.message}`);
    }
  }

  await client.close();
  return { results, totalIndexed, totalErrors };
}

// ---------------------------------------------------------------------------
// Synthetic alert documents
// Indexes directly into .alerts-security.alerts-default so that the Alerts
// tab, Attack Discovery, and case workflows light up immediately without
// waiting for detection rules to fire.
// ---------------------------------------------------------------------------

function alertId() {
  return crypto.randomUUID();
}

const RANSOMWARE_ENTITY_IDS = {
  explorer: "d0a1b2c3-0001-4aaa-bbbb-000000000001",
  winword: "d0a1b2c3-0002-4aaa-bbbb-000000000002",
  powershell: "d0a1b2c3-0003-4aaa-bbbb-000000000003",
  rundll32: "d0a1b2c3-0004-4aaa-bbbb-000000000004",
  beacon: "d0a1b2c3-0005-4aaa-bbbb-000000000005",
  vssadmin: "d0a1b2c3-0006-4aaa-bbbb-000000000006",
  bcdedit: "d0a1b2c3-0007-4aaa-bbbb-000000000007",
};

function buildAlert({
  timestamp,
  ruleName,
  ruleId,
  ruleType = "query",
  severity = "high",
  riskScore = 73,
  tactics = [],
  techniques = [],
  sourceEvent = {},
  description = "",
}) {
  const now = timestamp || new Date().toISOString();
  const originalTime = sourceEvent["@timestamp"] || now;

  const threat = [];
  if (tactics.length || techniques.length) {
    const tacticEntries = tactics.map((t) => ({
      id: t.id,
      name: t.name,
      reference: `https://attack.mitre.org/tactics/${t.id}/`,
    }));
    const techniqueEntries = techniques.map((t) => ({
      id: t.id,
      name: t.name,
      reference: `https://attack.mitre.org/techniques/${t.id.replace(".", "/")}/`,
      ...(t.subtechnique
        ? {
            subtechnique: [
              {
                id: t.subtechnique.id,
                name: t.subtechnique.name,
                reference: `https://attack.mitre.org/techniques/${t.subtechnique.id.replace(".", "/")}/`,
              },
            ],
          }
        : {}),
    }));

    threat.push({
      framework: "MITRE ATT&CK",
      ...(tacticEntries.length ? { tactic: tacticEntries[0] } : {}),
      ...(techniqueEntries.length ? { technique: techniqueEntries } : {}),
    });
  }

  const hostName = sourceEvent["host.name"] || "";
  const userName = sourceEvent["user.name"] || "";
  const processName = sourceEvent["process.name"] || "";
  const sourceIp = sourceEvent["source.ip"] || "";
  const message = sourceEvent.message || description;

  const reasonParts = [];
  if (processName) reasonParts.push(`process event with process ${processName}`);
  else if (sourceEvent["event.action"]) reasonParts.push(`${sourceEvent["event.action"]} event`);
  else reasonParts.push(ruleName);
  if (userName) reasonParts.push(`by ${userName}`);
  if (hostName) reasonParts.push(`on ${hostName}`);
  if (sourceIp) reasonParts.push(`from ${sourceIp}`);
  const reason = reasonParts.join(", ");

  const ruleUuid = alertId();
  const docId = alertId();
  const executionUuid = alertId();
  const ancestorId = alertId();

  const alert = {
    "@timestamp": now,
    ecs: { version: stackVersion() },
    event: {
      kind: "signal",
      category: sourceEvent["event.category"] || ["threat"],
      type: sourceEvent["event.type"] || ["indicator"],
      action: sourceEvent["event.action"] || "",
      module: sourceEvent["event.module"] || "",
      dataset: sourceEvent["event.dataset"] || "",
      outcome: sourceEvent["event.outcome"] || "",
    },
    message,
    kibana: {
      alert: {
        rule: {
          name: ruleName,
          rule_id: ruleId,
          uuid: ruleUuid,
          rule_type_id: "siem.queryRule",
          type: ruleType,
          category: "Custom Query Rule",
          description,
          producer: "siem",
          consumer: "siem",
          tags: ["Sample Data", "Attack Simulation"],
          revision: 1,
          parameters: {},
          execution: { uuid: executionUuid },
        },
        status: "active",
        workflow_status: "open",
        workflow_tags: [],
        severity,
        risk_score: riskScore,
        depth: 1,
        reason,
        original_time: originalTime,
        uuid: docId,
        url: "",
        start: now,
        time_range: { gte: now },
        ancestors: [
          {
            id: ancestorId,
            type: "event",
            index: `logs-${sourceEvent["event.dataset"] || "generic"}-default`,
            depth: 0,
          },
        ],
      },
      space_ids: ["default"],
      version: fullStackVersion(),
    },
    ...(threat.length ? { threat } : {}),
  };

  if (hostName) {
    alert.host = {
      name: hostName,
      ...(sourceEvent["host.id"] ? { id: sourceEvent["host.id"] } : {}),
      ...(sourceEvent["host.os.family"]
        ? { os: { family: sourceEvent["host.os.family"], type: sourceEvent["host.os.type"] || "" } }
        : {}),
    };
  }
  if (sourceEvent["agent.id"]) {
    alert.agent = {
      id: sourceEvent["agent.id"],
      ...(sourceEvent["agent.type"] ? { type: sourceEvent["agent.type"] } : {}),
    };
  }
  if (userName) {
    alert.user = { name: userName, ...(sourceEvent["user.domain"] ? { domain: sourceEvent["user.domain"] } : {}) };
  }
  if (sourceIp) {
    alert.source = {
      ip: sourceIp,
      ...(sourceEvent["source.geo.country_iso_code"]
        ? { geo: { country_iso_code: sourceEvent["source.geo.country_iso_code"] } }
        : {}),
    };
  }
  if (sourceEvent["destination.ip"]) {
    alert.destination = {
      ip: sourceEvent["destination.ip"],
      ...(sourceEvent["destination.port"] ? { port: sourceEvent["destination.port"] } : {}),
    };
  }
  if (processName || sourceEvent["process.executable"]) {
    const parent = {};
    if (sourceEvent["process.parent.name"]) parent.name = sourceEvent["process.parent.name"];
    if (sourceEvent["process.parent.entity_id"]) parent.entity_id = sourceEvent["process.parent.entity_id"];
    if (sourceEvent["process.parent.pid"]) parent.pid = sourceEvent["process.parent.pid"];

    alert.process = {
      ...(processName ? { name: processName } : {}),
      ...(sourceEvent["process.entity_id"] ? { entity_id: sourceEvent["process.entity_id"] } : {}),
      ...(sourceEvent["process.pid"] ? { pid: sourceEvent["process.pid"] } : {}),
      ...(sourceEvent["process.executable"] ? { executable: sourceEvent["process.executable"] } : {}),
      ...(sourceEvent["process.args"] ? { args: sourceEvent["process.args"] } : {}),
      ...(sourceEvent["process.command_line"] ? { command_line: sourceEvent["process.command_line"] } : {}),
      ...(Object.keys(parent).length ? { parent } : {}),
    };
  }
  if (sourceEvent["file.name"] || sourceEvent["file.path"]) {
    alert.file = {
      ...(sourceEvent["file.name"] ? { name: sourceEvent["file.name"] } : {}),
      ...(sourceEvent["file.path"] ? { path: sourceEvent["file.path"] } : {}),
    };
  }
  if (sourceEvent["cloud.provider"]) {
    alert.cloud = {
      provider: sourceEvent["cloud.provider"],
      ...(sourceEvent["cloud.account.id"] ? { account: { id: sourceEvent["cloud.account.id"] } } : {}),
      ...(sourceEvent["cloud.region"] ? { region: sourceEvent["cloud.region"] } : {}),
    };
  }

  return alert;
}

const ALERT_SCENARIOS = {
  credentialAccessAlerts() {
    const host = "db-prod-02";
    const user = "svc_backup";
    const attackerIP = "198.51.100.77";
    const ts = sequentialTimestamps(6, 1.5, 0.5);
    return [
      buildAlert({
        timestamp: ts[0],
        ruleName: "Windows Logon Brute Force",
        ruleId: "sample-windows-brute-force",
        severity: "high",
        riskScore: 73,
        description: "Multiple failed Windows logon attempts from a single source address.",
        tactics: [{ id: "TA0006", name: "Credential Access" }],
        techniques: [{ id: "T1110", name: "Brute Force" }],
        sourceEvent: {
          "@timestamp": ts[0],
          "event.category": ["authentication"],
          "event.action": "logon-failed",
          "event.outcome": "failure",
          "event.module": "windows",
          "event.dataset": "windows.security",
          "host.name": host,
          "host.os.family": "windows",
          "host.os.type": "windows",
          "user.name": user,
          "user.domain": "CORP",
          "source.ip": attackerIP,
        },
      }),
      buildAlert({
        timestamp: ts[1],
        ruleName: "Suspicious PowerShell Encoded Command",
        ruleId: "sample-encoded-powershell",
        severity: "high",
        riskScore: 73,
        description:
          "PowerShell was executed with an encoded command argument, commonly used to obfuscate malicious scripts.",
        tactics: [{ id: "TA0002", name: "Execution" }],
        techniques: [
          {
            id: "T1059",
            name: "Command and Scripting Interpreter",
            subtechnique: { id: "T1059.001", name: "PowerShell" },
          },
        ],
        sourceEvent: {
          "@timestamp": ts[1],
          "event.category": ["process"],
          "event.type": ["start"],
          "event.action": "created-process",
          "event.module": "windows",
          "host.name": host,
          "host.os.type": "windows",
          "user.name": user,
          "user.domain": "CORP",
          "process.name": "powershell.exe",
          "process.executable": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
          "process.args": ["-EncodedCommand", "SQBuAHYAbwBrAGUALQBXAGUAYgBSAGUAcQB1AGUAcwB0AA=="],
          "process.command_line": "powershell.exe -EncodedCommand SQBuAHYAbwBrAGUALQBXAGUAYgBSAGUAcQB1AGUAcwB0AA==",
          "process.parent.name": "cmd.exe",
        },
      }),
      buildAlert({
        timestamp: ts[2],
        ruleName: "Persistence via Scheduled Task",
        ruleId: "sample-scheduled-task-persistence",
        severity: "medium",
        riskScore: 47,
        description:
          "A scheduled task was created that may be used for persistence by executing a suspicious binary on logon.",
        tactics: [{ id: "TA0003", name: "Persistence" }],
        techniques: [
          { id: "T1053", name: "Scheduled Task/Job", subtechnique: { id: "T1053.005", name: "Scheduled Task" } },
        ],
        sourceEvent: {
          "@timestamp": ts[2],
          "event.category": ["process"],
          "event.type": ["start"],
          "event.action": "created-process",
          "event.module": "windows",
          "host.name": host,
          "host.os.type": "windows",
          "user.name": user,
          "user.domain": "CORP",
          "process.name": "schtasks.exe",
          "process.executable": "C:\\Windows\\System32\\schtasks.exe",
          "process.args": ["/create", "/tn", "SystemUpdate", "/tr", "C:\\Temp\\update.exe", "/sc", "onlogon"],
          "process.command_line": "schtasks.exe /create /tn SystemUpdate /tr C:\\Temp\\update.exe /sc onlogon",
          "process.parent.name": "powershell.exe",
        },
      }),
      buildAlert({
        timestamp: ts[3],
        ruleName: "Credential Dumping - LSASS Memory Access",
        ruleId: "sample-lsass-dump",
        severity: "critical",
        riskScore: 99,
        description:
          "A process attempted to dump LSASS memory, commonly used to extract credentials from a Windows system.",
        tactics: [{ id: "TA0006", name: "Credential Access" }],
        techniques: [
          { id: "T1003", name: "OS Credential Dumping", subtechnique: { id: "T1003.001", name: "LSASS Memory" } },
        ],
        sourceEvent: {
          "@timestamp": ts[3],
          "event.category": ["process"],
          "event.type": ["start"],
          "event.action": "created-process",
          "event.module": "windows",
          "host.name": host,
          "host.os.type": "windows",
          "user.name": user,
          "user.domain": "CORP",
          "process.name": "procdump.exe",
          "process.executable": "C:\\Temp\\procdump.exe",
          "process.args": ["-ma", "lsass.exe", "C:\\Temp\\lsass.dmp"],
          "process.command_line": "procdump.exe -ma lsass.exe C:\\Temp\\lsass.dmp",
          "process.parent.name": "cmd.exe",
        },
      }),
      buildAlert({
        timestamp: ts[4],
        ruleName: "SAM Registry Hive Dumped",
        ruleId: "sample-sam-dump",
        severity: "critical",
        riskScore: 99,
        description: "The SAM registry hive was exported, which contains password hashes for local accounts.",
        tactics: [{ id: "TA0006", name: "Credential Access" }],
        techniques: [
          {
            id: "T1003",
            name: "OS Credential Dumping",
            subtechnique: { id: "T1003.002", name: "Security Account Manager" },
          },
        ],
        sourceEvent: {
          "@timestamp": ts[4],
          "event.category": ["process"],
          "event.type": ["start"],
          "event.action": "created-process",
          "event.module": "windows",
          "host.name": host,
          "host.os.type": "windows",
          "user.name": user,
          "user.domain": "CORP",
          "process.name": "reg.exe",
          "process.executable": "C:\\Windows\\System32\\reg.exe",
          "process.args": ["save", "HKLM\\SAM", "C:\\Temp\\sam.hiv"],
          "process.command_line": "reg.exe save HKLM\\SAM C:\\Temp\\sam.hiv",
          "process.parent.name": "cmd.exe",
        },
      }),
    ];
  },
  awsEscalationAlerts() {
    const attackerIP = "203.0.113.99";
    const user = "compromised-dev";
    const ts = sequentialTimestamps(5, 1, 2);
    return [
      buildAlert({
        timestamp: ts[0],
        ruleName: "AWS Console Login Without MFA",
        ruleId: "sample-aws-no-mfa",
        severity: "high",
        riskScore: 73,
        description:
          "An AWS console login was performed without multi-factor authentication from an unusual geographic location.",
        tactics: [{ id: "TA0001", name: "Initial Access" }],
        techniques: [
          { id: "T1078", name: "Valid Accounts", subtechnique: { id: "T1078.004", name: "Cloud Accounts" } },
        ],
        sourceEvent: {
          "@timestamp": ts[0],
          "event.category": ["authentication"],
          "event.action": "ConsoleLogin",
          "event.outcome": "success",
          "event.module": "aws",
          "event.dataset": "aws.cloudtrail",
          "user.name": user,
          "source.ip": attackerIP,
          "source.geo.country_iso_code": "RU",
          "cloud.provider": "aws",
          "cloud.account.id": "123456789012",
          "cloud.region": "us-east-1",
          message: `AWS Console login without MFA by ${user} from Russia (${attackerIP})`,
        },
      }),
      buildAlert({
        timestamp: ts[1],
        ruleName: "AWS IAM User Created",
        ruleId: "sample-aws-user-created",
        severity: "medium",
        riskScore: 47,
        description:
          "A new IAM user was created, which may indicate an attacker establishing persistence in the cloud environment.",
        tactics: [{ id: "TA0003", name: "Persistence" }],
        techniques: [{ id: "T1136", name: "Create Account", subtechnique: { id: "T1136.003", name: "Cloud Account" } }],
        sourceEvent: {
          "@timestamp": ts[1],
          "event.category": ["iam"],
          "event.type": ["creation"],
          "event.action": "CreateUser",
          "event.outcome": "success",
          "event.module": "aws",
          "event.dataset": "aws.cloudtrail",
          "user.name": user,
          "source.ip": attackerIP,
          "cloud.provider": "aws",
          "cloud.account.id": "123456789012",
          "cloud.region": "us-east-1",
          message: `IAM user "backdoor-admin" created by ${user}`,
        },
      }),
      buildAlert({
        timestamp: ts[2],
        ruleName: "AWS IAM Privilege Escalation - Admin Policy Attached",
        ruleId: "sample-aws-priv-esc",
        severity: "critical",
        riskScore: 99,
        description:
          "AdministratorAccess policy was attached to a newly created IAM user, granting full access to the AWS account.",
        tactics: [{ id: "TA0004", name: "Privilege Escalation" }],
        techniques: [
          {
            id: "T1098",
            name: "Account Manipulation",
            subtechnique: { id: "T1098.003", name: "Additional Cloud Roles" },
          },
        ],
        sourceEvent: {
          "@timestamp": ts[2],
          "event.category": ["iam"],
          "event.type": ["change"],
          "event.action": "AttachUserPolicy",
          "event.outcome": "success",
          "event.module": "aws",
          "event.dataset": "aws.cloudtrail",
          "user.name": user,
          "source.ip": attackerIP,
          "cloud.provider": "aws",
          "cloud.account.id": "123456789012",
          "cloud.region": "us-east-1",
          message: "AdministratorAccess policy attached to user backdoor-admin",
        },
      }),
      buildAlert({
        timestamp: ts[3],
        ruleName: "AWS CloudTrail Logging Disabled",
        ruleId: "sample-aws-cloudtrail-disabled",
        severity: "critical",
        riskScore: 99,
        description: "CloudTrail logging was stopped, which is a common technique to cover tracks after an intrusion.",
        tactics: [{ id: "TA0005", name: "Defense Evasion" }],
        techniques: [
          {
            id: "T1562",
            name: "Impair Defenses",
            subtechnique: { id: "T1562.008", name: "Disable or Modify Cloud Logs" },
          },
        ],
        sourceEvent: {
          "@timestamp": ts[3],
          "event.category": ["configuration"],
          "event.type": ["change"],
          "event.action": "StopLogging",
          "event.outcome": "success",
          "event.module": "aws",
          "event.dataset": "aws.cloudtrail",
          "user.name": user,
          "source.ip": attackerIP,
          "cloud.provider": "aws",
          "cloud.account.id": "123456789012",
          "cloud.region": "us-east-1",
          message: `CloudTrail logging stopped by ${user} from ${attackerIP}`,
        },
      }),
    ];
  },

  oktaTakeoverAlerts() {
    const attackerIP = "198.51.100.88";
    const victim = "charlie";
    const ts = sequentialTimestamps(4, 1, 0.5);
    return [
      buildAlert({
        timestamp: ts[0],
        ruleName: "Okta Brute Force Login Attempt",
        ruleId: "sample-okta-brute-force",
        severity: "high",
        riskScore: 73,
        description:
          "Multiple failed Okta login attempts detected from a single source, indicating credential stuffing or brute force.",
        tactics: [{ id: "TA0006", name: "Credential Access" }],
        techniques: [
          { id: "T1110", name: "Brute Force", subtechnique: { id: "T1110.004", name: "Credential Stuffing" } },
        ],
        sourceEvent: {
          "@timestamp": ts[0],
          "event.category": ["authentication"],
          "event.action": "user.session.start",
          "event.outcome": "failure",
          "event.module": "okta",
          "event.dataset": "okta.system",
          "user.name": victim,
          "source.ip": attackerIP,
          message: `10 failed Okta login attempts for ${victim} from ${attackerIP}`,
        },
      }),
      buildAlert({
        timestamp: ts[1],
        ruleName: "Okta MFA Bombing / Push Fatigue Attack",
        ruleId: "sample-okta-mfa-bombing",
        severity: "high",
        riskScore: 73,
        description:
          "Multiple MFA push notifications were rejected, suggesting an MFA fatigue attack where the attacker repeatedly triggers push notifications hoping the user accidentally approves.",
        tactics: [{ id: "TA0006", name: "Credential Access" }],
        techniques: [{ id: "T1621", name: "Multi-Factor Authentication Request Generation" }],
        sourceEvent: {
          "@timestamp": ts[1],
          "event.category": ["authentication"],
          "event.action": "user.authentication.auth_via_mfa",
          "event.outcome": "failure",
          "event.module": "okta",
          "event.dataset": "okta.system",
          "user.name": victim,
          "source.ip": attackerIP,
          message: `5 MFA push rejections for ${victim} from ${attackerIP}`,
        },
      }),
      buildAlert({
        timestamp: ts[2],
        ruleName: "Okta Administrator Role Assigned",
        ruleId: "sample-okta-admin-grant",
        severity: "critical",
        riskScore: 99,
        description: "An Okta administrator role was granted to a user account following a suspected account takeover.",
        tactics: [{ id: "TA0004", name: "Privilege Escalation" }],
        techniques: [
          {
            id: "T1098",
            name: "Account Manipulation",
            subtechnique: { id: "T1098.003", name: "Additional Cloud Roles" },
          },
        ],
        sourceEvent: {
          "@timestamp": ts[2],
          "event.category": ["iam"],
          "event.type": ["change"],
          "event.action": "user.account.privilege.grant",
          "event.outcome": "success",
          "event.module": "okta",
          "event.dataset": "okta.system",
          "user.name": victim,
          "source.ip": attackerIP,
          message: `Admin role granted to ${victim} by ${victim} from ${attackerIP}`,
        },
      }),
      buildAlert({
        timestamp: ts[3],
        ruleName: "Okta Security Policy Modified",
        ruleId: "sample-okta-policy-change",
        severity: "high",
        riskScore: 73,
        description: "An Okta security policy was modified, potentially weakening authentication requirements.",
        tactics: [{ id: "TA0005", name: "Defense Evasion" }],
        techniques: [
          {
            id: "T1562",
            name: "Impair Defenses",
            subtechnique: { id: "T1562.007", name: "Disable or Modify Cloud Firewall" },
          },
        ],
        sourceEvent: {
          "@timestamp": ts[3],
          "event.category": ["configuration"],
          "event.type": ["change"],
          "event.action": "policy.rule.update",
          "event.outcome": "success",
          "event.module": "okta",
          "event.dataset": "okta.system",
          "user.name": victim,
          "source.ip": attackerIP,
          message: `Security policy modified by ${victim} from ${attackerIP}`,
        },
      }),
    ];
  },

  ransomwareAlerts() {
    const host = "app-staging-03";
    const hostId = "a1b2c3d4-host-staging-03";
    const agentId = "e5f6a7b8-agent-staging-03";
    const user = "dave";
    const eid = RANSOMWARE_ENTITY_IDS;
    const ts = sequentialTimestamps(6, 1, 0.3);
    const hostFields = {
      "host.name": host,
      "host.id": hostId,
      "host.os.type": "windows",
      "agent.id": agentId,
      "agent.type": "endpoint",
    };
    return [
      buildAlert({
        timestamp: ts[0],
        ruleName: "Suspicious Macro Execution from Office Application",
        ruleId: "sample-macro-execution",
        severity: "high",
        riskScore: 73,
        description:
          "A Microsoft Office application spawned a suspicious child process, indicating possible macro-based malware delivery.",
        tactics: [{ id: "TA0001", name: "Initial Access" }],
        techniques: [
          { id: "T1566", name: "Phishing", subtechnique: { id: "T1566.001", name: "Spearphishing Attachment" } },
        ],
        sourceEvent: {
          "@timestamp": ts[0],
          "event.category": ["process"],
          "event.type": ["start"],
          "event.action": "exec",
          "event.module": "endpoint",
          ...hostFields,
          "user.name": user,
          "process.name": "powershell.exe",
          "process.entity_id": eid.powershell,
          "process.pid": 7832,
          "process.parent.name": "WINWORD.EXE",
          "process.parent.entity_id": eid.winword,
          "process.parent.pid": 4120,
          "process.command_line": "powershell.exe -WindowStyle Hidden -EncodedCommand SQBFAFgA...",
          message: "PowerShell spawned by Word with encoded command - likely macro payload",
        },
      }),
      buildAlert({
        timestamp: ts[1],
        ruleName: "C2 Beacon - Outbound Connection to Known Bad IP",
        ruleId: "sample-c2-beacon",
        severity: "critical",
        riskScore: 99,
        description: "A process established a network connection to a known command-and-control server.",
        tactics: [{ id: "TA0011", name: "Command and Control" }],
        techniques: [{ id: "T1071", name: "Application Layer Protocol" }],
        sourceEvent: {
          "@timestamp": ts[1],
          "event.category": ["network"],
          "event.action": "connection_attempted",
          "event.module": "endpoint",
          ...hostFields,
          "user.name": user,
          "process.name": "powershell.exe",
          "process.entity_id": eid.powershell,
          "process.pid": 7832,
          "destination.ip": "203.0.113.42",
          "destination.port": 443,
          message: "Outbound C2 connection from PowerShell to 203.0.113.42:443",
        },
      }),
      buildAlert({
        timestamp: ts[2],
        ruleName: "Credential Dumping via LSASS Memory",
        ruleId: "sample-lsass-dump-ransomware",
        severity: "critical",
        riskScore: 99,
        description:
          "LSASS memory was dumped using rundll32.exe and comsvcs.dll, a common technique to extract credentials for lateral movement during a ransomware attack.",
        tactics: [{ id: "TA0006", name: "Credential Access" }],
        techniques: [
          { id: "T1003", name: "OS Credential Dumping", subtechnique: { id: "T1003.001", name: "LSASS Memory" } },
        ],
        sourceEvent: {
          "@timestamp": ts[2],
          "event.category": ["process"],
          "event.type": ["start"],
          "event.action": "exec",
          "event.module": "endpoint",
          ...hostFields,
          "user.name": user,
          "process.name": "rundll32.exe",
          "process.entity_id": eid.rundll32,
          "process.pid": 9104,
          "process.executable": "C:\\Windows\\System32\\rundll32.exe",
          "process.args": ["C:\\Windows\\System32\\comsvcs.dll,MiniDump", "656", "C:\\ProgramData\\lsass.dmp", "full"],
          "process.command_line":
            "rundll32.exe C:\\Windows\\System32\\comsvcs.dll,MiniDump 656 C:\\ProgramData\\lsass.dmp full",
          "process.parent.name": "powershell.exe",
          "process.parent.entity_id": eid.powershell,
          "process.parent.pid": 7832,
          message: "LSASS memory dumped via rundll32/comsvcs.dll for credential theft",
        },
      }),
      buildAlert({
        timestamp: ts[3],
        ruleName: "Volume Shadow Copy Deletion",
        ruleId: "sample-shadow-copy-deletion",
        severity: "critical",
        riskScore: 99,
        description:
          "Volume shadow copies were deleted, a common precursor to ransomware encryption to prevent recovery.",
        tactics: [{ id: "TA0040", name: "Impact" }],
        techniques: [{ id: "T1490", name: "Inhibit System Recovery" }],
        sourceEvent: {
          "@timestamp": ts[3],
          "event.category": ["process"],
          "event.type": ["start"],
          "event.action": "exec",
          "event.module": "endpoint",
          ...hostFields,
          "user.name": user,
          "process.name": "vssadmin.exe",
          "process.entity_id": eid.vssadmin,
          "process.pid": 12004,
          "process.executable": "C:\\Windows\\System32\\vssadmin.exe",
          "process.args": ["delete", "shadows", "/all", "/quiet"],
          "process.command_line": "vssadmin.exe delete shadows /all /quiet",
          "process.parent.name": "beacon.exe",
          "process.parent.entity_id": eid.beacon,
          "process.parent.pid": 11240,
          message: "Shadow copies deleted via vssadmin - ransomware preparation",
        },
      }),
      buildAlert({
        timestamp: ts[4],
        ruleName: "Ransomware - Mass File Encryption Detected",
        ruleId: "sample-file-encryption",
        severity: "critical",
        riskScore: 99,
        description:
          "A process modified multiple files adding an encryption extension, characteristic of ransomware activity.",
        tactics: [{ id: "TA0040", name: "Impact" }],
        techniques: [{ id: "T1486", name: "Data Encrypted for Impact" }],
        sourceEvent: {
          "@timestamp": ts[4],
          "event.category": ["file"],
          "event.type": ["change"],
          "event.action": "modification",
          "event.module": "endpoint",
          ...hostFields,
          "user.name": user,
          "process.name": "beacon.exe",
          "process.entity_id": eid.beacon,
          "process.pid": 11240,
          "file.name": "document1.docx.encrypted",
          "file.path": "C:\\Users\\dave\\Documents\\document1.docx.encrypted",
          message: "Mass file encryption detected - 5+ files renamed with .encrypted extension by beacon.exe",
        },
      }),
      buildAlert({
        timestamp: ts[5],
        ruleName: "Ransomware Note Created",
        ruleId: "sample-ransom-note",
        severity: "critical",
        riskScore: 99,
        description: "A ransom note file was created on the desktop, confirming ransomware execution.",
        tactics: [{ id: "TA0040", name: "Impact" }],
        techniques: [{ id: "T1486", name: "Data Encrypted for Impact" }],
        sourceEvent: {
          "@timestamp": ts[5],
          "event.category": ["file"],
          "event.type": ["creation"],
          "event.action": "creation",
          "event.module": "endpoint",
          ...hostFields,
          "user.name": user,
          "file.name": "README_RESTORE_FILES.txt",
          "file.path": "C:\\Users\\dave\\Desktop\\README_RESTORE_FILES.txt",
          "process.name": "beacon.exe",
          "process.entity_id": eid.beacon,
          "process.pid": 11240,
          message: "Ransom note README_RESTORE_FILES.txt dropped on desktop",
        },
      }),
    ];
  },
};

export const AVAILABLE_ALERT_SCENARIOS = Object.keys(ALERT_SCENARIOS);

async function bulkIndexAlerts(client, alerts) {
  if (!alerts.length) return { indexed: 0, errors: 0, alertRefs: [] };

  const targetIndex = ".alerts-security.alerts-default";
  console.log(`    Target index: ${targetIndex}`);

  const body = [];
  for (const alert of alerts) {
    body.push({ create: { _index: targetIndex } });
    body.push(alert);
  }

  let result;
  try {
    result = await client.bulk({ body, refresh: "wait_for" });
  } catch (e) {
    console.error(`    Bulk index error: ${e.message}`);
    if (e.meta?.body) console.error(`    Response: ${JSON.stringify(e.meta.body).slice(0, 500)}`);
    return { indexed: 0, errors: alerts.length, firstError: e.message, alertRefs: [] };
  }

  let indexed = 0;
  let errors = 0;
  let firstError = null;
  const alertRefs = [];
  if (result.items) {
    for (const [i, item] of result.items.entries()) {
      const op = item.create || item.index;
      if (op?.error) {
        errors++;
        if (!firstError) firstError = op.error;
      } else {
        indexed++;
        const sourceAlert = alerts[i];
        alertRefs.push({
          id: op?._id,
          index: op?._index,
          rule: {
            id: sourceAlert?.kibana?.alert?.rule?.uuid || sourceAlert?.kibana?.alert?.rule?.rule_id || "unknown-rule",
            name: sourceAlert?.kibana?.alert?.rule?.name || "Unknown rule",
          },
        });
      }
    }
  }

  return { indexed, errors, firstError, alertRefs };
}

export async function generateAlerts(scenarioNames) {
  const client = createClient();
  await detectClusterVersions(client);
  const results = {};
  let totalIndexed = 0;
  let totalErrors = 0;
  const alertRefs = [];

  const toRun = scenarioNames.length ? scenarioNames : [...AVAILABLE_ALERT_SCENARIOS];

  for (const name of toRun) {
    const generator = ALERT_SCENARIOS[name];
    if (!generator) {
      results[name] = { status: "skipped", reason: "unknown alert scenario" };
      continue;
    }

    const alerts = generator();
    console.log(`  Alert scenario "${name}": ${alerts.length} alerts...`);

    try {
      const { indexed, errors, firstError, alertRefs: scenarioAlertRefs } = await bulkIndexAlerts(client, alerts);
      totalIndexed += indexed;
      totalErrors += errors;
      alertRefs.push(...scenarioAlertRefs);
      results[name] = { status: "ok", indexed, errors, alertCount: alerts.length };
      if (errors > 0 && firstError) {
        console.error(
          `    Warning: ${errors} alert(s) failed. Error: ${firstError?.reason || JSON.stringify(firstError)}`,
        );
      }
      console.log(`    ${indexed} indexed, ${errors} failed`);
    } catch (e) {
      totalErrors += alerts.length;
      results[name] = { status: "error", error: e.message };
      console.error(`    Error: ${e.message}`);
    }
  }

  await client.close();
  return { results, totalIndexed, totalErrors, alertRefs };
}

// ---------------------------------------------------------------------------
// Case creation — single summary case linking all generated alert groups.
// ---------------------------------------------------------------------------

export async function generateCase(kibanaPost, kibanaGet, alertRefs = []) {
  const title = "Sample Data — Combined Attack Investigation";

  if (kibanaGet) {
    try {
      const existing = await kibanaGet("/api/cases/_find", {
        tags: "Sample Data",
        perPage: 1,
      });
      if ((existing?.cases || []).some((c) => c.title === title)) {
        console.log(`  Case already exists: "${title}"`);
        return null;
      }
    } catch {}
  }

  try {
    const created = await kibanaPost("/api/cases", {
      title,
      description:
        "Consolidated investigation for all sample-data attack scenarios: " +
        "SSH brute force, credential theft, AWS IAM escalation, ransomware, " +
        "insider exfiltration, and supply-chain compromise. " +
        "Review correlated alerts in Security > Alerts.",
      tags: ["Sample Data"],
      severity: "critical",
      connector: { id: "none", name: "none", type: ".none", fields: null },
      settings: { syncAlerts: true },
      owner: "securitySolution",
    });
    console.log(`  Created case: "${title}" (${created.id})`);

    if (created?.id && alertRefs.length) {
      const groupedByRule = new Map();
      for (const ref of alertRefs) {
        if (!ref?.id || !ref?.index || !ref?.rule?.id) continue;
        if (!groupedByRule.has(ref.rule.id)) {
          groupedByRule.set(ref.rule.id, {
            id: ref.rule.id,
            name: ref.rule.name,
            alertIds: [],
            indices: [],
          });
        }
        const group = groupedByRule.get(ref.rule.id);
        group.alertIds.push(ref.id);
        group.indices.push(ref.index);
      }

      let attachedAlerts = 0;
      for (const group of groupedByRule.values()) {
        try {
          await kibanaPost(`/api/cases/${created.id}/comments`, {
            type: "alert",
            owner: "securitySolution",
            alertId: group.alertIds,
            index: group.indices,
            rule: {
              id: group.id,
              name: group.name,
            },
          });
          attachedAlerts += group.alertIds.length;
        } catch (e) {
          console.error(`    Alert attach failed for rule "${group.name}": ${e.message}`);
        }
      }

      console.log(`  Attached ${attachedAlerts} alert(s) to case`);
    } else {
      console.log("  No alert attachments added (no scenario alerts generated)");
    }

    return created;
  } catch (e) {
    console.error(`  Case creation error: ${e.message}`);
    return null;
  }
}

const SAMPLE_DATA_INDICES = [
  "logs-system.auth-default",
  "logs-system.syslog-default",
  "logs-endpoint.events.process-default",
  "logs-endpoint.events.network-default",
  "logs-endpoint.events.file-default",
  "logs-windows.security-default",
  "logs-aws.cloudtrail-default",
  "logs-okta.system-default",
];

async function deleteSampleCases() {
  const result = await kibanaGet("/api/cases/_find", {
    tags: "Sample Data",
    perPage: 100,
  });
  const cases = result?.cases || [];
  if (!cases.length) {
    console.log("  No sample cases found");
    return;
  }

  const ids = JSON.stringify(cases.map((c) => c.id));
  await kibanaDelete(`/api/cases?ids=${encodeURIComponent(ids)}`);
  console.log(`  ${cases.length} sample case(s) deleted`);
}

function hasSampleDataMarkerInSource(source) {
  if (!source || typeof source !== "object") return false;

  const tags = source.tags;
  if (Array.isArray(tags)) return tags.includes(SAMPLE_DATA_MARKER);
  return tags === SAMPLE_DATA_MARKER;
}

async function deleteBySourceScan(client, indexPattern) {
  let deleted = 0;
  let matched = 0;
  let scanned = 0;
  let errors = 0;
  let scrollId;

  try {
    let response = await client.search({
      index: indexPattern,
      size: CLEANUP_SOURCE_SCAN_PAGE_SIZE,
      scroll: "2m",
      sort: ["_doc"],
      ignore_unavailable: true,
      allow_no_indices: true,
      expand_wildcards: "open,hidden",
      _source: ["tags"],
      query: {
        range: {
          "@timestamp": {
            gte: CLEANUP_SOURCE_SCAN_LOOKBACK,
          },
        },
      },
    });

    while (true) {
      const hits = response.hits?.hits || [];
      if (!hits.length) break;

      scanned += hits.length;
      const body = [];

      for (const hit of hits) {
        if (hasSampleDataMarkerInSource(hit._source)) {
          matched++;
          body.push({ delete: { _index: hit._index, _id: hit._id } });
        }
      }

      if (body.length) {
        const result = await client.bulk({ body, refresh: false });
        for (const item of result.items || []) {
          const op = item.delete;
          if (op?.error) errors++;
          else deleted++;
        }
      }

      scrollId = response._scroll_id;
      if (!scrollId) break;
      response = await client.scroll({ scroll_id: scrollId, scroll: "2m" });
    }
  } finally {
    if (scrollId) {
      try {
        await client.clearScroll({ scroll_id: scrollId });
      } catch {}
    }
  }

  if (deleted > 0) {
    try {
      await client.indices.refresh({
        index: indexPattern,
        ignore_unavailable: true,
        allow_no_indices: true,
        expand_wildcards: "open,hidden",
      });
    } catch {}
  }

  return { deleted, matched, scanned, errors };
}

export async function cleanup() {
  const client = createClient();
  let eventsDeleted = 0;
  let alertsDeleted = 0;
  const hasKibanaAuth =
    !!process.env.KIBANA_API_KEY ||
    !!(process.env.KIBANA_USERNAME && process.env.KIBANA_PASSWORD) ||
    !!(process.env.ELASTICSEARCH_USERNAME && process.env.ELASTICSEARCH_PASSWORD);

  console.log("Cleaning up sample data...\n");

  const sampleDataQuery = {
    bool: {
      should: [
        { term: { tags: SAMPLE_DATA_MARKER } },
        { term: { "tags.keyword": SAMPLE_DATA_MARKER } },
        { match_phrase: { tags: SAMPLE_DATA_MARKER } },
        { term: { "kibana.alert.rule.tags": "Sample Data" } },
      ],
      minimum_should_match: 1,
    },
  };

  for (const index of SAMPLE_DATA_INDICES) {
    try {
      const result = await client.deleteByQuery({
        index,
        body: { query: sampleDataQuery },
        ignore_unavailable: true,
        conflicts: "proceed",
        refresh: true,
      });
      const total = result.total || 0;
      const deleted = result.deleted || 0;
      const conflicts = result.version_conflicts || 0;
      const failures = result.failures?.length || 0;
      const timedOut = !!result.timed_out;
      eventsDeleted += deleted;
      if (deleted > 0) {
        console.log(`  ${index}: ${deleted} events deleted`);
      } else {
        console.log(`  ${index}: no events deleted`);
      }
      if (total > 0 || conflicts > 0 || failures > 0 || timedOut) {
        console.log(
          `    details: total=${total}, deleted=${deleted}, version_conflicts=${conflicts}, failures=${failures}, timed_out=${timedOut}`,
        );
      }
      if (failures > 0 && result.failures?.[0]) {
        const firstFailure = result.failures[0];
        console.warn(
          `    first failure: ${firstFailure.cause?.type || "unknown"} - ${firstFailure.cause?.reason || JSON.stringify(firstFailure)}`,
        );
      }
      // Fallback for data streams where marker fields are present in _source but not indexed.
      if (deleted === 0 && total === 0) {
        const scan = await deleteBySourceScan(client, index);
        eventsDeleted += scan.deleted;
        if (scan.deleted > 0 || scan.errors > 0) {
          console.log(
            `    source-scan fallback: scanned=${scan.scanned}, matched=${scan.matched}, deleted=${scan.deleted}, errors=${scan.errors}`,
          );
        }
      }
    } catch (e) {
      if (!e.message?.includes("index_not_found")) {
        console.error(`  ${index}: ${e.message}`);
      }
    }
  }

  try {
    const result = await client.deleteByQuery({
      index: ".alerts-security.alerts-default",
      body: { query: sampleDataQuery },
      conflicts: "proceed",
      refresh: true,
    });
    alertsDeleted = result.deleted || 0;
    const total = result.total || 0;
    const conflicts = result.version_conflicts || 0;
    const failures = result.failures?.length || 0;
    const timedOut = !!result.timed_out;
    if (alertsDeleted > 0) {
      console.log(`  .alerts-security.alerts-default: ${alertsDeleted} alerts deleted`);
    } else {
      console.log(`  .alerts-security.alerts-default: no alerts deleted`);
    }
    if (total > 0 || conflicts > 0 || failures > 0 || timedOut) {
      console.log(
        `    details: total=${total}, deleted=${alertsDeleted}, version_conflicts=${conflicts}, failures=${failures}, timed_out=${timedOut}`,
      );
    }
    if (failures > 0 && result.failures?.[0]) {
      const firstFailure = result.failures[0];
      console.warn(
        `    first failure: ${firstFailure.cause?.type || "unknown"} - ${firstFailure.cause?.reason || JSON.stringify(firstFailure)}`,
      );
    }
  } catch (e) {
    if (!e.message?.includes("index_not_found")) {
      console.error(`  Alerts cleanup: ${e.message}`);
    }
  }

  await client.close();

  if (process.env.KIBANA_URL && hasKibanaAuth) {
    try {
      await deleteSampleCases();
    } catch (e) {
      console.error(`  Cases cleanup: ${e.message}`);
    }
  } else if (process.env.KIBANA_URL) {
    console.log("  Cases cleanup skipped: Kibana auth not configured");
  }

  console.log(`\nCleanup complete: ${eventsDeleted} events + ${alertsDeleted} alerts deleted`);
  return { eventsDeleted, alertsDeleted };
}

export const SUPPORTED_PACKAGES = Object.keys(EVENT_GENERATORS);

export async function generateAndIndex(packageNames, eventsPerPackage = 50) {
  const client = createClient();
  await detectClusterVersions(client);
  const results = {};
  let totalIndexed = 0;
  let totalErrors = 0;

  for (const pkg of packageNames) {
    if (!EVENT_GENERATORS[pkg]) {
      results[pkg] = { status: "skipped", reason: "no sample data templates" };
      continue;
    }

    const events = generateEvents(pkg, eventsPerPackage);
    console.log(`  Generating ${events.length} events for ${pkg}...`);

    try {
      const { indexed, errors, firstError } = await bulkIndex(client, events);
      totalIndexed += indexed;
      totalErrors += errors;
      results[pkg] = { status: "ok", indexed, errors };
      if (errors > 0 && firstError) {
        const errDetail = (firstError.create || firstError.index)?.error;
        console.error(
          `    Warning: ${errors} event(s) failed to index. First error: ${errDetail?.reason || JSON.stringify(errDetail)}`,
        );
      }
      console.log(`    ${indexed} indexed, ${errors} failed`);
    } catch (e) {
      totalErrors += events.length;
      results[pkg] = { status: "error", error: e.message };
      console.error(`    Error: ${e.message}`);
    }
  }

  await client.close();
  return { results, totalIndexed, totalErrors };
}

export async function runContinuous(intervalSec = 30, eventsPerBatch = 10) {
  const client = createClient();
  await detectClusterVersions(client);
  let totalIndexed = 0;
  let batchNum = 0;

  console.log(`Continuous mode: generating events every ${intervalSec}s (Ctrl+C to stop)\n`);

  const shutdown = () => {
    console.log(`\nStopping... ${totalIndexed} total events indexed across ${batchNum} batches`);
    client.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (true) {
    batchNum++;
    const pkg = randomFrom(SUPPORTED_PACKAGES);
    const events = generateEvents(pkg, eventsPerBatch);

    try {
      const { indexed } = await bulkIndex(client, events);
      totalIndexed += indexed;
      const ts = new Date().toLocaleTimeString();
      process.stdout.write(`  [${ts}] Batch #${batchNum}: ${indexed} ${pkg} events (total: ${totalIndexed})\r\n`);
    } catch (e) {
      console.error(`  Batch #${batchNum} error: ${e.message}`);
    }

    if (batchNum % 5 === 0) {
      const scenario = randomFrom(AVAILABLE_SCENARIOS);
      const gen = ATTACK_SCENARIOS[scenario];
      if (gen) {
        const scenarioEvents = gen();
        try {
          const { indexed } = await bulkIndex(client, scenarioEvents);
          totalIndexed += indexed;
          process.stdout.write(
            `  [${new Date().toLocaleTimeString()}]   + scenario "${scenario}": ${indexed} events\r\n`,
          );
        } catch {}
      }
    }

    if (batchNum % 10 === 0) {
      const alertScenario = randomFrom(AVAILABLE_ALERT_SCENARIOS);
      const gen = ALERT_SCENARIOS[alertScenario];
      if (gen) {
        const alerts = gen();
        try {
          await bulkIndexAlerts(client, alerts);
          process.stdout.write(
            `  [${new Date().toLocaleTimeString()}]   + alert scenario "${alertScenario}": ${alerts.length} alerts\r\n`,
          );
        } catch {}
      }
    }

    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
}

async function main() {
  const argv = process.argv.slice(2);

  let packageNames = [];
  let scenarioNames = [];
  let count = 50;
  let json = false;
  let scenarios = false;
  let alerts = false;
  let doCleanup = false;
  let continuous = false;
  let interval = 30;
  let yes = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--count" || a === "-n") count = parseInt(argv[++i], 10) || 50;
    else if (a === "--json" || a === "-j") json = true;
    else if (a === "--scenarios" || a === "--attack") scenarios = true;
    else if (a === "--scenario") scenarioNames.push(argv[++i]);
    else if (a === "--alerts") alerts = true;
    else if (a === "--cleanup") doCleanup = true;
    else if (a === "--continuous") continuous = true;
    else if (a === "--interval") interval = parseInt(argv[++i], 10) || 30;
    else if (a === "--yes" || a === "-y") yes = true;
    else if (a === "--help" || a === "-h") {
      console.log("Usage: sample-data.js [packages...] [options]");
      console.log(`\nSupported packages: ${SUPPORTED_PACKAGES.join(", ")}`);
      console.log(`Attack scenarios:   ${AVAILABLE_SCENARIOS.join(", ")}`);
      console.log(`Alert scenarios:    ${AVAILABLE_ALERT_SCENARIOS.join(", ")}`);
      console.log("\nOptions:");
      console.log("  --count, -n       Events per package (default: 50)");
      console.log("  --scenarios       Run all attack simulation scenarios");
      console.log("  --scenario NAME   Run a specific attack scenario");
      console.log("  --alerts          Generate synthetic alert documents");
      console.log("  --cleanup         Remove all sample data and alerts");
      console.log("  --continuous      Keep generating events (Ctrl+C to stop)");
      console.log("  --interval N      Seconds between batches in continuous mode (default: 30)");
      console.log("  --json, -j        Output results as JSON");
      console.log("  --yes, -y         Skip confirmation prompts");
      process.exit(0);
    } else if (!a.startsWith("-")) {
      packageNames.push(a);
    }
  }

  if (doCleanup) {
    if (!yes) {
      const ok = await promptConfirm("Delete all sample data, alerts, and cases? This cannot be undone.");
      if (!ok) {
        console.log("Aborted.");
        return;
      }
    }
    await cleanup();
    return;
  }

  if (continuous) {
    if (!yes) {
      const ok = await promptConfirm(`Start continuous event generation every ${interval}s? (Ctrl+C to stop)`);
      if (!ok) {
        console.log("Aborted.");
        return;
      }
    }
    await runContinuous(interval, count);
    return;
  }

  let allResults = {};
  let grandTotalIndexed = 0;
  let grandTotalErrors = 0;

  if (!scenarios && !scenarioNames.length && !packageNames.length && !alerts) {
    packageNames = [...SUPPORTED_PACKAGES];
    scenarios = true;
    alerts = true;
    console.log("No packages or scenarios specified — running everything.\n");
  }

  if (!yes) {
    const parts = [];
    if (packageNames.length) parts.push(`${count} events for ${packageNames.length} package(s)`);
    if (scenarios || scenarioNames.length) parts.push("attack scenarios");
    if (alerts) parts.push("synthetic alerts");
    const ok = await promptConfirm(`Generate ${parts.join(", ")}?`);
    if (!ok) {
      console.log("Aborted.");
      return;
    }
  }

  if (packageNames.length) {
    console.log(`Generating sample events (${count} per package):\n`);
    const { results, totalIndexed, totalErrors } = await generateAndIndex(packageNames, count);
    Object.assign(allResults, results);
    grandTotalIndexed += totalIndexed;
    grandTotalErrors += totalErrors;
  }

  if (scenarios || scenarioNames.length) {
    console.log("\nRunning attack simulation scenarios:\n");
    const { results, totalIndexed, totalErrors } = await runAttackScenarios(scenarioNames);
    for (const [k, v] of Object.entries(results)) {
      allResults[`scenario:${k}`] = v;
    }
    grandTotalIndexed += totalIndexed;
    grandTotalErrors += totalErrors;
  }

  if (alerts) {
    console.log("\nGenerating synthetic alert documents:\n");
    const { results, totalIndexed, totalErrors } = await generateAlerts([]);
    for (const [k, v] of Object.entries(results)) {
      allResults[`alert:${k}`] = v;
    }
    grandTotalIndexed += totalIndexed;
    grandTotalErrors += totalErrors;
  }

  console.log(`\nDone: ${grandTotalIndexed} events indexed, ${grandTotalErrors} errors`);

  if (json) {
    console.log(JSON.stringify(allResults, null, 2));
  }
}

const isDirectRun = process.argv[1]?.endsWith("sample-data.js");
if (isDirectRun) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
