UUID = public-ip-address@holdingitwrong.com
DIST_FILES = extension.js prefs.js stylesheet.css metadata.json LICENSE icons/

INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: all zip install uninstall schemas clean

all: schemas

schemas: schemas/gschemas.compiled

schemas/gschemas.compiled: schemas/org.gnome.shell.extensions.public-ip-address.gschema.xml
	glib-compile-schemas schemas/

zip: schemas
	@rm -f $(UUID).zip
	@zip -r $(UUID).zip $(DIST_FILES) schemas/

install: schemas
	@mkdir -p $(INSTALL_DIR)/schemas
	@cp -r $(DIST_FILES) $(INSTALL_DIR)/
	@cp schemas/*.xml schemas/gschemas.compiled $(INSTALL_DIR)/schemas/
	@echo "Installed to $(INSTALL_DIR)"
	@echo "Restart GNOME Shell to load changes (log out/in on Wayland)"

uninstall:
	@rm -rf $(INSTALL_DIR)
	@echo "Uninstalled $(UUID)"

clean:
	@rm -f schemas/gschemas.compiled
	@rm -f $(UUID).zip
