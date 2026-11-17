import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

export const SCHEMA_DEFAULTS = {
    'island-position': 'top-center',
    'use-custom-position': false,
    'custom-x': -1,
    'custom-y': -1,
    'monitor-mode': 'primary',
    'top-offset': 36,
    'compact-width': 224,
    'compact-height': 32,
    'expanded-width': 464,
    'expanded-height': 432,
    'corner-radius': 26,
    'background-opacity': 0.04,
    'background-color': '#0B0E16',
    'blur-intensity': 10,
    'border-opacity': 0.24,
    'shadow-intensity': 0.45,
    'animation-speed': 'normal',
    'compact-appearance': 'media-progress',
    'expanded-appearance': 'full',
    'enable-media': true,
    'enable-audio': true,
    'enable-brightness': true,
    'enable-quick-settings': true,
    'show-album-artwork': true,
    'auto-expand-on-music': true,
    'auto-expand-on-volume': true,
    'auto-expand-on-brightness': true,
    'auto-collapse-delay': 3000,
};

/**
 * SafeSettings wraps Gio.Settings so missing or cached GSettings schema keys
 * never throw fatal GLib-GIO errors during live extension reload or ZIP install.
 */
export class SafeSettings {
    constructor(rawSettings = null) {
        this._raw = rawSettings;
        this._fallback = new Map(Object.entries(SCHEMA_DEFAULTS));
        this._listeners = new Map();
        this._nextListenerId = 1;
    }

    _hasKey(key) {
        try {
            if (!this._raw)
                return false;
            const schema = this._raw.settings_schema;
            if (schema && typeof schema.has_key === 'function')
                return schema.has_key(key);
            return true;
        } catch {
            return false;
        }
    }

    get_string(key) {
        if (this._hasKey(key)) {
            try {
                return this._raw.get_string(key);
            } catch {
                // Fall back to in-memory default
            }
        }
        const val = this._fallback.get(key);
        return typeof val === 'string' ? val : String(SCHEMA_DEFAULTS[key] ?? '');
    }

    get_int(key) {
        if (this._hasKey(key)) {
            try {
                return this._raw.get_int(key);
            } catch {
                // Fall back to in-memory default
            }
        }
        const val = Number(this._fallback.get(key));
        return Number.isFinite(val) ? Math.round(val) : Number(SCHEMA_DEFAULTS[key] ?? 0);
    }

    get_double(key) {
        if (this._hasKey(key)) {
            try {
                return this._raw.get_double(key);
            } catch {
                // Fall back to in-memory default
            }
        }
        const val = Number(this._fallback.get(key));
        return Number.isFinite(val) ? val : Number(SCHEMA_DEFAULTS[key] ?? 0);
    }

    get_boolean(key) {
        if (this._hasKey(key)) {
            try {
                return Boolean(this._raw.get_boolean(key));
            } catch {
                // Fall back to in-memory default
            }
        }
        return Boolean(this._fallback.get(key) ?? SCHEMA_DEFAULTS[key] ?? false);
    }

    set_string(key, value) {
        const clean = String(value ?? '');
        this._fallback.set(key, clean);
        if (this._hasKey(key)) {
            try {
                this._raw.set_string(key, clean);
                return;
            } catch {
                // Fall back to local notification
            }
        }
        this._notifyLocal(key);
    }

    set_int(key, value) {
        const clean = Math.round(Number(value) || 0);
        this._fallback.set(key, clean);
        if (this._hasKey(key)) {
            try {
                this._raw.set_int(key, clean);
                return;
            } catch {
                // Fall back to local notification
            }
        }
        this._notifyLocal(key);
    }

    set_double(key, value) {
        const clean = Number(value) || 0;
        this._fallback.set(key, clean);
        if (this._hasKey(key)) {
            try {
                this._raw.set_double(key, clean);
                return;
            } catch {
                // Fall back to local notification
            }
        }
        this._notifyLocal(key);
    }

    set_boolean(key, value) {
        const clean = Boolean(value);
        this._fallback.set(key, clean);
        if (this._hasKey(key)) {
            try {
                this._raw.set_boolean(key, clean);
                return;
            } catch {
                // Fall back to local notification
            }
        }
        this._notifyLocal(key);
    }

    reset(key) {
        if (key in SCHEMA_DEFAULTS)
            this._fallback.set(key, SCHEMA_DEFAULTS[key]);
        if (this._hasKey(key)) {
            try {
                this._raw.reset(key);
                return;
            } catch {
                // Ignore
            }
        }
        this._notifyLocal(key);
    }

    connect(signalName, callback) {
        const id = this._nextListenerId++;
        let rawId = 0;
        if (this._raw && typeof this._raw.connect === 'function') {
            try {
                rawId = this._raw.connect(signalName, (_s, key) => callback(this, key));
            } catch {
                rawId = 0;
            }
        }
        this._listeners.set(id, {signalName, callback, rawId});
        return id;
    }

    disconnect(id) {
        const entry = this._listeners.get(id);
        if (!entry)
            return;
        if (entry.rawId && this._raw) {
            try {
                this._raw.disconnect(entry.rawId);
            } catch {
                // Ignore
            }
        }
        this._listeners.delete(id);
    }

    _notifyLocal(key) {
        for (const {signalName, callback} of this._listeners.values()) {
            try {
                if (signalName === 'changed' || signalName === `changed::${key}`)
                    callback(this, key);
            } catch {
                // Ignore listener error
            }
        }
    }
}

/**
 * SignalTracker manages GObject signal connections and guarantees
 * deterministic disconnection during extension disable() or widget destroy().
 */
export class SignalTracker {
    constructor() {
        this._connections = [];
    }

    connect(emitter, signalName, callback) {
        if (!emitter || typeof emitter.connect !== 'function')
            return 0;

        try {
            const id = emitter.connect(signalName, callback);
            this._connections.push({emitter, id});
            return id;
        } catch {
            return 0;
        }
    }

    disconnectEmitter(targetEmitter) {
        this._connections = this._connections.filter(({emitter, id}) => {
            if (emitter === targetEmitter) {
                try {
                    if (typeof emitter.disconnect === 'function')
                        emitter.disconnect(id);
                } catch {
                    // Emitter may already be disposed during teardown
                }
                return false;
            }
            return true;
        });
    }

    disconnectAll() {
        for (const {emitter, id} of this._connections) {
            try {
                if (emitter && typeof emitter.disconnect === 'function')
                    emitter.disconnect(id);
            } catch {
                // Ignore already-finalized GObjects
            }
        }
        this._connections = [];
    }
}

/**
 * TimerRegistry tracks GLib timeout/idle sources and cleans them up
 * so zero orphaned timers remain after disable().
 */
export class TimerRegistry {
    constructor() {
        this._sources = new Set();
    }

    setTimeout(delayMs, callback) {
        let sourceId = 0;
        sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._sources.delete(sourceId);
            try {
                callback();
            } catch (err) {
                console.error('[DynamicIsland] Timer callback error:', err);
            }
            return GLib.SOURCE_REMOVE;
        });
        this._sources.add(sourceId);
        return sourceId;
    }

    setInterval(intervalMs, callback) {
        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
            try {
                const keepGoing = callback();
                if (keepGoing === GLib.SOURCE_REMOVE || keepGoing === false) {
                    this._sources.delete(sourceId);
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            } catch (err) {
                console.error('[DynamicIsland] Interval callback error:', err);
                this._sources.delete(sourceId);
                return GLib.SOURCE_REMOVE;
            }
        });
        this._sources.add(sourceId);
        return sourceId;
    }

    clear(sourceId) {
        if (!sourceId)
            return;
        if (this._sources.has(sourceId)) {
            this._sources.delete(sourceId);
            try {
                GLib.source_remove(sourceId);
            } catch {
                // Ignore already-removed source
            }
        }
    }

    clearAll() {
        for (const sourceId of this._sources) {
            try {
                GLib.source_remove(sourceId);
            } catch {
                // Ignore already-removed source
            }
        }
        this._sources.clear();
    }
}

/**
 * Parse a #RRGGBB hex string into { r, g, b } integers [0..255].
 */
export function parseHexColor(hex) {
    if (typeof hex !== 'string')
        return {r: 11, g: 14, b: 22};

    const cleaned = hex.trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}$/.test(cleaned))
        return {r: 11, g: 14, b: 22};

    return {
        r: parseInt(cleaned.slice(0, 2), 16),
        g: parseInt(cleaned.slice(2, 4), 16),
        b: parseInt(cleaned.slice(4, 6), 16),
    };
}

/**
 * Clamp a numeric value to [min, max].
 */
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * Format seconds into MM:SS or H:MM:SS.
 */
export function formatDurationSeconds(totalSeconds) {
    const safeSeconds = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;
    const pad = n => String(n).padStart(2, '0');

    if (hours > 0)
        return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    return `${minutes}:${pad(seconds)}`;
}

const SONG_THEME_PALETTES = [
    {r: 244, g: 63, b: 94},   // Starboy Crimson Rose (#F43F5E)
    {r: 168, g: 85, b: 247},  // Electric Violet (#A855F7)
    {r: 16, g: 185, b: 129},  // Spotify Emerald (#10B981)
    {r: 245, g: 158, b: 11},  // Sunset Amber (#F59E0B)
    {r: 56, g: 189, b: 248},  // Nordic Cyan (#38BDF8)
    {r: 236, g: 72, b: 153},  // Neon Magenta (#EC4899)
    {r: 99, g: 102, b: 241},  // Cosmic Indigo (#6366F1)
    {r: 20, g: 184, b: 166},  // Aurora Teal (#14B8A6)
    {r: 251, g: 113, b: 133}, // Coral Velvet (#FB7185)
    {r: 59, g: 130, b: 246},  // Cobalt Sapphire (#3B82F6)
];

function normalizeVibrantAccent(rgb) {
    let r = clamp(Math.round(Number(rgb?.r) || 56), 0, 255);
    let g = clamp(Math.round(Number(rgb?.g) || 189), 0, 255);
    let b = clamp(Math.round(Number(rgb?.b) || 248), 0, 255);

    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const spread = maxC - minC;

    if (spread < 48 && maxC > 0) {
        const avg = (r + g + b) / 3;
        r = clamp(Math.round(avg + (r - avg) * 2.2), 30, 255);
        g = clamp(Math.round(avg + (g - avg) * 2.2), 30, 255);
        b = clamp(Math.round(avg + (b - avg) * 2.2), 30, 255);
    }

    const peak = Math.max(r, g, b, 1);
    if (peak < 165) {
        const scale = 195 / peak;
        r = clamp(Math.round(r * scale), 0, 255);
        g = clamp(Math.round(g * scale), 0, 255);
        b = clamp(Math.round(b * scale), 0, 255);
    }

    return {r, g, b};
}

/**
 * Compute a dynamic island color theme from the currently playing track
 * (using sampled album cover RGB when available, or deterministic song/artist/app palette).
 */
export function computeSongTheme({
    title = '',
    artist = '',
    appKind = 'none',
    hasPlayer = false,
    sampledRgb = null,
} = {}) {
    if (!hasPlayer || (!title && !artist)) {
        return {
            active: false,
            accent: {r: 56, g: 189, b: 248},
            accentLight: {r: 125, g: 211, b: 252},
            surfaceTint: {r: 11, g: 14, b: 22},
            cardTint: {r: 15, g: 23, b: 42},
        };
    }

    let accent = null;
    if (sampledRgb && Number.isFinite(sampledRgb.r) && Number.isFinite(sampledRgb.g) && Number.isFinite(sampledRgb.b)) {
        accent = normalizeVibrantAccent(sampledRgb);
    } else {
        const key = `${String(title).toLowerCase().trim()}|${String(artist).toLowerCase().trim()}`;
        if (key.includes('die for you') || key.includes('weeknd') || key.includes('starboy') || key.includes('blinding lights')) {
            accent = {r: 244, g: 63, b: 94};
        } else if (key.includes('midnight concrete') || key.includes('kiasmos')) {
            accent = {r: 56, g: 189, b: 248};
        } else if (key.includes('nordic drift') || key.includes('olafur') || key.includes('arnalds')) {
            accent = {r: 16, g: 185, b: 129};
        } else if (key.includes('solar echo') || key.includes('bicep')) {
            accent = {r: 245, g: 158, b: 11};
        } else if (key.includes('veridis quo') || key.includes('daft punk')) {
            accent = {r: 168, g: 85, b: 247};
        } else {
            let hash = 2166136261;
            for (let i = 0; i < key.length; i++) {
                hash ^= key.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            const idx = Math.abs(hash) % SONG_THEME_PALETTES.length;
            accent = {...SONG_THEME_PALETTES[idx]};
            if (appKind === 'spotify' && idx === 4)
                accent = {r: 16, g: 185, b: 129};
        }
    }

    const accentLight = {
        r: clamp(Math.round(accent.r + (255 - accent.r) * 0.36), 0, 255),
        g: clamp(Math.round(accent.g + (255 - accent.g) * 0.36), 0, 255),
        b: clamp(Math.round(accent.b + (255 - accent.b) * 0.36), 0, 255),
    };

    const surfaceTint = {
        r: clamp(Math.round(11 * 0.68 + accent.r * 0.32), 0, 255),
        g: clamp(Math.round(14 * 0.68 + accent.g * 0.32), 0, 255),
        b: clamp(Math.round(22 * 0.68 + accent.b * 0.32), 0, 255),
    };

    const cardTint = {
        r: clamp(Math.round(15 * 0.56 + accent.r * 0.44), 0, 255),
        g: clamp(Math.round(23 * 0.56 + accent.g * 0.44), 0, 255),
        b: clamp(Math.round(42 * 0.56 + accent.b * 0.44), 0, 255),
    };

    return {
        active: true,
        accent,
        accentLight,
        surfaceTint,
        cardTint,
    };
}

/**
 * Read lightweight Ubuntu /proc/meminfo & /proc/loadavg telemetry for the
 * interactive System Pulse badge without spawning subprocesses.
 */
export function readSystemPulse() {
    let ramPercent = 38;
    let loadAvg = '0.42';
    try {
        const [okMem, memBytes] = GLib.file_get_contents('/proc/meminfo');
        if (okMem && memBytes) {
            const text = new TextDecoder().decode(memBytes);
            const totalMatch = text.match(/MemTotal:\s+(\d+)/);
            const availMatch = text.match(/MemAvailable:\s+(\d+)/);
            if (totalMatch && availMatch) {
                const total = Number(totalMatch[1]);
                const avail = Number(availMatch[1]);
                if (total > 0)
                    ramPercent = clamp(Math.round(((total - avail) / total) * 100), 1, 99);
            }
        }
    } catch {
        // Fallback default
    }

    try {
        const [okLoad, loadBytes] = GLib.file_get_contents('/proc/loadavg');
        if (okLoad && loadBytes) {
            const text = new TextDecoder().decode(loadBytes).trim();
            const first = text.split(/\s+/)[0];
            if (first)
                loadAvg = first;
        }
    } catch {
        // Fallback default
    }

    return {ramPercent, loadAvg};
}

/**
 * Build GNOME Shell St-compatible ultra-transparent crystal glass CSS
 * with optional dynamic song-reactive tinting or classic black hardware capsule mode.
 */
export function buildSurfaceStyle({
    backgroundColor,
    backgroundOpacity = 0.04,
    cornerRadius = 26,
    borderOpacity = 0.24,
    state,
    songTheme = null,
    isClassicIdle = false,
}) {
    if (state === 'compact' && isClassicIdle) {
        return [
            'background-color: rgba(4, 5, 9, 0.96);',
            'border: 1px solid rgba(255, 255, 255, 0.14);',
            'border-radius: 999px;',
            'box-shadow: none;',
        ].join(' ');
    }

    const base = parseHexColor(backgroundColor);
    const parsedOpacity = clamp(Number.isFinite(Number(backgroundOpacity)) ? Number(backgroundOpacity) : 0.04, 0.04, 0.90);
    const glassAlpha = clamp(parsedOpacity + 0.14, 0.16, 0.90);

    const r = songTheme?.active ? clamp(Math.round(base.r * 0.55 + songTheme.surfaceTint.r * 0.45), 0, 255) : base.r;
    const g = songTheme?.active ? clamp(Math.round(base.g * 0.55 + songTheme.surfaceTint.g * 0.45), 0, 255) : base.g;
    const b = songTheme?.active ? clamp(Math.round(base.b * 0.55 + songTheme.surfaceTint.b * 0.45), 0, 255) : base.b;

    const parsedBorder = Number(borderOpacity);
    const bAlpha = clamp(Number.isFinite(parsedBorder) ? parsedBorder : 0.24, 0.14, 0.52).toFixed(2);
    const br = songTheme?.active ? clamp(Math.round(255 * 0.52 + songTheme.accentLight.r * 0.48), 0, 255) : 255;
    const bg = songTheme?.active ? clamp(Math.round(255 * 0.52 + songTheme.accentLight.g * 0.48), 0, 255) : 255;
    const bb = songTheme?.active ? clamp(Math.round(255 * 0.52 + songTheme.accentLight.b * 0.48), 0, 255) : 255;

    const radius = (state === 'compact' || state === 'hud')
        ? 999
        : clamp(Number(cornerRadius) || 26, 18, 40);

    return [
        `background-color: rgba(${r}, ${g}, ${b}, ${glassAlpha.toFixed(2)});`,
        `border: 1px solid rgba(${br}, ${bg}, ${bb}, ${bAlpha});`,
        `border-radius: ${radius}px;`,
        `box-shadow: none;`,
    ].join(' ');
}

/**
 * Apply a gentle, subtle compositor background blur (brightness = 1.0, small sigma/radius)
 * to an inner view actor so the blur bounding box stays strictly inside the outer rounded border.
 */
export function syncGlassBlurEffect(actor, blurIntensity = 10) {
    if (!actor || actor.is_destroyed?.())
        return false;

    const intensity = clamp(Math.round(Number(blurIntensity) || 0), 0, 60);
    try {
        const existing = actor.get_effect?.('di-glass-blur') ?? null;
        if (intensity <= 0) {
            if (existing)
                actor.remove_effect_by_name('di-glass-blur');
            return false;
        }

        const subtleRadius = clamp(Math.round(intensity * 0.35), 2, 14);
        const subtleSigma = clamp(Math.round(subtleRadius * 0.5), 1, 7);
        const bgMode = Shell.BlurMode?.BACKGROUND ?? 1;

        if (existing) {
            existing.set_brightness?.(1.0);
            if ('brightness' in existing)
                existing.brightness = 1.0;
            if ('mode' in existing)
                existing.mode = bgMode;
            if ('radius' in existing)
                existing.radius = subtleRadius;
            else if ('sigma' in existing)
                existing.sigma = subtleSigma;
            return true;
        }

        const blurEffect = new Shell.BlurEffect({
            brightness: 1.0,
            mode: bgMode,
        });
        if ('radius' in blurEffect)
            blurEffect.radius = subtleRadius;
        else if ('sigma' in blurEffect)
            blurEffect.sigma = subtleSigma;

        actor.add_effect_with_name('di-glass-blur', blurEffect);
        return true;
    } catch {
        return false;
    }
}
