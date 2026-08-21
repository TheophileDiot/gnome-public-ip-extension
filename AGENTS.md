# Repository Guidelines

## Project Structure & Module Organization

This repository contains a GNOME Shell extension built with GJS. `extension.js` owns panel and popup behavior; `prefs.js` defines the preferences window; `stylesheet.css` contains Shell styles. Keep extension metadata in `metadata.json` and settings in `schemas/org.gnome.shell.extensions.public-ip-address.gschema.xml`. Store map and flag assets under `icons/`. Documentation lives in the root, while release plans live under `docs/`. Treat `dist/` and `schemas/gschemas.compiled` as generated output; do not commit them.

## Build, Test, and Development Commands

- `make schemas` compiles the GSettings schema with strict validation.
- `make install` installs the extension into the current user's GNOME extensions directory.
- `make pack` creates the distributable ZIP under `dist/`.
- `make test` runs the complete local release gate: static checks, schema compilation, packaging, and package-content validation.
- `make clean` removes generated packages and compiled schemas.

After installation, restart GNOME Shell, then enable the extension with `gnome-extensions enable public-ip-address@theophilediot.github.io`. Open settings with `gnome-extensions prefs public-ip-address@theophilediot.github.io`.

## Coding Style & Naming Conventions

Follow the existing GJS style: ES modules, four-space JavaScript indentation, semicolons, single-quoted strings, and braces on the same line. Use `UPPER_SNAKE_CASE` for constants, `PascalCase` for classes, `camelCase` for variables and methods, and an underscore prefix for private helpers such as `_detectVpnProvider`. Use two-space indentation in XML and kebab-case for GSettings keys.

Keep Shell-only imports in `extension.js` and GTK/Adwaita imports in `prefs.js`. Spawn local commands with `Gio.Subprocess` argument arrays, never shell command strings.

## Testing Guidelines

The project has no unit-test framework or coverage threshold. Run `make test` for runtime, schema, metadata, packaging, privacy, or release changes. For UI changes, install locally and verify the panel, popup, preferences window, and cleanup after disabling the extension. Test on the affected GNOME Shell and display-server versions when possible.

## Commit & Pull Request Guidelines

Recent commits favor concise imperative subjects, often with Conventional Commit prefixes such as `feat:` and `fix:`. Keep each commit focused. Open normal pull requests against `dev`; include a summary, change type, validation results, and linked issue. Add screenshots for visible UI changes. Redact public IPs, locations, hostnames, tokens, and private paths. Do not include generated artifacts or unrelated refactors.

## Security & Configuration Tips

Keep map tiles and CIDR lookups opt-in. Document every changed network endpoint in both `README.md` and `SECURITY.md`, and preserve least-privilege workflow permissions.
