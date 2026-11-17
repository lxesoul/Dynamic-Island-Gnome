export type IslandState = 'compact' | 'expanded' | 'focus' | 'hud';
export type HudKind = 'music' | 'volume' | 'brightness';
export type FocusModule = 'media' | 'audio' | 'brightness' | 'quickSettings';
export type IslandPosition = 'top-center' | 'top-left' | 'top-right';
export type MonitorMode = 'primary' | 'follow-focus' | 'all';
export type AnimationSpeed = 'fast' | 'normal' | 'relaxed';
export type CompactAppearance = 'media-progress' | 'minimal' | 'system-pill';
export type ExpandedAppearance = 'full' | 'media-focused' | 'controls-compact';

export interface IslandPreferences {
  islandPosition: IslandPosition;
  useCustomPosition: boolean;
  customX: number;
  customY: number;
  monitorMode: MonitorMode;
  topOffset: number;
  compactWidth: number;
  compactHeight: number;
  expandedWidth: number;
  expandedHeight: number;
  cornerRadius: number;
  backgroundOpacity: number;
  backgroundColor: string;
  blurIntensity: number;
  borderOpacity: number;
  shadowIntensity: number;
  animationSpeed: AnimationSpeed;
  compactAppearance: CompactAppearance;
  expandedAppearance: ExpandedAppearance;
  enableMedia: boolean;
  enableAudio: boolean;
  enableBrightness: boolean;
  enableQuickSettings: boolean;
  showAlbumArtwork: boolean;
  autoExpandOnMusic: boolean;
  autoExpandOnVolume: boolean;
  autoExpandOnBrightness: boolean;
  autoCollapseDelay: number;
}

export interface MprisPlayer {
  busName: string;
  identity: string;
  appKind: 'spotify' | 'firefox' | 'browser' | 'media';
  appLabel: string;
  status: 'Playing' | 'Paused' | 'Stopped';
  title: string;
  artist: string;
  album: string;
  artUrl: string;
  positionSeconds: number;
  lengthSeconds: number;
  canSeek: boolean;
}

export interface AudioDevice {
  id: string;
  name: string;
  origin: string;
}

export interface SystemScenarioState {
  extensionEnabled: boolean;
  activeMonitor: 'primary' | 'secondary';
  players: MprisPlayer[];
  selectedBusName: string | null;
  volumePercent: number;
  isMuted: boolean;
  isMicMuted: boolean;
  outputs: AudioDevice[];
  activeOutputId: string;
  inputs: AudioDevice[];
  activeInputId: string;
  brightnessSupported: boolean;
  brightnessPercent: number;
  wifiAvailable: boolean;
  wifiEnabled: boolean;
  wifiSsid: string;
  bluetoothAvailable: boolean;
  bluetoothEnabled: boolean;
  batteryPresent: boolean;
  batteryPercent: number;
  batteryCharging: boolean;
  nightLightEnabled: boolean;
  dndEnabled: boolean;
}

export const DEFAULT_PREFERENCES: IslandPreferences = {
  islandPosition: 'top-center',
  useCustomPosition: false,
  customX: -1,
  customY: -1,
  monitorMode: 'primary',
  topOffset: 36,
  compactWidth: 224,
  compactHeight: 32,
  expandedWidth: 464,
  expandedHeight: 432,
  cornerRadius: 26,
  backgroundOpacity: 0.04,
  backgroundColor: '#0B0E16',
  blurIntensity: 10,
  borderOpacity: 0.22,
  shadowIntensity: 0.55,
  animationSpeed: 'normal',
  compactAppearance: 'media-progress',
  expandedAppearance: 'full',
  enableMedia: true,
  enableAudio: true,
  enableBrightness: true,
  enableQuickSettings: true,
  showAlbumArtwork: true,
  autoExpandOnMusic: true,
  autoExpandOnVolume: true,
  autoExpandOnBrightness: true,
  autoCollapseDelay: 3000,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatDurationSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

export function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const cleaned = (hex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return { r: 11, g: 14, b: 22 };
  }
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
}

export function getAnimationDurationMs(speed: AnimationSpeed): number {
  if (speed === 'fast') return 185;
  if (speed === 'relaxed') return 410;
  return 280;
}

export function getPlayerPriorityScore(player: MprisPlayer): number {
  const playingBonus = player.status === 'Playing' ? 200 : player.status === 'Paused' ? 100 : 0;
  const titleBonus = player.title ? 20 : 0;
  const appBonus =
    player.appKind === 'spotify'
      ? 100
      : player.appKind === 'firefox' || player.appKind === 'browser'
        ? 60
        : 40;
  return playingBonus + titleBonus + appBonus;
}

export function resolveActivePlayer(
  players: MprisPlayer[],
  selectedBusName: string | null
): MprisPlayer | null {
  if (players.length === 0) return null;
  if (selectedBusName) {
    const manual = players.find((p) => p.busName === selectedBusName);
    if (manual) return manual;
  }
  const sorted = [...players].sort(
    (a, b) => getPlayerPriorityScore(b) - getPlayerPriorityScore(a)
  );
  return sorted[0] ?? null;
}

export function computeIslandDimensions(
  prefs: IslandPreferences,
  state: IslandState,
  viewportWidth: number,
  options?: { hasActiveMedia?: boolean; hudKind?: HudKind }
): { width: number; minHeight: number; borderRadius: number } {
  if (state === 'compact') {
    const hasMedia = options?.hasActiveMedia ?? true;
    const targetW = hasMedia ? prefs.compactWidth : Math.min(prefs.compactWidth, 152);
    const targetH = hasMedia ? prefs.compactHeight : Math.max(26, prefs.compactHeight - 4);
    return {
      width: clamp(targetW, 136, Math.min(420, viewportWidth - 32)),
      minHeight: clamp(targetH, 26, 56),
      borderRadius: 999,
    };
  }
  if (state === 'hud') {
    const isMusic = (options?.hudKind ?? 'music') === 'music';
    return {
      width: isMusic ? clamp(Math.round(prefs.expandedWidth * 0.78), 310, 390) : 268,
      minHeight: isMusic ? 74 : 46,
      borderRadius: isMusic ? clamp(prefs.cornerRadius, 16, 28) : 999,
    };
  }
  if (state === 'focus') {
    return {
      width: clamp(Math.round(prefs.expandedWidth * 1.02), 360, Math.min(700, viewportWidth - 32)),
      minHeight: clamp(Math.round(prefs.expandedHeight * 0.90), 220, 540),
      borderRadius: clamp(prefs.cornerRadius, 12, 40),
    };
  }
  const heightScale = prefs.expandedAppearance === 'controls-compact' ? 0.82 : 1.0;
  return {
    width: clamp(prefs.expandedWidth, 340, Math.min(680, viewportWidth - 32)),
    minHeight: clamp(Math.round(prefs.expandedHeight * heightScale), 220, 540),
    borderRadius: clamp(prefs.cornerRadius, 12, 40),
  };
}

export function computeIslandPosition(
  prefs: IslandPreferences,
  dims: { width: number; minHeight: number },
  desktopWidth: number,
  desktopHeight: number
): { x: number; y: number } {
  const margin = 16;
  const minX = 8;
  const maxX = Math.max(minX, desktopWidth - dims.width - 8);
  const minY = 4;
  const maxY = Math.max(minY, desktopHeight - dims.minHeight - 8);

  if (prefs.useCustomPosition && prefs.customX >= 0 && prefs.customY >= 0) {
    return {
      x: clamp(Math.round(prefs.customX), minX, maxX),
      y: clamp(Math.round(prefs.customY), minY, maxY),
    };
  }

  let x = Math.round((desktopWidth - dims.width) / 2);
  if (prefs.islandPosition === 'top-left') x = margin;
  else if (prefs.islandPosition === 'top-right') x = desktopWidth - dims.width - margin;

  return {
    x: clamp(x, minX, maxX),
    y: clamp(prefs.topOffset, minY, maxY),
  };
}

export interface SongTheme {
  active: boolean;
  accent: { r: number; g: number; b: number };
  accentLight: { r: number; g: number; b: number };
  surfaceTint: { r: number; g: number; b: number };
  cardTint: { r: number; g: number; b: number };
  hex: string;
}

const SONG_THEME_PALETTES = [
  { r: 244, g: 63, b: 94, hex: '#F43F5E' },   // Crimson Rose (The Weeknd / Starboy)
  { r: 168, g: 85, b: 247, hex: '#A855F7' },  // Electric Violet
  { r: 16, g: 185, b: 129, hex: '#10B981' },  // Spotify Emerald
  { r: 245, g: 158, b: 11, hex: '#F59E0B' },  // Sunset Amber
  { r: 56, g: 189, b: 248, hex: '#38BDF8' },  // Nordic Cyan
  { r: 236, g: 72, b: 153, hex: '#EC4899' },  // Neon Magenta
  { r: 99, g: 102, b: 241, hex: '#6366F1' },  // Cosmic Indigo
  { r: 20, g: 184, b: 166, hex: '#14B8A6' },  // Aurora Teal
  { r: 251, g: 113, b: 133, hex: '#FB7185' }, // Coral Velvet
  { r: 59, g: 130, b: 246, hex: '#3B82F6' },  // Cobalt Sapphire
];

export function computeSongTheme(player: MprisPlayer | null): SongTheme {
  if (!player || (!player.title && !player.artist)) {
    return {
      active: false,
      accent: { r: 56, g: 189, b: 248 },
      accentLight: { r: 125, g: 211, b: 252 },
      surfaceTint: { r: 11, g: 14, b: 22 },
      cardTint: { r: 15, g: 23, b: 42 },
      hex: '#38BDF8',
    };
  }

  const key = `${player.title.toLowerCase().trim()}|${player.artist.toLowerCase().trim()}`;
  let chosen = SONG_THEME_PALETTES[0];

  if (key.includes('die for you') || key.includes('weeknd') || key.includes('starboy')) {
    chosen = { r: 244, g: 63, b: 94, hex: '#F43F5E' };
  } else if (key.includes('midnight concrete') || key.includes('kiasmos')) {
    chosen = { r: 56, g: 189, b: 248, hex: '#38BDF8' };
  } else if (key.includes('nordic drift') || key.includes('arnalds')) {
    chosen = { r: 16, g: 185, b: 129, hex: '#10B981' };
  } else if (key.includes('solar echo') || key.includes('bicep')) {
    chosen = { r: 245, g: 158, b: 11, hex: '#F59E0B' };
  } else if (key.includes('veridis quo') || key.includes('daft punk')) {
    chosen = { r: 168, g: 85, b: 247, hex: '#A855F7' };
  } else {
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    chosen = SONG_THEME_PALETTES[Math.abs(hash) % SONG_THEME_PALETTES.length];
  }

  const accent = { r: chosen.r, g: chosen.g, b: chosen.b };
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
    hex: chosen.hex,
  };
}

export function sanitizePreferences(prefs: Partial<IslandPreferences>): IslandPreferences {
  const merged = { ...DEFAULT_PREFERENCES, ...prefs };
  return {
    ...merged,
    customX: merged.customX < 0 ? -1 : clamp(Math.round(merged.customX), 0, 7680),
    customY: merged.customY < 0 ? -1 : clamp(Math.round(merged.customY), 0, 4320),
    topOffset: clamp(merged.topOffset, 4, 120),
    compactWidth: clamp(merged.compactWidth, 150, 420),
    compactHeight: clamp(merged.compactHeight, 26, 56),
    expandedWidth: clamp(merged.expandedWidth, 360, 680),
    expandedHeight: clamp(merged.expandedHeight, 220, 540),
    cornerRadius: clamp(merged.cornerRadius, 12, 40),
    backgroundOpacity: clamp(Number(merged.backgroundOpacity.toFixed(2)), 0.04, 0.90),
    blurIntensity: clamp(Math.round(merged.blurIntensity), 0, 60),
    borderOpacity: clamp(Number(merged.borderOpacity.toFixed(2)), 0.02, 0.45),
    shadowIntensity: clamp(Number(merged.shadowIntensity.toFixed(2)), 0.0, 1.0),
    autoCollapseDelay: clamp(Math.round(merged.autoCollapseDelay), 1200, 8000),
    backgroundColor: /^#[0-9a-fA-F]{6}$/.test(merged.backgroundColor)
      ? merged.backgroundColor.toUpperCase()
      : DEFAULT_PREFERENCES.backgroundColor,
  };
}
