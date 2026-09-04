# EDOT PHP

Covers both paths: instrumenting a PHP service that has no APM agent, and migrating one that still runs the classic
Elastic APM PHP agent. The shared configuration rules (the three required environment variables, the exporter variables
you must not set, and the never-run-both rule) are in `SKILL.md` and are not repeated here.

Official documentation:

- [EDOT PHP setup](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/php/setup)
- [EDOT PHP configuration](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/php/configuration)
- [EDOT PHP migration guide](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/php/migration)
- [EDOT PHP supported technologies](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/php/supported-technologies)

Read the setup guide (or the migration guide, on the migrate path) before making changes.

EDOT PHP is a **native PHP extension** delivered as an OS package. There are no Composer packages to add and no code
changes to make — on either path. An answer that reaches for `composer require` is wrong.

## Detecting a classic agent

The service is on the classic Elastic APM PHP agent if any of these are present:

- `elastic_apm` in `php -m` output
- `elastic_apm.*` directives in `php.ini` or a `conf.d` ini file
- `ELASTIC_APM_*` environment variables
- the OS package `apm-agent-php` (`dpkg -l apm-agent-php`, `rpm -q apm-agent-php`, or `apk info | grep apm-agent`)

Any one of these means take the migrate path.

## Instrument

1. Download the package for the OS and architecture (`amd64`/`x86_64` or `arm64`/`aarch64`) from the
   [GitHub releases page](https://github.com/elastic/elastic-otel-php/releases/latest) and install it:
   - **Debian/Ubuntu** — `sudo dpkg -i elastic-otel-php_<version>_amd64.deb` (or `_arm64.deb`)
   - **RHEL/CentOS/Fedora** — `sudo rpm -ivh elastic-otel-php-<version>-1.x86_64.rpm` (or `.aarch64.rpm`)
   - **Alpine Linux** — `sudo apk add --allow-untrusted elastic-otel-php_<version>_x86_64.apk` (or `_aarch64.apk`)
2. Set the three required environment variables from `SKILL.md`, in the environment of the PHP process itself — the FPM
   pool or the web server's environment, not just an interactive shell.
3. **Fully restart** the PHP process so the extension loads — PHP-FPM (`sudo systemctl restart php<version>-fpm`) or
   Apache mod_php (`sudo systemctl restart apache2`, `httpd` on RHEL). A graceful reload is not sufficient. CLI scripts
   load the extension per invocation and need no restart.
4. Confirm the extension loaded: `php -m | grep -iE 'elastic_otel|opentelemetry_distro'`. The module registers as
   `opentelemetry_distro` on releases ≥ 1.5.0 and `elastic_otel` on earlier releases. It is **not**
   `elastic_opentelemetry` — that is the EDOT Python package name, and grepping for it reports failure on a healthy
   install.

For long-running PHP servers — Laravel Octane on Swoole or RoadRunner — read
[Long-running PHP servers](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/php/long-running-server) before
instrumenting; the lifecycle differs from FPM.

## Migrate from the classic Elastic APM PHP agent

Do the removal and the addition in the same change. A PHP process loading both extensions double-instruments and is
unsupported.

1. **Remove every classic reference.** Uninstall the package — it registers as `apm-agent-php`, even though some
   documentation calls it `elastic-apm-php`:
   - **Debian/Ubuntu** — `sudo dpkg -r apm-agent-php`
   - **RHEL/CentOS/Fedora** — `sudo rpm -e apm-agent-php`
   - **Alpine Linux** — `sudo apk del apm-agent-php`

   Caution: `dpkg -r` with a name that is not installed prints a warning and **exits 0** — a wrong package name silently
   removes nothing. Trust `php -m`, not the uninstall command's exit code: after the restart,
   `php -m | grep elastic_apm` must return nothing.

   Also delete all `elastic_apm.*` directives from `php.ini` and `conf.d` ini files, and all `ELASTIC_APM_*` environment
   variables. EDOT PHP is configured through `OTEL_*` environment variables, not `php.ini`.

2. **Install EDOT PHP** exactly as in the instrument path above.
3. **Translate the configuration.** The mapping is not a rename — the endpoint semantics change:

   | Classic (`php.ini` or environment)                      | EDOT                                                                                    |
   | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
   | `elastic_apm.service_name` / `ELASTIC_APM_SERVICE_NAME` | `OTEL_SERVICE_NAME`                                                                     |
   | `elastic_apm.server_url` / `ELASTIC_APM_SERVER_URL`     | `OTEL_EXPORTER_OTLP_ENDPOINT` — **do not reuse the old value**; it points at APM Server |
   | `elastic_apm.secret_token`                              | `OTEL_EXPORTER_OTLP_HEADERS` as `Authorization=Bearer <token>`                          |
   | `elastic_apm.api_key`                                   | `OTEL_EXPORTER_OTLP_HEADERS` as `Authorization=ApiKey <key>`                            |
   | `elastic_apm.environment`                               | `OTEL_RESOURCE_ATTRIBUTES=deployment.environment=<env>`                                 |

4. Fully restart the PHP process, confirm `elastic_apm` is gone from `php -m` and the EDOT module is present, then
   verify with the process in `SKILL.md`. On the migrate path, confirm the classic agent has actually stopped reporting
   — a stale deployment still sending to APM Server is the most common post-migration surprise.

## Common failure modes

| Symptom                                              | Cause                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Extension installed but absent from `php -m`         | The PHP process was reloaded, not fully restarted                                                                   |
| Verification grep finds nothing on a healthy install | Wrong module name — it is `opentelemetry_distro` (≥ 1.5.0) or `elastic_otel` (older)                                |
| `elastic_apm` still in `php -m` after migration      | Classic package not actually removed — it registers as `apm-agent-php`; `dpkg -r` on any other name silently no-ops |
| Connection refused or 404 on export                  | `OTEL_EXPORTER_OTLP_ENDPOINT` still points at an APM Server URL                                                     |
| Duplicated or conflicting spans                      | Both the classic extension and EDOT are loaded in the same PHP process                                              |
| Traces arrive, metrics and logs do not               | An `OTEL_*_EXPORTER` variable was set and overrode the default                                                      |
| Unstable after install, OTel SDK already present     | The upstream `opentelemetry.so` extension or OTel PHP SDK alongside EDOT PHP is unsupported                         |
