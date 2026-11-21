import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  BarChart3,
  Briefcase,
  LayoutDashboard,
  Lock,
  MapPin,
  MoreHorizontal,
  Printer,
  Route,
  ShieldCheck,
  Sparkles,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { auth, OWNER_EMAIL } from './firebase';
import {
  DEFAULT_ROLE_PERMISSIONS,
  normalizeEmailKey,
  USER_ROLE_LABELS,
  type AppTab,
  type AppUserRecord,
  type ContactRecord,
  type EffectiveUserAccess,
  type LocationRecord,
  type TravelTripRecord,
  type UserSettingsRecord,
  type WorkItemRecord,
} from './types';
import {
  ensureSuperAdminRecord,
  ensureUserSettings,
  subscribeAllAppUsers,
  subscribeContacts,
  subscribeLocations,
  subscribeMyAppUser,
  subscribeTravelTrips,
  subscribeUserSettings,
  subscribeWorkItems,
  syncSelfUserLogin,
  type SyncMeta,
} from './services/firestoreService';
import { useReminders } from './hooks/useReminders';
import { AuthGate } from './components/AuthGate';
import { DashboardView } from './components/DashboardView';
import { WorkItemsView } from './components/WorkItemsView';
import { TravelView } from './components/TravelView';
import { LocationsView } from './components/LocationsView';
import { ContactsView } from './components/ContactsView';
import { ReportsView } from './components/ReportsView';
import { PrintStudioView } from './components/PrintStudioView';
import { UserManagementView } from './components/UserManagementView';
import { SecuritySettingsView } from './components/SecuritySettingsView';
import { WorkItemFormModal } from './components/WorkItemFormModal';
import { AIInputModal } from './components/AIInputModal';

interface NavItem {
  id: AppTab;
  label: string;
  shortLabel: string;
  icon: React.FC<{ className?: string }>;
}

const ALL_NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Tổng quan', shortLabel: 'Tổng quan', icon: LayoutDashboard },
  { id: 'work', label: 'Công việc & Lịch', shortLabel: 'Lịch & Việc', icon: Briefcase },
  { id: 'travel', label: 'Lịch trình Du lịch', shortLabel: 'Du lịch', icon: Route },
  { id: 'locations', label: 'Bảng Địa điểm', shortLabel: 'Địa điểm', icon: MapPin },
  { id: 'contacts', label: 'Danh bạ quan hệ', shortLabel: 'Danh bạ', icon: Users },
  { id: 'reports', label: 'Báo cáo tự động', shortLabel: 'Báo cáo', icon: BarChart3 },
  { id: 'print', label: 'In lịch & In kim', shortLabel: 'In ấn', icon: Printer },
  { id: 'users', label: 'Quản lý người dùng', shortLabel: 'Người dùng', icon: UserCog },
  { id: 'security', label: 'Bảo mật & Cài đặt', shortLabel: 'Bảo mật', icon: ShieldCheck },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [myAppUser, setMyAppUser] = useState<AppUserRecord | null>(null);
  const [myAppUserLoaded, setMyAppUserLoaded] = useState(false);
  const [appUsers, setAppUsers] = useState<AppUserRecord[]>([]);

  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [workItems, setWorkItems] = useState<WorkItemRecord[]>([]);
  const [travelTrips, setTravelTrips] = useState<TravelTripRecord[]>([]);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [settings, setSettings] = useState<UserSettingsRecord | null>(null);
  const [syncMeta, setSyncMeta] = useState<SyncMeta | null>(null);
  const [printTravelTripId, setPrintTravelTripId] = useState<string | null>(null);

  const [isPinLocked, setIsPinLocked] = useState(false);

  // Shared modals
  const [workModalOpen, setWorkModalOpen] = useState(false);
  const [editingWorkItem, setEditingWorkItem] = useState<WorkItemRecord | null>(null);
  const [newWorkDefaultDate, setNewWorkDefaultDate] = useState<string | undefined>(undefined);
  const [aiModalOpen, setAiModalOpen] = useState(false);

  // Subtle transient feedback toast
  const [toastMsg, setToastMsg] = useState('');
  const loginSyncedUidRef = useRef<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
  };

  useEffect(() => {
    if (!toastMsg) return;
    const t = window.setTimeout(() => setToastMsg(''), 3200);
    return () => window.clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
      if (!firebaseUser) {
        setMyAppUser(null);
        setMyAppUserLoaded(true);
        loginSyncedUidRef.current = null;
      } else {
        setMyAppUserLoaded(false);
      }
    });
    return unsub;
  }, []);

  // Subscribe to current user's RBAC record in /appUsers/{normalizedEmail}
  useEffect(() => {
    if (!user || !user.email || !user.emailVerified) {
      setMyAppUser(null);
      setMyAppUserLoaded(true);
      return;
    }

    const emailKey = normalizeEmailKey(user.email);
    const unsub = subscribeMyAppUser(emailKey, (record, loaded) => {
      setMyAppUser(record);
      setMyAppUserLoaded(loaded);
    });
    return unsub;
  }, [user]);

  // Resolve effective RBAC access from Super Admin bootstrap or /appUsers record
  const access: EffectiveUserAccess = useMemo(() => {
    if (!user) {
      return {
        authorized: false,
        denialReason: 'none',
        isSuperAdmin: false,
        isAdmin: false,
        isManagerOrAdmin: false,
        role: 'viewer',
        permissions: { ...DEFAULT_ROLE_PERMISSIONS.viewer },
        profile: null,
      };
    }

    if (!user.emailVerified || !user.email) {
      return {
        authorized: false,
        denialReason: 'unverified',
        isSuperAdmin: false,
        isAdmin: false,
        isManagerOrAdmin: false,
        role: 'viewer',
        permissions: { ...DEFAULT_ROLE_PERMISSIONS.viewer },
        profile: null,
      };
    }

    const emailKey = normalizeEmailKey(user.email);
    const isSuperAdmin = emailKey === OWNER_EMAIL;

    if (isSuperAdmin) {
      return {
        authorized: true,
        denialReason: 'none',
        isSuperAdmin: true,
        isAdmin: true,
        isManagerOrAdmin: true,
        role: 'admin',
        permissions: { ...DEFAULT_ROLE_PERMISSIONS.admin },
        profile: myAppUser,
      };
    }

    if (!myAppUser) {
      return {
        authorized: false,
        denialReason: 'not_registered',
        isSuperAdmin: false,
        isAdmin: false,
        isManagerOrAdmin: false,
        role: 'viewer',
        permissions: { ...DEFAULT_ROLE_PERMISSIONS.viewer },
        profile: null,
      };
    }

    if (myAppUser.status !== 'active') {
      return {
        authorized: false,
        denialReason: 'suspended',
        isSuperAdmin: false,
        isAdmin: false,
        isManagerOrAdmin: false,
        role: myAppUser.role,
        permissions: { ...DEFAULT_ROLE_PERMISSIONS.viewer },
        profile: myAppUser,
      };
    }

    const isAdmin = myAppUser.role === 'admin';
    const isManagerOrAdmin = isAdmin || myAppUser.role === 'manager';

    return {
      authorized: true,
      denialReason: 'none',
      isSuperAdmin: false,
      isAdmin,
      isManagerOrAdmin,
      role: myAppUser.role,
      permissions: isAdmin
        ? { ...DEFAULT_ROLE_PERMISSIONS.admin }
        : {
            canManageWork: Boolean(myAppUser.canManageWork),
            canManageLocations: Boolean(myAppUser.canManageLocations),
            canViewContacts: Boolean(myAppUser.canViewContacts),
            canManageContacts: Boolean(myAppUser.canViewContacts && myAppUser.canManageContacts),
            canUseAI: Boolean(myAppUser.canUseAI),
            canPrintReports: Boolean(myAppUser.canPrintReports),
          },
      profile: myAppUser,
    };
  }, [user, myAppUser]);

  // Sync Super Admin bootstrap doc or regular user's lastLoginIso + UID once per sign-in
  useEffect(() => {
    if (!user || !user.email || !access.authorized) return;
    if (loginSyncedUidRef.current === user.uid) return;
    loginSyncedUidRef.current = user.uid;

    if (access.isSuperAdmin) {
      ensureSuperAdminRecord(user.uid, user.email, user.displayName || '').catch((err) => {
        console.error('Failed to ensure Super Admin record:', err);
      });
    } else if (myAppUser && myAppUser.status === 'active') {
      syncSelfUserLogin(user.email, user.uid).catch((err) => {
        console.error('Failed to sync self login:', err);
      });
    }
  }, [user, access.authorized, access.isSuperAdmin, myAppUser]);

  // Workspace data subscriptions (Locations, WorkItems, TravelTrips, UserSettings)
  useEffect(() => {
    if (!access.authorized || !user) {
      setLocations([]);
      setWorkItems([]);
      setTravelTrips([]);
      setSettings(null);
      return;
    }

    ensureUserSettings(
      user.uid,
      access.profile?.displayName || user.displayName || ''
    ).catch((err) => {
      console.error('Failed to ensure userSettings:', err);
    });

    const unsubLoc = subscribeLocations((items, meta) => {
      setLocations(items);
      setSyncMeta(meta);
    });
    const unsubWork = subscribeWorkItems((items, meta) => {
      setWorkItems(items);
      setSyncMeta(meta);
    });
    const unsubTrips = subscribeTravelTrips((items, meta) => {
      setTravelTrips(items);
      setSyncMeta(meta);
    });
    const unsubSettings = subscribeUserSettings(user.uid, (docData) => {
      setSettings(docData);
    });

    return () => {
      unsubLoc();
      unsubWork();
      unsubTrips();
      unsubSettings();
    };
  }, [access.authorized, user]);

  // Contacts PII subscription (only when explicitly permitted)
  useEffect(() => {
    if (!access.authorized || !access.permissions.canViewContacts) {
      setContacts([]);
      return;
    }
    const unsubContacts = subscribeContacts((items, meta) => {
      setContacts(items);
      setSyncMeta(meta);
    });
    return unsubContacts;
  }, [access.authorized, access.permissions.canViewContacts]);

  // Admin Users directory subscription (only for Admins)
  useEffect(() => {
    if (!access.authorized || !access.isAdmin) {
      setAppUsers([]);
      return;
    }
    const unsubUsers = subscribeAllAppUsers((items) => {
      setAppUsers(items);
    });
    return unsubUsers;
  }, [access.authorized, access.isAdmin]);

  // Visible navigation items based on RBAC permissions
  const visibleNavItems = useMemo(() => {
    return ALL_NAV_ITEMS.filter((item) => {
      if (item.id === 'contacts') return access.permissions.canViewContacts;
      if (item.id === 'reports' || item.id === 'print') return access.permissions.canPrintReports;
      if (item.id === 'users') return access.isAdmin;
      return true;
    });
  }, [access.isAdmin, access.permissions.canViewContacts, access.permissions.canPrintReports]);

  // Guard activeTab if permissions change in real time
  useEffect(() => {
    if (!visibleNavItems.some((n) => n.id === activeTab)) {
      setActiveTab('dashboard');
    }
  }, [visibleNavItems, activeTab]);

  const locationsMap = useMemo(() => {
    const map = new Map<string, LocationRecord>();
    for (const l of locations) map.set(l.id, l);
    return map;
  }, [locations]);

  const contactsMap = useMemo(() => {
    const map = new Map<string, ContactRecord>();
    for (const c of contacts) map.set(c.id, c);
    return map;
  }, [contacts]);

  const { now, activeReminders, snoozeReminder } = useReminders(
    workItems,
    locationsMap,
    settings?.soundAlertEnabled ?? true
  );

  const isCheckingAccess = authLoading || (Boolean(user) && !myAppUserLoaded);

  // Show AuthGate until verified authorized user signs in (and passes PIN if locked)
  if (isCheckingAccess || !user || !access.authorized || (isPinLocked && settings?.pinHash)) {
    return (
      <AuthGate
        user={user}
        authLoading={isCheckingAccess}
        isAuthorizedUser={access.authorized}
        denialReason={access.denialReason}
        pinHash={settings?.pinHash || ''}
        isPinLocked={isPinLocked}
        onUnlockPin={() => setIsPinLocked(false)}
      />
    );
  }

  const privacyMaskEnabled = Boolean(settings?.privacyMaskEnabled);
  const currentNav = visibleNavItems.find((n) => n.id === activeTab) || visibleNavItems[0];
  const canOpenAI = access.permissions.canUseAI && access.permissions.canManageWork;

  const openNewWorkItem = (date?: string) => {
    if (!access.permissions.canManageWork) return;
    setEditingWorkItem(null);
    setNewWorkDefaultDate(date);
    setWorkModalOpen(true);
  };

  const openEditWorkItem = (item: WorkItemRecord) => {
    if (!access.permissions.canManageWork) return;
    if (!access.isManagerOrAdmin && item.ownerId !== user.uid) return;
    setEditingWorkItem(item);
    setNewWorkDefaultDate(undefined);
    setWorkModalOpen(true);
  };

  const syncStatusText = syncMeta
    ? syncMeta.hasPendingWrites
      ? 'Đang đồng bộ lên đám mây...'
      : syncMeta.fromCache
        ? 'Chế độ ngoại tuyến (đã lưu cục bộ)'
        : 'Đã đồng bộ đám mây'
    : 'Đang kết nối đám mây...';

  const mobilePrimaryTabs = visibleNavItems
    .filter((n) => ['dashboard', 'work', 'travel', 'locations'].includes(n.id))
    .slice(0, 4);
  const mobileMoreTabs = visibleNavItems.filter(
    (n) => !mobilePrimaryTabs.some((p) => p.id === n.id)
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex">
      {/* Desktop Left Sidebar */}
      <aside className="no-print hidden lg:flex lg:flex-col w-64 shrink-0 bg-white border-r border-slate-200 sticky top-0 h-screen">
        <div className="h-16 px-5 flex items-center border-b border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap"
          >
            Sổ Tay Công Tác
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Điều hướng chính">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full min-h-[42px] px-3 py-2 rounded-lg flex items-center justify-between gap-3 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[#1E3A5F] text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate whitespace-nowrap">{item.label}</span>
                </span>
                {item.id === 'dashboard' && activeReminders.length > 0 && (
                  <span
                    className={`text-xs font-mono-tabular font-semibold ${
                      active ? 'text-amber-200' : 'text-amber-700'
                    }`}
                  >
                    {activeReminders.length}
                  </span>
                )}
                {item.id === 'travel' && travelTrips.length > 0 && (
                  <span
                    className={`text-xs font-mono-tabular ${
                      active ? 'text-slate-200' : 'text-slate-400'
                    }`}
                  >
                    {travelTrips.length}
                  </span>
                )}
                {item.id === 'users' && appUsers.length > 0 && (
                  <span
                    className={`text-xs font-mono-tabular ${
                      active ? 'text-slate-200' : 'text-slate-400'
                    }`}
                  >
                    {appUsers.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3 text-xs">
          <div className="space-y-0.5">
            <div className="font-semibold text-slate-900 truncate">
              {access.profile?.displayName || settings?.ownerTitle || user.displayName || 'Người dùng'}
            </div>
            <div className="text-[11px] font-medium text-[#1E3A5F]">
              {access.isSuperAdmin ? 'Quản trị gốc' : USER_ROLE_LABELS[access.role]}
            </div>
            <div className="text-slate-500 truncate font-mono-tabular">{user.email}</div>
            <div className="text-[11px] text-slate-500 pt-0.5">{syncStatusText}</div>
          </div>

          {settings?.pinHash && (
            <button
              type="button"
              onClick={() => setIsPinLocked(true)}
              className="w-full min-h-[38px] inline-flex items-center justify-center gap-2 px-3 py-1.5 font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100"
            >
              <Lock className="w-3.5 h-3.5" />
              Khóa nhanh màn hình
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Compact Top Bar (Mobile 52px / Desktop 64px) */}
        <header className="no-print sticky top-0 z-30 h-[52px] lg:h-16 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="lg:hidden text-sm font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              Sổ Tay Công Tác
            </span>
            <span className="hidden lg:inline text-sm font-medium text-slate-500 whitespace-nowrap">
              {currentNav.label}
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {canOpenAI && (
              <button
                type="button"
                onClick={() => setAiModalOpen(true)}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] transition-colors whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Nhập bằng AI
              </button>
            )}
          </div>
        </header>

        {/* Active Viewport Content */}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7 pb-20 lg:pb-10">
          {activeTab === 'dashboard' && (
            <DashboardView
              ownerId={user.uid}
              now={now}
              workItems={workItems}
              locations={locations}
              contacts={contacts}
              locationsMap={locationsMap}
              contactsMap={contactsMap}
              activeReminders={activeReminders}
              privacyMaskEnabled={privacyMaskEnabled}
              canManageWork={access.permissions.canManageWork}
              canUseAI={access.permissions.canUseAI}
              canPrintReports={access.permissions.canPrintReports}
              isAdmin={access.isAdmin}
              isManagerOrAdmin={access.isManagerOrAdmin}
              onSnoozeReminder={snoozeReminder}
              onOpenNewWorkItem={openNewWorkItem}
              onEditWorkItem={openEditWorkItem}
              onOpenAIInput={() => setAiModalOpen(true)}
              onNavigate={setActiveTab}
              onNotify={showToast}
            />
          )}

          {activeTab === 'work' && (
            <WorkItemsView
              currentUserId={user.uid}
              workItems={workItems}
              locations={locations}
              locationsMap={locationsMap}
              contactsMap={contactsMap}
              privacyMaskEnabled={privacyMaskEnabled}
              canManageWork={access.permissions.canManageWork}
              canUseAI={access.permissions.canUseAI}
              isManagerOrAdmin={access.isManagerOrAdmin}
              onOpenNew={() => openNewWorkItem()}
              onEdit={openEditWorkItem}
              onOpenAIInput={() => setAiModalOpen(true)}
              onNotify={showToast}
            />
          )}

          {activeTab === 'travel' && (
            <TravelView
              ownerId={user.uid}
              trips={travelTrips}
              locations={locations}
              locationsMap={locationsMap}
              privacyMaskEnabled={privacyMaskEnabled}
              canManageWork={access.permissions.canManageWork}
              canManageLocations={access.permissions.canManageLocations}
              canPrintReports={access.permissions.canPrintReports}
              isManagerOrAdmin={access.isManagerOrAdmin}
              onNavigate={setActiveTab}
              onPrintTrip={(tripId) => {
                setPrintTravelTripId(tripId);
                setActiveTab('print');
              }}
              onNotify={showToast}
            />
          )}

          {activeTab === 'locations' && (
            <LocationsView
              ownerId={user.uid}
              locations={locations}
              workItems={workItems}
              contacts={contacts}
              travelTrips={travelTrips}
              privacyMaskEnabled={privacyMaskEnabled}
              canManageLocations={access.permissions.canManageLocations}
              isManagerOrAdmin={access.isManagerOrAdmin}
              onNotify={showToast}
            />
          )}

          {activeTab === 'contacts' && access.permissions.canViewContacts && (
            <ContactsView
              ownerId={user.uid}
              contacts={contacts}
              locations={locations}
              workItems={workItems}
              locationsMap={locationsMap}
              privacyMaskEnabled={privacyMaskEnabled}
              canManageContacts={access.permissions.canManageContacts}
              isManagerOrAdmin={access.isManagerOrAdmin}
              onNotify={showToast}
            />
          )}

          {activeTab === 'reports' && access.permissions.canPrintReports && (
            <ReportsView
              workItems={workItems}
              locationsMap={locationsMap}
              onNavigate={setActiveTab}
            />
          )}

          {activeTab === 'print' && access.permissions.canPrintReports && (
            <PrintStudioView
              workItems={workItems}
              travelTrips={travelTrips}
              initialTravelTripId={printTravelTripId}
              locationsMap={locationsMap}
              contactsMap={contactsMap}
              settings={settings}
            />
          )}

          {activeTab === 'users' && access.isAdmin && (
            <UserManagementView
              currentAdminUid={user.uid}
              currentAdminEmail={user.email || ''}
              isSuperAdmin={access.isSuperAdmin}
              appUsers={appUsers}
              onNotify={showToast}
            />
          )}

          {activeTab === 'security' && (
            <SecuritySettingsView
              user={user}
              access={access}
              userCount={appUsers.length}
              settings={settings}
              onLockNow={() => setIsPinLocked(true)}
              onNavigate={setActiveTab}
              onNotify={showToast}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Thumb-Zone Navigation */}
      <nav
        aria-label="Điều hướng di động"
        className="no-print lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div
          className="grid h-[58px] items-center"
          style={{ gridTemplateColumns: `repeat(${mobilePrimaryTabs.length + 1}, minmax(0, 1fr))` }}
        >
          {mobilePrimaryTabs.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMoreOpen(false);
                }}
                className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-[#1E3A5F]' : 'text-slate-500'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium whitespace-nowrap">{item.shortLabel}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setMobileMoreOpen((v) => !v)}
            className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
              mobileMoreTabs.some((t) => t.id === activeTab)
                ? 'text-[#1E3A5F]'
                : 'text-slate-500'
            }`}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-medium whitespace-nowrap">Mở rộng</span>
          </button>
        </div>
      </nav>

      {/* Mobile More Bottom Sheet */}
      {mobileMoreOpen && (
        <div
          className="no-print lg:hidden fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px] flex items-end"
          onClick={() => setMobileMoreOpen(false)}
        >
          <div
            className="w-full bg-white rounded-t-2xl border-t border-slate-200 p-4 pb-8 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-900">Chức năng mở rộng</span>
              <button
                type="button"
                onClick={() => setMobileMoreOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {mobileMoreTabs.map((entry) => {
              const Icon = entry.icon;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(entry.id);
                    setMobileMoreOpen(false);
                  }}
                  className="w-full min-h-[48px] px-3 py-2.5 rounded-lg flex items-center justify-between gap-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  <span className="flex items-center gap-3">
                    <Icon className="w-5 h-5 text-[#1E3A5F]" />
                    <span>{entry.label}</span>
                  </span>
                  {entry.id === 'users' && (
                    <span className="text-xs font-mono-tabular text-slate-500">
                      {appUsers.length}
                    </span>
                  )}
                </button>
              );
            })}
            <div className="pt-2 border-t border-slate-100 px-3 text-xs text-slate-500">
              {USER_ROLE_LABELS[access.role]} · {syncStatusText}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {access.permissions.canManageWork && (
        <WorkItemFormModal
          open={workModalOpen}
          ownerId={user.uid}
          initialItem={editingWorkItem}
          defaultDate={newWorkDefaultDate}
          locations={locations}
          contacts={contacts}
          canManageLocations={access.permissions.canManageLocations}
          onClose={() => setWorkModalOpen(false)}
          onSaved={showToast}
        />
      )}

      {canOpenAI && (
        <AIInputModal
          open={aiModalOpen}
          ownerId={user.uid}
          locations={locations}
          contacts={contacts}
          onClose={() => setAiModalOpen(false)}
          onCommitted={showToast}
        />
      )}

      {/* Subtle Bottom Feedback Toast */}
      {toastMsg && (
        <div className="no-print fixed bottom-20 lg:bottom-6 right-4 lg:right-6 z-50 bg-slate-900 text-white text-xs font-medium px-4 py-3 rounded-lg shadow-lg max-w-sm">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
