# Security Policy

## Scope

Public IP Address+ is a local GNOME Shell extension. It needs network access to show public IP and VPN status, but normal development, validation, packaging, and release should not require repository secrets, analytics, telemetry, or cloud build services.

The extension sends requests only to the services documented in `README.md`:

- Mullvad API for the core public IP and VPN status check.
- OpenStreetMap tiles only when map display is enabled.
- RIPE NCC Stat only when CIDR prefix display is enabled.

No project can make supply-chain compromise impossible. This repository keeps the release path small and auditable so a maintainer can detect and block risky changes before upload.

## Reporting Vulnerabilities

Use GitHub private vulnerability reporting if it is enabled for the repository. If it is not enabled, contact the maintainer privately before publishing details.

Do not open public issues containing exploit details, credentials, tokens, private logs, or unreleased vulnerability details.

## Secret Handling

- Do not commit credentials, tokens, cookies, private keys, API keys, copied private logs, or IP/location debug dumps.
- Do not configure repository or organization secrets for this project unless release automation is explicitly added.
- If GNOME upload automation is enabled, store `GNOME_EXTENSIONS_TOKEN` as an environment secret on a protected `gnome-extensions` environment, not as a broad repository or organization secret.
- Do not store a GNOME account password in GitHub. Use a short-lived GNOME Extensions API token and rotate it after release use or failed upload attempts.
- If a secret is committed or printed in logs, revoke and rotate it before continuing.

## Supply-Chain Controls

- External GitHub Actions, if added, must be pinned to full 40-character commit SHAs with a version comment.
- Automation changes from fork pull requests should be rejected in CI. A maintainer should recreate reviewed workflow, Dependabot, or `Makefile` changes from a trusted branch.
- Release automation, if added, should use GitHub-owned Actions, the GitHub CLI, and direct API calls; do not use third-party release or GNOME upload Actions.
- GNOME upload automation must be opt-in and must use a protected environment with maintainer approval.
- The release ZIP is checked against an exact allowlist of runtime files.
- Generated files such as `schemas/gschemas.compiled`, `dist/`, and extension ZIPs must not be committed.

## Maintainer Repository Settings

Enable these GitHub repository protections before accepting outside contributions:

- Secret scanning and push protection.
- Dependabot alerts and Dependabot security updates.
- Branch protection for `dev` and `main`, including required pull request review.
- Code owner review for workflow, packaging, metadata, schema, and runtime changes.
- Required status checks from the protected base branch before merging PRs.
- Restricted tag creation for release tags such as `v*`, if available for the repository.
- Read-only default workflow token permissions.

## Release Safety Checklist

Before tagging a release:

1. Review the full diff, including workflow, packaging, schema, and metadata changes.
2. Treat green CI as insufficient if the PR changes automation files; review those files manually.
3. Run `make release-check`.
4. Confirm the ZIP contains only runtime files: `metadata.json`, `extension.js`, `prefs.js`, `stylesheet.css`, the schema XML, and bundled icons.
5. Confirm `schemas/gschemas.compiled`, `dist/`, screenshots, docs, and local-only files are not in the release ZIP.
6. Confirm network services are still documented in `README.md`.
7. Tag only the reviewed `main` commit.
8. Upload the reviewed release artifact to `extensions.gnome.org`.
