import React, { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import JSZip from 'jszip';
import {
  DEFAULT_PREFERENCES,
  FocusModule,
  HudKind,
  IslandPreferences,
  IslandState,
  SystemScenarioState,
} from './utils/islandLogic';
import { SCENARIO_PRESETS, ScenarioId } from './data/scenarios';
import { EXTENSION_FILES, GSCHEMAS_COMPILED_BASE64 } from './generated/extensionSnapshot';
import { DesktopSimulator } from './components/DesktopSimulator';
import { PreferencesView } from './components/PreferencesView';
import { SourceDocsView } from './components/SourceDocsView';
import { CompatibilityView } from './components/CompatibilityView';

type ActiveTab = 'simulator' | 'preferences' | 'source' | 'compatibility';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('simulator');
  const [prefs, setPrefs] = useState<IslandPreferences>(DEFAULT_PREFERENCES);
  const [islandState, setIslandState] = useState<IslandState>('compact');
  const [hudKind, setHudKind] = useState<HudKind>('music');
  const [focusModule, setFocusModule] = useState<FocusModule>('media');
  const [scenarioId, setScenarioId] = useState<ScenarioId>('laptop-spotify');
  const [system, setSystem] = useState<SystemScenarioState>(
    () => structuredClone(SCENARIO_PRESETS['laptop-spotify'].state)
  );
  const [downloading, setDownloading] = useState(false);

  const hudTimerRef = useRef<number | null>(null);
  const hoveringIslandRef = useRef(false);

  const clearHudTimer = () => {
    if (hudTimerRef.current !== null) {
      window.clearTimeout(hudTimerRef.current);
      hudTimerRef.current = null;
    }
  };

  const scheduleHudCollapse = () => {
    clearHudTimer();
    hudTimerRef.current = window.setTimeout(() => {
      hudTimerRef.current = null;
      if (!hoveringIslandRef.current) {
        setIslandState((curr) => (curr === 'hud' ? 'compact' : curr));
      }
    }, prefs.autoCollapseDelay);
  };

  useEffect(() => () => clearHudTimer(), []);

  const handleChangeScenario = (nextId: ScenarioId) => {
    clearHudTimer();
    setScenarioId(nextId);
    setSystem(structuredClone(SCENARIO_PRESETS[nextId].state));
  };

  const handleChangeIslandState = (nextState: IslandState, nextFocus?: FocusModule) => {
    if (nextState !== 'hud') {
      clearHudTimer();
    }
    setIslandState(nextState);
    if (nextFocus) {
      setFocusModule(nextFocus);
    }
  };

  const handleTriggerHud = (kind: HudKind) => {
    setHudKind(kind);
    setIslandState('hud');
    if (!hoveringIslandRef.current) {
      scheduleHudCollapse();
    }
  };

  const handleHoverIsland = (hovering: boolean) => {
    hoveringIslandRef.current = hovering;
    if (hovering) {
      clearHudTimer();
    } else if (islandState === 'hud') {
      scheduleHudCollapse();
    }
  };

  const handleDownloadZip = async () => {
    setDownloading(true);
    try {
      const zip = new JSZip();
      for (const file of EXTENSION_FILES) {
        if (file.inZip) {
          zip.file(file.path, file.content);
        }
      }
      if (GSCHEMAS_COMPILED_BASE64) {
        zip.file('schemas/gschemas.compiled', GSCHEMAS_COMPILED_BASE64, { base64: true });
      }
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dynamic-island@ubuntu26.gnome.org.shell-extension.zip';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0D12] text-slate-100 flex flex-col">
      {/* Top Bar Contract: 1 row, 3 zones separated by gap-8 */}
      <header className="border-b border-white/[0.08] bg-[#0D1017]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <span className="text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            GNOME Dynamic Island · <span className="text-sky-400 font-semibold">By Lxe Soul</span>
          </span>

          <nav aria-label="Workspace Views" className="flex items-center gap-6 overflow-x-auto">
            {[
              { id: 'simulator' as const, label: 'Desktop Simulator' },
              { id: 'preferences' as const, label: 'Preferences' },
              { id: 'source' as const, label: 'Source & Docs' },
              { id: 'compatibility' as const, label: 'Compatibility' },
            ].map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-1.5 text-sm font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                    active
                      ? 'text-white border-sky-400'
                      : 'text-slate-400 border-transparent hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <button
            type="button"
            disabled={downloading}
            onClick={handleDownloadZip}
            className="px-4 py-2 rounded-lg bg-sky-400 hover:bg-sky-300 text-slate-950 text-xs font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors disabled:opacity-60"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{downloading ? 'Packaging...' : 'Download ZIP'}</span>
          </button>
        </div>
      </header>

      <main className="max-w-[1200px] w-full mx-auto px-6 py-7 flex-1 flex flex-col gap-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">
              {activeTab === 'simulator' && 'Ubuntu 26.04 LTS · GNOME Shell 50.1 Wayland Preview'}
              {activeTab === 'preferences' && 'Extension Preferences (Libadwaita / GSettings)'}
              {activeTab === 'source' && 'GNOME Shell 50.1 Extension Source & Documentation'}
              {activeTab === 'compatibility' && 'Testing, API Audit & Compatibility Report'}
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              By Lxe Soul · dynamic-island@ubuntu26.gnome.org · Classic Black Idle · Song-Reactive Theme · Live Blur &amp; Pomodoro Studio
            </p>
          </div>
        </div>

        {activeTab === 'simulator' && (
          <DesktopSimulator
            prefs={prefs}
            islandState={islandState}
            hudKind={hudKind}
            focusModule={focusModule}
            scenarioId={scenarioId}
            system={system}
            onDragPosition={(x, y) =>
              setPrefs((prev) => ({
                ...prev,
                useCustomPosition: true,
                customX: x,
                customY: y,
              }))
            }
            onHoverIsland={handleHoverIsland}
            onChangeScenario={handleChangeScenario}
            onChangeState={handleChangeIslandState}
            onTriggerHud={handleTriggerHud}
            onOpenPrefs={() => setActiveTab('preferences')}
            onChangeBlurIntensity={(nextBlur) =>
              setPrefs((prev) => ({ ...prev, blurIntensity: nextBlur }))
            }
            onUpdateSystem={setSystem}
          />
        )}

        {activeTab === 'preferences' && (
          <PreferencesView prefs={prefs} onChangePrefs={setPrefs} />
        )}

        {activeTab === 'source' && <SourceDocsView />}

        {activeTab === 'compatibility' && <CompatibilityView />}
      </main>
    </div>
  );
}
