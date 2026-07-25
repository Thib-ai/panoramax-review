import { useState, useEffect } from 'react';
import { Settings, CheckCircle2, Smartphone, WifiOff, Trash2, Save, X } from 'lucide-react';
import type { AppSettings } from '../types';
import { cacheManager } from '../services/cacheManager';
import { updateAppSettings } from '../services/api';

interface SettingsModalProps {
  isOpen: boolean;
  settings: AppSettings;
  onClose: () => void;
  onSave: (settings: AppSettings) => void;
}

export default function SettingsModal({ isOpen, settings, onClose, onSave }: SettingsModalProps) {
  const [cacheSize, setCacheSize] = useState(settings.cacheSize);
  const [instanceUrl, setInstanceUrl] = useState(settings.instanceUrl);
  const [cellularSaver, setCellularSaver] = useState(settings.cellularSaverMode || false);
  const [cachedCount, setCachedCount] = useState(0);
  const [message, setMessage] = useState('');
  const [isCellular, setIsCellular] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCacheSize(settings.cacheSize);
      setInstanceUrl(settings.instanceUrl);
      setCellularSaver(settings.cellularSaverMode || false);
      setMessage('');
      cacheManager.getCachedCount().then((c) => setCachedCount(c));
      const conn = (navigator as any).connection;
      if (conn) {
        const isCell = conn.type === 'cellular' || conn.saveData || ['2g', '3g'].includes(conn.effectiveType);
        setIsCellular(isCell);
      }
    }
  }, [isOpen, settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const merged: AppSettings = {
        cacheSize: Math.min(Math.max(cacheSize, 5), 500),
        instanceUrl: instanceUrl || settings.instanceUrl,
        autoFetchApi: settings.autoFetchApi,
        cellularSaverMode: cellularSaver,
      };
      const result = await updateAppSettings(merged);
      cacheManager.setCellularSaver(cellularSaver);
      onSave(result);
      setMessage('Settings saved successfully.');
    } catch {
      setMessage('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleFlushCache = async () => {
    await cacheManager.clearCache();
    setCachedCount(0);
    setMessage('Image cache flushed.');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in font-sans">
      <div className="w-full max-w-lg bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-xl space-y-5 text-slate-900 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-slate-100 text-slate-800 rounded-xl border border-slate-200/80">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900">Cache & Data Settings</h3>
              <p className="text-xs text-slate-500">Configure offline image caching (up to 500) and cellular saver</p>
            </div>
          </div>
          <button type="button" onClick={onClose} title="Close" className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {message && (
          <div className="p-3 bg-slate-100 border border-slate-200 text-slate-800 text-xs rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            {message}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-slate-700">Offline Pre-fetch Cache Limit</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={cacheSize}
                onChange={(e) => setCacheSize(Math.min(Math.max(Number(e.target.value) || 5, 5), 500))}
                className="w-20 px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-right"
                min={5}
                max={500}
              />
              <span className="text-xs text-slate-500">Images</span>
            </div>
          </div>
          <input
            type="range"
            min={5}
            max={500}
            step={5}
            value={cacheSize}
            onChange={(e) => setCacheSize(Number(e.target.value))}
            className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-slate-900"
          />
          <div className="flex items-center justify-between mt-2 pt-1 border-t border-slate-100 gap-1.5">
            <span className="text-[10px] text-slate-400 font-mono">Presets:</span>
            {[10, 50, 100, 250, 500].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCacheSize(n)}
                className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded-md transition-all ${
                  cacheSize === n ? 'bg-slate-900 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={`p-1.5 rounded-lg ${cellularSaver ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'}`}>
                <Smartphone className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-800">Cellular Data Saver</div>
                <div className="text-[10px] text-slate-500">Pause background image downloads on mobile/metered data</div>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={cellularSaver} onChange={(e) => setCellularSaver(e.target.checked)} />
              <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500" />
            </label>
          </div>
          {isCellular && (
            <div className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 p-2 rounded-lg flex items-center gap-1.5 font-medium">
              <WifiOff className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              Cellular/metered connection detected on this device. Data saver is recommended.
            </div>
          )}
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Default Panoramax Instance URL</label>
          <input
            type="url"
            value={instanceUrl}
            onChange={(e) => setInstanceUrl(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-slate-900"
          />
        </div>

        <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-600">Currently Cached in Storage:</span>
            <span className="font-mono font-bold text-slate-900 bg-white px-2.5 py-0.5 rounded-md border border-slate-200 shadow-xs text-xs">
              {cachedCount} Files
            </span>
          </div>
          <button
            type="button"
            onClick={handleFlushCache}
            className="w-full py-2 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all active:scale-95"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-600" />
            Flush Local Image Cache
          </button>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-xs active:scale-95 flex items-center gap-1.5 disabled:opacity-50 transition-all"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
