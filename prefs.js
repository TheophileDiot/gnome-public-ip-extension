import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SETTINGS_COMPACT_MODE = 'compact-mode';
const SETTINGS_REFRESH_RATE = 'refresh-rate';
const SETTINGS_POSITION = 'position-in-panel';
const SETTINGS_SHOW_MAP = 'show-map';
const SETTINGS_SHOW_CIDR = 'show-cidr-prefix';
const SETTINGS_HIDDEN_IFACES = 'hidden-interfaces';
const SETTINGS_NOTIFY_IP_CHANGE = 'notify-ip-change';
const SETTINGS_COPY_CIDR = 'copy-cidr';

const BUILTIN_IGNORED = ['docker', 'br-', 'veth', 'virbr', 'lo'];

function _discoverInterfaces() {
    try {
        const [ok, out] = GLib.spawn_command_line_sync('ip -o addr show scope global');
        if (!ok) return [];
        const seen = new Set();
        const lines = new TextDecoder().decode(out).split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            const iface = line.trim().split(/\s+/)[1];
            if (BUILTIN_IGNORED.some(p => iface.startsWith(p)))
                continue;
            seen.add(iface);
        }
        return [...seen];
    } catch (_e) {
        return [];
    }
}

export default class PublicIPPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });

        // Display settings
        const displayGroup = new Adw.PreferencesGroup({
            title: 'Display',
        });
        page.add(displayGroup);

        const compactRow = new Adw.SwitchRow({
            title: 'Only show flag in toolbar',
            subtitle: 'Hide the IP address text from the panel',
        });
        settings.bind(SETTINGS_COMPACT_MODE, compactRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(compactRow);

        const positionModel = new Gtk.StringList();
        positionModel.append('Left');
        positionModel.append('Center');
        positionModel.append('Right');

        const positionRow = new Adw.ComboRow({
            title: 'Toolbar position',
            subtitle: 'Where to place the indicator in the panel',
            model: positionModel,
        });
        positionRow.set_selected(settings.get_enum(SETTINGS_POSITION));
        positionRow.connect('notify::selected', () => {
            settings.set_enum(SETTINGS_POSITION, positionRow.selected);
        });
        displayGroup.add(positionRow);

        const copyCidrRow = new Adw.SwitchRow({
            title: 'Copy with CIDR prefix',
            subtitle: 'Include the network prefix when copying local IPs (e.g. 192.168.1.5/24)',
        });
        settings.bind(SETTINGS_COPY_CIDR, copyCidrRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(copyCidrRow);

        // Network interfaces
        const ifaceGroup = new Adw.PreferencesGroup({
            title: 'Network Interfaces',
            description: 'Choose which interfaces to show in the local IPs section',
        });
        page.add(ifaceGroup);

        const ifaces = _discoverInterfaces();
        const hidden = settings.get_strv(SETTINGS_HIDDEN_IFACES);

        if (ifaces.length === 0) {
            ifaceGroup.set_description('No network interfaces detected');
        }

        for (const iface of ifaces) {
            const row = new Adw.SwitchRow({
                title: iface,
                active: !hidden.includes(iface),
            });
            row.connect('notify::active', () => {
                const current = settings.get_strv(SETTINGS_HIDDEN_IFACES);
                if (row.active) {
                    settings.set_strv(SETTINGS_HIDDEN_IFACES,
                        current.filter(i => i !== iface));
                } else {
                    if (!current.includes(iface))
                        settings.set_strv(SETTINGS_HIDDEN_IFACES, [...current, iface]);
                }
            });
            ifaceGroup.add(row);
        }

        // Privacy settings
        const privacyGroup = new Adw.PreferencesGroup({
            title: 'Privacy',
        });
        page.add(privacyGroup);

        const mapRow = new Adw.SwitchRow({
            title: 'Show map tile',
            subtitle: 'Fetches a tile from OpenStreetMap, which reveals approximate location to a third party',
        });
        settings.bind(SETTINGS_SHOW_MAP, mapRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        privacyGroup.add(mapRow);

        const cidrRow = new Adw.SwitchRow({
            title: 'Show CIDR prefix',
            subtitle: 'Fetches network prefix from RIPE NCC (stat.ripe.net), which sends your IP to a third party',
        });
        settings.bind(SETTINGS_SHOW_CIDR, cidrRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        privacyGroup.add(cidrRow);

        // Notifications
        const notifyGroup = new Adw.PreferencesGroup({
            title: 'Notifications',
        });
        page.add(notifyGroup);

        const notifyRow = new Adw.SwitchRow({
            title: 'Notify on IP change',
            subtitle: 'Show a desktop notification when the public IP address changes, with VPN status and leak warnings',
        });
        settings.bind(SETTINGS_NOTIFY_IP_CHANGE, notifyRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        notifyGroup.add(notifyRow);

        // Refresh settings
        const refreshGroup = new Adw.PreferencesGroup({
            title: 'Refresh',
        });
        page.add(refreshGroup);

        const adjustment = new Gtk.Adjustment({
            lower: 30,
            upper: 86400,
            step_increment: 10,
            page_increment: 100,
            value: settings.get_int(SETTINGS_REFRESH_RATE),
        });

        const refreshRow = new Adw.SpinRow({
            title: 'Refresh interval',
            subtitle: 'How often to check for IP changes (seconds)',
            adjustment,
        });
        settings.bind(SETTINGS_REFRESH_RATE, adjustment, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        refreshGroup.add(refreshRow);

        window.add(page);
    }
}
