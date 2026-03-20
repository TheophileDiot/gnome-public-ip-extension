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

const DEFAULT_DATA = {
    ipv4: 'N/A',
    ipv6: 'N/A',
    city: '',
    country: '',
    org: '',
};

// Build reverse mapping: English country name -> ISO 3166-1 alpha-2 code
// Used to match Mullvad's country names to flag icon filenames
const COUNTRY_TO_CODE = {};
const FLAG_CODES = [
    'AD','AE','AF','AG','AI','AL','AM','AN','AO','AQ','AR','AS','AT','AU',
    'AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM',
    'BN','BO','BR','BS','BT','BW','BY','BZ','CA','CC','CD','CF','CG','CH',
    'CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE',
    'DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ',
    'FK','FM','FO','FR','GA','GB','GD','GE','GG','GH','GI','GL','GM','GN',
    'GQ','GR','GS','GT','GU','GW','GY','HK','HN','HR','HT','HU','ID','IE',
    'IL','IM','IN','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH',
    'KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR',
    'LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML',
    'MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
    'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA',
    'PE','PF','PG','PH','PK','PL','PN','PR','PS','PT','PW','PY','QA','RO',
    'RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SK','SL','SM',
    'SN','SO','SR','SS','ST','SV','SY','SZ','TC','TD','TF','TG','TH','TJ',
    'TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','US','UY',
    'UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM',
    'ZW',
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
    const dir = Gio.File.new_for_path(
        GLib.build_filenamev([GLib.get_user_cache_dir(), 'public-ip-extension'])
    );
    if (!dir.query_exists(null))
        dir.make_directory_with_parents(null);
    return dir.get_path();
}

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

const IPMenu = GObject.registerClass(
class IPMenu extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'IP Details');
        this._extension = extension;
        this._settings = extension.getSettings();
        this._textureCache = St.TextureCache.get_default();
        this._session = new Soup.Session();
        this._session.set_user_agent('GNOME-Public-IP-Extension/23');
        this._session.timeout = 30;
        this._cancellable = new Gio.Cancellable();
        this._updating = false;
        this._pendingUpdate = false;
        this._destroyed = false;
        this._currentIPv4 = null;
        this._currentIPv6 = null;
        this._cacheDir = _ensureCacheDir();

        this._compactMode = this._settings.get_boolean(SETTINGS_COMPACT_MODE);
        this._refreshRate = Math.max(30, this._settings.get_int(SETTINGS_REFRESH_RATE));
        this._menuPosition = this._settings.get_string(SETTINGS_POSITION);

        // Panel button content
        const hbox = new St.BoxLayout({style_class: 'panel-status-menu-box'});

        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${extension.path}/icons/flags/US.png`),
            icon_size: ICON_SIZE,
        });

        this._label = new St.Label({
            text: DEFAULT_DATA.ipv4,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label.visible = !this._compactMode;

        hbox.add_child(this._icon);
        hbox.add_child(this._label);
        this.add_child(hbox);

        // Popup menu content
        const ipInfo = new PopupMenu.PopupBaseMenuItem({reactive: false});
        const parentContainer = new St.BoxLayout();

        // Map tile
        this._mapInfo = new St.BoxLayout();
        parentContainer.add_child(this._mapInfo);

        const mapTile = new St.Icon({
            gicon: Gio.icon_new_for_string(`${extension.path}/icons/default_map.png`),
            icon_size: 160,
        });
        this._mapInfo.add_child(mapTile);

        // IP info rows
        const ipInfoBox = new St.BoxLayout({style_class: 'ip-info-box', vertical: true});
        parentContainer.add_child(ipInfoBox);
        ipInfo.add_child(parentContainer);
        this.menu.addMenuItem(ipInfo);

        this._dataLabels = {};
        for (const key of Object.keys(DEFAULT_DATA)) {
            const row = new St.BoxLayout();
            ipInfoBox.add_child(row);
            row.add_child(new St.Label({style_class: 'ip-info-key', text: `${key}: `}));
            this._dataLabels[key] = new St.Label({
                style_class: 'ip-info-value',
                text: DEFAULT_DATA[key],
            });
            row.add_child(this._dataLabels[key]);
        }

        // Preferences menu item
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
                this._menuPosition = this._settings.get_string(SETTINGS_POSITION);
                this._resetPanelPos();
                break;
            }
        });

        Main.panel.addToStatusArea('ip-menu', this, 1, this._menuPosition);
        this._update();
        this._startTimer();
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
        if (this.container.get_parent())
            this.container.get_parent().remove_child(this.container);
        Main.panel.statusArea['ip-menu'] = null;
        Main.panel.addToStatusArea('ip-menu', this, 1, this._menuPosition);
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
    }

    async _fetchText(url) {
        const message = Soup.Message.new('GET', url);
        const bytes = await this._session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, this._cancellable
        );
        if (message.status_code !== 200)
            throw new Error(`HTTP ${message.status_code}`);
        return new TextDecoder().decode(bytes.get_data());
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

            this._dataLabels.ipv4.text = ipv4 || 'N/A';
            this._dataLabels.ipv6.text = ipv6 || 'N/A';

            if (!this._compactMode)
                this._label.text = ipv4 || ipv6 || 'No Connection';

            const ipChanged = ipv4 !== this._currentIPv4
                || ipv6 !== this._currentIPv6;

            this._currentIPv4 = ipv4;
            this._currentIPv6 = ipv6;

            if (!ipChanged)
                return;

            // Use IPv4 data (or IPv6 fallback) for geo details
            const geoData = ipv4Data || ipv6Data;
            if (!geoData)
                return;

            this._dataLabels.city.text = geoData.city || '';
            this._dataLabels.country.text = geoData.country || '';
            this._dataLabels.org.text = geoData.organization || '';

            // Resolve country name to ISO code for flag icon
            if (geoData.country) {
                const code = COUNTRY_TO_CODE[geoData.country];
                if (code) {
                    this._icon.gicon = Gio.icon_new_for_string(
                        `${this._extension.path}/icons/flags/${code}.png`
                    );
                }
            }

            if (this._destroyed) return;

            // Fetch map tile from OpenStreetMap
            if (typeof geoData.latitude === 'number' && typeof geoData.longitude === 'number') {
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
            if (!this._destroyed)
                console.error(`[Public IP] Update failed: ${e.message}`);
        } finally {
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
