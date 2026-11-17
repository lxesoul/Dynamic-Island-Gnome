import React, { useState } from 'react';
import { Check, Copy, RotateCcw } from 'lucide-react';
import {
  AnimationSpeed,
  CompactAppearance,
  DEFAULT_PREFERENCES,
  ExpandedAppearance,
  IslandPosition,
  IslandPreferences,
  MonitorMode,
  sanitizePreferences,
} from '../utils/islandLogic';

interface PreferencesViewProps {
  prefs: IslandPreferences;
  onChangePrefs: (next: IslandPreferences) => void;
}

export const PreferencesView: React.FC<PreferencesViewProps> = ({ prefs, onChangePrefs }) => {
  const [copiedCli, setCopiedCli] = useState(false);

  const update = (patch: Partial<IslandPreferences>) => {
    onChangePrefs(sanitizePreferences({ ...prefs, ...patch }));
  };

  const schema = 'org.gnome.shell.extensions.dynamic-island';
  const gsettingsCommands = [
    `gsettings set ${schema} background-opacity ${prefs.backgroundOpacity.toFixed(2)}`,
    `gsettings set ${schema} background-color '${prefs.backgroundColor}'`,
    `gsettings set ${schema} blur-intensity ${prefs.blurIntensity}`,
    `gsettings set ${schema} border-opacity ${prefs.borderOpacity.toFixed(2)}`,
    `gsettings set ${schema} shadow-intensity ${prefs.shadowIntensity.toFixed(2)}`,
    `gsettings set ${schema} island-position '${prefs.islandPosition}'`,
    `gsettings set ${schema} expanded-appearance '${prefs.expandedAppearance}'`,
    `gsettings set ${schema} auto-collapse-delay ${prefs.autoCollapseDelay}`,
  ].join('\n');

  const handleCopyCli = async () => {
    try {
      await navigator.clipboard.writeText(gsettingsCommands);
      setCopiedCli(true);
      window.setTimeout(() => setCopiedCli(false), 1600);
    } catch {
      // Ignore clipboard errors in restricted frames
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Column 1: Glassmorphism, Dimensions & Layout */}
      <div className="lg:col-span-7 bg-[#12151E] border border-white/10 rounded-2xl p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-4 pb-3 border-b border-white/[0.08]">
          <div>
            <h2 className="text-base font-semibold text-white">Glassmorphism &amp; Layout · By Lxe Soul</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Mirrors Libadwaita prefs.js GSettings bindings and updates the desktop preview live.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChangePrefs(DEFAULT_PREFERENCES)}
            className="px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restore Default Settings</span>
          </button>
        </div>

        {/* Glass Sliders */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(() => {
            const transparencyPct = Math.round((1 - prefs.backgroundOpacity) * 100);
            return (
              <label className="flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between text-slate-300">
                  <span>Glass Transparency</span>
                  <span className="font-mono tabular-nums text-sky-300">
                    {transparencyPct}%{transparencyPct >= 96 ? ' (Max)' : ''}
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={96}
                  step={2}
                  value={transparencyPct}
                  onChange={(e) =>
                    update({
                      backgroundOpacity: Number((1 - Number(e.target.value) / 100).toFixed(2)),
                    })
                  }
                  className="accent-sky-400"
                />
              </label>
            );
          })()}

          <div className="flex flex-col gap-1.5 text-xs">
            <div className="flex justify-between text-slate-300">
              <span>Blur Intensity (Shell.BlurEffect)</span>
              <span className="font-mono tabular-nums text-sky-300">{prefs.blurIntensity}px</span>
            </div>
            <input
              type="range"
              aria-label="Blur Intensity"
              min={0}
              max={60}
              step={2}
              value={prefs.blurIntensity}
              onChange={(e) => update({ blurIntensity: Number(e.target.value) })}
              className="accent-sky-400"
            />
            <div className="flex items-center gap-1.5 pt-0.5">
              {[
                { label: 'Off (0)', val: 0 },
                { label: 'Subtle (10)', val: 10 },
                { label: 'Medium (22)', val: 22 },
                { label: 'Strong (38)', val: 38 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => update({ blurIntensity: preset.val })}
                  className={`px-2 py-0.5 rounded-md text-[10.5px] font-medium border transition-colors ${
                    prefs.blurIntensity === preset.val
                      ? 'bg-sky-400/20 border-sky-400/50 text-sky-200'
                      : 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.1]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1.5 text-xs">
            <div className="flex justify-between text-slate-300">
              <span>Border Opacity</span>
              <span className="font-mono tabular-nums text-sky-300">
                {Math.round(prefs.borderOpacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.02}
              max={0.45}
              step={0.02}
              value={prefs.borderOpacity}
              onChange={(e) => update({ borderOpacity: Number(e.target.value) })}
              className="accent-sky-400"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-xs">
            <div className="flex justify-between text-slate-300">
              <span>Shadow Intensity</span>
              <span className="font-mono tabular-nums text-sky-300">
                {Math.round(prefs.shadowIntensity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={prefs.shadowIntensity}
              onChange={(e) => update({ shadowIntensity: Number(e.target.value) })}
              className="accent-sky-400"
            />
          </label>
        </div>

        {/* Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/[0.06]">
          <div className="flex flex-col gap-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-300">Island Position</span>
              {prefs.useCustomPosition && (
                <button
                  type="button"
                  onClick={() => update({ useCustomPosition: false, customX: -1, customY: -1 })}
                  className="text-[11px] text-sky-400 hover:text-sky-300 underline"
                >
                  Reset Drag ({prefs.customX}, {prefs.customY})
                </button>
              )}
            </div>
            <select
              aria-label="Island Position"
              value={prefs.islandPosition}
              onChange={(e) =>
                update({
                  islandPosition: e.target.value as IslandPosition,
                  useCustomPosition: false,
                  customX: -1,
                  customY: -1,
                })
              }
              className="bg-[#0B0D12] border border-white/12 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-sky-400"
            >
              <option value="top-center">Top Center</option>
              <option value="top-left">Top Left</option>
              <option value="top-right">Top Right</option>
            </select>
          </div>

          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-slate-300">Multi-Monitor Mode</span>
            <select
              value={prefs.monitorMode}
              onChange={(e) => update({ monitorMode: e.target.value as MonitorMode })}
              className="bg-[#0B0D12] border border-white/12 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-sky-400"
            >
              <option value="primary">Primary Monitor</option>
              <option value="follow-focus">Follow Focused Window</option>
              <option value="all">All Monitors</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-slate-300">Compact Appearance</span>
            <select
              value={prefs.compactAppearance}
              onChange={(e) => update({ compactAppearance: e.target.value as CompactAppearance })}
              className="bg-[#0B0D12] border border-white/12 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-sky-400"
            >
              <option value="media-progress">Media Artwork &amp; Equalizer</option>
              <option value="minimal">Minimal Track &amp; Status</option>
              <option value="system-pill">Minimal System Pill</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-slate-300">Expanded Appearance</span>
            <select
              value={prefs.expandedAppearance}
              onChange={(e) => update({ expandedAppearance: e.target.value as ExpandedAppearance })}
              className="bg-[#0B0D12] border border-white/12 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-sky-400"
            >
              <option value="full">Full Glass Control Panel</option>
              <option value="media-focused">Media &amp; Audio Only</option>
              <option value="controls-compact">Compact Control Stack</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-slate-300">Animation Speed</span>
            <select
              value={prefs.animationSpeed}
              onChange={(e) => update({ animationSpeed: e.target.value as AnimationSpeed })}
              className="bg-[#0B0D12] border border-white/12 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-sky-400"
            >
              <option value="fast">Fast (185ms)</option>
              <option value="normal">Normal (280ms)</option>
              <option value="relaxed">Relaxed (410ms)</option>
            </select>
          </label>

          <label className="flex items-center justify-between gap-3 bg-[#0B0D12] border border-white/12 rounded-lg px-3 py-2 text-xs self-end">
            <span className="font-medium text-slate-300">Background Tint</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-slate-400">{prefs.backgroundColor}</span>
              <input
                type="color"
                aria-label="Background tint"
                value={prefs.backgroundColor}
                onChange={(e) => update({ backgroundColor: e.target.value })}
                className="w-7 h-6 rounded border-0 bg-transparent cursor-pointer"
              />
            </div>
          </label>
        </div>

        {/* Dimensions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/[0.06]">
          <label className="flex flex-col gap-1.5 text-xs">
            <div className="flex justify-between text-slate-300">
              <span>Compact Width</span>
              <span className="font-mono tabular-nums text-sky-300">{prefs.compactWidth}px</span>
            </div>
            <input
              type="range"
              min={150}
              max={420}
              step={4}
              value={prefs.compactWidth}
              onChange={(e) => update({ compactWidth: Number(e.target.value) })}
              className="accent-sky-400"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-xs">
            <div className="flex justify-between text-slate-300">
              <span>Compact Height</span>
              <span className="font-mono tabular-nums text-sky-300">{prefs.compactHeight}px</span>
            </div>
            <input
              type="range"
              min={26}
              max={56}
              step={2}
              value={prefs.compactHeight}
              onChange={(e) => update({ compactHeight: Number(e.target.value) })}
              className="accent-sky-400"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-xs">
            <div className="flex justify-between text-slate-300">
              <span>Expanded Width</span>
              <span className="font-mono tabular-nums text-sky-300">{prefs.expandedWidth}px</span>
            </div>
            <input
              type="range"
              min={360}
              max={640}
              step={8}
              value={prefs.expandedWidth}
              onChange={(e) => update({ expandedWidth: Number(e.target.value) })}
              className="accent-sky-400"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-xs">
            <div className="flex justify-between text-slate-300">
              <span>Corner Radius</span>
              <span className="font-mono tabular-nums text-sky-300">{prefs.cornerRadius}px</span>
            </div>
            <input
              type="range"
              min={12}
              max={40}
              step={2}
              value={prefs.cornerRadius}
              onChange={(e) => update({ cornerRadius: Number(e.target.value) })}
              className="accent-sky-400"
            />
          </label>
        </div>
      </div>

      {/* Column 2: Smart Behavior, Modules & GSettings Export */}
      <div className="lg:col-span-5 flex flex-col gap-5">
        <div className="bg-[#12151E] border border-white/10 rounded-2xl p-6 flex flex-col gap-3">
          <h2 className="text-base font-semibold text-white">Smart Behavior &amp; Modules</h2>
          <p className="text-xs text-slate-400 mb-1">
            Configure temporary glass HUD expansions and enabled hardware modules.
          </p>

          {[
            {
              key: 'autoExpandOnMusic' as const,
              label: 'Auto-Expand on Music Start',
              desc: 'Shows temporary music pill when Spotify or browser track starts',
            },
            {
              key: 'autoExpandOnVolume' as const,
              label: 'Temporary Volume Indicator',
              desc: 'Briefly expands pill when system volume changes while collapsed',
            },
            {
              key: 'autoExpandOnBrightness' as const,
              label: 'Temporary Brightness Indicator',
              desc: 'Briefly expands pill when backlight brightness changes',
            },
            {
              key: 'enableMedia' as const,
              label: 'MPRIS Media Player',
              desc: 'Spotify desktop & browser media sessions over D-Bus',
            },
            {
              key: 'showAlbumArtwork' as const,
              label: 'Music Artwork Visibility',
              desc: 'Display track cover art in compact, HUD, and expanded states',
            },
            {
              key: 'enableAudio' as const,
              label: 'Audio Mixer & Device Routing',
              desc: 'Gvc.MixerControl volume, mic mute, input/output selection',
            },
            {
              key: 'enableBrightness' as const,
              label: 'Display Brightness Control',
              desc: 'Gsd.Power.Screen backlight slider with external display fallback',
            },
            {
              key: 'enableQuickSettings' as const,
              label: 'Quick Settings Grid',
              desc: 'Wi-Fi, Bluetooth, Battery, Do Not Disturb, Night Light',
            },
          ].map((item) => (
            <label
              key={item.key}
              className="flex items-center justify-between gap-4 py-2 border-b border-white/[0.06] last:border-b-0 cursor-pointer"
            >
              <div>
                <div className="text-sm font-medium text-slate-100">{item.label}</div>
                <div className="text-xs text-slate-400">{item.desc}</div>
              </div>
              <input
                type="checkbox"
                checked={prefs[item.key]}
                onChange={(e) => update({ [item.key]: e.target.checked })}
                className="w-4 h-4 accent-sky-400 rounded shrink-0 cursor-pointer"
              />
            </label>
          ))}

          <label className="flex flex-col gap-1.5 text-xs pt-2 border-t border-white/[0.06]">
            <div className="flex justify-between text-slate-300">
              <span>Auto-Collapse Delay</span>
              <span className="font-mono tabular-nums text-sky-300">
                {(prefs.autoCollapseDelay / 1000).toFixed(1)}s
              </span>
            </div>
            <input
              type="range"
              min={1200}
              max={8000}
              step={200}
              value={prefs.autoCollapseDelay}
              onChange={(e) => update({ autoCollapseDelay: Number(e.target.value) })}
              className="accent-sky-400"
            />
          </label>
        </div>

        <div className="bg-[#12151E] border border-white/10 rounded-2xl p-5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-200">
              Equivalent Ubuntu 26.04 GSettings CLI
            </span>
            <button
              type="button"
              onClick={handleCopyCli}
              className="px-2.5 py-1 rounded-md bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-[11px] font-medium text-slate-200 flex items-center gap-1.5 transition-colors"
            >
              {copiedCli ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedCli ? 'Copied' : 'Copy CLI'}</span>
            </button>
          </div>
          <pre className="p-3 rounded-xl bg-[#090B0F] border border-white/[0.07] text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
            {gsettingsCommands}
          </pre>
        </div>
      </div>
    </div>
  );
};
