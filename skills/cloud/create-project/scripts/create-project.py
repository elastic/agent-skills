#!/usr/bin/env python3
"""Create Elastic Cloud Serverless projects via the Serverless REST API.

Usage:
    python3 create-project.py <command> [options]

Commands:
    create              Create a new serverless project
    status              Get project initialization status
    list-regions        List available regions

Requires EC_API_KEY environment variable.
"""

import argparse
import copy
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone


def load_dotenv(path=".env"):
    """Load KEY=VALUE pairs from a .env file into os.environ (no overwrite)."""
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip().strip("'\""))
    except FileNotFoundError:
        pass


load_dotenv()

BASE_URL = os.environ.get("EC_BASE_URL", "https://api.elastic-cloud.com")
API_PREFIX = "/api/v1/serverless"
VALID_TYPES = ("elasticsearch", "observability", "security")
DEFAULT_REGION = "gcp-us-central1"


def get_api_key():
    key = os.environ.get("EC_API_KEY")
    if not key:
        print("Error: EC_API_KEY environment variable is not set.", file=sys.stderr)
        print("Run the cloud-setup skill to configure authentication.", file=sys.stderr)
        sys.exit(1)
    return key


def api_request(method, path, body=None):
    url = f"{BASE_URL}{API_PREFIX}{path}"
    headers = {
        "Authorization": f"ApiKey {get_api_key()}",
        "Content-Type": "application/json",
        "User-Agent": "elastic-agentic",
    }
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        try:
            error_json = json.loads(error_body)
            print(json.dumps(error_json, indent=2), file=sys.stderr)
        except json.JSONDecodeError:
            print(error_body, file=sys.stderr)
        print(f"\nHTTP {e.code}: {e.reason}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Error: unable to reach {url}: {e.reason}", file=sys.stderr)
        sys.exit(1)


def save_credentials(project_id, project_name, credentials, endpoints):
    """Append credentials to .elastic-credentials in the working directory."""
    creds_file = os.path.join(os.getcwd(), ".elastic-credentials")
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    fd = os.open(creds_file, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "a") as f:
        f.write(f"# Project: {project_name} | id={project_id} | {timestamp}\n")
        for name, url in endpoints.items():
            env_name = name.upper().replace("-", "_") + "_URL"
            f.write(f"{env_name}={url}\n")
        f.write(f"ELASTICSEARCH_USERNAME={credentials.get('username', '')}\n")
        f.write(f"ELASTICSEARCH_PASSWORD={credentials.get('password', '')}\n\n")
    return creds_file


def wait_for_ready(project_type, project_id, timeout=300, interval=5):
    """Poll project status until initialized or timeout."""
    elapsed = 0
    while elapsed < timeout:
        result = api_request("GET", f"/projects/{project_type}/{project_id}/status")
        phase = result.get("phase", "unknown")
        print(f"Status: {phase} ({elapsed}s elapsed)", file=sys.stderr)
        if phase == "initialized":
            print("Project is ready.", file=sys.stderr)
            return result
        time.sleep(interval)
        elapsed += interval
    print(
        f"ERROR: Project did not initialize within {timeout}s. "
        f"Check status manually with the status command.",
        file=sys.stderr,
    )
    sys.exit(1)


SECURITY_PRODUCT_LINES = ("security", "cloud", "endpoint")


def cmd_create(args):
    body = {"name": args.name, "region_id": args.region}
    if args.type == "elasticsearch":
        body["optimized_for"] = args.optimized_for or "general_purpose"
    elif args.type == "observability" and args.product_tier:
        body["product_tier"] = args.product_tier
    elif args.type == "security" and args.product_tier:
        body["product_types"] = [
            {"product_line": line, "product_tier": args.product_tier}
            for line in SECURITY_PRODUCT_LINES
        ]

    result = api_request("POST", f"/projects/{args.type}", body)

    project_id = result.get("id", "")
    credentials = result.get("credentials", {})
    endpoints = result.get("endpoints", {})

    try:
        creds_file = save_credentials(project_id, args.name, credentials, endpoints)
    except OSError as exc:
        print(
            f"ERROR: Failed to save credentials to .elastic-credentials: {exc}",
            file=sys.stderr,
        )
        print(
            "Credential save may be incomplete. Check .elastic-credentials for the "
            "password. If missing, use cloud-manage-project reset-credentials.",
            file=sys.stderr,
        )
        creds_file = None

    redacted = copy.deepcopy(result)
    if "credentials" in redacted:
        if creds_file:
            redacted["credentials"]["password"] = "REDACTED — see .elastic-credentials"
        else:
            redacted["credentials"]["password"] = (
                "LOST — credential save failed, reset with cloud-manage-project reset-credentials"
            )
    print(json.dumps(redacted, indent=2))

    print("\n--- Project Created ---", file=sys.stderr)
    print(f"Project ID:  {project_id}", file=sys.stderr)
    print(f"Cloud ID:    {result.get('cloud_id', 'N/A')}", file=sys.stderr)
    for name, url in endpoints.items():
        print(f"Endpoint ({name}): {url}", file=sys.stderr)
    if creds_file:
        print(f"\nCredentials saved to {creds_file} — do not display in chat.", file=sys.stderr)
    else:
        print(
            "\nWARNING: Credentials were NOT saved. Reset them with "
            "cloud-manage-project reset-credentials.",
            file=sys.stderr,
        )

    if args.wait:
        print("\nWaiting for project to initialize...", file=sys.stderr)
        wait_for_ready(args.type, project_id)


def cmd_status(args):
    result = api_request("GET", f"/projects/{args.type}/{args.id}/status")
    print(json.dumps(result, indent=2))
    phase = result.get("phase", "unknown")
    print(f"\nPhase: {phase}", file=sys.stderr)
    if phase == "initialized":
        print("Project is ready.", file=sys.stderr)
    elif phase == "initializing":
        print("Project is still initializing. Poll again in a few seconds.", file=sys.stderr)


def cmd_list_regions(_args):
    result = api_request("GET", "/regions")
    if isinstance(result, list):
        regions = result
    else:
        regions = result.get("items", result.get("regions", []))

    by_csp = {}
    for r in regions:
        csp = r.get("csp", "unknown")
        by_csp.setdefault(csp, []).append(r)

    for csp in sorted(by_csp):
        print(f"--- {csp.upper()} ---")
        for r in sorted(by_csp[csp], key=lambda x: x.get("id", "")):
            enabled = r.get("project_creation_enabled", False)
            marker = "  " if enabled else "* "
            print(f"{marker}{r['id']:30s} {r.get('name', '')}")
        print()

    if regions:
        print("* = project creation not available in this region", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(
        description="Create Elastic Cloud Serverless projects"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    p_create = subparsers.add_parser("create", help="Create a serverless project")
    p_create.add_argument("--type", required=True, choices=VALID_TYPES)
    p_create.add_argument("--name", required=True, help="Project name")
    p_create.add_argument("--region", default=DEFAULT_REGION, help="Region ID")
    p_create.add_argument(
        "--optimized-for",
        choices=["general_purpose", "vector"],
        help="Elasticsearch project subtype",
    )
    p_create.add_argument(
        "--product-tier",
        choices=["complete", "logs_essentials", "essentials"],
        help="Product tier for observability or security projects",
    )
    p_create.add_argument(
        "--wait",
        action="store_true",
        help="Poll until project is initialized before exiting",
    )
    p_create.set_defaults(func=cmd_create)

    p_status = subparsers.add_parser("status", help="Get project status")
    p_status.add_argument("--type", required=True, choices=VALID_TYPES)
    p_status.add_argument("--id", required=True, help="Project ID")
    p_status.set_defaults(func=cmd_status)

    p_regions = subparsers.add_parser("list-regions", help="List available regions")
    p_regions.set_defaults(func=cmd_list_regions)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
