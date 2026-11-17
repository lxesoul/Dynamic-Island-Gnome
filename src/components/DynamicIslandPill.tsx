import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  BatteryCharging,
  BatteryMedium,
  Bell,
  BellOff,
  Bluetooth,
  BluetoothOff,
  ChevronRight,
  Disc3,
  Mic,
  MicOff,
  Minimize2,
  Moon,
  Music2,
  Pause,
  Play,
  PlugZap,
  Settings,
  SkipBack,
  SkipForward,
  Sun,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  FocusModule,
  HudKind,
  IslandPreferences,
  IslandState,
  SystemScenarioState,
  clamp,
  computeIslandDimensions,
  computeIslandPosition,
  computeSongTheme,
  formatDurationSeconds,
  getAnimationDurationMs,
  parseHexColor,
  resolveActivePlayer,
} from '../utils/islandLogic';

interface DynamicIslandPillProps {
  prefs: IslandPreferences;
  islandState: IslandState;
  hudKind: HudKind;
  focusModule: FocusModule;
  system: SystemScenarioState;
  viewportWidth: number;
  viewportHeight?: number;
  onDragPosition?: (x: number, y: number) => void;
  onHoverChange?: (hovering: boolean) => void;
  onChangeState: (state: IslandState, focus?: FocusModule) => void;
  onOpenPrefs: () => void;
  onChangeBlurIntensity?: (nextBlur: number) => void;
  onTogglePlayPause: () => void;
  onNextTrack: () => void;
  onPrevTrack: () => void;
  onSeek: (seconds: number) => void;
  onSelectPlayer: (busName: string) => void;
  onChangeVolume: (pct: number) => void;
  onToggleMute: () => void;
  onToggleMicMute: () => void;
  onSelectOutput: (id: string) => void;
  onSelectInput: (id: string) => void;
  onChangeBrightness: (pct: number) => void;
  onToggleWifi: () => void;
  onToggleBluetooth: () => void;
  onToggleNightLight: () => void;
  onToggleDnd: () => void;
}

const EqualizerBars: React.FC<{ playing: boolean; accentColor?: string }> = ({ playing, accentColor }) => {
  const heights = [0.45, 0.95, 0.6, 0.8];
  return (
    <span className="inline-flex items-center gap-[2px] h-3.5 shrink-0" aria-hidden="true">
      {heights.map((base, idx) => (
        <motion.span
          key={idx}
          style={playing && accentColor ? { backgroundColor: accentColor } : undefined}
          className={`w-[2px] rounded-full ${playing ? 'bg-sky-400' : 'bg-slate-400/50'}`}
          animate={
            playing
              ? {
                  height: [
                    `${Math.round(base * 14)}px`,
                    `${Math.round(((idx % 2 === 0 ? 0.35 : 1.0) * 14))}px`,
                    `${Math.round(base * 14)}px`,
                  ],
                }
              : { height: '4px' }
          }
          transition={
            playing
              ? {
                  duration: 0.72 + idx * 0.12,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }
              : { duration: 0.2 }
          }
        />
      ))}
    </span>
  );
};

export const DynamicIslandPill: React.FC<DynamicIslandPillProps> = ({
  prefs,
  islandState,
  hudKind,
  focusModule,
  system,
  viewportWidth,
  viewportHeight = 550,
  onDragPosition,
  onHoverChange,
  onChangeState,
  onOpenPrefs,
  onChangeBlurIntensity,
  onTogglePlayPause,
  onNextTrack,
  onPrevTrack,
  onSeek,
  onSelectPlayer,
  onChangeVolume,
  onToggleMute,
  onToggleMicMute,
  onSelectOutput,
  onSelectInput,
  onChangeBrightness,
  onToggleWifi,
  onToggleBluetooth,
  onToggleNightLight,
  onToggleDnd,
}) => {
  const pillRef = useRef<HTMLDivElement | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroSeconds, setPomodoroSeconds] = useState(25 * 60);
  const [copiedFlash, setCopiedFlash] = useState(false);

  const activePlayer = resolveActivePlayer(system.players, system.selectedBusName);
  const songTheme = computeSongTheme(prefs.enableMedia ? activePlayer : null);
  const showCompactMedia =
    prefs.enableMedia && activePlayer !== null && prefs.compactAppearance !== 'system-pill';
  const isClassicIdle = islandState === 'compact' && !showCompactMedia && !pomodoroRunning;

  const dims = computeIslandDimensions(prefs, islandState, viewportWidth, {
    hasActiveMedia: showCompactMedia,
    hudKind,
  });

  const pos = computeIslandPosition(prefs, dims, viewportWidth, viewportHeight);

  const baseRgb = parseHexColor(prefs.backgroundColor);
  const r = songTheme.active ? Math.round(baseRgb.r * 0.55 + songTheme.surfaceTint.r * 0.45) : baseRgb.r;
  const g = songTheme.active ? Math.round(baseRgb.g * 0.55 + songTheme.surfaceTint.g * 0.45) : baseRgb.g;
  const b = songTheme.active ? Math.round(baseRgb.b * 0.55 + songTheme.surfaceTint.b * 0.45) : baseRgb.b;
  const topR = clamp(r + 16, 0, 255);
  const topG = clamp(g + 20, 0, 255);
  const topB = clamp(b + 28, 0, 255);
  const topAlpha = clamp(prefs.backgroundOpacity + 0.10, 0.14, 0.90);
  const bottomAlpha = clamp(prefs.backgroundOpacity + 0.14, 0.18, 0.94);
  const blurPx = prefs.blurIntensity > 0 ? clamp(Math.round(prefs.blurIntensity * 0.45), 3, 18) : 0;
  const outerBorderAlpha = clamp(prefs.borderOpacity + 0.06, 0.16, 0.52).toFixed(2);
  const innerBorderAlpha = clamp(prefs.borderOpacity * 0.72, 0.10, 0.28).toFixed(2);
  const borderRgb = songTheme.active
    ? `${Math.round(255 * 0.52 + songTheme.accentLight.r * 0.48)}, ${Math.round(255 * 0.52 + songTheme.accentLight.g * 0.48)}, ${Math.round(255 * 0.52 + songTheme.accentLight.b * 0.48)}`
    : '255, 255, 255';
  const isFixedPillState = islandState === 'compact' || islandState === 'hud';

  const durationSec = getAnimationDurationMs(prefs.animationSpeed) / 1000;

  useEffect(() => {
    if (!pomodoroRunning) return;
    const id = window.setInterval(() => {
      setPomodoroSeconds((prev) => {
        if (prev <= 1) {
          setPomodoroRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [pomodoroRunning]);

  useEffect(() => {
    return () => {
      setIsDragging(false);
    };
  }, []);

  const handleCopyTrack = async () => {
    const text = activePlayer
      ? `${activePlayer.title} — ${activePlayer.artist}`
      : 'GNOME Dynamic Island · By Lxe Soul · RAM 38%';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Ignore in restricted frames
    }
    setCopiedFlash(true);
    window.setTimeout(() => setCopiedFlash(false), 1500);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !onDragPosition) return;
    const target = e.target as HTMLElement | null;
    if (
      islandState !== 'compact' &&
      target?.closest('button, input, select, a') &&
      !target.closest('[data-drag-handle="true"]')
    ) {
      return;
    }

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const originX = pos.x;
    const originY = pos.y;
    const rect = pillRef.current?.getBoundingClientRect();
    const actualWidth = rect?.width ?? dims.width;
    const actualHeight = rect?.height ?? dims.minHeight;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      if (!moved && Math.hypot(dx, dy) >= 5) {
        moved = true;
        setIsDragging(true);
      }
      if (moved) {
        const minX = 8;
        const maxX = Math.max(minX, viewportWidth - actualWidth - 8);
        const minY = 4;
        const maxY = Math.max(minY, viewportHeight - actualHeight - 8);
        onDragPosition(
          clamp(Math.round(originX + dx), minX, maxX),
          clamp(Math.round(originY + dy), minY, maxY)
        );
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setIsDragging(false);
      if (moved) {
        suppressClickUntilRef.current = performance.now() + 200;
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <motion.div
      ref={pillRef}
      data-testid="dynamic-island-pill"
      data-island-state={islandState}
      data-hud-kind={islandState === 'hud' ? hudKind : undefined}
      initial={false}
      animate={{
        left: pos.x,
        top: pos.y,
        width: dims.width,
        height: isFixedPillState ? dims.minHeight : 'auto',
        borderRadius: dims.borderRadius,
      }}
      transition={{
        duration: isDragging ? 0 : durationSec,
        ease: [0.16, 1, 0.3, 1],
      }}
      onPointerDown={handlePointerDown}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      style={
        isClassicIdle
          ? {
              minHeight: `${dims.minHeight}px`,
              backgroundColor: 'rgba(4, 5, 9, 0.96)',
              borderColor: 'rgba(255, 255, 255, 0.14)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
            }
          : {
              minHeight: isFixedPillState ? undefined : `${dims.minHeight}px`,
              backgroundImage: [
                `linear-gradient(135deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.03) 45%, rgba(0, 0, 0, 0.05) 100%)`,
                `linear-gradient(180deg, rgba(${topR}, ${topG}, ${topB}, ${topAlpha.toFixed(2)}), rgba(${r}, ${g}, ${b}, ${bottomAlpha.toFixed(2)}))`,
              ].join(', '),
              borderColor: `rgba(${borderRgb}, ${outerBorderAlpha})`,
              backdropFilter:
                blurPx > 0 ? `blur(${blurPx}px) saturate(165%) brightness(0.98)` : undefined,
              WebkitBackdropFilter:
                blurPx > 0 ? `blur(${blurPx}px) saturate(165%) brightness(0.98)` : undefined,
              boxShadow: [
                `0 20px 48px rgba(0, 0, 0, ${(prefs.shadowIntensity * 0.50).toFixed(2)})`,
                `0 4px 12px rgba(0, 0, 0, ${(prefs.shadowIntensity * 0.24).toFixed(2)})`,
                `inset 0 0 0 1px rgba(${borderRgb}, ${innerBorderAlpha})`,
                `inset 0 1px 0 rgba(255, 255, 255, 0.34)`,
              ].join(', '),
            }
      }
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenPrefs();
      }}
      className={`absolute z-30 border text-slate-100 overflow-hidden select-none ${
        isDragging ? 'cursor-grabbing' : ''
      }`}
    >
      <AnimatePresence mode="wait" initial={false}>
        {islandState === 'compact' && (
          <motion.button
            key="compact"
            type="button"
            aria-label="Expand Dynamic Island"
            onClick={() => {
              if (performance.now() < suppressClickUntilRef.current) return;
              onChangeState('expanded');
            }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: Math.min(0.11, durationSec * 0.45) }}
            style={{ height: `${dims.minHeight}px` }}
            className={`relative w-full px-2.5 flex items-center justify-between gap-2 text-left hover:bg-white/[0.04] transition-colors focus-visible:outline-none ${
              isDragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          >
            {showCompactMedia && activePlayer ? (
              <>
                <div className="flex items-center gap-2 min-w-0">
                  {prefs.showAlbumArtwork ? (
                    <motion.img
                      key={activePlayer.artUrl}
                      initial={{ opacity: 0.4, scale: 0.88 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.25 }}
                      src={activePlayer.artUrl}
                      alt={`${activePlayer.title} artwork`}
                      referrerPolicy="no-referrer"
                      style={{ borderColor: `rgba(${songTheme.accent.r}, ${songTheme.accent.g}, ${songTheme.accent.b}, 0.6)` }}
                      className="w-6 h-6 rounded-full object-cover shrink-0 border shadow-sm"
                    />
                  ) : (
                    <span className="w-6 h-6 rounded-full bg-sky-400/20 border border-white/30 flex items-center justify-center shrink-0">
                      <Music2 className="w-3.5 h-3.5 text-sky-300" />
                    </span>
                  )}
                  <span className="text-xs font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)] truncate">
                    {activePlayer.title}
                  </span>
                </div>
                <div
                  style={{
                    backgroundColor: `rgba(${songTheme.accent.r}, ${songTheme.accent.g}, ${songTheme.accent.b}, 0.18)`,
                    borderColor: `rgba(${songTheme.accent.r}, ${songTheme.accent.g}, ${songTheme.accent.b}, 0.42)`,
                  }}
                  className="px-2 py-0.5 rounded-full border flex items-center gap-1.5 shrink-0"
                >
                  {prefs.compactAppearance === 'media-progress' ? (
                    <EqualizerBars playing={activePlayer.status === 'Playing'} accentColor={songTheme.hex} />
                  ) : activePlayer.status === 'Playing' ? (
                    <Pause className="w-3.5 h-3.5 text-white" />
                  ) : (
                    <Play className="w-3.5 h-3.5 text-slate-200" />
                  )}
                </div>
              </>
            ) : pomodoroRunning ? (
              <div className="w-full flex items-center justify-center gap-2">
                <span className="text-xs font-mono font-bold text-emerald-300 tabular-nums">
                  ⏱ {formatDurationSeconds(pomodoroSeconds)}
                </span>
              </div>
            ) : (
              /* Classic Black Apple Dynamic Island Hardware Capsule when idle (no music playing) */
              <div
                data-testid="classic-black-capsule"
                className="w-full flex items-center justify-between px-1"
              >
                <span
                  data-testid="classic-sensor-dot"
                  className="w-2.5 h-2.5 rounded-full bg-[#11141c] border border-white/[0.06] shrink-0"
                />
                <span className="flex-1" />
                <span
                  data-testid="classic-camera-lens"
                  className="w-3.5 h-3.5 rounded-full bg-[#0c1428] border border-sky-400/30 flex items-center justify-center shrink-0"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400/70" />
                </span>
              </div>
            )}
          </motion.button>
        )}

        {islandState === 'hud' && (
          <motion.div
            key={`hud-${hudKind}`}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: Math.min(0.11, durationSec * 0.45) }}
            style={{ height: `${dims.minHeight}px` }}
            className="px-3.5 flex items-center gap-3"
          >
            {hudKind === 'music' && activePlayer ? (
              <>
                <button
                  type="button"
                  aria-label="Open expanded media panel"
                  onClick={() => onChangeState('expanded')}
                  className="flex items-center gap-3 min-w-0 flex-1 text-left"
                >
                  {prefs.showAlbumArtwork ? (
                    <motion.img
                      key={activePlayer.artUrl}
                      initial={{ opacity: 0.4, scale: 0.86 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.25 }}
                      src={activePlayer.artUrl}
                      alt={`${activePlayer.title} cover`}
                      referrerPolicy="no-referrer"
                      className="w-11 h-11 rounded-full object-cover shrink-0 border border-white/30"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-sky-400/20 border border-white/30 flex items-center justify-center shrink-0">
                      <Disc3 className="w-5 h-5 text-sky-300" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)] truncate">
                      {activePlayer.title}
                    </div>
                    <div className="text-[11px] text-slate-200 truncate">
                      {activePlayer.artist} · {activePlayer.appLabel}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  aria-label={activePlayer.status === 'Playing' ? 'Pause playback' : 'Resume playback'}
                  onClick={onTogglePlayPause}
                  style={{
                    backgroundColor: `rgba(${songTheme.accent.r}, ${songTheme.accent.g}, ${songTheme.accent.b}, 0.90)`,
                  }}
                  className="w-9 h-9 rounded-full border border-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] flex items-center justify-center text-slate-950 shrink-0 transition-colors"
                >
                  {activePlayer.status === 'Playing' ? (
                    <Pause className="w-3.5 h-3.5 fill-current" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                  )}
                </button>
              </>
            ) : (
              <button
                type="button"
                aria-label="Expand indicator"
                onClick={() => onChangeState('expanded')}
                className="w-full flex items-center gap-2.5 text-left"
              >
                <span className="w-7 h-7 rounded-full bg-white/[0.14] border border-white/30 flex items-center justify-center shrink-0">
                  {hudKind === 'volume' ? (
                    system.isMuted ? (
                      <VolumeX className="w-3.5 h-3.5 text-rose-300" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-sky-300" />
                    )
                  ) : (
                    <Sun className="w-3.5 h-3.5 text-amber-300" />
                  )}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-white/20 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-150 ${
                      hudKind === 'volume' ? 'bg-sky-400' : 'bg-amber-300'
                    }`}
                    style={{
                      width: `${
                        hudKind === 'volume'
                          ? system.isMuted
                            ? 0
                            : system.volumePercent
                          : system.brightnessPercent
                      }%`,
                    }}
                  />
                </div>
                <span className="text-xs font-mono font-bold tabular-nums text-white w-9 text-right">
                  {hudKind === 'volume'
                    ? system.isMuted
                      ? '0%'
                      : `${system.volumePercent}%`
                    : `${system.brightnessPercent}%`}
                </span>
              </button>
            )}
          </motion.div>
        )}

        {islandState === 'expanded' && (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: Math.min(0.12, durationSec * 0.5) }}
            className="p-4 flex flex-col gap-2.5"
          >
            {/* Header (drag handle & tap-to-minimize) */}
            <div
              data-drag-handle="true"
              onClick={(e) => {
                if (performance.now() < suppressClickUntilRef.current) return;
                if ((e.target as HTMLElement).closest('button')) return;
                onChangeState('compact');
              }}
              className="flex items-center justify-between gap-2 pb-0.5 cursor-grab active:cursor-grabbing"
            >
              <div data-drag-handle="true" className="flex items-center gap-2">
                {activePlayer && prefs.showAlbumArtwork ? (
                  <img
                    data-drag-handle="true"
                    src={activePlayer.artUrl}
                    alt={`${activePlayer.title} banner`}
                    referrerPolicy="no-referrer"
                    style={{
                      borderColor: `rgba(${songTheme.accent.r}, ${songTheme.accent.g}, ${songTheme.accent.b}, 0.65)`,
                    }}
                    className="w-6 h-6 rounded-full object-cover border shadow-sm"
                  />
                ) : (
                  <span
                    data-drag-handle="true"
                    style={{
                      backgroundColor: `rgba(${songTheme.accent.r}, ${songTheme.accent.g}, ${songTheme.accent.b}, 0.25)`,
                      borderColor: `rgba(${songTheme.accent.r}, ${songTheme.accent.g}, ${songTheme.accent.b}, 0.50)`,
                    }}
                    className="w-6 h-6 rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] flex items-center justify-center text-white"
                  >
                    <Music2 className="w-3.5 h-3.5" />
                  </span>
                )}
                <span
                  data-drag-handle="true"
                  className="text-xs font-bold tracking-wide text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]"
                >
                  Dynamic Island
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Open Extension Preferences"
                  onClick={onOpenPrefs}
                  className="w-8 h-8 rounded-full bg-white/[0.14] hover:bg-white/[0.24] border border-white/[0.28] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] flex items-center justify-center text-white transition-colors"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Collapse Dynamic Island"
                  onClick={() => onChangeState('compact')}
                  className="w-8 h-8 rounded-full bg-white/[0.14] hover:bg-white/[0.24] border border-white/[0.28] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] flex items-center justify-center text-white transition-colors"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* A. Music Player Section */}
            {prefs.enableMedia && (
              <div
                style={
                  songTheme.active
                    ? {
                        backgroundColor: `rgba(${songTheme.cardTint.r}, ${songTheme.cardTint.g}, ${songTheme.cardTint.b}, 0.28)`,
                        borderColor: `rgba(${songTheme.accent.r}, ${songTheme.accent.g}, ${songTheme.accent.b}, 0.42)`,
                      }
                    : undefined
                }
                className="rounded-[22px] bg-slate-950/20 border border-white/[0.22] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] p-3 flex flex-col gap-2.5 transition-colors duration-300"
              >
                {activePlayer ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        aria-label={`Open focus view for ${activePlayer.title}`}
                        onClick={() => onChangeState('focus', 'media')}
                        className="flex items-center gap-3 min-w-0 text-left group"
                      >
                        {prefs.showAlbumArtwork ? (
                          <motion.img
                            key={activePlayer.artUrl}
                            initial={{ opacity: 0.4, scale: 0.88 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.25 }}
                            src={activePlayer.artUrl}
                            alt={`${activePlayer.title} album art`}
                            referrerPolicy="no-referrer"
                            style={{
                              borderColor: `rgba(${songTheme.accent.r}, ${songTheme.accent.g}, ${songTheme.accent.b}, 0.65)`,
                            }}
                            className="w-11 h-11 rounded-full object-cover shrink-0 border shadow-sm group-hover:brightness-110 transition"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-full bg-sky-400/20 border border-white/30 flex items-center justify-center shrink-0">
                            <Disc3 className="w-5 h-5 text-sky-300" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)] truncate group-hover:text-sky-300 transition-colors">
                            {activePlayer.title}
                          </div>
                          <div className="text-xs text-slate-200/90 truncate">
                            {activePlayer.artist} · {activePlayer.appLabel}
                          </div>
                        </div>
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          aria-label="Previous track"
                          onClick={onPrevTrack}
                          className="w-8 h-8 rounded-full bg-white/[0.14] hover:bg-white/[0.25] border border-white/[0.28] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] flex items-center justify-center text-white transition-colors"
                        >
                          <SkipBack className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={activePlayer.status === 'Playing' ? 'Pause playback' : 'Resume playback'}
                          onClick={onTogglePlayPause}
                          style={{
                            backgroundColor: `rgba(${songTheme.accent.r}, ${songTheme.accent.g}, ${songTheme.accent.b}, 0.90)`,
                          }}
                          className="w-9 h-9 rounded-full border border-white/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] flex items-center justify-center text-slate-950 transition-colors"
                        >
                          {activePlayer.status === 'Playing' ? (
                            <Pause className="w-4 h-4 fill-current" />
                          ) : (
                            <Play className="w-4 h-4 fill-current ml-0.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          aria-label="Next track"
                          onClick={onNextTrack}
                          className="w-8 h-8 rounded-full bg-white/[0.14] hover:bg-white/[0.25] border border-white/[0.28] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] flex items-center justify-center text-white transition-colors"
                        >
                          <SkipForward className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {activePlayer.lengthSeconds > 0 && (
                      <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums text-slate-200">
                        <span>{formatDurationSeconds(activePlayer.positionSeconds)}</span>
                        <input
                          type="range"
                          aria-label="Playback progress"
                          min={0}
                          max={activePlayer.lengthSeconds}
                          value={activePlayer.positionSeconds}
                          onChange={(e) => onSeek(Number(e.target.value))}
                          className="flex-1 accent-sky-400 h-1 cursor-pointer"
                        />
                        <span>{formatDurationSeconds(activePlayer.lengthSeconds)}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-full bg-sky-400/20 border border-white/30 flex items-center justify-center shrink-0">
                        <Disc3 className="w-5 h-5 text-sky-300" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white truncate">Music & Media</div>
                        <div className="text-xs text-slate-200/85 truncate">
                          Play in Spotify or browser to sync
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        aria-label="Previous track"
                        onClick={onPrevTrack}
                        className="w-8 h-8 rounded-full bg-white/[0.14] hover:bg-white/[0.25] border border-white/[0.28] flex items-center justify-center text-white transition-colors"
                      >
                        <SkipBack className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Resume playback"
                        onClick={onTogglePlayPause}
                        className="w-9 h-9 rounded-full bg-sky-400 hover:bg-sky-300 border border-white/45 flex items-center justify-center text-slate-950 transition-colors"
                      >
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Next track"
                        onClick={onNextTrack}
                        className="w-8 h-8 rounded-full bg-white/[0.14] hover:bg-white/[0.25] border border-white/[0.28] flex items-center justify-center text-white transition-colors"
                      >
                        <SkipForward className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* B. Audio Controls Section */}
            {prefs.enableAudio && (
              <div className="rounded-[22px] bg-slate-950/20 border border-white/[0.22] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] px-3 py-2.5 flex items-center gap-2.5">
                <button
                  type="button"
                  aria-label={system.isMuted ? 'Unmute master volume' : 'Mute master volume'}
                  onClick={onToggleMute}
                  className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.32)] transition-colors ${
                    system.isMuted
                      ? 'bg-rose-500/35 border-rose-300/50 text-rose-100'
                      : 'bg-white/[0.14] hover:bg-white/[0.24] border-white/[0.28] text-white'
                  }`}
                >
                  {system.isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>
                <input
                  type="range"
                  aria-label="Master Volume"
                  min={0}
                  max={100}
                  value={system.isMuted ? 0 : system.volumePercent}
                  onChange={(e) => onChangeVolume(Number(e.target.value))}
                  className="flex-1 accent-sky-400 h-1.5 cursor-pointer"
                />
                <span className="text-xs font-mono font-bold tabular-nums text-white w-9 text-right">
                  {system.isMuted ? '0%' : `${system.volumePercent}%`}
                </span>
                <button
                  type="button"
                  aria-label={system.isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
                  disabled={system.inputs.length === 0}
                  onClick={onToggleMicMute}
                  className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.32)] transition-colors disabled:opacity-40 ${
                    system.isMicMuted
                      ? 'bg-rose-500/35 border-rose-300/50 text-rose-100'
                      : 'bg-white/[0.14] hover:bg-white/[0.24] border-white/[0.28] text-white'
                  }`}
                >
                  {system.isMicMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  aria-label="Audio routing focus view"
                  onClick={() => onChangeState('focus', 'audio')}
                  className="w-8 h-8 rounded-full bg-white/[0.14] hover:bg-white/[0.24] border border-white/[0.28] shadow-[inset_0_1px_0_rgba(255,255,255,0.32)] flex items-center justify-center text-white shrink-0 transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* C. Brightness Section */}
            {prefs.enableBrightness && prefs.expandedAppearance !== 'media-focused' && (
              <div className="rounded-[22px] bg-slate-950/20 border border-white/[0.22] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] px-3 py-2.5 flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-full bg-amber-400/20 border border-white/[0.28] shadow-[inset_0_1px_0_rgba(255,255,255,0.32)] flex items-center justify-center shrink-0">
                  <Sun className="w-4 h-4 text-amber-200" />
                </span>
                {system.brightnessSupported ? (
                  <>
                    <input
                      type="range"
                      aria-label="Display Brightness"
                      min={1}
                      max={100}
                      value={system.brightnessPercent}
                      onChange={(e) => onChangeBrightness(Number(e.target.value))}
                      className="flex-1 accent-amber-300 h-1.5 cursor-pointer"
                    />
                    <span className="text-xs font-mono font-bold tabular-nums text-white w-9 text-right">
                      {system.brightnessPercent}%
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-slate-200/85">
                    Brightness unsupported (external display)
                  </span>
                )}
              </div>
            )}

            {/* D. Quick Settings Section */}
            {prefs.enableQuickSettings && prefs.expandedAppearance === 'full' && (
              <div className="grid grid-cols-5 gap-2">
                <button
                  type="button"
                  aria-label="Toggle Wi-Fi"
                  disabled={!system.wifiAvailable}
                  onClick={onToggleWifi}
                  className={`rounded-[20px] py-2 px-1.5 border flex flex-col items-center justify-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    system.wifiAvailable && system.wifiEnabled
                      ? 'bg-sky-400/25 border-sky-300/60 text-white'
                      : 'bg-slate-950/20 border-white/[0.22] text-slate-100 hover:bg-white/[0.15]'
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-full border flex items-center justify-center ${
                      system.wifiAvailable && system.wifiEnabled
                        ? 'bg-sky-400/40 border-white/45'
                        : 'bg-white/[0.14] border-white/25'
                    }`}
                  >
                    {system.wifiAvailable && system.wifiEnabled ? (
                      <Wifi className="w-3.5 h-3.5" />
                    ) : (
                      <WifiOff className="w-3.5 h-3.5" />
                    )}
                  </span>
                  <span className="text-[10.5px] font-bold truncate max-w-full">
                    {!system.wifiAvailable ? 'No Wi-Fi' : system.wifiEnabled ? 'Wi-Fi' : 'Off'}
                  </span>
                </button>

                <button
                  type="button"
                  aria-label="Toggle Bluetooth"
                  disabled={!system.bluetoothAvailable}
                  onClick={onToggleBluetooth}
                  className={`rounded-[20px] py-2 px-1.5 border flex flex-col items-center justify-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    system.bluetoothAvailable && system.bluetoothEnabled
                      ? 'bg-sky-400/25 border-sky-300/60 text-white'
                      : 'bg-slate-950/20 border-white/[0.22] text-slate-100 hover:bg-white/[0.15]'
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-full border flex items-center justify-center ${
                      system.bluetoothAvailable && system.bluetoothEnabled
                        ? 'bg-sky-400/40 border-white/45'
                        : 'bg-white/[0.14] border-white/25'
                    }`}
                  >
                    {system.bluetoothAvailable && system.bluetoothEnabled ? (
                      <Bluetooth className="w-3.5 h-3.5" />
                    ) : (
                      <BluetoothOff className="w-3.5 h-3.5" />
                    )}
                  </span>
                  <span className="text-[10.5px] font-bold truncate max-w-full">
                    {!system.bluetoothAvailable ? 'No BT' : system.bluetoothEnabled ? 'BT On' : 'BT Off'}
                  </span>
                </button>

                <button
                  type="button"
                  aria-label="Inspect battery and hardware status"
                  onClick={() => onChangeState('focus', 'quickSettings')}
                  className={`rounded-[20px] py-2 px-1.5 border flex flex-col items-center justify-center gap-1 transition-colors ${
                    system.batteryPresent && system.batteryCharging
                      ? 'bg-emerald-400/25 border-emerald-300/60 text-white'
                      : 'bg-slate-950/20 border-white/[0.22] text-slate-100 hover:bg-white/[0.15]'
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-full border flex items-center justify-center ${
                      system.batteryPresent && system.batteryCharging
                        ? 'bg-emerald-400/40 border-white/45'
                        : 'bg-white/[0.14] border-white/25'
                    }`}
                  >
                    {system.batteryPresent ? (
                      system.batteryCharging ? (
                        <BatteryCharging className="w-3.5 h-3.5" />
                      ) : (
                        <BatteryMedium className="w-3.5 h-3.5" />
                      )
                    ) : (
                      <PlugZap className="w-3.5 h-3.5" />
                    )}
                  </span>
                  <span className="text-[10.5px] font-mono tabular-nums font-bold">
                    {system.batteryPresent ? `${system.batteryPercent}%` : 'AC'}
                  </span>
                </button>

                <button
                  type="button"
                  aria-label="Toggle Do Not Disturb"
                  onClick={onToggleDnd}
                  className={`rounded-[20px] py-2 px-1.5 border flex flex-col items-center justify-center gap-1 transition-colors ${
                    system.dndEnabled
                      ? 'bg-sky-400/25 border-sky-300/60 text-white'
                      : 'bg-slate-950/20 border-white/[0.22] text-slate-100 hover:bg-white/[0.15]'
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-full border flex items-center justify-center ${
                      system.dndEnabled
                        ? 'bg-sky-400/40 border-white/45'
                        : 'bg-white/[0.14] border-white/25'
                    }`}
                  >
                    {system.dndEnabled ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
                  </span>
                  <span className="text-[10.5px] font-bold">DND</span>
                </button>

                <button
                  type="button"
                  aria-label="Toggle Night Light"
                  onClick={onToggleNightLight}
                  className={`rounded-[20px] py-2 px-1.5 border flex flex-col items-center justify-center gap-1 transition-colors ${
                    system.nightLightEnabled
                      ? 'bg-amber-400/25 border-amber-300/60 text-white'
                      : 'bg-slate-950/20 border-white/[0.22] text-slate-100 hover:bg-white/[0.15]'
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-full border flex items-center justify-center ${
                      system.nightLightEnabled
                        ? 'bg-amber-400/40 border-white/45'
                        : 'bg-white/[0.14] border-white/25'
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5" />
                  </span>
                  <span className="text-[10.5px] font-bold">Night</span>
                </button>
              </div>
            )}

            {/* E. Interactive Utility & Blur Studio Bar */}
            {prefs.expandedAppearance === 'full' && (
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <button
                  type="button"
                  aria-label="Toggle Pomodoro Focus Timer"
                  onClick={() => {
                    if (!pomodoroRunning && pomodoroSeconds === 0) {
                      setPomodoroSeconds(25 * 60);
                    }
                    setPomodoroRunning((r) => !r);
                  }}
                  className={`flex-1 rounded-full py-1.5 px-2.5 border text-[11px] font-bold font-mono tabular-nums flex items-center justify-center gap-1 transition-colors ${
                    pomodoroRunning
                      ? 'bg-emerald-500/25 border-emerald-300/60 text-emerald-100'
                      : 'bg-slate-950/25 border-white/[0.22] text-slate-100 hover:bg-white/[0.16]'
                  }`}
                >
                  <span>⏱ {formatDurationSeconds(pomodoroSeconds)}</span>
                </button>

                <div className="rounded-full p-0.5 bg-slate-950/25 border border-white/[0.22] flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label="Decrease Blur Intensity"
                    onClick={() => onChangeBlurIntensity?.(clamp(prefs.blurIntensity - 4, 0, 60))}
                    className="w-6 h-6 rounded-full bg-white/[0.14] hover:bg-white/[0.26] border border-white/[0.24] text-xs font-bold text-white flex items-center justify-center transition-colors"
                  >
                    −
                  </button>
                  <span className="text-[10.5px] font-mono font-bold tabular-nums text-slate-100 px-1">
                    Blur {prefs.blurIntensity}px
                  </span>
                  <button
                    type="button"
                    aria-label="Increase Blur Intensity"
                    onClick={() => onChangeBlurIntensity?.(clamp(prefs.blurIntensity + 4, 0, 60))}
                    className="w-6 h-6 rounded-full bg-white/[0.14] hover:bg-white/[0.26] border border-white/[0.24] text-xs font-bold text-white flex items-center justify-center transition-colors"
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  aria-label="Copy current track or system telemetry"
                  onClick={handleCopyTrack}
                  className={`rounded-full py-1.5 px-2.5 border text-[11px] font-bold flex items-center justify-center shrink-0 transition-colors ${
                    copiedFlash
                      ? 'bg-emerald-500/25 border-emerald-300/60 text-emerald-100'
                      : 'bg-slate-950/25 border-white/[0.22] text-slate-100 hover:bg-white/[0.16]'
                  }`}
                >
                  {copiedFlash ? '✓ Copied' : '📋 Copy'}
                </button>

                <button
                  type="button"
                  aria-label="Open System Pulse and Studio"
                  onClick={() => onChangeState('focus', 'quickSettings')}
                  className="rounded-full py-1.5 px-2.5 border bg-slate-950/25 border-white/[0.22] text-[11px] font-mono font-bold tabular-nums text-slate-100 hover:bg-white/[0.16] shrink-0 transition-colors"
                >
                  ⚡ 38%
                </button>
              </div>
            )}
          </motion.div>
        )}

        {islandState === 'focus' && (
          <motion.div
            key={`focus-${focusModule}`}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: Math.min(0.12, durationSec * 0.5) }}
            className="p-4 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Back to expanded view"
                  onClick={() => onChangeState('expanded')}
                  className="p-1.5 rounded-full bg-white/[0.07] hover:bg-white/[0.15] text-slate-100 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs font-semibold text-slate-100">
                  {focusModule === 'media'
                    ? 'Media Player · MPRIS D-Bus'
                    : focusModule === 'audio'
                      ? 'Audio Routing · PipeWire / Gvc'
                      : 'System Hardware Interfaces'}
                </span>
              </div>
              <button
                type="button"
                aria-label="Collapse Dynamic Island"
                onClick={() => onChangeState('compact')}
                className="p-1.5 rounded-full bg-white/[0.07] hover:bg-white/[0.15] text-slate-200 transition-colors"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {focusModule === 'media' && (
              <>
                {activePlayer ? (
                  <div className="rounded-2xl bg-white/[0.045] border border-white/[0.08] p-3.5 flex flex-col gap-3">
                    <div className="flex items-center gap-3.5">
                      {prefs.showAlbumArtwork ? (
                        <motion.img
                          key={activePlayer.artUrl}
                          initial={{ opacity: 0.4, scale: 0.88 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.25 }}
                          src={activePlayer.artUrl}
                          alt={`${activePlayer.title} artwork`}
                          referrerPolicy="no-referrer"
                          className="w-16 h-16 rounded-xl object-cover shrink-0 border border-white/15"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-xl bg-white/[0.08] flex items-center justify-center shrink-0">
                          <Disc3 className="w-7 h-7 text-slate-300" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-white truncate">{activePlayer.title}</div>
                        <div className="text-xs text-slate-200/90 truncate">{activePlayer.artist}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                          {activePlayer.album || activePlayer.appLabel} · {activePlayer.appLabel}
                        </div>
                      </div>
                    </div>

                    {activePlayer.lengthSeconds > 0 && (
                      <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums text-slate-300/80">
                        <span>{formatDurationSeconds(activePlayer.positionSeconds)}</span>
                        <input
                          type="range"
                          aria-label="Seek track position"
                          min={0}
                          max={activePlayer.lengthSeconds}
                          value={activePlayer.positionSeconds}
                          onChange={(e) => onSeek(Number(e.target.value))}
                          className="flex-1 accent-sky-400 h-1.5 cursor-pointer"
                        />
                        <span>{formatDurationSeconds(activePlayer.lengthSeconds)}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-center gap-3">
                      <button
                        type="button"
                        aria-label="Previous track"
                        onClick={onPrevTrack}
                        className="w-9 h-9 rounded-full bg-white/[0.07] hover:bg-white/[0.16] flex items-center justify-center text-slate-100 transition-colors"
                      >
                        <SkipBack className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={activePlayer.status === 'Playing' ? 'Pause' : 'Play'}
                        onClick={onTogglePlayPause}
                        className="w-10 h-10 rounded-full bg-sky-400 hover:bg-sky-300 flex items-center justify-center text-slate-950 transition-colors"
                      >
                        {activePlayer.status === 'Playing' ? (
                          <Pause className="w-4 h-4 fill-current" />
                        ) : (
                          <Play className="w-4 h-4 fill-current ml-0.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label="Next track"
                        onClick={onNextTrack}
                        className="w-9 h-9 rounded-full bg-white/[0.07] hover:bg-white/[0.16] flex items-center justify-center text-slate-100 transition-colors"
                      >
                        <SkipForward className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-300/75 py-3 text-center">
                    No active MPRIS players found on session D-Bus.
                  </div>
                )}

                {system.players.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium text-slate-300/80">
                      Detected MPRIS Players
                    </span>
                    {system.players.map((p) => {
                      const active = p.busName === activePlayer?.busName;
                      return (
                        <button
                          key={p.busName}
                          type="button"
                          onClick={() => onSelectPlayer(p.busName)}
                          className={`w-full px-3 py-2 rounded-xl border text-left flex items-center justify-between text-xs transition-colors ${
                            active
                              ? 'bg-sky-400/20 border-sky-400/50 text-white'
                              : 'bg-white/[0.045] border-white/[0.07] text-slate-200 hover:bg-white/[0.09]'
                          }`}
                        >
                          <span className="truncate font-medium">
                            {p.appLabel} · {p.title}
                          </span>
                          <span className="text-[11px] text-slate-400 shrink-0 ml-2">{p.status}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {focusModule === 'audio' && (
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-300/80">Output Device (Sink)</span>
                  {system.outputs.map((out) => (
                    <button
                      key={out.id}
                      type="button"
                      onClick={() => onSelectOutput(out.id)}
                      className={`w-full px-3 py-2 rounded-xl border text-left flex items-center justify-between text-xs transition-colors ${
                        out.id === system.activeOutputId
                          ? 'bg-sky-400/20 border-sky-400/50 text-white'
                          : 'bg-white/[0.045] border-white/[0.07] text-slate-200 hover:bg-white/[0.09]'
                      }`}
                    >
                      <span className="truncate font-medium">{out.name}</span>
                      <span className="text-[11px] text-slate-400 shrink-0 ml-2">{out.origin}</span>
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-300/80">Input Device (Microphone)</span>
                  {system.inputs.length > 0 ? (
                    system.inputs.map((inp) => (
                      <button
                        key={inp.id}
                        type="button"
                        onClick={() => onSelectInput(inp.id)}
                        className={`w-full px-3 py-2 rounded-xl border text-left flex items-center justify-between text-xs transition-colors ${
                          inp.id === system.activeInputId
                            ? 'bg-sky-400/20 border-sky-400/50 text-white'
                            : 'bg-white/[0.045] border-white/[0.07] text-slate-200 hover:bg-white/[0.09]'
                        }`}
                      >
                        <span className="truncate font-medium">{inp.name}</span>
                        <span className="text-[11px] text-slate-400 shrink-0 ml-2">{inp.origin}</span>
                      </button>
                    ))
                  ) : (
                    <div className="text-xs text-slate-400 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                      No microphone input stream detected
                    </div>
                  )}
                </div>
              </div>
            )}

            {focusModule === 'quickSettings' && (
              <div className="rounded-2xl bg-white/[0.045] border border-white/[0.08] p-3 flex flex-col gap-2 text-xs">
                <div className="flex items-center justify-between py-1 border-b border-white/[0.06]">
                  <span className="text-slate-400">NetworkManager Wi-Fi</span>
                  <span className="font-mono text-slate-200">
                    {!system.wifiAvailable
                      ? 'Unavailable (No Radio)'
                      : system.wifiEnabled
                        ? `Connected · ${system.wifiSsid}`
                        : 'Disabled'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-white/[0.06]">
                  <span className="text-slate-400">BlueZ / Gsd.Rfkill</span>
                  <span className="font-mono text-slate-200">
                    {!system.bluetoothAvailable
                      ? 'No Bluetooth Adapter'
                      : system.bluetoothEnabled
                        ? 'Powered On'
                        : 'Airplane / Off'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-white/[0.06]">
                  <span className="text-slate-400">UPower DisplayDevice</span>
                  <span className="font-mono tabular-nums text-slate-200">
                    {system.batteryPresent
                      ? `${system.batteryPercent}% (${system.batteryCharging ? 'Charging' : 'Discharging'})`
                      : 'AC Power (No Battery)'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-400">Gsd.Power.Screen Backlight</span>
                  <span className="font-mono tabular-nums text-slate-200">
                    {system.brightnessSupported ? `${system.brightnessPercent}%` : 'Unsupported (External)'}
                  </span>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
