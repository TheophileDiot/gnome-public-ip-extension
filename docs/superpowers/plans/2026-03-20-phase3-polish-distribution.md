# Phase 3: Polish & Distribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the GNOME Public IP extension from a working prototype into a polished, distributable extension ready for extensions.gnome.org submission.

**Architecture:** Fix blockers and code quality issues in existing files, then layer on theme support, error states, security defaults, packaging, and accessibility. No new files except `Makefile`, `LICENSE`, and updated `.gitignore`/`README.md`/`metadata.json`. i18n deferred to Phase 3.5.

**Tech Stack:** GJS (GNOME JavaScript), GTK4/libadwaita, GSettings, St (Shell Toolkit), Clutter, Soup 3, Gio

**Note:** GNOME Shell extensions cannot be unit-tested outside the shell process. Each task includes manual verification steps using `gnome-extensions` CLI and `journalctl`.

**Important:** All line numbers reference the **original unmodified file** at the start of Phase 3. As tasks are applied sequentially, line numbers will drift. Use the surrounding code context in each snippet to locate the correct insertion point, not the line number.

---

## Task 1: Fix Blockers (B1-B4)

**Files:**
- Modify: `extension.js:196,330` — fix `get_string` to `get_enum` with nick mapping
- Modify: `extension.js:186-192` — initialize `_timerId = null`
- Modify: `.gitignore` — add `schemas/gschemas.compiled`
- Create: `LICENSE`

- [ ] **Step 1: Fix `get_string`/`get_enum` mismatch (B1)**

In `extension.js`, the enum key `position-in-panel` is read with `get_string()` but `prefs.js` writes it with `set_enum()`. The enum nicks (`left`, `center`, `right`) happen to match the panel box names, so switch `extension.js` to use `get_enum()` with a mapping array.

Add a constant after line 22:

```javascript
const POSITION_NAMES = ['left', 'center', 'right'];
```

Change line 196 from:
```javascript
this._menuPosition = this._settings.get_string(SETTINGS_POSITION);
```
to:
```javascript
this._menuPosition = POSITION_NAMES[this._settings.get_enum(SETTINGS_POSITION)] || 'right';
```

Change line 330 from:
```javascript
this._menuPosition = this._settings.get_string(SETTINGS_POSITION);
```
to:
```javascript
this._menuPosition = POSITION_NAMES[this._settings.get_enum(SETTINGS_POSITION)] || 'right';
```

- [ ] **Step 2: Initialize `_timerId` to `null` (B2)**

In `extension.js`, add `this._timerId = null;` after `this._destroyed = false;` (line 188), before `this._currentIPv4 = null;`.

- [ ] **Step 3: Add LICENSE file (B3)**

Create `LICENSE` with GPL-2.0-or-later text (standard for GNOME extensions).

- [ ] **Step 4: Fix `.gitignore` and remove compiled schema from tracking (B4)**

Replace `.gitignore` contents with:
```
schemas/gschemas.compiled
icons/.*
icons/latest_map.png
*.zip
*.swp
*.swo
*~
.idea/
.vscode/
```

Run: `git rm --cached schemas/gschemas.compiled`

- [ ] **Step 5: Verify**

Run: `glib-compile-schemas schemas/ && gnome-extensions pack --force --extra-source=icons --schema=schemas/org.gnome.shell.extensions.public-ip-address.gschema.xml` to verify the schema compiles and the extension packs without `gschemas.compiled`.

---

## Task 2: Light Theme CSS

**Files:**
- Modify: `stylesheet.css` — replace all `rgba(255,255,255,...)` with theme-compatible values

- [ ] **Step 1: Replace hardcoded white colors with `opacity` on inherited color**

GNOME Shell popup menus inherit the theme's foreground color. Instead of forcing white, use `opacity` to let the theme color show through. For status colors (green/red/yellow), keep explicit colors as they are semantic indicators.

Replace the full `stylesheet.css` with:

```css

.panel-status-menu-box {
  padding-top: 4px;
}

/* Security status banner */
.status-banner {
  border-radius: 6px;
  padding: 6px 10px;
  spacing: 8px;
}

.status-banner-text {
  font-weight: bold;
}

.status-protected .status-banner-text,
.status-protected .status-banner-icon {
  color: #2ec27e;
}

.status-leak .status-banner-text,
.status-leak .status-banner-icon {
  color: #e01b24;
}

.status-exposed .status-banner-text,
.status-exposed .status-banner-icon {
  color: #e5a50a;
}

.status-offline .status-banner-text,
.status-offline .status-banner-icon {
  opacity: 0.5;
}

.status-checking .status-banner-text,
.status-checking .status-banner-icon {
  opacity: 0.5;
}

/* IP addresses */
.ip-address {
  font-weight: bold;
  font-size: 1.1em;
  opacity: 0.95;
}

.ip-address-v6 {
  font-size: 0.9em;
  opacity: 0.75;
}

.ip-copy-icon {
  opacity: 0.3;
}

.iface-header {
  font-weight: bold;
  font-size: 0.85em;
  opacity: 0.6;
}

.iface-header-icon {
  opacity: 0.4;
  margin-right: 6px;
}

/* Geo info */
.ip-info-key {
  font-weight: bold;
  opacity: 0.55;
}

.ip-info-box {
  padding-left: 20px;
  spacing: 2px;
}

.ip-info-value {
  opacity: 0.95;
}
```

Key changes: removed all `color: rgba(255,255,255,...)` and replaced with `opacity` on inherited theme color. Removed dead classes `.ip-section` and `.ip-row` (C3). Raised `.ip-info-key` opacity from 0.5 to 0.55 for better WCAG contrast.

- [ ] **Step 2: Verify on dark and light themes**

Run `gsettings set org.gnome.desktop.interface color-scheme 'prefer-light'` and check popup. Then `gsettings set org.gnome.desktop.interface color-scheme 'prefer-dark'` and check again.

---

## Task 3: Code Quality Fixes (C1-C9)

**Files:**
- Modify: `extension.js` — multiple fixes across the file

- [ ] **Step 1: Add `.catch()` to fire-and-forget `_fetchPrefixes` calls (C1)**

At line 340 (settings handler), change:
```javascript
if (this._showCidr)
    this._fetchPrefixes(this._currentIPv4, this._currentIPv6);
```
to:
```javascript
if (this._showCidr)
    this._fetchPrefixes(this._currentIPv4, this._currentIPv6).catch(() => {});
```

At line 735-736 (in `_update`), change:
```javascript
if (this._showCidr)
    this._fetchPrefixes(ipv4, ipv6);
```
to:
```javascript
if (this._showCidr)
    this._fetchPrefixes(ipv4, ipv6).catch(() => {});
```

- [ ] **Step 2: Guard `_ensureCacheDir` so it doesn't crash `_init()` (C8)**

Change `_ensureCacheDir()` (lines 67-74) to:

```javascript
function _ensureCacheDir() {
    try {
        const dir = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_cache_dir(), 'public-ip-extension'])
        );
        if (!dir.query_exists(null))
            dir.make_directory_with_parents(null);
        return dir.get_path();
    } catch (e) {
        console.error(`[Public IP] Cache dir creation failed: ${e.message}`);
        return GLib.build_filenamev([GLib.get_user_cache_dir(), 'public-ip-extension']);
    }
}
```

- [ ] **Step 3: Wrap `_resetPanelPos` in try/catch (C6)**

Change `_resetPanelPos()` (lines 475-480) to:

```javascript
_resetPanelPos() {
    try {
        if (this.container.get_parent())
            this.container.get_parent().remove_child(this.container);
        Main.panel.statusArea['ip-menu'] = null;
        Main.panel.addToStatusArea('ip-menu', this, 1, this._menuPosition);
    } catch (e) {
        console.error(`[Public IP] Panel position reset failed: ${e.message}`);
    }
}
```

- [ ] **Step 4: Re-fetch map when `show-map` toggled on (C7)**

In the settings handler for `SETTINGS_SHOW_MAP` (line 333-336), change to:

```javascript
case SETTINGS_SHOW_MAP:
    this._showMap = this._settings.get_boolean(SETTINGS_SHOW_MAP);
    this._mapInfo.visible = this._showMap;
    if (this._showMap && this._currentIPv4)
        this._update();
    break;
```

- [ ] **Step 5: Read user-agent version from metadata (C9)**

Change line 183 from:
```javascript
this._session.set_user_agent('GNOME-Public-IP-Extension/23');
```
to:
```javascript
this._session.set_user_agent(`GNOME-Public-IP-Extension/${extension.metadata.version} (+${extension.metadata.url})`);
```

This also fixes S5 (OSM contact info in user agent).

- [ ] **Step 6: Set banner to `status-checking` at start of `_update()` (C4)**

At the beginning of `_update()`, after line 643 (`try {`), before `this._updateLocalIP();`, add:

```javascript
// Reset banner to "checking" state during fetch
this._statusIcon.icon_name = 'emblem-synchronizing-symbolic';
this._statusLabel.text = 'Checking connection...';
this._statusBox.style_class = 'status-banner status-checking';
```

- [ ] **Step 7: Verify**

Check GNOME Shell journal: `journalctl -f /usr/bin/gnome-shell` — no unhandled promise rejection warnings or errors from `[Public IP]`.

---

## Task 4: Error & Loading States

**Files:**
- Modify: `extension.js` — panel icon, initial states, empty section, refresh feedback

- [ ] **Step 1: Use neutral icon instead of US flag as default (E3, E4)**

Change line 205-208 from:
```javascript
this._icon = new St.Icon({
    gicon: Gio.icon_new_for_string(`${extension.path}/icons/flags/US.png`),
    icon_size: ICON_SIZE,
});
```
to:
```javascript
this._icon = new St.Icon({
    icon_name: 'network-idle-symbolic',
    icon_size: ICON_SIZE,
});
```

The flag will be set on the first successful API response (existing code at lines 722-730).

- [ ] **Step 2: Show "Loading..." initial states instead of "N/A" (E2)**

Change line 211 (`text: 'N/A'` on panel label) to `text: '...'`.

Change line 251 (`text: 'N/A'` on IPv4 label) to `text: '...'`.

Change line 259 (`text: 'N/A'` on IPv6 label) to `text: '...'`.

- [ ] **Step 3: Set panel icon to offline when both IPs fail (E3)**

After the security assessment update (line 681), add:

```javascript
// Update panel icon for offline state
if (assessment.status === STATUS_OFFLINE) {
    this._icon.gicon = null;
    this._icon.icon_name = 'network-offline-symbolic';
}
```

- [ ] **Step 4: Show "No interfaces" when local section is empty (E5)**

In `_updateLocalIP()`, after the `for` loop (after line 453, before `} catch`), add:

```javascript
if (ifaces.size === 0) {
    const emptyItem = new PopupMenu.PopupBaseMenuItem({reactive: false});
    emptyItem.add_child(new St.Label({
        style_class: 'ip-info-key',
        text: 'No interfaces',
    }));
    this.menu.addMenuItem(emptyItem, insertPos);
    this._localItems.push(emptyItem);
}
```

- [ ] **Step 5: Store refresh item reference and add loading feedback (E1)**

Change the refresh item block (lines 305-307) from:
```javascript
const refreshItem = new PopupMenu.PopupMenuItem('Refresh');
refreshItem.connect('activate', () => this._update());
this.menu.addMenuItem(refreshItem);
```
to:
```javascript
this._refreshItem = new PopupMenu.PopupMenuItem('Refresh');
this._refreshItem.connect('activate', () => this._update());
this.menu.addMenuItem(this._refreshItem);
```

At the start of `_update()` (after the status-checking banner set in Task 3 Step 6), add:
```javascript
if (this._refreshItem)
    this._refreshItem.label.text = 'Refreshing...';
```

In the `finally` block (line 766), add before `this._updating = false;`:
```javascript
if (this._refreshItem)
    this._refreshItem.label.text = 'Refresh';
```

- [ ] **Step 6: Verify**

Disable network, open popup — should show "No connection" banner, offline icon in panel, "Unavailable" for IPs. Re-enable network, click Refresh — should show "Refreshing..." then update.

---

## Task 5: Security Fixes

**Files:**
- Modify: `schemas/org.gnome.shell.extensions.public-ip-address.gschema.xml:26` — change `show-map` default
- Modify: `extension.js:578` — URL-encode RIPE parameter

- [ ] **Step 1: Change `show-map` default to `false` (S1)**

In the gschema XML, change line 26 from:
```xml
<default>true</default>
```
to:
```xml
<default>false</default>
```

- [ ] **Step 2: URL-encode IP in RIPE request (S2)**

Change line 578 from:
```javascript
`https://stat.ripe.net/data/network-info/data.json?resource=${ip}`, 0
```
to:
```javascript
`https://stat.ripe.net/data/network-info/data.json?resource=${encodeURIComponent(ip)}`, 0
```

- [ ] **Step 3: Recompile schema and verify**

Run: `glib-compile-schemas schemas/`

Verify default: `gsettings get org.gnome.shell.extensions.public-ip-address show-map` should return `false`.

---

## Task 6: Packaging & Distribution

**Files:**
- Create: `Makefile`
- Modify: `metadata.json` — fix url, update description
- Modify: `README.md` — full rewrite

- [ ] **Step 1: Create Makefile**

```makefile
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
```

- [ ] **Step 2: Update `metadata.json`**

```json
{
  "shell-version": ["45", "46", "47"],
  "uuid": "public-ip-address@holdingitwrong.com",
  "version": 24,
  "name": "Public IP Address",
  "description": "Shows your public IP address with VPN detection, IPv6 leak warnings, and a security status banner. Displays local and public IPs (IPv4/IPv6), country flag, city, ISP, and optional map tile. Click any IP to copy. Uses Mullvad's privacy-respecting API.",
  "settings-schema": "org.gnome.shell.extensions.public-ip-address",
  "url": "https://github.com/TheophileDiot/gnome-public-ip-extension"
}
```

- [ ] **Step 3: Rewrite README.md**

```markdown
# Public IP Address — GNOME Shell Extension

Shows your public IP address with VPN detection, IPv6 leak warnings, and a security status banner in the GNOME Shell panel.

## Features

- **Public IP display** — IPv4 and IPv6 from [Mullvad's API](https://mullvad.net/en/check) (privacy-first, no-log)
- **Local IP display** — grouped by network interface, click to copy
- **VPN detection** — Mullvad (confirmed), 40+ other providers (heuristic)
- **Security banner** — green (VPN active), yellow (exposed), red (IPv6 leak)
- **IP change notifications** — opt-in alerts with VPN status context
- **Country flag** — in panel and popup
- **Map tile** — opt-in, from OpenStreetMap
- **CIDR prefix** — opt-in, from RIPE NCC

## Requirements

- GNOME Shell 45, 46, or 47

## Install

### From source

```bash
make install
```

Then restart GNOME Shell (log out/in on Wayland, Alt+F2 `r` on X11).

### Manual

```bash
make zip
gnome-extensions install public-ip-address@holdingitwrong.com.zip
```

## Privacy

The extension contacts these services:

| Service | Data sent | When | Opt-out |
|---------|-----------|------|---------|
| Mullvad API (`am.i.mullvad.net`) | Source IP (implicit) | Every refresh cycle | Cannot disable (core function) |
| OpenStreetMap (`tile.openstreetmap.org`) | Lat/lon in tile URL | On IP change | Preferences > Privacy > Show map tile |
| RIPE NCC (`stat.ripe.net`) | IP as URL parameter | On IP change | Preferences > Privacy > Show CIDR prefix |

## Credits

- Flag icons: [GoSquared](https://www.gosquared.com/resources/flag-icons/)
- Original extension: [growing/gnome-public-ip-extension](https://github.com/growing/gnome-public-ip-extension)

## License

GPL-2.0-or-later
```

- [ ] **Step 4: Verify packaging**

Run: `make clean && make zip && unzip -l public-ip-address@holdingitwrong.com.zip` — verify contents are correct and no `gschemas.compiled` in git diff.

---

## Task 7: Accessibility

**Files:**
- Modify: `extension.js` — add `accessible_name` throughout

- [ ] **Step 1: Dynamic `accessible_name` on panel button (A1)**

Add a method to IPMenu after `_copyToClipboard`:

```javascript
_updateAccessibleName(assessment) {
    let name = '';
    switch (assessment?.status) {
    case STATUS_PROTECTED:
        name = `VPN: ${assessment.vpnProvider}. `;
        break;
    case STATUS_LEAK:
        name = 'Warning: IPv6 leak. ';
        break;
    case STATUS_EXPOSED:
        name = 'No VPN. ';
        break;
    case STATUS_OFFLINE:
        name = 'Offline. ';
        break;
    }
    name += `IP: ${this._currentIPv4 || this._currentIPv6 || 'unknown'}`;
    const loc = this._locationLabel?.text;
    if (loc) name += `, ${loc}`;
    this.accessible_name = name;
}
```

Call `this._updateAccessibleName(assessment)` after `this._updateSecurityBanner(assessment)` in `_update()` (after line 681).

Also call it in the compact mode handler (after line 322):
```javascript
this._updateAccessibleName(null);
```

- [ ] **Step 2: `accessible_name` on flag icon (A2)**

After the flag icon is updated (line 726-729), add:
```javascript
this._icon.accessible_name = country;
```

At icon creation (already modified to `network-idle-symbolic` by Task 4 Step 1), add `accessible_name: 'Loading'` to the constructor:
```javascript
this._icon = new St.Icon({
    icon_name: 'network-idle-symbolic',
    icon_size: ICON_SIZE,
    accessible_name: 'Loading',
});
```

- [ ] **Step 3: `accessible_name` on security banner (A4)**

In `_updateSecurityBanner`, after line 555, add:
```javascript
this._statusItem.accessible_name = `Security: ${assessment.text}`;
```

- [ ] **Step 4: Combined `accessible_name` on public IP rows (A5)**

After updating IPv4/IPv6 labels (lines 671-674), add:
```javascript
this._ipv4Item.accessible_name = ipv4
    ? `Public IPv4: ${ipv4}. Activate to copy.`
    : 'Public IPv4: Unavailable';
this._ipv6Item.accessible_name = ipv6
    ? `Public IPv6: ${ipv6}. Activate to copy.`
    : 'Public IPv6: Unavailable';
```

- [ ] **Step 5: `accessible_name` on local IP rows (A5, A7)**

In `_updateLocalIP()`, set on the interface header (after `this._localItems.push(header);` around line 426):
```javascript
header.accessible_name = `Interface: ${iface}`;
```

On each local IP row (after line 446):
```javascript
item.accessible_name = `${iface} ${isV6 ? 'IPv6' : 'IPv4'}: ${ip}. Activate to copy.`;
```

- [ ] **Step 6: `accessible_name` on map tile (A3)**

In `_updateMapTile()`, after line 490 add:
```javascript
this._mapInfo.accessible_name = `Map: ${this._locationLabel?.text || 'unknown location'}`;
```

At default map creation (line 274-279), add `accessible_name: 'Map: loading'` to the St.Icon constructor.

- [ ] **Step 7: Replace emoji with text in notifications (A11 from accessibility audit)**

Change lines 691-696 from:
```javascript
if (assessment.status === STATUS_LEAK)
    body += '\n⚠ IPv6 leak detected!';
else if (assessment.status === STATUS_EXPOSED)
    body += '\n⚠ No VPN — direct connection';
else if (assessment.status === STATUS_PROTECTED)
    body += `\n✓ Protected via ${assessment.vpnProvider}`;
```
to:
```javascript
if (assessment.status === STATUS_LEAK)
    body += '\nWarning: IPv6 leak detected!';
else if (assessment.status === STATUS_EXPOSED)
    body += '\nWarning: No VPN, direct connection';
else if (assessment.status === STATUS_PROTECTED)
    body += `\nProtected via ${assessment.vpnProvider}`;
```

- [ ] **Step 8: Verify with Orca**

Run: `orca &`, navigate to panel button with keyboard. Verify it announces IP, VPN status, and location. Open popup, verify each item is announced coherently.

---

## Task 8: Final Verification & Schema Recompile

**Files:**
- Modify: `schemas/gschemas.compiled` (via `glib-compile-schemas`)

- [ ] **Step 1: Recompile schema**

Run: `cd /home/bunkerity/Softwares/gnome-public-ip-extension && glib-compile-schemas schemas/`

- [ ] **Step 2: Full integration test**

1. `make install`
2. Log out / log in (Wayland) or Alt+F2 `r` (X11)
3. Verify panel shows `network-idle-symbolic` icon then switches to flag after first fetch
4. Open popup — verify security banner, local IPs, public IPs, location, map
5. Click an IP row — verify clipboard copy works
6. Click Refresh — verify "Refreshing..." text
7. Toggle VPN on/off — verify banner updates on next refresh
8. Open Preferences — verify all toggles work
9. Switch to light theme — verify all text is visible
10. `make zip` — verify zip contents

- [ ] **Step 3: Package verification**

Run: `make clean && make zip && unzip -l public-ip-address@holdingitwrong.com.zip`

Verify: no `.git`, no `gschemas.compiled` outside schemas dir, includes LICENSE.
