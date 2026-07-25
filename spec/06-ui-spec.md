# 06 — UI Specification

This document describes every screen, its layout, colors, spacing, and interactions. The implementer should reproduce this faithfully. Use Tailwind v4 utility classes; the design uses Tailwind's default `slate` palette plus `emerald`, `rose`, `amber`, `indigo` accents.

## Global design language

- **Font:** system sans (`font-sans`), monospace for IDs and counts (`font-mono`).
- **Background:** `bg-slate-50` for the app shell and modals; `bg-slate-950` for the image viewport.
- **Surface:** `bg-white` with `border border-slate-200/80` and `rounded-2xl`.
- **Text:** `text-slate-900` primary, `text-slate-500` secondary, `text-slate-400` tertiary.
- **Primary action:** `bg-slate-900 hover:bg-slate-800 text-white`.
- **Success / OK:** `bg-emerald-600 hover:bg-emerald-500 text-white`.
- **Danger / Flag:** `bg-rose-600 hover:bg-rose-500 text-white`.
- **Warning / Offline / Cellular saver:** `bg-amber-500/15 text-amber-900 border-amber-300`.
- **Info / Resolved:** `bg-indigo-600 text-white` (or `text-indigo-700 bg-indigo-50` for pills).
- **Rounded:** `rounded-lg` for small controls, `rounded-xl` for buttons, `rounded-2xl` for cards/modals.
- **Shadows:** `shadow-xs` on most surfaces, `shadow-xl` on modals.
- **Backdrop blur:** `backdrop-blur-md` on header and bottom toolbar; `backdrop-blur-xs` on modal overlays (`bg-slate-900/40`).
- **Animations:** `transition-all`, `active:scale-[0.98]` on buttons, `animate-spin` on loaders, `animate-ping` / `animate-pulse` on status dots, `animate-fade-in` (define this keyframe in `index.css` if not provided by Tailwind v4 — `@keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }` + `.animate-fade-in { animation: fade-in 150ms ease-out }`).
- **Selection:** `select-none` on the main review UI (prevents accidental text selection during drag pan). Inputs and textareas are obviously selectable.
- **Height:** the main app uses `h-[100dvh]` (dynamic viewport height for mobile browser chrome).

## Screen 1: Loading splash

Shown when `authChecking === true`. Full-screen `min-h-[100dvh]`, `bg-slate-50`, centered column:
- Spinner: `w-9 h-9 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin mb-3`
- Text: `<p class="text-xs font-semibold tracking-wider uppercase text-slate-500">Initializing Panoramax Review...</p>`

## Screen 2: AuthScreen

Full-screen `min-h-[100dvh] bg-slate-50 text-slate-900 flex flex-col justify-center items-center px-4 py-8 select-none font-sans`.

Contents (centered, `max-w-md space-y-6`):

1. **Brand header** (centered, `space-y-2`):
   - Icon: `inline-flex items-center justify-center p-3 bg-slate-900 text-white rounded-2xl shadow-sm mb-1` containing `<Image class="w-8 h-8" />` (lucide `Image`).
   - Title: `<h1 class="text-2xl sm:text-3xl font-bold tracking-tight">Panoramax Review</h1>`
   - Subtitle: `<p class="text-slate-500 text-xs sm:text-sm max-w-xs mx-auto leading-relaxed">Mobile-friendly review tool for Panoramax street-level imagery.</p>`

2. **Card** (`bg-white rounded-2xl border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6`):
   - Centered heading block: `<h2 class="text-sm font-semibold text-slate-800">Authentication Required</h2>` + `<p class="text-xs text-slate-500">You must be logged into YunoHost to access this app.</p>`
   - Primary CTA: a link styled as a button, pointing to `/yunohost/sso/?r=/`. Style: `w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl border border-slate-700 shadow-sm flex items-center justify-center gap-2`. Icon: `<Lock class="w-4 h-4" />` + text "Log in via YunoHost".
   - Optional error alert (if `bootstrapSession` returned an unexpected error): `p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2.5` with `<AlertCircle />` and the error message.
   - Footer line: `<p class="text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5"><Lock class="w-3 h-3" /> Restricted access &bull; YunoHost SSO</p>`

3. Below the card: `<p class="text-center text-xs text-slate-400">Panoramax Open Imagery Spec</p>`

No Google logo, no Google button.

## Screen 3: Main review UI

`<div class="flex flex-col h-[100dvh] w-screen bg-slate-50 text-slate-900 font-sans overflow-hidden select-none">`

Three rows: a fixed header, a flexible middle (image viewport), and a fixed bottom toolbar. Modals render as siblings with `fixed inset-0`.

### 3.1 Header

`<header class="shrink-0 w-full min-h-[3.25rem] sm:h-14 bg-white/95 border-b border-slate-200/80 px-2.5 sm:px-5 py-1.5 flex items-center justify-between z-30 backdrop-blur-md shadow-xs gap-2 overflow-hidden">`

**Left side:** brand + counters
- Icon badge: `p-1.5 sm:p-2 bg-slate-900 text-white rounded-lg sm:rounded-xl shadow-xs shrink-0` containing `<Image class="w-3.5 h-3.5 sm:w-4 sm:h-4" />`
- Title block (`min-w-0`):
  - `<h1 class="text-xs sm:text-sm font-bold text-slate-900 tracking-tight leading-tight truncate">Panoramax</h1>`
  - Counter row `flex items-center gap-1.5 text-[10px] sm:text-[11px] text-slate-500 font-mono whitespace-nowrap`:
    - `Q: <strong class="text-slate-900 font-bold">{stats?.pendingQueue ?? 0}</strong>`
    - `<span class="text-slate-300">&bull;</span>`
    - `Rev: <strong class="text-emerald-600 font-bold">{stats?.userReviewCount ?? 0}</strong>`

**Right side:** action buttons (`flex items-center gap-1 sm:gap-2 shrink-0`). In order:

1. **Offline / sync indicator** — only visible when `!isOnline` OR `offlinePendingCount > 0`. Pill style:
   - Offline: `bg-amber-500/15 text-amber-900 border-amber-300` with a `bg-amber-500 animate-ping` dot. Label (hidden on mobile, shown on `sm+`): `Offline ({offlinePendingCount})`
   - Online with pending: `bg-emerald-500/15 text-emerald-900 border-emerald-300` with `bg-emerald-500 animate-pulse` dot. Label: `Syncing {offlinePendingCount}...`

2. **Install PWA button** — only visible when `deferredPrompt` is set. `bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg sm:rounded-xl text-[11px] sm:text-xs flex items-center gap-1 shadow-xs active:scale-[0.98] transition-all animate-pulse`. Icon `<Sparkles class="w-3.5 h-3.5 fill-slate-950" />`, label "Install App" (hidden on mobile).

3. **Import button** — `id="btn-header-import"`. `p-1.5 sm:px-3 sm:py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg sm:rounded-xl text-xs font-medium flex items-center gap-1.5 shadow-xs active:scale-[0.98]`. Icon `<Upload class="w-3.5 h-3.5" />`, label "Import" (hidden on mobile).

4. **Dashboard button** — `id="btn-header-history"`. `p-1.5 sm:px-3 sm:py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-lg sm:rounded-xl border border-slate-200/80 active:scale-[0.98] flex items-center gap-1.5`. Icon `<Layers class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-900" />`, label "Dashboard" (hidden below `md`).

5. **Cellular saver toggle pill** — `id="btn-header-cellular-saver"`. Two-state:
   - Off: `bg-slate-100 text-slate-600 border-slate-200/80 hover:bg-slate-200`
   - On: `bg-amber-500/15 text-amber-900 border-amber-300`
   Icon `<Wifi class="w-3.5 h-3.5" />` (amber when on, slate-500 when off). Label "Data Saver" / "Data Saver: ON" (hidden below `lg`).

6. **Settings button** — `id="btn-header-settings"`. `p-1.5 sm:p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg sm:rounded-xl border border-slate-200/80 active:scale-[0.98]`. Icon `<Settings class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-700" />`. No label.

7. Vertical divider: `w-px h-3.5 bg-slate-200 my-auto mx-0.5 hidden sm:block`

8. **User profile + logout** — `flex items-center gap-1 bg-slate-100 px-1.5 sm:px-2.5 py-1 rounded-lg sm:rounded-xl border border-slate-200/80`:
   - `<UserIcon class="w-3.5 h-3.5 text-slate-500 shrink-0" />` (lucide `User as UserIcon`)
   - Username: `text-[11px] sm:text-xs font-medium text-slate-700 max-w-[60px] sm:max-w-[80px] truncate hidden xs:inline sm:inline`
   - Logout button (`id="btn-header-logout"`): `p-0.5 sm:p-1 hover:text-rose-600 text-slate-400 rounded-md transition-colors`. Icon `<LogOut class="w-3.5 h-3.5" />`.

### 3.2 Image viewport (`<main>`)

`<main class="flex-1 w-full relative overflow-hidden flex flex-col bg-slate-950">` containing `<ImageStage />`. See component spec below.

### 3.3 Bottom review toolbar

`<ReviewControls />` — see component spec.

### 3.4 Floating Undo toast

`<UndoToast />` — absolutely positioned `bottom-[92px] left-3 sm:bottom-[115px] sm:left-6 z-40`. See component spec.

### 3.5 Modals

Render conditionally based on state. All modals share the same overlay container pattern (see `ErrorModal` etc. specs).

## Component: ImageStage

The viewport for the current picture. Props:

```ts
interface ImageStageProps {
  picture: PictureItem | null;
  upcomingPictures?: PictureItem[];   // pre-rendered off-screen for instant swap
  loading: boolean;
  onRefreshNext?: () => void;        // shown on "queue exhausted" screen
}
```

### Container

`<div id="image-viewport-container" class="relative flex-1 w-full h-full bg-slate-950 overflow-hidden select-none touch-none flex items-center justify-center p-2 sm:p-4">` with these handlers:
- `onWheel` — zoom in/out by factor 1.15 / 0.85.
- `onMouseDown/Move/Up/Leave` — drag to pan when `scale > 1`.
- `onTouchStart/Move/End` — pinch zoom and drag pan; double-tap toggles zoom 1 ↔ 2.5.

### Zoomable image layer

`<div class="w-full h-full flex items-center justify-center transition-transform duration-75 ease-out" style="transform: translate3d(...) scale(...) rotate(...)">`

Holds either:
- `<img id="panoramax-current-image" src={displayUrl} ... class="transition-opacity duration-200 {imgLoaded ? 'opacity-100' : 'opacity-0'}" style="max-width:100%; max-height:100%; object-fit:contain; margin:auto" draggable={false} />`
- Or an error card if `imgError`: `p-6 bg-slate-900 border border-slate-800 rounded-2xl text-center max-w-sm` with `<AlertCircle class="w-8 h-8 text-rose-400 mx-auto mb-2" />`, "Image Failed to Load", and the picture ID.

### Image loading state

- When `loading && !picture`: full-viewport spinner on `bg-slate-950`. `<div class="w-10 h-10 border-3 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-3" />` + "Loading Next Image...".
- When `!picture` (queue exhausted): centered `CheckCircle2` icon in a rounded box, "Queue Completed!" message, and a "Reload Random Sample" button (`bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold` with `<RefreshCw class="w-4 h-4" />`).
- When image is loading (but a picture exists): overlay `absolute inset-0 bg-slate-950/80 backdrop-blur-xs flex flex-col items-center justify-center pointer-events-none` with a spinner and "Loading Image...".

### Image error fallback

If the `<img>` `onError` fires and `displayUrl === picture.sdUrl`, swap `displayUrl` to `/api/proxy-image?url=...` (via `getProxyImageUrl`). If that also errors, set `imgError = true`.

### Overlay 1 — Zoom/rotate control bar (top right)

`<div class="absolute top-2 right-2 z-20 flex items-center gap-0.5 bg-slate-900/85 backdrop-blur-md p-1 rounded-lg border border-slate-700/60 shadow-xs text-slate-200 font-sans">`

Buttons (each `p-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded transition-colors active:scale-95`):
- `<ZoomIn class="w-3.5 h-3.5" />` (zoom in)
- `<ZoomOut class="w-3.5 h-3.5" />` (zoom out, disabled when `scale <= 1`)
- Reset button: `px-1.5 py-0.5 hover:bg-slate-800 text-slate-200 rounded text-[10px] font-mono font-bold` showing `{Math.round(scale * 100)}%`
- Divider: `w-px h-3 bg-slate-700 my-auto`
- `<RotateCw class="w-3.5 h-3.5" />` (rotate +90°)

Zoom range: `1` to `8`. Zoom factor on button press: ×1.4 / ÷1.4. When `scale === 1`, reset position to `{0,0}`.

### Overlay 2 — Image meta pill (top left)

`<div class="absolute top-2 left-2 z-20 flex flex-wrap items-center gap-1.5 max-w-[calc(100%-150px)] font-sans">`

- Primary pill `bg-slate-900/85 backdrop-blur-md px-2.5 py-1 rounded-lg border border-slate-700/60 shadow-xs flex items-center gap-1.5 text-[11px] text-slate-300`:
  - Truncated ID: `<span class="font-mono font-semibold truncate text-slate-100 max-w-[90px] sm:max-w-[180px]">{pictureId.substring(0,10)}...</span>`
  - External link: `<a href={instanceUrl + '/pictures/' + pictureId} target="_blank" rel="noopener noreferrer" class="text-slate-400 hover:text-white p-0.5"><ExternalLink class="w-3 h-3" /></a>`
- Cache status pill: when `isCached`, `bg-emerald-950/80 border-emerald-700/70 text-emerald-300`; otherwise `bg-slate-900/85 border-slate-700/60 text-slate-400`. `<Wifi class="w-2.5 h-2.5" />` + label "Cached" / "Online" (label hidden on mobile).

### Overlay 3 — Gesture hint

When `scale === 1`, show a small pill at `bottom-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none`: `px-2.5 py-0.5 bg-slate-900/80 backdrop-blur-xs rounded-full border border-slate-800 text-[10px] text-slate-400` — text: "Double-tap / Pinch to zoom • Drag to pan".

### Off-screen pre-render

`<div class="absolute top-0 left-0 w-px h-px opacity-0 pointer-events-none overflow-hidden -z-50" aria-hidden="true">` containing one `<img>` per upcoming picture: `src={upcomingPic.sdUrl}`, `decoding="async"`, `style="position:absolute; width:1px; height:1px; top:-999px; left:-999px"`. Track loaded URLs in a `useRef<Set>` so the main `<img>` can render instantly.

## Component: ReviewControls

`<div id="bottom-review-toolbar" class="shrink-0 w-full bg-white/95 border-t border-slate-200/80 px-4 py-3 select-none backdrop-blur-md z-30 shadow-xs">`

Inside: `<div class="max-w-xl mx-auto space-y-2">`

### Top row: progress pill
`flex items-center justify-between text-xs text-slate-500 px-1 font-medium`:
- Left: `<Info class="w-3.5 h-3.5 text-slate-700" />` + `Pending Queue: <strong class="text-slate-900 font-bold">{pendingCount}</strong>`
- Right: `<span class="text-[11px] text-slate-400 font-mono">Total Catalog: {totalPictures}</span>`

### Main button row: `grid grid-cols-12 gap-3 items-center`

- **OK button** (`col-span-5`): `id="btn-review-ok"`, `h-12 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold text-sm sm:text-base rounded-xl shadow-xs active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-40`. Contents: `<Check class="w-5 h-5 stroke-[2.5]" />`, "OK (Pass)", and on `sm+` a `<kbd>` badge: `class="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono font-bold bg-emerald-700/60 rounded text-emerald-100 border border-emerald-400/30"` containing "Enter".
- **Flag button** (`col-span-5`): `id="btn-review-error"`, same structure but `bg-rose-600 hover:bg-rose-500 active:bg-rose-700`. Icon `<AlertTriangle class="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />`, text "Flag Issue", `<kbd>` "E" with rose colors.
- **Skip button** (`col-span-2`): `id="btn-review-skip"`, `h-12 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl border border-slate-200/80 active:scale-[0.96] flex items-center justify-center gap-1 disabled:opacity-40`. Icon `<SkipForward class="w-4 h-4 sm:w-5 sm:h-5" />`, on `lg+` a `<kbd>` "→" with `bg-slate-200 text-slate-700 border-slate-300`.

### Desktop keyboard hints (hidden on mobile)
`hidden sm:flex items-center justify-center gap-3 text-[11px] text-slate-500 pt-1 font-sans`:
- "Shortcuts:"
- `<kbd>Enter</kbd>` or `<kbd>O</kbd>` OK
- `&bull;`
- `<kbd>E</kbd>` Flag Error
- `&bull;`
- `<kbd>←/→</kbd>` or `<kbd>S</kbd>` Skip

All `<kbd>` elements use: `px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono text-slate-800 font-bold text-[10px]`.

## Component: ErrorModal

Fixed overlay: `fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in font-sans`.

Card: `w-full max-w-lg bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-xl space-y-5 text-slate-900 max-h-[90vh] overflow-y-auto`.

### Header
`flex items-start justify-between gap-3 border-b border-slate-100 pb-4`:
- Icon box: `p-2.5 bg-rose-50 text-rose-600 rounded-xl border border-rose-200/80` with `<AlertTriangle class="w-5 h-5" />`
- Title block: `<h3 class="text-base sm:text-lg font-bold text-slate-900">Flag Image Defect</h3>` + `<p class="text-xs text-slate-500 font-mono">ID: {pictureId}</p>`
- Close button: `p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg` with `<X class="w-5 h-5" />`

### Form

Label: `<label class="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Select Problem Category</label>`

Reason grid: `grid grid-cols-1 sm:grid-cols-2 gap-2`. Each button (`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5`):
- Selected: `bg-rose-50/70 border-rose-500 text-slate-900 ring-1 ring-rose-500`
- Unselected: `bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-100/60`
- Inner icon box: `p-1 rounded-lg mt-0.5 shrink-0` — selected: `bg-rose-600 text-white`; unselected: `bg-slate-200 text-slate-600`. Icon `<AlertTriangle class="w-3.5 h-3.5" />`.
- Text: `<div class="text-xs font-semibold text-slate-900">{label}</div>` + `<div class="text-[11px] text-slate-500 mt-0.5 leading-snug">{description}</div>`

Iterate `COMMON_ERROR_REASONS` from `types.ts`. Default selected: `'privacy'`.

Comment textarea: label `flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1.5` with `<MessageSquare class="w-3.5 h-3.5 text-slate-600" />` + "Optional Notes / Explanation". Textarea: `w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-rose-600 focus:ring-1 focus:ring-rose-600 transition-all resize-none` rows=3. Placeholder: "Provide extra details (e.g., license plate visible on red van, camera rotated 90deg)..."

Footer: `flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100`:
- Cancel: `px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl`
- Submit (`id="btn-submit-flag"`): `px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl shadow-xs active:scale-95 flex items-center gap-1.5 disabled:opacity-50`. When submitting, show spinner. Otherwise `<CheckCircle class="w-4 h-4" />` + "Submit Flag & Next".

Press `Escape` to close (handled in a `useEffect`).

## Component: ImportModal

`max-w-xl` card. Two tabs: "Upload File or Paste IDs" and "Panoramax API Sync".

### Header
Icon box: `p-2.5 bg-slate-100 text-slate-800 rounded-xl border border-slate-200/80` with `<Upload class="w-5 h-5" />`. Title "Import Picture IDs", subtitle "Upload file or paste Panoramax picture IDs/URLs".

### Tabs
`flex rounded-xl bg-slate-100 p-1 border border-slate-200/60`:
- Tab 1 (`id="tab-import-text"`): icon `<FileText class="w-3.5 h-3.5" />` + "Upload File or Paste IDs"
- Tab 2 (`id="tab-import-stac"`): icon `<Globe class="w-3.5 h-3.5" />` + "Panoramax API Sync"
- Active: `bg-slate-900 text-white shadow-xs`; inactive: `text-slate-500 hover:text-slate-800`.

### Status alert
When `message` set, `p-3 rounded-xl border text-xs flex items-center gap-2.5`. Success: `bg-emerald-50 border-emerald-200 text-emerald-800` + `<CheckCircle2 class="w-4 h-4 text-emerald-600" />`. Error: `bg-rose-50 border-rose-200 text-rose-800` + `<AlertCircle class="w-4 h-4 text-rose-600" />`.

### Tab 1 body

**File dropzone**: `border-2 border-dashed border-slate-200 hover:border-slate-400 bg-slate-50/70 hover:bg-slate-100/60 rounded-xl p-4 text-center cursor-pointer transition-all space-y-1.5 group`. Click opens file picker (`accept=".txt,.csv,.json,.tsv"`). Drag-and-drop also supported. Inner: icon box (`w-9 h-9 mx-auto bg-white rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 group-hover:scale-105` with `<FileUp class="w-4 h-4 text-slate-800" />`), text `text-xs font-semibold text-slate-800` showing filename or "Click to select or drag & drop a file", hint `text-[11px] text-slate-400` "Supports .txt, .csv, .json, or .tsv containing picture UUIDs or URLs".

**Textarea**: label "Or Paste Picture IDs / URLs" with "Clear text" link if non-empty. `w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 resize-none` rows=4. Placeholder shows three example UUIDs/URLs.

**Duplicates hint**: `flex items-center gap-1 text-[11px] text-slate-500` with `<ListFilter class="w-3.5 h-3.5 text-slate-600" />` + "Duplicates skipped automatically".

**Progress bar**: only when `loading && totalProgress > 0`. `w-full bg-slate-200 rounded-full h-1.5 overflow-hidden` with `bg-slate-900 h-1.5 rounded-full transition-all duration-300` width = percent. Above: `flex justify-between text-[11px] text-slate-500 font-semibold` showing "Importing..." and "{progress} / {totalProgress} ({percent}%)".

**Submit button** (`id="btn-import-text-submit"`): `w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-xs active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50`. When loading, spinner; otherwise `<Upload class="w-4 h-4" />` + "Process & Import IDs".

### Tab 2 body

- Input: "Panoramax API Endpoint URL" (`type=url`, required). Style: `w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-slate-900`.
- Select: "Max Images to Fetch" with options 10, 25, 50 (default 25). Same input styling.
- Info box: `text-[11px] text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200/80 leading-relaxed` explaining "Queries the STAC /search API endpoint on the specified instance, extracts photo IDs, and adds any new non-duplicate pictures to your queue."
- Submit button (`id="btn-import-stac-submit"`): same style as Tab 1, but with `<Globe class="w-4 h-4" />` and "Fetch New Pictures from API".

## Component: HistoryExplorer

Largest component. Full-screen modal: `max-w-5xl`, `max-h-[94vh]`, `flex flex-col`.

### Header
Icon box `p-2.5 bg-slate-900 text-white rounded-xl shadow-xs` with `<Layers class="w-5 h-5" />`. Title "Picture Review Dashboard", subtitle "Filter picture IDs, triage flagged images, and export CSV reports". Close button on right.

### Top metric cards
When `stats` loaded: `grid grid-cols-2 sm:grid-cols-5 gap-2` of 5 cards. Each: `bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 text-center`. Inner: tiny uppercase label `text-[10px] font-semibold uppercase tracking-wider` (color varies: total = `text-slate-500`, pending = `text-amber-600`, ok = `text-emerald-700`, flagged = `text-rose-700`, checked = `text-indigo-700`) + big number `text-base sm:text-lg font-bold mt-0.5` (matching darker color: total/pending slate-900/amber-600, ok emerald-600, flagged rose-600, checked indigo-600). The "Checked Off" card spans 2 cols on mobile, 1 on `sm+`.

Cards: Total Catalog (slate), Pending Queue (amber), Passed OK (emerald), Flagged Errors (rose), Checked Off (indigo).

### Tabs
`flex items-center justify-between border-b border-slate-200 gap-2`:
- Tab buttons (`px-3 py-2 text-xs font-bold rounded-t-xl border-b-2 flex items-center gap-1.5`):
  - Active: `border-slate-900 text-slate-900 bg-slate-50`
  - Inactive: `border-transparent text-slate-500 hover:text-slate-900`
- Tab 1: `<CheckSquare class="w-3.5 h-3.5" />` + "Picture Catalog Dashboard ({pictures.length})"
- Tab 2: `<History class="w-3.5 h-3.5" />` + "Audit Review Timeline ({reviews.length})"
- Right: Refresh button `p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg text-xs font-medium flex items-center gap-1` with `<RefreshCw class={loading ? 'animate-spin' : ''} />` + "Refresh" (hidden on mobile).

### Status notification
When set: `p-2.5 bg-slate-900 text-white text-xs rounded-xl flex items-center justify-between shrink-0 animate-fade-in shadow-xs`. Dismiss button on right.

### Tab 1 — Picture Catalog Dashboard

**Batch action toolbar**: `flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 shrink-0`.

Left side:
- "Select Page" button: `px-2.5 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-2xs`. Icon `<CheckSquare class="w-3.5 h-3.5 text-slate-900" />` if all selected, else `<Square class="w-3.5 h-3.5 text-slate-400" />`. Label: `selectedIds.size > 0 ? 'Selected ({n})' : 'Select Page'`.
- When `selectedIds.size > 0`, show three more buttons inline:
  - "Check Off Selected" (`bg-indigo-600 hover:bg-indigo-700 text-white`) with `<Check class="w-3.5 h-3.5" />`
  - "Uncheck" (`bg-white border border-slate-200 text-slate-700 hover:bg-slate-100`)
  - "Delete" (`bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100`) with `<Trash2 class="w-3.5 h-3.5 text-rose-600" />`. Confirms with `window.confirm`.

Right side (always):
- "Export CSV Report" button (`bg-slate-900 hover:bg-slate-800 text-white`) with `<FileSpreadsheet class="w-3.5 h-3.5 text-emerald-400" />`. Label: if `selectedIds.size > 0`, "Export CSV Report ({n} Selected)"; else "Export CSV Report (Full List {pictures.length})".

**Table**: `flex-1 overflow-auto rounded-xl border border-slate-200 bg-white min-h-0` containing `<table class="w-full text-left text-xs text-slate-700 border-collapse">`.

Header row (`bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-700 uppercase sticky top-0 z-10`), columns (each `px-3 py-2`):
1. **Checkbox** (`w-10 text-center`) — header has a master-select checkbox for the current page.
2. **Checked Off** (`w-24`) — label + `<select>` with options All / Checked ☑ / Unchecked ☐.
3. **Picture ID** (`min-w-[160px]`) — label + `<input type="text" placeholder="Filter ID...">` (font-mono).
4. **Review Status** (`min-w-[120px]`) — label + `<select>` with All / Pending / Passed OK / Flagged Error / Resolved.
5. **Error Reason / Notes** (`min-w-[160px]`) — label + `<input>` filter.
6. **Panoramax API** (`min-w-[140px]`) — label + `<input>` filter.
7. **Reviewer / Date** (`min-w-[120px] text-right`) — label only (no filter input).

Filter inputs: `mt-1 w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-normal normal-case text-slate-800 focus:outline-none focus:border-slate-900`. (Use `font-mono` for the ID filter.)

Body rows (`divide-y divide-slate-100`):
- Selected: `bg-amber-50/50`; checked off (not selected): `bg-slate-50/60`; default: ``. Hover: `hover:bg-slate-50 transition-colors`.
- Cell 1: row checkbox (`rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer`).
- Cell 2: label with checkbox (`w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer`) and text "Checked" (indigo-700 bold) or "Check off" (slate-400).
- Cell 3: `font-mono text-slate-900 font-semibold`. Inner `div` has `onMouseEnter` setting `hoveredThumbnail` to `{ url: p.sdUrl, id, x: rect.right + 12, y: rect.top - 20 }`. Truncated span (`truncate max-w-[140px] sm:max-w-[200px] group-hover/pid:text-indigo-600 group-hover/pid:underline decoration-indigo-300`). External link `<a href={p.sdUrl} target="_blank">` with `<ExternalLink class="w-3 h-3" />`.
- Cell 4: status pill:
  - `reviewed_ok`: `bg-emerald-50 text-emerald-700 border-emerald-200` + `<CheckCircle2 class="w-3 h-3" />` + "Passed OK"
  - `flagged`: `bg-rose-50 text-rose-700 border-rose-200` + `<AlertTriangle class="w-3 h-3" />` + "Flagged"
  - resolved (isCheckedOff): `bg-indigo-50 text-indigo-700 border-indigo-200` + `<Check class="w-3 h-3" />` + "Resolved"
  - pending: `bg-slate-100 text-slate-600 border border-slate-200` + "Pending"
  All pills: `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold`.
- Cell 5: `text-slate-600 max-w-xs truncate`. If `lastErrorReason`: `<span class="text-rose-700 font-semibold">`. Else if `lastComment`: plain. Else: `<span class="italic text-slate-400">No flags</span>`.
- Cell 6: `font-mono text-[11px] text-slate-500 truncate max-w-[140px]` showing `instanceUrl.replace('https://', '')`.
- Cell 7: `text-right text-[11px] text-slate-500`. Reviewer (or "Unreviewed" italic). Below: `text-[10px] text-slate-400` with `new Date(lastReviewedAt).toLocaleDateString()`.

**Pagination bar** below the table: `flex flex-wrap items-center justify-between gap-3 px-3 py-2 bg-slate-50 border border-slate-200/90 rounded-xl text-xs text-slate-600`.
- Left: "Showing X to Y of Z pictures" + page size selector (10, 25, 50, 100, 250).
- Right: first / prev / "Page X of Y" / next / last buttons using `<ChevronsLeft>`, `<ChevronLeft>`, `<ChevronRight>`, `<ChevronsRight>` (all `w-3.5 h-3.5`).

### Tab 2 — Audit Review Timeline

Table (`text-left text-xs text-slate-700`), header (`bg-slate-50 border-b text-[11px] font-bold text-slate-500 uppercase sticky top-0`), columns: Status, Picture ID, Details / Comment, Reviewer, Date (right-aligned).

Rows: status pill (ok = emerald, error = rose showing `errorReason`), `pictureId` (font-mono slate-900), comment (or "No notes" italic slate-400), reviewer name, `new Date(reviewedAt).toLocaleString()` (right-aligned `text-[11px] text-slate-400`).

Pagination bar identical in style to Tab 1, but page sizes are 10, 25, 50, 100.

### Floating thumbnail preview
When `hoveredThumbnail` set: `fixed z-50 pointer-events-none bg-slate-900/95 backdrop-blur-xs border border-slate-700/90 rounded-2xl p-2 shadow-2xl flex flex-col items-center w-56 sm:w-64 animate-fade-in`. Positioned via inline `style={{ top, left }}` clamped to viewport. Inner image area: `w-full h-36 sm:h-40 bg-slate-950 rounded-xl overflow-hidden border border-slate-800` with `<img class="w-full h-full object-cover" loading="eager" />`. Footer: `flex items-center justify-between text-[11px] text-slate-300 font-mono` with truncated ID and "Preview" badge (`text-[9px] text-amber-400 font-sans font-semibold uppercase bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800/60`).

## Component: SettingsModal

`max-w-lg` card.

### Header
Icon box `bg-slate-100 text-slate-800` with `<Settings class="w-5 h-5" />`. Title "Cache & Data Settings", subtitle "Configure offline image caching (up to 500) and cellular saver".

### Message banner
When set: `p-3 bg-slate-100 border border-slate-200 text-slate-800 text-xs rounded-xl flex items-center gap-2` with `<CheckCircle2 class="w-4 h-4 text-emerald-600" />`.

### Cache size control
Label row (`flex items-center justify-between mb-1.5`): "Offline Pre-fetch Cache Limit" + number input (`w-20 px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-right`) clamped 5–500, with "Images" suffix.

Range input: `w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-slate-900`, min 5, max 500, step 5.

Presets row: `flex items-center justify-between mt-2 pt-1 border-t border-slate-100 gap-1.5`. Label `text-[10px] text-slate-400 font-mono` "Presets:". Buttons for 10, 50, 100, 250, 500. Each `px-2 py-0.5 text-[10px] font-mono font-bold rounded-md`. Active: `bg-slate-900 text-white shadow-2xs`. Inactive: `bg-slate-100 text-slate-600 hover:bg-slate-200`.

### Cellular saver toggle card
`bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-2.5`. Inner row (`flex items-center justify-between`):
- Left: icon box (varies by state) with `<Smartphone class="w-4 h-4" />` + text block: "Cellular Data Saver" + "Pause background image downloads on mobile/metered data".
- Right: toggle switch (`relative inline-flex items-center cursor-pointer`):
  - `<input type="checkbox" class="sr-only peer" />`
  - `w-9 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500`

If `navigator.connection` reports cellular/2g/3g/saveData, show warning: `text-[10px] text-amber-800 bg-amber-50 border border-amber-200 p-2 rounded-lg flex items-center gap-1.5 font-medium` with `<WifiOff class="w-3.5 h-3.5 text-amber-600" />` + "Cellular/metered connection detected on this device. Data saver is recommended."

### Instance URL input
Label "Default Panoramax Instance URL". Input: `w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-slate-900` (`type=url`, required).

### Cache status card
`bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-3`. Row showing "Currently Cached in Storage:" and `font-mono font-bold text-slate-900 bg-white px-2.5 py-0.5 rounded-md border border-slate-200 shadow-xs` with `{cachedCount} Files`. Below: "Flush Local Image Cache" button (`w-full py-2 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-2`) with `<Trash2 class="w-3.5 h-3.5 text-rose-600" />`.

### Footer
"Close" (slate) and "Save Settings" (`bg-slate-900 hover:bg-slate-800 text-white`) with `<Save class="w-4 h-4" />`.

## Component: UndoToast

Container: `fixed bottom-[92px] left-3 sm:bottom-[115px] sm:left-6 z-40 flex flex-col items-start gap-1.5 pointer-events-none`.

Up to 3 toasts. Each is a `<button>` (`pointer-events-auto px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 text-white text-xs font-semibold rounded-full shadow-lg border border-slate-700/80 flex items-center gap-1.5 transition-all duration-200 active:scale-95 disabled:opacity-50`):
- Icon: `<RotateCcw class="w-3.5 h-3.5 text-amber-400 {isUndoLoading ? 'animate-spin' : ''}" />`
- Text: "Undo"
- Inline `style={{ opacity }}` — fades out in the last 40% of the 5-second window.

A `setInterval` every 100ms ticks a re-render and dismisses any toast older than 5000ms via `onDismiss(id)`.

## Component: AuthScreen

(Described above as Screen 2.)

## Responsive breakpoints

- **Mobile (default):** ≤ 640px. Buttons collapse to icon-only where the spec says "hidden on mobile" / `hidden sm:inline`. Header is compact (`min-h-[3.25rem]`). Undo toast sits at `bottom-[92px] left-3`.
- **`sm` (≥ 640px):** button labels appear, header height becomes `h-14`, undo toast at `sm:bottom-[115px] sm:left-6`.
- **`md` (≥ 768px):** "Dashboard" label appears in header.
- **`lg` (≥ 1024px):** "Data Saver" label appears; skip button shows its `→` kbd.

## Touch interactions (mobile)

- **Pinch zoom:** two-finger pinch adjusts scale (clamped 1–8), relative to start distance.
- **Single-finger drag:** when `scale > 1`, pan the image. Otherwise no-op (let the page scroll if needed, though the main view doesn't scroll).
- **Double tap:** toggles scale between 1 and 2.5.
- **`touch-action: none`** on the viewport container prevents browser gestures from interfering.

## Keyboard interactions (desktop)

- Global (no modal open, focus not in input/textarea/select/contenteditable):
  - `Enter` / `O` → Pass
  - `E` / `F` / `Delete` → Open Flag modal
  - `S` / `→` / `↓` / `←` / `↑` / `Space` → Skip
  - `Z` / `Ctrl+Z` / `Cmd+Z` / `U` → Undo (if undo stack non-empty)
- Inside `ErrorModal`: `Escape` closes.
- Inside other modals: clicking the backdrop or the `X` button closes. (No special key handling needed; default focus behavior is fine.)

## Accessibility

- All interactive controls are real `<button>` or `<a>` elements with `type="button"` where appropriate.
- Every header button has a `title` attribute describing its action.
- Image has `alt={\`Panoramax ${pictureId}\`}`.
- Modal close buttons have `title="Close"` (or equivalent via the `X` icon's container).
- Color is never the sole indicator — status pills always include an icon and text.
- The flag reason grid uses `aria-pressed` semantics via the button's `type="button"` + visual `ring-1 ring-rose-500` indicator (or use `aria-pressed={isSelected}` if you want explicit).
- The viewport's gesture hint is `pointer-events-none` so it doesn't intercept taps.

## Favicon

`public/favicon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="128" fill="#0f172a"/>
  <circle cx="256" cy="256" r="160" fill="none" stroke="#38bdf8" stroke-width="24" stroke-dasharray="12 12"/>
  <path d="M160 320 L220 230 L270 280 L330 200 L380 320 Z" fill="#38bdf8" opacity="0.9"/>
  <circle cx="210" cy="190" r="28" fill="#f59e0b"/>
  <circle cx="256" cy="256" r="40" fill="#0f172a" stroke="#38bdf8" stroke-width="12"/>
</svg>
```

Theme color (used in `manifest.json` and `<meta name="theme-color">`): `#0f172a`.
