import React, { useState } from 'react';
import { Check, Copy, Download, FileCode2, FileText, Image as ImageIcon } from 'lucide-react';
import { EXTENSION_FILES } from '../generated/extensionSnapshot';

const README_SHOWCASE_BANNERS = [
  {
    src: '/assets/showcase/showcase-1-expanded-and-mpris.png',
    title: '01 · Expanded Glass Control Panel & Studio + MPRIS Media Focus View',
    subtitle: 'Combined 2-in-1 Showcase · Song-Reactive Gold Theme, Bubble Quick Settings, Live Blur Tuner & Pomodoro Bar',
  },
  {
    src: '/assets/showcase/showcase-2-classic-idle-and-hud.png',
    title: '02 · Classic Black Hardware Capsule (Idle Mode) + Smart Song-Reactive Music HUD',
    subtitle: 'Combined 2-in-1 Showcase · Pitch-Black Hardware Cutout when Idle & Circular Album Banner HUD when Playing',
  },
  {
    src: '/assets/showcase/showcase-3-pipewire-audio-routing.png',
    title: '03 · PipeWire Audio Routing · Adaptive Crystal Glass & Dark Glass',
    subtitle: 'Combined 2-in-1 Showcase · Real-Time Output/Input Device Switching over Light & Dark Desktop Wallpapers',
  },
];

export const SourceDocsView: React.FC = () => {
  const [selectedPath, setSelectedPath] = useState<string>('README.md');
  const [copied, setCopied] = useState(false);

  const activeFile = EXTENSION_FILES.find((f) => f.path === selectedPath) ?? EXTENSION_FILES[0];
  const isReadme = activeFile?.path === 'README.md';

  const handleCopy = async () => {
    if (!activeFile) return;
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard denial in restricted frames
    }
  };

  const handleDownloadSingle = () => {
    if (!activeFile) return;
    const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.path.split('/').pop() ?? 'file.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Live README Visual Showcase Preview */}
      <div className="bg-[#12151E] border border-white/10 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <ImageIcon className="w-4 h-4 text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold text-white">
                GitHub README Visual Showcase · 3 Combined (2-in-1) Panels
              </h2>
              <p className="text-xs text-slate-400">
                Embedded in <code className="text-sky-300 font-mono">README.md</code> &amp;{' '}
                <code className="text-sky-300 font-mono">extension/README.md</code> via{' '}
                <code className="text-amber-300 font-mono">docs/screenshots/showcase-*.png</code> · By Lxe Soul
              </p>
            </div>
          </div>
          <span className="text-[11px] font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-400/25 px-2.5 py-1 rounded-md">
            6 Captures → 3 Combined 2-in-1 Banners
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {README_SHOWCASE_BANNERS.map((banner) => (
            <div
              key={banner.src}
              className="rounded-xl border border-white/10 bg-[#090B0F] overflow-hidden shadow-lg"
            >
              <img
                src={banner.src}
                alt={banner.title}
                className="w-full h-auto block"
                loading="lazy"
              />
              <div className="px-4 py-2.5 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2 bg-[#0E1118]">
                <span className="text-xs font-semibold text-white">{banner.title}</span>
                <span className="text-[11px] text-slate-400">{banner.subtitle}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* File Tree + Code/Doc Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Project File Tree */}
        <aside className="lg:col-span-4 bg-[#12151E] border border-white/10 rounded-2xl p-4 flex flex-col gap-1.5 max-h-[640px] overflow-y-auto">
          <div className="text-xs font-semibold text-slate-300 px-2 pb-2 border-b border-white/[0.08]">
            Extension Directory · {EXTENSION_FILES.length} Files
          </div>
          {EXTENSION_FILES.map((file) => {
            const isSelected = file.path === activeFile?.path;
            const isDoc = file.path.endsWith('.md');
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedPath(file.path)}
                className={`w-full px-2.5 py-2 rounded-lg text-left flex items-center justify-between gap-2 text-xs transition-colors ${
                  isSelected
                    ? 'bg-sky-400/15 text-sky-200 border border-sky-400/40'
                    : 'text-slate-300 hover:bg-white/[0.05] border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {isDoc ? (
                    <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <FileCode2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  )}
                  <span className="font-mono truncate">{file.path}</span>
                </span>
                <span className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0">
                  {file.lines}L
                </span>
              </button>
            );
          })}
        </aside>

        {/* Code / Documentation Viewer */}
        <div className="lg:col-span-8 bg-[#12151E] border border-white/10 rounded-2xl overflow-hidden flex flex-col max-h-[640px]">
          {activeFile && (
            <>
              <div className="px-4 py-3 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3 bg-[#0E1118]">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono font-semibold text-white">{activeFile.path}</span>
                  <span className="text-slate-500">·</span>
                  <span className="font-mono tabular-nums text-slate-400">{activeFile.lines} lines</span>
                  <span className="text-slate-500">·</span>
                  <span className="font-mono tabular-nums text-slate-400">{activeFile.bytes} bytes</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-400">
                    {activeFile.inZip ? 'Included in ZIP' : 'Repo Doc / Script'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadSingle}
                    className="px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Save File</span>
                  </button>
                </div>
              </div>

              {isReadme && (
                <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-400/20 text-[11px] text-amber-200 flex items-center justify-between">
                  <span>Includes 3 combined 2-in-1 showcase banners in Markdown (`../docs/screenshots/showcase-*.png`)</span>
                  <span className="font-mono font-semibold">By Lxe Soul</span>
                </div>
              )}

              <pre className="p-4 text-xs font-mono text-slate-200 overflow-auto leading-relaxed flex-1 bg-[#090B0F]">
                {activeFile.content}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
