import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    SETTINGS_COMPACT_MODE, SETTINGS_REFRESH_RATE, SETTINGS_POSITION, SETTINGS_SHOW_MAP,
    SETTINGS_SHOW_CIDR, SETTINGS_HIDDEN_IFACES, SETTINGS_NOTIFY_IP_CHANGE, SETTINGS_COPY_CIDR,
    STATUS_PROTECTED, STATUS_LEAK, STATUS_EXPOSED, STATUS_OFFLINE,
    assessSecurity, countryCode, describeResolvers, latLonToTile, parseIpAddr,
    routeDevice, tunnelInterfaces,
} from './common.js';

const ICON_SIZE = 16;
const MAP_ZOOM = 10;

// NetworkManager emits several signals per connect/disconnect; collapse them
const NM_DEBOUNCE_SECONDS = 2;
// Floor between signal-driven refreshes, so a flapping link cannot outpace the
// poll interval the schema deliberately caps at 30s. The poll still catches up.
const NM_MIN_INTERVAL_US = 10 * 1000 * 1000;
const DNS_LEAK_HOST = 'dnsleak.am.i.mullvad.net';
const MULLVAD_HOST = 'am.i.mullvad.net';
// St `orientation` exists from GNOME 48 and `vertical` was removed in 51; 45-47 only know `vertical`
const VERTICAL = St.BoxLayout.find_property('orientation')
    ? {orientation: Clutter.Orientation.VERTICAL}
    : {vertical: true};

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');
Gio._promisify(Gio.Resolver.prototype, 'lookup_by_name_async');
Gio._promisify(Gio.File.prototype, 'delete_async');

// One popup row: key label, value label, copy icon. Returns {item, label}.
function createIpRow(key, valueStyle, text, onActivate) {
    const item = new PopupMenu.PopupBaseMenuItem();
    item.add_child(new St.Label({style_class: 'ip-info-key', text: key}));
    const label = new St.Label({style_class: valueStyle, text, x_expand: true});
    item.add_child(label);
    item.add_child(new St.Icon({
        icon_name: 'edit-copy-symbolic',
        icon_size: 14,
        style_class: 'ip-copy-icon',
    }));
    item.connect('activate', onActivate);
    return {item, label};
}

const IPMenu = GObject.registerClass(
class IPMenu extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'IP Details');
        this._extension = extension;
        this._settings = extension.getSettings();
        this._session = new Soup.Session();
        const userAgentVersion = extension.metadata.version ?? 'dev';
        this._session.set_user_agent(`GNOME-Public-IP-Extension/${userAgentVersion} (+${extension.metadata.url})`);
        this._session.timeout = 30;
        this._cancellable = new Gio.Cancellable();
        this._updating = false;
        this._pendingUpdate = false;
        this._timerId = null;
        this._nmSignalId = null;
        this._nmDebounceId = null;
        this._lastNmUpdate = 0;
        this._dnsTesting = false;
        this._currentIPv4 = null;
        this._currentIPv6 = null;
        this._firstUpdate = true;
        // Last geo response and the RIPE prefix per family ({ip, prefix}); render reads these
        this._geoData = null;
        this._prefixes = {v4: null, v6: null};
        this._removeLegacyMapCache();

        this._compactMode = this._settings.get_boolean(SETTINGS_COMPACT_MODE);
        this._refreshRate = Math.max(30, this._settings.get_int(SETTINGS_REFRESH_RATE));
        this._menuPosition = this._settings.get_string(SETTINGS_POSITION);
        this._showMap = this._settings.get_boolean(SETTINGS_SHOW_MAP);
        this._showCidr = this._settings.get_boolean(SETTINGS_SHOW_CIDR);
        this._hiddenIfaces = this._settings.get_strv(SETTINGS_HIDDEN_IFACES);
        this._notifyIpChange = this._settings.get_boolean(SETTINGS_NOTIFY_IP_CHANGE);
        this._copyCidr = this._settings.get_boolean(SETTINGS_COPY_CIDR);

        // Panel button content
        const hbox = new St.BoxLayout({style_class: 'panel-status-menu-box'});

        this._icon = new St.Icon({
            icon_name: 'network-idle-symbolic',
            icon_size: ICON_SIZE,
            accessible_name: 'Loading',
        });

        this._label = new St.Label({
            text: '...',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label.visible = !this._compactMode;

        // Security status dot: mirrors the popup banner so a leak is visible
        // in the panel without opening the menu
        this._statusDot = new St.Icon({
            icon_name: 'emblem-synchronizing-symbolic',
            icon_size: 12,
            style_class: 'panel-status-dot panel-status-checking',
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: 'Checking connection',
        });

        hbox.add_child(this._icon);
        hbox.add_child(this._statusDot);
        hbox.add_child(this._label);
        this.add_child(hbox);

        // --- Popup menu content ---

        // Security status banner
        this._statusItem = new PopupMenu.PopupBaseMenuItem({reactive: false});
        this._statusBox = new St.BoxLayout({style_class: 'status-banner status-checking'});
        this._statusIcon = new St.Icon({
            icon_name: 'emblem-synchronizing-symbolic',
            icon_size: 16,
            style_class: 'status-banner-icon',
        });
        this._statusLabel = new St.Label({
            text: 'Checking connection...',
            style_class: 'status-banner-text',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._statusBox.add_child(this._statusIcon);
        this._statusBox.add_child(this._statusLabel);
        this._statusItem.add_child(this._statusBox);
        this._statusItem.accessible_name = 'Security: Checking connection';
        this.menu.addMenuItem(this._statusItem);

        // Local network section
        this._localSeparator = new PopupMenu.PopupSeparatorMenuItem('Local');
        this.menu.addMenuItem(this._localSeparator);
        this._localItems = [];
        // Parsed, filtered interfaces the current rows were built from
        this._localKey = null;

        // Public IP section
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Public'));

        const v4Row = createIpRow('IPv4  ', 'ip-address', '...', () => this._copyToClipboard(this._currentIPv4));
        this._ipv4Item = v4Row.item;
        this._ipv4Label = v4Row.label;
        this.menu.addMenuItem(this._ipv4Item);

        const v6Row = createIpRow('IPv6  ', 'ip-address-v6', '...', () => this._copyToClipboard(this._currentIPv6));
        this._ipv6Item = v6Row.item;
        this._ipv6Label = v6Row.label;
        this.menu.addMenuItem(this._ipv6Item);

        // Location + map section
        this._geoItem = new PopupMenu.PopupBaseMenuItem({reactive: false});
        const geoContainer = new St.BoxLayout();

        // Map tile
        this._mapInfo = new St.BoxLayout();
        geoContainer.add_child(this._mapInfo);
        this._mapInfo.visible = this._showMap;

        this._showDefaultMap('Map: loading');

        // Geo details
        const geoBox = new St.BoxLayout({style_class: 'ip-info-box', ...VERTICAL});

        // Location: "City, Country"
        const locRow = new St.BoxLayout();
        locRow.add_child(new St.Label({style_class: 'ip-info-key', text: 'Location: '}));
        this._locationLabel = new St.Label({style_class: 'ip-info-value', text: ''});
        locRow.add_child(this._locationLabel);
        geoBox.add_child(locRow);

        // Organization
        const orgRow = new St.BoxLayout();
        orgRow.add_child(new St.Label({style_class: 'ip-info-key', text: 'ISP: '}));
        this._orgLabel = new St.Label({style_class: 'ip-info-value', text: ''});
        orgRow.add_child(this._orgLabel);
        geoBox.add_child(orgRow);

        geoContainer.add_child(geoBox);
        this._geoItem.add_child(geoContainer);
        this.menu.addMenuItem(this._geoItem);

        // Blacklist warning: Mullvad already returns this with the geo data
        this._blacklistItem = new PopupMenu.PopupBaseMenuItem({reactive: false});
        this._blacklistItem.add_child(new St.Icon({
            icon_name: 'dialog-warning-symbolic',
            icon_size: 14,
            style_class: 'blacklist-icon',
        }));
        this._blacklistLabel = new St.Label({
            style_class: 'blacklist-text',
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._blacklistItem.add_child(this._blacklistLabel);
        this._blacklistItem.visible = false;
        this.menu.addMenuItem(this._blacklistItem);

        // Actions
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._dnsResultItem = new PopupMenu.PopupBaseMenuItem({reactive: false});
        this._dnsResultLabel = new St.Label({
            style_class: 'dns-result-text',
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._dnsResultItem.add_child(this._dnsResultLabel);
        this._dnsResultItem.visible = false;
        this.menu.addMenuItem(this._dnsResultItem);

        this._dnsTestItem = new PopupMenu.PopupMenuItem('Test DNS leak');
        this._dnsTestItem.connect('activate', () => this._testDnsLeak());
        this.menu.addMenuItem(this._dnsTestItem);

        this._refreshItem = new PopupMenu.PopupMenuItem('Refresh');
        this._refreshItem.connect('activate', () => this._update());
        this.menu.addMenuItem(this._refreshItem);

        const prefs = new PopupMenu.PopupMenuItem('Preferences...');
        prefs.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefs);

        // React to settings changes per key
        this._settingsChangedId = this._settings.connect('changed', (_settings, key) => {
            if (this._cancellable.is_cancelled())
                return;
            switch (key) {
            case SETTINGS_COMPACT_MODE:
                this._compactMode = this._settings.get_boolean(SETTINGS_COMPACT_MODE);
                this._label.visible = !this._compactMode;
                this._renderPanelLabel();
                break;
            case SETTINGS_REFRESH_RATE:
                this._refreshRate = Math.max(30, this._settings.get_int(SETTINGS_REFRESH_RATE));
                this._stopTimer();
                this._startTimer();
                break;
            case SETTINGS_POSITION:
                this._menuPosition = this._settings.get_string(SETTINGS_POSITION);
                this._resetPanelPos();
                break;
            case SETTINGS_SHOW_MAP:
                this._showMap = this._settings.get_boolean(SETTINGS_SHOW_MAP);
                this._mapInfo.visible = this._showMap;
                if (this._showMap && this._geoData)
                    this._fetchMap();
                break;
            case SETTINGS_SHOW_CIDR:
                this._showCidr = this._settings.get_boolean(SETTINGS_SHOW_CIDR);
                if (this._showCidr)
                    this._fetchPrefixes(this._currentIPv4, this._currentIPv6).catch(() => {});
                else
                    this._renderIpRows();
                break;
            case SETTINGS_HIDDEN_IFACES:
                this._hiddenIfaces = this._settings.get_strv(SETTINGS_HIDDEN_IFACES);
                this._updateLocalIP();
                break;
            case SETTINGS_NOTIFY_IP_CHANGE:
                this._notifyIpChange = this._settings.get_boolean(SETTINGS_NOTIFY_IP_CHANGE);
                break;
            case SETTINGS_COPY_CIDR:
                this._copyCidr = this._settings.get_boolean(SETTINGS_COPY_CIDR);
                break;
            }
        });

        Main.panel.addToStatusArea('ip-menu', this, 1, this._menuPosition);
        this._watchNetworkChanges();
        this._update();
        this._startTimer();
    }

    _copyToClipboard(text) {
        if (!text) return;
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        Main.notify('Public IP', `Copied ${text} to clipboard`);
    }

    _updateAccessibleName(assessment) {
        let name = '';
        switch (assessment?.status) {
        case STATUS_PROTECTED:
            name = `VPN: ${assessment.vpnProvider}. `;
            break;
        case STATUS_LEAK:
            name = `Warning: ${assessment.leakFamily} leak. `;
            break;
        case STATUS_EXPOSED:
            name = 'No VPN. ';
            break;
        case STATUS_OFFLINE:
            name = 'Offline. ';
            break;
        }
        name += `IP: ${this._currentIPv4 || this._currentIPv6 || 'unknown'}`;
        const loc = this._locationLabel.text;
        if (loc) name += `, ${loc}`;
        this.accessible_name = name;
    }

    async _updateLocalIP() {
        try {
            const proc = Gio.Subprocess.new(
                ['ip', '-o', 'addr', 'show', 'scope', 'global'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            );
            const [stdout] = await proc.communicate_utf8_async(null, this._cancellable);
            if (this._cancellable.is_cancelled())
                return;

            // Built-in ignored prefixes are dropped by the parser; hide user choices here
            const ifaces = new Map([...parseIpAddr(stdout ?? '')]
                .filter(([iface]) => !this._hiddenIfaces.includes(iface)));

            // Rebuilding while the menu is open flickers the rows. Key on the parsed,
            // filtered rows, not the raw output: its lifetime counters change every poll.
            // _copyCidr is read on activation, so it needs no rebuild.
            const key = JSON.stringify([...ifaces]);
            if (key === this._localKey)
                return;

            // Destroy only now, right before populating: overlapping runs then
            // cannot both leave rows behind, and the last completion wins.
            for (const item of this._localItems)
                item.destroy();
            this._localItems = [];
            this._populateLocalIPs(ifaces);
            this._localKey = key;
        } catch (_e) {
            // Silent fail — local IPs are non-critical
        }
    }

    _populateLocalIPs(ifaces) {
        const sepIndex = this.menu._getMenuItems().indexOf(this._localSeparator);
        let insertPos = sepIndex + 1;

        let first = true;
        for (const [iface, addrs] of ifaces) {
            // Interface header
            if (!first) {
                const spacer = new PopupMenu.PopupSeparatorMenuItem();
                this.menu.addMenuItem(spacer, insertPos);
                this._localItems.push(spacer);
                insertPos++;
            }

            const header = new PopupMenu.PopupBaseMenuItem({reactive: false});
            header.add_child(new St.Icon({
                icon_name: 'network-wired-symbolic',
                icon_size: 14,
                style_class: 'iface-header-icon',
            }));
            header.add_child(new St.Label({
                style_class: 'iface-header',
                text: iface,
            }));
            this.menu.addMenuItem(header, insertPos);
            this._localItems.push(header);
            header.accessible_name = `Interface: ${iface}`;
            insertPos++;

            // IP rows under this interface
            for (const {ip, cidr, isV6} of addrs) {
                const {item} = createIpRow(
                    isV6 ? '  IPv6  ' : '  IPv4  ',
                    isV6 ? 'ip-address-v6' : 'ip-address',
                    cidr,
                    () => this._copyToClipboard(this._copyCidr ? cidr : ip),
                );
                item.accessible_name = `${iface} ${isV6 ? 'IPv6' : 'IPv4'}: ${cidr}. Activate to copy.`;
                this.menu.addMenuItem(item, insertPos);
                this._localItems.push(item);
                insertPos++;
            }

            first = false;
        }

        if (ifaces.size === 0) {
            const emptyItem = new PopupMenu.PopupBaseMenuItem({reactive: false});
            emptyItem.add_child(new St.Label({
                style_class: 'ip-info-key',
                text: 'No interfaces',
            }));
            this.menu.addMenuItem(emptyItem, insertPos);
            this._localItems.push(emptyItem);
        }
    }

    _startTimer() {
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, this._refreshRate, () => {
                this._update();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _stopTimer() {
        if (this._timerId !== null) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
    }

    _watchNetworkChanges() {
        // Refresh as soon as the network actually changes (VPN up/down, link
        // change, resume) instead of waiting out the poll interval.
        try {
            this._nmSignalId = Gio.DBus.system.signal_subscribe(
                'org.freedesktop.NetworkManager',
                'org.freedesktop.DBus.Properties',
                'PropertiesChanged',
                '/org/freedesktop/NetworkManager',
                'org.freedesktop.NetworkManager',
                Gio.DBusSignalFlags.NONE,
                (_conn, _sender, _path, _iface, _signal, params) => {
                    const changed = params?.deepUnpack()?.[1] ?? {};
                    // Only the properties that imply our public IP may differ
                    if ('PrimaryConnection' in changed || 'ActiveConnections' in changed
                        || 'State' in changed || 'Connectivity' in changed)
                        this._queueNetworkUpdate();
                }
            );
        } catch (e) {
            console.error(`[Public IP] NetworkManager watch failed: ${e.message}`);
        }
    }

    _queueNetworkUpdate() {
        if (this._cancellable.is_cancelled())
            return;
        if (this._nmDebounceId !== null)
            GLib.source_remove(this._nmDebounceId);
        this._nmDebounceId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, NM_DEBOUNCE_SECONDS, () => {
                this._nmDebounceId = null;
                const now = GLib.get_monotonic_time();
                if (!this._cancellable.is_cancelled() && now - this._lastNmUpdate >= NM_MIN_INTERVAL_US) {
                    this._lastNmUpdate = now;
                    this._update();
                }
                return GLib.SOURCE_REMOVE;
            }
        );
    }

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

    _showDefaultMap(accessibleName) {
        this._mapInfo.destroy_all_children();
        this._mapInfo.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(`${this._extension.path}/icons/default_map.png`),
            icon_size: 160,
            accessible_name: accessibleName,
        }));
    }

    // Shown from memory only: the tile is never written to disk
    _setMapTile(bytes) {
        this._mapInfo.destroy_all_children();
        this._mapInfo.add_child(new St.Icon({
            gicon: Gio.BytesIcon.new(bytes),
            icon_size: 160,
            accessible_name: `Map: ${this._locationLabel.text || 'unknown location'}`,
        }));
    }

    async _fetchMap() {
        const geo = this._geoData;
        if (!this._showMap)
            return;
        if (typeof geo?.latitude !== 'number' || typeof geo?.longitude !== 'number') {
            if (!this._cancellable.is_cancelled())
                this._showDefaultMap('Map: unavailable');
            return;
        }
        try {
            const {x, y} = latLonToTile(geo.latitude, geo.longitude, MAP_ZOOM);
            const bytes = await this._fetchBytes(
                `https://tile.openstreetmap.org/${MAP_ZOOM}/${x}/${y}.png`
            );
            // A newer IP change may have replaced the geo data while we waited
            if (this._cancellable.is_cancelled() || this._geoData !== geo)
                return;
            this._setMapTile(bytes);
        } catch (e) {
            if (!this._cancellable.is_cancelled()) {
                console.error(`[Public IP] Map download failed: ${e.message}`);
                if (this._geoData === geo)
                    this._showDefaultMap('Map: unavailable');
            }
        }
    }

    async _removeLegacyMapCache() {
        // shortcut: removes the pre-0.3 cached map tile, delete this after a few releases
        const dir = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_cache_dir(), 'public-ip-extension'])
        );
        try { await dir.get_child('latest_map.png').delete_async(GLib.PRIORITY_DEFAULT, null); } catch (_e) { /* best effort */ }
        try { await dir.delete_async(GLib.PRIORITY_DEFAULT, null); } catch (_e) { /* best effort */ }
    }

    _updateBlacklist(ipv4Data, ipv6Data) {
        // Comes free with the geo response - no extra request, no extra host
        const lists = [];
        let flagged = false;
        for (const data of [ipv4Data, ipv6Data]) {
            const bl = data?.blacklisted;
            if (!bl)
                continue;
            if (bl.blacklisted === true)
                flagged = true;
            for (const entry of bl.results ?? []) {
                if (entry?.blacklisted && entry.name && !lists.includes(entry.name))
                    lists.push(entry.name);
            }
        }

        this._blacklistItem.visible = flagged || lists.length > 0;
        if (!this._blacklistItem.visible)
            return;

        const count = lists.length;
        const text = count
            ? `Flagged on ${count} list${count > 1 ? 's' : ''}: ${lists.join(', ')}`
            : 'Flagged on a public blocklist';
        this._blacklistLabel.text = text;
        this._blacklistItem.accessible_name = `Warning: ${text}`;
    }

    async _testDnsLeak() {
        if (this._cancellable.is_cancelled() || this._dnsTesting)
            return;
        this._dnsTesting = true;
        this._dnsTestItem.label.text = 'Testing DNS...';
        try {
            // Resolving a unique subdomain lets Mullvad report back which
            // resolvers performed the lookup on our behalf.
            const id = Array.from({length: 4}, () =>
                GLib.random_int_range(0, 0x10000).toString(16).padStart(4, '0')
            ).join('');

            // A plain system-resolver lookup is all Mullvad needs, and it
            // bypasses any HTTP proxy so the result reflects the system resolver.
            try {
                await Gio.Resolver.get_default().lookup_by_name_async(
                    `${id}.${DNS_LEAK_HOST}`, this._cancellable
                );
            } catch (_e) { /* only the lookup matters, not its answer */ }
            if (this._cancellable.is_cancelled()) return;

            const json = await this._fetchText(`https://${MULLVAD_HOST}/dnsleak/${id}`, 0);
            if (this._cancellable.is_cancelled()) return;

            const resolvers = JSON.parse(json);
            this._showDnsResult(describeResolvers(resolvers));
        } catch (e) {
            if (!this._cancellable.is_cancelled()) {
                this._showDnsResult('DNS test failed');
                console.error(`[Public IP] DNS leak test failed: ${e.message}`);
            }
        } finally {
            this._dnsTesting = false;
            if (!this._cancellable.is_cancelled())
                this._dnsTestItem.label.text = 'Test DNS leak';
        }
    }

    _showDnsResult(text) {
        this._dnsResultLabel.text = text;
        this._dnsResultItem.accessible_name = text;
        this._dnsResultItem.visible = true;
        // Activating a menu item closes the menu, so surface the result here too
        Main.notify('DNS Leak Test', text);
    }

    // `ip route get` is a local FIB lookup and sends no packets, so the probe addresses are never contacted.
    async _checkTunnels() {
        const run = async argv => {
            try {
                const proc = Gio.Subprocess.new(
                    argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
                );
                const [stdout] = await proc.communicate_utf8_async(null, this._cancellable);
                return proc.get_successful() ? stdout : null;
            } catch (_e) {
                return null;
            }
        };
        const [route4, route6, links] = await Promise.all([
            run(['ip', '-j', 'route', 'get', '1.1.1.1']),
            run(['ip', '-j', '-6', 'route', 'get', '2606:4700:4700::1111']),
            run(['ip', '-j', '-d', 'link', 'show']),
        ]);
        // Route-based, not presence-based: a tunnel interface that is up but unused counts for nothing
        const tunnels = tunnelInterfaces(links);
        const dev4 = routeDevice(route4);
        const dev6 = routeDevice(route6);
        return {
            v4: tunnels.has(dev4) ? dev4 : null,
            v6: tunnels.has(dev6) ? dev6 : null,
        };
    }

    _updateSecurityBanner(assessment) {
        this._statusIcon.icon_name = assessment.icon;
        this._statusLabel.text = assessment.text;
        this._statusItem.accessible_name = `Security: ${assessment.text}`;

        // Panel dot: same icon, same status colour, always visible
        this._statusDot.icon_name = assessment.icon;
        this._statusDot.style_class = `panel-status-dot panel-status-${assessment.status}`;
        this._statusDot.accessible_name = assessment.text;

        this._statusBox.style_class = `status-banner status-${assessment.status}`;
    }

    async _fetchPrefix(ip) {
        try {
            const text = await this._fetchText(
                `https://stat.ripe.net/data/network-info/data.json?resource=${encodeURIComponent(ip)}`, 0
            );
            const data = JSON.parse(text);
            const prefix = data?.data?.prefix;
            if (prefix) {
                // Extract just the /XX part
                const slash = prefix.indexOf('/');
                if (slash !== -1)
                    return prefix.substring(slash);
            }
        } catch (_e) { /* non-critical, skip silently */ }
        return null;
    }

    async _fetchPrefixes(ipv4, ipv6) {
        const results = await Promise.allSettled([
            ipv4 ? this._fetchPrefix(ipv4) : Promise.resolve(null),
            ipv6 ? this._fetchPrefix(ipv6) : Promise.resolve(null),
        ]);
        if (this._cancellable.is_cancelled()) return;

        const v4Prefix = results[0].status === 'fulfilled' ? results[0].value : null;
        const v6Prefix = results[1].status === 'fulfilled' ? results[1].value : null;

        // Drop a late result for an IP that has since changed
        if (v4Prefix && ipv4 === this._currentIPv4)
            this._prefixes.v4 = {ip: ipv4, prefix: v4Prefix};
        if (v6Prefix && ipv6 === this._currentIPv6)
            this._prefixes.v6 = {ip: ipv6, prefix: v6Prefix};
        this._renderIpRows();
    }

    async _fetchText(url, retries = 1) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const bytes = await this._fetchBytes(url);
                return new TextDecoder().decode(bytes.get_data());
            } catch (e) {
                if (attempt === retries)
                    throw e;
            }
        }
    }

    async _fetchBytes(url) {
        const message = Soup.Message.new('GET', url);
        const bytes = await this._session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, this._cancellable
        );
        if (message.status_code !== 200)
            throw new Error(`HTTP ${message.status_code}`);
        return bytes;
    }

    _renderPanelLabel() {
        if (!this._compactMode)
            this._label.text = this._currentIPv4 || this._currentIPv6 || 'No Connection';
    }

    // Both public IP rows, rendered from state: current IP, prefix, accessible name
    _renderIpRows() {
        const rows = [
            ['IPv4', this._ipv4Item, this._ipv4Label, this._currentIPv4, this._prefixes.v4],
            ['IPv6', this._ipv6Item, this._ipv6Label, this._currentIPv6, this._prefixes.v6],
        ];
        for (const [family, item, label, ip, prefixState] of rows) {
            const prefix = this._showCidr && ip && prefixState?.ip === ip ? prefixState.prefix : null;
            label.text = ip ? (prefix ? `${ip}  ${prefix}` : ip) : 'Unavailable';
            item.sensitive = !!ip;
            item.accessible_name = ip
                ? `Public ${family}: ${ip}${prefix ? ` ${prefix}` : ''}. Activate to copy.`
                : `Public ${family}: Unavailable`;
        }
    }

    _renderGeo(geoData) {
        if (!geoData) {
            // Offline: drop everything that described the previous connection
            this._locationLabel.text = '';
            this._orgLabel.text = '';
            this._geoItem.accessible_name = '';
            this._showDefaultMap('Map: unavailable');
            return;
        }

        // Update location label: "City, Country"
        const city = geoData.city || '';
        const country = geoData.country || '';
        if (city && country)
            this._locationLabel.text = `${city}, ${country}`;
        else
            this._locationLabel.text = city || country || '';

        this._orgLabel.text = geoData.organization || '';
        this._geoItem.accessible_name =
            `Location: ${this._locationLabel.text}. ISP: ${this._orgLabel.text}`;

        // Resolve country name to ISO code for flag icon
        const code = countryCode(country);
        if (code) {
            this._icon.gicon = Gio.icon_new_for_string(
                `${this._extension.path}/icons/flags/${code}.png`
            );
            this._icon.accessible_name = country;
        } else {
            this._icon.gicon = null;
            this._icon.icon_name = 'network-idle-symbolic';
            this._icon.accessible_name = country || 'Unknown location';
        }
    }

    async _update() {
        if (this._cancellable.is_cancelled())
            return;
        if (this._updating) {
            this._pendingUpdate = true;
            return;
        }
        this._updating = true;
        try {
            // Reset banner to "checking" state during fetch
            this._statusIcon.icon_name = 'emblem-synchronizing-symbolic';
            this._statusLabel.text = 'Checking connection...';
            this._statusBox.style_class = 'status-banner status-checking';
            this._refreshItem.label.text = 'Refreshing...';

            this._updateLocalIP();

            // Mullvad API: no-log, privacy-first VPN provider. The local route
            // check runs alongside; it never rejects.
            const [ipv4Result, ipv6Result, tunnelResult] = await Promise.allSettled([
                this._fetchText('https://ipv4.am.i.mullvad.net/json'),
                this._fetchText('https://ipv6.am.i.mullvad.net/json'),
                this._checkTunnels(),
            ]);

            if (this._cancellable.is_cancelled()) return;

            // A family without connectivity fails on every poll: log the first
            // failure, not each repeat
            if (ipv4Result.status === 'rejected' && (this._firstUpdate || this._currentIPv4))
                console.error(`[Public IP] IPv4 fetch failed: ${ipv4Result.reason}`);
            if (ipv6Result.status === 'rejected' && (this._firstUpdate || this._currentIPv6))
                console.error(`[Public IP] IPv6 fetch failed: ${ipv6Result.reason}`);

            // Parse JSON individually so one failure doesn't block the other
            let ipv4Data = null;
            let ipv6Data = null;
            try { if (ipv4Result.status === 'fulfilled') ipv4Data = JSON.parse(ipv4Result.value); }
            catch (_e) { console.error('[Public IP] IPv4 JSON parse failed'); }
            try { if (ipv6Result.status === 'fulfilled') ipv6Data = JSON.parse(ipv6Result.value); }
            catch (_e) { console.error('[Public IP] IPv6 JSON parse failed'); }

            const ipv4 = ipv4Data?.ip || null;
            const ipv6 = ipv6Data?.ip || null;
            const tunnels = tunnelResult.status === 'fulfilled'
                ? tunnelResult.value
                : {v4: null, v6: null};

            // Security assessment (uses both IPv4 and IPv6 data)
            const assessment = assessSecurity(ipv4Data, ipv6Data, tunnels);
            this._updateSecurityBanner(assessment);
            this._updateBlacklist(ipv4Data, ipv6Data);

            // Update panel icon for offline state
            if (assessment.status === STATUS_OFFLINE) {
                this._icon.gicon = null;
                this._icon.icon_name = 'network-offline-symbolic';
                this._icon.accessible_name = 'Offline';
            }

            const ipChanged = ipv4 !== this._currentIPv4
                || ipv6 !== this._currentIPv6;

            // IP change notification
            if (ipChanged && !this._firstUpdate && this._notifyIpChange) {
                const oldIp = this._currentIPv4 || this._currentIPv6 || 'none';
                const newIp = ipv4 || ipv6 || 'none';
                let body = `${oldIp} → ${newIp}`;
                if (assessment.status === STATUS_LEAK)
                    body += `\nWarning: ${assessment.leakFamily} leak detected!`;
                else if (assessment.status === STATUS_EXPOSED)
                    body += '\nWarning: No VPN, direct connection';
                else if (assessment.status === STATUS_PROTECTED)
                    body += `\nProtected via ${assessment.vpnProvider}`;
                Main.notify('IP Address Changed', body);
            }

            // A prefix belongs to one IP: forget it when that family's IP changes
            if (ipv4 !== this._currentIPv4)
                this._prefixes.v4 = null;
            if (ipv6 !== this._currentIPv6)
                this._prefixes.v6 = null;

            this._currentIPv4 = ipv4;
            this._currentIPv6 = ipv6;
            this._firstUpdate = false;
            this._renderIpRows();
            this._renderPanelLabel();

            // Geo labels first: the accessible name below reads the location label
            if (ipChanged) {
                // Use IPv4 data (or IPv6 fallback) for geo details
                this._geoData = ipv4Data || ipv6Data;
                this._renderGeo(this._geoData);
            }
            this._updateAccessibleName(assessment);

            if (!ipChanged || !this._geoData)
                return;

            // Fetch CIDR prefix from RIPE STAT (opt-in, sends IP to third party)
            if (this._showCidr)
                this._fetchPrefixes(ipv4, ipv6).catch(() => {});

            // Drop the old place's tile now: _fetchMap() may return early or fail
            this._showDefaultMap('Map: loading');
            // Fetch map tile from OpenStreetMap (only if enabled)
            this._fetchMap();
        } catch (e) {
            if (!this._cancellable.is_cancelled()) {
                console.error(`[Public IP] Update failed: ${e.message}`);
                this._updateSecurityBanner({
                    status: STATUS_OFFLINE,
                    icon: 'network-error-symbolic',
                    text: 'Connection check failed',
                });
            }
        } finally {
            if (!this._cancellable.is_cancelled())
                this._refreshItem.label.text = 'Refresh';
            this._updating = false;
            if (this._pendingUpdate && !this._cancellable.is_cancelled()) {
                this._pendingUpdate = false;
                this._update();
            }
        }
    }

    destroy() {
        this._cancellable.cancel();
        this._stopTimer();
        if (this._nmDebounceId !== null) {
            GLib.source_remove(this._nmDebounceId);
            this._nmDebounceId = null;
        }
        if (this._nmSignalId !== null) {
            Gio.DBus.system.signal_unsubscribe(this._nmSignalId);
            this._nmSignalId = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        this._session.abort();
        this._session = null;
        super.destroy();
    }
});

export default class PublicIPExtension extends Extension {
    enable() {
        this._indicator = new IPMenu(this);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
