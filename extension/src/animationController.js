import Clutter from 'gi://Clutter';
import St from 'gi://St';

const SPEED_DURATIONS = {
    'fast': {morph: 185, fade: 115},
    'normal': {morph: 280, fade: 160},
    'relaxed': {morph: 410, fade: 230},
};

/**
 * AnimationController orchestrates smooth spring-like Clutter/St ease
 * animations for Dynamic Island sizing, crossfades, artwork transitions,
 * and lightweight equalizer bar motion.
 */
export class AnimationController {
    constructor() {
        this._speedPreset = 'normal';
        this._trackedActors = new Set();
    }

    setSpeedPreset(preset) {
        if (SPEED_DURATIONS[preset])
            this._speedPreset = preset;
        else
            this._speedPreset = 'normal';
    }

    _animationsEnabled() {
        const settings = St.Settings.get();
        return !settings || settings.enable_animations !== false;
    }

    _getDuration(kind) {
        if (!this._animationsEnabled())
            return 0;

        const settings = St.Settings.get();
        const base = SPEED_DURATIONS[this._speedPreset] ?? SPEED_DURATIONS.normal;
        const slowFactor = settings?.slow_down_factor ?? 1.0;
        return Math.round(base[kind] * slowFactor);
    }

    /**
     * Smoothly morph container dimensions and horizontal anchor position
     * with a subtle spring-like overshoot on expansion.
     */
    morphGeometry(actor, {x, y, width, height, spring = false, onComplete}) {
        if (!actor || actor.is_destroyed?.())
            return;

        this._trackedActors.add(actor);
        actor.remove_all_transitions();

        const duration = this._getDuration('morph');
        if (duration <= 0) {
            actor.set_position(Math.round(x), Math.round(y));
            actor.set_size(Math.round(width), Math.round(height));
            onComplete?.();
            return;
        }

        const mode = spring
            ? Clutter.AnimationMode.EASE_OUT_BACK
            : Clutter.AnimationMode.EASE_OUT_EXPO;

        actor.ease({
            x: Math.round(x),
            y: Math.round(y),
            width: Math.round(width),
            height: Math.round(height),
            duration,
            mode,
            onStopped: finished => {
                if (finished && !actor.is_destroyed?.())
                    onComplete?.();
            },
        });
    }

    /**
     * Animate section or view entrance with opacity + subtle scale settle.
     */
    fadeIn(actor, {scaleFrom = 0.95, onComplete} = {}) {
        if (!actor || actor.is_destroyed?.())
            return;

        this._trackedActors.add(actor);
        actor.remove_all_transitions();

        const duration = this._getDuration('fade');
        if (duration <= 0) {
            actor.opacity = 255;
            actor.set_scale(1.0, 1.0);
            onComplete?.();
            return;
        }

        actor.opacity = 0;
        actor.set_pivot_point(0.5, 0.5);
        actor.set_scale(scaleFrom, scaleFrom);

        actor.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: finished => {
                if (finished && !actor.is_destroyed?.())
                    onComplete?.();
            },
        });
    }

    /**
     * Smooth artwork entrance animation when track changes.
     */
    animateArtworkTransition(actor) {
        if (!actor || actor.is_destroyed?.())
            return;

        this._trackedActors.add(actor);
        actor.remove_all_transitions();

        const duration = this._getDuration('fade');
        if (duration <= 0) {
            actor.opacity = 255;
            actor.set_scale(1.0, 1.0);
            return;
        }

        actor.opacity = 90;
        actor.set_pivot_point(0.5, 0.5);
        actor.set_scale(0.88, 0.88);
        actor.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: Math.round(duration * 1.4),
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
    }

    /**
     * Lightweight height ease for compact equalizer bars.
     */
    easeEqualizerBar(barActor, targetHeight) {
        if (!barActor || barActor.is_destroyed?.())
            return;

        this._trackedActors.add(barActor);
        if (!this._animationsEnabled()) {
            barActor.set_height(targetHeight);
            return;
        }

        barActor.ease({
            height: targetHeight,
            duration: 240,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        });
    }

    destroy() {
        for (const actor of this._trackedActors) {
            try {
                if (actor && !actor.is_destroyed?.())
                    actor.remove_all_transitions();
            } catch {
                // Ignore disposed actors during shell teardown
            }
        }
        this._trackedActors.clear();
    }
}
