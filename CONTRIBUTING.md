# Contributing

Thanks for helping improve Public IP Address+. Keep changes focused, reproducible, and easy to review.

## Branches

- Open normal pull requests against `dev`.
- Keep `main` for release-ready code and release tags.
- Release PRs should merge `dev` into `main`, then tag the merged `main` commit.

## Issues

Use the issue templates. A useful bug report includes:

- GNOME Shell version
- Wayland or X11 session type
- Linux distribution
- extension version, release, or commit
- VPN provider and whether IPv4 or IPv6 is enabled
- whether map tiles, CIDR prefix lookup, and notifications are enabled
- exact reproduction steps
- relevant GNOME Shell or preferences logs with public IPs, location data, tokens, hostnames, and private paths removed

## Pull Requests

Before opening a PR:

- keep the change scoped to the extension, preferences UI, metadata, schemas, packaging, docs, or release workflow
- avoid unrelated refactors
- do not commit generated artifacts such as `schemas/gschemas.compiled` or files under `dist/`
- do not include credentials, tokens, cookies, private keys, private logs, or unredacted public IP/location data
- run `make test` when the change touches runtime files, schemas, metadata, packaging, privacy documentation, or release docs

## Security Expectations

- Do not add repository or organization secrets. Release upload secrets must be environment-scoped and documented in `SECURITY.md`.
- Do not add third-party GitHub Actions unless a maintainer explicitly approves them. If an Action is necessary, pin it to a full 40-character commit SHA and include the upstream version as a comment.
- Keep workflow permissions least-privilege. Validation jobs should use read-only repository contents.
- Do not add `pull_request_target`, `workflow_run`, or `repository_dispatch` workflows for this project.
- Fork pull requests must not change workflow, Dependabot, CODEOWNERS, or `Makefile` automation directly. A maintainer must recreate reviewed automation changes from a trusted branch.
- Avoid vendored, minified, generated, or unreviewed binary blobs.
- Remove private data from issue reports, screenshots, logs, and shell output before posting.

See `SECURITY.md` for the release security policy.

## Local Development

Install from source:

```bash
make install
```

Restart GNOME Shell:

- X11: press `Alt` + `F2`, type `r`, press `Enter`
- Wayland: log out and back in

Enable the extension:

```bash
gnome-extensions enable public-ip-address@theophilediot.github.io
```

Open preferences:

```bash
gnome-extensions prefs public-ip-address@theophilediot.github.io
```

## Validation

Run the local test target before release-facing changes:

```bash
make test
```

This validates metadata, privacy documentation, GNOME import boundaries, schema compilation, packaging, and package contents.

The package should contain only:

- `extension.js`
- `prefs.js`
- `metadata.json`
- `stylesheet.css`
- `schemas/org.gnome.shell.extensions.public-ip-address.gschema.xml`
- `icons/default_map.png`
- `icons/flags/*.png`

## GNOME Shell Extension Rules

- Keep `metadata.json` minimal and do not add a manual `version` key.
- Use stable GNOME Shell versions only in `shell-version`.
- Create Shell-side state from `enable()` and clean it up in `disable()`.
- Do not import GTK, Gdk, or Adwaita in `extension.js`.
- Do not import GNOME Shell UI/runtime modules in `prefs.js`.
- Use `Gio.Subprocess` with an argument vector for local commands; do not use shell command-line spawning.
- Gate debug logging behind settings.

## Network and Privacy Rules

- Mullvad API remains the required source for the core public IP feature.
- OpenStreetMap map tiles must remain opt-in.
- RIPE NCC CIDR lookups must remain opt-in.
- Any new or changed network endpoint must be documented in `README.md` and `SECURITY.md`.
- Do not log full public IPs, location data, or network response bodies unless the user explicitly enables diagnostics.

## Releases

Source releases are tracked with `VERSION` and tags such as `v0.1.1`.
The GNOME Extensions website assigns its own version after upload, so `metadata.json` intentionally has no `version` key.

See `RELEASE.md` for the maintainer release flow.
