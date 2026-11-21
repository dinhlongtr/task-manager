import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Clock,
  Copy,
  Download,
  Edit3,
  MapPin,
  Plus,
  Printer,
  Route,
  Search,
  Trash2,
} from 'lucide-react';
import {
  diffDateTimeMinutes,
  formatDurationVi,
  getStopDepartureDateTime,
  getStopPointLabel,
  maskSensitiveAddress,
  TRAVEL_TRANSPORT_LABELS,
  TRAVEL_TRIP_STATUS_LABELS,
  type AppTab,
  type LocationRecord,
  type TravelStopRecord,
  type TravelTripRecord,
  type TravelTripStatus,
} from '../types';
import {
  deleteTravelStop,
  deleteTravelTripWithStops,
  duplicateTravelTrip,
  quickUpdateTravelTripStatus,
  reorderTravelStops,
  seedSampleTravelTrip,
  subscribeTravelStops,
} from '../services/firestoreService';
import { TravelTripFormModal } from './TravelTripFormModal';
import { TravelStopFormModal } from './TravelStopFormModal';

interface TravelViewProps {
  ownerId: string;
  trips: TravelTripRecord[];
  locations: LocationRecord[];
  locationsMap: Map<string, LocationRecord>;
  privacyMaskEnabled: boolean;
  canManageWork: boolean;
  canManageLocations: boolean;
  canPrintReports: boolean;
  isManagerOrAdmin: boolean;
  onNavigate: (tab: AppTab) => void;
  onPrintTrip?: (tripId: string) => void;
  onNotify: (msg: string) => void;
}

const STATUS_TEXT_COLOR: Record<TravelTripStatus, string> = {
  planned: 'text-[#1E3A5F]',
  ongoing: 'text-amber-700',
  completed: 'text-emerald-700',
  cancelled: 'text-slate-400',
};

export const TravelView: React.FC<TravelViewProps> = ({
  ownerId,
  trips,
  locations,
  locationsMap,
  privacyMaskEnabled,
  canManageWork,
  canManageLocations,
  canPrintReports,
  isManagerOrAdmin,
  onNavigate,
  onPrintTrip,
  onNotify,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TravelTripStatus>('all');
  const [selectedTripId, setSelectedTripId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'timeline' | 'table'>('timeline');

  const [stops, setStops] = useState<TravelStopRecord[]>([]);
  const [stopsLoading, setStopsLoading] = useState(false);

  // Modals
  const [tripModalOpen, setTripModalOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<TravelTripRecord | null>(null);
  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [editingStop, setEditingStop] = useState<TravelStopRecord | null>(null);
  const [insertAtOrderIndex, setInsertAtOrderIndex] = useState<number | undefined>(undefined);

  const [confirmDeleteTripId, setConfirmDeleteTripId] = useState<string | null>(null);
  const [seedingSample, setSeedingSample] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const filteredTrips = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trips.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (!q) return true;
      return `${t.code} ${t.title} ${t.routePreview} ${t.travelers} ${t.transportSummary}`
        .toLowerCase()
        .includes(q);
    });
  }, [trips, search, statusFilter]);

  const activeTrip = useMemo(() => {
    if (selectedTripId) {
      const found = trips.find((t) => t.id === selectedTripId);
      if (found) return found;
    }
    return filteredTrips[0] || trips[0] || null;
  }, [selectedTripId, trips, filteredTrips]);

  // Real-time subscription to active trip's stops subcollection
  useEffect(() => {
    if (!activeTrip) {
      setStops([]);
      setStopsLoading(false);
      return;
    }
    setStopsLoading(true);
    const unsub = subscribeTravelStops(activeTrip.id, (items) => {
      setStops(items);
      setStopsLoading(false);
    });
    return unsub;
  }, [activeTrip?.id]);

  // Compute legs (A -> B, B -> C, ..., N-1 -> N) and aggregate trip metrics
  const routeAnalytics = useMemo(() => {
    const legs: Array<{
      index: number;
      fromStop: TravelStopRecord;
      toStop: TravelStopRecord;
      fromDepDate: string;
      fromDepTime: string;
      transitMinutes: number;
    }> = [];

    let totalTransitMinutes = 0;
    let totalActivityMinutes = 0;
    let conflictCount = 0;

    stops.forEach((st, idx) => {
      totalActivityMinutes += Math.max(0, st.activityDurationMinutes || 0);
      if (idx < stops.length - 1) {
        const next = stops[idx + 1];
        const dep = getStopDepartureDateTime(st);
        const transitMinutes = diffDateTimeMinutes(
          dep.date,
          dep.time,
          next.stopDate,
          next.arrivalTime
        );
        if (transitMinutes < 0) {
          conflictCount += 1;
        } else {
          totalTransitMinutes += transitMinutes;
        }
        legs.push({
          index: idx + 1,
          fromStop: st,
          toStop: next,
          fromDepDate: dep.date,
          fromDepTime: dep.time,
          transitMinutes,
        });
      }
    });

    return {
      legs,
      totalTransitMinutes,
      totalActivityMinutes,
      conflictCount,
    };
  }, [stops]);

  const canEditActiveTrip = Boolean(
    activeTrip && canManageWork && (isManagerOrAdmin || activeTrip.ownerId === ownerId)
  );

  const openCreateTrip = () => {
    setEditingTrip(null);
    setTripModalOpen(true);
  };

  const openEditTrip = (trip: TravelTripRecord) => {
    setEditingTrip(trip);
    setTripModalOpen(true);
  };

  const openAddStop = (atOrder?: number) => {
    setEditingStop(null);
    setInsertAtOrderIndex(atOrder);
    setStopModalOpen(true);
  };

  const openEditStop = (stop: TravelStopRecord) => {
    setEditingStop(stop);
    setInsertAtOrderIndex(undefined);
    setStopModalOpen(true);
  };

  const handleMoveStop = async (idx: number, direction: -1 | 1) => {
    if (!activeTrip) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= stops.length) return;
    const reordered = [...stops];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(targetIdx, 0, moved);
    await reorderTravelStops(activeTrip.id, reordered);
    onNotify('Đã cập nhật thứ tự tuyến đường.');
  };

  const handleDeleteStop = async (stop: TravelStopRecord) => {
    if (!activeTrip) return;
    await deleteTravelStop(activeTrip.id, stop.id, stops);
    onNotify(`Đã xóa điểm dừng ${stop.locationCode} khỏi chuyến ${activeTrip.code}`);
  };

  const handleDeleteTrip = async (trip: TravelTripRecord) => {
    await deleteTravelTripWithStops(trip.id);
    setConfirmDeleteTripId(null);
    if (selectedTripId === trip.id) setSelectedTripId('');
    onNotify(`Đã xóa chuyến du lịch ${trip.code}`);
  };

  const handleDuplicateTrip = async (trip: TravelTripRecord) => {
    setDuplicating(true);
    try {
      const nextNum = String(trips.length + 1).padStart(2, '0');
      const suggestedCode = `${trip.code}-COPY${nextNum}`;
      const newTripId = await duplicateTravelTrip(ownerId, trip, stops, suggestedCode);
      setSelectedTripId(newTripId);
      onNotify(`Đã nhân bản chuyến ${trip.code} thành ${suggestedCode}`);
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'Không thể nhân bản chuyến đi.');
    } finally {
      setDuplicating(false);
    }
  };

  const handleSeedSample = async () => {
    setSeedingSample(true);
    try {
      const newId = await seedSampleTravelTrip(ownerId, locations, canManageLocations);
      setSelectedTripId(newId);
      onNotify('Đã tạo chuyến du lịch mẫu 4 điểm dừng (A → B → C → D).');
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'Không thể tạo dữ liệu mẫu.');
    } finally {
      setSeedingSample(false);
    }
  };

  const handleExportCsv = () => {
    if (!activeTrip || stops.length === 0) return;
    const headers = [
      'Mã chuyến',
      'Điểm',
      'Thứ tự',
      'Mã địa điểm',
      'Tên địa điểm',
      'Địa chỉ',
      'Ngày',
      'Giờ đến',
      'Thời gian hoạt động (phút)',
      'Giờ xuất phát đi tiếp',
      'Phương tiện chặng tiếp',
      'Di chuyển từ điểm trước (phút)',
      'Hoạt động tại điểm',
      'Ghi chú',
    ];
    const rows = stops.map((st, idx) => {
      const loc = locationsMap.get(st.locationId);
      const incomingLeg = idx > 0 ? routeAnalytics.legs[idx - 1] : null;
      return [
        activeTrip.code,
        `Điểm ${getStopPointLabel(idx)}`,
        st.orderIndex,
        loc?.code || st.locationCode,
        loc?.name || '',
        loc?.address || '',
        st.stopDate,
        st.arrivalTime,
        st.activityDurationMinutes,
        st.departureTime,
        TRAVEL_TRANSPORT_LABELS[st.transportMode],
        incomingLeg ? incomingLeg.transitMinutes : 0,
        st.activityTitle,
        st.notes,
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(',');
    });
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lich-trinh-${activeTrip.code}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Quản lý Lịch trình Du lịch
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Quản lý không giới hạn N chuyến du lịch theo Mã chuyến · Lộ trình nối tiếp Điểm A → B → C → ... → N liên kết bằng Mã địa điểm.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {canManageWork && trips.length === 0 && (
            <button
              type="button"
              disabled={seedingSample}
              onClick={handleSeedSample}
              className="min-h-[42px] inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#1E3A5F] bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <Route className="w-4 h-4" />
              {seedingSample ? 'Đang tạo mẫu...' : 'Tạo chuyến mẫu A→D'}
            </button>
          )}
          {canManageWork && (
            <button
              type="button"
              onClick={openCreateTrip}
              className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Tạo chuyến du lịch
            </button>
          )}
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo mã chuyến, tên chuyến, mã địa điểm..."
            className="w-full min-h-[40px] pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {(['all', 'planned', 'ongoing', 'completed', 'cancelled'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === st
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {st === 'all' ? `Tất cả (${trips.length})` : TRAVEL_TRIP_STATUS_LABELS[st]}
            </button>
          ))}
        </div>
      </div>

      {/* Main 12-Col Master-Detail Workspace */}
      {trips.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
          <div className="mx-auto w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-[#1E3A5F]">
            <Route className="w-5 h-5" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="text-base font-semibold text-slate-900">
              Chưa có chuyến du lịch nào
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Tạo chuyến du lịch đầu tiên với Mã chuyến riêng (VD: DL-2026-01), sau đó nối chuỗi các điểm dừng A → B → C → ... → N bằng Mã địa điểm để theo dõi chính xác giờ xuất phát, giờ đến và thời lượng hoạt động.
            </p>
          </div>
          {canManageWork && (
            <div className="flex items-center justify-center gap-3 flex-wrap pt-1">
              <button
                type="button"
                onClick={openCreateTrip}
                className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49]"
              >
                <Plus className="w-4 h-4" />
                Tạo chuyến đầu tiên
              </button>
              <button
                type="button"
                disabled={seedingSample}
                onClick={handleSeedSample}
                className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
              >
                {seedingSample ? 'Đang tạo mẫu...' : 'Tạo chuyến mẫu 4 điểm'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: N* Travel Trips Selector */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Danh sách chuyến đi
              </h2>
              <span className="text-xs font-mono-tabular text-slate-500">
                {filteredTrips.length} chuyến
              </span>
            </div>

            {filteredTrips.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Không tìm thấy chuyến du lịch phù hợp bộ lọc.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
                {filteredTrips.map((trip) => {
                  const isSelected = activeTrip?.id === trip.id;
                  return (
                    <button
                      key={trip.id}
                      type="button"
                      onClick={() => {
                        setSelectedTripId(trip.id);
                        setConfirmDeleteTripId(null);
                      }}
                      className={`w-full text-left p-4 transition-colors space-y-1.5 ${
                        isSelected
                          ? 'bg-slate-100/90'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono-tabular font-semibold text-[#1E3A5F]">
                          {trip.code}
                        </span>
                        <span className={`font-medium ${STATUS_TEXT_COLOR[trip.status]}`}>
                          {TRAVEL_TRIP_STATUS_LABELS[trip.status]}
                        </span>
                      </div>

                      <div className="text-sm font-semibold text-slate-900 leading-snug">
                        {trip.title}
                      </div>

                      <div className="flex items-center gap-2 text-xs font-mono-tabular text-slate-500 flex-wrap">
                        <span>
                          {trip.startDate === trip.endDate
                            ? trip.startDate
                            : `${trip.startDate} → ${trip.endDate}`}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{trip.stopCount} điểm</span>
                      </div>

                      {trip.routePreview && (
                        <div className="text-[11px] font-mono-tabular text-slate-600 truncate">
                          {trip.routePreview}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Active Trip Details & A -> B -> C -> ... -> N Route */}
          <div className="lg:col-span-8 space-y-4">
            {activeTrip && (
              <>
                {/* Trip Overview Card */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                        <span className="font-mono-tabular font-bold text-[#1E3A5F]">
                          {activeTrip.code}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className={`font-medium ${STATUS_TEXT_COLOR[activeTrip.status]}`}>
                          {TRAVEL_TRIP_STATUS_LABELS[activeTrip.status]}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">
                          {activeTrip.startDate} → {activeTrip.endDate}
                        </span>
                      </div>
                      <h2 className="text-lg font-bold text-slate-900">
                        {activeTrip.title}
                      </h2>
                      {(activeTrip.transportSummary || activeTrip.travelers || activeTrip.budgetNote) && (
                        <div className="text-xs text-slate-600 flex items-center gap-2 flex-wrap">
                          {activeTrip.transportSummary && <span>{activeTrip.transportSummary}</span>}
                          {activeTrip.transportSummary && activeTrip.travelers && (
                            <span aria-hidden="true">·</span>
                          )}
                          {activeTrip.travelers && <span>{activeTrip.travelers}</span>}
                          {(activeTrip.transportSummary || activeTrip.travelers) &&
                            activeTrip.budgetNote && <span aria-hidden="true">·</span>}
                          {activeTrip.budgetNote && <span>{activeTrip.budgetNote}</span>}
                        </div>
                      )}
                      {activeTrip.notes && (
                        <p className="text-xs text-slate-500 pt-0.5 leading-relaxed">
                          {activeTrip.notes}
                        </p>
                      )}
                    </div>

                    {/* Action Controls */}
                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      {canManageWork && (
                        <button
                          type="button"
                          onClick={() => openAddStop()}
                          className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Thêm điểm {getStopPointLabel(stops.length)}
                        </button>
                      )}
                      {canEditActiveTrip && (
                        <button
                          type="button"
                          onClick={() => openEditTrip(activeTrip)}
                          aria-label="Sửa thông tin chuyến"
                          title="Sửa thông tin chuyến"
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      )}
                      {canManageWork && (
                        <button
                          type="button"
                          disabled={duplicating}
                          onClick={() => handleDuplicateTrip(activeTrip)}
                          aria-label="Nhân bản chuyến"
                          title="Nhân bản chuyến du lịch"
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={stops.length === 0}
                        onClick={handleExportCsv}
                        aria-label="Xuất CSV lịch trình"
                        title="Xuất CSV lịch trình"
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      {canPrintReports && (
                        <button
                          type="button"
                          onClick={() => (onPrintTrip ? onPrintTrip(activeTrip.id) : onNavigate('print'))}
                          aria-label="In lịch trình A4 / A3"
                          title="In lịch trình A4 / A3"
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                      )}
                      {canEditActiveTrip && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteTripId(activeTrip.id)}
                          aria-label="Xóa chuyến"
                          title="Xóa chuyến du lịch"
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-500 border border-slate-200 rounded-lg hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {confirmDeleteTripId === activeTrip.id && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-red-900">
                      <span>
                        Xác nhận xóa chuyến{' '}
                        <strong className="font-mono-tabular">{activeTrip.code}</strong> cùng toàn bộ{' '}
                        <strong className="font-mono-tabular">{stops.length}</strong> điểm dừng?
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteTripId(null)}
                          className="px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
                        >
                          Hủy
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTrip(activeTrip)}
                          className="px-3 py-1.5 font-semibold text-white bg-red-700 rounded-md hover:bg-red-800"
                        >
                          Xóa vĩnh viễn
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 4-Column Trip KPI Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-100">
                    <div>
                      <div className="text-[11px] text-slate-500">Tuyến hành trình</div>
                      <div className="text-base font-bold font-mono-tabular text-slate-900 mt-0.5">
                        {stops.length} điểm
                      </div>
                      <div className="text-[11px] font-mono-tabular text-slate-500">
                        {Math.max(0, stops.length - 1)} chặng di chuyển
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Tổng di chuyển</div>
                      <div className="text-base font-bold font-mono-tabular text-[#1E3A5F] mt-0.5">
                        {formatDurationVi(routeAnalytics.totalTransitMinutes)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {routeAnalytics.conflictCount > 0
                          ? `${routeAnalytics.conflictCount} chặng lệch giờ`
                          : 'Nối giờ hợp lệ'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Tổng hoạt động</div>
                      <div className="text-base font-bold font-mono-tabular text-emerald-700 mt-0.5">
                        {formatDurationVi(routeAnalytics.totalActivityMinutes)}
                      </div>
                      <div className="text-[11px] text-slate-500">Tại các điểm dừng</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Trạng thái chuyến</div>
                      {canManageWork ? (
                        <select
                          value={activeTrip.status}
                          onChange={(e) =>
                            quickUpdateTravelTripStatus(
                              activeTrip.id,
                              e.target.value as TravelTripStatus
                            ).then(() => onNotify(`Đã cập nhật trạng thái chuyến ${activeTrip.code}`))
                          }
                          className="mt-1 w-full min-h-[34px] px-2 py-1 text-xs font-medium bg-slate-50 border border-slate-200 rounded-md"
                        >
                          {(Object.keys(TRAVEL_TRIP_STATUS_LABELS) as TravelTripStatus[]).map((st) => (
                            <option key={st} value={st}>
                              {TRAVEL_TRIP_STATUS_LABELS[st]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="text-sm font-semibold text-slate-900 mt-1">
                          {TRAVEL_TRIP_STATUS_LABELS[activeTrip.status]}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Route View Mode Header */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        Lộ trình chi tiết (A → B → C → ... → N)
                      </h3>
                      {stops.length > 0 && (
                        <p className="text-xs font-mono-tabular text-slate-500 mt-0.5">
                          {stops
                            .map((s) => locationsMap.get(s.locationId)?.code || s.locationCode)
                            .join(' → ')}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-auto">
                      <button
                        type="button"
                        onClick={() => setViewMode('timeline')}
                        className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                          viewMode === 'timeline'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Sơ đồ tuyến
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode('table')}
                        className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                          viewMode === 'table'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Bảng giờ chặng
                      </button>
                    </div>
                  </div>

                  {stopsLoading ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      Đang tải các điểm dừng của chuyến {activeTrip.code}...
                    </div>
                  ) : stops.length === 0 ? (
                    <div className="p-10 text-center space-y-3">
                      <p className="text-sm text-slate-600">
                        Chuyến <strong className="font-mono-tabular">{activeTrip.code}</strong> chưa có điểm dừng nào.
                      </p>
                      <p className="text-xs text-slate-500 max-w-md mx-auto">
                        Bắt đầu bằng cách thêm Điểm A (điểm xuất phát), sau đó thêm Điểm B, C... đến Điểm N bằng Mã địa điểm.
                      </p>
                      {canManageWork && (
                        <button
                          type="button"
                          onClick={() => openAddStop(1)}
                          className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49]"
                        >
                          <Plus className="w-4 h-4" />
                          Thêm Điểm A (Xuất phát)
                        </button>
                      )}
                    </div>
                  ) : viewMode === 'timeline' ? (
                    /* Timeline Chain View: Stop A -> Leg 1 -> Stop B -> Leg 2 -> ... -> Stop N */
                    <div className="p-5 space-y-0">
                      {stops.map((stop, idx) => {
                        const loc = locationsMap.get(stop.locationId);
                        const liveCode = loc?.code || stop.locationCode;
                        const pointLabel = getStopPointLabel(idx);
                        const depInfo = getStopDepartureDateTime(stop);
                        const isFirst = idx === 0;
                        const isLast = idx === stops.length - 1;
                        const outgoingLeg = !isLast ? routeAnalytics.legs[idx] : null;
                        const canEditStop = Boolean(
                          canManageWork &&
                            (isManagerOrAdmin ||
                              stop.ownerId === ownerId ||
                              activeTrip.ownerId === ownerId)
                        );

                        return (
                          <div key={stop.id}>
                            {/* Stop Node */}
                            <div className="flex items-start gap-3.5 py-3.5">
                              {/* Sequence Marker */}
                              <div className="flex flex-col items-center shrink-0 pt-0.5">
                                <div
                                  className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono-tabular text-xs font-bold ${
                                    isFirst
                                      ? 'bg-[#1E3A5F] text-white'
                                      : isLast
                                        ? 'bg-emerald-700 text-white'
                                        : 'bg-slate-100 text-slate-900 border border-slate-300'
                                  }`}
                                >
                                  {pointLabel}
                                </div>
                              </div>

                              {/* Stop Content */}
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 space-y-0.5">
                                    <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                                      <span className="font-semibold text-slate-800">
                                        Điểm {pointLabel}
                                        {isFirst
                                          ? ' (Xuất phát)'
                                          : isLast
                                            ? ' (Điểm cuối)'
                                            : ''}
                                      </span>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono-tabular font-semibold text-[#1E3A5F]">
                                        {liveCode}
                                      </span>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono-tabular">{stop.stopDate}</span>
                                    </div>

                                    <h4 className="text-sm font-semibold text-slate-900">
                                      {loc ? loc.name : `Địa điểm (${stop.locationCode})`}
                                    </h4>

                                    {loc && (
                                      <p className="text-xs text-slate-500">
                                        {maskSensitiveAddress(loc.address, privacyMaskEnabled)}
                                      </p>
                                    )}
                                  </div>

                                  {canEditStop && (
                                    <div className="flex items-center gap-0.5 shrink-0">
                                      <button
                                        type="button"
                                        disabled={isFirst}
                                        onClick={() => handleMoveStop(idx, -1)}
                                        aria-label="Đưa lên trước"
                                        title="Đưa lên trước"
                                        className="min-h-[34px] min-w-[34px] flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-md disabled:opacity-25"
                                      >
                                        <ArrowUp className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isLast}
                                        onClick={() => handleMoveStop(idx, 1)}
                                        aria-label="Đưa xuống sau"
                                        title="Đưa xuống sau"
                                        className="min-h-[34px] min-w-[34px] flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-md disabled:opacity-25"
                                      >
                                        <ArrowDown className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openEditStop(stop)}
                                        aria-label="Sửa điểm dừng"
                                        title="Sửa điểm dừng"
                                        className="min-h-[34px] min-w-[34px] flex items-center justify-center text-slate-500 hover:text-[#1E3A5F] hover:bg-slate-100 rounded-md"
                                      >
                                        <Edit3 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteStop(stop)}
                                        aria-label="Xóa điểm dừng"
                                        title="Xóa điểm dừng"
                                        className="min-h-[34px] min-w-[34px] flex items-center justify-center text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* Timing Metrics Row */}
                                <div className="flex items-center gap-3 text-xs font-mono-tabular text-slate-700 flex-wrap pt-1">
                                  <span>
                                    {isFirst ? 'Tập trung:' : 'Đến:'}{' '}
                                    <strong className="text-slate-900">{stop.arrivalTime}</strong>
                                  </span>
                                  <span aria-hidden="true" className="text-slate-300">
                                    |
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-emerald-800">
                                    <Clock className="w-3.5 h-3.5 text-emerald-700" />
                                    Hoạt động:{' '}
                                    <strong>{formatDurationVi(stop.activityDurationMinutes)}</strong>
                                  </span>
                                  <span aria-hidden="true" className="text-slate-300">
                                    |
                                  </span>
                                  <span>
                                    {isLast ? 'Kết thúc:' : `Xuất phát đi ${getStopPointLabel(idx + 1)}:`}{' '}
                                    <strong className="text-[#1E3A5F]">
                                      {stop.departureTime}
                                      {depInfo.dayOffset > 0 ? ` (+${depInfo.dayOffset}ng)` : ''}
                                    </strong>
                                  </span>
                                </div>

                                {stop.activityTitle && (
                                  <div className="text-xs font-medium text-slate-800 pt-0.5">
                                    {stop.activityTitle}
                                  </div>
                                )}
                                {stop.notes && (
                                  <p className="text-xs text-slate-500 leading-relaxed">
                                    {stop.notes}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Transit Leg Connector between Stop i and Stop i+1 */}
                            {outgoingLeg && (
                              <div className="ml-4 pl-6 py-2.5 border-l border-dashed border-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs flex-wrap">
                                  <span className="font-semibold text-slate-700">
                                    Chặng {outgoingLeg.index}:
                                  </span>
                                  <span className="font-mono-tabular text-[#1E3A5F] font-semibold">
                                    {liveCode}
                                  </span>
                                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                                  <span className="font-mono-tabular text-[#1E3A5F] font-semibold">
                                    {locationsMap.get(outgoingLeg.toStop.locationId)?.code ||
                                      outgoingLeg.toStop.locationCode}
                                  </span>
                                  <span aria-hidden="true" className="text-slate-300">
                                    ·
                                  </span>
                                  <span className="font-mono-tabular text-slate-600">
                                    {outgoingLeg.fromDepTime} → {outgoingLeg.toStop.arrivalTime}
                                  </span>
                                  <span aria-hidden="true" className="text-slate-300">
                                    ·
                                  </span>
                                  {outgoingLeg.transitMinutes < 0 ? (
                                    <span className="inline-flex items-center gap-1 font-medium text-red-700">
                                      <AlertTriangle className="w-3.5 h-3.5" />
                                      Giờ đến sớm hơn giờ xuất phát (
                                      {formatDurationVi(outgoingLeg.transitMinutes)})
                                    </span>
                                  ) : (
                                    <span className="font-mono-tabular font-semibold text-slate-900">
                                      Di chuyển {formatDurationVi(outgoingLeg.transitMinutes)}
                                    </span>
                                  )}
                                  <span aria-hidden="true" className="text-slate-300">
                                    ·
                                  </span>
                                  <span className="text-slate-600">
                                    {TRAVEL_TRANSPORT_LABELS[stop.transportMode]}
                                  </span>
                                </div>

                                {canManageWork && (
                                  <button
                                    type="button"
                                    onClick={() => openAddStop(idx + 2)}
                                    className="text-[11px] font-medium text-[#1E3A5F] hover:underline self-start sm:self-auto whitespace-nowrap"
                                  >
                                    + Chèn điểm giữa chặng
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Quick Append Next Point Button */}
                      {canManageWork && (
                        <div className="pt-4 mt-2 border-t border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                          <span className="text-xs text-slate-500">
                            Nối tiếp hành trình từ Điểm {getStopPointLabel(stops.length - 1)} sang Điểm{' '}
                            {getStopPointLabel(stops.length)}
                          </span>
                          <button
                            type="button"
                            onClick={() => openAddStop(stops.length + 1)}
                            className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#1E3A5F] bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 whitespace-nowrap"
                          >
                            <Plus className="w-4 h-4" />
                            Thêm Điểm {getStopPointLabel(stops.length)} tiếp theo
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* High-Density Tabular Timetable View */
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                            <th className="py-2.5 px-3">Điểm</th>
                            <th className="py-2.5 px-3">Mã & Địa điểm</th>
                            <th className="py-2.5 px-3">Ngày</th>
                            <th className="py-2.5 px-3">Giờ đến</th>
                            <th className="py-2.5 px-3">Di chuyển đến</th>
                            <th className="py-2.5 px-3">Hoạt động tại điểm</th>
                            <th className="py-2.5 px-3">Xuất phát đi tiếp</th>
                            {canManageWork && <th className="py-2.5 px-3 text-right">Thao tác</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {stops.map((stop, idx) => {
                            const loc = locationsMap.get(stop.locationId);
                            const liveCode = loc?.code || stop.locationCode;
                            const incomingLeg = idx > 0 ? routeAnalytics.legs[idx - 1] : null;
                            const depInfo = getStopDepartureDateTime(stop);
                            const canEditStop = Boolean(
                              canManageWork &&
                                (isManagerOrAdmin ||
                                  stop.ownerId === ownerId ||
                                  activeTrip.ownerId === ownerId)
                            );
                            return (
                              <tr key={stop.id} className="hover:bg-slate-50/80 align-top">
                                <td className="py-2.5 px-3 font-mono-tabular font-bold text-slate-900 whitespace-nowrap">
                                  {getStopPointLabel(idx)}
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="font-mono-tabular font-semibold text-[#1E3A5F]">
                                    {liveCode}
                                  </div>
                                  <div className="font-medium text-slate-900">
                                    {loc?.name || stop.locationCode}
                                  </div>
                                  {stop.activityTitle && (
                                    <div className="text-slate-500 mt-0.5">{stop.activityTitle}</div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 font-mono-tabular whitespace-nowrap text-slate-700">
                                  {stop.stopDate}
                                </td>
                                <td className="py-2.5 px-3 font-mono-tabular font-semibold text-slate-900 whitespace-nowrap">
                                  {stop.arrivalTime}
                                </td>
                                <td className="py-2.5 px-3 font-mono-tabular whitespace-nowrap">
                                  {incomingLeg ? (
                                    <span
                                      className={
                                        incomingLeg.transitMinutes < 0
                                          ? 'text-red-700 font-semibold'
                                          : 'text-slate-700'
                                      }
                                    >
                                      {formatDurationVi(incomingLeg.transitMinutes)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">Xuất phát</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 font-mono-tabular text-emerald-700 font-medium whitespace-nowrap">
                                  {formatDurationVi(stop.activityDurationMinutes)}
                                </td>
                                <td className="py-2.5 px-3 font-mono-tabular whitespace-nowrap">
                                  <span className="font-semibold text-[#1E3A5F]">
                                    {stop.departureTime}
                                  </span>
                                  {depInfo.dayOffset > 0 && (
                                    <span className="text-slate-500"> (+{depInfo.dayOffset}ng)</span>
                                  )}
                                  {idx < stops.length - 1 && (
                                    <div className="font-sans text-[11px] text-slate-500">
                                      {TRAVEL_TRANSPORT_LABELS[stop.transportMode]}
                                    </div>
                                  )}
                                </td>
                                {canManageWork && (
                                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                    {canEditStop && (
                                      <div className="inline-flex items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => openEditStop(stop)}
                                          className="p-1.5 text-slate-500 hover:text-[#1E3A5F]"
                                          aria-label="Sửa"
                                        >
                                          <Edit3 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteStop(stop)}
                                          className="p-1.5 text-slate-400 hover:text-red-700"
                                          aria-label="Xóa"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Location directory shortcut footer */}
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500 px-1">
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    Các điểm dừng được liên kết sống theo Mã địa điểm trong Bảng Địa điểm ({locations.length} địa điểm).
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigate('locations')}
                    className="font-medium text-[#1E3A5F] hover:underline whitespace-nowrap"
                  >
                    Mở Bảng Địa điểm
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Trip Create / Edit Modal */}
      {canManageWork && (
        <TravelTripFormModal
          open={tripModalOpen}
          ownerId={ownerId}
          initialTrip={editingTrip}
          existingTripsCount={trips.length}
          onClose={() => setTripModalOpen(false)}
          onSaved={(msg, createdId) => {
            onNotify(msg);
            if (createdId) setSelectedTripId(createdId);
          }}
        />
      )}

      {/* Stop Create / Edit Modal */}
      {canManageWork && activeTrip && (
        <TravelStopFormModal
          open={stopModalOpen}
          ownerId={ownerId}
          trip={activeTrip}
          currentStops={stops}
          initialStop={editingStop}
          insertAtOrderIndex={insertAtOrderIndex}
          locations={locations}
          canManageLocations={canManageLocations}
          onClose={() => setStopModalOpen(false)}
          onSaved={onNotify}
        />
      )}
    </div>
  );
};
