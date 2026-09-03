#!/usr/bin/env python3
"""Elastic Cloud network security helper (Serverless traffic filters).

Uses only the Python standard library (urllib, json, os, sys, argparse).
All commands read EC_API_KEY from the environment.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

CLOUD_BASE_DEFAULT = "https://api.elastic-cloud.com"
REQUEST_TIMEOUT = 30


def _get_env(name, required_for="this operation"):
    val = os.environ.get(name, "").strip()
    if not val:
        _fail(
            f"Environment variable {name} is not set. "
            f"It is required for {required_for}. "
            "Run the cloud-setup skill first to configure Cloud access."
        )
    return val


def _fail(message, code=1):
    json.dump({"error": message}, sys.stderr)
    print(file=sys.stderr)
    sys.exit(code)


def _parse_json_arg(value, arg_name):
    """Parse a JSON string argument, failing with a structured error on bad input."""
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        _fail(f"Invalid JSON for {arg_name}: {exc}. Expected a JSON object or array.")


def _cloud_base():
    base = os.environ.get("EC_BASE_URL", "").rstrip("/") or CLOUD_BASE_DEFAULT
    return f"{base}/api/v1"


def _cloud_request(method, path, body=None):
    api_key = _get_env("EC_API_KEY", "Cloud API calls")
    url = f"{_cloud_base()}/serverless/traffic-filters{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"ApiKey {api_key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "elastic-agentic")
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            raw = resp.read().decode()
            if not raw:
                return {}
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode())
        except Exception:
            detail = {"status": exc.code, "reason": exc.reason}
        _fail(f"Cloud API error ({exc.code}): {json.dumps(detail)}")
    except urllib.error.URLError as exc:
        _fail(f"Could not connect to Cloud API: {exc.reason}")


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def cmd_list_filters(args):
    """List traffic filters, optionally filtered by region or include_by_default."""
    params = []
    if args.region:
        params.append(f"region={args.region}")
    if args.include_by_default is not None:
        params.append(f"include_by_default={args.include_by_default}")
    qs = f"?{'&'.join(params)}" if params else ""
    result = _cloud_request("GET", qs)
    json.dump(result, sys.stdout, indent=2)
    print()


def cmd_create_filter(args):
    """Create an IP or VPC traffic filter."""
    body = {"name": args.name, "region": args.region}
    if args.type:
        body["type"] = args.type
    if args.description:
        body["description"] = args.description
    if args.include_by_default:
        body["include_by_default"] = True
    if args.rules:
        rules = _parse_json_arg(args.rules, "--rules")
        if not isinstance(rules, list):
            _fail("--rules must be a JSON array of rule objects.")
        body["rules"] = rules
    result = _cloud_request("POST", "", body)
    json.dump(result, sys.stdout, indent=2)
    print()


def cmd_get_filter(args):
    """Get a traffic filter by ID."""
    result = _cloud_request("GET", f"/{args.filter_id}")
    json.dump(result, sys.stdout, indent=2)
    print()


def cmd_update_filter(args):
    """Partially update a traffic filter (PATCH)."""
    body = _parse_json_arg(args.body, "--body")
    result = _cloud_request("PATCH", f"/{args.filter_id}", body)
    json.dump(result, sys.stdout, indent=2)
    print()


def cmd_delete_filter(args):
    """Delete a traffic filter by ID."""
    if args.dry_run:
        json.dump(
            {
                "dry_run": True,
                "action": "delete-filter",
                "filter_id": args.filter_id,
            },
            sys.stdout,
            indent=2,
        )
        print()
        return
    result = _cloud_request("DELETE", f"/{args.filter_id}")
    json.dump(result, sys.stdout, indent=2)
    print()


def cmd_get_metadata(args):
    """List PrivateLink region metadata."""
    qs = f"?region={args.region}" if args.region else ""
    result = _cloud_request("GET", f"/metadata{qs}")
    json.dump(result, sys.stdout, indent=2)
    print()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Elastic Cloud network security helper (Serverless traffic filters)"
    )
    sub = parser.add_subparsers(dest="command")
    sub.required = True

    # list-filters
    p = sub.add_parser(
        "list-filters",
        help="List traffic filters",
        epilog=(
            "Examples:\n"
            "  %(prog)s\n"
            "  %(prog)s --region us-east-1\n"
            "  %(prog)s --region eu-west-1 --include-by-default true"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--region", default=None, help="Filter by region")
    p.add_argument(
        "--include-by-default",
        default=None,
        choices=["true", "false"],
        help="Filter by include_by_default flag (true or false)",
    )
    p.set_defaults(func=cmd_list_filters)

    # create-filter
    p = sub.add_parser(
        "create-filter",
        help="Create a traffic filter (IP or VPC)",
        epilog=(
            "Examples:\n"
            "  %(prog)s --name 'Office IPs' --type ip --region us-east-1 \\\n"
            """    --rules '[{"source":"203.0.113.0/24","description":"Office"}]'\n"""
            "  %(prog)s --name 'Prod VPC' --type vpce --region us-east-1 \\\n"
            """    --rules '[{"source":"vpce-0abc123def456"}]'"""
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--name", required=True, help="Filter display name")
    p.add_argument("--type", default=None, help="Filter type: ip (default) or vpce")
    p.add_argument("--region", required=True, help="AWS region (for example, us-east-1)")
    p.add_argument("--description", default=None, help="Filter description")
    p.add_argument(
        "--include-by-default",
        action="store_true",
        help="Auto-associate with all new projects in this region",
    )
    p.add_argument("--rules", default=None, help="Rules as JSON array string")
    p.set_defaults(func=cmd_create_filter)

    # get-filter
    p = sub.add_parser(
        "get-filter",
        help="Get a traffic filter by ID",
        epilog="Example: %(prog)s --filter-id tf-12345",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--filter-id", required=True, help="Traffic filter ID")
    p.set_defaults(func=cmd_get_filter)

    # update-filter
    p = sub.add_parser(
        "update-filter",
        help="Update a traffic filter (partial update)",
        epilog=(
            "Examples:\n"
            "  %(prog)s --filter-id tf-12345 \\\n"
            """    --body '{"description":"Updated description"}'\n"""
            "  %(prog)s --filter-id tf-12345 \\\n"
            """    --body '{"rules":[{"source":"203.0.113.0/24"},{"source":"198.51.100.5"}]}'"""
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--filter-id", required=True, help="Traffic filter ID")
    p.add_argument(
        "--body",
        required=True,
        help="Partial update body as JSON string (only include fields to change)",
    )
    p.set_defaults(func=cmd_update_filter)

    # delete-filter
    p = sub.add_parser(
        "delete-filter",
        help="Delete a traffic filter",
        epilog=(
            "Examples:\n"
            "  %(prog)s --filter-id tf-12345 --dry-run\n"
            "  %(prog)s --filter-id tf-12345"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--filter-id", required=True, help="Traffic filter ID")
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview the action without executing it",
    )
    p.set_defaults(func=cmd_delete_filter)

    # get-metadata
    p = sub.add_parser(
        "get-metadata",
        help="List PrivateLink region metadata",
        epilog=(
            "Examples:\n"
            "  %(prog)s\n"
            "  %(prog)s --region us-east-1"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--region", default=None, help="Filter metadata by region")
    p.set_defaults(func=cmd_get_metadata)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
