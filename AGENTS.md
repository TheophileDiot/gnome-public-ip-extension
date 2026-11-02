# AGENTS.md

This file provides guidance to AI coding agents working in this repository.

## What this is

A GNOME Shell extension (GJS/ESM, no build step, no npm) that shows the public IP in the panel
with VPN detection and IPv6-leak warnings. UUID: `public-ip-address@theophilediot.github.io`.

## Commands

```bash
make install        # copy runtime files + schemas to ~/.local/share/gnome-shell/extensions/<UUID>/
make test           # == release-check: static-check + tests + pack + package-content-check
make static-check   # metadata/import-boundary/privacy-doc assertions, no packaging
make tests          # gjs -m tests/test-common.js + tests/test-settings-contract.js
make pack           # build dist/<UUID>.shell-extension.zip
make schemas        # glib-compile-schemas --strict schemas
make clean
```

There is no linter or formatter. The tests are plain `gjs -m tests/<file>.js` scripts (assert, exit non-zero on
failure), so one file runs alone. `make test` is the whole gate; run it after touching runtime files, schemas, `metadata.json`, packaging, or the privacy tables.

Reload after `make install`: X11 `Alt+F2` → `r`; Wayland requires log out/in.
Logs: `journalctl -f -o cat /usr/bin/gnome-shell` (extension logs are prefixed `[Public IP]`).
Enable with `gnome-extensions enable public-ip-address@theophilediot.github.io`.
Prefs run in a separate process: `gnome-extensions prefs public-ip-address@theophilediot.github.io`.

## Architecture

Four runtime files, two processes:

- `extension.js` — runs **inside gnome-shell**. `PublicIPExtension.enable()` builds one
  `IPMenu extends PanelMenu.Button`; `disable()` destroys it. All state lives on that object.
- `prefs.js` — runs in a **separate GTK process** (Adw preferences window). Shares nothing with
  `extension.js` except the GSettings schema and `common.js`.
- `common.js` — Shell-free helpers imported by both processes and by `tests/`: the setting-key
  constants (declared **once**, here), `parseIpAddr`, `VPN_SIGNATURES`/`detectVpnProvider`,
  `countryCode`, `latLonToTile`, `describeResolvers`, the route-check parsers and `assessSecurity`.
  It may import only `gi://GLib` and `gi://Gio`. Pure logic goes here so `tests/test-common.js` can cover it.
- `schemas/org.gnome.shell.extensions.public-ip-address.gschema.xml` — the settings channel between the two.

Adding a setting means four edits: schema XML, exported key constant in `common.js`, read + `changed::`
case in `extension.js`, Adw row (`settings.bind`/`get_*`/`set_*`) in `prefs.js`. `make tests` fails if any
is missing. `IPMenu._init` reads every key into a `this._*` field once and the single `changed::` handler
updates that field — do not read settings from the render path.

### Update cycle

`_update()` (timer-driven, `refresh-rate` seconds, min 30) is guarded by `_updating`/`_pendingUpdate`
so concurrent runs collapse into one re-run. It fetches `ipv4.` and `ipv6.am.i.mullvad.net/json` via
`Promise.allSettled` — one stack failing must never block the other. Geo/flag/map/CIDR work only runs
when the IP actually changed (`ipChanged`).

`assessSecurity(ipv4Data, ipv6Data, tunnels)` (in `common.js`) returns `{status, icon, text, vpnProvider,
leakFamily?}` where status is one of `protected | leak | exposed | offline`. A family is *in the VPN* when
its traffic leaves through a local tunnel interface (`tunnels.v4`/`v6`, from `_checkTunnels`: `ip -j route
get` device found in `ip -j -d link show` with kind `wireguard|tun|xfrm`; route-based, not presence-based)
or Mullvad's view of its exit IP says VPN (`mullvad_exit_ip === true`, or the org/ASN name matches
`VPN_SIGNATURES`, heuristic). **Leak** = both families have data and exactly one is in the VPN; `leakFamily`
is the one outside. A country mismatch alone is not a leak. Status maps to a `status-*` CSS class in
`stylesheet.css` and to `accessible_name` strings — every menu row sets one, keep that up when adding rows.

Rendering is from state: `_renderIpRows()` (IP, CIDR prefix, accessible name for both public rows) and
`_renderPanelLabel()`. Prefixes are stored per family as `{ip, prefix}` and dropped when the IP changes;
the map is fetched by `_fetchMap()` from `this._geoData`. The map tile is shown from memory
(`Gio.BytesIcon`) and never written to disk: there is no map cache.

Local IPs come from `ip -o addr show scope global`, parsed by `parseIpAddr` and rendered by
`_populateLocalIPs`, grouped per interface, inserted after `this._localSeparator` and tracked in
`this._localItems` for teardown. Old rows are destroyed only after the async `ip` call returns, so
overlapping runs cannot duplicate rows.

### Teardown contract

GNOME review rejects leaks. `destroy()` cancels `this._cancellable`, removes the
GLib timer, disconnects the settings handler, aborts the Soup session. Every `await` boundary in an
async method must re-check `if (this._cancellable.is_cancelled()) return;` before touching actors.
Subprocess callbacks and promisified `communicate_utf8_async` calls fall under the same rule: pass
`this._cancellable` and re-check after the await.
Do not add a separate `_destroyed` boolean — extensions.gnome.org review rejects that pattern
(review 74350); the cancellable is the single teardown signal.

## Hard constraints (enforced by `make static-check` and CI)

- `extension.js` must not import `Gtk`/`Gdk`/`Adw`; `prefs.js` must not import `St`/`Clutter`/`Meta`/`Shell`
  or `resource:///org/gnome/shell/`; `common.js` must import neither set.
- No `spawn_command_line*` anywhere — use `Gio.Subprocess` with an argv array.
- `metadata.json` must have **no `version` key** (extensions.gnome.org assigns it). Source version lives
  in `VERSION` + a `v<VERSION>` git tag.
- Mullvad is the non-optional core endpoint; OpenStreetMap tiles and RIPE `stat.ripe.net` CIDR lookups
  must stay opt-in and default `false`. Any endpoint change must also be updated in the `README.md`
  privacy table and `SECURITY.md` — `static-check` greps README for the three hostnames.
- Never commit `schemas/gschemas.compiled` or `dist/` (gitignored; CI fails if they land in the ZIP).
- Do not log full public IPs, location data, or response bodies.

## Workflow

PRs target `dev`; `main` is the release branch and carries the tags. See `RELEASE.md` for tagging and
the extensions.gnome.org upload, `CONTRIBUTING.md` for the security expectations around GitHub Actions
(pin third-party actions to a 40-char SHA; fork PRs may not touch workflows/Makefile).

## Project Structure & Module Organization

This repository contains a GNOME Shell extension built with GJS. `extension.js` owns panel and popup behavior; `prefs.js` defines the preferences window; `common.js` holds the Shell-free shared logic; `stylesheet.css` contains Shell styles. Keep extension metadata in `metadata.json` and settings in `schemas/org.gnome.shell.extensions.public-ip-address.gschema.xml`. Store map and flag assets under `icons/`. Documentation lives in the root, while release plans live under `docs/`. Treat `dist/` and `schemas/gschemas.compiled` as generated output; do not commit them.

## Coding Style & Naming Conventions

Follow the existing GJS style: ES modules, four-space JavaScript indentation, semicolons, single-quoted strings, and braces on the same line. Use `UPPER_SNAKE_CASE` for constants, `PascalCase` for classes, `camelCase` for variables and methods, and an underscore prefix for private helpers such as `_populateLocalIPs`. Use two-space indentation in XML and kebab-case for GSettings keys.

Keep Shell-only imports in `extension.js` and GTK/Adwaita imports in `prefs.js`. Spawn local commands with `Gio.Subprocess` argument arrays, never shell command strings.

## Testing Guidelines

Tests are plain `gjs -m` scripts under `tests/` with no framework or coverage threshold; put new pure logic in `common.js` and cover it in `tests/test-common.js`. Run `make test` for runtime, schema, metadata, packaging, privacy, or release changes. For UI changes, install locally and verify the panel, popup, preferences window, and cleanup after disabling the extension. Test on the affected GNOME Shell and display-server versions when possible.

## Commit & Pull Request Guidelines

Recent commits favor concise imperative subjects, often with Conventional Commit prefixes such as `feat:` and `fix:`. Keep each commit focused. Open normal pull requests against `dev`; include a summary, change type, validation results, and linked issue. Add screenshots for visible UI changes. Redact public IPs, locations, hostnames, tokens, and private paths. Do not include generated artifacts or unrelated refactors.

Preserve least-privilege workflow permissions.
