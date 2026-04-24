# Deployment Compatibility

Feature availability differs across deployment types. **Self-managed** clusters support all features. **Elastic Cloud
Hosted (ECH)** is managed by Elastic with no node-level access. **Serverless** is fully managed SaaS.

| Feature                    | Self-managed | ECH           | Serverless               |
| -------------------------- | ------------ | ------------- | ------------------------ |
| Native users               | Yes          | Yes           | Not available            |
| File-based roles           | Yes          | Not available | Not available            |
| Roles (API)                | Yes          | Yes           | Yes                      |
| Kibana role API            | Yes          | Yes           | Yes                      |
| Role mappings (ES API)     | Yes          | Yes           | Not available            |
| User password management   | Yes          | Yes           | Not available            |
| Built-in privileges        | Yes          | Yes           | Yes                      |
| Cloud API role assignments | N/A          | N/A           | Yes (primary user model) |

**ECH notes:** Native users and roles work the same as self-managed. The Kibana role API uses the deployment's Kibana
endpoint from the Cloud console. File-based roles are not available (no node-level access).

**Serverless notes:**

- **No native users.** Users are members of the Elastic Cloud organization and cannot be created or managed via
  Elasticsearch or Kibana user APIs. User identity is managed entirely at the Cloud organization level.
- **No role mappings.** In Serverless, this capability is not available. Do not attempt to create role mappings.
- **Roles work normally.** Custom roles can be created via the Elasticsearch API or Kibana API, just like self-managed
  and ECH. These roles are used as `application_roles` when assigning access via the Cloud API.
- **User access is granted via the Cloud API.** To give a user access to a Serverless project, assign them a Cloud-level
  role for that project. Roles can be predefined (e.g. `admin`, `developer`, `viewer`) or custom (created in the
  project, then assigned via the Cloud API). Use the **cloud-access-management** skill for the full invitation and role
  assignment workflow.
