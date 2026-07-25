import { Check, AlertTriangle, SkipForward, Info } from 'lucide-react';

interface ReviewControlsProps {
  pendingCount: number;
  totalPictures: number;
  canAct: boolean;
  onOk: () => void;
  onFlag: () => void;
  onSkip: () => void;
}

export default function ReviewControls({ pendingCount, totalPictures, canAct, onOk, onFlag, onSkip }: ReviewControlsProps) {
  return (
    <div id="bottom-review-toolbar" className="shrink-0 w-full bg-white/95 border-t border-slate-200/80 px-4 py-3 select-none backdrop-blur-md z-30 shadow-xs">
      <div className="max-w-xl mx-auto space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-500 px-1 font-medium">
          <span className="flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-slate-700" />
            Pending Queue: <strong className="text-slate-900 font-bold">{pendingCount}</strong>
          </span>
          <span className="text-[11px] text-slate-400 font-mono">Total Catalog: {totalPictures}</span>
        </div>

        <div className="grid grid-cols-12 gap-3 items-center">
          <button
            id="btn-review-ok"
            type="button"
            onClick={onOk}
            disabled={!canAct}
            className="col-span-5 h-12 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold text-sm sm:text-base rounded-xl shadow-xs active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Check className="w-5 h-5 stroke-[2.5]" />
            OK (Pass)
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono font-bold bg-emerald-700/60 rounded text-emerald-100 border border-emerald-400/30">Enter</kbd>
          </button>
          <button
            id="btn-review-error"
            type="button"
            onClick={onFlag}
            disabled={!canAct}
            className="col-span-5 h-12 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-bold text-sm sm:text-base rounded-xl shadow-xs active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
            Flag Issue
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono font-bold bg-rose-700/60 rounded text-rose-100 border border-rose-400/30">E</kbd>
          </button>
          <button
            id="btn-review-skip"
            type="button"
            onClick={onSkip}
            disabled={!canAct}
            className="col-span-2 h-12 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl border border-slate-200/80 active:scale-[0.96] flex items-center justify-center gap-1 disabled:opacity-40 transition-all"
          >
            <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
            <kbd className="hidden lg:inline-block px-1.5 py-0.5 bg-slate-200 text-slate-700 border-slate-300 rounded text-[10px] font-mono font-bold border">→</kbd>
          </button>
        </div>

        <div className="hidden sm:flex items-center justify-center gap-3 text-[11px] text-slate-500 pt-1 font-sans">
          <span>Shortcuts:</span>
          <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono text-slate-800 font-bold text-[10px]">Enter</kbd>
          <span>or</span>
          <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono text-slate-800 font-bold text-[10px]">O</kbd>
          <span>OK</span>
          <span className="text-slate-300">&bull;</span>
          <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono text-slate-800 font-bold text-[10px]">E</kbd>
          <span>Flag Error</span>
          <span className="text-slate-300">&bull;</span>
          <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono text-slate-800 font-bold text-[10px]">←/→</kbd>
          <span>or</span>
          <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono text-slate-800 font-bold text-[10px]">S</kbd>
          <span>Skip</span>
        </div>
      </div>
    </div>
  );
}
