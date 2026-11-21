import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, OWNER_EMAIL } from '../firebase';
import {
  clampStr,
  DEFAULT_ROLE_PERMISSIONS,
  getLocalTodayISO,
  isValidEmailAddress,
  normalizeEmailKey,
  sanitizeCode,
  sanitizeDate,
  sanitizeTime,
  SCHEMA_LIMITS,
  type AppUserRecord,
  type ContactGroup,
  type ContactRecord,
  type LocationCategory,
  type LocationRecord,
  type PaperSizeOption,
  type TravelStopRecord,
  type TravelTransportMode,
  type TravelTripRecord,
  type TravelTripStatus,
  type UserPermissions,
  type UserRole,
  type UserSettingsRecord,
  type UserStatus,
  type WorkItemRecord,
  type WorkItemType,
  type WorkPriority,
  type WorkStatus,
} from '../types';

export function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '');
}

const VALID_LOC_CATS: LocationCategory[] = ['office', 'agency', 'client', 'site', 'personal'];
const VALID_WORK_TYPES: WorkItemType[] = ['task', 'project', 'invitation'];
const VALID_PRIORITIES: WorkPriority[] = ['low', 'medium', 'high', 'urgent'];
const VALID_STATUSES: WorkStatus[] = ['pending', 'in_progress', 'completed', 'cancelled'];
const VALID_CONTACT_GROUPS: ContactGroup[] = ['client', 'family', 'partner', 'colleague', 'other'];
const VALID_PAPER_SIZES: PaperSizeOption[] = [
  'A4_portrait',
  'A4_landscape',
  'A3_portrait',
  'A3_landscape',
  'A5_portrait',
];

function validEnum<T extends string>(val: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(val as T) ? (val as T) : fallback;
}

const VALID_USER_ROLES: UserRole[] = ['admin', 'manager', 'staff', 'viewer'];
const VALID_USER_STATUSES: UserStatus[] = ['active', 'suspended'];
const VALID_TRIP_STATUSES: TravelTripStatus[] = ['planned', 'ongoing', 'completed', 'cancelled'];
const VALID_TRANSPORT_MODES: TravelTransportMode[] = [
  'car',
  'flight',
  'train',
  'bus',
  'motorbike',
  'boat',
  'walk',
  'other',
];

export interface SyncMeta {
  fromCache: boolean;
  hasPendingWrites: boolean;
  lastSyncedAt: number;
}

// --- Real-Time Subscriptions ---

export function subscribeLocations(
  onData: (items: LocationRecord[], meta: SyncMeta) => void
): Unsubscribe {
  const path = 'locations';
  const q = query(collection(db, path));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      const items: LocationRecord[] = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<LocationRecord, 'id'>),
        }))
        .sort((a, b) => a.code.localeCompare(b.code, 'vi'));
      onData(items, {
        fromCache: snap.metadata.fromCache,
        hasPendingWrites: snap.metadata.hasPendingWrites,
        lastSyncedAt: Date.now(),
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeWorkItems(
  onData: (items: WorkItemRecord[], meta: SyncMeta) => void
): Unsubscribe {
  const path = 'workItems';
  const q = query(collection(db, path));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      const items: WorkItemRecord[] = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<WorkItemRecord, 'id'>),
        }))
        .sort((a, b) => {
          const dateCmp = a.scheduledDate.localeCompare(b.scheduledDate);
          if (dateCmp !== 0) return dateCmp;
          return a.startTime.localeCompare(b.startTime);
        });
      onData(items, {
        fromCache: snap.metadata.fromCache,
        hasPendingWrites: snap.metadata.hasPendingWrites,
        lastSyncedAt: Date.now(),
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeContacts(
  onData: (items: ContactRecord[], meta: SyncMeta) => void
): Unsubscribe {
  const path = 'contacts';
  const q = query(collection(db, path));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      const items: ContactRecord[] = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ContactRecord, 'id'>),
        }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'));
      onData(items, {
        fromCache: snap.metadata.fromCache,
        hasPendingWrites: snap.metadata.hasPendingWrites,
        lastSyncedAt: Date.now(),
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeMyAppUser(
  email: string,
  onData: (record: AppUserRecord | null, loaded: boolean) => void
): Unsubscribe {
  const emailKey = normalizeEmailKey(email);
  if (!isValidEmailAddress(emailKey)) {
    onData(null, true);
    return () => {};
  }
  const path = `appUsers/${emailKey}`;
  const ref = doc(db, 'appUsers', emailKey);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null, true);
      } else {
        onData(
          {
            id: snap.id,
            ...(snap.data() as Omit<AppUserRecord, 'id'>),
          },
          true
        );
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export function subscribeAllAppUsers(
  onData: (items: AppUserRecord[]) => void
): Unsubscribe {
  const path = 'appUsers';
  const q = query(collection(db, path));
  return onSnapshot(
    q,
    (snap) => {
      const roleRank: Record<UserRole, number> = {
        admin: 0,
        manager: 1,
        staff: 2,
        viewer: 3,
      };
      const items: AppUserRecord[] = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<AppUserRecord, 'id'>),
        }))
        .sort((a, b) => {
          if (a.email === OWNER_EMAIL) return -1;
          if (b.email === OWNER_EMAIL) return 1;
          const rDiff = roleRank[a.role] - roleRank[b.role];
          if (rDiff !== 0) return rDiff;
          return a.displayName.localeCompare(b.displayName, 'vi');
        });
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeUserSettings(
  ownerId: string,
  onData: (settings: UserSettingsRecord | null) => void
): Unsubscribe {
  const path = `userSettings/${ownerId}`;
  const ref = doc(db, 'userSettings', ownerId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
      } else {
        onData({
          id: snap.id,
          ...(snap.data() as Omit<UserSettingsRecord, 'id'>),
        });
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

// --- Locations CRUD ---

export interface LocationInput {
  code: string;
  name: string;
  address: string;
  category: LocationCategory;
  notes: string;
}

export async function createLocation(ownerId: string, input: LocationInput): Promise<string> {
  const id = makeSafeId('loc');
  const path = `locations/${id}`;
  const payload = {
    ownerId,
    code: sanitizeCode(input.code, 'DD', SCHEMA_LIMITS.location.codeMax),
    name: clampStr(input.name, SCHEMA_LIMITS.location.nameMax) || 'Địa điểm mới',
    address: clampStr(input.address, SCHEMA_LIMITS.location.addressMax) || 'Chưa cập nhật địa chỉ',
    category: validEnum(input.category, VALID_LOC_CATS, 'office'),
    notes: clampStr(input.notes, SCHEMA_LIMITS.location.notesMax),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, 'locations', id), payload);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateLocation(id: string, input: LocationInput): Promise<void> {
  const path = `locations/${id}`;
  const payload = {
    code: sanitizeCode(input.code, 'DD', SCHEMA_LIMITS.location.codeMax),
    name: clampStr(input.name, SCHEMA_LIMITS.location.nameMax) || 'Địa điểm mới',
    address: clampStr(input.address, SCHEMA_LIMITS.location.addressMax) || 'Chưa cập nhật địa chỉ',
    category: validEnum(input.category, VALID_LOC_CATS, 'office'),
    notes: clampStr(input.notes, SCHEMA_LIMITS.location.notesMax),
    updatedAt: serverTimestamp(),
  };
  try {
    await updateDoc(doc(db, 'locations', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteLocation(id: string): Promise<void> {
  const path = `locations/${id}`;
  try {
    await deleteDoc(doc(db, 'locations', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- WorkItems CRUD ---

export interface WorkItemInput {
  itemType: WorkItemType;
  code: string;
  title: string;
  projectCode: string;
  projectName: string;
  locationId: string;
  contactId: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  priority: WorkPriority;
  status: WorkStatus;
  reminderMinutes: number;
  reminderDismissed?: boolean;
  notes: string;
}

export async function createWorkItem(ownerId: string, input: WorkItemInput): Promise<string> {
  const id = makeSafeId('wi');
  const path = `workItems/${id}`;
  const itemType = validEnum(input.itemType, VALID_WORK_TYPES, 'task');
  const prefix = itemType === 'project' ? 'DA' : itemType === 'invitation' ? 'GM' : 'CV';
  const reminderVal = Math.max(
    0,
    Math.min(SCHEMA_LIMITS.workItem.reminderMax, Math.round(Number(input.reminderMinutes) || 0))
  );
  const today = getLocalTodayISO();

  const payload = {
    ownerId,
    itemType,
    code: sanitizeCode(input.code, prefix, SCHEMA_LIMITS.workItem.codeMax),
    title: clampStr(input.title, SCHEMA_LIMITS.workItem.titleMax) || 'Công việc mới',
    projectCode: clampStr(input.projectCode, SCHEMA_LIMITS.workItem.projectCodeMax),
    projectName: clampStr(input.projectName, SCHEMA_LIMITS.workItem.projectNameMax),
    locationId: clampStr(input.locationId, 128),
    contactId: clampStr(input.contactId, 128),
    scheduledDate: sanitizeDate(input.scheduledDate, today),
    startTime: sanitizeTime(input.startTime, '08:30'),
    endTime: sanitizeTime(input.endTime, '09:30'),
    priority: validEnum(input.priority, VALID_PRIORITIES, 'medium'),
    status: validEnum(input.status, VALID_STATUSES, 'pending'),
    reminderMinutes: reminderVal,
    reminderDismissed: Boolean(input.reminderDismissed ?? false),
    notes: clampStr(input.notes, SCHEMA_LIMITS.workItem.notesMax),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'workItems', id), payload);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateWorkItem(id: string, input: WorkItemInput): Promise<void> {
  const path = `workItems/${id}`;
  const itemType = validEnum(input.itemType, VALID_WORK_TYPES, 'task');
  const prefix = itemType === 'project' ? 'DA' : itemType === 'invitation' ? 'GM' : 'CV';
  const reminderVal = Math.max(
    0,
    Math.min(SCHEMA_LIMITS.workItem.reminderMax, Math.round(Number(input.reminderMinutes) || 0))
  );
  const today = getLocalTodayISO();

  const payload = {
    itemType,
    code: sanitizeCode(input.code, prefix, SCHEMA_LIMITS.workItem.codeMax),
    title: clampStr(input.title, SCHEMA_LIMITS.workItem.titleMax) || 'Công việc',
    projectCode: clampStr(input.projectCode, SCHEMA_LIMITS.workItem.projectCodeMax),
    projectName: clampStr(input.projectName, SCHEMA_LIMITS.workItem.projectNameMax),
    locationId: clampStr(input.locationId, 128),
    contactId: clampStr(input.contactId, 128),
    scheduledDate: sanitizeDate(input.scheduledDate, today),
    startTime: sanitizeTime(input.startTime, '08:30'),
    endTime: sanitizeTime(input.endTime, '09:30'),
    priority: validEnum(input.priority, VALID_PRIORITIES, 'medium'),
    status: validEnum(input.status, VALID_STATUSES, 'pending'),
    reminderMinutes: reminderVal,
    reminderDismissed: Boolean(input.reminderDismissed ?? false),
    notes: clampStr(input.notes, SCHEMA_LIMITS.workItem.notesMax),
    updatedAt: serverTimestamp(),
  };

  try {
    await updateDoc(doc(db, 'workItems', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function quickUpdateWorkItemStatus(
  id: string,
  status: WorkStatus,
  reminderDismissed?: boolean
): Promise<void> {
  const path = `workItems/${id}`;
  const payload: Record<string, unknown> = {
    status: validEnum(status, VALID_STATUSES, 'pending'),
    updatedAt: serverTimestamp(),
  };
  if (typeof reminderDismissed === 'boolean') {
    payload.reminderDismissed = reminderDismissed;
  }
  try {
    await updateDoc(doc(db, 'workItems', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function dismissWorkItemReminder(id: string): Promise<void> {
  const path = `workItems/${id}`;
  try {
    await updateDoc(doc(db, 'workItems', id), {
      reminderDismissed: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteWorkItem(id: string): Promise<void> {
  const path = `workItems/${id}`;
  try {
    await deleteDoc(doc(db, 'workItems', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Contacts CRUD ---

export interface ContactInput {
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
}

export async function createContact(ownerId: string, input: ContactInput): Promise<string> {
  const id = makeSafeId('ct');
  const path = `contacts/${id}`;
  const payload = {
    ownerId,
    code: sanitizeCode(input.code, 'LH', SCHEMA_LIMITS.contact.codeMax),
    fullName: clampStr(input.fullName, SCHEMA_LIMITS.contact.fullNameMax) || 'Liên hệ mới',
    group: validEnum(input.group, VALID_CONTACT_GROUPS, 'client'),
    relationship: clampStr(input.relationship, SCHEMA_LIMITS.contact.relationshipMax),
    organization: clampStr(input.organization, SCHEMA_LIMITS.contact.organizationMax),
    phone: clampStr(input.phone, SCHEMA_LIMITS.contact.phoneMax),
    email: clampStr(input.email, SCHEMA_LIMITS.contact.emailMax),
    locationId: clampStr(input.locationId, 128),
    address: clampStr(input.address, SCHEMA_LIMITS.contact.addressMax),
    notes: clampStr(input.notes, SCHEMA_LIMITS.contact.notesMax),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'contacts', id), payload);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateContact(id: string, input: ContactInput): Promise<void> {
  const path = `contacts/${id}`;
  const payload = {
    code: sanitizeCode(input.code, 'LH', SCHEMA_LIMITS.contact.codeMax),
    fullName: clampStr(input.fullName, SCHEMA_LIMITS.contact.fullNameMax) || 'Liên hệ',
    group: validEnum(input.group, VALID_CONTACT_GROUPS, 'client'),
    relationship: clampStr(input.relationship, SCHEMA_LIMITS.contact.relationshipMax),
    organization: clampStr(input.organization, SCHEMA_LIMITS.contact.organizationMax),
    phone: clampStr(input.phone, SCHEMA_LIMITS.contact.phoneMax),
    email: clampStr(input.email, SCHEMA_LIMITS.contact.emailMax),
    locationId: clampStr(input.locationId, 128),
    address: clampStr(input.address, SCHEMA_LIMITS.contact.addressMax),
    notes: clampStr(input.notes, SCHEMA_LIMITS.contact.notesMax),
    updatedAt: serverTimestamp(),
  };

  try {
    await updateDoc(doc(db, 'contacts', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteContact(id: string): Promise<void> {
  const path = `contacts/${id}`;
  try {
    await deleteDoc(doc(db, 'contacts', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- User Settings ---

export async function ensureUserSettings(ownerId: string, displayName: string): Promise<void> {
  const path = `userSettings/${ownerId}`;
  const ref = doc(db, 'userSettings', ownerId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId,
        ownerTitle: clampStr(displayName || 'Chủ sở hữu cá nhân', SCHEMA_LIMITS.settings.ownerTitleMax),
        organizationHeader: 'SỔ TAY CÔNG TÁC & LỊCH TRÌNH CÁ NHÂN',
        defaultPaperSize: 'A4_portrait',
        privacyMaskEnabled: false,
        soundAlertEnabled: true,
        pinHash: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export interface UserSettingsPatch {
  ownerTitle?: string;
  organizationHeader?: string;
  defaultPaperSize?: PaperSizeOption;
  privacyMaskEnabled?: boolean;
  soundAlertEnabled?: boolean;
  pinHash?: string;
}

export async function updateUserSettings(ownerId: string, patch: UserSettingsPatch): Promise<void> {
  const path = `userSettings/${ownerId}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.ownerTitle !== undefined) {
    payload.ownerTitle = clampStr(patch.ownerTitle, SCHEMA_LIMITS.settings.ownerTitleMax);
  }
  if (patch.organizationHeader !== undefined) {
    payload.organizationHeader = clampStr(
      patch.organizationHeader,
      SCHEMA_LIMITS.settings.organizationHeaderMax
    );
  }
  if (patch.defaultPaperSize !== undefined) {
    payload.defaultPaperSize = validEnum(patch.defaultPaperSize, VALID_PAPER_SIZES, 'A4_portrait');
  }
  if (patch.privacyMaskEnabled !== undefined) {
    payload.privacyMaskEnabled = Boolean(patch.privacyMaskEnabled);
  }
  if (patch.soundAlertEnabled !== undefined) {
    payload.soundAlertEnabled = Boolean(patch.soundAlertEnabled);
  }
  if (patch.pinHash !== undefined) {
    payload.pinHash = clampStr(patch.pinHash, SCHEMA_LIMITS.settings.pinHashMax);
  }

  try {
    await updateDoc(doc(db, 'userSettings', ownerId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// --- Admin User Management & RBAC CRUD (/appUsers/{emailKey}) ---

export interface AppUserInput extends UserPermissions {
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  department: string;
  notes: string;
}

export async function ensureSuperAdminRecord(
  uid: string,
  email: string,
  displayName: string
): Promise<void> {
  const emailKey = normalizeEmailKey(email);
  if (emailKey !== OWNER_EMAIL) return;
  const path = `appUsers/${emailKey}`;
  const ref = doc(db, 'appUsers', emailKey);
  try {
    const snap = await getDoc(ref);
    const nowIso = new Date().toISOString().slice(0, SCHEMA_LIMITS.appUser.lastLoginIsoMax);
    if (!snap.exists()) {
      const perms = DEFAULT_ROLE_PERMISSIONS.admin;
      await setDoc(ref, {
        email: emailKey,
        displayName: clampStr(displayName || 'Quản trị viên gốc', SCHEMA_LIMITS.appUser.displayNameMax),
        role: 'admin',
        status: 'active',
        department: 'Quản trị hệ thống',
        notes: 'Tài khoản chủ sở hữu & quản trị gốc của hệ thống.',
        ...perms,
        uid,
        lastLoginIso: nowIso,
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        uid,
        lastLoginIso: nowIso,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncSelfUserLogin(email: string, uid: string): Promise<void> {
  const emailKey = normalizeEmailKey(email);
  if (!isValidEmailAddress(emailKey)) return;
  const path = `appUsers/${emailKey}`;
  const ref = doc(db, 'appUsers', emailKey);
  try {
    await updateDoc(ref, {
      uid,
      lastLoginIso: new Date().toISOString().slice(0, SCHEMA_LIMITS.appUser.lastLoginIsoMax),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn('Could not sync user login metadata:', error);
  }
}

export async function createAppUser(adminUid: string, input: AppUserInput): Promise<string> {
  const emailKey = normalizeEmailKey(input.email);
  if (!isValidEmailAddress(emailKey)) {
    throw new Error('Địa chỉ email không hợp lệ. Vui lòng nhập đúng định dạng email Google.');
  }
  const path = `appUsers/${emailKey}`;
  const ref = doc(db, 'appUsers', emailKey);

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      throw new Error(`Tài khoản "${emailKey}" đã tồn tại trong hệ thống.`);
    }

    const role = validEnum(input.role, VALID_USER_ROLES, 'viewer');
    const status = validEnum(input.status, VALID_USER_STATUSES, 'active');
    const canViewContacts = Boolean(input.canViewContacts || input.canManageContacts);
    const canManageContacts = canViewContacts && Boolean(input.canManageContacts);

    const payload = {
      email: emailKey,
      displayName: clampStr(input.displayName, SCHEMA_LIMITS.appUser.displayNameMax) || emailKey.split('@')[0],
      role,
      status,
      department: clampStr(input.department, SCHEMA_LIMITS.appUser.departmentMax),
      notes: clampStr(input.notes, SCHEMA_LIMITS.appUser.notesMax),
      canManageWork: role === 'admin' ? true : Boolean(input.canManageWork),
      canManageLocations: role === 'admin' ? true : Boolean(input.canManageLocations),
      canViewContacts: role === 'admin' ? true : canViewContacts,
      canManageContacts: role === 'admin' ? true : canManageContacts,
      canUseAI: role === 'admin' ? true : Boolean(input.canUseAI),
      canPrintReports: role === 'admin' ? true : Boolean(input.canPrintReports),
      uid: '',
      lastLoginIso: '',
      createdBy: adminUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(ref, payload);
    return emailKey;
  } catch (error) {
    if (error instanceof Error && error.message.includes('đã tồn tại')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export interface AppUserUpdateInput extends UserPermissions {
  displayName: string;
  role: UserRole;
  status: UserStatus;
  department: string;
  notes: string;
}

export async function updateAppUser(emailKeyRaw: string, input: AppUserUpdateInput): Promise<void> {
  const emailKey = normalizeEmailKey(emailKeyRaw);
  const path = `appUsers/${emailKey}`;
  const isOwner = emailKey === OWNER_EMAIL;

  const role: UserRole = isOwner ? 'admin' : validEnum(input.role, VALID_USER_ROLES, 'viewer');
  const status: UserStatus = isOwner ? 'active' : validEnum(input.status, VALID_USER_STATUSES, 'active');
  const canViewContacts = isOwner || role === 'admin' ? true : Boolean(input.canViewContacts || input.canManageContacts);
  const canManageContacts = isOwner || role === 'admin' ? true : canViewContacts && Boolean(input.canManageContacts);

  const payload = {
    displayName: clampStr(input.displayName, SCHEMA_LIMITS.appUser.displayNameMax) || emailKey.split('@')[0],
    role,
    status,
    department: clampStr(input.department, SCHEMA_LIMITS.appUser.departmentMax),
    notes: clampStr(input.notes, SCHEMA_LIMITS.appUser.notesMax),
    canManageWork: isOwner || role === 'admin' ? true : Boolean(input.canManageWork),
    canManageLocations: isOwner || role === 'admin' ? true : Boolean(input.canManageLocations),
    canViewContacts,
    canManageContacts,
    canUseAI: isOwner || role === 'admin' ? true : Boolean(input.canUseAI),
    canPrintReports: isOwner || role === 'admin' ? true : Boolean(input.canPrintReports),
    updatedAt: serverTimestamp(),
  };

  try {
    await updateDoc(doc(db, 'appUsers', emailKey), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteAppUser(emailKeyRaw: string): Promise<void> {
  const emailKey = normalizeEmailKey(emailKeyRaw);
  if (emailKey === OWNER_EMAIL) {
    throw new Error('Không thể xóa tài khoản Quản trị viên gốc.');
  }
  const path = `appUsers/${emailKey}`;
  try {
    await deleteDoc(doc(db, 'appUsers', emailKey));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Travel Itinerary Management (/travelTrips & /travelTrips/{tripId}/stops) ---

function buildRoutePreview(stops: Array<{ orderIndex: number; locationCode: string }>): string {
  const sorted = [...stops].sort((a, b) => a.orderIndex - b.orderIndex);
  if (sorted.length === 0) return '';
  const chain = sorted.map((s) => s.locationCode).join(' → ');
  return clampStr(chain, SCHEMA_LIMITS.travelTrip.routePreviewMax);
}

export function subscribeTravelTrips(
  onData: (items: TravelTripRecord[], meta: SyncMeta) => void
): Unsubscribe {
  const path = 'travelTrips';
  const q = query(collection(db, path));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      const items: TravelTripRecord[] = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<TravelTripRecord, 'id'>),
        }))
        .sort((a, b) => {
          const dateCmp = b.startDate.localeCompare(a.startDate);
          if (dateCmp !== 0) return dateCmp;
          return a.code.localeCompare(b.code, 'vi');
        });
      onData(items, {
        fromCache: snap.metadata.fromCache,
        hasPendingWrites: snap.metadata.hasPendingWrites,
        lastSyncedAt: Date.now(),
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeTravelStops(
  tripId: string,
  onData: (stops: TravelStopRecord[], meta: SyncMeta) => void
): Unsubscribe {
  const path = `travelTrips/${tripId}/stops`;
  const q = query(collection(db, 'travelTrips', tripId, 'stops'));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      const stops: TravelStopRecord[] = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<TravelStopRecord, 'id'>),
        }))
        .sort((a, b) => {
          if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
          const dateCmp = a.stopDate.localeCompare(b.stopDate);
          if (dateCmp !== 0) return dateCmp;
          return a.arrivalTime.localeCompare(b.arrivalTime);
        });
      onData(stops, {
        fromCache: snap.metadata.fromCache,
        hasPendingWrites: snap.metadata.hasPendingWrites,
        lastSyncedAt: Date.now(),
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function fetchTravelStopsOnce(tripId: string): Promise<TravelStopRecord[]> {
  const path = `travelTrips/${tripId}/stops`;
  try {
    const snap = await getDocs(collection(db, 'travelTrips', tripId, 'stops'));
    return snap.docs
      .map((d) => ({
        id: d.id,
        ...(d.data() as Omit<TravelStopRecord, 'id'>),
      }))
      .sort((a, b) => a.orderIndex - b.orderIndex);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export interface TravelTripInput {
  code: string;
  title: string;
  startDate: string;
  endDate: string;
  status: TravelTripStatus;
  transportSummary: string;
  travelers: string;
  budgetNote: string;
  notes: string;
}

export async function createTravelTrip(ownerId: string, input: TravelTripInput): Promise<string> {
  const id = makeSafeId('trip');
  const path = `travelTrips/${id}`;
  const today = getLocalTodayISO();
  const startDate = sanitizeDate(input.startDate, today);
  const rawEnd = sanitizeDate(input.endDate, startDate);
  const endDate = rawEnd < startDate ? startDate : rawEnd;

  const payload = {
    ownerId,
    code: sanitizeCode(input.code, 'DL', SCHEMA_LIMITS.travelTrip.codeMax),
    title: clampStr(input.title, SCHEMA_LIMITS.travelTrip.titleMax) || 'Chuyến du lịch mới',
    startDate,
    endDate,
    status: validEnum(input.status, VALID_TRIP_STATUSES, 'planned'),
    transportSummary: clampStr(input.transportSummary, SCHEMA_LIMITS.travelTrip.transportSummaryMax),
    travelers: clampStr(input.travelers, SCHEMA_LIMITS.travelTrip.travelersMax),
    budgetNote: clampStr(input.budgetNote, SCHEMA_LIMITS.travelTrip.budgetNoteMax),
    notes: clampStr(input.notes, SCHEMA_LIMITS.travelTrip.notesMax),
    stopCount: 0,
    routePreview: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'travelTrips', id), payload);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateTravelTrip(id: string, input: TravelTripInput): Promise<void> {
  const path = `travelTrips/${id}`;
  const today = getLocalTodayISO();
  const startDate = sanitizeDate(input.startDate, today);
  const rawEnd = sanitizeDate(input.endDate, startDate);
  const endDate = rawEnd < startDate ? startDate : rawEnd;

  const payload = {
    code: sanitizeCode(input.code, 'DL', SCHEMA_LIMITS.travelTrip.codeMax),
    title: clampStr(input.title, SCHEMA_LIMITS.travelTrip.titleMax) || 'Chuyến du lịch',
    startDate,
    endDate,
    status: validEnum(input.status, VALID_TRIP_STATUSES, 'planned'),
    transportSummary: clampStr(input.transportSummary, SCHEMA_LIMITS.travelTrip.transportSummaryMax),
    travelers: clampStr(input.travelers, SCHEMA_LIMITS.travelTrip.travelersMax),
    budgetNote: clampStr(input.budgetNote, SCHEMA_LIMITS.travelTrip.budgetNoteMax),
    notes: clampStr(input.notes, SCHEMA_LIMITS.travelTrip.notesMax),
    updatedAt: serverTimestamp(),
  };

  try {
    await updateDoc(doc(db, 'travelTrips', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function quickUpdateTravelTripStatus(
  id: string,
  status: TravelTripStatus
): Promise<void> {
  const path = `travelTrips/${id}`;
  try {
    await updateDoc(doc(db, 'travelTrips', id), {
      status: validEnum(status, VALID_TRIP_STATUSES, 'planned'),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTravelTripWithStops(tripId: string): Promise<void> {
  const path = `travelTrips/${tripId}`;
  try {
    const stopsSnap = await getDocs(collection(db, 'travelTrips', tripId, 'stops'));
    const batch = writeBatch(db);
    stopsSnap.docs.forEach((d) => {
      batch.delete(d.ref);
    });
    batch.delete(doc(db, 'travelTrips', tripId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function duplicateTravelTrip(
  ownerId: string,
  sourceTrip: TravelTripRecord,
  sourceStops: TravelStopRecord[],
  newCode: string
): Promise<string> {
  const newTripId = makeSafeId('trip');
  const path = `travelTrips/${newTripId}`;
  const safeCode = sanitizeCode(newCode, 'DL', SCHEMA_LIMITS.travelTrip.codeMax);

  const sortedStops = [...sourceStops].sort((a, b) => a.orderIndex - b.orderIndex);
  const routePreview = buildRoutePreview(sortedStops);

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'travelTrips', newTripId), {
      ownerId,
      code: safeCode,
      title: clampStr(`${sourceTrip.title} (Bản sao)`, SCHEMA_LIMITS.travelTrip.titleMax),
      startDate: sourceTrip.startDate,
      endDate: sourceTrip.endDate,
      status: 'planned',
      transportSummary: clampStr(sourceTrip.transportSummary, SCHEMA_LIMITS.travelTrip.transportSummaryMax),
      travelers: clampStr(sourceTrip.travelers, SCHEMA_LIMITS.travelTrip.travelersMax),
      budgetNote: clampStr(sourceTrip.budgetNote, SCHEMA_LIMITS.travelTrip.budgetNoteMax),
      notes: clampStr(sourceTrip.notes, SCHEMA_LIMITS.travelTrip.notesMax),
      stopCount: Math.min(SCHEMA_LIMITS.travelTrip.maxStops, sortedStops.length),
      routePreview,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    sortedStops.forEach((st, idx) => {
      const stopId = makeSafeId('stop');
      batch.set(doc(db, 'travelTrips', newTripId, 'stops', stopId), {
        ownerId,
        tripId: newTripId,
        orderIndex: idx + 1,
        locationId: st.locationId,
        locationCode: sanitizeCode(st.locationCode, 'DD', SCHEMA_LIMITS.travelStop.locationCodeMax),
        stopDate: st.stopDate,
        arrivalTime: st.arrivalTime,
        activityDurationMinutes: Math.max(
          0,
          Math.min(SCHEMA_LIMITS.travelStop.maxDurationMinutes, Math.round(st.activityDurationMinutes || 0))
        ),
        departureTime: st.departureTime,
        transportMode: validEnum(st.transportMode, VALID_TRANSPORT_MODES, 'car'),
        activityTitle: clampStr(st.activityTitle, SCHEMA_LIMITS.travelStop.activityTitleMax),
        notes: clampStr(st.notes, SCHEMA_LIMITS.travelStop.notesMax),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    await batch.commit();
    return newTripId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export interface TravelStopInput {
  orderIndex: number;
  locationId: string;
  locationCode: string;
  stopDate: string;
  arrivalTime: string;
  activityDurationMinutes: number;
  departureTime: string;
  transportMode: TravelTransportMode;
  activityTitle: string;
  notes: string;
}

export async function createTravelStop(
  ownerId: string,
  tripId: string,
  input: TravelStopInput,
  currentStops: TravelStopRecord[]
): Promise<string> {
  const stopId = makeSafeId('stop');
  const path = `travelTrips/${tripId}/stops/${stopId}`;
  const today = getLocalTodayISO();
  const safeLocCode = sanitizeCode(input.locationCode, 'DD', SCHEMA_LIMITS.travelStop.locationCodeMax);
  const clampedDuration = Math.max(
    0,
    Math.min(
      SCHEMA_LIMITS.travelStop.maxDurationMinutes,
      Math.round(Number(input.activityDurationMinutes) || 0)
    )
  );
  const insertPos = Math.max(
    1,
    Math.min(currentStops.length + 1, Math.round(Number(input.orderIndex) || currentStops.length + 1))
  );

  const sortedExisting = [...currentStops].sort((a, b) => a.orderIndex - b.orderIndex);
  const newSummaryList: Array<{ orderIndex: number; locationCode: string }> = [];

  try {
    const batch = writeBatch(db);

    // Shift subsequent stops down by +1 if inserting in the middle
    sortedExisting.forEach((st, idx) => {
      const currentPos = idx + 1;
      const nextPos = currentPos >= insertPos ? currentPos + 1 : currentPos;
      if (st.orderIndex !== nextPos) {
        batch.update(doc(db, 'travelTrips', tripId, 'stops', st.id), {
          orderIndex: nextPos,
          updatedAt: serverTimestamp(),
        });
      }
      newSummaryList.push({ orderIndex: nextPos, locationCode: st.locationCode });
    });

    batch.set(doc(db, 'travelTrips', tripId, 'stops', stopId), {
      ownerId,
      tripId,
      orderIndex: insertPos,
      locationId: clampStr(input.locationId, 128),
      locationCode: safeLocCode,
      stopDate: sanitizeDate(input.stopDate, today),
      arrivalTime: sanitizeTime(input.arrivalTime, '08:00'),
      activityDurationMinutes: clampedDuration,
      departureTime: sanitizeTime(input.departureTime, '09:00'),
      transportMode: validEnum(input.transportMode, VALID_TRANSPORT_MODES, 'car'),
      activityTitle: clampStr(input.activityTitle, SCHEMA_LIMITS.travelStop.activityTitleMax),
      notes: clampStr(input.notes, SCHEMA_LIMITS.travelStop.notesMax),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    newSummaryList.push({ orderIndex: insertPos, locationCode: safeLocCode });
    batch.update(doc(db, 'travelTrips', tripId), {
      stopCount: Math.min(SCHEMA_LIMITS.travelTrip.maxStops, newSummaryList.length),
      routePreview: buildRoutePreview(newSummaryList),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return stopId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateTravelStop(
  tripId: string,
  stopId: string,
  input: TravelStopInput,
  currentStops: TravelStopRecord[]
): Promise<void> {
  const path = `travelTrips/${tripId}/stops/${stopId}`;
  const today = getLocalTodayISO();
  const safeLocCode = sanitizeCode(input.locationCode, 'DD', SCHEMA_LIMITS.travelStop.locationCodeMax);
  const clampedDuration = Math.max(
    0,
    Math.min(
      SCHEMA_LIMITS.travelStop.maxDurationMinutes,
      Math.round(Number(input.activityDurationMinutes) || 0)
    )
  );
  const clampedOrder = Math.max(
    1,
    Math.min(SCHEMA_LIMITS.travelStop.maxOrderIndex, Math.round(Number(input.orderIndex) || 1))
  );

  const updatedSummaryList = currentStops.map((s) =>
    s.id === stopId
      ? { orderIndex: clampedOrder, locationCode: safeLocCode }
      : { orderIndex: s.orderIndex, locationCode: s.locationCode }
  );

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'travelTrips', tripId, 'stops', stopId), {
      orderIndex: clampedOrder,
      locationId: clampStr(input.locationId, 128),
      locationCode: safeLocCode,
      stopDate: sanitizeDate(input.stopDate, today),
      arrivalTime: sanitizeTime(input.arrivalTime, '08:00'),
      activityDurationMinutes: clampedDuration,
      departureTime: sanitizeTime(input.departureTime, '09:00'),
      transportMode: validEnum(input.transportMode, VALID_TRANSPORT_MODES, 'car'),
      activityTitle: clampStr(input.activityTitle, SCHEMA_LIMITS.travelStop.activityTitleMax),
      notes: clampStr(input.notes, SCHEMA_LIMITS.travelStop.notesMax),
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'travelTrips', tripId), {
      stopCount: Math.min(SCHEMA_LIMITS.travelTrip.maxStops, updatedSummaryList.length),
      routePreview: buildRoutePreview(updatedSummaryList),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function reorderTravelStops(
  tripId: string,
  orderedStops: TravelStopRecord[]
): Promise<void> {
  const path = `travelTrips/${tripId}/stops`;
  try {
    const batch = writeBatch(db);
    const summaryList: Array<{ orderIndex: number; locationCode: string }> = [];

    orderedStops.forEach((st, idx) => {
      const nextOrder = idx + 1;
      if (st.orderIndex !== nextOrder) {
        batch.update(doc(db, 'travelTrips', tripId, 'stops', st.id), {
          orderIndex: nextOrder,
          updatedAt: serverTimestamp(),
        });
      }
      summaryList.push({ orderIndex: nextOrder, locationCode: st.locationCode });
    });

    batch.update(doc(db, 'travelTrips', tripId), {
      stopCount: Math.min(SCHEMA_LIMITS.travelTrip.maxStops, summaryList.length),
      routePreview: buildRoutePreview(summaryList),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTravelStop(
  tripId: string,
  stopId: string,
  currentStops: TravelStopRecord[]
): Promise<void> {
  const path = `travelTrips/${tripId}/stops/${stopId}`;
  const remaining = [...currentStops]
    .filter((s) => s.id !== stopId)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'travelTrips', tripId, 'stops', stopId));

    const summaryList: Array<{ orderIndex: number; locationCode: string }> = [];
    remaining.forEach((st, idx) => {
      const nextOrder = idx + 1;
      if (st.orderIndex !== nextOrder) {
        batch.update(doc(db, 'travelTrips', tripId, 'stops', st.id), {
          orderIndex: nextOrder,
          updatedAt: serverTimestamp(),
        });
      }
      summaryList.push({ orderIndex: nextOrder, locationCode: st.locationCode });
    });

    batch.update(doc(db, 'travelTrips', tripId), {
      stopCount: Math.min(SCHEMA_LIMITS.travelTrip.maxStops, summaryList.length),
      routePreview: buildRoutePreview(summaryList),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function seedSampleTravelTrip(
  ownerId: string,
  existingLocations: LocationRecord[],
  canManageLocations: boolean
): Promise<string> {
  const findByCode = (code: string) =>
    existingLocations.find((l) => l.code.toUpperCase() === code.toUpperCase());

  const ensureLoc = async (
    code: string,
    name: string,
    address: string,
    notes: string,
    fallbackIdx: number
  ): Promise<{ id: string; code: string }> => {
    const found = findByCode(code);
    if (found) return { id: found.id, code: found.code };
    if (canManageLocations) {
      const id = await createLocation(ownerId, {
        code,
        name,
        address,
        category: 'personal',
        notes,
      });
      return { id, code };
    }
    const fallback = existingLocations[fallbackIdx % existingLocations.length];
    if (!fallback) {
      throw new Error('Cần ít nhất 1 địa điểm trong Bảng Địa điểm để tạo chuyến du lịch mẫu.');
    }
    return { id: fallback.id, code: fallback.code };
  };

  const locA = await ensureLoc(
    'DL-HCM01',
    'Điểm xuất phát TP.HCM',
    'Trung tâm Quận 1, TP. Hồ Chí Minh',
    'Tập trung kiểm tra hành lý trước giờ khởi hành.',
    0
  );
  const locB = await ensureLoc(
    'DL-PT02',
    'Biển Mũi Né — Phan Thiết',
    'Đường Nguyễn Đình Chiểu, TP. Phan Thiết, Bình Thuận',
    'Dừng nghỉ chân, tham quan đồi cát và ăn trưa hải sản.',
    1
  );
  const locC = await ensureLoc(
    'DL-DL03',
    'Hồ Xuân Hương & Trung tâm Đà Lạt',
    'Phường 1, TP. Đà Lạt, Lâm Đồng',
    'Nhận phòng khách sạn, dạo chợ đêm và thưởng thức cà phê.',
    2
  );
  const locD = await ensureLoc(
    'DL-NT04',
    'Vịnh Nha Trang — Khánh Hòa',
    'Đường Trần Phú, TP. Nha Trang, Khánh Hòa',
    'Tắm biển, đi cáp treo và tổng kết hành trình.',
    3
  );

  const day1 = offsetDateISO(3);
  const day2 = offsetDateISO(4);

  const tripId = makeSafeId('trip');
  const stopsSpec = [
    {
      loc: locA,
      stopDate: day1,
      arrivalTime: '05:30',
      activityDurationMinutes: 30,
      departureTime: '06:00',
      transportMode: 'car' as TravelTransportMode,
      activityTitle: 'Tập trung đoàn, kiểm tra hành lý và ăn sáng nhẹ',
      notes: 'Xuất phát đúng 06:00 theo cao tốc Long Thành — Dầu Giây — Phan Thiết.',
    },
    {
      loc: locB,
      stopDate: day1,
      arrivalTime: '09:00',
      activityDurationMinutes: 150,
      departureTime: '11:30',
      transportMode: 'car' as TravelTransportMode,
      activityTitle: 'Tham quan bãi biển Mũi Né & dùng bữa trưa hải sản',
      notes: 'Nghỉ ngơi 2 giờ 30 phút trước khi lên đèo Đại Ninh đi Đà Lạt.',
    },
    {
      loc: locC,
      stopDate: day1,
      arrivalTime: '15:00',
      activityDurationMinutes: 1080,
      departureTime: '09:00',
      transportMode: 'car' as TravelTransportMode,
      activityTitle: 'Nhận phòng, dạo Hồ Xuân Hương, chợ đêm Đà Lạt & nghỉ đêm',
      notes: 'Sáng hôm sau ăn sáng và khởi hành xuống Nha Trang qua đèo Khánh Lê lúc 09:00.',
    },
    {
      loc: locD,
      stopDate: day2,
      arrivalTime: '12:30',
      activityDurationMinutes: 240,
      departureTime: '16:30',
      transportMode: 'car' as TravelTransportMode,
      activityTitle: 'Ăn trưa, tham quan vịnh Nha Trang & kết thúc hành trình',
      notes: 'Hoạt động tự do 4 tiếng trước khi làm thủ tục về.',
    },
  ];

  const routePreview = buildRoutePreview(
    stopsSpec.map((s, idx) => ({ orderIndex: idx + 1, locationCode: s.loc.code }))
  );

  const path = `travelTrips/${tripId}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'travelTrips', tripId), {
      ownerId,
      code: sanitizeCode(`DL-${day1.slice(0, 4)}-01`, 'DL', SCHEMA_LIMITS.travelTrip.codeMax),
      title: 'Hành trình TP.HCM — Phan Thiết — Đà Lạt — Nha Trang',
      startDate: day1,
      endDate: day2,
      status: 'planned',
      transportSummary: 'Ô tô 7 chỗ',
      travelers: 'Gia đình 4 thành viên',
      budgetNote: 'Dự kiến 12.000.000 VNĐ',
      notes: 'Lịch trình mẫu liên kết trực tiếp bằng Mã địa điểm từ Bảng Địa điểm.',
      stopCount: stopsSpec.length,
      routePreview,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    stopsSpec.forEach((st, idx) => {
      const stopId = makeSafeId('stop');
      batch.set(doc(db, 'travelTrips', tripId, 'stops', stopId), {
        ownerId,
        tripId,
        orderIndex: idx + 1,
        locationId: st.loc.id,
        locationCode: st.loc.code,
        stopDate: st.stopDate,
        arrivalTime: st.arrivalTime,
        activityDurationMinutes: st.activityDurationMinutes,
        departureTime: st.departureTime,
        transportMode: st.transportMode,
        activityTitle: st.activityTitle,
        notes: st.notes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    await batch.commit();
    return tripId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// --- One-Click Starter Data Seeder (Optional User Action) ---

function offsetDateISO(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function seedStarterPersonalData(ownerId: string): Promise<void> {
  const locOfficeId = await createLocation(ownerId, {
    code: 'DD-VP01',
    name: 'Văn phòng Làm việc Chính',
    address: 'Tầng 8, Tòa nhà Trung tâm, 45 Lý Tự Trọng, Quận 1, TP.HCM',
    category: 'office',
    notes: 'Phòng họp B2 cần đặt lịch trước 30 phút.',
  });

  const locAgencyId = await createLocation(ownerId, {
    code: 'DD-CQ02',
    name: 'Hội trường Sở Kế hoạch & Đầu tư',
    address: '32 Lê Thánh Tôn, Phường Bến Nghé, Quận 1, TP.HCM',
    category: 'agency',
    notes: 'Mang theo giấy mời bản cứng và thẻ công tác.',
  });

  const locSiteId = await createLocation(ownerId, {
    code: 'DD-CT03',
    name: 'Khu dự án Đô thị Phía Đông',
    address: 'Lô C4, Đường Mai Chí Thọ, TP. Thủ Đức, TP.HCM',
    category: 'site',
    notes: 'Liên hệ Ban quản lý công trường cổng số 2.',
  });

  const locHomeId = await createLocation(ownerId, {
    code: 'DD-CN04',
    name: 'Nhà riêng & Gia đình',
    address: '128 Nguyễn Văn Trỗi, Quận Phú Nhuận, TP.HCM',
    category: 'personal',
    notes: 'Lịch sinh hoạt và việc gia đình.',
  });

  const ctClientId = await createContact(ownerId, {
    code: 'LH-KH01',
    fullName: 'Nguyễn Minh Quân',
    group: 'client',
    relationship: 'Giám đốc Dự án',
    organization: 'Công ty Cổ phần Hạ tầng Việt',
    phone: '0908456712',
    email: 'quan.nguyen@hatangviet.vn',
    locationId: locSiteId,
    address: 'Tòa nhà Pearl Plaza, Bình Thạnh',
    notes: 'Ưu tiên trao đổi trực tiếp vào buổi sáng.',
  });

  const ctPartnerId = await createContact(ownerId, {
    code: 'LH-DT02',
    fullName: 'Trần Thị Thu Hương',
    group: 'partner',
    relationship: 'Chuyên viên Thẩm định',
    organization: 'Sở Kế hoạch & Đầu tư',
    phone: '0913789234',
    email: 'huong.tran@skhdt.gov.vn',
    locationId: locAgencyId,
    address: '',
    notes: 'Phụ trách tiếp nhận hồ sơ thẩm định giai đoạn 2.',
  });

  const ctFamilyId = await createContact(ownerId, {
    code: 'LH-GD03',
    fullName: 'Trần Đình Nam',
    group: 'family',
    relationship: 'Anh trai',
    organization: 'Gia đình',
    phone: '0989112233',
    email: 'nam.tran.family@gmail.com',
    locationId: locHomeId,
    address: '128 Nguyễn Văn Trỗi, Phú Nhuận',
    notes: 'Sinh nhật ngày 15/12.',
  });

  const today = offsetDateISO(0);
  const tomorrow = offsetDateISO(1);
  const inTwoDays = offsetDateISO(2);
  const yesterday = offsetDateISO(-1);

  await createWorkItem(ownerId, {
    itemType: 'invitation',
    code: 'GM-218/SKH',
    title: 'Họp thẩm định hồ sơ thiết kế cơ sở Dự án Hạ tầng Đông',
    projectCode: 'DA-HTD26',
    projectName: 'Dự án Hạ tầng Phía Đông 2026',
    locationId: locAgencyId,
    contactId: ctPartnerId,
    scheduledDate: today,
    startTime: '08:30',
    endTime: '11:00',
    priority: 'urgent',
    status: 'in_progress',
    reminderMinutes: 30,
    notes: 'Chuẩn bị 03 bộ hồ sơ đóng quyển và slide trình bày tiến độ quý IV.',
  });

  await createWorkItem(ownerId, {
    itemType: 'task',
    code: 'CV-2026-104',
    title: 'Rà soát hợp đồng và nghiệm thu đợt 2 cùng khách hàng',
    projectCode: 'DA-HTD26',
    projectName: 'Dự án Hạ tầng Phía Đông 2026',
    locationId: locOfficeId,
    contactId: ctClientId,
    scheduledDate: today,
    startTime: '14:00',
    endTime: '16:00',
    priority: 'high',
    status: 'pending',
    reminderMinutes: 15,
    notes: 'Đối chiếu bảng khối lượng hoàn thành thực tế trước khi ký biên bản.',
  });

  await createWorkItem(ownerId, {
    itemType: 'task',
    code: 'CV-2026-105',
    title: 'Ăn tối họp mặt gia đình cuối tuần',
    projectCode: '',
    projectName: '',
    locationId: locHomeId,
    contactId: ctFamilyId,
    scheduledDate: today,
    startTime: '18:30',
    endTime: '20:30',
    priority: 'medium',
    status: 'pending',
    reminderMinutes: 60,
    notes: 'Mua thêm trái cây trước khi về.',
  });

  await createWorkItem(ownerId, {
    itemType: 'project',
    code: 'DA-HTD26',
    title: 'Kiểm tra thực địa tiến độ thi công hạ tầng khu C4',
    projectCode: 'DA-HTD26',
    projectName: 'Dự án Hạ tầng Phía Đông 2026',
    locationId: locSiteId,
    contactId: ctClientId,
    scheduledDate: tomorrow,
    startTime: '09:00',
    endTime: '11:30',
    priority: 'high',
    status: 'pending',
    reminderMinutes: 60,
    notes: 'Chụp ảnh hiện trường và ghi nhận nhật ký giám sát.',
  });

  await createWorkItem(ownerId, {
    itemType: 'project',
    code: 'DA-CDS09',
    title: 'Khởi động giai đoạn số hóa lưu trữ hồ sơ nội bộ',
    projectCode: 'DA-CDS09',
    projectName: 'Chuyển đổi số Quản trị Nội bộ',
    locationId: locOfficeId,
    contactId: '',
    scheduledDate: inTwoDays,
    startTime: '10:00',
    endTime: '12:00',
    priority: 'medium',
    status: 'pending',
    reminderMinutes: 30,
    notes: 'Thống nhất quy chuẩn đánh mã tài liệu và phân quyền sao lưu.',
  });

  await createWorkItem(ownerId, {
    itemType: 'task',
    code: 'CV-2026-098',
    title: 'Tổng hợp báo cáo tiến độ tuần trước & gửi đối tác',
    projectCode: 'DA-HTD26',
    projectName: 'Dự án Hạ tầng Phía Đông 2026',
    locationId: locOfficeId,
    contactId: ctClientId,
    scheduledDate: yesterday,
    startTime: '15:00',
    endTime: '17:00',
    priority: 'medium',
    status: 'completed',
    reminderMinutes: 15,
    reminderDismissed: true,
    notes: 'Đã gửi email và xác nhận tiếp nhận.',
  });
}
