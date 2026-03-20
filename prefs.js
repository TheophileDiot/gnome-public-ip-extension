import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SETTINGS_COMPACT_MODE = 'compact-mode';
const SETTINGS_REFRESH_RATE = 'refresh-rate';
const SETTINGS_POSITION = 'position-in-panel';

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

        // Compact mode toggle
        const compactRow = new Adw.SwitchRow({
            title: 'Only show flag in toolbar',
            subtitle: 'Hide the IP address text from the panel',
        });
        settings.bind(SETTINGS_COMPACT_MODE, compactRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(compactRow);

        // Panel position selector
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

        // Refresh settings
        const refreshGroup = new Adw.PreferencesGroup({
            title: 'Refresh',
        });
        page.add(refreshGroup);

        const adjustment = new Gtk.Adjustment({
            lower: 30,
            upper: 30000,
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
