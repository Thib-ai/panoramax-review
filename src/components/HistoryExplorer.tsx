import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Layers, X, CheckSquare, Square, Check, Trash2, FileSpreadsheet, RefreshCw,
  History, ExternalLink, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight,
  CheckCircle2, AlertTriangle, AlertCircle, ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react';
import type { PictureItem, ReviewRecord, AppStats } from '../types';
import {
  fetchDashboardPictures, fetchReviewHistory, fetchAppStats,
  togglePictureCheckoff, deleteBatchPictures,
} from '../services/api';

interface HistoryExplorerProps {
  isOpen: boolean;
  onClose: () => void;
  stats: AppStats | null;
  knownInstances: string[];
}

type SortDir = 'asc' | 'desc';

export default function HistoryExplorer({ isOpen, onClose, stats, knownInstances }: HistoryExplorerProps) {
  const [tab, setTab] = useState<'dashboard' | 'timeline'>('dashboard');
  const [pictures, setPictures] = useState<PictureItem[]>([]);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [notification, setNotification] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [hoveredThumbnail, setHoveredThumbnail] = useState<{ url: string; id: string; top: number; left: number } | null>(null);

  const [filters, setFilters] = useState({
    status: 'all',
    search: '',
    instance: '',
    reason: '',
    checkedOff: 'all',
  });
  const [dashboardSort, setDashboardSort] = useState<{ key: string; dir: SortDir }>({ key: 'addedAt', dir: 'desc' });
  const [timelineSort, setTimelineSort] = useState<{ key: string; dir: SortDir }>({ key: 'reviewedAt', dir: 'desc' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'dashboard') {
        const result = await fetchDashboardPictures({
          ...filters, page, pageSize,
          sort: dashboardSort.key, sortDir: dashboardSort.dir,
        });
        setPictures(result.pictures);
        setTotalCount(result.totalCount);
        setFilteredCount(result.filteredCount);
      } else {
        const recs = await fetchReviewHistory({
          sort: timelineSort.key, sortDir: timelineSort.dir,
        });
        setReviews(recs);
      }
    } catch {
      setNotification('Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, [tab, filters, page, pageSize, dashboardSort, timelineSort]);

  useEffect(() => {
    if (isOpen) loadData();
  }, [isOpen, loadData]);

  useEffect(() => {
    setPage(1);
  }, [filters]);

  const toggleSort = (key: string, current: { key: string; dir: SortDir }, setter: (v: { key: string; dir: SortDir }) => void) => {
    if (current.key === key) {
      setter({ key, dir: current.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      setter({ key, dir: 'asc' });
    }
  };

  const totalPages = Math.ceil(filteredCount / pageSize) || 1;
  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, filteredCount);
  const allSelectedOnPage = pictures.length > 0 && pictures.every((p) => selectedIds.has(p.id));

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (allSelectedOnPage) {
      const next = new Set(selectedIds);
      pictures.forEach((p) => next.delete(p.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      pictures.forEach((p) => next.add(p.id));
      setSelectedIds(next);
    }
  };

  const handleCheckOff = async (checked: boolean) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await togglePictureCheckoff(ids, checked);
    setNotification(`Marked ${ids.length} picture(s) as ${checked ? 'checked off' : 'unchecked'}.`);
    setSelectedIds(new Set());
    loadData();
  };

  const handleDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} picture(s)? This action cannot be undone.`)) return;
    const result = await deleteBatchPictures(ids);
    setNotification(`Deleted ${result.removedCount} picture(s). ${result.remainingPictures} remaining.`);
    setSelectedIds(new Set());
    loadData();
  };

  const handleExportCsv = () => {
    const params = new URLSearchParams();
    params.set('format', 'csv');
    if (selectedIds.size > 0) {
      params.set('ids', Array.from(selectedIds).join(','));
    } else {
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.search) params.set('search', filters.search);
      if (filters.instance) params.set('instance', filters.instance);
      if (filters.reason) params.set('reason', filters.reason);
      if (filters.checkedOff !== 'all') params.set('checkedOff', filters.checkedOff);
    }
    window.open(`${import.meta.env.BASE_URL}api/export?${params.toString()}`, '_blank');
  };

  const SortIcon = ({ active, dir }: { active: boolean; dir: SortDir }) => (
    active
      ? (dir === 'asc' ? <ArrowUp className="w-3 h-3 inline" /> : <ArrowDown className="w-3 h-3 inline" />)
      : <ArrowUpDown className="w-3 h-3 inline opacity-30" />
  );

  if (!isOpen) return null;

  const statusPill = (p: PictureItem) => {
    const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold';
    if (p.status === 'reviewed_ok') return <span className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200`}><CheckCircle2 className="w-3 h-3" /> Passed OK</span>;
    if (p.status === 'flagged') return <span className={`${base} bg-rose-50 text-rose-700 border-rose-200`}><AlertTriangle className="w-3 h-3" /> Flagged</span>;
    if (p.status === 'resolved' || p.isCheckedOff) return <span className={`${base} bg-indigo-50 text-indigo-700 border-indigo-200`}><Check className="w-3 h-3" /> Resolved</span>;
    return <span className={`${base} bg-slate-100 text-slate-600 border border-slate-200`}>Pending</span>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in font-sans">
      <div className="w-full max-w-5xl max-h-[94vh] bg-white border border-slate-200/90 rounded-2xl shadow-xl flex flex-col overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200/80 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-slate-900 text-white rounded-xl shadow-xs">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900">Picture Review Dashboard</h3>
              <p className="text-xs text-slate-500">Filter picture IDs, triage flagged images, and export CSV reports</p>
            </div>
          </div>
          <button type="button" onClick={onClose} title="Close" className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {stats && (
          <div className="px-4 sm:px-5 pt-4 grid grid-cols-2 sm:grid-cols-5 gap-2 shrink-0">
            {[
              { label: 'Total Catalog', value: stats.totalPictures, color: 'text-slate-900', labelColor: 'text-slate-500' },
              { label: 'Pending Queue', value: stats.pendingQueue, color: 'text-amber-600', labelColor: 'text-amber-600' },
              { label: 'Passed OK', value: stats.reviewedOk, color: 'text-emerald-600', labelColor: 'text-emerald-700' },
              { label: 'Flagged Errors', value: stats.flaggedErrors, color: 'text-rose-600', labelColor: 'text-rose-700' },
              { label: 'Checked Off', value: stats.checkedOffCount, color: 'text-indigo-600', labelColor: 'text-indigo-700' },
            ].map((card) => (
              <div key={card.label} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 text-center">
                <div className={`text-[10px] font-semibold uppercase tracking-wider ${card.labelColor}`}>{card.label}</div>
                <div className={`text-base sm:text-lg font-bold mt-0.5 ${card.color}`}>{card.value}</div>
              </div>
            ))}
          </div>
        )}

        <div className="px-4 sm:px-5 pt-4 flex items-center justify-between border-b border-slate-200 gap-2 shrink-0">
          <div className="flex gap-0">
            <button
              type="button"
              onClick={() => setTab('dashboard')}
              className={`px-3 py-2 text-xs font-bold rounded-t-xl border-b-2 flex items-center gap-1.5 transition-all ${
                tab === 'dashboard' ? 'border-slate-900 text-slate-900 bg-slate-50' : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              Picture Catalog Dashboard ({filteredCount})
            </button>
            <button
              type="button"
              onClick={() => setTab('timeline')}
              className={`px-3 py-2 text-xs font-bold rounded-t-xl border-b-2 flex items-center gap-1.5 transition-all ${
                tab === 'timeline' ? 'border-slate-900 text-slate-900 bg-slate-50' : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              Audit Review Timeline ({reviews.length})
            </button>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg text-xs font-medium flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {notification && (
          <div className="mx-4 sm:mx-5 mt-3 p-2.5 bg-slate-900 text-white text-xs rounded-xl flex items-center justify-between shrink-0 animate-fade-in shadow-xs">
            <span>{notification}</span>
            <button type="button" onClick={() => setNotification('')} className="text-slate-400 hover:text-white ml-4">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {tab === 'dashboard' && (
          <div className="flex-1 flex flex-col p-4 sm:p-5 gap-3 overflow-hidden min-h-0">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all"
                >
                  {allSelectedOnPage ? <CheckSquare className="w-3.5 h-3.5 text-slate-900" /> : <Square className="w-3.5 h-3.5 text-slate-400" />}
                  {selectedIds.size > 0 ? `Selected (${selectedIds.size})` : 'Select Page'}
                </button>
                {selectedIds.size > 0 && (
                  <>
                    <button type="button" onClick={() => handleCheckOff(true)} className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all">
                      <Check className="w-3.5 h-3.5" />
                      Check Off Selected
                    </button>
                    <button type="button" onClick={() => handleCheckOff(false)} className="px-2.5 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all">
                      Uncheck
                    </button>
                    <button type="button" onClick={handleDelete} className="px-2.5 py-1.5 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all">
                      <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                      Delete
                    </button>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={handleExportCsv}
                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                {selectedIds.size > 0
                  ? `Export CSV Report (${selectedIds.size} Selected)`
                  : `Export CSV Report (Full List ${pictures.length})`
                }
              </button>
            </div>

            <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white min-h-0">
              <table className="w-full text-left text-xs text-slate-700 border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-700 uppercase sticky top-0 z-10">
                  <tr>
                    <th className="w-10 text-center px-3 py-2">
                      <input type="checkbox" checked={allSelectedOnPage} onChange={toggleSelectAll} className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer" />
                    </th>
                    <th className="w-24 px-3 py-2">
                      <button type="button" onClick={() => toggleSort('isCheckedOff', dashboardSort, setDashboardSort)} className="flex items-center gap-1 hover:text-slate-900">
                        Checked Off
                        <SortIcon active={dashboardSort.key === 'isCheckedOff'} dir={dashboardSort.dir} />
                      </button>
                      <select value={filters.checkedOff} onChange={(e) => setFilters({ ...filters, checkedOff: e.target.value })}
                        className="mt-1 w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-normal normal-case text-slate-800 focus:outline-none focus:border-slate-900"
                      >
                        <option value="all">All</option>
                        <option value="checked">Checked ☑</option>
                        <option value="unchecked">Unchecked ☐</option>
                      </select>
                    </th>
                    <th className="min-w-[160px] px-3 py-2">
                      <button type="button" onClick={() => toggleSort('pictureId', dashboardSort, setDashboardSort)} className="flex items-center gap-1 hover:text-slate-900">
                        Picture ID
                        <SortIcon active={dashboardSort.key === 'pictureId'} dir={dashboardSort.dir} />
                      </button>
                      <input type="text" placeholder="Filter ID..." value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                        className="mt-1 w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-mono font-normal normal-case text-slate-800 focus:outline-none focus:border-slate-900"
                      />
                    </th>
                    <th className="min-w-[120px] px-3 py-2">
                      <button type="button" onClick={() => toggleSort('status', dashboardSort, setDashboardSort)} className="flex items-center gap-1 hover:text-slate-900">
                        Review Status
                        <SortIcon active={dashboardSort.key === 'status'} dir={dashboardSort.dir} />
                      </button>
                      <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                        className="mt-1 w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-normal normal-case text-slate-800 focus:outline-none focus:border-slate-900"
                      >
                        <option value="all">All</option>
                        <option value="pending">Pending</option>
                        <option value="reviewed_ok">Passed OK</option>
                        <option value="flagged">Flagged Error</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </th>
                    <th className="min-w-[160px] px-3 py-2">
                      Error Reason / Notes
                      <input type="text" placeholder="Filter..." value={filters.reason} onChange={(e) => setFilters({ ...filters, reason: e.target.value })}
                        className="mt-1 w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-normal normal-case text-slate-800 focus:outline-none focus:border-slate-900"
                      />
                    </th>
                    <th className="min-w-[140px] px-3 py-2">
                      <button type="button" onClick={() => toggleSort('instanceUrl', dashboardSort, setDashboardSort)} className="flex items-center gap-1 hover:text-slate-900">
                        Panoramax API
                        <SortIcon active={dashboardSort.key === 'instanceUrl'} dir={dashboardSort.dir} />
                      </button>
                      <select value={filters.instance} onChange={(e) => setFilters({ ...filters, instance: e.target.value })}
                        className="mt-1 w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-normal normal-case text-slate-800 focus:outline-none focus:border-slate-900"
                      >
                        <option value="">All Instances</option>
                        {knownInstances.map((url) => (
                          <option key={url} value={url}>{url.replace('https://', '')}</option>
                        ))}
                      </select>
                    </th>
                    <th className="min-w-[120px] px-3 py-2 text-right">
                      <button type="button" onClick={() => toggleSort('lastReviewedAt', dashboardSort, setDashboardSort)} className="flex items-center gap-1 hover:text-slate-900 ml-auto">
                        Reviewer / Date
                        <SortIcon active={dashboardSort.key === 'lastReviewedAt'} dir={dashboardSort.dir} />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pictures.map((p) => {
                    const isSelected = selectedIds.has(p.id);
                    const isChecked = p.isCheckedOff;
                    return (
                      <tr key={p.id} className={`transition-colors ${isSelected ? 'bg-amber-50/50' : isChecked ? 'bg-slate-50/60' : ''} hover:bg-slate-50`}>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(p.id)}
                            className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <input type="checkbox" checked={!!p.isCheckedOff} onChange={async () => {
                              await togglePictureCheckoff([p.pictureId], !p.isCheckedOff);
                              loadData();
                            }}
                              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
                            <span className={`text-[10px] font-semibold ${p.isCheckedOff ? 'text-indigo-700' : 'text-slate-400'}`}>
                              {p.isCheckedOff ? 'Checked' : 'Check off'}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div
                            className="group/pid flex items-center gap-1 font-mono text-slate-900 font-semibold cursor-pointer"
                            onMouseEnter={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setHoveredThumbnail({ url: p.sdUrl, id: p.pictureId, top: rect.top - 20, left: rect.right + 12 });
                            }}
                            onMouseLeave={() => setHoveredThumbnail(null)}
                          >
                            <span className="truncate max-w-[140px] sm:max-w-[200px] group-hover/pid:text-indigo-600 group-hover/pid:underline decoration-indigo-300">
                              {p.pictureId.substring(0, 14)}...
                            </span>
                            <a href={p.sdUrl} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-indigo-600 shrink-0">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </td>
                        <td className="px-3 py-2">{statusPill(p)}</td>
                        <td className="px-3 py-2 text-slate-600 max-w-xs truncate">
                          {p.lastErrorReason ? (
                            <span className="text-rose-700 font-semibold">{p.lastErrorReason}</span>
                          ) : p.lastComment ? (
                            p.lastComment
                          ) : (
                            <span className="italic text-slate-400">No flags</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-500 truncate max-w-[140px]">
                          {p.instanceUrl.replace('https://', '')}
                        </td>
                        <td className="px-3 py-2 text-right text-[11px] text-slate-500">
                          <div>{p.lastReviewer || <span className="italic">Unreviewed</span>}</div>
                          {p.lastReviewedAt && (
                            <div className="text-[10px] text-slate-400">{new Date(p.lastReviewedAt).toLocaleDateString()}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 bg-slate-50 border border-slate-200/90 rounded-xl text-xs text-slate-600 shrink-0">
              <div className="flex items-center gap-2">
                <span>Showing {startItem} to {endItem} of {filteredCount} pictures</span>
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none"
                >
                  {[10, 25, 50, 100, 250].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPage(1)} disabled={page <= 1} className="p-1 hover:bg-slate-200 rounded disabled:opacity-30"><ChevronsLeft className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => setPage(page - 1)} disabled={page <= 1} className="p-1 hover:bg-slate-200 rounded disabled:opacity-30"><ChevronLeft className="w-3.5 h-3.5" /></button>
                <span className="px-2 text-[11px] font-medium text-slate-700">Page {page} of {totalPages}</span>
                <button type="button" onClick={() => setPage(page + 1)} disabled={page >= totalPages} className="p-1 hover:bg-slate-200 rounded disabled:opacity-30"><ChevronRight className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="p-1 hover:bg-slate-200 rounded disabled:opacity-30"><ChevronsRight className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          </div>
        )}

        {tab === 'timeline' && (
          <div className="flex-1 flex flex-col p-4 sm:p-5 gap-3 overflow-hidden min-h-0">
            <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white min-h-0">
              <table className="w-full text-left text-xs text-slate-700 border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2">
                      <button type="button" onClick={() => toggleSort('status', timelineSort, setTimelineSort)} className="flex items-center gap-1 hover:text-slate-900">
                        Status <SortIcon active={timelineSort.key === 'status'} dir={timelineSort.dir} />
                      </button>
                    </th>
                    <th className="px-3 py-2">
                      <button type="button" onClick={() => toggleSort('pictureId', timelineSort, setTimelineSort)} className="flex items-center gap-1 hover:text-slate-900">
                        Picture ID <SortIcon active={timelineSort.key === 'pictureId'} dir={timelineSort.dir} />
                      </button>
                    </th>
                    <th className="px-3 py-2">Details / Comment</th>
                    <th className="px-3 py-2">
                      <button type="button" onClick={() => toggleSort('userName', timelineSort, setTimelineSort)} className="flex items-center gap-1 hover:text-slate-900">
                        Reviewer <SortIcon active={timelineSort.key === 'userName'} dir={timelineSort.dir} />
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <button type="button" onClick={() => toggleSort('reviewedAt', timelineSort, setTimelineSort)} className="flex items-center gap-1 hover:text-slate-900 ml-auto">
                        Date <SortIcon active={timelineSort.key === 'reviewedAt'} dir={timelineSort.dir} />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reviews.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2">
                        {r.status === 'ok' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" /> OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border-rose-200">
                            <AlertTriangle className="w-3 h-3" /> {r.errorReason || 'Error'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div
                          className="group/pid flex items-center gap-1 font-mono text-slate-900 font-semibold cursor-pointer"
                          onMouseEnter={(e) => {
                            if (!r.sdUrl) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHoveredThumbnail({ url: r.sdUrl, id: r.pictureId, top: rect.top - 20, left: rect.right + 12 });
                          }}
                          onMouseLeave={() => setHoveredThumbnail(null)}
                        >
                          <span className="truncate max-w-[140px] sm:max-w-[200px] group-hover/pid:text-indigo-600 group-hover/pid:underline decoration-indigo-300">
                            {r.pictureId.substring(0, 12)}...
                          </span>
                          {r.sdUrl && (
                            <a href={r.sdUrl} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-indigo-600 shrink-0">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-600 max-w-xs truncate">{r.comment || <span className="italic text-slate-400">No notes</span>}</td>
                      <td className="px-3 py-2 text-slate-600">{r.userName}</td>
                      <td className="px-3 py-2 text-right text-[11px] text-slate-400">{new Date(r.reviewedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {reviews.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-slate-400 italic">No reviews yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {hoveredThumbnail && (
        <div
          className="fixed z-50 pointer-events-none bg-slate-900/95 backdrop-blur-xs border border-slate-700/90 rounded-2xl p-2 shadow-2xl flex flex-col items-center w-56 sm:w-64 animate-fade-in"
          style={{ top: Math.min(hoveredThumbnail.top, window.innerHeight - 260), left: Math.min(hoveredThumbnail.left, window.innerWidth - 280) }}
        >
          <div className="w-full h-36 sm:h-40 bg-slate-950 rounded-xl overflow-hidden border border-slate-800">
            <img className="w-full h-full object-cover" src={hoveredThumbnail.url} alt="" loading="eager" />
          </div>
          <div className="flex items-center justify-between w-full mt-1.5 text-[11px] text-slate-300 font-mono px-1">
            <span className="truncate max-w-[120px]">{hoveredThumbnail.id.substring(0, 16)}...</span>
            <span className="text-[9px] text-amber-400 font-sans font-semibold uppercase bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800/60">Preview</span>
          </div>
        </div>
      )}
    </div>
  );
}
