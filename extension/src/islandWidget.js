import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {
    SafeSettings,
    SignalTracker,
    TimerRegistry,
    buildSurfaceStyle,
    clamp,
    formatDurationSeconds,
    readSystemPulse,
    syncGlassBlurEffect,
} from './utils.js';

const COMPACT_CONTENT_PADDING = 8;
const POMODORO_DEFAULT_SECONDS = 25 * 60;
const EQ_BAR_PATTERNS = [
    [6, 13, 9, 15],
    [13, 7, 15, 8],
    [9, 15, 6, 12],
    [14, 10, 12, 6],
];

/**
 * DynamicIslandWidget renders the floating ultra-transparent glassmorphic St pill
 * with subtle background blur, song-reactive dynamic theming, circular song banner icons,
 * classic black hardware capsule idle state, live blur tuner, and Pomodoro/Clipboard studio.
 * By Lxe Soul.
 */
export const DynamicIslandWidget = GObject.registerClass(
class DynamicIslandWidget extends St.BoxLayout {
    _init({
        settings,
        animationController,
        mprisService,
        audioService,
        brightnessService,
        quickSettingsService,
        monitorIndex,
        onOpenPreferences,
    }) {
        super._init({
            name: 'gnome-dynamic-island-root',
            style_class: 'di-island-container di-state-compact',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            can_focus: false,
            track_hover: true,
            // CRITICAL: clip_to_allocation must be false so St rounded corners never get rectangular clip boxes
            clip_to_allocation: false,
        });

        this._settings = settings instanceof SafeSettings ? settings : new SafeSettings(settings);
        this._anim = animationController;
        this._mpris = mprisService;
        this._audio = audioService;
        this._brightness = brightnessService;
        this._quickSettings = quickSettingsService;
        this._monitorIndex = monitorIndex;
        this._onOpenPreferences = onOpenPreferences;

        this._signals = new SignalTracker();
        this._timers = new TimerRegistry();

        this._state = 'compact'; // 'compact' | 'expanded' | 'focus' | 'hud'
        this._focusModule = 'media'; // 'media' | 'audio' | 'quickSettings'
        this._hudKind = 'music'; // 'music' | 'volume' | 'brightness'
        this._draggingSlider = false;

        this._dragPending = false;
        this._isDragging = false;
        this._dragStageSignalId = 0;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._dragOriginX = 0;
        this._dragOriginY = 0;

        this._autoCollapseTimerId = 0;
        this._eqTimerId = 0;
        this._eqBars = [];
        this._eqStep = 0;

        // Interactive Pomodoro Focus Timer & Clipboard Flash state
        this._pomodoroRunning = false;
        this._pomodoroRemainingSec = POMODORO_DEFAULT_SECONDS;
        this._pomodoroTimerId = 0;
        this._pomodoroLabel = null;
        this._copiedFlash = false;
        this._copiedTimerId = 0;

        this._seekSlider = null;
        this._posLabel = null;
        this._lenLabel = null;

        this._lastHasPlayer = false;
        this._lastTrackKey = '';
        this._lastPlaybackStatus = 'Stopped';
        this._lastVolumeKey = null;
        this._lastBrightnessKey = null;

        this._buildContainers();
        this._wireInteractions();
        this._anim.setSpeedPreset(this._settings.get_string('animation-speed'));
        this._syncInnerBlurEffects();
        this._applySurfaceStyle();
        this.refreshAll();
        this._updateGeometry(false, false);
    }

    _buildContainers() {
        this._compactView = new St.BoxLayout({
            style_class: 'di-compact-view',
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._compactView);

        this._hudView = new St.BoxLayout({
            style_class: 'di-hud-view',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            visible: false,
        });
        this.add_child(this._hudView);

        this._expandedView = new St.BoxLayout({
            style_class: 'di-expanded-view',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            visible: false,
        });
        this.add_child(this._expandedView);

        this._focusView = new St.BoxLayout({
            style_class: 'di-focus-view',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            visible: false,
        });
        this.add_child(this._focusView);
    }

    /**
     * Attach Shell.BlurEffect ONLY to the inset inner panels (_expandedView, _focusView)
     * and never to the outer DynamicIslandWidget (`this`). Because _expandedView/_focusView
     * have an 8px margin, their corner (8,8) sits strictly inside the 26px outer border arc
     * (distance 25.45px < 26px), completely eliminating rectangular blur corners on hover!
     */
    _syncInnerBlurEffects() {
        const blur = this._settings.get_int('blur-intensity');
        syncGlassBlurEffect(this, 0);
        syncGlassBlurEffect(this._compactView, 0);
        syncGlassBlurEffect(this._hudView, 0);
        syncGlassBlurEffect(this._expandedView, this._state === 'expanded' ? blur : 0);
        syncGlassBlurEffect(this._focusView, this._state === 'focus' ? blur : 0);
    }

    _adjustBlurIntensity(delta) {
        const current = this._settings.get_int('blur-intensity');
        const next = clamp(current + delta, 0, 60);
        this._settings.set_int('blur-intensity', next);
        this._syncInnerBlurEffects();
        this._rebuildCurrentView(false);
    }

    _togglePomodoro() {
        if (this._pomodoroRunning) {
            this._pomodoroRunning = false;
            if (this._pomodoroTimerId) {
                this._timers.clear(this._pomodoroTimerId);
                this._pomodoroTimerId = 0;
            }
        } else {
            if (this._pomodoroRemainingSec <= 0)
                this._pomodoroRemainingSec = POMODORO_DEFAULT_SECONDS;
            this._pomodoroRunning = true;
            if (!this._pomodoroTimerId) {
                this._pomodoroTimerId = this._timers.setInterval(1000, () => {
                    if (!this._pomodoroRunning) {
                        this._pomodoroTimerId = 0;
                        return false;
                    }
                    this._pomodoroRemainingSec = Math.max(0, this._pomodoroRemainingSec - 1);
                    if (this._pomodoroRemainingSec === 0) {
                        this._pomodoroRunning = false;
                        this._pomodoroTimerId = 0;
                        this._rebuildCurrentView(false);
                        return false;
                    }
                    if (this._pomodoroLabel && !this._pomodoroLabel.is_destroyed?.())
                        this._pomodoroLabel.text = `⏱ ${formatDurationSeconds(this._pomodoroRemainingSec)}`;
                    else if (this._state === 'compact')
                        this._renderCompact(false);
                    return true;
                });
            }
        }
        this._applySurfaceStyle();
        this._rebuildCurrentView(false);
        if (this._state === 'compact')
            this._updateGeometry(true, false);
    }

    _resetPomodoro() {
        this._pomodoroRunning = false;
        if (this._pomodoroTimerId) {
            this._timers.clear(this._pomodoroTimerId);
            this._pomodoroTimerId = 0;
        }
        this._pomodoroRemainingSec = POMODORO_DEFAULT_SECONDS;
        this._applySurfaceStyle();
        this._rebuildCurrentView(false);
    }

    _copyCurrentTrackOrStatus() {
        try {
            const media = this._mpris.getState();
            const pulse = readSystemPulse();
            const text = media.hasPlayer && media.title
                ? `${media.title} — ${media.artist || media.appLabel}`
                : `GNOME Dynamic Island · RAM ${pulse.ramPercent}% · Load ${pulse.loadAvg}`;
            const clipboard = St.Clipboard.get_default?.();
            if (clipboard && St.ClipboardType) {
                clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            }
            this._copiedFlash = true;
            if (this._copiedTimerId)
                this._timers.clear(this._copiedTimerId);
            this._copiedTimerId = this._timers.setTimeout(1500, () => {
                this._copiedTimerId = 0;
                this._copiedFlash = false;
                if (!this._draggingSlider)
                    this._rebuildCurrentView(false);
            });
            this._rebuildCurrentView(false);
        } catch (err) {
            console.error('[DynamicIsland] Clipboard copy error:', err);
        }
    }

    /**
     * Creates an St.Button with can_focus: false (so GNOME Shell never draws a rectangular
     * focus box on hover/click) and stops event propagation to the root drag handler.
     */
    _makeButton(props, onClick) {
        const btn = new St.Button({
            reactive: true,
            can_focus: false,
            track_hover: true,
            ...props,
        });

        if (typeof onClick === 'function') {
            let lastFireUs = 0;
            const fireOnce = () => {
                const nowUs = GLib.get_monotonic_time();
                if (nowUs - lastFireUs < 180_000)
                    return;
                lastFireUs = nowUs;
                try {
                    onClick();
                } catch (err) {
                    console.error('[DynamicIsland] Button action error:', err);
                }
            };

            btn.connect('button-press-event', (_actor, event) => {
                if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                    return Clutter.EVENT_PROPAGATE;
                this._endDrag(false);
                return Clutter.EVENT_STOP;
            });

            btn.connect('button-release-event', (_actor, event) => {
                if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                    return Clutter.EVENT_PROPAGATE;
                fireOnce();
                return Clutter.EVENT_STOP;
            });

            btn.connect('clicked', () => {
                fireOnce();
            });
        }

        return btn;
    }

    _isInteractiveChild(actor) {
        let cur = actor;
        while (cur && cur !== this) {
            if (cur instanceof St.Button || cur instanceof Slider)
                return true;
            cur = cur.get_parent?.() ?? null;
        }
        return false;
    }

    _getMonitor() {
        const monitors = Main.layoutManager?.monitors;
        return monitors?.[this._monitorIndex] ?? Main.layoutManager?.primaryMonitor ?? {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
    }

    _endDrag(savePosition = false) {
        if (this._dragStageSignalId) {
            try {
                global.stage.disconnect(this._dragStageSignalId);
            } catch {
                // Ignore if stage already disposed
            }
            this._dragStageSignalId = 0;
        }

        if (savePosition && this._isDragging) {
            try {
                const monitor = this._getMonitor();
                const [ax, ay] = this.get_transformed_position();
                const relX = Math.max(0, Math.round(ax - monitor.x));
                const relY = Math.max(0, Math.round(ay - monitor.y));
                this._settings.set_int('custom-x', relX);
                this._settings.set_int('custom-y', relY);
                this._settings.set_boolean('use-custom-position', true);
            } catch (err) {
                console.error('[DynamicIsland] Failed saving dragged position:', err);
            }
        }

        this._dragPending = false;
        this._isDragging = false;
    }

    _wireInteractions() {
        this._signals.connect(this, 'button-press-event', (_actor, event) => {
            try {
                const button = event.get_button();
                if (button === Clutter.BUTTON_SECONDARY) {
                    this._clearAutoCollapse();
                    this._onOpenPreferences?.();
                    return Clutter.EVENT_STOP;
                }

                if (button !== Clutter.BUTTON_PRIMARY)
                    return Clutter.EVENT_PROPAGATE;

                // Never intercept clicks on interactive buttons or sliders inside expanded/focus/hud views
                if (this._state !== 'compact' && this._isInteractiveChild(event.get_source()))
                    return Clutter.EVENT_PROPAGATE;

                this._endDrag(false);

                const [px, py] = event.get_coords();
                const [ax, ay] = this.get_transformed_position();
                this._dragPending = true;
                this._isDragging = false;
                this._dragStartX = px;
                this._dragStartY = py;
                this._dragOriginX = ax;
                this._dragOriginY = ay;

                // Connect captured-event listener without grabbing the stage so other extensions never freeze
                this._dragStageSignalId = global.stage.connect('captured-event', (_stage, ev) => {
                    try {
                        if (!this._dragPending) {
                            this._endDrag(false);
                            return Clutter.EVENT_PROPAGATE;
                        }

                        const type = ev.type();
                        if (type === Clutter.EventType.MOTION) {
                            const modState = typeof ev.get_state === 'function'
                                ? ev.get_state()
                                : Clutter.ModifierType.BUTTON1_MASK;

                            if ((modState & Clutter.ModifierType.BUTTON1_MASK) === 0) {
                                this._endDrag(this._isDragging);
                                return Clutter.EVENT_PROPAGATE;
                            }

                            const [mx, my] = ev.get_coords();
                            const dx = mx - this._dragStartX;
                            const dy = my - this._dragStartY;

                            if (!this._isDragging && Math.hypot(dx, dy) >= 6) {
                                this._isDragging = true;
                                this._clearAutoCollapse();
                                this.remove_all_transitions();
                            }

                            if (this._isDragging) {
                                const monitor = this._getMonitor();
                                const [, , w, h] = this._getTargetBounds();
                                const minX = monitor.x + 8;
                                const maxX = Math.max(minX, monitor.x + monitor.width - w - 8);
                                const minY = monitor.y + 4;
                                const maxY = Math.max(minY, monitor.y + monitor.height - h - 8);
                                const nx = clamp(Math.round(this._dragOriginX + dx), minX, maxX);
                                const ny = clamp(Math.round(this._dragOriginY + dy), minY, maxY);
                                this.set_position(nx, ny);
                                return Clutter.EVENT_STOP;
                            }

                            return Clutter.EVENT_PROPAGATE;
                        }

                        if (type === Clutter.EventType.BUTTON_RELEASE) {
                            if (ev.get_button() !== Clutter.BUTTON_PRIMARY)
                                return Clutter.EVENT_PROPAGATE;

                            const wasDragging = this._isDragging;
                            this._endDrag(wasDragging);

                            if (!wasDragging) {
                                if (this._state === 'compact' || this._state === 'hud') {
                                    this._clearAutoCollapse();
                                    this._mpris.rescan?.();
                                    this.setState('expanded');
                                } else if (this._state === 'expanded' || this._state === 'focus') {
                                    // Tapping empty/header background on expanded island minimizes it back to compact
                                    if (!this._isInteractiveChild(ev.get_source())) {
                                        this._clearAutoCollapse();
                                        this.setState('compact');
                                    }
                                }
                            } else if (this._state === 'hud' && !this.hover) {
                                this._scheduleAutoCollapse();
                            }
                            return Clutter.EVENT_PROPAGATE;
                        }

                        if (type === Clutter.EventType.KEY_PRESS && ev.get_key_symbol() === Clutter.KEY_Escape) {
                            this._endDrag(false);
                            return Clutter.EVENT_PROPAGATE;
                        }

                        return Clutter.EVENT_PROPAGATE;
                    } catch (err) {
                        console.error('[DynamicIsland] Drag event error:', err);
                        this._endDrag(false);
                        return Clutter.EVENT_PROPAGATE;
                    }
                });

                return Clutter.EVENT_STOP;
            } catch (err) {
                console.error('[DynamicIsland] button-press-event error:', err);
                this._endDrag(false);
                return Clutter.EVENT_PROPAGATE;
            }
        });

        this._signals.connect(this, 'notify::hover', () => {
            if (this._isDragging)
                return;
            if (this.hover && this._state === 'hud')
                this._clearAutoCollapse();
            else if (!this.hover && this._state === 'hud')
                this._scheduleAutoCollapse();
        });

        this._signals.connect(this, 'key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape && this._state !== 'compact') {
                this._clearAutoCollapse();
                this.setState('compact');
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._signals.connect(global.stage, 'button-press-event', (_stage, event) => {
            if (this._state === 'compact' || this._draggingSlider || this._isDragging || this._dragPending)
                return Clutter.EVENT_PROPAGATE;

            try {
                const [px, py] = event.get_coords();
                const [ax, ay] = this.get_transformed_position();
                const [aw, ah] = this.get_transformed_size();

                const inside = px >= ax && px <= ax + aw && py >= ay && py <= ay + ah;
                if (!inside) {
                    this._clearAutoCollapse();
                    this.setState('compact');
                }
            } catch {
                // Ignore
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    setMonitorIndex(monitorIndex) {
        this._monitorIndex = monitorIndex;
        this._updateGeometry(false);
    }

    syncPositionFromSettings() {
        if (!this._isDragging)
            this._updateGeometry(false);
    }

    _clearAutoCollapse() {
        if (this._autoCollapseTimerId) {
            this._timers.clear(this._autoCollapseTimerId);
            this._autoCollapseTimerId = 0;
        }
    }

    _scheduleAutoCollapse() {
        this._clearAutoCollapse();
        const delayMs = clamp(this._settings.get_int('auto-collapse-delay'), 1200, 8000);
        this._autoCollapseTimerId = this._timers.setTimeout(delayMs, () => {
            this._autoCollapseTimerId = 0;
            if (this._state === 'hud' && !this.hover && !this._draggingSlider)
                this.setState('compact');
        });
    }

    setState(nextState, focusModule = null) {
        if (focusModule)
            this._focusModule = focusModule;

        if (nextState !== 'hud')
            this._clearAutoCollapse();

        const wasCompact = this._state === 'compact';
        const changed = this._state !== nextState || Boolean(focusModule);
        this._state = nextState;

        this.remove_style_class_name('di-state-compact');
        this.remove_style_class_name('di-state-expanded');
        this.remove_style_class_name('di-state-focus');
        this.remove_style_class_name('di-state-hud');
        this.add_style_class_name(`di-state-${nextState}`);

        this._compactView.visible = nextState === 'compact';
        this._hudView.visible = nextState === 'hud';
        this._expandedView.visible = nextState === 'expanded';
        this._focusView.visible = nextState === 'focus';

        this._syncInnerBlurEffects();
        this._applySurfaceStyle();
        try {
            this._rebuildCurrentView();
        } catch (err) {
            console.error('[DynamicIsland] _rebuildCurrentView error:', err);
        }
        this._updateGeometry(true, wasCompact && nextState !== 'compact');

        if (changed) {
            const targetActor = nextState === 'compact'
                ? this._compactView
                : nextState === 'hud'
                    ? this._hudView
                    : nextState === 'expanded'
                        ? this._expandedView
                        : this._focusView;
            this._anim.fadeIn(targetActor);
        }
    }

    applyPreferences() {
        this._anim.setSpeedPreset(this._settings.get_string('animation-speed'));
        this._syncInnerBlurEffects();
        this._applySurfaceStyle();
        this._rebuildCurrentView();
        this._updateGeometry(true, false);
    }

    _isClassicIdleMode() {
        const media = this._mpris.getState();
        const showMedia = this._settings.get_boolean('enable-media') &&
            media.hasPlayer &&
            this._settings.get_string('compact-appearance') !== 'system-pill';
        return !showMedia && !this._pomodoroRunning;
    }

    _applySurfaceStyle() {
        try {
            const media = this._mpris.getState();
            const songTheme = (this._settings.get_boolean('enable-media') && media.hasPlayer)
                ? media.theme
                : null;
            const style = buildSurfaceStyle({
                backgroundColor: this._settings.get_string('background-color'),
                backgroundOpacity: this._settings.get_double('background-opacity'),
                cornerRadius: this._settings.get_int('corner-radius'),
                borderOpacity: this._settings.get_double('border-opacity'),
                state: this._state,
                songTheme,
                isClassicIdle: this._isClassicIdleMode(),
            });
            this.set_style(style);
        } catch (err) {
            console.error('[DynamicIsland] _applySurfaceStyle error:', err);
        }
    }

    _getTargetBounds() {
        const monitor = this._getMonitor();
        const topOffset = this._settings.get_int('top-offset');
        const compactW = this._settings.get_int('compact-width');
        const compactH = this._settings.get_int('compact-height');
        const expandedW = this._settings.get_int('expanded-width');
        const expandedH = this._settings.get_int('expanded-height');

        const media = this._mpris.getState();
        const hasPlayingMedia = this._settings.get_boolean('enable-media') &&
            media.hasPlayer &&
            this._settings.get_string('compact-appearance') !== 'system-pill';

        let width = hasPlayingMedia
            ? compactW
            : this._pomodoroRunning
                ? 156
                : 132;
        let height = hasPlayingMedia
            ? Math.max(34, compactH)
            : 30;

        if (this._state === 'hud') {
            width = this._hudKind === 'music' ? clamp(Math.round(expandedW * 0.78), 310, 390) : 268;
            height = this._hudKind === 'music' ? 76 : 48;
        } else if (this._state === 'expanded') {
            const layoutMode = this._settings.get_string('expanded-appearance');
            width = clamp(Math.max(460, expandedW), 380, monitor.width - 32);

            let naturalH = 0;
            try {
                const [, natH] = this._expandedView.get_preferred_height(width - 16);
                naturalH = natH || 0;
            } catch {
                naturalH = 0;
            }

            const baseTargetH = layoutMode === 'controls-compact'
                ? Math.max(340, Math.round(expandedH * 0.84))
                : Math.max(432, expandedH);
            height = clamp(Math.max(baseTargetH, naturalH + 22), 260, monitor.height - 32);
        } else if (this._state === 'focus') {
            width = clamp(Math.max(460, Math.round(expandedW * 1.02)), 380, monitor.width - 32);

            let naturalH = 0;
            try {
                const [, natH] = this._focusView.get_preferred_height(width - 16);
                naturalH = natH || 0;
            } catch {
                naturalH = 0;
            }

            height = clamp(Math.max(Math.round(expandedH * 0.92), naturalH + 22, 360), 260, monitor.height - 32);
        }

        return [monitor, topOffset, width, height];
    }

    _getTargetGeometry() {
        const [monitor, topOffset, width, height] = this._getTargetBounds();
        const margin = 16;

        if (this._settings.get_boolean('use-custom-position')) {
            const savedX = this._settings.get_int('custom-x');
            const savedY = this._settings.get_int('custom-y');
            if (savedX >= 0 && savedY >= 0) {
                const minX = monitor.x + 8;
                const maxX = Math.max(minX, monitor.x + monitor.width - width - 8);
                const minY = monitor.y + 4;
                const maxY = Math.max(minY, monitor.y + monitor.height - height - 8);
                return {
                    x: clamp(monitor.x + savedX, minX, maxX),
                    y: clamp(monitor.y + savedY, minY, maxY),
                    width,
                    height,
                };
            }
        }

        const position = this._settings.get_string('island-position');
        let x = monitor.x + Math.round((monitor.width - width) / 2);
        if (position === 'top-left')
            x = monitor.x + margin;
        else if (position === 'top-right')
            x = monitor.x + monitor.width - width - margin;

        const y = monitor.y + topOffset;
        return {x, y, width, height};
    }

    _updateGeometry(animate, spring = false) {
        const rect = this._getTargetGeometry();
        if (animate && this.get_parent()) {
            this._anim.morphGeometry(this, {...rect, spring});
        } else {
            this.remove_all_transitions();
            this.set_position(rect.x, rect.y);
            this.set_size(rect.width, rect.height);
        }
    }

    handleMprisUpdate(mediaState, isPositionTick = false) {
        // When only playback position ticks, update progress labels/slider in-place without destroying buttons
        if (isPositionTick && !this._draggingSlider) {
            if (this._posLabel && !this._posLabel.is_destroyed?.())
                this._posLabel.text = formatDurationSeconds(mediaState.positionSeconds);
            if (this._lenLabel && !this._lenLabel.is_destroyed?.())
                this._lenLabel.text = formatDurationSeconds(mediaState.lengthSeconds);
            if (this._seekSlider && !this._seekSlider.is_destroyed?.() && mediaState.lengthSeconds > 0)
                this._seekSlider.value = clamp(mediaState.positionSeconds / mediaState.lengthSeconds, 0, 1);
            return;
        }

        const hasPlayerChanged = Boolean(mediaState.hasPlayer) !== this._lastHasPlayer;
        this._lastHasPlayer = Boolean(mediaState.hasPlayer);

        const trackKey = mediaState.hasPlayer
            ? `${mediaState.activeBusName}:${mediaState.title}:${mediaState.artist}`
            : '';
        const trackChanged = Boolean(trackKey && trackKey !== this._lastTrackKey);
        const justStarted = mediaState.status === 'Playing' && this._lastPlaybackStatus !== 'Playing';

        // Always update surface style so dynamic song theme colors or classic black idle capsule reflect immediately
        this._applySurfaceStyle();

        if (this._settings.get_boolean('auto-expand-on-music') &&
            this._settings.get_boolean('enable-media') &&
            mediaState.hasPlayer &&
            mediaState.status === 'Playing' &&
            (justStarted || trackChanged) &&
            (this._state === 'compact' || this._state === 'hud')) {
            this._hudKind = 'music';
            this.setState('hud');
            this._scheduleAutoCollapse();
        } else if (hasPlayerChanged && this._state === 'compact') {
            this._updateGeometry(true, false);
        }

        this._lastTrackKey = trackKey;
        this._lastPlaybackStatus = mediaState.status;

        if (!this._draggingSlider)
            this._rebuildCurrentView(trackChanged);
    }

    handleAudioUpdate(audioState) {
        const volumeKey = `${audioState.volumePercent}:${audioState.isMuted}`;
        if (this._lastVolumeKey !== null &&
            volumeKey !== this._lastVolumeKey &&
            this._settings.get_boolean('auto-expand-on-volume') &&
            (this._state === 'compact' || (this._state === 'hud' && this._hudKind === 'volume'))) {
            this._hudKind = 'volume';
            this.setState('hud');
            this._scheduleAutoCollapse();
        }
        this._lastVolumeKey = volumeKey;

        if (!this._draggingSlider && this._state !== 'compact')
            this._rebuildCurrentView();
    }

    handleBrightnessUpdate(brightnessState) {
        if (!brightnessState.supported) {
            this._lastBrightnessKey = null;
            if (!this._draggingSlider && this._state !== 'compact')
                this._rebuildCurrentView();
            return;
        }

        const brightKey = `${brightnessState.percent}`;
        if (this._lastBrightnessKey !== null &&
            brightKey !== this._lastBrightnessKey &&
            this._settings.get_boolean('auto-expand-on-brightness') &&
            (this._state === 'compact' || (this._state === 'hud' && this._hudKind === 'brightness'))) {
            this._hudKind = 'brightness';
            this.setState('hud');
            this._scheduleAutoCollapse();
        }
        this._lastBrightnessKey = brightKey;

        if (!this._draggingSlider && this._state !== 'compact')
            this._rebuildCurrentView();
    }

    refreshAll() {
        if (!this._draggingSlider) {
            this._applySurfaceStyle();
            this._rebuildCurrentView();
            if (this._state === 'expanded' || this._state === 'focus')
                this._updateGeometry(false, false);
        }
    }

    _rebuildCurrentView(animateArtwork = false) {
        this._seekSlider = null;
        this._posLabel = null;
        this._lenLabel = null;
        this._pomodoroLabel = null;
        this._syncEqualizerTimer();

        if (this._state === 'compact')
            this._renderCompact(animateArtwork);
        else if (this._state === 'hud')
            this._renderHud(animateArtwork);
        else if (this._state === 'expanded')
            this._renderExpanded(animateArtwork);
        else
            this._renderFocus(animateArtwork);
    }

    _syncEqualizerTimer() {
        const media = this._mpris.getState();
        const shouldAnimate = this._state === 'compact' &&
            this._settings.get_boolean('enable-media') &&
            media.hasPlayer &&
            media.status === 'Playing' &&
            this._settings.get_string('compact-appearance') !== 'system-pill';

        if (shouldAnimate && !this._eqTimerId) {
            this._eqTimerId = this._timers.setInterval(360, () => {
                if (this._state !== 'compact' || this._eqBars.length === 0) {
                    this._eqTimerId = 0;
                    return false;
                }
                this._eqStep = (this._eqStep + 1) % EQ_BAR_PATTERNS.length;
                const pattern = EQ_BAR_PATTERNS[this._eqStep];
                this._eqBars.forEach((bar, idx) => {
                    if (bar && !bar.is_destroyed?.())
                        this._anim.easeEqualizerBar(bar, pattern[idx] ?? 8);
                });
                return true;
            });
        } else if (!shouldAnimate && this._eqTimerId) {
            this._timers.clear(this._eqTimerId);
            this._eqTimerId = 0;
        }
    }

    _resolveArtworkFile(media) {
        if (!media || !this._settings.get_boolean('show-album-artwork'))
            return null;

        try {
            if (media.localArtPath && GLib.file_test(media.localArtPath, GLib.FileTest.EXISTS))
                return Gio.File.new_for_path(media.localArtPath);

            const artUrl = String(media.artUrl || '').trim();
            if (!artUrl)
                return null;

            if (artUrl.startsWith('file://')) {
                const file = Gio.File.new_for_uri(artUrl);
                const path = file.get_path();
                if (path && GLib.file_test(path, GLib.FileTest.EXISTS))
                    return file;
            } else if (artUrl.startsWith('/') && GLib.file_test(artUrl, GLib.FileTest.EXISTS)) {
                return Gio.File.new_for_path(artUrl);
            }
        } catch {
            // Fall back to symbolic icon
        }
        return null;
    }

    /**
     * Build a circular song banner icon widget from local/cached MPRIS artwork
     * or a themed fallback music icon while artwork is downloading.
     */
    _createArtworkIcon(media, size, fallbackIconName = 'audio-x-generic-symbolic', animate = false) {
        const file = this._resolveArtworkFile(media);
        let widget = null;

        if (file) {
            try {
                const path = file.get_path();
                if (path) {
                    const uri = GLib.filename_to_uri(path, null);
                    widget = new St.Bin({
                        style_class: 'di-artwork-banner',
                        style: [
                            `width: ${size}px;`,
                            `height: ${size}px;`,
                            `border-radius: 999px;`,
                            `background-image: url("${uri}");`,
                            `background-size: cover;`,
                            `background-position: center;`,
                        ].join(' '),
                    });
                } else {
                    widget = new St.Icon({
                        gicon: new Gio.FileIcon({file}),
                        icon_size: size,
                        style_class: 'di-artwork-icon',
                    });
                }
            } catch {
                widget = null;
            }
        }

        if (!widget) {
            const accent = media?.theme?.accent;
            const iconStyle = accent
                ? `color: rgb(${accent.r}, ${accent.g}, ${accent.b});`
                : '';
            widget = new St.Icon({
                icon_name: fallbackIconName,
                icon_size: Math.max(13, Math.round(size * 0.54)),
                style_class: 'di-artwork-fallback',
                style: iconStyle,
            });
        }

        if (animate)
            this._anim.animateArtworkTransition(widget);
        return widget;
    }

    _buildEqualizerWidget(isPlaying, theme = null) {
        const eqBox = new St.BoxLayout({
            style_class: 'di-eq-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._eqBars = [];
        const heights = isPlaying ? EQ_BAR_PATTERNS[this._eqStep] : [5, 9, 6, 8];
        const barColorStyle = (isPlaying && theme?.active)
            ? `background-color: rgb(${theme.accent.r}, ${theme.accent.g}, ${theme.accent.b});`
            : '';

        for (const h of heights) {
            const bar = new St.Widget({
                style_class: `di-eq-bar ${isPlaying ? 'di-eq-bar-active' : 'di-eq-bar-paused'}`,
                style: barColorStyle,
                width: 2,
                height: h,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._eqBars.push(bar);
            eqBox.add_child(bar);
        }
        return eqBox;
    }

    _renderCompact(animateArtwork = false) {
        this._compactView.destroy_all_children();
        this._eqBars = [];
        this._compactView.style = `padding: 0 ${COMPACT_CONTENT_PADDING}px;`;

        try {
            const media = this._mpris.getState();
            const appearance = this._settings.get_string('compact-appearance');
            const showMedia = this._settings.get_boolean('enable-media') && media.hasPlayer && appearance !== 'system-pill';

            if (showMedia) {
                const acc = media.theme?.accent ?? {r: 56, g: 189, b: 248};
                const artBox = new St.Bin({
                    style_class: 'di-compact-art-frame',
                    style: `border-color: rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.55); background-color: rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.20);`,
                    y_align: Clutter.ActorAlign.CENTER,
                    child: this._createArtworkIcon(media, 22, 'audio-x-generic-symbolic', animateArtwork),
                });
                this._compactView.add_child(artBox);

                const titleLabel = new St.Label({
                    text: media.title || media.appLabel || 'Playing',
                    style_class: 'di-compact-title',
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                this._compactView.add_child(titleLabel);

                const eqBubble = new St.Bin({
                    style_class: 'di-compact-right-pill',
                    style: `background-color: rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.18); border-color: rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.42);`,
                    y_align: Clutter.ActorAlign.CENTER,
                    child: this._buildEqualizerWidget(media.status === 'Playing', media.theme),
                });
                this._compactView.add_child(eqBubble);
                return;
            }

            // If Pomodoro Focus Timer is running while collapsed, show live countdown pill
            if (this._pomodoroRunning) {
                const timerLabel = new St.Label({
                    text: `⏱ ${formatDurationSeconds(this._pomodoroRemainingSec)}`,
                    style_class: 'di-compact-title',
                    x_expand: true,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._pomodoroLabel = timerLabel;
                this._compactView.add_child(timerLabel);
                return;
            }

            // Classic Black Apple Dynamic Island Hardware Capsule when idle (no music playing)
            this._compactView.style = 'padding: 0 11px;';
            const sensorDot = new St.Widget({
                style_class: 'di-classic-sensor',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._compactView.add_child(sensorDot);

            const centerSpacer = new St.Widget({
                x_expand: true,
                y_expand: true,
            });
            this._compactView.add_child(centerSpacer);

            const cameraLens = new St.Bin({
                style_class: 'di-classic-lens',
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
                child: new St.Widget({
                    style_class: 'di-classic-lens-core',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                }),
            });
            this._compactView.add_child(cameraLens);
        } catch (err) {
            console.error('[DynamicIsland] _renderCompact fallback:', err);
        }
    }

    _renderHud(animateArtwork = false) {
        this._hudView.destroy_all_children();

        try {
            if (this._hudKind === 'music') {
                const media = this._mpris.getState();
                const acc = media.theme?.accent ?? {r: 56, g: 189, b: 248};
                const row = new St.BoxLayout({style_class: 'di-hud-music-row', x_expand: true, y_expand: true});

                const art = new St.Bin({
                    style_class: 'di-art-button',
                    style: `background-color: rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.22); border-color: rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.50);`,
                    child: this._createArtworkIcon(media, 44, 'audio-x-generic-symbolic', animateArtwork),
                });
                row.add_child(art);

                const meta = new St.BoxLayout({
                    orientation: Clutter.Orientation.VERTICAL,
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                meta.add_child(new St.Label({text: media.title || 'Playing', style_class: 'di-track-title'}));
                meta.add_child(new St.Label({
                    text: `${media.artist} · ${media.appLabel}`,
                    style_class: 'di-track-subtitle',
                }));
                row.add_child(meta);

                const playBtn = this._makeButton({
                    style_class: 'di-primary-circle-btn',
                    style: `background-color: rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.90); border-color: rgba(255, 255, 255, 0.50);`,
                    y_align: Clutter.ActorAlign.CENTER,
                    child: new St.Icon({
                        icon_name: media.status === 'Playing'
                            ? 'media-playback-pause-symbolic'
                            : 'media-playback-start-symbolic',
                        icon_size: 15,
                    }),
                }, () => this._mpris.playPause());
                row.add_child(playBtn);

                this._hudView.add_child(row);
                return;
            }

            const isVol = this._hudKind === 'volume';
            const audio = this._audio.getState();
            const bright = this._brightness.getState();

            const pct = isVol ? (audio.isMuted ? 0 : audio.volumePercent) : bright.percent;
            const iconName = isVol
                ? (audio.isMuted ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic')
                : 'display-brightness-symbolic';

            const hudRow = new St.BoxLayout({style_class: 'di-hud-indicator-row', x_expand: true, y_expand: true});
            const bubbleIcon = new St.Bin({
                style_class: 'di-compact-bubble',
                y_align: Clutter.ActorAlign.CENTER,
                child: new St.Icon({icon_name: iconName, icon_size: 14}),
            });
            hudRow.add_child(bubbleIcon);

            const track = new St.Widget({style_class: 'di-progress-track', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            const fill = new St.Widget({style_class: isVol ? 'di-progress-fill' : 'di-brightness-fill'});
            fill.set_width(Math.round((clamp(pct, 0, 100) / 100) * 140));
            track.add_child(fill);
            hudRow.add_child(track);

            hudRow.add_child(new St.Label({
                text: isVol && audio.isMuted ? 'Muted' : `${pct}%`,
                style_class: 'di-percent-label',
                y_align: Clutter.ActorAlign.CENTER,
            }));

            this._hudView.add_child(hudRow);
        } catch (err) {
            console.error('[DynamicIsland] _renderHud error:', err);
        }
    }

    _buildHeaderBar(title, showBack = false) {
        const media = this._mpris.getState();
        const hasSong = this._settings.get_boolean('enable-media') && media.hasPlayer;
        const acc = (hasSong && media.theme?.active) ? media.theme.accent : {r: 56, g: 189, b: 248};

        const header = new St.BoxLayout({
            style_class: 'di-panel-header',
            x_expand: true,
        });

        if (showBack) {
            const backBtn = this._makeButton({
                style_class: 'di-icon-btn',
                child: new St.Icon({icon_name: 'go-previous-symbolic', icon_size: 15}),
            }, () => this.setState('expanded'));
            header.add_child(backBtn);
        } else {
            const badgeChild = hasSong
                ? this._createArtworkIcon(media, 22, 'audio-x-generic-symbolic', false)
                : new St.Icon({icon_name: 'audio-x-generic-symbolic', icon_size: 13});

            const badge = new St.Bin({
                style_class: 'di-header-badge',
                style: `background-color: rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.24); border-color: rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.50);`,
                y_align: Clutter.ActorAlign.CENTER,
                child: badgeChild,
            });
            header.add_child(badge);
        }

        header.add_child(new St.Label({
            text: title,
            style_class: 'di-panel-heading',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const prefsBtn = this._makeButton({
            style_class: 'di-icon-btn',
            child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 15}),
        }, () => {
            this.setState('compact');
            this._onOpenPreferences?.();
        });
        header.add_child(prefsBtn);

        const collapseBtn = this._makeButton({
            style_class: 'di-icon-btn',
            child: new St.Icon({icon_name: 'window-minimize-symbolic', icon_size: 15}),
        }, () => this.setState('compact'));
        header.add_child(collapseBtn);

        return header;
    }

    _renderExpanded(animateArtwork = false) {
        this._expandedView.destroy_all_children();
        this._expandedView.add_child(this._buildHeaderBar('Dynamic Island', false));

        try {
            const layoutMode = this._settings.get_string('expanded-appearance');

            if (this._settings.get_boolean('enable-media'))
                this._expandedView.add_child(this._buildMediaSection(animateArtwork));

            if (this._settings.get_boolean('enable-audio'))
                this._expandedView.add_child(this._buildAudioRow());

            if (this._settings.get_boolean('enable-brightness') && layoutMode !== 'media-focused')
                this._expandedView.add_child(this._buildBrightnessRow());

            if (this._settings.get_boolean('enable-quick-settings') && layoutMode === 'full')
                this._expandedView.add_child(this._buildQuickSettingsGrid());

            if (layoutMode === 'full')
                this._expandedView.add_child(this._buildUtilityBar());
        } catch (err) {
            console.error('[DynamicIsland] _renderExpanded error:', err);
        }
    }

    _buildUtilityBar() {
        const row = new St.BoxLayout({
            style_class: 'di-utility-row',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // 1. Interactive Pomodoro Focus Timer button
        const pomoBtn = this._makeButton({
            style_class: `di-utility-pill ${this._pomodoroRunning ? 'di-utility-pill-active' : ''}`,
            x_expand: true,
            child: new St.Label({
                text: `⏱ ${formatDurationSeconds(this._pomodoroRemainingSec)}`,
                x_align: Clutter.ActorAlign.CENTER,
            }),
        }, () => this._togglePomodoro());
        this._pomodoroLabel = pomoBtn.get_child();
        row.add_child(pomoBtn);

        // 2. Live Blur Decrease / Increase Tuner (- / Blur XXpx / +)
        const blurVal = this._settings.get_int('blur-intensity');
        const blurBox = new St.BoxLayout({
            style_class: 'di-blur-stepper-box',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const blurDecBtn = this._makeButton({
            style_class: 'di-blur-step-btn',
            child: new St.Label({text: '−', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}),
        }, () => this._adjustBlurIntensity(-4));
        blurBox.add_child(blurDecBtn);

        blurBox.add_child(new St.Label({
            text: `Blur ${blurVal}px`,
            style_class: 'di-blur-label',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const blurIncBtn = this._makeButton({
            style_class: 'di-blur-step-btn',
            child: new St.Label({text: '+', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}),
        }, () => this._adjustBlurIntensity(4));
        blurBox.add_child(blurIncBtn);
        row.add_child(blurBox);

        // 3. One-Click Copy Song / Clipboard Stash button
        const copyBtn = this._makeButton({
            style_class: `di-utility-pill ${this._copiedFlash ? 'di-utility-pill-active' : ''}`,
            child: new St.Label({
                text: this._copiedFlash ? '✓ Copied' : '📋 Copy',
                x_align: Clutter.ActorAlign.CENTER,
            }),
        }, () => this._copyCurrentTrackOrStatus());
        row.add_child(copyBtn);

        // 4. Live Ubuntu RAM / System Pulse Monitor badge
        const pulse = readSystemPulse();
        const pulseBtn = this._makeButton({
            style_class: 'di-utility-pill',
            child: new St.Label({
                text: `⚡ ${pulse.ramPercent}%`,
                x_align: Clutter.ActorAlign.CENTER,
            }),
        }, () => this.setState('focus', 'quickSettings'));
        row.add_child(pulseBtn);

        return row;
    }

    _buildMediaSection(animateArtwork = false) {
        const media = this._mpris.getState();
        const theme = media.theme;
        const acc = theme?.active ? theme.accent : {r: 56, g: 189, b: 248};
        const cardTint = theme?.active ? theme.cardTint : {r: 15, g: 23, b: 42};

        const cardStyle = theme?.active
            ? `background-color: rgba(${cardTint.r}, ${cardTint.g}, ${cardTint.b}, 0.28); border-color: rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.40);`
            : '';

        const card = new St.BoxLayout({
            style_class: 'di-section-box di-media-card',
            style: cardStyle,
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });

        const topRow = new St.BoxLayout({x_expand: true, style_class: 'di-media-row'});

        const artBtn = this._makeButton({
            style_class: 'di-art-button',
            style: `background-color: rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.22); border-color: rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.52);`,
            y_align: Clutter.ActorAlign.CENTER,
            child: this._createArtworkIcon(media, 44, 'audio-x-generic-symbolic', animateArtwork),
        }, () => {
            this._mpris.rescan?.();
            this.setState('focus', 'media');
        });
        topRow.add_child(artBtn);

        const metaCol = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'di-media-meta',
        });

        const titleText = media.hasPlayer ? media.title : 'Music & Media';
        const subtitleText = media.hasPlayer
            ? `${media.artist} · ${media.appLabel}`
            : 'Play in Spotify or browser to sync';

        const titleBtn = this._makeButton({
            style_class: 'di-title-btn',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            child: new St.Label({text: titleText, style_class: 'di-track-title'}),
        }, () => {
            this._mpris.rescan?.();
            this.setState('focus', 'media');
        });
        metaCol.add_child(titleBtn);

        metaCol.add_child(new St.Label({
            text: subtitleText,
            style_class: 'di-track-subtitle',
        }));
        topRow.add_child(metaCol);

        const controls = new St.BoxLayout({
            style_class: 'di-media-controls',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const prevBtn = this._makeButton({
            style_class: 'di-icon-btn',
            child: new St.Icon({icon_name: 'media-skip-backward-symbolic', icon_size: 15}),
        }, () => this._mpris.previous());

        const playBtn = this._makeButton({
            style_class: 'di-primary-circle-btn',
            style: `background-color: rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.90); border-color: rgba(255, 255, 255, 0.50);`,
            child: new St.Icon({
                icon_name: media.status === 'Playing'
                    ? 'media-playback-pause-symbolic'
                    : 'media-playback-start-symbolic',
                icon_size: 16,
            }),
        }, () => this._mpris.playPause());

        const nextBtn = this._makeButton({
            style_class: 'di-icon-btn',
            child: new St.Icon({icon_name: 'media-skip-forward-symbolic', icon_size: 15}),
        }, () => this._mpris.next());

        controls.add_child(prevBtn);
        controls.add_child(playBtn);
        controls.add_child(nextBtn);
        topRow.add_child(controls);
        card.add_child(topRow);

        // Interactive playback progress slider
        if (media.hasPlayer && media.lengthSeconds > 0) {
            const progRow = new St.BoxLayout({x_expand: true, style_class: 'di-progress-row'});
            this._posLabel = new St.Label({
                text: formatDurationSeconds(media.positionSeconds),
                style_class: 'di-time-label',
                y_align: Clutter.ActorAlign.CENTER,
            });
            progRow.add_child(this._posLabel);

            const ratio = clamp(media.positionSeconds / media.lengthSeconds, 0, 1);
            const seekSlider = new Slider(ratio);
            seekSlider.x_expand = true;
            seekSlider.reactive = media.canSeek;
            seekSlider.connect('drag-begin', () => {
                this._draggingSlider = true;
            });
            seekSlider.connect('drag-end', () => {
                this._draggingSlider = false;
                this._mpris.seekToSeconds(seekSlider.value * media.lengthSeconds);
            });
            this._seekSlider = seekSlider;
            progRow.add_child(seekSlider);

            this._lenLabel = new St.Label({
                text: formatDurationSeconds(media.lengthSeconds),
                style_class: 'di-time-label',
                y_align: Clutter.ActorAlign.CENTER,
            });
            progRow.add_child(this._lenLabel);
            card.add_child(progRow);
        }

        return card;
    }

    _buildAudioRow() {
        const audio = this._audio.getState();
        const box = new St.BoxLayout({style_class: 'di-section-box di-slider-row', x_expand: true});

        const muteBtn = this._makeButton({
            style_class: `di-icon-btn ${audio.isMuted ? 'di-btn-alert' : ''}`,
            child: new St.Icon({
                icon_name: audio.isMuted ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic',
                icon_size: 15,
            }),
        }, () => this._audio.toggleMute());
        box.add_child(muteBtn);

        const slider = new Slider((audio.isMuted ? 0 : audio.volumePercent) / 100);
        slider.x_expand = true;
        slider.connect('drag-begin', () => {
            this._draggingSlider = true;
        });
        slider.connect('drag-end', () => {
            this._draggingSlider = false;
            this._audio.setVolumePercent(Math.round(slider.value * 100));
        });
        slider.connect('notify::value', () => {
            if (this._draggingSlider)
                this._audio.setVolumePercent(Math.round(slider.value * 100));
        });
        box.add_child(slider);

        box.add_child(new St.Label({
            text: audio.isMuted ? '0%' : `${audio.volumePercent}%`,
            style_class: 'di-percent-label',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const micBtn = this._makeButton({
            style_class: `di-icon-btn ${audio.isMicMuted ? 'di-btn-alert' : ''}`,
            reactive: audio.hasInput,
            child: new St.Icon({
                icon_name: audio.isMicMuted
                    ? 'microphone-sensitivity-muted-symbolic'
                    : 'audio-input-microphone-symbolic',
                icon_size: 15,
            }),
        }, () => this._audio.toggleMicMute());
        box.add_child(micBtn);

        const focusBtn = this._makeButton({
            style_class: 'di-icon-btn',
            child: new St.Icon({icon_name: 'go-next-symbolic', icon_size: 14}),
        }, () => this.setState('focus', 'audio'));
        box.add_child(focusBtn);

        return box;
    }

    _buildBrightnessRow() {
        const bright = this._brightness.getState();
        const box = new St.BoxLayout({style_class: 'di-section-box di-slider-row', x_expand: true});

        const sunBubble = new St.Bin({
            style_class: 'di-row-bubble-icon',
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'display-brightness-symbolic',
                icon_size: 15,
            }),
        });
        box.add_child(sunBubble);

        if (!bright.supported) {
            box.add_child(new St.Label({
                text: 'Brightness unsupported (external display)',
                style_class: 'di-muted-label',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            return box;
        }

        const slider = new Slider(bright.percent / 100);
        slider.x_expand = true;
        slider.connect('drag-begin', () => {
            this._draggingSlider = true;
        });
        slider.connect('drag-end', () => {
            this._draggingSlider = false;
            this._brightness.setBrightness(Math.round(slider.value * 100));
        });
        slider.connect('notify::value', () => {
            if (this._draggingSlider)
                this._brightness.setBrightness(Math.round(slider.value * 100));
        });
        box.add_child(slider);

        box.add_child(new St.Label({
            text: `${bright.percent}%`,
            style_class: 'di-percent-label',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        return box;
    }

    _buildQuickSettingsGrid() {
        const qs = this._quickSettings.getState();
        const media = this._mpris.getState();
        const acc = (this._settings.get_boolean('enable-media') && media.hasPlayer && media.theme?.active)
            ? media.theme.accent
            : {r: 56, g: 189, b: 248};
        const accLight = (this._settings.get_boolean('enable-media') && media.hasPlayer && media.theme?.active)
            ? media.theme.accentLight
            : {r: 125, g: 211, b: 252};

        const grid = new St.BoxLayout({style_class: 'di-qs-row', x_expand: true});

        const addTile = ({icon, label, active, available, onClick}) => {
            const inner = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_align: Clutter.ActorAlign.CENTER,
            });
            const bubbleStyle = active
                ? `background-color: rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.42); border-color: rgba(255, 255, 255, 0.48);`
                : '';
            const iconBubble = new St.Bin({
                style_class: active ? 'di-qs-icon-bubble-active' : 'di-qs-icon-bubble',
                style: bubbleStyle,
                x_align: Clutter.ActorAlign.CENTER,
                child: new St.Icon({icon_name: icon, icon_size: 15}),
            });
            inner.add_child(iconBubble);
            inner.add_child(new St.Label({
                text: label,
                style_class: 'di-qs-label',
                x_align: Clutter.ActorAlign.CENTER,
            }));

            const tileStyle = active
                ? `background-color: rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.26); border-color: rgba(${accLight.r}, ${accLight.g}, ${accLight.b}, 0.58);`
                : '';

            const btn = this._makeButton({
                style_class: `di-qs-tile ${active ? 'di-qs-active' : ''} ${!available ? 'di-qs-disabled' : ''}`,
                style: tileStyle,
                x_expand: true,
                reactive: available && Boolean(onClick),
                child: inner,
            }, available ? onClick : null);

            grid.add_child(btn);
        };

        addTile({
            icon: qs.wifi.enabled ? 'network-wireless-signal-excellent-symbolic' : 'network-wireless-offline-symbolic',
            label: qs.wifi.available ? (qs.wifi.enabled ? 'Wi-Fi' : 'Off') : 'No Wi-Fi',
            active: qs.wifi.enabled,
            available: qs.wifi.available,
            onClick: () => this._quickSettings.toggleWifi(),
        });

        addTile({
            icon: qs.bluetooth.enabled ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic',
            label: qs.bluetooth.available ? (qs.bluetooth.enabled ? 'BT On' : 'BT Off') : 'No BT',
            active: qs.bluetooth.enabled,
            available: qs.bluetooth.available,
            onClick: () => this._quickSettings.toggleBluetooth(),
        });

        addTile({
            icon: qs.battery.available ? 'battery-good-symbolic' : 'ac-adapter-symbolic',
            label: qs.battery.label,
            active: qs.battery.charging,
            available: true,
            onClick: () => this.setState('focus', 'quickSettings'),
        });

        addTile({
            icon: qs.dnd.enabled ? 'notifications-disabled-symbolic' : 'preferences-system-notifications-symbolic',
            label: 'DND',
            active: qs.dnd.enabled,
            available: qs.dnd.available,
            onClick: () => this._quickSettings.toggleDnd(),
        });

        addTile({
            icon: 'night-light-symbolic',
            label: 'Night',
            active: qs.nightLight.enabled,
            available: qs.nightLight.available,
            onClick: () => this._quickSettings.toggleNightLight(),
        });

        return grid;
    }

    _renderFocus(animateArtwork = false) {
        this._focusView.destroy_all_children();

        try {
            if (this._focusModule === 'media') {
                this._focusView.add_child(this._buildHeaderBar('Media Player · MPRIS', true));
                this._focusView.add_child(this._buildMediaSection(animateArtwork));

                const media = this._mpris.getState();
                if (media.players.length > 0) {
                    this._focusView.add_child(new St.Label({
                        text: 'Detected Players',
                        style_class: 'di-section-title',
                    }));
                    const list = new St.BoxLayout({
                        orientation: Clutter.Orientation.VERTICAL,
                        style_class: 'di-device-list',
                    });
                    for (const player of media.players) {
                        const isSelected = player.busName === media.activeBusName;
                        const rowBtn = this._makeButton({
                            style_class: `di-device-btn ${isSelected ? 'di-device-active' : ''}`,
                            x_expand: true,
                            label: `${player.appLabel} (${player.status})`,
                        }, () => this._mpris.selectPlayer(player.busName));
                        list.add_child(rowBtn);
                    }
                    this._focusView.add_child(list);
                }
                return;
            }

            if (this._focusModule === 'audio') {
                this._focusView.add_child(this._buildHeaderBar('Audio Routing · PipeWire', true));
                this._focusView.add_child(this._buildAudioRow());
                const audio = this._audio.getState();

                this._focusView.add_child(new St.Label({text: 'Output Devices', style_class: 'di-section-title'}));
                for (const out of audio.outputs.slice(0, 4)) {
                    const btn = this._makeButton({
                        style_class: `di-device-btn ${out.isActive ? 'di-device-active' : ''}`,
                        label: out.name,
                        x_expand: true,
                    }, () => this._audio.selectOutputDevice(out.id));
                    this._focusView.add_child(btn);
                }

                this._focusView.add_child(new St.Label({text: 'Input Devices', style_class: 'di-section-title'}));
                for (const inp of audio.inputs.slice(0, 3)) {
                    const btn = this._makeButton({
                        style_class: `di-device-btn ${inp.isActive ? 'di-device-active' : ''}`,
                        label: inp.name,
                        x_expand: true,
                    }, () => this._audio.selectInputDevice(inp.id));
                    this._focusView.add_child(btn);
                }
                return;
            }

            this._focusView.add_child(this._buildHeaderBar('System & Studio · By Lxe Soul', true));
            this._focusView.add_child(this._buildQuickSettingsGrid());
            this._focusView.add_child(this._buildUtilityBar());

            const pulse = readSystemPulse();
            const infoCard = new St.BoxLayout({
                style_class: 'di-section-box',
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
            });
            infoCard.add_child(new St.Label({
                text: `Ubuntu 26.04 System Pulse · RAM ${pulse.ramPercent}% · Load ${pulse.loadAvg}`,
                style_class: 'di-track-title',
            }));
            infoCard.add_child(new St.Label({
                text: `Blur Intensity: ${this._settings.get_int('blur-intensity')}px · Focus Timer: ${formatDurationSeconds(this._pomodoroRemainingSec)}`,
                style_class: 'di-track-subtitle',
            }));
            const resetTimerBtn = this._makeButton({
                style_class: 'di-device-btn',
                label: 'Reset 25:00 Pomodoro Timer',
                x_expand: true,
            }, () => this._resetPomodoro());
            infoCard.add_child(resetTimerBtn);
            this._focusView.add_child(infoCard);
        } catch (err) {
            console.error('[DynamicIsland] _renderFocus error:', err);
        }
    }

    destroy() {
        this._endDrag(false);
        this._clearAutoCollapse();
        if (this._eqTimerId) {
            this._timers.clear(this._eqTimerId);
            this._eqTimerId = 0;
        }
        if (this._pomodoroTimerId) {
            this._timers.clear(this._pomodoroTimerId);
            this._pomodoroTimerId = 0;
        }
        if (this._copiedTimerId) {
            this._timers.clear(this._copiedTimerId);
            this._copiedTimerId = 0;
        }
        this._timers.clearAll();
        this._signals.disconnectAll();
        syncGlassBlurEffect(this, 0);
        syncGlassBlurEffect(this._expandedView, 0);
        syncGlassBlurEffect(this._focusView, 0);
        super.destroy();
    }
});
