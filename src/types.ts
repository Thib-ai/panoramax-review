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
  { id: 'blur', label: 'Blurry / Out of Focus', description: 'Motion blur, bad focus, or smudged lens', iconName: 'Aperture' },
  { id: 'lighting', label: 'Dark / Overexposed', description: 'Too dark, glare, or extreme lens flare', iconName: 'SunDim' },
  { id: 'obstruction', label: 'Obstructed / Dark Lens', description: 'Hand, car frame, drop, or dirt blocking camera', iconName: 'ShieldAlert' },
  { id: 'orientation', label: 'Sideways / Upside Down', description: 'Incorrect camera angle or pitch', iconName: 'RotateCcw' },
  { id: 'location', label: 'Incorrect Location / GPS', description: 'Bad positioning or teleported GPS point', iconName: 'MapPinOff' },
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
}

export interface DashboardFilterParams {
  status?: string;
  search?: string;
  instance?: string;
  reason?: string;
  checkedOff?: string;
  page?: number;
  pageSize?: number;
}
