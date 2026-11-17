import React, { useEffect, useRef, useState } from 'react';
import {
  BatteryCharging,
  BatteryMedium,
  BellOff,
  Bluetooth,
  Monitor,
  Moon,
  Power,
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
  resolveActivePlayer,
} from '../utils/islandLogic';
import { SCENARIO_PRESETS, ScenarioId, WALLPAPER_URL } from '../data/scenarios';
import { DynamicIslandPill } from './DynamicIslandPill';

interface DesktopSimulatorProps {
  prefs: IslandPreferences;
  islandState: IslandState;
  hudKind: HudKind;
  focusModule: FocusModule;
  scenarioId: ScenarioId;
  system: SystemScenarioState;
  onDragPosition?: (x: number, y: number) => void;
  onHoverIsland?: (hovering: boolean) => void;
  onChangeScenario: (id: ScenarioId) => void;
  onChangeState: (state: IslandState, focus?: FocusModule) => void;
  onTriggerHud: (kind: HudKind) => void;
  onOpenPrefs: () => void;
  onChangeBlurIntensity?: (nextBlur: number) => void;
  onUpdateSystem: (updater: (prev: SystemScenarioState) => SystemScenarioState) => void;
}

export const DesktopSimulator: React.FC<DesktopSimulatorProps> = ({
  prefs,
  islandState,
  hudKind,
  focusModule,
  scenarioId,
  system,
  onDragPosition,
  onHoverIsland,
  onChangeScenario,
  onChangeState,
  onTriggerHud,
  onOpenPrefs,
  onChangeBlurIntensity,
  onUpdateSystem,
}) => {
  const [wallpaperError, setWallpaperError] = useState(false);
  const desktopRef = useRef<HTMLDivElement | null>(null);
  const [desktopSize, setDesktopSize] = useState({ width: 1152, height: 550 });

  useEffect(() => {
    const el = desktopRef.current;
    if (!el) return;
    const syncSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDesktopSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
      }
    };
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Advance playback progress cleanly in simulator when a player is Playing
  useEffect(() => {
    const active = resolveActivePlayer(system.players, system.selectedBusName);
    if (!system.extensionEnabled || !active || active.status !== 'Playing') return;

    const timer = window.setInterval(() => {
      onUpdateSystem((prev) => ({
        ...prev,
        players: prev.players.map((p) => {
          if (p.busName !== active.busName || p.status !== 'Playing') return p;
          const nextPos = p.positionSeconds + 1;
          return {
            ...p,
            positionSeconds: nextPos >= p.lengthSeconds ? 0 : nextPos,
          };
        }),
      }));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [system.extensionEnabled, system.players, system.selectedBusName, onUpdateSystem]);

  const activePlayer = resolveActivePlayer(system.players, system.selectedBusName);
  const showOnThisMonitor =
    prefs.monitorMode === 'all' ||
    (prefs.monitorMode === 'primary' && system.activeMonitor === 'primary') ||
    prefs.monitorMode === 'follow-focus';

  const handleTogglePlayPause = () => {
    if (!activePlayer) return;
    const willPlay = activePlayer.status !== 'Playing';
    onUpdateSystem((prev) => ({
      ...prev,
      players: prev.players.map((p) =>
        p.busName === activePlayer.busName
          ? { ...p, status: willPlay ? 'Playing' : 'Paused' }
          : p
      ),
    }));
    if (willPlay && prefs.autoExpandOnMusic && islandState === 'compact') {
      onTriggerHud('music');
    }
  };

  const handleNextOrPrev = (delta: number) => {
    const demoTracks = [
      {
        title: 'Midnight Concrete',
        artist: 'Kiasmos',
        album: 'Blurred EP',
        artUrl: '/src/assets/images/album_cover_midnight_synth_1794895783810.jpg',
        lengthSeconds: 248,
      },
      {
        title: 'Nordic Drift (Live Session)',
        artist: 'Ólafur Arnalds',
        album: 'Reykjavík Sessions',
        artUrl: '/src/assets/images/album_cover_nordic_drift_1794895783911.jpg',
        lengthSeconds: 312,
      },
      {
        title: 'Analog Pulse IV',
        artist: 'Rival Consoles',
        album: 'Now Is',
        artUrl: '/src/assets/images/album_cover_analog_pulse_1794895785061.jpg',
        lengthSeconds: 295,
      },
    ];
    if (!activePlayer) return;
    const currentIdx = demoTracks.findIndex((t) => t.title === activePlayer.title);
    const nextIdx =
      ((currentIdx === -1 ? 0 : currentIdx) + delta + demoTracks.length) % demoTracks.length;
    const nextTrack = demoTracks[nextIdx];

    onUpdateSystem((prev) => ({
      ...prev,
      players: prev.players.map((p) =>
        p.busName === activePlayer.busName
          ? {
              ...p,
              ...nextTrack,
              positionSeconds: 0,
              status: 'Playing',
            }
          : p
      ),
    }));

    if (prefs.autoExpandOnMusic && (islandState === 'compact' || islandState === 'hud')) {
      onTriggerHud('music');
    }
  };

  const handleStepVolume = () => {
    onUpdateSystem((prev) => {
      const nextVol = prev.volumePercent >= 90 ? 35 : clamp(prev.volumePercent + 10, 0, 100);
      return { ...prev, volumePercent: nextVol, isMuted: false };
    });
    if (prefs.autoExpandOnVolume && (islandState === 'compact' || islandState === 'hud')) {
      onTriggerHud('volume');
    }
  };

  const handleStepBrightness = () => {
    if (!system.brightnessSupported) return;
    onUpdateSystem((prev) => {
      const nextBright =
        prev.brightnessPercent >= 90 ? 40 : clamp(prev.brightnessPercent + 12, 5, 100);
      return { ...prev, brightnessPercent: nextBright };
    });
    if (prefs.autoExpandOnBrightness && (islandState === 'compact' || islandState === 'hud')) {
      onTriggerHud('brightness');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Control Strip */}
      <div className="flex flex-wrap xl:flex-nowrap items-center justify-between gap-3 bg-[#12151E] border border-white/10 rounded-2xl px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-slate-400 mr-1">Environment:</span>
          {(Object.keys(SCENARIO_PRESETS) as ScenarioId[]).map((id) => {
            const active = scenarioId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onChangeScenario(id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-sky-400/20 text-sky-200 border border-sky-400/45'
                    : 'bg-white/[0.04] text-slate-300 border border-white/[0.06] hover:bg-white/[0.08]'
                }`}
              >
                {SCENARIO_PRESETS[id].label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Island State Switcher */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-black/40 border border-white/[0.07]">
            {(['compact', 'hud', 'expanded', 'focus'] as IslandState[]).map((st) => (
              <button
                key={st}
                type="button"
                disabled={!system.extensionEnabled}
                onClick={() =>
                  st === 'hud'
                    ? onTriggerHud(activePlayer ? 'music' : 'volume')
                    : onChangeState(st, st === 'focus' ? focusModule : undefined)
                }
                className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize whitespace-nowrap transition-colors disabled:opacity-40 ${
                  islandState === st && system.extensionEnabled
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {st === 'hud' ? 'HUD' : st}
              </button>
            ))}
          </div>

          <button
            type="button"
            aria-label="Switch monitor view"
            onClick={() =>
              onUpdateSystem((prev) => ({
                ...prev,
                activeMonitor: prev.activeMonitor === 'primary' ? 'secondary' : 'primary',
              }))
            }
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-slate-200 hover:bg-white/[0.09] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <Monitor className="w-3.5 h-3.5 text-slate-400" />
            <span>{system.activeMonitor === 'primary' ? 'Primary Monitor' : 'Secondary Monitor'}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateSystem((prev) => ({ ...prev, extensionEnabled: !prev.extensionEnabled }))
            }
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
              system.extensionEnabled
                ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/25'
                : 'bg-rose-500/15 border-rose-400/40 text-rose-200 hover:bg-rose-500/25'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{system.extensionEnabled ? 'Extension Enabled' : 'Extension Disabled'}</span>
          </button>
        </div>
      </div>

      {/* Ubuntu 26.04 LTS / GNOME Shell 50.1 Desktop Frame */}
      <div
        ref={desktopRef}
        data-testid="gnome-desktop-frame"
        className="relative w-full h-[550px] rounded-2xl overflow-hidden border border-white/15 bg-[#0a0c12] shadow-2xl"
      >
        {!wallpaperError ? (
          <img
            src={WALLPAPER_URL}
            alt="Ubuntu 26.04 LTS Wayland Desktop Wallpaper"
            referrerPolicy="no-referrer"
            onError={() => setWallpaperError(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-[#171226] to-slate-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/45 pointer-events-none" />

        {/* Native GNOME Shell 50 Top Bar */}
        <div className="relative z-20 h-8 px-3.5 bg-black/70 backdrop-blur-md border-b border-white/[0.08] flex items-center justify-between text-xs text-slate-200">
          <div className="flex items-center gap-3">
            <span className="font-semibold tracking-tight text-white">Activities</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-300">Ubuntu 26.04 LTS (Wayland)</span>
          </div>

          <div className="font-medium text-slate-100 tabular-nums">
            Nov 16 · 22:08
          </div>

          <div className="flex items-center gap-2.5 text-slate-200">
            {system.dndEnabled && <BellOff className="w-3.5 h-3.5 text-sky-300" aria-label="DND active" />}
            {system.nightLightEnabled && <Moon className="w-3.5 h-3.5 text-amber-300" aria-label="Night Light active" />}
            {system.wifiAvailable ? (
              system.wifiEnabled ? (
                <Wifi className="w-3.5 h-3.5" aria-label="Wi-Fi connected" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-slate-500" aria-label="Wi-Fi off" />
              )
            ) : null}
            {system.bluetoothAvailable && system.bluetoothEnabled && (
              <Bluetooth className="w-3.5 h-3.5 text-sky-300" aria-label="Bluetooth active" />
            )}
            {system.isMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-rose-300" aria-label="Audio muted" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" aria-label="Audio active" />
            )}
            {system.batteryPresent && (
              <span className="flex items-center gap-1 font-mono tabular-nums text-[11px]">
                {system.batteryCharging ? (
                  <BatteryCharging className="w-3.5 h-3.5 text-emerald-300" />
                ) : (
                  <BatteryMedium className="w-3.5 h-3.5" />
                )}
                {system.batteryPercent}%
              </span>
            )}
          </div>
        </div>

        {/* Dynamic Island Glass Widget */}
        {system.extensionEnabled && showOnThisMonitor && (
          <DynamicIslandPill
            prefs={prefs}
            islandState={islandState}
            hudKind={hudKind}
            focusModule={focusModule}
            system={system}
            viewportWidth={desktopSize.width}
            viewportHeight={desktopSize.height}
            onDragPosition={onDragPosition}
            onHoverChange={onHoverIsland}
            onChangeState={onChangeState}
            onOpenPrefs={onOpenPrefs}
            onChangeBlurIntensity={onChangeBlurIntensity}
            onTogglePlayPause={handleTogglePlayPause}
            onNextTrack={() => handleNextOrPrev(1)}
            onPrevTrack={() => handleNextOrPrev(-1)}
            onSeek={(sec) => {
              if (!activePlayer) return;
              onUpdateSystem((prev) => ({
                ...prev,
                players: prev.players.map((p) =>
                  p.busName === activePlayer.busName ? { ...p, positionSeconds: sec } : p
                ),
              }));
            }}
            onSelectPlayer={(busName) =>
              onUpdateSystem((prev) => ({ ...prev, selectedBusName: busName }))
            }
            onChangeVolume={(pct) =>
              onUpdateSystem((prev) => ({
                ...prev,
                volumePercent: pct,
                isMuted: pct === 0,
              }))
            }
            onToggleMute={() =>
              onUpdateSystem((prev) => ({ ...prev, isMuted: !prev.isMuted }))
            }
            onToggleMicMute={() =>
              onUpdateSystem((prev) => ({ ...prev, isMicMuted: !prev.isMicMuted }))
            }
            onSelectOutput={(id) =>
              onUpdateSystem((prev) => ({ ...prev, activeOutputId: id }))
            }
            onSelectInput={(id) =>
              onUpdateSystem((prev) => ({ ...prev, activeInputId: id }))
            }
            onChangeBrightness={(pct) =>
              onUpdateSystem((prev) => ({ ...prev, brightnessPercent: pct }))
            }
            onToggleWifi={() =>
              onUpdateSystem((prev) => ({ ...prev, wifiEnabled: !prev.wifiEnabled }))
            }
            onToggleBluetooth={() =>
              onUpdateSystem((prev) => ({ ...prev, bluetoothEnabled: !prev.bluetoothEnabled }))
            }
            onToggleNightLight={() =>
              onUpdateSystem((prev) => ({ ...prev, nightLightEnabled: !prev.nightLightEnabled }))
            }
            onToggleDnd={() =>
              onUpdateSystem((prev) => ({ ...prev, dndEnabled: !prev.dndEnabled }))
            }
          />
        )}

        {/* Disabled / Secondary-Monitor Clean Desktop Banner */}
        {(!system.extensionEnabled || !showOnThisMonitor) && (
          <div className="absolute inset-x-0 top-14 flex justify-center pointer-events-none">
            <div className="px-4 py-2 rounded-xl bg-black/70 border border-white/10 text-xs text-slate-300 backdrop-blur-md">
              {!system.extensionEnabled
                ? 'Extension disabled — BlurEffect removed, signals disconnected, timers cleared, native GNOME Shell desktop restored.'
                : `Monitor mode is set to "${prefs.monitorMode}" — island hidden on secondary monitor.`}
            </div>
          </div>
        )}

        {/* Bottom Smart Hardware Trigger Strip */}
        <div className="absolute inset-x-4 bottom-4 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
          <div className="px-3.5 py-2 rounded-xl bg-black/60 border border-white/10 backdrop-blur-md text-xs text-slate-300 max-w-xl">
            <span className="font-semibold text-white">{SCENARIO_PRESETS[scenarioId].label}:</span>{' '}
            {SCENARIO_PRESETS[scenarioId].summary}
          </div>

          {system.extensionEnabled && (
            <div className="pointer-events-auto flex items-center gap-2">
              {activePlayer && (
                <button
                  type="button"
                  onClick={() => handleNextOrPrev(1)}
                  className="px-3 py-2 rounded-xl bg-black/65 hover:bg-black/85 border border-white/15 text-xs font-medium text-slate-200 flex items-center gap-1.5 backdrop-blur-md transition-colors whitespace-nowrap"
                >
                  <SkipForward className="w-3.5 h-3.5 text-sky-400" />
                  <span>Next Demo Track</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleStepVolume}
                className="px-3 py-2 rounded-xl bg-black/65 hover:bg-black/85 border border-white/15 text-xs font-medium text-slate-200 flex items-center gap-1.5 backdrop-blur-md transition-colors whitespace-nowrap"
              >
                <Volume2 className="w-3.5 h-3.5 text-sky-400" />
                <span>Volume Key</span>
              </button>
              {system.brightnessSupported && (
                <button
                  type="button"
                  onClick={handleStepBrightness}
                  className="px-3 py-2 rounded-xl bg-black/65 hover:bg-black/85 border border-white/15 text-xs font-medium text-slate-200 flex items-center gap-1.5 backdrop-blur-md transition-colors whitespace-nowrap"
                >
                  <Sun className="w-3.5 h-3.5 text-amber-300" />
                  <span>Brightness Key</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
