import { useState, useRef, useCallback, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCw, ExternalLink, AlertCircle, CheckCircle2, RefreshCw, Wifi } from 'lucide-react';
import type { PictureItem } from '../types';
import { getProxyImageUrl } from '../services/api';
import { cacheManager } from '../services/cacheManager';

interface ImageStageProps {
  picture: PictureItem | null;
  upcomingPictures?: PictureItem[];
  loading: boolean;
  onRefreshNext?: () => void;
}

export default function ImageStage({ picture, upcomingPictures = [], loading, onRefreshNext }: ImageStageProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [displayUrl, setDisplayUrl] = useState('');
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [isCached, setIsCached] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (picture) {
      setScale(1);
      setRotation(0);
      setPosition({ x: 0, y: 0 });
      setDisplayUrl(picture.sdUrl);
      setImgLoaded(false);
      setImgError(false);
      setIsCached(cacheManager.isCached(picture.sdUrl));
    }
  }, [picture?.id]);

  const handleImgError = useCallback(() => {
    if (!displayUrl.includes('/api/proxy-image')) {
      setDisplayUrl(getProxyImageUrl(picture?.sdUrl || ''));
    } else {
      setImgError(true);
    }
  }, [displayUrl, picture]);

  const zoomAt = useCallback((newScale: number, _cx = 0, _cy = 0) => {
    const clamped = Math.max(1, Math.min(newScale, 8));
    setScale(clamped);
    if (clamped === 1) setPosition({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.85 : 1.15;
    zoomAt(scale * factor);
  }, [scale, zoomAt]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  }, [scale, position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setPosition({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleDoubleClick = useCallback(() => {
    zoomAt(scale > 1.5 ? 1 : 2.5);
  }, [scale, zoomAt]);

  if (!picture && loading) {
    return (
      <div className="relative flex-1 w-full h-full bg-slate-950 overflow-hidden select-none flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="w-10 h-10 border-3 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-3" />
          <p className="text-xs text-slate-400 font-semibold tracking-wider uppercase">Loading Next Image...</p>
        </div>
      </div>
    );
  }

  if (!picture) {
    return (
      <div className="relative flex-1 w-full h-full bg-slate-950 overflow-hidden select-none flex flex-col items-center justify-center p-6">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-4" />
        <h2 className="text-lg font-bold text-white mb-2">Queue Completed!</h2>
        <p className="text-xs text-slate-400 mb-4">All pictures have been reviewed.</p>
        {onRefreshNext && (
          <button
            type="button"
            onClick={onRefreshNext}
            className="bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold px-4 py-2 flex items-center gap-2 transition-all active:scale-95"
          >
            <RefreshCw className="w-4 h-4" />
            Reload Random Sample
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      id="image-viewport-container"
      ref={containerRef}
      className="relative flex-1 w-full h-full bg-slate-950 overflow-hidden select-none"
      style={{ touchAction: 'pinch-zoom' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="w-full h-full flex items-center justify-center"
        onDoubleClick={handleDoubleClick}
      >
        <div
          className="flex items-center justify-center w-full h-full p-2 sm:p-4"
          style={{
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale}) rotate(${rotation}deg)`,
          }}
        >
          <img
            id="panoramax-current-image"
            ref={imgRef}
            src={displayUrl}
            alt={`Panoramax ${picture.pictureId}`}
            className={`transition-opacity duration-200 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', margin: 'auto' }}
            draggable={false}
            onLoad={() => setImgLoaded(true)}
            onError={handleImgError}
          />
        </div>
      </div>

      {!imgLoaded && !imgError && (
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs flex flex-col items-center justify-center pointer-events-none">
          <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-2" />
          <p className="text-xs text-slate-400">Loading Image...</p>
        </div>
      )}

      {imgError && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl text-center max-w-sm">
            <AlertCircle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-200 mb-1">Image Failed to Load</p>
            <p className="text-[11px] font-mono text-slate-400 break-all">{picture.pictureId}</p>
          </div>
        </div>
      )}

      <div className="absolute top-2 right-2 z-20 flex items-center gap-0.5 bg-slate-900/85 backdrop-blur-md p-1 rounded-lg border border-slate-700/60 shadow-xs">
        <button type="button" onClick={() => zoomAt(scale * 1.4)} title="Zoom in" className="p-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded transition-colors active:scale-95">
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={() => zoomAt(scale / 1.4)} disabled={scale <= 1} title="Zoom out" className="p-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded transition-colors active:scale-95 disabled:opacity-40">
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={() => zoomAt(1)} title="Reset zoom" className="px-1.5 py-0.5 hover:bg-slate-800 text-slate-200 rounded text-[10px] font-mono font-bold transition-colors">
          {Math.round(scale * 100)}%
        </button>
        <div className="w-px h-3 bg-slate-700 my-auto" />
        <button type="button" onClick={() => setRotation((r) => (r + 90) % 360)} title="Rotate" className="p-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded transition-colors active:scale-95">
          <RotateCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="absolute top-2 left-2 z-20 flex flex-wrap items-center gap-1.5 max-w-[calc(100%-150px)]">
        <div className="bg-slate-900/85 backdrop-blur-md px-2.5 py-1 rounded-lg border border-slate-700/60 shadow-xs flex items-center gap-1.5 text-[11px] text-slate-300">
          <span className="font-mono font-semibold truncate text-slate-100 max-w-[90px] sm:max-w-[180px]">
            {picture.pictureId.substring(0, 10)}...
          </span>
          <a href={`${picture.instanceUrl.replace(/\/api\/?$/, '').replace(/\/$/, '')}/?focus=pic&pic=${picture.pictureId}`} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white p-0.5">
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <div className={`px-2 py-0.5 rounded-lg border text-[10px] flex items-center gap-1 ${
          isCached ? 'bg-emerald-950/80 border-emerald-700/70 text-emerald-300' : 'bg-slate-900/85 border-slate-700/60 text-slate-400'
        }`}>
          <Wifi className="w-2.5 h-2.5" />
          <span className="hidden sm:inline">{isCached ? 'Cached' : 'Online'}</span>
        </div>
      </div>

      {scale === 1 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none px-2.5 py-0.5 bg-slate-900/80 backdrop-blur-xs rounded-full border border-slate-800 text-[10px] text-slate-400 whitespace-nowrap">
          Pinch to zoom • Scroll wheel on desktop
        </div>
      )}

      {upcomingPictures.length > 0 && (
        <div className="absolute top-0 left-0 w-px h-px opacity-0 pointer-events-none overflow-hidden -z-50" aria-hidden="true">
          {upcomingPictures.slice(0, 1).map((pic) => (
            <img key={pic.id} src={pic.sdUrl} decoding="async" alt="" style={{ position: 'absolute', width: '1px', height: '1px', top: '-999px', left: '-999px' }} />
          ))}
        </div>
      )}
    </div>
  );
}
