# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A GNOME Shell extension (GJS/ESM, no build step, no npm) that shows the public IP in the panel
with VPN detection and IPv6-leak warnings. UUID: `public-ip-address@theophilediot.github.io`.

## Commands

```bash
make install        # copy runtime files + schemas to ~/.local/share/gnome-shell/extensions/<UUID>/
make test           # == release-check: static-check + pack + package-content-check (the only test suite)
make static-check   # metadata/import-boundary/privacy-doc assertions, no packaging
make pack           # build dist/<UUID>.shell-extension.zip
make schemas        # glib-compile-schemas --strict schemas
make clean
```

There is no linter, formatter, unit-test runner, or single-test selector. `make test` is the whole gate;
run it after touching runtime files, schemas, `metadata.json`, packaging, or the privacy tables.

Reload after `make install`: X11 `Alt+F2` → `r`; Wayland requires log out/in.
Logs: `journalctl -f -o cat /usr/bin/gnome-shell` (extension logs are prefixed `[Public IP]`).
Prefs run in a separate process: `gnome-extensions prefs public-ip-address@theophilediot.github.io`.

## Architecture

Three runtime files, two processes:

- `extension.js` — runs **inside gnome-shell**. `PublicIPExtension.enable()` builds one
  `IPMenu extends PanelMenu.Button`; `disable()` destroys it. All state lives on that object.
- `prefs.js` — runs in a **separate GTK process** (Adw preferences window). Shares nothing with
  `extension.js` except the GSettings schema, so the setting-key constants are deliberately duplicated
  in both files — change them in both.
- `schemas/org.gnome.shell.extensions.public-ip-address.gschema.xml` — the only channel between the two.

Adding a setting means four edits: schema XML, key constant + read + `changed::` case in `extension.js`,
key constant + Adw row in `prefs.js`. `IPMenu._init` reads every key into a `this._*` field once and
the single `changed::` handler updates that field — do not read settings from the render path.

### Update cycle

`_update()` (timer-driven, `refresh-rate` seconds, min 30) is guarded by `_updating`/`_pendingUpdate`
so concurrent runs collapse into one re-run. It fetches `ipv4.` and `ipv6.am.i.mullvad.net/json` via
`Promise.allSettled` — one stack failing must never block the other. Geo/flag/map/CIDR work only runs
when the IP actually changed (`ipChanged`).

`_assessSecurity(ipv4Data, ipv6Data)` returns `{status, icon, text, vpnProvider}` where status is one
of `protected | leak | exposed | offline`. VPN detection is `mullvad_exit_ip === true` (confirmed) or
substring match of the org/ASN name against the `VPN_SIGNATURES` table (heuristic). A leak is IPv4/IPv6
disagreeing on country, or one stack looking like VPN infra while the other doesn't. Status maps to a
`status-*` CSS class in `stylesheet.css` and to `accessible_name` strings — every menu row sets one,
keep that up when adding rows.

Local IPs come from `ip -o addr show scope global` parsed in `_populateLocalIPs`, grouped per interface,
inserted after `this._localSeparator` and tracked in `this._localItems` for teardown.

### Teardown contract

GNOME review rejects leaks. `destroy()` cancels `this._cancellable`, removes the
GLib timer, disconnects the settings handler, aborts the Soup session. Every `await` boundary in an
async method must re-check `if (this._cancellable.is_cancelled()) return;` before touching actors.
Do not add a separate `_destroyed` boolean — extensions.gnome.org review rejects that pattern
(review 74350); the cancellable is the single teardown signal.

## Hard constraints (enforced by `make static-check` and CI)

- `extension.js` must not import `Gtk`/`Gdk`/`Adw`; `prefs.js` must not import `St`/`Clutter`/`Meta`/`Shell`
  or `resource:///org/gnome/shell/`.
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
