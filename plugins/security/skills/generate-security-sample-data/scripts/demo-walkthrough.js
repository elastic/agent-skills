#!/usr/bin/env node
/**
 * Zero-friction sample data runner.
 *
 * Usage:
 *   node demo-walkthrough.js              # Generate everything once
 *   node demo-walkthrough.js --continuous  # Keep streaming events
 *   node demo-walkthrough.js --cleanup     # Remove all sample data
 */

import { exec } from "node:child_process";
import { testConnection as testEsConnection } from "./es-client.js";
import { testConnection as testKibanaConnection } from "./kibana-client.js";
import { kibanaGet, kibanaPost } from "./kibana-client.js";
import {
  generateAndIndex,
  runAttackScenarios,
  generateAlerts,
  generateCase,
  cleanup,
  runContinuous,
  SUPPORTED_PACKAGES,
} from "./sample-data.js";

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${url}"`);
}

function printKibanaLinks() {
  const kibanaUrl = process.env.KIBANA_URL;
  if (!kibanaUrl) return;
  console.log("\n  Explore in Kibana:\n");
  console.log(`    Alerts:           ${kibanaUrl}/app/security/alerts`);
  console.log(`    Attack Discovery: ${kibanaUrl}/app/security/attack_discovery`);
  console.log(`    Cases:            ${kibanaUrl}/app/security/cases`);
  console.log(`    Hosts:            ${kibanaUrl}/app/security/hosts`);
  console.log(`    Overview:         ${kibanaUrl}/app/security/overview`);
}

async function checkEnv() {
  const hasES = process.env.ELASTICSEARCH_URL || process.env.ELASTICSEARCH_CLOUD_ID;
  const hasKibana = process.env.KIBANA_URL;
  const hasAuth =
    process.env.ELASTICSEARCH_API_KEY || (process.env.ELASTICSEARCH_USERNAME && process.env.ELASTICSEARCH_PASSWORD);

  if (!hasES || !hasAuth) {
    console.error("Missing environment variables. Set these before running:\n");
    console.error("  export ELASTICSEARCH_URL='https://your-project.es.region.aws.elastic.cloud'");
    console.error("  export KIBANA_URL='https://your-project.kb.region.aws.elastic.cloud'");
    console.error("  export ELASTICSEARCH_USERNAME='admin'");
    console.error("  export ELASTICSEARCH_PASSWORD='your-password'");
    process.exit(1);
  }

  console.log("Checking connections...");
  const esOk = await testEsConnection();
  if (!esOk) {
    console.error("Elasticsearch connection failed. Check your credentials.");
    process.exit(1);
  }

  if (hasKibana) {
    const kibanaOk = await testKibanaConnection();
    if (!kibanaOk) console.log("  Kibana connection failed — case won't be created, but events/alerts will work.");
  }
}

async function generate(count) {
  console.log(`\n--- Sample Events (${count} per package) ---\n`);
  const { totalIndexed, totalErrors } = await generateAndIndex([...SUPPORTED_PACKAGES], count);
  console.log(`  ${totalIndexed} events indexed, ${totalErrors} errors`);

  console.log("\n--- Attack Scenarios ---\n");
  const scenarioResult = await runAttackScenarios([]);
  console.log(`  ${scenarioResult.totalIndexed} scenario events indexed`);

  console.log("\n--- Synthetic Alerts ---\n");
  const alertResult = await generateAlerts([]);
  console.log(`  ${alertResult.totalIndexed} alerts indexed`);

  if (process.env.KIBANA_URL) {
    console.log("\n--- Investigation Case ---\n");
    try {
      await generateCase(kibanaPost, kibanaGet, alertResult.alertRefs || []);
    } catch (e) {
      console.error(`  Case skipped: ${e.message}`);
    }
  }

  const total = totalIndexed + scenarioResult.totalIndexed + alertResult.totalIndexed;
  console.log(`\nDone: ${total} total documents indexed.`);

  printKibanaLinks();

  if (process.env.KIBANA_URL) {
    openBrowser(`${process.env.KIBANA_URL}/app/security/alerts`);
    console.log("\n  Opened Security > Alerts in your browser.");
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const doCleanup = argv.includes("--cleanup");
  const continuous = argv.includes("--continuous");
  const countArg = argv.find((_, i) => argv[i - 1] === "--count" || argv[i - 1] === "-n");
  const count = parseInt(countArg, 10) || 50;
  const intervalArg = argv.find((_, i) => argv[i - 1] === "--interval");
  const interval = parseInt(intervalArg, 10) || 30;

  console.log("");
  console.log("  Elastic Security — Sample Data Generator");
  console.log("  =========================================\n");

  await checkEnv();

  if (doCleanup) {
    console.log("");
    await cleanup();
    console.log("\nAll sample data removed.");
    return;
  }

  if (continuous) {
    console.log(`\nStarting continuous mode (every ${interval}s, Ctrl+C to stop)...\n`);
    await generate(count);
    console.log("\nSwitching to continuous stream...\n");
    await runContinuous(interval, 10);
    return;
  }

  await generate(count);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
