import { useState, useEffect, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import type { UndoItem } from '../types';

interface UndoToastProps {
  items: UndoItem[];
  isLoading: boolean;
  onUndo: (item: UndoItem) => void;
}

export default function UndoToast({ items, isLoading, onUndo }: UndoToastProps) {
  const [now, setNow] = useState(Date.now());

  const tick = useCallback(() => {
    setNow(Date.now());
  }, []);

  useEffect(() => {
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [tick]);

  const visible = items.filter((it) => now - it.createdAt < 5000);

  return (
    <div className="fixed bottom-[92px] left-3 sm:bottom-[115px] sm:left-6 z-40 flex flex-col items-start gap-1.5 pointer-events-none">
      {visible.map((item) => {
        const age = now - item.createdAt;
        const opacity = age > 3000 ? 1 - (age - 3000) / 2000 : 1;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onUndo(item)}
            disabled={isLoading}
            className="pointer-events-auto px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 text-white text-xs font-semibold rounded-full shadow-lg border border-slate-700/80 flex items-center gap-1.5 transition-all duration-200 active:scale-95 disabled:opacity-50"
            style={{ opacity }}
          >
            <RotateCcw className={`w-3.5 h-3.5 text-amber-400 ${isLoading ? 'animate-spin' : ''}`} />
            Undo {item.label}
          </button>
        );
      })}
    </div>
  );
}
