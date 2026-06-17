UUID = public-ip-address@theophilediot.github.io
SCHEMA = org.gnome.shell.extensions.public-ip-address
SCHEMA_FILE = schemas/$(SCHEMA).gschema.xml
RUNTIME_FILES = extension.js prefs.js stylesheet.css metadata.json icons/
INSTALL_FILES = $(RUNTIME_FILES) LICENSE

INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
DIST_DIR = dist
ZIP = $(DIST_DIR)/$(UUID).shell-extension.zip

.PHONY: all schemas install uninstall pack zip static-check package-content-check release-check test clean

all: schemas

schemas:
	glib-compile-schemas --strict schemas

pack: schemas
	mkdir -p "$(DIST_DIR)"
	gnome-extensions pack --force --out-dir "$(DIST_DIR)" --schema "$(SCHEMA_FILE)" \
		--extra-source stylesheet.css --extra-source icons .

zip: pack

install: schemas
	@mkdir -p "$(INSTALL_DIR)"
	@cp -r $(INSTALL_FILES) schemas "$(INSTALL_DIR)/"
	@echo "Installed to $(INSTALL_DIR)"
	@echo "Restart GNOME Shell to load changes (log out/in on Wayland)"

uninstall:
	@rm -rf $(INSTALL_DIR)
	@echo "Uninstalled $(UUID)"

static-check:
	test "$$(jq -r '.uuid' metadata.json)" = "$(UUID)"
	test "$$(jq -r '."settings-schema"' metadata.json)" = "$(SCHEMA)"
	jq -e 'has("version") | not' metadata.json >/dev/null
	jq -e '."shell-version" | length > 0' metadata.json >/dev/null
	test -s VERSION
	@if grep -En "from 'gi://(Gtk|Gdk|Adw)" extension.js; then \
		echo "extension.js must not import GTK, Gdk, or Adwaita" >&2; \
		exit 1; \
	fi
	@if grep -En "from 'gi://(St|Clutter|Meta|Shell)|resource:///org/gnome/shell/" prefs.js; then \
		echo "prefs.js must not import GNOME Shell UI/runtime modules" >&2; \
		exit 1; \
	fi
	@if grep -En "spawn_command_line" extension.js prefs.js; then \
		echo "Use Gio.Subprocess argv APIs instead of shell command-line spawning" >&2; \
		exit 1; \
	fi
	grep -Fq 'am.i.mullvad.net' README.md
	grep -Fq 'tile.openstreetmap.org' README.md
	grep -Fq 'stat.ripe.net' README.md

package-content-check:
	unzip -l "$(ZIP)"
	@for file in metadata.json extension.js prefs.js stylesheet.css schemas/ schemas/$(SCHEMA).gschema.xml icons/ icons/default_map.png icons/flags/; do \
		zipinfo -1 "$(ZIP)" | grep -qx "$$file" || { \
			echo "Missing expected file in $(ZIP): $$file" >&2; \
			exit 1; \
		}; \
	done
	@zipinfo -1 "$(ZIP)" | grep -Eq '^icons/flags/[^/]+\.png$$' || { \
		echo "Missing flag PNG assets in $(ZIP)" >&2; \
		exit 1; \
	}
	@unexpected="$$(zipinfo -1 "$(ZIP)" | grep -Ev '^(metadata\.json|extension\.js|prefs\.js|stylesheet\.css|schemas/|schemas/$(SCHEMA)\.gschema\.xml|icons/|icons/default_map\.png|icons/flags/|icons/flags/[^/]+\.png)$$' || true)"; \
	if test -n "$$unexpected"; then \
		printf '%s\n' "$$unexpected"; \
		echo "Unexpected file in $(ZIP)" >&2; \
		exit 1; \
	fi

release-check: static-check
	$(MAKE) pack
	$(MAKE) package-content-check

test: release-check

clean:
	@rm -rf "$(DIST_DIR)" schemas/gschemas.compiled $(UUID).zip
