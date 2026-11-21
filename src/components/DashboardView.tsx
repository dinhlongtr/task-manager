import React, { useMemo, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  Circle,
  Clock,
  MapPin,
  Plus,
  Printer,
  Sparkles,
  User as UserIcon,
  Database,
} from 'lucide-react';
import {
  getLocalTodayISO,
  maskSensitiveAddress,
  PRIORITY_LABELS,
  STATUS_LABELS,
  WORK_TYPE_LABELS,
  type AppTab,
  type ContactRecord,
  type LocationRecord,
  type WorkItemRecord,
} from '../types';
import type { ActiveReminder } from '../hooks/useReminders';
import {
  dismissWorkItemReminder,
  quickUpdateWorkItemStatus,
  seedStarterPersonalData,
} from '../services/firestoreService';

interface DashboardViewProps {
  ownerId: string;
  now: Date;
  workItems: WorkItemRecord[];
  locations: LocationRecord[];
  contacts: ContactRecord[];
  locationsMap: Map<string, LocationRecord>;
  contactsMap: Map<string, ContactRecord>;
  activeReminders: ActiveReminder[];
  privacyMaskEnabled: boolean;
  canManageWork: boolean;
  canUseAI: boolean;
  canPrintReports: boolean;
  isAdmin: boolean;
  isManagerOrAdmin: boolean;
  onSnoozeReminder: (id: string) => void;
  onOpenNewWorkItem: (date?: string) => void;
  onEditWorkItem: (item: WorkItemRecord) => void;
  onOpenAIInput: () => void;
  onNavigate: (tab: AppTab) => void;
  onNotify: (msg: string) => void;
}

const WEEKDAYS_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function formatDateFullVi(d: Date): string {
  const days = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${days[d.getDay()]}, ngày ${day}/${month}/${d.getFullYear()}`;
}

function priorityTextClass(priority: WorkItemRecord['priority']): string {
  if (priority === 'urgent') return 'text-red-700 font-semibold';
  if (priority === 'high') return 'text-amber-700 font-medium';
  if (priority === 'medium') return 'text-slate-600';
  return 'text-slate-500';
}

function statusTextClass(status: WorkItemRecord['status']): string {
  if (status === 'completed') return 'text-emerald-700 font-medium';
  if (status === 'in_progress') return 'text-[#1E3A5F] font-medium';
  if (status === 'cancelled') return 'text-slate-400 line-through';
  return 'text-amber-700 font-medium';
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  ownerId,
  now,
  workItems,
  locations,
  locationsMap,
  contactsMap,
  activeReminders,
  privacyMaskEnabled,
  canManageWork,
  canUseAI,
  canPrintReports,
  isAdmin,
  isManagerOrAdmin,
  onSnoozeReminder,
  onOpenNewWorkItem,
  onEditWorkItem,
  onOpenAIInput,
  onNavigate,
  onNotify,
}) => {
  const todayIso = getLocalTodayISO();
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [seeding, setSeeding] = useState(false);

  // Horizontal 10-day date strip around today (-2 to +7 days)
  const dateStrip = useMemo(() => {
    const arr: { iso: string; weekday: string; dayNum: string; isToday: boolean }[] = [];
    const base = new Date();
    for (let offset = -2; offset <= 7; offset++) {
      const dt = new Date(base);
      dt.setDate(base.getDate() + offset);
      const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
        dt.getDate()
      ).padStart(2, '0')}`;
      arr.push({
        iso,
        weekday: WEEKDAYS_VI[dt.getDay()],
        dayNum: String(dt.getDate()).padStart(2, '0'),
        isToday: iso === todayIso,
      });
    }
    return arr;
  }, [todayIso]);

  const currentMonthPrefix = todayIso.slice(0, 7);

  const metrics = useMemo(() => {
    const todayItems = workItems.filter((w) => w.scheduledDate === todayIso);
    const activeItems = workItems.filter((w) => w.status === 'pending' || w.status === 'in_progress');
    const monthItems = workItems.filter((w) => w.scheduledDate.startsWith(currentMonthPrefix));
    const monthCompleted = monthItems.filter((w) => w.status === 'completed').length;
    const monthRate = monthItems.length > 0 ? Math.round((monthCompleted / monthItems.length) * 100) : 0;

    return {
      todayTotal: todayItems.length,
      todayDone: todayItems.filter((w) => w.status === 'completed').length,
      activeTotal: activeItems.length,
      remindersCount: activeReminders.length,
      monthCompleted,
      monthTotal: monthItems.length,
      monthRate,
    };
  }, [workItems, todayIso, currentMonthPrefix, activeReminders.length]);

  const selectedDayItems = useMemo(
    () => workItems.filter((w) => w.scheduledDate === selectedDate),
    [workItems, selectedDate]
  );

  const upcomingInvitations = useMemo(
    () =>
      workItems
        .filter(
          (w) =>
            w.itemType === 'invitation' &&
            w.status !== 'completed' &&
            w.status !== 'cancelled' &&
            w.scheduledDate >= todayIso
        )
        .slice(0, 5),
    [workItems, todayIso]
  );

  const activeProjectsSummary = useMemo(() => {
    const map = new Map<string, { code: string; name: string; total: number; done: number }>();
    for (const w of workItems) {
      const pCode = w.projectCode || (w.itemType === 'project' ? w.code : '');
      if (!pCode) continue;
      const existing = map.get(pCode) || {
        code: pCode,
        name: w.projectName || w.title,
        total: 0,
        done: 0,
      };
      existing.total += 1;
      if (w.status === 'completed') existing.done += 1;
      map.set(pCode, existing);
    }
    return Array.from(map.values()).slice(0, 5);
  }, [workItems]);

  const handleToggleDone = async (item: WorkItemRecord) => {
    const nextStatus = item.status === 'completed' ? 'pending' : 'completed';
    await quickUpdateWorkItemStatus(item.id, nextStatus, nextStatus === 'completed');
    onNotify(nextStatus === 'completed' ? `Đã hoàn thành [${item.code}]` : `Đã mở lại [${item.code}]`);
  };

  const handleSeedStarter = async () => {
    setSeeding(true);
    try {
      await seedStarterPersonalData(ownerId);
      onNotify('Đã khởi tạo dữ liệu mẫu cá nhân thành công.');
    } finally {
      setSeeding(false);
    }
  };

  const liveTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return (
    <div className="space-y-6">
      {/* Header Row with Live Clock */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <p className="text-xs font-medium text-slate-500">{formatDateFullVi(now)}</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-0.5">
            Bảng điều khiển lịch trình
          </h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="px-3.5 py-2 bg-white border border-slate-200 rounded-lg flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-[#1E3A5F]" />
            <span className="font-mono-tabular font-semibold text-slate-900">{liveTimeStr}</span>
          </div>
          {canUseAI && canManageWork && (
            <button
              type="button"
              onClick={onOpenAIInput}
              className="min-h-[42px] inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4 text-[#1E3A5F]" />
              Nhập nhanh bằng AI
            </button>
          )}
          {canManageWork && (
            <button
              type="button"
              onClick={() => onOpenNewWorkItem(selectedDate)}
              className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Thêm lịch trình
            </button>
          )}
        </div>
      </div>

      {/* Empty Workspace Onboarding Bar */}
      {isAdmin && workItems.length === 0 && locations.length === 0 && (
        <div className="p-5 bg-white border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900">
              Không gian làm việc đã sẵn sàng đồng bộ trên đám mây
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
              Bạn có thể bắt đầu bằng cách nhập lịch trình từ văn bản hoặc ảnh giấy mời bằng AI, tạo địa điểm mới, hoặc nạp nhanh bộ dữ liệu mẫu để trải nghiệm báo cáo và in ấn A4/A3.
            </p>
          </div>
          <button
            type="button"
            disabled={seeding}
            onClick={handleSeedStarter}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Database className="w-4 h-4" />
            {seeding ? 'Đang khởi tạo...' : 'Nạp dữ liệu mẫu nhanh'}
          </button>
        </div>
      )}

      {/* Active Real-Time Reminders Panel */}
      {activeReminders.length > 0 && (
        <section aria-label="Thông báo nhắc nhở sắp tới" className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-amber-900">
              <BellRing className="w-4 h-4 shrink-0" />
              <h2 className="text-sm font-semibold">
                Nhắc nhở lịch trình ({activeReminders.length})
              </h2>
            </div>
            <span className="text-xs text-amber-800">Tự động cập nhật thời gian thực</span>
          </div>

          <div className="divide-y divide-amber-200/70">
            {activeReminders.map((rem) => {
              const timingLabel =
                rem.minutesUntilStart > 0
                  ? `Còn ${rem.minutesUntilStart} phút`
                  : rem.minutesUntilStart === 0
                    ? 'Đang đến giờ'
                    : `Quá giờ ${Math.abs(rem.minutesUntilStart)} phút`;
              return (
                <div
                  key={rem.item.id}
                  className="py-2.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-amber-900 flex-wrap">
                      <span className="font-mono-tabular font-semibold">{rem.item.startTime}</span>
                      <span aria-hidden="true">·</span>
                      <span className={rem.minutesUntilStart < 0 ? 'text-red-700 font-semibold' : 'font-medium'}>
                        {timingLabel}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">{rem.item.code}</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-900 truncate mt-0.5">{rem.item.title}</p>
                    <p className="text-xs text-slate-600 truncate">{rem.locationName}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canManageWork && (
                      <button
                        type="button"
                        onClick={() => handleToggleDone(rem.item)}
                        className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] whitespace-nowrap"
                      >
                        Hoàn thành
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onSnoozeReminder(rem.item.id)}
                      className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded-lg hover:bg-amber-50 whitespace-nowrap"
                    >
                      Báo lại 10p
                    </button>
                    {canManageWork && (
                      <button
                        type="button"
                        onClick={() => dismissWorkItemReminder(rem.item.id)}
                        className="min-h-[38px] px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 whitespace-nowrap"
                      >
                        Đã xem
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 4-Column Executive KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Lịch hôm nay</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono-tabular text-slate-900">
              {metrics.todayTotal}
            </span>
            <span className="text-xs text-slate-500 font-mono-tabular">
              / {metrics.todayDone} xong
            </span>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Đang mở / Cần làm</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono-tabular text-[#1E3A5F]">
              {metrics.activeTotal}
            </span>
            <span className="text-xs text-slate-500">hạng mục</span>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Nhắc nhở hiện hành</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold font-mono-tabular ${
                metrics.remindersCount > 0 ? 'text-amber-700' : 'text-slate-900'
              }`}
            >
              {metrics.remindersCount}
            </span>
            <span className="text-xs text-slate-500">thông báo</span>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Hiệu suất tháng này</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono-tabular text-emerald-700">
              {metrics.monthRate}%
            </span>
            <span className="text-xs text-slate-500 font-mono-tabular">
              ({metrics.monthCompleted}/{metrics.monthTotal})
            </span>
          </div>
        </div>
      </div>

      {/* Main 2-Column Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 cols: Date Scroller + Selected Day Schedule */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-slate-200 space-y-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Lịch trình theo ngày
                </h2>
                <p className="text-xs text-slate-500 font-mono-tabular mt-0.5">
                  Ngày đang chọn: {selectedDate} · {selectedDayItems.length} hạng mục
                </p>
              </div>
              {canPrintReports && (
                <button
                  type="button"
                  onClick={() => onNavigate('print')}
                  className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5" />
                  In lịch
                </button>
              )}
            </div>

            {/* Mobile-Friendly Horizontal Date Scroller */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {dateStrip.map((d) => {
                const count = workItems.filter((w) => w.scheduledDate === d.iso).length;
                const active = selectedDate === d.iso;
                return (
                  <button
                    key={d.iso}
                    type="button"
                    onClick={() => setSelectedDate(d.iso)}
                    className={`min-w-[56px] min-h-[58px] px-2.5 py-2 rounded-lg flex flex-col items-center justify-center transition-colors shrink-0 ${
                      active
                        ? 'bg-[#1E3A5F] text-white'
                        : d.isToday
                          ? 'bg-slate-100 text-slate-900 border border-slate-300'
                          : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span className={`text-[11px] ${active ? 'text-slate-200' : 'text-slate-500'}`}>
                      {d.isToday ? 'Hôm nay' : d.weekday}
                    </span>
                    <span className="text-sm font-bold font-mono-tabular mt-0.5">{d.dayNum}</span>
                    <span className={`text-[10px] font-mono-tabular ${active ? 'text-slate-300' : 'text-slate-400'}`}>
                      {count > 0 ? `${count} việc` : '—'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedDayItems.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm font-medium text-slate-700">
                Chưa có công việc hoặc lịch hẹn nào cho ngày {selectedDate}.
              </p>
              {canManageWork && (
                <button
                  type="button"
                  onClick={() => onOpenNewWorkItem(selectedDate)}
                  className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49]"
                >
                  <Plus className="w-4 h-4" />
                  Tạo lịch trình cho ngày này
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {selectedDayItems.map((item) => {
                const loc = locationsMap.get(item.locationId);
                const ct = item.contactId ? contactsMap.get(item.contactId) : undefined;
                const isDone = item.status === 'completed';
                const canEditThis = canManageWork && (isManagerOrAdmin || item.ownerId === ownerId);

                return (
                  <div
                    key={item.id}
                    className="px-4 sm:px-5 py-4 flex items-start gap-3.5 hover:bg-slate-50/70 transition-colors"
                  >
                    <button
                      type="button"
                      disabled={!canManageWork}
                      onClick={() => canManageWork && handleToggleDone(item)}
                      aria-label={isDone ? 'Đánh dấu chưa hoàn thành' : 'Đánh dấu hoàn thành'}
                      className="min-h-[44px] min-w-[44px] -ml-2 -mt-2 flex items-center justify-center text-slate-400 hover:text-[#1E3A5F] shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isDone ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      ) : (
                        <Circle className="w-5 h-5" />
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={!canEditThis}
                      onClick={() => canEditThis && onEditWorkItem(item)}
                      className="flex-1 min-w-0 text-left space-y-1.5 disabled:cursor-default"
                    >
                      <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                        <span className="font-mono-tabular font-semibold text-slate-900">
                          {item.startTime}–{item.endTime}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular text-slate-700">{item.code}</span>
                        <span aria-hidden="true">·</span>
                        <span>{WORK_TYPE_LABELS[item.itemType]}</span>
                        <span aria-hidden="true">·</span>
                        <span className={priorityTextClass(item.priority)}>
                          Ưu tiên {PRIORITY_LABELS[item.priority]}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className={statusTextClass(item.status)}>
                          {STATUS_LABELS[item.status]}
                        </span>
                      </div>

                      <h3
                        className={`text-sm sm:text-base font-semibold leading-snug ${
                          isDone ? 'text-slate-400 line-through' : 'text-slate-900'
                        }`}
                      >
                        {item.title}
                      </h3>

                      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1.5 min-w-0">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate">
                            {loc
                              ? `${loc.code} — ${loc.name} (${maskSensitiveAddress(
                                  loc.address,
                                  privacyMaskEnabled
                                )})`
                              : 'Địa điểm không tồn tại'}
                          </span>
                        </span>
                        {ct && (
                          <span className="inline-flex items-center gap-1.5 shrink-0">
                            <UserIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{ct.fullName}</span>
                          </span>
                        )}
                      </div>

                      {item.projectCode && (
                        <div className="text-xs text-slate-500">
                          Dự án: <span className="font-mono-tabular text-slate-700">{item.projectCode}</span>
                          {item.projectName ? ` — ${item.projectName}` : ''}
                        </div>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 4 cols: Upcoming Invitations & Project Progress */}
        <div className="lg:col-span-4 space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Giấy mời sắp tới</h2>
              <button
                type="button"
                onClick={() => onNavigate('work')}
                className="text-xs font-medium text-[#1E3A5F] hover:underline"
              >
                Xem tất cả
              </button>
            </div>
            {upcomingInvitations.length === 0 ? (
              <div className="p-4 text-xs text-slate-500">Không có giấy mời chưa thực hiện.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {upcomingInvitations.map((inv) => {
                  const loc = locationsMap.get(inv.locationId);
                  const canEditInv = canManageWork && (isManagerOrAdmin || inv.ownerId === ownerId);
                  return (
                    <button
                      key={inv.id}
                      type="button"
                      disabled={!canEditInv}
                      onClick={() => canEditInv && onEditWorkItem(inv)}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors space-y-1 disabled:cursor-default"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500 font-mono-tabular">
                        <span className="font-semibold text-[#1E3A5F]">{inv.code}</span>
                        <span>
                          {inv.scheduledDate} · {inv.startTime}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-slate-900 line-clamp-2">{inv.title}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {loc ? `${loc.code} · ${loc.name}` : 'Chưa rõ địa điểm'}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Tiến độ theo dự án</h2>
              {canPrintReports && (
                <button
                  type="button"
                  onClick={() => onNavigate('reports')}
                  className="text-xs font-medium text-[#1E3A5F] hover:underline"
                >
                  Báo cáo chi tiết
                </button>
              )}
            </div>
            {activeProjectsSummary.length === 0 ? (
              <div className="p-4 text-xs text-slate-500">
                Gán mã dự án cho công việc để theo dõi tiến độ tự động tại đây.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {activeProjectsSummary.map((proj) => {
                  const pct = proj.total > 0 ? Math.round((proj.done / proj.total) * 100) : 0;
                  return (
                    <div key={proj.code} className="px-4 py-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono-tabular font-semibold text-slate-800">
                          {proj.code}
                        </span>
                        <span className="font-mono-tabular text-slate-600">
                          {proj.done}/{proj.total} ({pct}%)
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 truncate">{proj.name}</p>
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#1E3A5F] rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
