import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const POSITION_OPTIONS = [
    {nick: 'top-center', label: 'Top Center'},
    {nick: 'top-left', label: 'Top Left'},
    {nick: 'top-right', label: 'Top Right'},
];

const MONITOR_OPTIONS = [
    {nick: 'primary', label: 'Primary Monitor'},
    {nick: 'follow-focus', label: 'Follow Focused Window'},
    {nick: 'all', label: 'All Monitors'},
];

const SPEED_OPTIONS = [
    {nick: 'fast', label: 'Fast (185ms)'},
    {nick: 'normal', label: 'Normal (280ms)'},
    {nick: 'relaxed', label: 'Relaxed (410ms)'},
];

const COMPACT_OPTIONS = [
    {nick: 'media-progress', label: 'Media Artwork & Equalizer'},
    {nick: 'minimal', label: 'Minimal Track & Status'},
    {nick: 'system-pill', label: 'Minimal System Pill'},
];

const EXPANDED_OPTIONS = [
    {nick: 'full', label: 'Full Glass Control Panel'},
    {nick: 'media-focused', label: 'Media & Audio Only'},
    {nick: 'controls-compact', label: 'Compact Control Stack'},
];

const RESETTABLE_KEYS = [
    'island-position',
    'use-custom-position',
    'custom-x',
    'custom-y',
    'monitor-mode',
    'top-offset',
    'compact-width',
    'compact-height',
    'expanded-width',
    'expanded-height',
    'corner-radius',
    'background-opacity',
    'background-color',
    'blur-intensity',
    'border-opacity',
    'shadow-intensity',
    'animation-speed',
    'compact-appearance',
    'expanded-appearance',
    'enable-media',
    'enable-audio',
    'enable-brightness',
    'enable-quick-settings',
    'show-album-artwork',
    'auto-expand-on-music',
    'auto-expand-on-volume',
    'auto-expand-on-brightness',
    'auto-collapse-delay',
];

function bindComboRow(row, settings, key, options) {
    const model = new Gtk.StringList();
    for (const opt of options)
        model.append(opt.label);
    row.model = model;

    const syncSelection = () => {
        const current = settings.get_string(key);
        row.selected = Math.max(0, options.findIndex(o => o.nick === current));
    };
    syncSelection();

    row.connect('notify::selected', () => {
        const chosen = options[row.selected];
        if (chosen)
            settings.set_string(key, chosen.nick);
    });
    settings.connect(`changed::${key}`, syncSelection);
}

function rgbaToHex(rgba) {
    const toHex = v => Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase();
    return `#${toHex(rgba.red)}${toHex(rgba.green)}${toHex(rgba.blue)}`;
}

export default class DynamicIslandPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(660, 780);

        // Page 1: Glassmorphism & Layout
        const appearancePage = new Adw.PreferencesPage({
            title: 'Glass & Layout',
            icon_name: 'applications-graphics-symbolic',
        });
        window.add(appearancePage);

        const glassGroup = new Adw.PreferencesGroup({
            title: 'Glassmorphism & Blur · By Lxe Soul',
            description: 'Configure translucent dark glass, Shell.BlurEffect radius, borders, and shadow depth',
        });
        appearancePage.add(glassGroup);

        const opacityRow = new Adw.SpinRow({
            title: 'Glass Surface Opacity',
            subtitle: 'Lower values yield higher transparency (0.04 = 96% max transparency)',
            digits: 2,
            adjustment: new Gtk.Adjustment({lower: 0.04, upper: 0.90, step_increment: 0.02, value: settings.get_double('background-opacity')}),
        });
        settings.bind('background-opacity', opacityRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        glassGroup.add(opacityRow);

        const blurRow = new Adw.SpinRow({
            title: 'Blur Intensity (px)',
            subtitle: 'Increase or decrease background blur (also adjustable live inside the Expanded Island)',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 60, step_increment: 2, value: settings.get_int('blur-intensity')}),
        });
        settings.bind('blur-intensity', blurRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        glassGroup.add(blurRow);

        const blurPresetsRow = new Adw.ActionRow({
            title: 'Quick Blur Presets',
            subtitle: 'One-click presets for background blur strength',
        });
        const presetBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER,
        });
        for (const preset of [
            {label: 'Off (0)', value: 0},
            {label: 'Subtle (10)', value: 10},
            {label: 'Medium (22)', value: 22},
            {label: 'Strong (38)', value: 38},
        ]) {
            const btn = new Gtk.Button({label: preset.label, valign: Gtk.Align.CENTER});
            btn.connect('clicked', () => settings.set_int('blur-intensity', preset.value));
            presetBox.append(btn);
        }
        blurPresetsRow.add_suffix(presetBox);
        glassGroup.add(blurPresetsRow);

        const borderRow = new Adw.SpinRow({
            title: 'Glass Border Opacity',
            digits: 2,
            adjustment: new Gtk.Adjustment({lower: 0.02, upper: 0.45, step_increment: 0.02, value: settings.get_double('border-opacity')}),
        });
        settings.bind('border-opacity', borderRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        glassGroup.add(borderRow);

        const shadowRow = new Adw.SpinRow({
            title: 'Shadow Intensity',
            digits: 2,
            adjustment: new Gtk.Adjustment({lower: 0.0, upper: 1.0, step_increment: 0.05, value: settings.get_double('shadow-intensity')}),
        });
        settings.bind('shadow-intensity', shadowRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        glassGroup.add(shadowRow);

        const colorRow = new Adw.ActionRow({
            title: 'Background Tint',
            subtitle: settings.get_string('background-color'),
        });
        const colorBtn = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({with_alpha: false})});
        const syncColorBtn = () => {
            const rgba = new Gdk.RGBA();
            if (rgba.parse(settings.get_string('background-color')))
                colorBtn.set_rgba(rgba);
            colorRow.subtitle = settings.get_string('background-color');
        };
        syncColorBtn();
        colorBtn.connect('notify::rgba', () => {
            const hex = rgbaToHex(colorBtn.get_rgba());
            settings.set_string('background-color', hex);
            colorRow.subtitle = hex;
        });
        settings.connect('changed::background-color', syncColorBtn);
        colorRow.add_suffix(colorBtn);
        glassGroup.add(colorRow);

        const placementGroup = new Adw.PreferencesGroup({
            title: 'Placement & Dimensions',
        });
        appearancePage.add(placementGroup);

        const hasCustomPosKey = Boolean(settings.settings_schema?.has_key?.('use-custom-position'));
        const posRow = new Adw.ComboRow({title: 'Island Position'});
        bindComboRow(posRow, settings, 'island-position', POSITION_OPTIONS);
        posRow.connect('notify::selected', () => {
            if (hasCustomPosKey) {
                try {
                    settings.set_boolean('use-custom-position', false);
                } catch {
                    // Ignore if schema is cached
                }
            }
        });
        placementGroup.add(posRow);

        let initialCustomPos = false;
        let initialCustomX = -1;
        let initialCustomY = -1;
        if (hasCustomPosKey) {
            try {
                initialCustomPos = settings.get_boolean('use-custom-position');
                initialCustomX = settings.get_int('custom-x');
                initialCustomY = settings.get_int('custom-y');
            } catch {
                initialCustomPos = false;
            }
        }

        const resetDragRow = new Adw.ActionRow({
            title: 'Dragged Position',
            subtitle: initialCustomPos
                ? `Custom (${initialCustomX}px, ${initialCustomY}px)`
                : 'Using preset anchor (hold mouse on island to drag anywhere)',
        });
        const resetDragBtn = new Gtk.Button({
            label: 'Reset Position',
            valign: Gtk.Align.CENTER,
        });
        resetDragBtn.connect('clicked', () => {
            if (hasCustomPosKey) {
                try {
                    settings.set_boolean('use-custom-position', false);
                    settings.set_int('custom-x', -1);
                    settings.set_int('custom-y', -1);
                } catch {
                    // Ignore if schema is cached
                }
            }
            resetDragRow.subtitle = 'Using preset anchor (hold mouse on island to drag anywhere)';
        });
        resetDragRow.add_suffix(resetDragBtn);
        placementGroup.add(resetDragRow);

        const monitorRow = new Adw.ComboRow({title: 'Multi-Monitor Mode'});
        bindComboRow(monitorRow, settings, 'monitor-mode', MONITOR_OPTIONS);
        placementGroup.add(monitorRow);

        const topOffsetRow = new Adw.SpinRow({
            title: 'Top Vertical Offset (px)',
            adjustment: new Gtk.Adjustment({lower: 4, upper: 120, step_increment: 2, value: settings.get_int('top-offset')}),
        });
        settings.bind('top-offset', topOffsetRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        placementGroup.add(topOffsetRow);

        const compactWidthRow = new Adw.SpinRow({
            title: 'Compact Width (px)',
            adjustment: new Gtk.Adjustment({lower: 150, upper: 420, step_increment: 4, value: settings.get_int('compact-width')}),
        });
        settings.bind('compact-width', compactWidthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        placementGroup.add(compactWidthRow);

        const compactHeightRow = new Adw.SpinRow({
            title: 'Compact Height (px)',
            adjustment: new Gtk.Adjustment({lower: 26, upper: 56, step_increment: 2, value: settings.get_int('compact-height')}),
        });
        settings.bind('compact-height', compactHeightRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        placementGroup.add(compactHeightRow);

        const expandedWidthRow = new Adw.SpinRow({
            title: 'Expanded Width (px)',
            adjustment: new Gtk.Adjustment({lower: 360, upper: 680, step_increment: 8, value: settings.get_int('expanded-width')}),
        });
        settings.bind('expanded-width', expandedWidthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        placementGroup.add(expandedWidthRow);

        const expandedHeightRow = new Adw.SpinRow({
            title: 'Expanded Height (px)',
            adjustment: new Gtk.Adjustment({lower: 220, upper: 540, step_increment: 8, value: settings.get_int('expanded-height')}),
        });
        settings.bind('expanded-height', expandedHeightRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        placementGroup.add(expandedHeightRow);

        const radiusRow = new Adw.SpinRow({
            title: 'Corner Radius (px)',
            adjustment: new Gtk.Adjustment({lower: 12, upper: 40, step_increment: 2, value: settings.get_int('corner-radius')}),
        });
        settings.bind('corner-radius', radiusRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        placementGroup.add(radiusRow);

        const speedRow = new Adw.ComboRow({title: 'Animation Speed'});
        bindComboRow(speedRow, settings, 'animation-speed', SPEED_OPTIONS);
        placementGroup.add(speedRow);

        const compactStyleRow = new Adw.ComboRow({title: 'Compact Mode Appearance'});
        bindComboRow(compactStyleRow, settings, 'compact-appearance', COMPACT_OPTIONS);
        placementGroup.add(compactStyleRow);

        const expandedStyleRow = new Adw.ComboRow({title: 'Expanded Mode Appearance'});
        bindComboRow(expandedStyleRow, settings, 'expanded-appearance', EXPANDED_OPTIONS);
        placementGroup.add(expandedStyleRow);

        // Page 2: Modules, Smart Behavior & Reset
        const behaviorPage = new Adw.PreferencesPage({
            title: 'Behavior & Modules',
            icon_name: 'view-grid-symbolic',
        });
        window.add(behaviorPage);

        const smartGroup = new Adw.PreferencesGroup({
            title: 'Smart Dynamic Behavior',
            description: 'Temporary glass notifications for playback, volume, and brightness events',
        });
        behaviorPage.add(smartGroup);

        const autoMusicRow = new Adw.SwitchRow({
            title: 'Auto-Expand on Music Start / Track Change',
            subtitle: 'Displays a temporary glass music card when Spotify or browser playback starts',
        });
        settings.bind('auto-expand-on-music', autoMusicRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        smartGroup.add(autoMusicRow);

        const autoVolRow = new Adw.SwitchRow({
            title: 'Temporary Volume Indicator',
            subtitle: 'Briefly expands compact pill when volume or mute state changes',
        });
        settings.bind('auto-expand-on-volume', autoVolRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        smartGroup.add(autoVolRow);

        const autoBrightRow = new Adw.SwitchRow({
            title: 'Temporary Brightness Indicator',
            subtitle: 'Briefly expands compact pill when internal display brightness changes',
        });
        settings.bind('auto-expand-on-brightness', autoBrightRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        smartGroup.add(autoBrightRow);

        const delayRow = new Adw.SpinRow({
            title: 'Auto-Collapse Delay (ms)',
            adjustment: new Gtk.Adjustment({lower: 1200, upper: 8000, step_increment: 200, value: settings.get_int('auto-collapse-delay')}),
        });
        settings.bind('auto-collapse-delay', delayRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        smartGroup.add(delayRow);

        const modulesGroup = new Adw.PreferencesGroup({
            title: 'Enabled Modules',
        });
        behaviorPage.add(modulesGroup);

        const mediaRow = new Adw.SwitchRow({title: 'MPRIS Media Player (Spotify & Browsers)'});
        settings.bind('enable-media', mediaRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        modulesGroup.add(mediaRow);

        const artRow = new Adw.SwitchRow({title: 'Music Album Artwork Visibility'});
        settings.bind('show-album-artwork', artRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        modulesGroup.add(artRow);

        const audioRow = new Adw.SwitchRow({title: 'Audio Mixer & Device Routing'});
        settings.bind('enable-audio', audioRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        modulesGroup.add(audioRow);

        const brightRow = new Adw.SwitchRow({title: 'Display Brightness Control'});
        settings.bind('enable-brightness', brightRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        modulesGroup.add(brightRow);

        const qsRow = new Adw.SwitchRow({title: 'Quick Settings (Wi-Fi, Bluetooth, Battery, DND, Night Light)'});
        settings.bind('enable-quick-settings', qsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        modulesGroup.add(qsRow);

        const resetGroup = new Adw.PreferencesGroup({
            title: 'Reset',
        });
        behaviorPage.add(resetGroup);

        const resetRow = new Adw.ActionRow({
            title: 'Restore Default Settings',
            subtitle: 'Resets all glassmorphism, dimension, and smart HUD keys to factory defaults',
        });
        const resetBtn = new Gtk.Button({
            label: 'Restore Defaults',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        resetBtn.connect('clicked', () => {
            for (const key of RESETTABLE_KEYS) {
                try {
                    if (!settings.settings_schema?.has_key || settings.settings_schema.has_key(key))
                        settings.reset(key);
                } catch {
                    // Ignore missing key on cached schema
                }
            }
        });
        resetRow.add_suffix(resetBtn);
        resetGroup.add(resetRow);
    }
}
