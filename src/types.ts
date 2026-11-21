import type { Timestamp } from 'firebase/firestore';

export type LocationCategory = 'office' | 'agency' | 'client' | 'site' | 'personal';
export type WorkItemType = 'task' | 'project' | 'invitation';
export type WorkPriority = 'low' | 'medium' | 'high' | 'urgent';
export type WorkStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type ContactGroup = 'client' | 'family' | 'partner' | 'colleague' | 'other';
export type PaperSizeOption = 'A4_portrait' | 'A4_landscape' | 'A3_portrait' | 'A3_landscape' | 'A5_portrait';

export type UserRole = 'admin' | 'manager' | 'staff' | 'viewer';
export type UserStatus = 'active' | 'suspended';

export type TravelTripStatus = 'planned' | 'ongoing' | 'completed' | 'cancelled';
export type TravelTransportMode =
  | 'car'
  | 'flight'
  | 'train'
  | 'bus'
  | 'motorbike'
  | 'boat'
  | 'walk'
  | 'other';

export type AppTab =
  | 'dashboard'
  | 'work'
  | 'travel'
  | 'locations'
  | 'contacts'
  | 'reports'
  | 'print'
  | 'users'
  | 'security';

export interface UserPermissions {
  canManageWork: boolean;
  canManageLocations: boolean;
  canViewContacts: boolean;
  canManageContacts: boolean;
  canUseAI: boolean;
  canPrintReports: boolean;
}

export interface AppUserRecord extends UserPermissions {
  id: string; // normalized lowercase email
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  department: string;
  notes: string;
  uid: string;
  lastLoginIso: string;
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface EffectiveUserAccess {
  authorized: boolean;
  denialReason: 'none' | 'not_registered' | 'suspended' | 'unverified';
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isManagerOrAdmin: boolean;
  role: UserRole;
  permissions: UserPermissions;
  profile: AppUserRecord | null;
}

export interface LocationRecord {
  id: string;
  ownerId: string;
  code: string;
  name: string;
  address: string;
  category: LocationCategory;
  notes: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface WorkItemRecord {
  id: string;
  ownerId: string;
  itemType: WorkItemType;
  code: string;
  title: string;
  projectCode: string;
  projectName: string;
  locationId: string;
  contactId: string;
  scheduledDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  priority: WorkPriority;
  status: WorkStatus;
  reminderMinutes: number;
  reminderDismissed: boolean;
  notes: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface ContactRecord {
  id: string;
  ownerId: string;
  code: string;
  fullName: string;
  group: ContactGroup;
  relationship: string;
  organization: string;
  phone: string;
  email: string;
  locationId: string;
  address: string;
  notes: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface UserSettingsRecord {
  id: string;
  ownerId: string;
  ownerTitle: string;
  organizationHeader: string;
  defaultPaperSize: PaperSizeOption;
  privacyMaskEnabled: boolean;
  soundAlertEnabled: boolean;
  pinHash: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface TravelTripRecord {
  id: string;
  ownerId: string;
  code: string;
  title: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: TravelTripStatus;
  transportSummary: string;
  travelers: string;
  budgetNote: string;
  notes: string;
  stopCount: number;
  routePreview: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface TravelStopRecord {
  id: string;
  ownerId: string;
  tripId: string;
  orderIndex: number; // 1-based sequence: 1 (A), 2 (B), ..., N
  locationId: string;
  locationCode: string;
  stopDate: string; // YYYY-MM-DD
  arrivalTime: string; // HH:mm
  activityDurationMinutes: number;
  departureTime: string; // HH:mm
  transportMode: TravelTransportMode;
  activityTitle: string;
  notes: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface AIExtractedLocation {
  tempKey: string;
  code: string;
  name: string;
  address: string;
  category: LocationCategory;
  notes: string;
}

export interface AIExtractedContact {
  tempKey: string;
  code: string;
  fullName: string;
  group: ContactGroup;
  relationship: string;
  organization: string;
  phone: string;
  email: string;
  notes: string;
}

export interface AIExtractedWorkItem {
  itemType: WorkItemType;
  code: string;
  title: string;
  projectCode: string;
  projectName: string;
  matchedLocationId: string;
  locationTempKey: string;
  matchedContactId: string;
  contactTempKey: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  priority: WorkPriority;
  reminderMinutes: number;
  notes: string;
}

export interface AIExtractedPayload {
  summary: string;
  suggestedLocations: AIExtractedLocation[];
  suggestedContacts: AIExtractedContact[];
  workItems: AIExtractedWorkItem[];
}

// Validation constants synchronized verbatim with firebase-blueprint.json & firestore.rules
export const SCHEMA_LIMITS = {
  idRegex: /^[a-zA-Z0-9_\-]+$/,
  emailRegex: /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/,
  codeRegex: /^[A-Za-z0-9_\-/.]+$/,
  dateRegex: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  timeRegex: /^[0-2][0-9]:[0-5][0-9]$/,
  location: {
    codeMax: 32,
    nameMax: 160,
    addressMax: 300,
    notesMax: 500,
  },
  workItem: {
    codeMax: 48,
    titleMax: 220,
    projectCodeMax: 48,
    projectNameMax: 160,
    notesMax: 1500,
    reminderMax: 10080,
  },
  contact: {
    codeMax: 32,
    fullNameMax: 120,
    relationshipMax: 120,
    organizationMax: 160,
    phoneMax: 32,
    emailMax: 160,
    addressMax: 300,
    notesMax: 1000,
  },
  settings: {
    ownerTitleMax: 120,
    organizationHeaderMax: 180,
    pinHashMax: 128,
  },
  appUser: {
    emailMax: 160,
    displayNameMax: 120,
    departmentMax: 120,
    notesMax: 500,
    lastLoginIsoMax: 40,
  },
  travelTrip: {
    codeMax: 48,
    titleMax: 200,
    transportSummaryMax: 160,
    travelersMax: 200,
    budgetNoteMax: 200,
    notesMax: 1500,
    routePreviewMax: 300,
    maxStops: 200,
  },
  travelStop: {
    locationCodeMax: 32,
    activityTitleMax: 200,
    notesMax: 1000,
    maxDurationMinutes: 10080,
    maxOrderIndex: 200,
  },
} as const;

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Quản trị viên',
  manager: 'Quản lý',
  staff: 'Nhân viên',
  viewer: 'Chỉ xem',
};

export const USER_ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: 'Toàn quyền hệ thống, bao gồm thêm/sửa/xóa và phân quyền người dùng.',
  manager: 'Quản lý toàn bộ công việc, địa điểm, danh bạ, báo cáo, in ấn và AI.',
  staff: 'Tạo và cập nhật công việc/lịch trình được phân công, dùng AI và in lịch.',
  viewer: 'Chỉ xem tổng quan, lịch trình, địa điểm và báo cáo; không chỉnh sửa dữ liệu.',
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  active: 'Đang hoạt động',
  suspended: 'Tạm khóa',
};

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, UserPermissions> = {
  admin: {
    canManageWork: true,
    canManageLocations: true,
    canViewContacts: true,
    canManageContacts: true,
    canUseAI: true,
    canPrintReports: true,
  },
  manager: {
    canManageWork: true,
    canManageLocations: true,
    canViewContacts: true,
    canManageContacts: true,
    canUseAI: true,
    canPrintReports: true,
  },
  staff: {
    canManageWork: true,
    canManageLocations: false,
    canViewContacts: false,
    canManageContacts: false,
    canUseAI: true,
    canPrintReports: true,
  },
  viewer: {
    canManageWork: false,
    canManageLocations: false,
    canViewContacts: false,
    canManageContacts: false,
    canUseAI: false,
    canPrintReports: true,
  },
};

export function normalizeEmailKey(email: string): string {
  return (email || '').trim().toLowerCase().slice(0, SCHEMA_LIMITS.appUser.emailMax);
}

export function isValidEmailAddress(email: string): boolean {
  const norm = normalizeEmailKey(email);
  return norm.length >= 5 && norm.length <= SCHEMA_LIMITS.appUser.emailMax && SCHEMA_LIMITS.emailRegex.test(norm);
}

export const LOCATION_CATEGORY_LABELS: Record<LocationCategory, string> = {
  office: 'Văn phòng',
  agency: 'Cơ quan / Hành chính',
  client: 'Khách hàng / Đối tác',
  site: 'Công trường / Thực địa',
  personal: 'Cá nhân / Gia đình',
};

export const WORK_TYPE_LABELS: Record<WorkItemType, string> = {
  task: 'Công việc',
  project: 'Dự án',
  invitation: 'Giấy mời',
};

export const PRIORITY_LABELS: Record<WorkPriority, string> = {
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  urgent: 'Khẩn cấp',
};

export const STATUS_LABELS: Record<WorkStatus, string> = {
  pending: 'Chờ thực hiện',
  in_progress: 'Đang thực hiện',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
};

export const CONTACT_GROUP_LABELS: Record<ContactGroup, string> = {
  client: 'Khách hàng',
  family: 'Người thân',
  partner: 'Đối tác',
  colleague: 'Đồng nghiệp',
  other: 'Quan hệ khác',
};

export const TRAVEL_TRIP_STATUS_LABELS: Record<TravelTripStatus, string> = {
  planned: 'Lên kế hoạch',
  ongoing: 'Đang thực hiện',
  completed: 'Đã hoàn thành',
  cancelled: 'Đã hủy',
};

export const TRAVEL_TRANSPORT_LABELS: Record<TravelTransportMode, string> = {
  car: 'Ô tô',
  flight: 'Máy bay',
  train: 'Tàu hỏa',
  bus: 'Xe khách',
  motorbike: 'Xe máy',
  boat: 'Tàu / Thuyền',
  walk: 'Đi bộ',
  other: 'Phương tiện khác',
};

export const PAPER_SIZE_META: Record<
  PaperSizeOption,
  { label: string; cssSize: string; widthMm: number; heightMm: number; shortLabel: string }
> = {
  A4_portrait: {
    label: 'A4 Dọc (210 × 297 mm)',
    shortLabel: 'A4 Dọc',
    cssSize: 'A4 portrait',
    widthMm: 210,
    heightMm: 297,
  },
  A4_landscape: {
    label: 'A4 Ngang (297 × 210 mm)',
    shortLabel: 'A4 Ngang',
    cssSize: 'A4 landscape',
    widthMm: 297,
    heightMm: 210,
  },
  A3_portrait: {
    label: 'A3 Dọc (297 × 420 mm)',
    shortLabel: 'A3 Dọc',
    cssSize: 'A3 portrait',
    widthMm: 297,
    heightMm: 420,
  },
  A3_landscape: {
    label: 'A3 Ngang (420 × 297 mm)',
    shortLabel: 'A3 Ngang',
    cssSize: 'A3 landscape',
    widthMm: 420,
    heightMm: 297,
  },
  A5_portrait: {
    label: 'A5 Dọc (148 × 210 mm)',
    shortLabel: 'A5 Dọc',
    cssSize: 'A5 portrait',
    widthMm: 148,
    heightMm: 210,
  },
};

export function sanitizeCode(raw: string, fallbackPrefix: string, maxLen: number): string {
  const cleaned = (raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9_\-/.]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase()
    .slice(0, maxLen);

  if (cleaned.length >= 1 && SCHEMA_LIMITS.codeRegex.test(cleaned)) {
    return cleaned;
  }
  const suffix = String(Date.now()).slice(-4);
  return `${fallbackPrefix}-${suffix}`.slice(0, maxLen);
}

export function clampStr(val: string | undefined | null, maxLen: number): string {
  return (val ?? '').trim().slice(0, maxLen);
}

export function sanitizeDate(raw: string | undefined, fallback: string): string {
  const s = (raw ?? '').trim();
  return SCHEMA_LIMITS.dateRegex.test(s) ? s : fallback;
}

export function sanitizeTime(raw: string | undefined, fallback: string): string {
  const s = (raw ?? '').trim();
  if (SCHEMA_LIMITS.timeRegex.test(s)) {
    const [h] = s.split(':').map(Number);
    if (h >= 0 && h <= 23) return s;
  }
  return fallback;
}

export function getLocalTodayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function maskSensitivePhone(phone: string, enabled: boolean): string {
  if (!enabled || !phone) return phone;
  if (phone.length <= 5) return '•••••';
  return `${phone.slice(0, 3)}••••${phone.slice(-3)}`;
}

export function maskSensitiveEmail(email: string, enabled: boolean): string {
  if (!enabled || !email) return email;
  const [user, domain] = email.split('@');
  if (!domain) return '••••••';
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}•••@${domain}`;
}

export function maskSensitiveAddress(address: string, enabled: boolean): string {
  if (!enabled || !address) return address;
  return address.length > 14 ? `${address.slice(0, 12)} ••••••` : '••••••••••';
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Travel timeline math helpers
export function parseTimeToMinutes(hhmm: string): number {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function minutesToTimeHHMM(totalMinutes: number): string {
  const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function addMinutesToDateAndTime(
  dateIso: string,
  hhmm: string,
  addMinutes: number
): { date: string; time: string } {
  const base = new Date(`${dateIso}T${sanitizeTime(hhmm, '08:00')}:00`);
  if (Number.isNaN(base.getTime())) {
    return { date: dateIso, time: minutesToTimeHHMM(parseTimeToMinutes(hhmm) + addMinutes) };
  }
  base.setMinutes(base.getMinutes() + Math.round(addMinutes));
  const y = base.getFullYear();
  const mo = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  const h = String(base.getHours()).padStart(2, '0');
  const mi = String(base.getMinutes()).padStart(2, '0');
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

export function diffDateTimeMinutes(
  fromDate: string,
  fromTime: string,
  toDate: string,
  toTime: string
): number {
  const start = new Date(`${fromDate}T${sanitizeTime(fromTime, '00:00')}:00`);
  const end = new Date(`${toDate}T${sanitizeTime(toTime, '00:00')}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

export function formatDurationVi(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  if (abs === 0) return '0 phút';
  const days = Math.floor(abs / 1440);
  const remAfterDays = abs % 1440;
  const hours = Math.floor(remAfterDays / 60);
  const mins = remAfterDays % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ngày`);
  if (hours > 0) parts.push(`${hours} giờ`);
  if (mins > 0) parts.push(`${mins} phút`);
  return (minutes < 0 ? '-' : '') + parts.join(' ');
}

export function getStopPointLabel(indexZeroBased: number): string {
  if (indexZeroBased >= 0 && indexZeroBased < 26) {
    return String.fromCharCode(65 + indexZeroBased);
  }
  return `P${indexZeroBased + 1}`;
}

export function getStopDepartureDateTime(stop: {
  stopDate: string;
  arrivalTime: string;
  activityDurationMinutes: number;
  departureTime: string;
}): { date: string; time: string; dayOffset: number } {
  const arrMins = parseTimeToMinutes(stop.arrivalTime);
  const depMins = parseTimeToMinutes(stop.departureTime);
  const dur = Math.max(0, Math.round(stop.activityDurationMinutes || 0));
  let dayOffset = Math.floor((arrMins + dur) / 1440);
  if (dayOffset === 0 && depMins < arrMins) {
    dayOffset = 1;
  }
  const base = new Date(`${stop.stopDate}T00:00:00`);
  if (!Number.isNaN(base.getTime()) && dayOffset > 0) {
    base.setDate(base.getDate() + dayOffset);
    const y = base.getFullYear();
    const m = String(base.getMonth() + 1).padStart(2, '0');
    const d = String(base.getDate()).padStart(2, '0');
    return { date: `${y}-${m}-${d}`, time: stop.departureTime, dayOffset };
  }
  return { date: stop.stopDate, time: stop.departureTime, dayOffset: 0 };
}
