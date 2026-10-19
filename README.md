# Unitcraft - Ubuntu systemd service generator

A static, client-only service-file builder for novice Linux and embedded developers.
**[Open the generator](https://itsnavin.github.io/systemd-service-generator/)**.
No backend, telemetry, external fonts, application network requests, account creation,
installation or service execution. Your configuration exists in page memory only.
External documentation links open only when selected.

## What it generates

An exact UTF-8 `.service` download (LF with a final newline), matching the preview,
plus installation guidance tailored to system or user units. Copy supplies that same
text to the clipboard; browsers/operating systems may normalize pasted newlines
(for example, CRLF on Windows). Download preserves the exact LF bytes.

- Native foreground executable, Python script and oneshot presets (example paths must be changed).
- `Type=exec`, `simple`, `oneshot`; oneshot `RemainAfterExit`; compatible restart policies,
  delays, start-rate limits, start/stop timeouts and journald output.
- Existing system-service user/group or a least-privilege default user service.
  Root/UID 0 requires explicit confirmation. No users are created or verified.
- Individually entered arguments, working directory, environment variables/file,
  separate activation (`Wants`/`Requires`) and ordering (`After`) dependencies.
- Optional system-only `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full` and
  `ProtectHome=read-only`, with compatibility/behavior warnings.

**Baseline:** Ubuntu 22.04 LTS (systemd 249) and 24.04 LTS (systemd 255).
No newer directives are emitted. CI verifies representative units on both Ubuntu
versions using the distribution's installed systemd; patch versions follow the
runner image. Other distributions/older systemd versions are not supported/tested.
Modern browsers with ES modules are required. Clipboard access needs HTTPS/localhost
and browser permission; denial selects an exact-text manual-copy box and explains
manual copy/download.

## Literal-input contract and intentional limits

`ExecStart` is **not a shell**. An argument row is exactly one argument, including an
empty row. Do not wrap an argument in shell quotes. The generator double-quotes each
token and escapes backslashes and double quotes. A quoted `";"` stays an argument,
not an extra command. The `:` executable prefix disables `$` environment substitution;
`%` becomes `%%` to prevent specifier expansion. Shell operators are literal arguments,
not executable pipes/redirections. Python presets invoke the interpreter explicitly;
scripts otherwise need a valid shebang and execute permission.

`Environment=` uses its own quoted, C-escaped assignments. Dollar signs there are
already literal; percent specifiers are escaped. `Description=`, `WorkingDirectory=`
and `EnvironmentFile=` are raw-string directives in systemd 249, not shell tokens:
they are not erroneously surrounded by quotes or C-escaped. Percent signs still
need escaping. Paths support internal spaces and Unicode but deliberately reject
quotes, backslashes, glob characters, dot segments, repeated slashes, outer
whitespace and control characters. Description rejects backslashes and outer
whitespace. Unsupported inputs produce errors, not silent transformations.
Arguments/values support Unicode (not invalid isolated surrogates), quotes, spaces,
backslashes, dollars and percent signs; control characters/newlines are rejected.

Names are limited to 1-64 letters, numbers, `_` or `-` without `.service`.
Dependencies accept a conservative literal-unit-name subset, including instantiated
templates but not bare templates, escapes, specifiers or arbitrary snippets.
Custom user-manager dependencies must exist in that manager; the UI rejects common
system-only targets in user mode but cannot know all custom target semantics.
Lowercase account names or canonical numeric IDs are accepted; the host still decides
whether those accounts exist. Configuring a differently named UID-0 account is not
detectable by a static app: review the host's account mapping.

No expansion mode, raw directives, `notify` (readiness protocol), `forking` (daemon/PID
tracking), timers or shell wrappers are offered. This avoids presenting unsupported
readiness/PID assumptions as working defaults. Keep long-running programs in the
foreground. Neither exec/simple proves application readiness.

Environment variables/unit files are **not secret storage**. Required environment
files must exist, be readable as appropriate, and follow
[systemd environment-file syntax](https://www.freedesktop.org/software/systemd/man/249/systemd.exec.html#EnvironmentFile=),
not shell scripts. They override matching inline variables. Hardening may prevent
needed writes or shared temporary-file access; namespace settings depend on the
host kernel/container. These toggles are not a complete sandbox.

## Safe use on Ubuntu

1. Review the downloaded unit, paths, accounts, installed executable, ownership and
   permissions. Optionally run `systemd-analyze verify ./my-app.service` (add
   `--user` for a user unit in an active user session). Warnings about missing
   resources need investigation. Verification does not execute the app or prove
   startup success.
2. Inspect existing units with `systemctl cat` and `systemctl show -p FragmentPath`
   (with `--user` for user units). Never blindly replace an existing service.
   Back it up and review differences before intentional replacement. The generated
   guide uses a noclobber copy that refuses to overwrite a destination.
3. System units go in `/etc/systemd/system/`, typically root-owned mode 0644.
   User units go in `~/.config/systemd/user/`, owned by that login account.
   Use `sudo systemctl` for system units, `systemctl --user` without sudo for user units.
4. Run `daemon-reload`, then deliberately `start`, inspect `status` and use
   `journalctl -u` (or `journalctl --user -u`). Enable separately only when ready.
   `enable` is not `start`; `enable --now` does both. `stop` is not `disable`;
   disable removes enablement links but does not remove the file or prevent
   manual/dependency starts.
5. User services depend on the user manager/login lifecycle. Administrator-enabled
   lingering changes logout/boot behavior; this tool does not enable it.
   Rate-limited failures need investigation before `reset-failed`.

`After` does not activate dependencies; `Wants`/`Requires` do not order them.
Pair ordering and activation intentionally. A failed required dependency prevents
startup when also ordered After it. System `network-online.target` needs a configured
wait-online provider, is boot synchronization only, and does not promise internet,
DNS or persistent connectivity. User services cannot order after system-manager units.

## Local development and checks

Node.js 22+ and npm:

```text
npm ci
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

On Windows, use `npm.cmd` / `npx.cmd` if PowerShell cannot invoke the `.ps1` shims.
`npm run preview` serves the production build. Vite uses relative asset URLs so
the site works at a GitHub Pages repository subpath.

On **Ubuntu Linux**, with systemd 249+ installed:

```text
npm run test:systemd
```

This creates temporary unit/environment/executable fixtures, runs only
`systemd-analyze verify` for system/user configurations, fails on warnings, and
cleans up its own temporary directory. It does **not** install files into manager
directories, register/start jobs, reload a daemon or modify accounts. Harmless
`/usr/bin/true` and `/usr/bin/python3` executable fixtures must be present.
It checks syntax/resource resolution, not actual application execution or runtime
argument delivery. Unit tests separately check exact escaping/output and reject
invalid combinations/injection attempts. Playwright checks desktop/mobile input,
presets, errors, mode changes, clipboard success/denial and exact downloaded bytes.

`.github/workflows/checks.yml` runs these checks and Chromium on Ubuntu 22.04/24.04.
`.github/workflows/pages.yml` builds/tests and deploys `dist` on pushes to `main`.
To publish a fork, enable **Settings > Pages > Source > GitHub Actions** and adjust
the README/source links. Deployment uses the built-in Pages environment and OIDC,
not a personal token in source. No service commands in the installation guide
are executed by tests/CI.

## Official references

- [systemd.service (249)](https://www.freedesktop.org/software/systemd/man/249/systemd.service.html)
- [systemd.exec (249)](https://www.freedesktop.org/software/systemd/man/249/systemd.exec.html)
- [systemd.unit (249)](https://www.freedesktop.org/software/systemd/man/249/systemd.unit.html)
- [systemd.syntax (249)](https://www.freedesktop.org/software/systemd/man/249/systemd.syntax.html)
- [Ubuntu 22.04 systemd.service manual](https://manpages.ubuntu.com/manpages/jammy/en/man5/systemd.service.5.html)
- [Ubuntu Server documentation](https://documentation.ubuntu.com/server/)
