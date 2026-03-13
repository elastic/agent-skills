#!/usr/bin/env python3
"""Elastic Cloud access management helper.

Uses only Python standard library (urllib, json, os, sys, argparse).
All commands read EC_API_KEY from the environment. Custom-role commands
also require ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY.
"""

import argparse
import json
import os
import stat
import sys
import tempfile
import urllib.error
import urllib.request

CLOUD_BASE_DEFAULT = "https://api.elastic-cloud.com"
PROJECT_VIEWER_ROLE_IDS = {
    "elasticsearch": "elasticsearch-viewer",
    "observability": "observability-viewer",
    "security": "security-viewer",
}


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


# Keys that must never appear in stdout (agent-visible output).
_SECRET_FIELDS = {"key", "token", "invitation_token", "secret"}


def _has_secrets(obj):
    """Return True if obj (dict or list) contains any _SECRET_FIELDS with values."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in _SECRET_FIELDS and isinstance(v, str) and v:
                return True
            if _has_secrets(v):
                return True
    elif isinstance(obj, list):
        for item in obj:
            if _has_secrets(item):
                return True
    return False


def _redact_for_stdout(obj):
    """Return a deep copy with secret fields replaced by a redaction notice."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in _SECRET_FIELDS and isinstance(v, str) and v:
                out[k] = "REDACTED — written to secure file (see _secret_file path)"
            else:
                out[k] = _redact_for_stdout(v)
        return out
    if isinstance(obj, list):
        return [_redact_for_stdout(item) for item in obj]
    return obj


def _write_secrets_to_file(result):
    """Write the full unredacted response to a temp file with 0600 permissions.

    Returns the file path if secrets were found, otherwise None.
    """
    if not _has_secrets(result):
        return None
    fd, path = tempfile.mkstemp(prefix="ec_secret_", suffix=".json")
    try:
        os.fchmod(fd, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(fd, "w") as f:
            json.dump(result, f, indent=2)
    except Exception:
        os.close(fd)
        raise
    return path


def _safe_output(result):
    """Write redacted JSON to stdout; secrets to a secure temp file."""
    secret_file = _write_secrets_to_file(result)
    redacted = _redact_for_stdout(result)
    if secret_file:
        redacted["_secret_file"] = secret_file
        print(
            f"[NOTICE] Secret values written to: {secret_file} "
            f"(permissions: 0600, owner-read only)",
            file=sys.stderr,
        )
    json.dump(redacted, sys.stdout, indent=2)
    print()


def _cloud_base():
    base = os.environ.get("EC_BASE_URL", "").rstrip("/") or CLOUD_BASE_DEFAULT
    return f"{base}/api/v1"


def _cloud_request(method, path, body=None):
    api_key = _get_env("EC_API_KEY", "Cloud API calls")
    url = f"{_cloud_base()}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"ApiKey {api_key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "elastic-agentic")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode())
        except Exception:
            detail = {"status": exc.code, "reason": exc.reason}
        _fail(f"Cloud API error ({exc.code}): {json.dumps(detail)}")


def _es_request(method, path, body=None):
    endpoint = _get_env("ELASTICSEARCH_URL", "custom role operations").rstrip("/")
    api_key = _get_env("ELASTICSEARCH_API_KEY", "custom role operations")
    url = f"{endpoint}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"ApiKey {api_key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "elastic-agentic")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode())
        except Exception:
            detail = {"status": exc.code, "reason": exc.reason}
        _fail(f"Elasticsearch API error ({exc.code}): {json.dumps(detail)}")


def _discover_org_id():
    result = _cloud_request("GET", "/organizations")
    orgs = result.get("organizations", [])
    if not orgs:
        _fail("No organizations found for the authenticated user.")
    return orgs[0]["id"]


def _resolve_org_id(args):
    return args.org_id if args.org_id else _discover_org_id()


def _project_viewer_role_id(project_type):
    role_id = PROJECT_VIEWER_ROLE_IDS.get(project_type)
    if not role_id:
        _fail(f"Unsupported --project-type: {project_type}")
    return role_id


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def cmd_list_members(args):
    org_id = _resolve_org_id(args)
    result = _cloud_request("GET", f"/organizations/{org_id}/members")
    json.dump(result, sys.stdout, indent=2)
    print()


def cmd_invite_user(args):
    org_id = _resolve_org_id(args)
    emails = [e.strip() for e in args.emails.split(",")]
    body = {"emails": emails}
    if args.expires_in:
        body["expires_in"] = args.expires_in
    if args.roles:
        body["role_assignments"] = json.loads(args.roles)
    result = _cloud_request("POST", f"/organizations/{org_id}/invitations", body)
    _safe_output(result)


def cmd_remove_member(args):
    org_id = _resolve_org_id(args)
    if not args.user_id:
        _fail("--user-id is required for remove-member.")
    if args.dry_run:
        json.dump({"dry_run": True, "action": "remove-member", "org_id": org_id, "user_id": args.user_id}, sys.stdout, indent=2)
        print()
        return
    result = _cloud_request("DELETE", f"/organizations/{org_id}/members/{args.user_id}")
    json.dump(result, sys.stdout, indent=2)
    print()


def cmd_create_api_key(args):
    body = {}
    if args.description:
        body["description"] = args.description
    if args.expiration:
        body["expiration"] = args.expiration
    if args.roles:
        body["role_assignments"] = json.loads(args.roles)
    result = _cloud_request("POST", "/users/auth/keys", body)
    _safe_output(result)


def cmd_list_api_keys(args):
    result = _cloud_request("GET", "/users/auth/keys")
    json.dump(result, sys.stdout, indent=2)
    print()


def cmd_delete_api_key(args):
    if not args.key_ids:
        _fail("--key-ids is required for delete-api-key.")
    ids = [k.strip() for k in args.key_ids.split(",")]
    if args.dry_run:
        json.dump({"dry_run": True, "action": "delete-api-key", "key_ids": ids}, sys.stdout, indent=2)
        print()
        return
    result = _cloud_request("DELETE", "/users/auth/keys", {"keys": ids})
    json.dump(result, sys.stdout, indent=2)
    print()


def cmd_assign_role(args):
    if not args.user_id:
        _fail("--user-id is required for assign-role.")
    if not args.roles:
        _fail("--roles JSON is required for assign-role.")
    body = json.loads(args.roles)
    result = _cloud_request("POST", f"/users/{args.user_id}/role_assignments", body)
    json.dump(result, sys.stdout, indent=2)
    print()


def cmd_remove_role_assignment(args):
    if not args.user_id:
        _fail("--user-id is required for remove-role-assignment.")
    if not args.roles:
        _fail("--roles JSON is required for remove-role-assignment.")
    body = json.loads(args.roles)
    result = _cloud_request("DELETE", f"/users/{args.user_id}/role_assignments", body)
    json.dump(result, sys.stdout, indent=2)
    print()


def cmd_create_custom_role(args):
    if not args.role_name:
        _fail("--role-name is required for create-custom-role.")
    body = json.loads(args.body) if args.body else {}
    if args.body_file:
        with open(args.body_file) as f:
            body = json.load(f)
    result = _es_request("PUT", f"/_security/role/{args.role_name}", body)
    json.dump(result, sys.stdout, indent=2)
    print()


def cmd_list_roles(args):
    path = f"/_security/role/{args.role_name}" if args.role_name else "/_security/role"
    result = _es_request("GET", path)
    json.dump(result, sys.stdout, indent=2)
    print()


def cmd_delete_role(args):
    if not args.role_name:
        _fail("--role-name is required for delete-role.")
    if args.dry_run:
        json.dump({"dry_run": True, "action": "delete-role", "role_name": args.role_name}, sys.stdout, indent=2)
        print()
        return
    result = _es_request("DELETE", f"/_security/role/{args.role_name}")
    json.dump(result, sys.stdout, indent=2)
    print()


def cmd_assign_custom_role(args):
    if not args.user_id:
        _fail("--user-id is required for assign-custom-role.")
    if not args.project_id:
        _fail("--project-id is required for assign-custom-role.")
    if not args.custom_role_name:
        _fail("--custom-role-name is required for assign-custom-role.")
    org_id = _resolve_org_id(args)
    role_id = _project_viewer_role_id(args.project_type)
    body = {
        "project": {
            args.project_type: [
                {
                    "role_id": role_id,
                    "organization_id": org_id,
                    "all": False,
                    "project_ids": [args.project_id],
                    "application_roles": [args.custom_role_name],
                }
            ]
        }
    }
    if args.dry_run:
        json.dump(
            {"dry_run": True, "action": "assign-custom-role", "request_body": body},
            sys.stdout,
            indent=2,
        )
        print()
        return
    result = _cloud_request("POST", f"/users/{args.user_id}/role_assignments", body)
    json.dump(result, sys.stdout, indent=2)
    print()


def cmd_remove_custom_role_assignment(args):
    if not args.user_id:
        _fail("--user-id is required for remove-custom-role-assignment.")
    if not args.project_id:
        _fail("--project-id is required for remove-custom-role-assignment.")
    if not args.custom_role_name:
        _fail("--custom-role-name is required for remove-custom-role-assignment.")
    org_id = _resolve_org_id(args)
    role_id = _project_viewer_role_id(args.project_type)
    body = {
        "project": {
            args.project_type: [
                {
                    "role_id": role_id,
                    "organization_id": org_id,
                    "all": False,
                    "project_ids": [args.project_id],
                    "application_roles": [args.custom_role_name],
                }
            ]
        }
    }
    if args.dry_run:
        json.dump(
            {
                "dry_run": True,
                "action": "remove-custom-role-assignment",
                "request_body": body,
            },
            sys.stdout,
            indent=2,
        )
        print()
        return
    result = _cloud_request("DELETE", f"/users/{args.user_id}/role_assignments", body)
    json.dump(result, sys.stdout, indent=2)
    print()



# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Elastic Cloud access management helper"
    )
    sub = parser.add_subparsers(dest="command")
    sub.required = True

    # list-members
    p = sub.add_parser(
        "list-members",
        help="List organization members",
        epilog="Example: %(prog)s",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--org-id", default=None, help="Organization ID (auto-discovered if omitted)")
    p.set_defaults(func=cmd_list_members)

    # invite-user
    p = sub.add_parser(
        "invite-user",
        help="Invite user(s) to the organization",
        epilog=(
            "Examples:\n"
            "  %(prog)s --emails alice@example.com\n"
            '  %(prog)s --emails alice@example.com,bob@example.com --expires-in 7d \\\n'
            """    --roles '{"project":{"elasticsearch":[{"role_id":"viewer","organization_id":"ORG","all":true}]}}'"""
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--org-id", default=None)
    p.add_argument("--emails", required=True, help="Comma-separated email addresses")
    p.add_argument("--roles", default=None, help="Role assignments JSON string")
    p.add_argument("--expires-in", default=None, help="Invitation expiration (for example, 3d)")
    p.set_defaults(func=cmd_invite_user)

    # remove-member
    p = sub.add_parser(
        "remove-member",
        help="Remove a member from the organization",
        epilog=(
            "Examples:\n"
            "  %(prog)s --user-id abc-123\n"
            "  %(prog)s --user-id abc-123 --dry-run"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--org-id", default=None)
    p.add_argument("--user-id", required=True, help="User ID to remove")
    p.add_argument("--dry-run", action="store_true", help="Preview the action without executing it")
    p.set_defaults(func=cmd_remove_member)

    # create-api-key
    p = sub.add_parser(
        "create-api-key",
        help="Create a Cloud API key",
        epilog=(
            "Examples:\n"
            '  %(prog)s --description "CI key" --expiration 30d\n'
            '  %(prog)s --description "Scoped key" --expiration 7d \\\n'
            """    --roles '{"deployment":[{"role_id":"deployment-viewer","all":true}]}'"""
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--description", default=None, help="Key description")
    p.add_argument("--expiration", default=None, help="Expiration duration (for example, 30d, 3h)")
    p.add_argument("--roles", default=None, help="Role assignments JSON string")
    p.set_defaults(func=cmd_create_api_key)

    # list-api-keys
    p = sub.add_parser("list-api-keys", help="List all Cloud API keys")
    p.set_defaults(func=cmd_list_api_keys)

    # delete-api-key
    p = sub.add_parser(
        "delete-api-key",
        help="Delete Cloud API key(s)",
        epilog=(
            "Examples:\n"
            "  %(prog)s --key-ids key-abc-123\n"
            "  %(prog)s --key-ids key-1,key-2 --dry-run"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--key-ids", required=True, help="Comma-separated key IDs to delete")
    p.add_argument("--dry-run", action="store_true", help="Preview the action without executing it")
    p.set_defaults(func=cmd_delete_api_key)

    # assign-role
    p = sub.add_parser(
        "assign-role",
        help="Add role assignments to a user",
        epilog=(
            "Example:\n"
            "  %(prog)s --user-id abc-123 \\\n"
            """    --roles '{"project":{"elasticsearch":[{"role_id":"admin","organization_id":"ORG","all":false,"project_ids":["PROJ"]}]}}'"""
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--user-id", required=True, help="User ID to assign roles to")
    p.add_argument("--roles", required=True, help="Role assignments JSON string")
    p.set_defaults(func=cmd_assign_role)

    # remove-role-assignment
    p = sub.add_parser("remove-role-assignment", help="Remove role assignments from a user")
    p.add_argument("--user-id", required=True, help="User ID to remove roles from")
    p.add_argument("--roles", required=True, help="Role assignments JSON string to remove")
    p.set_defaults(func=cmd_remove_role_assignment)

    # create-custom-role
    p = sub.add_parser(
        "create-custom-role",
        help="Create a Serverless custom role",
        epilog=(
            "Examples:\n"
            "  %(prog)s --role-name marketing-reader \\\n"
            """    --body '{"cluster":[],"indices":[{"names":["marketing-*"],"privileges":["read"]}]}'\n"""
            "  %(prog)s --role-name analytics --body-file role-def.json"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--role-name", required=True, help="Role name (kebab-case)")
    p.add_argument("--body", default=None, help="Role body as JSON string")
    p.add_argument("--body-file", default=None, help="Path to JSON file with role body")
    p.set_defaults(func=cmd_create_custom_role)

    # list-roles
    p = sub.add_parser("list-roles", help="List custom roles on a Serverless project")
    p.add_argument("--role-name", default=None, help="Specific role name (lists all if omitted)")
    p.set_defaults(func=cmd_list_roles)

    # delete-role
    p = sub.add_parser(
        "delete-role",
        help="Delete a custom role from a Serverless project",
        epilog=(
            "Examples:\n"
            "  %(prog)s --role-name marketing-reader\n"
            "  %(prog)s --role-name marketing-reader --dry-run"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--role-name", required=True, help="Role name to delete")
    p.add_argument("--dry-run", action="store_true", help="Preview the action without executing it")
    p.set_defaults(func=cmd_delete_role)

    # assign-custom-role
    p = sub.add_parser(
        "assign-custom-role",
        help="Assign a custom role to a user on a Serverless project via application_roles",
        epilog=(
            "Examples:\n"
            "  %(prog)s --user-id abc-123 --project-id proj-456 --project-type elasticsearch \\\n"
            "    --custom-role-name dashboard-reader\n"
            "  %(prog)s --user-id abc-123 --project-id proj-456 --project-type elasticsearch \\\n"
            "    --custom-role-name dashboard-reader --dry-run"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--org-id", default=None, help="Organization ID (auto-discovered if omitted)")
    p.add_argument("--user-id", required=True, help="User ID to assign the custom role to")
    p.add_argument("--project-id", required=True, help="Serverless project ID")
    p.add_argument(
        "--project-type",
        required=True,
        choices=tuple(PROJECT_VIEWER_ROLE_IDS.keys()),
        help="Project solution type",
    )
    p.add_argument("--custom-role-name", required=True, help="Name of the custom role created in the project")
    p.add_argument("--dry-run", action="store_true", help="Preview the action without executing it")
    p.set_defaults(func=cmd_assign_custom_role)

    # remove-custom-role-assignment
    p = sub.add_parser(
        "remove-custom-role-assignment",
        help="Remove a custom role assignment from a user on a Serverless project",
        epilog=(
            "Examples:\n"
            "  %(prog)s --user-id abc-123 --project-id proj-456 --project-type elasticsearch \\\n"
            "    --custom-role-name dashboard-reader\n"
            "  %(prog)s --user-id abc-123 --project-id proj-456 --project-type elasticsearch \\\n"
            "    --custom-role-name dashboard-reader --dry-run"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--org-id", default=None, help="Organization ID (auto-discovered if omitted)")
    p.add_argument("--user-id", required=True, help="User ID to remove the custom role from")
    p.add_argument("--project-id", required=True, help="Serverless project ID")
    p.add_argument(
        "--project-type",
        required=True,
        choices=tuple(PROJECT_VIEWER_ROLE_IDS.keys()),
        help="Project solution type",
    )
    p.add_argument("--custom-role-name", required=True, help="Name of the custom role to remove")
    p.add_argument("--dry-run", action="store_true", help="Preview the action without executing it")
    p.set_defaults(func=cmd_remove_custom_role_assignment)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
