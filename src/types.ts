export type ReviewStatus = 'ok' | 'error';
export type PictureStatus = 'pending' | 'reviewed_ok' | 'flagged' | 'resolved';

export interface User {
  id: string;
  username: string;
  role: 'reviewer' | 'admin';
  createdAt: string;
}

export interface PictureItem {
  id: string;
  pictureId: string;
  instanceUrl: string;
  sdUrl: string;
  hdUrl?: string;
  thumbUrl?: string;
  locationName?: string;
  lat?: number;
  lon?: number;
  dateCaptured?: string;
  status: PictureStatus;
  isCheckedOff?: boolean;
  addedAt: string;
  reviewCount: number;
  lastReviewedAt?: string;
  lastErrorReason?: string;
  lastComment?: string;
  lastReviewer?: string;
}

export interface ReviewRecord {
  id: string;
  pictureId: string;
  userId: string;
  userName: string;
  status: ReviewStatus;
  errorReason?: string;
  comment?: string;
  reviewedAt: string;
  sdUrl?: string;
  instanceUrl?: string;
}

export interface AppStats {
  totalPictures: number;
  reviewedOk: number;
  flaggedErrors: number;
  checkedOffCount: number;
  pendingQueue: number;
  totalReviews: number;
  userReviewCount: number;
}

export interface AppSettings {
  cacheSize: number;
  instances: string[];
  activeInstance: string;
  autoFetchApi: boolean;
  cellularSaverMode?: boolean;
}

export interface ImportResult {
  added: number;
  duplicatesSkipped: number;
  totalInDatabase: number;
  addedIds: string[];
}

export interface ErrorReasonOption {
  id: string;
  label: string;
  description: string;
  iconName: string;
}

export const COMMON_ERROR_REASONS: ErrorReasonOption[] = [
  { id: 'privacy', label: 'Privacy Violation', description: 'Unblurred face or license plate visible', iconName: 'EyeOff' },
  { id: 'bad_quality', label: 'Bad Quality', description: 'Blur, darkness, glare, obstruction, or other image quality issue', iconName: 'Aperture' },
  { id: 'orientation', label: 'Sideways / Upside Down', description: 'Incorrect camera angle or pitch', iconName: 'RotateCcw' },
  { id: 'copyright', label: 'Copyright Issue', description: 'Copyrighted content or trademark visible', iconName: 'ShieldAlert' },
  { id: 'other', label: 'Other Issue', description: 'Custom problem described in notes', iconName: 'HelpCircle' },
];

export interface OfflineReview {
  id: string;
  pictureId: string;
  status: ReviewStatus;
  errorReason?: string;
  comment?: string;
  createdAt: string;
}

export interface UndoItem {
  id: string;
  reviewId: string;
  pictureId: string;
  label: string;
  createdAt: number;
  picture: PictureItem;
}

/**
 * Single-entry "previous image" undo state. `previousPicture` is the picture
 * that was current before the most recent review (i.e. the one a single undo
 * restores). `previousUndo` carries the snapshot to chain undos back through
 * the session history; it is null when there is nothing further to undo
 * (i.e. we've walked back to the session's first picture).
 */
export interface UndoState {
  picture: PictureItem;
  reviewId: string;
  label: string;
  createdAt: number;
  previousUndo: UndoState | null;
}

export interface DashboardFilterParams {
  status?: string;
  search?: string;
  instance?: string;
  reason?: string;
  checkedOff?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  sortDir?: 'asc' | 'desc';
}
