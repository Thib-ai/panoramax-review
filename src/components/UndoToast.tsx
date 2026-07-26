import { useState, useEffect, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import type { UndoState } from '../types';

interface UndoToastProps {
  undo: UndoState | null;
  canUndo: boolean;
  isLoading: boolean;
  onUndo: () => void;
}

const FADE_AFTER_MS = 5000;
const FADE_DURATION_MS = 1500;

export default function UndoToast({ undo, canUndo, isLoading, onUndo }: UndoToastProps) {
  const [now, setNow] = useState(Date.now());

  const tick = useCallback(() => setNow(Date.now()), []);

  useEffect(() => {
    if (!undo) return;
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [undo, tick]);

  if (!undo || !canUndo) return null;

  const age = now - undo.createdAt;
  const opacity = age > FADE_AFTER_MS
    ? Math.max(0, 1 - (age - FADE_AFTER_MS) / FADE_DURATION_MS)
    : 1;

  if (opacity <= 0) return null;

  return (
    <div className="fixed bottom-[92px] left-3 sm:bottom-[115px] sm:left-6 z-40 pointer-events-none">
      <button
        type="button"
        onClick={onUndo}
        disabled={isLoading}
        className="pointer-events-auto px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 text-white text-xs font-semibold rounded-full shadow-lg border border-slate-700/80 flex items-center gap-1.5 transition-all duration-200 active:scale-95 disabled:opacity-50"
        style={{ opacity }}
      >
        <RotateCcw className={`w-3.5 h-3.5 text-amber-400 ${isLoading ? 'animate-spin' : ''}`} />
        Undo {undo.label}
      </button>
    </div>
  );
}
