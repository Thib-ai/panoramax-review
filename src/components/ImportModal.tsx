import { useState, useRef, useCallback } from 'react';
import { Upload, X, FileText, Globe, CheckCircle2, AlertCircle, FileUp, ListFilter } from 'lucide-react';
import { importPictureIds, fetchPanoramaxApiPictures } from '../services/api';
import type { ImportResult } from '../types';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
  defaultInstanceUrl: string;
}

export default function ImportModal({ isOpen, onClose, onImportComplete, defaultInstanceUrl }: ImportModalProps) {
  const [tab, setTab] = useState<'text' | 'stac'>('text');
  const [pastedText, setPastedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalProgress, setTotalProgress] = useState(0);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [stacUrl, setStacUrl] = useState(defaultInstanceUrl);
  const [stacLimit, setStacLimit] = useState(25);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPastedText('');
    setLoading(false);
    setProgress(0);
    setTotalProgress(0);
    setMessage(null);
    setFileName('');
  }, []);

  const processIds = useCallback(async (ids: string[]) => {
    if (ids.length === 0) {
      setMessage({ type: 'error', text: 'No valid picture IDs found.' });
      return;
    }
    setLoading(true);
    setProgress(0);
    setTotalProgress(ids.length);
    try {
      const result = await importPictureIds(ids, defaultInstanceUrl, (processed, total) => {
        setProgress(processed);
        setTotalProgress(total);
      });
      setMessage({ type: 'success', text: `Imported ${result.added} pictures. ${result.duplicatesSkipped} duplicates skipped. Total in DB: ${result.totalInDatabase}.` });
      onImportComplete();
      setTimeout(onClose, 2000);
    } catch {
      setMessage({ type: 'error', text: 'Import failed. Check the server logs.' });
    } finally {
      setLoading(false);
    }
  }, [defaultInstanceUrl, onImportComplete, onClose]);

  const parseAndProcessText = useCallback(() => {
    const ids = pastedText
      .split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    processIds(ids);
  }, [pastedText, processIds]);

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string || '';
      setPastedText(content);
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleStacSync = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await fetchPanoramaxApiPictures(stacUrl, stacLimit);
      setMessage({ type: 'success', text: `Fetched ${result.added} new pictures. ${result.duplicatesSkipped} duplicates skipped. Total in DB: ${result.totalInDatabase}.` });
      onImportComplete();
    } catch {
      setMessage({ type: 'error', text: 'Failed to fetch from Panoramax API. Check the URL.' });
    } finally {
      setLoading(false);
    }
  }, [stacUrl, stacLimit, onImportComplete]);

  if (!isOpen) return null;

  const progressPct = totalProgress > 0 ? Math.round((progress / totalProgress) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in font-sans">
      <div className="w-full max-w-xl bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-xl space-y-5 text-slate-900 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-slate-100 text-slate-800 rounded-xl border border-slate-200/80">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900">Import Picture IDs</h3>
              <p className="text-xs text-slate-500">Upload file or paste Panoramax picture IDs/URLs</p>
            </div>
          </div>
          <button type="button" onClick={onClose} title="Close" className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200/60">
          <button
            id="tab-import-text"
            type="button"
            onClick={() => { setTab('text'); reset(); }}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${
              tab === 'text' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Upload File or Paste IDs
          </button>
          <button
            id="tab-import-stac"
            type="button"
            onClick={() => { setTab('stac'); reset(); }}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${
              tab === 'stac' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            Panoramax API Sync
          </button>
        </div>

        {message && (
          <div className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
            message.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}>
            {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
            {message.text}
          </div>
        )}

        {tab === 'text' && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed border-slate-200 hover:border-slate-400 bg-slate-50/70 hover:bg-slate-100/60 rounded-xl p-4 text-center cursor-pointer transition-all space-y-1.5 group"
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.csv,.json,.tsv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              <div className="w-9 h-9 mx-auto bg-white rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 group-hover:scale-105 transition-transform">
                <FileUp className="w-4 h-4 text-slate-800" />
              </div>
              <p className="text-xs font-semibold text-slate-800">{fileName || 'Click to select or drag & drop a file'}</p>
              <p className="text-[11px] text-slate-400">Supports .txt, .csv, .json, or .tsv containing picture UUIDs or URLs</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-700">Or Paste Picture IDs / URLs</label>
                {pastedText && (
                  <button type="button" onClick={() => setPastedText('')} className="text-[11px] text-rose-600 hover:text-rose-700 hover:underline">
                    Clear text
                  </button>
                )}
              </div>
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder={`5b29337b-9f93-4a69-89b2-3e28edcdb66b\nhttps://panoramax.mapcomplete.org/api/pictures/.../sd.jpg`}
                rows={4}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 resize-none"
              />
            </div>

            <div className="flex items-center gap-1 text-[11px] text-slate-500">
              <ListFilter className="w-3.5 h-3.5 text-slate-600" />
              Duplicates skipped automatically
            </div>

            {loading && totalProgress > 0 && (
              <div>
                <div className="flex justify-between text-[11px] text-slate-500 font-semibold mb-1">
                  <span>Importing...</span>
                  <span>{progress} / {totalProgress} ({progressPct}%)</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-slate-900 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            )}

            <button
              id="btn-import-text-submit"
              type="button"
              onClick={parseAndProcessText}
              disabled={loading || !pastedText.trim()}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-xs active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              Process & Import IDs
            </button>
          </div>
        )}

        {tab === 'stac' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Panoramax API Endpoint URL</label>
              <input
                type="url"
                value={stacUrl}
                onChange={(e) => setStacUrl(e.target.value)}
                required
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-slate-900"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Max Images to Fetch</label>
              <select
                value={stacLimit}
                onChange={(e) => setStacLimit(Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-slate-900"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </div>

            <div className="text-[11px] text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200/80 leading-relaxed">
              Queries the STAC /search API endpoint on the specified instance, extracts photo IDs, and adds any new non-duplicate pictures to your queue.
            </div>

            <button
              id="btn-import-stac-submit"
              type="button"
              onClick={handleStacSync}
              disabled={loading || !stacUrl}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-xs active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Globe className="w-4 h-4" />
              )}
              Fetch New Pictures from API
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
