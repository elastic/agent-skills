#!/usr/bin/env python3
"""Manage existing Elastic Cloud Serverless projects via the Serverless REST API.

Usage:
    python3 manage-project.py <command> [options]

Commands:
    list                List projects of a given type
    get                 Get project details
    update              Update project name, alias, tags, or search_lake settings
    reset-credentials   Reset project credentials
    delete              Delete a project
    resume              Resume a suspended project
    load-credentials    Load project credentials from .elastic-credentials

Commands that call the Cloud API require the EC_API_KEY environment variable.
"""

import argparse
import copy
import json
import os
import re
import shlex
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


def cmd_list(args):
    result = api_request("GET", f"/projects/{args.type}")
    items = result.get("items", [])
    if not items:
        print("No projects found.")
        return
    print(json.dumps(items, indent=2))


def cmd_get(args):
    result = api_request("GET", f"/projects/{args.type}/{args.id}")
    print(json.dumps(result, indent=2))


def cmd_update(args):
    body = {}
    if args.name:
        body["name"] = args.name
    if args.alias:
        body["alias"] = args.alias
    if args.tag:
        tags = {}
        for t in args.tag:
            key, _, value = t.partition(":")
            if not key or not value:
                print(f"Error: invalid tag format '{t}', expected KEY:VALUE", file=sys.stderr)
                sys.exit(1)
            tags[key] = value
        body["metadata"] = {"tags": tags}

    search_lake = {}
    if args.search_power is not None:
        if args.type != "elasticsearch":
            print("Error: --search-power is only supported for elasticsearch projects.", file=sys.stderr)
            sys.exit(1)
        search_lake["search_power"] = args.search_power
    if args.boost_window is not None:
        if args.type != "elasticsearch":
            print("Error: --boost-window is only supported for elasticsearch projects.", file=sys.stderr)
            sys.exit(1)
        search_lake["boost_window"] = args.boost_window
    data_retention = {}
    if args.max_retention_days is not None:
        if args.type != "security":
            print("Error: --max-retention-days is only supported for security projects.", file=sys.stderr)
            sys.exit(1)
        data_retention["max_retention_days"] = args.max_retention_days
    if args.default_retention_days is not None:
        if args.type != "security":
            print("Error: --default-retention-days is only supported for security projects.", file=sys.stderr)
            sys.exit(1)
        data_retention["default_retention_days"] = args.default_retention_days
    if data_retention:
        search_lake["data_retention"] = data_retention

    if search_lake:
        body["search_lake"] = search_lake

    if not body:
        print("Error: provide at least one field to update.", file=sys.stderr)
        sys.exit(1)
    result = api_request("PATCH", f"/projects/{args.type}/{args.id}", body)
    print(json.dumps(result, indent=2))
    print("\nProject updated.", file=sys.stderr)


def save_credentials(project_id, project_name, credentials):
    """Append credentials to .elastic-credentials in the working directory."""
    creds_file = os.path.join(os.getcwd(), ".elastic-credentials")
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    fd = os.open(creds_file, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "a") as f:
        f.write(f"# Project: {project_name} | id={project_id} | reset {timestamp}\n")
        f.write(f"ELASTICSEARCH_USERNAME={credentials.get('username', '')}\n")
        f.write(f"ELASTICSEARCH_PASSWORD={credentials.get('password', '')}\n\n")
    return creds_file


_PROJECT_HEADER_RE = re.compile(
    r"^#\s*Project:\s*(?P<name>[^|]+?)\s*\|\s*id=(?P<id>[a-f0-9]+)"
)
_API_KEY_HEADER_RE = re.compile(
    r"^#\s*API Key:\s*[^|]+?\s*\|\s*project=(?P<name>[^|]+?)\s*\|\s*id=(?P<id>[a-f0-9]+)"
)


def parse_credentials_file(path=None):
    """Parse .elastic-credentials into per-project merged credential dicts.

    Returns a dict keyed by (name, project_id) with merged KEY=VALUE pairs.
    Later sections for the same project overwrite earlier values so the most
    recent credentials win.
    """
    if path is None:
        path = os.path.join(os.getcwd(), ".elastic-credentials")
    projects = {}
    current_key = None
    try:
        with open(path) as f:
            for line in f:
                line = line.rstrip("\n")
                m = _PROJECT_HEADER_RE.match(line) or _API_KEY_HEADER_RE.match(line)
                if m:
                    current_key = (m.group("name").strip(), m.group("id"))
                    projects.setdefault(current_key, {})
                    continue
                if not line or line.startswith("#"):
                    continue
                if current_key and "=" in line:
                    key, _, value = line.partition("=")
                    projects[current_key][key.strip()] = value.strip()
    except FileNotFoundError:
        pass
    return projects


def cmd_load_credentials(args):
    """Print export statements for a specific project's credentials."""
    projects = parse_credentials_file()
    if not projects:
        print("Error: .elastic-credentials not found or empty.", file=sys.stderr)
        sys.exit(1)

    match_name = args.name.lower() if args.name else None
    match_id = args.id.lower() if args.id else None

    matched = []
    for (name, pid), env_vars in projects.items():
        if match_id and pid.lower() == match_id:
            matched.append(((name, pid), env_vars))
        elif match_name and name.lower() == match_name:
            matched.append(((name, pid), env_vars))

    if not matched:
        print(
            f"Error: no credentials found for "
            f"{'name=' + args.name if args.name else 'id=' + args.id}.",
            file=sys.stderr,
        )
        available = sorted({name for (name, _) in projects})
        if available:
            print(f"Available projects: {', '.join(available)}", file=sys.stderr)
        sys.exit(1)

    unique_ids = {pid for (_, pid), _ in matched}
    if len(unique_ids) > 1:
        print(
            "Error: multiple projects match that name. Use --id to disambiguate:",
            file=sys.stderr,
        )
        for (name, pid), _ in matched:
            print(f"  {name} (id={pid})", file=sys.stderr)
        sys.exit(1)

    _ADMIN_KEYS = {"ELASTICSEARCH_USERNAME", "ELASTICSEARCH_PASSWORD"}
    include_admin = getattr(args, "include_admin", False)

    merged = {}
    for _, env_vars in matched:
        merged.update(env_vars)

    _SAFE_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

    for key, value in merged.items():
        if not include_admin and key in _ADMIN_KEYS:
            continue
        if not _SAFE_KEY_RE.match(key):
            print(f"Warning: skipping invalid variable name: {key!r}", file=sys.stderr)
            continue
        print(f"export {key}={shlex.quote(value)}")


def cmd_reset_credentials(args):
    project = api_request("GET", f"/projects/{args.type}/{args.id}")
    project_name = project.get("name", args.id)

    result = api_request("POST", f"/projects/{args.type}/{args.id}/_reset-credentials")

    nested = result.get("credentials")
    if isinstance(nested, dict):
        credentials = {
            "username": nested.get("username", ""),
            "password": nested.get("password", ""),
        }
    else:
        credentials = {
            "username": result.get("username", ""),
            "password": result.get("password", ""),
        }
    creds_file = save_credentials(args.id, project_name, credentials)

    redacted = copy.deepcopy(result)
    if "password" in redacted:
        redacted["password"] = "REDACTED — see .elastic-credentials"
    if isinstance(redacted.get("credentials"), dict) and "password" in redacted["credentials"]:
        redacted["credentials"]["password"] = "REDACTED — see .elastic-credentials"
    print(json.dumps(redacted, indent=2))

    print(f"\nCredentials saved to {creds_file} — do not display in chat.", file=sys.stderr)

    if args.wait_seconds > 0:
        print(f"Waiting {args.wait_seconds} seconds for credential propagation…", file=sys.stderr)
        time.sleep(args.wait_seconds)


def cmd_delete(args):
    api_request("DELETE", f"/projects/{args.type}/{args.id}")
    print(f"Project {args.id} deletion scheduled.")


def cmd_resume(args):
    api_request("POST", f"/projects/{args.type}/{args.id}/_resume")
    print(f"Project {args.id} resumption scheduled.", file=sys.stderr)
    print("Poll project status until phase changes to 'initialized'.", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(
        description="Manage existing Elastic Cloud Serverless projects"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    p_list = subparsers.add_parser("list", help="List projects")
    p_list.add_argument("--type", required=True, choices=VALID_TYPES)
    p_list.set_defaults(func=cmd_list)

    p_get = subparsers.add_parser("get", help="Get project details")
    p_get.add_argument("--type", required=True, choices=VALID_TYPES)
    p_get.add_argument("--id", required=True, help="Project ID")
    p_get.set_defaults(func=cmd_get)

    p_update = subparsers.add_parser("update", help="Update a project")
    p_update.add_argument("--type", required=True, choices=VALID_TYPES)
    p_update.add_argument("--id", required=True, help="Project ID")
    p_update.add_argument("--name", help="New project name")
    p_update.add_argument("--alias", help="New project alias")
    p_update.add_argument(
        "--tag", action="append", metavar="KEY:VALUE",
        help="Project tag (repeatable, for example --tag env:prod --tag team:search)",
    )
    p_update.add_argument(
        "--search-power", type=int,
        help="Search power (28=on-demand, 100=performant, 250=high-availability; range 28-3000, elasticsearch only)",
    )
    p_update.add_argument(
        "--boost-window", type=int,
        help="Boost window in days (1-180, elasticsearch only)",
    )
    p_update.add_argument(
        "--max-retention-days", type=int,
        help="Maximum data retention period in days (security only)",
    )
    p_update.add_argument(
        "--default-retention-days", type=int,
        help="Default data retention period in days (security only)",
    )
    p_update.set_defaults(func=cmd_update)

    p_reset = subparsers.add_parser("reset-credentials", help="Reset credentials")
    p_reset.add_argument("--type", required=True, choices=VALID_TYPES)
    p_reset.add_argument("--id", required=True, help="Project ID")
    p_reset.add_argument(
        "--wait-seconds", type=int, default=30,
        help="Seconds to wait for credential propagation (0 to skip, default: 30)",
    )
    p_reset.set_defaults(func=cmd_reset_credentials)

    p_delete = subparsers.add_parser("delete", help="Delete a project")
    p_delete.add_argument("--type", required=True, choices=VALID_TYPES)
    p_delete.add_argument("--id", required=True, help="Project ID")
    p_delete.set_defaults(func=cmd_delete)

    p_resume = subparsers.add_parser("resume", help="Resume a suspended project")
    p_resume.add_argument("--type", required=True, choices=VALID_TYPES)
    p_resume.add_argument("--id", required=True, help="Project ID")
    p_resume.set_defaults(func=cmd_resume)

    p_load = subparsers.add_parser(
        "load-credentials",
        help="Load credentials for a project from .elastic-credentials",
    )
    p_load_id = p_load.add_mutually_exclusive_group(required=True)
    p_load_id.add_argument("--name", help="Project name")
    p_load_id.add_argument("--id", help="Project ID")
    p_load.add_argument(
        "--include-admin", action="store_true",
        help="Include ELASTICSEARCH_USERNAME/PASSWORD (only for API key bootstrapping)",
    )
    p_load.set_defaults(func=cmd_load_credentials)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
