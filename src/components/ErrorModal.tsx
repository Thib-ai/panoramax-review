import { useState, useEffect } from 'react';
import {
  AlertTriangle, X, CheckCircle, MessageSquare, EyeOff, Aperture, SunDim,
  ShieldAlert, RotateCcw, MapPinOff, HelpCircle,
} from 'lucide-react';
import { COMMON_ERROR_REASONS } from '../types';

interface ErrorModalProps {
  pictureId: string;
  isOpen: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (reasonId: string, comment: string) => void;
}

const iconMap: Record<string, typeof EyeOff> = {
  EyeOff, Aperture, SunDim, ShieldAlert, RotateCcw, MapPinOff, HelpCircle,
};

export default function ErrorModal({ pictureId, isOpen, submitting, onClose, onSubmit }: ErrorModalProps) {
  const [selectedReason, setSelectedReason] = useState('privacy');
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSelectedReason('privacy');
      setComment('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    onSubmit(selectedReason, comment.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in font-sans">
      <div className="w-full max-w-lg bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-xl space-y-5 text-slate-900 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl border border-rose-200/80">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900">Flag Image Defect</h3>
              <p className="text-xs text-slate-500 font-mono">ID: {pictureId.substring(0, 12)}...</p>
            </div>
          </div>
          <button type="button" onClick={onClose} title="Close" className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            Select Problem Category
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {COMMON_ERROR_REASONS.map((reason) => {
              const isSelected = selectedReason === reason.id;
              const Icon = iconMap[reason.iconName] || HelpCircle;
              return (
                <button
                  key={reason.id}
                  type="button"
                  onClick={() => setSelectedReason(reason.id)}
                  className={`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 ${
                    isSelected
                      ? 'bg-rose-50/70 border-rose-500 text-slate-900 ring-1 ring-rose-500'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-100/60'
                  }`}
                >
                  <div className={`p-1 rounded-lg mt-0.5 shrink-0 ${isSelected ? 'bg-rose-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-900">{reason.label}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{reason.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-slate-600" />
            Optional Notes / Explanation
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Provide extra details (e.g., license plate visible on red van, camera rotated 90deg)..."
            rows={3}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-rose-600 focus:ring-1 focus:ring-rose-600 transition-all resize-none"
          />
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
          >
            Cancel
          </button>
          <button
            id="btn-submit-flag"
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl shadow-xs active:scale-95 flex items-center gap-1.5 disabled:opacity-50 transition-all"
          >
            {submitting ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            Submit Flag & Next
          </button>
        </div>
      </div>
    </div>
  );
}
