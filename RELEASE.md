# Release Process

`extensions.gnome.org` owns the extension version number shown on the GNOME website. Do not add a `version` key to `metadata.json`.

This repository tracks source releases with `VERSION` and matching Git tags such as `v0.1.1`.

## Branches

- `dev` is the integration branch for feature work, fixes, and Dependabot updates.
- `main` is the release branch.
- Open release PRs from `dev` to `main`, then tag the merged `main` commit.

## Prepare a Release

1. Start from `dev` and update `VERSION`.
2. Keep `metadata.json` minimal:
   - no `version` key
   - `shell-version` contains only tested GNOME Shell releases
   - `uuid` remains `public-ip-address@theophilediot.github.io`
3. Run:

```bash
make release-check
```

4. Review the ZIP contents. It should contain only:
   - `metadata.json`
   - `extension.js`
   - `prefs.js`
   - `stylesheet.css`
   - `schemas/org.gnome.shell.extensions.public-ip-address.gschema.xml`
   - bundled icon files under `icons/`
5. Commit the release changes.
6. Merge `dev` into `main`.
7. Tag the merged `main` commit:

```bash
git tag v$(cat VERSION)
git push origin main v$(cat VERSION)
```

## Manual GNOME Upload

Build the reviewed ZIP:

```bash
make release-check
```

Sign in at:

```text
https://extensions.gnome.org/upload/
```

Upload:

```text
dist/public-ip-address@theophilediot.github.io.shell-extension.zip
```

GNOME will review the submitted version before publishing it.

## Review Notes

- `schemas/gschemas.compiled`, `dist/`, screenshots, docs, and local-only files must stay out of source control and release ZIPs.
- GNOME review guidelines require cleanup of all Shell-side state in `disable()`.
- Do not import GTK, Gdk, or Adwaita in `extension.js`; it runs inside the GNOME Shell process.
- Do not import Shell, St, Clutter, or Meta in `prefs.js`; preferences run in a separate GTK process.
- Before tagging, review the full diff for secrets, generated files, unpinned Actions, unexpected workflow permissions, and unexpected network endpoints.
