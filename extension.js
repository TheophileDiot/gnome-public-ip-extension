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

const ICON_SIZE = 16;
const MAP_ZOOM = 10;
const SETTINGS_COMPACT_MODE = 'compact-mode';
const SETTINGS_REFRESH_RATE = 'refresh-rate';
const SETTINGS_POSITION = 'position-in-panel';
const SETTINGS_SHOW_MAP = 'show-map';
const SETTINGS_SHOW_CIDR = 'show-cidr-prefix';
const SETTINGS_HIDDEN_IFACES = 'hidden-interfaces';
const SETTINGS_NOTIFY_IP_CHANGE = 'notify-ip-change';
const SETTINGS_COPY_CIDR = 'copy-cidr';
const POSITION_NAMES = ['left', 'center', 'right'];

// Build reverse mapping: English country name -> ISO 3166-1 alpha-2 code
const COUNTRY_TO_CODE = {};
const FLAG_CODES = [
    'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW',
    'AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN',
    'BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG',
    'CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
    'DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI',
    'FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL',
    'GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR',
    'HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM',
    'JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA',
    'LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME',
    'MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU',
    'MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP',
    'NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR',
    'PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD',
    'SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV',
    'SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO',
    'TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE',
    'VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW',
];
try {
    const regionNames = new Intl.DisplayNames(['en'], {type: 'region'});
    for (const code of FLAG_CODES) {
        try {
            const name = regionNames.of(code);
            if (name)
                COUNTRY_TO_CODE[name] = code;
        } catch (_e) { /* skip unknown codes */ }
    }
} catch (_e) { /* Intl.DisplayNames not available */ }

function _latLonToTile(lat, lon, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor((lon + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor(
        (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
    );
    return {x, y};
}

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

// Detect VPN provider from organization/ASN name
const VPN_SIGNATURES = [
    // -- Direct VPN providers --
    ['proton', 'Proton VPN'],
    ['nordvpn', 'NordVPN'],
    ['tefincom', 'NordVPN'],
    ['packethub', 'NordVPN'],
    ['nordlayer', 'NordLayer'],
    ['expressvpn', 'ExpressVPN'],
    ['express vpn', 'ExpressVPN'],
    ['surfshark', 'Surfshark'],
    ['cyberzone', 'Surfshark'],
    ['cyberghost', 'CyberGhost'],
    ['private internet access', 'PIA'],
    ['ivpn', 'IVPN'],
    ['mullvad', 'Mullvad VPN'],
    ['windscribe', 'Windscribe'],
    ['hide.me', 'hide.me'],
    ['eventure', 'hide.me'],
    ['torguard', 'TorGuard'],
    ['vyprvpn', 'VyprVPN'],
    ['golden frog', 'VyprVPN'],
    ['giganews', 'VyprVPN'],
    ['azirevpn', 'AzireVPN'],
    ['netbouncer', 'AzireVPN'],
    ['airvpn', 'AirVPN'],
    ['paolo brini', 'AirVPN'],
    ['perfect privacy', 'Perfect Privacy'],
    ['ipvanish', 'IPVanish'],
    ['netprotect', 'IPVanish'],
    ['hotspot shield', 'Hotspot Shield'],
    ['anchorfree', 'Hotspot Shield'],
    ['pango', 'Hotspot Shield'],
    ['tunnelbear', 'TunnelBear'],
    ['purevpn', 'PureVPN'],
    ['gz systems', 'PureVPN'],
    ['strongvpn', 'StrongVPN'],
    ['privadovpn', 'PrivadoVPN'],
    ['privado networks', 'PrivadoVPN'],
    ['ovpn', 'OVPN'],
    ['hidemyass', 'HMA'],
    ['privax', 'HMA'],
    ['njalla', 'Njalla VPN'],
    ['1337 services', 'Njalla VPN'],
    ['kaspersky', 'Kaspersky VPN'],
    ['bitdefender', 'Bitdefender VPN'],
    ['norton', 'Norton VPN'],
    ['avast', 'Avast SecureLine'],
    ['avira', 'Avira VPN'],
    ['astrill', 'Astrill VPN'],
    ['cryptostorm', 'Cryptostorm'],
    ['vpn.ac', 'VPN.ac'],
    ['privatevpn', 'PrivateVPN'],
    ['pvdatanet', 'PrivateVPN'],
    ['cactusvpn', 'CactusVPN'],
    ['cactus vpn', 'CactusVPN'],
    ['zenmate', 'ZenMate'],
    ['psiphon', 'Psiphon'],
    ['keepsolid', 'VPN Unlimited'],
    ['speedify', 'Speedify'],
    ['ivacy', 'Ivacy VPN'],
    // -- High-confidence VPN infrastructure --
    ['m247', 'VPN/Datacenter'],
    ['datacamp', 'VPN/Datacenter'],
    ['31173 services', 'VPN/Datacenter'],
    ['tzulo', 'VPN/Datacenter'],
    ['datapacket', 'VPN/Datacenter'],
    ['100tb', 'VPN/Datacenter'],
    ['obehosting', 'VPN/Datacenter'],
    ['clouvider', 'VPN/Datacenter'],
    ['hydra communications', 'VPN/Datacenter'],
    ['internet vikings', 'VPN/Datacenter'],
    ['blix', 'VPN/Datacenter'],
    ['intergrid', 'VPN/Datacenter'],
    ['invite systems', 'VPN/Datacenter'],
    ['creanova', 'VPN/Datacenter'],
    ['xtom', 'VPN/Datacenter'],
    ['quadranet', 'VPN/Datacenter'],
    ['zenlayer', 'VPN/Datacenter'],
    ['stark industries', 'VPN/Datacenter'],
    ['free range cloud', 'VPN/Datacenter'],
];

function _detectVpnProvider(orgLower) {
    for (const [pattern, name] of VPN_SIGNATURES) {
        if (orgLower.includes(pattern))
            return name;
    }
    return null;
}

// Security status levels
const STATUS_PROTECTED = 'protected';
const STATUS_LEAK = 'leak';
const STATUS_EXPOSED = 'exposed';
const STATUS_OFFLINE = 'offline';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

const IPMenu = GObject.registerClass(
class IPMenu extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'IP Details');
        this._extension = extension;
        this._settings = extension.getSettings();
        this._textureCache = St.TextureCache.get_default();
        this._session = new Soup.Session();
        this._session.set_user_agent(`GNOME-Public-IP-Extension/${extension.metadata.version} (+${extension.metadata.url})`);
        this._session.timeout = 30;
        this._cancellable = new Gio.Cancellable();
        this._updating = false;
        this._pendingUpdate = false;
        this._destroyed = false;
        this._timerId = null;
        this._currentIPv4 = null;
        this._currentIPv6 = null;
        this._firstUpdate = true;
        this._cacheDir = _ensureCacheDir();

        this._compactMode = this._settings.get_boolean(SETTINGS_COMPACT_MODE);
        this._refreshRate = Math.max(30, this._settings.get_int(SETTINGS_REFRESH_RATE));
        this._menuPosition = POSITION_NAMES[this._settings.get_enum(SETTINGS_POSITION)] || 'right';
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

        hbox.add_child(this._icon);
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
        this._updateLocalIP();

        // Public IP section
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Public'));

        this._ipv4Item = new PopupMenu.PopupBaseMenuItem();
        this._ipv4Item.add_child(new St.Label({style_class: 'ip-info-key', text: 'IPv4  '}));
        this._ipv4Label = new St.Label({style_class: 'ip-address', text: '...', x_expand: true});
        this._ipv4Item.add_child(this._ipv4Label);
        this._ipv4Item.add_child(new St.Icon({icon_name: 'edit-copy-symbolic', icon_size: 14, style_class: 'ip-copy-icon'}));
        this._ipv4Item.connect('activate', () => this._copyToClipboard(this._currentIPv4));
        this.menu.addMenuItem(this._ipv4Item);

        this._ipv6Item = new PopupMenu.PopupBaseMenuItem();
        this._ipv6Item.add_child(new St.Label({style_class: 'ip-info-key', text: 'IPv6  '}));
        this._ipv6Label = new St.Label({style_class: 'ip-address-v6', text: '...', x_expand: true});
        this._ipv6Item.add_child(this._ipv6Label);
        this._ipv6Item.add_child(new St.Icon({icon_name: 'edit-copy-symbolic', icon_size: 14, style_class: 'ip-copy-icon'}));
        this._ipv6Item.connect('activate', () => this._copyToClipboard(this._currentIPv6));
        this.menu.addMenuItem(this._ipv6Item);

        // Location + map section
        this._geoItem = new PopupMenu.PopupBaseMenuItem({reactive: false});
        const geoContainer = new St.BoxLayout();

        // Map tile
        this._mapInfo = new St.BoxLayout();
        geoContainer.add_child(this._mapInfo);
        this._mapInfo.visible = this._showMap;

        if (this._showMap) {
            this._mapInfo.add_child(new St.Icon({
                gicon: Gio.icon_new_for_string(`${extension.path}/icons/default_map.png`),
                icon_size: 160,
                accessible_name: 'Map: loading',
            }));
        }

        // Geo details
        const geoBox = new St.BoxLayout({style_class: 'ip-info-box', vertical: true});

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

        // Actions
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._refreshItem = new PopupMenu.PopupMenuItem('Refresh');
        this._refreshItem.connect('activate', () => this._update());
        this.menu.addMenuItem(this._refreshItem);

        const prefs = new PopupMenu.PopupMenuItem('Preferences...');
        prefs.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefs);

        // React to settings changes per key
        this._settingsChangedId = this._settings.connect('changed', (_settings, key) => {
            if (this._destroyed)
                return;
            switch (key) {
            case SETTINGS_COMPACT_MODE:
                this._compactMode = this._settings.get_boolean(SETTINGS_COMPACT_MODE);
                this._label.visible = !this._compactMode;
                if (!this._compactMode)
                    this._label.text = this._currentIPv4 || this._currentIPv6 || 'No Connection';
                break;
            case SETTINGS_REFRESH_RATE:
                this._refreshRate = Math.max(30, this._settings.get_int(SETTINGS_REFRESH_RATE));
                this._stopTimer();
                this._startTimer();
                break;
            case SETTINGS_POSITION:
                this._menuPosition = POSITION_NAMES[this._settings.get_enum(SETTINGS_POSITION)] || 'right';
                this._resetPanelPos();
                break;
            case SETTINGS_SHOW_MAP:
                this._showMap = this._settings.get_boolean(SETTINGS_SHOW_MAP);
                this._mapInfo.visible = this._showMap;
                if (this._showMap && (this._currentIPv4 || this._currentIPv6))
                    this._update();
                break;
            case SETTINGS_SHOW_CIDR:
                this._showCidr = this._settings.get_boolean(SETTINGS_SHOW_CIDR);
                if (this._showCidr)
                    this._fetchPrefixes(this._currentIPv4, this._currentIPv6).catch(() => {});
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
                this._updateLocalIP();
                break;
            }
        });

        Main.panel.addToStatusArea('ip-menu', this, 1, this._menuPosition);
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

    _updateLocalIP() {
        // Remove old dynamic items
        for (const item of this._localItems)
            item.destroy();
        this._localItems = [];

        // Built-in ignored prefixes (containers, virtual bridges)
        const IGNORED = ['docker', 'br-', 'veth', 'virbr', 'lo'];

        try {
            const [ok, out] = GLib.spawn_command_line_sync('ip -o addr show scope global');
            if (!ok) return;

            // Group IPs by interface: {iface: [{ip, isV6}]}
            const ifaces = new Map();
            const lines = new TextDecoder().decode(out).split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;

                const parts = line.trim().split(/\s+/);
                const iface = parts[1];

                // Skip built-in ignored + user-hidden interfaces
                if (IGNORED.some(p => iface.startsWith(p)))
                    continue;
                if (this._hiddenIfaces.includes(iface))
                    continue;

                const isV6 = parts[2] === 'inet6';
                const addrField = parts[3] || '';
                const ip = addrField.split('/')[0];
                const cidr = addrField; // e.g. "192.168.1.5/24"

                if (!ip) continue;

                if (!ifaces.has(iface))
                    ifaces.set(iface, []);
                ifaces.get(iface).push({ip, cidr, isV6});
            }

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
                    const item = new PopupMenu.PopupBaseMenuItem();
                    item.add_child(new St.Label({
                        style_class: 'ip-info-key',
                        text: isV6 ? '  IPv6  ' : '  IPv4  ',
                    }));
                    item.add_child(new St.Label({
                        style_class: isV6 ? 'ip-address-v6' : 'ip-address',
                        text: cidr,
                        x_expand: true,
                    }));
                    item.add_child(new St.Icon({
                        icon_name: 'edit-copy-symbolic',
                        icon_size: 14,
                        style_class: 'ip-copy-icon',
                    }));
                    item.connect('activate', () => this._copyToClipboard(this._copyCidr ? cidr : ip));
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
        } catch (_e) {
            // Silent fail — local IPs are non-critical
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

    _updateMapTile() {
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        this._mapInfo.destroy_all_children();
        this._mapInfo.add_child(
            this._textureCache.load_file_async(
                Gio.File.new_for_path(`${this._cacheDir}/latest_map.png`),
                -1, 160, 1, scaleFactor
            )
        );
        this._mapInfo.accessible_name = `Map: ${this._locationLabel?.text || 'unknown location'}`;
    }

    _assessSecurity(ipv4Data, ipv6Data) {
        const hasV4 = !!ipv4Data;
        const hasV6 = !!ipv6Data;

        if (!hasV4 && !hasV6)
            return {status: STATUS_OFFLINE, icon: 'network-offline-symbolic', text: 'No connection'};

        const geoData = ipv4Data || ipv6Data;
        const isMullvad = geoData.mullvad_exit_ip === true;
        const org = (geoData.organization || '').toLowerCase();
        const vpnProvider = isMullvad ? 'Mullvad VPN' : _detectVpnProvider(org);
        const isVpn = !!vpnProvider;

        // Check for IPv6 leak: both stacks available but different country/org
        let ipv6Leak = false;
        if (hasV4 && hasV6) {
            const v4Country = ipv4Data.country || '';
            const v6Country = ipv6Data.country || '';
            const v4Org = (ipv4Data.organization || '').toLowerCase();
            const v6Org = (ipv6Data.organization || '').toLowerCase();

            // Leak = countries differ, or one is VPN infra and the other isn't
            if (v4Country && v6Country && v4Country !== v6Country) {
                ipv6Leak = true;
            } else if (v4Org !== v6Org) {
                const v4IsVpn = isMullvad || !!_detectVpnProvider(v4Org);
                const v6IsVpn = ipv6Data.mullvad_exit_ip === true || !!_detectVpnProvider(v6Org);
                if (v4IsVpn !== v6IsVpn)
                    ipv6Leak = true;
            }
        }

        if (ipv6Leak) {
            const leakSide = hasV4 ? `IPv6 via ${ipv6Data.organization || 'ISP'}` : 'IPv4 exposed';
            return {
                status: STATUS_LEAK,
                icon: 'dialog-warning-symbolic',
                text: `IPv6 Leak — ${leakSide}`,
                vpnProvider,
            };
        }

        if (isVpn) {
            let text = vpnProvider;
            if (isMullvad) {
                const relay = geoData.mullvad_exit_ip_hostname || '';
                const stype = geoData.mullvad_server_type || '';
                if (relay) text += ` (${relay})`;
                if (stype) text += ` [${stype}]`;
            }
            return {status: STATUS_PROTECTED, icon: 'security-high-symbolic', text, vpnProvider};
        }

        return {
            status: STATUS_EXPOSED,
            icon: 'security-low-symbolic',
            text: `Direct — ${geoData.organization || 'unknown ISP'}`,
        };
    }

    _updateSecurityBanner(assessment) {
        this._statusIcon.icon_name = assessment.icon;
        this._statusLabel.text = assessment.text;
        this._statusItem.accessible_name = `Security: ${assessment.text}`;

        // Update banner style
        this._statusBox.style_class = 'status-banner';
        switch (assessment.status) {
        case STATUS_PROTECTED:
            this._statusBox.add_style_class_name('status-protected');
            break;
        case STATUS_LEAK:
            this._statusBox.add_style_class_name('status-leak');
            break;
        case STATUS_EXPOSED:
            this._statusBox.add_style_class_name('status-exposed');
            break;
        case STATUS_OFFLINE:
            this._statusBox.add_style_class_name('status-offline');
            break;
        }
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
        if (this._destroyed) return;

        const v4Prefix = results[0].status === 'fulfilled' ? results[0].value : null;
        const v6Prefix = results[1].status === 'fulfilled' ? results[1].value : null;

        if (v4Prefix && this._currentIPv4) {
            this._ipv4Label.text = `${this._currentIPv4}  ${v4Prefix}`;
            this._ipv4Item.accessible_name = `Public IPv4: ${this._currentIPv4} ${v4Prefix}. Activate to copy.`;
        }
        if (v6Prefix && this._currentIPv6) {
            this._ipv6Label.text = `${this._currentIPv6}  ${v6Prefix}`;
            this._ipv6Item.accessible_name = `Public IPv6: ${this._currentIPv6} ${v6Prefix}. Activate to copy.`;
        }
    }

    async _fetchText(url, retries = 1) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const message = Soup.Message.new('GET', url);
                const bytes = await this._session.send_and_read_async(
                    message, GLib.PRIORITY_DEFAULT, this._cancellable
                );
                if (message.status_code !== 200)
                    throw new Error(`HTTP ${message.status_code}`);
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

    async _update() {
        if (this._destroyed)
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
            if (this._refreshItem)
                this._refreshItem.label.text = 'Refreshing...';

            this._updateLocalIP();

            // Mullvad API: no-log, privacy-first VPN provider
            const [ipv4Result, ipv6Result] = await Promise.allSettled([
                this._fetchText('https://ipv4.am.i.mullvad.net/json'),
                this._fetchText('https://ipv6.am.i.mullvad.net/json'),
            ]);

            if (this._destroyed) return;

            if (ipv4Result.status === 'rejected')
                console.error(`[Public IP] IPv4 fetch failed: ${ipv4Result.reason}`);
            if (ipv6Result.status === 'rejected')
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

            // Update IP labels (prefix added async below on IP change)
            this._ipv4Label.text = ipv4 || 'Unavailable';
            this._ipv6Label.text = ipv6 || 'Unavailable';
            this._ipv4Item.sensitive = !!ipv4;
            this._ipv6Item.sensitive = !!ipv6;

            if (!this._compactMode)
                this._label.text = ipv4 || ipv6 || 'No Connection';

            // Accessible names for IP rows
            this._ipv4Item.accessible_name = ipv4
                ? `Public IPv4: ${ipv4}. Activate to copy.`
                : 'Public IPv4: Unavailable';
            this._ipv6Item.accessible_name = ipv6
                ? `Public IPv6: ${ipv6}. Activate to copy.`
                : 'Public IPv6: Unavailable';

            // Security assessment (uses both IPv4 and IPv6 data)
            const assessment = this._assessSecurity(ipv4Data, ipv6Data);
            this._updateSecurityBanner(assessment);

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
                    body += '\nWarning: IPv6 leak detected!';
                else if (assessment.status === STATUS_EXPOSED)
                    body += '\nWarning: No VPN, direct connection';
                else if (assessment.status === STATUS_PROTECTED)
                    body += `\nProtected via ${assessment.vpnProvider}`;
                Main.notify('IP Address Changed', body);
            }

            this._currentIPv4 = ipv4;
            this._currentIPv6 = ipv6;
            this._firstUpdate = false;
            this._updateAccessibleName(assessment);

            if (!ipChanged)
                return;

            // Use IPv4 data (or IPv6 fallback) for geo details
            const geoData = ipv4Data || ipv6Data;
            if (!geoData)
                return;

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
            if (country) {
                const code = COUNTRY_TO_CODE[country];
                if (code) {
                    this._icon.gicon = Gio.icon_new_for_string(
                        `${this._extension.path}/icons/flags/${code}.png`
                    );
                    this._icon.accessible_name = country;
                }
            }

            if (this._destroyed) return;

            // Fetch CIDR prefix from RIPE STAT (opt-in, sends IP to third party)
            if (this._showCidr)
                this._fetchPrefixes(ipv4, ipv6).catch(() => {});

            // Fetch map tile from OpenStreetMap (only if enabled)
            if (this._showMap
                && typeof geoData.latitude === 'number'
                && typeof geoData.longitude === 'number') {
                try {
                    const {x, y} = _latLonToTile(
                        geoData.latitude, geoData.longitude, MAP_ZOOM
                    );
                    const mapBytes = await this._fetchBytes(
                        `https://tile.openstreetmap.org/${MAP_ZOOM}/${x}/${y}.png`
                    );
                    if (this._destroyed) return;
                    const file = Gio.File.new_for_path(
                        `${this._cacheDir}/latest_map.png`
                    );
                    file.replace_contents(
                        mapBytes.get_data(), null, false,
                        Gio.FileCreateFlags.NONE, null
                    );
                    this._updateMapTile();
                } catch (e) {
                    if (!this._destroyed)
                        console.error(`[Public IP] Map download failed: ${e.message}`);
                }
            }
        } catch (e) {
            if (!this._destroyed) {
                console.error(`[Public IP] Update failed: ${e.message}`);
                this._updateSecurityBanner({
                    status: STATUS_OFFLINE,
                    icon: 'network-error-symbolic',
                    text: 'Connection check failed',
                });
            }
        } finally {
            if (this._refreshItem)
                this._refreshItem.label.text = 'Refresh';
            this._updating = false;
            if (this._pendingUpdate && !this._destroyed) {
                this._pendingUpdate = false;
                this._update();
            }
        }
    }

    destroy() {
        this._destroyed = true;
        this._cancellable.cancel();
        this._stopTimer();
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
