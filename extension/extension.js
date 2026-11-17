import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {AnimationController} from './src/animationController.js';
import {AudioService} from './src/audioService.js';
import {BrightnessService} from './src/brightnessService.js';
import {DynamicIslandWidget} from './src/islandWidget.js';
import {MprisService} from './src/mprisService.js';
import {QuickSettingsService} from './src/quickSettingsService.js';
import {SafeSettings, SignalTracker} from './src/utils.js';

/**
 * DynamicIslandExtension manages the full GNOME Shell 50.1 extension lifecycle,
 * multi-monitor widget instances, smart HUD events, and strict cleanup.
 */
export default class DynamicIslandExtension extends Extension {
    enable() {
        let rawSettings = null;
        try {
            rawSettings = this.getSettings();
        } catch (err) {
            console.error('[DynamicIsland] Falling back to SafeSettings defaults:', err);
        }
        this._settings = new SafeSettings(rawSettings);
        this._signals = new SignalTracker();
        this._animationController = new AnimationController();
        this._islands = [];

        this._mprisService = new MprisService((mediaState, isPositionTick) => {
            for (const island of this._islands)
                island.handleMprisUpdate(mediaState, isPositionTick);
        });

        this._audioService = new AudioService(audioState => {
            for (const island of this._islands)
                island.handleAudioUpdate(audioState);
        });

        this._brightnessService = new BrightnessService(brightnessState => {
            for (const island of this._islands)
                island.handleBrightnessUpdate(brightnessState);
        });

        this._quickSettingsService = new QuickSettingsService(() => {
            for (const island of this._islands)
                island.refreshAll();
        });

        this._mprisService.init();
        this._audioService.init();
        this._brightnessService.init();
        this._quickSettingsService.init();

        this._rebuildIslands();

        this._signals.connect(Main.layoutManager, 'monitors-changed', () => {
            this._rebuildIslands();
        });

        this._signals.connect(global.display, 'notify::focus-window', () => {
            if (this._settings?.get_string('monitor-mode') === 'follow-focus')
                this._updateFollowFocusMonitor();
        });

        this._signals.connect(this._settings, 'changed', (_settings, key) => {
            if (key === 'monitor-mode') {
                this._rebuildIslands();
                return;
            }
            if (key === 'custom-x' || key === 'custom-y' || key === 'use-custom-position') {
                for (const island of this._islands)
                    island.syncPositionFromSettings();
                return;
            }
            for (const island of this._islands)
                island.applyPreferences();
        });
    }

    _getTargetMonitorIndices() {
        const mode = this._settings.get_string('monitor-mode');
        const monitors = Main.layoutManager.monitors;
        if (!monitors || monitors.length === 0)
            return [0];

        if (mode === 'all')
            return monitors.map((_, idx) => idx);

        if (mode === 'follow-focus') {
            const focusedIdx = global.display.get_current_monitor();
            return [focusedIdx >= 0 && focusedIdx < monitors.length ? focusedIdx : Main.layoutManager.primaryIndex];
        }

        return [Main.layoutManager.primaryIndex];
    }

    _updateFollowFocusMonitor() {
        if (this._islands.length !== 1)
            return;
        const focusedIdx = global.display.get_current_monitor();
        if (focusedIdx >= 0)
            this._islands[0].setMonitorIndex(focusedIdx);
    }

    _rebuildIslands() {
        this._destroyIslands();

        const monitorIndices = this._getTargetMonitorIndices();
        for (const monitorIndex of monitorIndices) {
            const island = new DynamicIslandWidget({
                settings: this._settings,
                animationController: this._animationController,
                mprisService: this._mprisService,
                audioService: this._audioService,
                brightnessService: this._brightnessService,
                quickSettingsService: this._quickSettingsService,
                monitorIndex,
                onOpenPreferences: () => {
                    try {
                        this.openPreferences();
                    } catch (err) {
                        console.error('[DynamicIsland] openPreferences error:', err);
                    }
                },
            });

            Main.layoutManager.addChrome(island, {
                affectsStruts: false,
                trackFullscreen: true,
            });
            this._islands.push(island);
        }
    }

    _destroyIslands() {
        for (const island of this._islands) {
            try {
                Main.layoutManager.removeChrome(island);
            } catch {
                // Ignore if already removed from layout chrome
            }
            island.destroy();
        }
        this._islands = [];
    }

    disable() {
        this._signals?.disconnectAll();
        this._signals = null;

        this._destroyIslands();

        this._mprisService?.destroy();
        this._mprisService = null;

        this._audioService?.destroy();
        this._audioService = null;

        this._brightnessService?.destroy();
        this._brightnessService = null;

        this._quickSettingsService?.destroy();
        this._quickSettingsService = null;

        this._animationController?.destroy();
        this._animationController = null;

        this._settings = null;
    }
}
