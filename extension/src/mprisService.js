import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {SignalTracker, TimerRegistry, computeSongTheme} from './utils.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const DBUS_NAME = 'org.freedesktop.DBus';
const DBUS_PATH = '/org/freedesktop/DBus';

function unpackVariant(value) {
    try {
        if (value && typeof value.recursiveUnpack === 'function')
            return value.recursiveUnpack();
        if (value && typeof value.deepUnpack === 'function')
            return value.deepUnpack();
    } catch {
        // Fallback
    }
    return value;
}

function getPlayerPriority(busName, identity = '') {
    const lowerBus = String(busName || '').toLowerCase();
    const lowerId = String(identity || '').toLowerCase();
    if (lowerBus.includes('spotify') || lowerId.includes('spotify'))
        return 100;
    if (lowerBus.includes('firefox') || lowerBus.includes('chromium') ||
        lowerBus.includes('chrome') || lowerBus.includes('brave'))
        return 60;
    return 40;
}

function resolveAppKind(busName, identity = '') {
    const text = `${busName} ${identity}`.toLowerCase();
    if (text.includes('spotify'))
        return {appKind: 'spotify', appLabel: 'Spotify'};
    if (text.includes('firefox'))
        return {appKind: 'firefox', appLabel: 'Firefox'};
    if (text.includes('brave'))
        return {appKind: 'browser', appLabel: 'Brave'};
    if (text.includes('chromium') || text.includes('chrome'))
        return {appKind: 'browser', appLabel: identity || 'Chrome'};
    return {appKind: 'media', appLabel: identity || String(busName || '').replace(MPRIS_PREFIX, '')};
}

/**
 * Sample a 16x16 thumbnail of a local album artwork file using GdkPixbuf
 * and return its most vibrant dominant RGB color {r, g, b}.
 */
function extractDominantColorFromFile(filePath) {
    try {
        if (!filePath || !GLib.file_test(filePath, GLib.FileTest.EXISTS))
            return null;

        const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(filePath, 16, 16, false);
        if (!pixbuf)
            return null;

        const pixels = pixbuf.get_pixels();
        const nChannels = pixbuf.get_n_channels();
        const rowstride = pixbuf.get_rowstride();
        const width = pixbuf.get_width();
        const height = pixbuf.get_height();

        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let totalWeight = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * rowstride + x * nChannels;
                const r = pixels[idx] ?? 0;
                const g = pixels[idx + 1] ?? 0;
                const b = pixels[idx + 2] ?? 0;

                const maxC = Math.max(r, g, b);
                const minC = Math.min(r, g, b);
                const lum = (r + g + b) / 3;
                const sat = maxC - minC;

                // Weight vibrant mid-to-bright pixels much higher than black/white/gray background pixels
                const lumFactor = (lum > 24 && lum < 240) ? 1.5 : 0.2;
                const weight = (1 + (sat / 32)) * lumFactor;

                sumR += r * weight;
                sumG += g * weight;
                sumB += b * weight;
                totalWeight += weight;
            }
        }

        if (totalWeight <= 0)
            return null;

        return {
            r: Math.round(sumR / totalWeight),
            g: Math.round(sumG / totalWeight),
            b: Math.round(sumB / totalWeight),
        };
    } catch {
        return null;
    }
}

/**
 * MprisService discovers all MPRIS media players on the session D-Bus
 * using direct Gio.DBus.session calls and signal subscriptions so Spotify (deb/Snap/Flatpak),
 * Brave, Chrome, Firefox (YouTube), and VLC work reliably on Ubuntu 26.04 LTS / GNOME Shell 50.1.
 * Also downloads & caches remote https:// album covers and extracts dynamic song themes.
 */
export class MprisService {
    constructor(onChange) {
        this._onChange = onChange;
        this._signals = new SignalTracker();
        this._timers = new TimerRegistry();
        this._players = new Map();
        this._selectedBusName = null;
        this._subscriptionIds = [];
        this._positionTickId = 0;
        this._artCache = new Map(); // artUrl -> { localPath, sampledRgb }
        this._inFlightArt = new Set();
        this._destroyed = false;
    }

    init() {
        try {
            const nameOwnerSub = Gio.DBus.session.signal_subscribe(
                DBUS_NAME,
                DBUS_NAME,
                'NameOwnerChanged',
                DBUS_PATH,
                null,
                Gio.DBusSignalFlags.NONE,
                (_conn, _sender, _path, _iface, _signal, params) => {
                    if (this._destroyed)
                        return;
                    try {
                        const [name, oldOwner, newOwner] = params.deepUnpack();
                        if (!name || !name.startsWith(MPRIS_PREFIX))
                            return;
                        if (newOwner && !oldOwner)
                            this._addPlayer(name);
                        else if (!newOwner && oldOwner)
                            this._removePlayer(name);
                    } catch {
                        // Ignore malformed signal
                    }
                }
            );
            this._subscriptionIds.push(nameOwnerSub);

            const propsSub = Gio.DBus.session.signal_subscribe(
                null,
                'org.freedesktop.DBus.Properties',
                'PropertiesChanged',
                MPRIS_PATH,
                null,
                Gio.DBusSignalFlags.NONE,
                (_conn, sender, _path, _iface, _signal, params) => {
                    if (this._destroyed)
                        return;
                    try {
                        const [ifaceName, changedProps] = params.deepUnpack();
                        if (!ifaceName || !ifaceName.startsWith('org.mpris.MediaPlayer2'))
                            return;

                        const entry = this._findPlayerBySenderOrBus(sender);
                        if (entry) {
                            this._applyPropertiesDict(entry, unpackVariant(changedProps));
                            this._choosePreferredPlayer();
                            this._syncPositionTicker();
                            this._emit(false);
                        } else {
                            this.rescan();
                        }
                    } catch {
                        // Ignore
                    }
                }
            );
            this._subscriptionIds.push(propsSub);

            const seekedSub = Gio.DBus.session.signal_subscribe(
                null,
                'org.mpris.MediaPlayer2.Player',
                'Seeked',
                MPRIS_PATH,
                null,
                Gio.DBusSignalFlags.NONE,
                (_conn, sender, _path, _iface, _signal, params) => {
                    if (this._destroyed)
                        return;
                    try {
                        const entry = this._findPlayerBySenderOrBus(sender);
                        if (!entry)
                            return;
                        const [posUs] = params.deepUnpack();
                        entry.positionSeconds = Math.max(0, Number(posUs) / 1_000_000);
                        entry.lastSyncMonotonicUs = GLib.get_monotonic_time();
                        this._emit(true);
                    } catch {
                        // Ignore
                    }
                }
            );
            this._subscriptionIds.push(seekedSub);

            this.rescan();
        } catch (err) {
            console.error('[DynamicIsland] Failed to initialize MPRIS D-Bus watcher:', err);
        }
    }

    _findPlayerBySenderOrBus(sender) {
        if (!sender)
            return null;
        if (this._players.has(sender))
            return this._players.get(sender);
        for (const entry of this._players.values()) {
            if (entry.owner === sender || entry.busName === sender)
                return entry;
        }
        return null;
    }

    rescan() {
        if (this._destroyed)
            return;

        try {
            Gio.DBus.session.call(
                DBUS_NAME,
                DBUS_PATH,
                DBUS_NAME,
                'ListNames',
                null,
                new GLib.VariantType('(as)'),
                Gio.DBusCallFlags.NONE,
                1500,
                null,
                (conn, res) => {
                    if (this._destroyed)
                        return;
                    try {
                        const reply = conn.call_finish(res);
                        const [names] = reply.deepUnpack();
                        const activeMpris = new Set();
                        for (const name of names) {
                            if (typeof name === 'string' && name.startsWith(MPRIS_PREFIX)) {
                                activeMpris.add(name);
                                if (!this._players.has(name))
                                    this._addPlayer(name);
                                else
                                    this._fetchAllPlayerProperties(this._players.get(name));
                            }
                        }
                        for (const existing of [...this._players.keys()]) {
                            if (!activeMpris.has(existing))
                                this._removePlayer(existing);
                        }
                    } catch {
                        // Ignore ListNames error
                    }
                }
            );
        } catch {
            // Ignore
        }
    }

    _addPlayer(busName) {
        if (this._destroyed || this._players.has(busName))
            return;

        const entry = {
            busName,
            owner: '',
            identity: busName.replace(MPRIS_PREFIX, '').split('.')[0] || 'Media Player',
            status: 'Stopped',
            title: '',
            artist: '',
            album: '',
            artUrl: '',
            localArtPath: '',
            sampledRgb: null,
            trackId: '',
            lengthSeconds: 0,
            positionSeconds: 0,
            lastSyncMonotonicUs: GLib.get_monotonic_time(),
            canPlay: true,
            canPause: true,
            canNext: true,
            canPrev: true,
            canSeek: true,
        };

        this._players.set(busName, entry);

        try {
            Gio.DBus.session.call(
                DBUS_NAME,
                DBUS_PATH,
                DBUS_NAME,
                'GetNameOwner',
                new GLib.Variant('(s)', [busName]),
                new GLib.VariantType('(s)'),
                Gio.DBusCallFlags.NONE,
                1500,
                null,
                (conn, res) => {
                    if (this._destroyed || !this._players.has(busName))
                        return;
                    try {
                        const [owner] = conn.call_finish(res).deepUnpack();
                        entry.owner = owner || '';
                    } catch {
                        // Ignore
                    }
                }
            );
        } catch {
            // Ignore
        }

        this._fetchAllPlayerProperties(entry);
    }

    _fetchAllPlayerProperties(entry) {
        if (!entry || this._destroyed)
            return;

        try {
            Gio.DBus.session.call(
                entry.busName,
                MPRIS_PATH,
                'org.freedesktop.DBus.Properties',
                'GetAll',
                new GLib.Variant('(s)', ['org.mpris.MediaPlayer2']),
                new GLib.VariantType('(a{sv})'),
                Gio.DBusCallFlags.NONE,
                1500,
                null,
                (conn, res) => {
                    if (this._destroyed || !this._players.has(entry.busName))
                        return;
                    try {
                        const [props] = conn.call_finish(res).deepUnpack();
                        const unpacked = unpackVariant(props);
                        if (unpacked && typeof unpacked.Identity === 'string' && unpacked.Identity)
                            entry.identity = unpacked.Identity;
                        this._choosePreferredPlayer();
                        this._emit(false);
                    } catch {
                        // Ignore
                    }
                }
            );
        } catch {
            // Ignore
        }

        try {
            Gio.DBus.session.call(
                entry.busName,
                MPRIS_PATH,
                'org.freedesktop.DBus.Properties',
                'GetAll',
                new GLib.Variant('(s)', ['org.mpris.MediaPlayer2.Player']),
                new GLib.VariantType('(a{sv})'),
                Gio.DBusCallFlags.NONE,
                1500,
                null,
                (conn, res) => {
                    if (this._destroyed || !this._players.has(entry.busName))
                        return;
                    try {
                        const [props] = conn.call_finish(res).deepUnpack();
                        this._applyPropertiesDict(entry, unpackVariant(props));
                        this._choosePreferredPlayer();
                        this._syncPositionTicker();
                        this._emit(false);
                    } catch {
                        // Ignore
                    }
                }
            );
        } catch {
            // Ignore
        }
    }

    _resolveArtworkAndTheme(entry) {
        if (!entry || this._destroyed)
            return;

        const rawArt = String(entry.artUrl || '').trim();
        if (!rawArt) {
            entry.localArtPath = '';
            entry.sampledRgb = null;
            return;
        }

        // Check in-memory cache first
        if (this._artCache.has(rawArt)) {
            const cached = this._artCache.get(rawArt);
            if (cached.localPath && GLib.file_test(cached.localPath, GLib.FileTest.EXISTS)) {
                entry.localArtPath = cached.localPath;
                entry.sampledRgb = cached.sampledRgb;
                return;
            }
        }

        // 1. Local file:// URI or absolute path (Brave/Chrome/Firefox/VLC)
        if (rawArt.startsWith('file://') || rawArt.startsWith('/')) {
            try {
                const localPath = rawArt.startsWith('file://')
                    ? (Gio.File.new_for_uri(rawArt).get_path() || '')
                    : rawArt;
                if (localPath && GLib.file_test(localPath, GLib.FileTest.EXISTS)) {
                    const sampledRgb = extractDominantColorFromFile(localPath);
                    this._artCache.set(rawArt, {localPath, sampledRgb});
                    entry.localArtPath = localPath;
                    entry.sampledRgb = sampledRgb;
                    return;
                }
            } catch {
                // Ignore
            }
        }

        // Compute deterministic temp file path for remote or data: artwork
        const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, rawArt, -1);
        const cachePath = GLib.build_filenamev([GLib.get_tmp_dir(), `di-mpris-art-${hash}`]);

        if (GLib.file_test(cachePath, GLib.FileTest.EXISTS)) {
            const sampledRgb = extractDominantColorFromFile(cachePath);
            this._artCache.set(rawArt, {localPath: cachePath, sampledRgb});
            entry.localArtPath = cachePath;
            entry.sampledRgb = sampledRgb;
            return;
        }

        // 2. Inline base64 data:image/... URI
        if (rawArt.startsWith('data:image/')) {
            try {
                const commaIdx = rawArt.indexOf(',');
                if (commaIdx > 0) {
                    const b64 = rawArt.slice(commaIdx + 1);
                    const bytes = GLib.base64_decode(b64);
                    GLib.file_set_contents(cachePath, bytes);
                    const sampledRgb = extractDominantColorFromFile(cachePath);
                    this._artCache.set(rawArt, {localPath: cachePath, sampledRgb});
                    entry.localArtPath = cachePath;
                    entry.sampledRgb = sampledRgb;
                    return;
                }
            } catch {
                // Ignore
            }
        }

        // 3. Remote https:// or http:// URL (Spotify i.scdn.co, YouTube i.ytimg.com, etc.)
        if ((rawArt.startsWith('https://') || rawArt.startsWith('http://')) && !this._inFlightArt.has(rawArt)) {
            this._inFlightArt.add(rawArt);
            const normalizedUrl = rawArt.replace(/^http:\/\/open\.spotify\.com\/image\//, 'https://i.scdn.co/image/')
                .replace(/^https:\/\/open\.spotify\.com\/image\//, 'https://i.scdn.co/image/');

            const finishArtLoad = () => {
                this._inFlightArt.delete(rawArt);
                if (this._destroyed)
                    return;
                if (GLib.file_test(cachePath, GLib.FileTest.EXISTS)) {
                    const sampledRgb = extractDominantColorFromFile(cachePath);
                    this._artCache.set(rawArt, {localPath: cachePath, sampledRgb});
                    for (const p of this._players.values()) {
                        if (p.artUrl === rawArt) {
                            p.localArtPath = cachePath;
                            p.sampledRgb = sampledRgb;
                        }
                    }
                    this._emit(false);
                }
            };

            const fallbackGioDownload = () => {
                try {
                    const remoteFile = Gio.File.new_for_uri(normalizedUrl);
                    remoteFile.load_contents_async(null, (f, res) => {
                        try {
                            const [ok, contents] = f.load_contents_finish(res);
                            if (ok && contents && contents.length > 0)
                                GLib.file_set_contents(cachePath, contents);
                        } catch {
                            // Ignore
                        }
                        finishArtLoad();
                    });
                } catch {
                    this._inFlightArt.delete(rawArt);
                }
            };

            try {
                const proc = Gio.Subprocess.new(
                    ['curl', '-fsSL', '--max-time', '6', '-o', cachePath, normalizedUrl],
                    Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
                );
                proc.wait_check_async(null, (_p, res) => {
                    try {
                        proc.wait_check_finish(res);
                        if (GLib.file_test(cachePath, GLib.FileTest.EXISTS)) {
                            finishArtLoad();
                            return;
                        }
                    } catch {
                        // Fall back to GIO async load
                    }
                    fallbackGioDownload();
                });
            } catch {
                fallbackGioDownload();
            }
        }
    }

    _applyPropertiesDict(entry, dict) {
        if (!entry || !dict || typeof dict !== 'object')
            return;

        try {
            if ('Identity' in dict && typeof unpackVariant(dict.Identity) === 'string')
                entry.identity = unpackVariant(dict.Identity) || entry.identity;

            if ('PlaybackStatus' in dict) {
                const st = unpackVariant(dict.PlaybackStatus);
                if (typeof st === 'string' && st)
                    entry.status = st;
            }
            if ('CanPlay' in dict)
                entry.canPlay = Boolean(unpackVariant(dict.CanPlay));
            if ('CanPause' in dict)
                entry.canPause = Boolean(unpackVariant(dict.CanPause));
            if ('CanGoNext' in dict)
                entry.canNext = Boolean(unpackVariant(dict.CanGoNext));
            if ('CanGoPrevious' in dict)
                entry.canPrev = Boolean(unpackVariant(dict.CanGoPrevious));
            if ('CanSeek' in dict)
                entry.canSeek = Boolean(unpackVariant(dict.CanSeek));

            if ('Position' in dict) {
                const posUs = Number(unpackVariant(dict.Position));
                if (Number.isFinite(posUs) && posUs >= 0) {
                    entry.positionSeconds = posUs / 1_000_000;
                    entry.lastSyncMonotonicUs = GLib.get_monotonic_time();
                }
            }

            if ('Metadata' in dict) {
                const rawMeta = unpackVariant(dict.Metadata);
                const metadata = rawMeta && typeof rawMeta === 'object' ? rawMeta : {};

                const prevTitle = entry.title;
                const prevArt = entry.artUrl;

                const rawTitle = unpackVariant(metadata['xesam:title']);
                entry.title = typeof rawTitle === 'string' ? rawTitle : '';

                const artistField = unpackVariant(metadata['xesam:artist']);
                if (Array.isArray(artistField))
                    entry.artist = artistField.map(a => unpackVariant(a)).filter(Boolean).join(', ');
                else if (typeof artistField === 'string')
                    entry.artist = artistField;
                else
                    entry.artist = '';

                const rawAlbum = unpackVariant(metadata['xesam:album']);
                entry.album = typeof rawAlbum === 'string' ? rawAlbum : '';

                const rawArt = unpackVariant(metadata['mpris:artUrl']);
                entry.artUrl = typeof rawArt === 'string' ? rawArt : '';

                if (entry.artUrl !== prevArt || entry.title !== prevTitle) {
                    entry.sampledRgb = null;
                    this._resolveArtworkAndTheme(entry);
                }

                const rawTrackId = unpackVariant(metadata['mpris:trackid']);
                entry.trackId = typeof rawTrackId === 'string' ? rawTrackId : '';

                const lengthUs = Number(unpackVariant(metadata['mpris:length']) ?? 0);
                entry.lengthSeconds = Number.isFinite(lengthUs) && lengthUs > 0 ? lengthUs / 1_000_000 : 0;

                this._refreshPositionFromBus(entry);
            }
        } catch (err) {
            console.error('[DynamicIsland] _applyPropertiesDict error:', err);
        }
    }

    _removePlayer(busName) {
        const entry = this._players.get(busName);
        if (!entry)
            return;

        this._players.delete(busName);
        if (this._selectedBusName === busName)
            this._selectedBusName = null;

        this._choosePreferredPlayer();
        this._syncPositionTicker();
        this._emit(false);
    }

    _refreshPositionFromBus(entry) {
        if (!entry || this._destroyed)
            return;

        try {
            Gio.DBus.session.call(
                entry.busName,
                MPRIS_PATH,
                'org.freedesktop.DBus.Properties',
                'Get',
                new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
                new GLib.VariantType('(v)'),
                Gio.DBusCallFlags.NONE,
                1500,
                null,
                (conn, res) => {
                    if (this._destroyed)
                        return;
                    try {
                        const reply = conn.call_finish(res);
                        const [variantVal] = reply.deepUnpack();
                        const posUs = Number(unpackVariant(variantVal));
                        if (Number.isFinite(posUs) && posUs >= 0) {
                            entry.positionSeconds = posUs / 1_000_000;
                            entry.lastSyncMonotonicUs = GLib.get_monotonic_time();
                            this._emit(true);
                        }
                    } catch {
                        // Some players do not expose Position until playback starts
                    }
                }
            );
        } catch {
            // Ignore position query failure
        }
    }

    _choosePreferredPlayer() {
        if (this._selectedBusName && this._players.has(this._selectedBusName)) {
            const current = this._players.get(this._selectedBusName);
            if (current.status === 'Playing')
                return;
        }

        let best = null;
        let bestScore = -1;
        for (const entry of this._players.values()) {
            const playingBonus = entry.status === 'Playing' ? 200 : entry.status === 'Paused' ? 100 : 0;
            const titleBonus = entry.title ? 20 : 0;
            const score = playingBonus + titleBonus + getPlayerPriority(entry.busName, entry.identity);
            if (score > bestScore) {
                bestScore = score;
                best = entry;
            }
        }
        this._selectedBusName = best ? best.busName : null;
    }

    _syncPositionTicker() {
        const active = this._getActiveEntry();
        const shouldTick = Boolean(active && active.status === 'Playing' && active.lengthSeconds > 0);

        if (shouldTick && !this._positionTickId) {
            this._positionTickId = this._timers.setInterval(1000, () => {
                if (this._destroyed)
                    return GLib.SOURCE_REMOVE;
                const current = this._getActiveEntry();
                if (!current || current.status !== 'Playing') {
                    this._positionTickId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this._emit(true);
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!shouldTick && this._positionTickId) {
            this._timers.clear(this._positionTickId);
            this._positionTickId = 0;
        }
    }

    _getActiveEntry() {
        this._choosePreferredPlayer();
        if (!this._selectedBusName)
            return null;
        return this._players.get(this._selectedBusName) ?? null;
    }

    _computeLivePosition(entry) {
        if (!entry)
            return 0;
        if (entry.status !== 'Playing')
            return Math.min(entry.positionSeconds, entry.lengthSeconds || entry.positionSeconds);

        const elapsedSec = (GLib.get_monotonic_time() - entry.lastSyncMonotonicUs) / 1_000_000;
        const pos = entry.positionSeconds + Math.max(0, elapsedSec);
        return entry.lengthSeconds > 0 ? Math.min(pos, entry.lengthSeconds) : pos;
    }

    getState() {
        const defaultTheme = computeSongTheme({hasPlayer: false});
        try {
            const players = Array.from(this._players.values()).map(p => {
                const {appKind, appLabel} = resolveAppKind(p.busName, p.identity);
                return {
                    busName: p.busName,
                    identity: p.identity,
                    appKind,
                    appLabel,
                    status: p.status,
                    title: p.title,
                    artist: p.artist,
                };
            });

            const active = this._getActiveEntry();
            if (!active) {
                return {
                    hasPlayer: false,
                    activeBusName: null,
                    players,
                    status: 'Stopped',
                    title: '',
                    artist: '',
                    album: '',
                    artUrl: '',
                    localArtPath: '',
                    theme: defaultTheme,
                    appKind: 'none',
                    appLabel: '',
                    positionSeconds: 0,
                    lengthSeconds: 0,
                    canPlay: true,
                    canPause: true,
                    canNext: true,
                    canPrev: true,
                    canSeek: false,
                };
            }

            const {appKind, appLabel} = resolveAppKind(active.busName, active.identity);
            const title = active.title || appLabel || 'Media Active';
            const artist = active.artist || appLabel;
            const theme = computeSongTheme({
                title,
                artist,
                appKind,
                hasPlayer: true,
                sampledRgb: active.sampledRgb,
            });

            return {
                hasPlayer: true,
                activeBusName: active.busName,
                players,
                status: active.status,
                title,
                artist,
                album: active.album,
                artUrl: active.artUrl,
                localArtPath: active.localArtPath || '',
                theme,
                appKind,
                appLabel,
                positionSeconds: this._computeLivePosition(active),
                lengthSeconds: active.lengthSeconds,
                canPlay: active.canPlay,
                canPause: active.canPause,
                canNext: active.canNext,
                canPrev: active.canPrev,
                canSeek: active.canSeek,
            };
        } catch {
            return {
                hasPlayer: false,
                activeBusName: null,
                players: [],
                status: 'Stopped',
                title: '',
                artist: '',
                album: '',
                artUrl: '',
                localArtPath: '',
                theme: defaultTheme,
                appKind: 'none',
                appLabel: '',
                positionSeconds: 0,
                lengthSeconds: 0,
                canPlay: true,
                canPause: true,
                canNext: true,
                canPrev: true,
                canSeek: false,
            };
        }
    }

    selectPlayer(busName) {
        if (!this._players.has(busName))
            return;
        this._selectedBusName = busName;
        const entry = this._getActiveEntry();
        if (entry)
            this._fetchAllPlayerProperties(entry);
        this._syncPositionTicker();
        this._emit(false);
    }

    _callPlayerMethod(methodName, argsVariant = null) {
        const active = this._getActiveEntry();
        if (!active) {
            this.rescan();
            return false;
        }
        try {
            Gio.DBus.session.call(
                active.busName,
                MPRIS_PATH,
                'org.mpris.MediaPlayer2.Player',
                methodName,
                argsVariant,
                null,
                Gio.DBusCallFlags.NONE,
                1500,
                null,
                () => {
                    this._timers.setTimeout(180, () => {
                        if (!this._destroyed && this._players.has(active.busName))
                            this._fetchAllPlayerProperties(active);
                    });
                }
            );
            return true;
        } catch {
            return false;
        }
    }

    playPause() {
        const active = this._getActiveEntry();
        if (!active) {
            this.rescan();
            return;
        }
        active.positionSeconds = this._computeLivePosition(active);
        active.lastSyncMonotonicUs = GLib.get_monotonic_time();
        active.status = active.status === 'Playing' ? 'Paused' : 'Playing';
        this._syncPositionTicker();
        this._emit(false);
        this._callPlayerMethod('PlayPause');
    }

    next() {
        this._callPlayerMethod('Next');
    }

    previous() {
        this._callPlayerMethod('Previous');
    }

    seekToSeconds(seconds) {
        try {
            const active = this._getActiveEntry();
            if (!active || !active.canSeek)
                return;

            const clamped = Math.max(0, Math.min(seconds, active.lengthSeconds || seconds));
            const targetUs = Math.round(clamped * 1_000_000);
            active.positionSeconds = clamped;
            active.lastSyncMonotonicUs = GLib.get_monotonic_time();
            this._emit(true);

            if (active.trackId && active.trackId.startsWith('/')) {
                this._callPlayerMethod('SetPosition', new GLib.Variant('(ox)', [active.trackId, targetUs]));
            }
        } catch {
            // Ignore seek error
        }
    }

    raisePlayer() {
        const active = this._getActiveEntry();
        if (!active)
            return;
        try {
            Gio.DBus.session.call(
                active.busName,
                MPRIS_PATH,
                'org.mpris.MediaPlayer2',
                'Raise',
                null,
                null,
                Gio.DBusCallFlags.NONE,
                1500,
                null,
                null
            );
        } catch {
            // Ignore
        }
    }

    _emit(isPositionTick = false) {
        if (this._destroyed)
            return;
        try {
            const state = this.getState();
            this._onChange?.(state, isPositionTick);
        } catch (err) {
            console.error('[DynamicIsland] MprisService onChange error:', err);
        }
    }

    destroy() {
        this._destroyed = true;
        this._timers.clearAll();
        this._signals.disconnectAll();
        for (const subId of this._subscriptionIds) {
            try {
                Gio.DBus.session.signal_unsubscribe(subId);
            } catch {
                // Ignore
            }
        }
        this._subscriptionIds = [];
        this._inFlightArt.clear();
        this._artCache.clear();
        this._players.clear();
    }
}
