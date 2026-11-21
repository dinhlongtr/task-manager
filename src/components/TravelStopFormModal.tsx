import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import {
  addMinutesToDateAndTime,
  diffDateTimeMinutes,
  formatDurationVi,
  getStopDepartureDateTime,
  getStopPointLabel,
  minutesToTimeHHMM,
  parseTimeToMinutes,
  SCHEMA_LIMITS,
  TRAVEL_TRANSPORT_LABELS,
  type LocationCategory,
  type LocationRecord,
  type TravelStopRecord,
  type TravelTransportMode,
  type TravelTripRecord,
} from '../types';
import {
  createLocation,
  createTravelStop,
  updateTravelStop,
} from '../services/firestoreService';

interface TravelStopFormModalProps {
  open: boolean;
  ownerId: string;
  trip: TravelTripRecord;
  currentStops: TravelStopRecord[];
  initialStop: TravelStopRecord | null;
  insertAtOrderIndex?: number;
  locations: LocationRecord[];
  canManageLocations: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}

const DURATION_PRESETS = [
  { label: '0p (Quá cảnh)', mins: 0 },
  { label: '30p', mins: 30 },
  { label: '1 giờ', mins: 60 },
  { label: '1g 30p', mins: 90 },
  { label: '2 giờ', mins: 120 },
  { label: '3 giờ', mins: 180 },
  { label: '4 giờ', mins: 240 },
  { label: 'Nghỉ đêm (12g)', mins: 720 },
];

export const TravelStopFormModal: React.FC<TravelStopFormModalProps> = ({
  open,
  ownerId,
  trip,
  currentStops,
  initialStop,
  insertAtOrderIndex,
  locations,
  canManageLocations,
  onClose,
  onSaved,
}) => {
  const [locationId, setLocationId] = useState('');
  const [locationSearch, setLocationSearch] = useState('');
  const [orderIndex, setOrderIndex] = useState(1);
  const [stopDate, setStopDate] = useState(trip.startDate);
  const [arrivalTime, setArrivalTime] = useState('08:00');
  const [activityDurationMinutes, setActivityDurationMinutes] = useState(60);
  const [departureTime, setDepartureTime] = useState('09:00');
  const [transportMode, setTransportMode] = useState<TravelTransportMode>('car');
  const [activityTitle, setActivityTitle] = useState('');
  const [notes, setNotes] = useState('');

  // Quick-add location inline form
  const [showQuickLoc, setShowQuickLoc] = useState(false);
  const [newLocCode, setNewLocCode] = useState('');
  const [newLocName, setNewLocName] = useState('');
  const [newLocAddress, setNewLocAddress] = useState('');
  const [newLocCategory, setNewLocCategory] = useState<LocationCategory>('personal');
  const [creatingLoc, setCreatingLoc] = useState(false);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const sortedStops = useMemo(
    () => [...currentStops].sort((a, b) => a.orderIndex - b.orderIndex),
    [currentStops]
  );

  // Determine the preceding stop for smart defaults & live transit preview
  const previousStop = useMemo(() => {
    const targetIdx = orderIndex - 1;
    if (targetIdx <= 0) return null;
    if (initialStop) {
      const idx = sortedStops.findIndex((s) => s.id === initialStop.id);
      return idx > 0 ? sortedStops[idx - 1] : null;
    }
    return sortedStops[targetIdx - 1] || null;
  }, [orderIndex, initialStop, sortedStops]);

  useEffect(() => {
    if (!open) return;
    setErrorMsg('');
    setShowQuickLoc(false);
    setLocationSearch('');

    if (initialStop) {
      setLocationId(initialStop.locationId);
      setOrderIndex(initialStop.orderIndex);
      setStopDate(initialStop.stopDate);
      setArrivalTime(initialStop.arrivalTime);
      setActivityDurationMinutes(initialStop.activityDurationMinutes);
      setDepartureTime(initialStop.departureTime);
      setTransportMode(initialStop.transportMode);
      setActivityTitle(initialStop.activityTitle);
      setNotes(initialStop.notes);
    } else {
      const targetOrder = insertAtOrderIndex || sortedStops.length + 1;
      setOrderIndex(targetOrder);
      const prev = targetOrder > 1 ? sortedStops[targetOrder - 2] : null;

      if (prev) {
        const prevDep = getStopDepartureDateTime(prev);
        const suggestedArr = addMinutesToDateAndTime(prevDep.date, prevDep.time, 90);
        setStopDate(suggestedArr.date);
        setArrivalTime(suggestedArr.time);
        setActivityDurationMinutes(90);
        setDepartureTime(minutesToTimeHHMM(parseTimeToMinutes(suggestedArr.time) + 90));
        setTransportMode(prev.transportMode || 'car');
      } else {
        setStopDate(trip.startDate);
        setArrivalTime('06:00');
        setActivityDurationMinutes(30);
        setDepartureTime('06:30');
        setTransportMode('car');
      }
      setLocationId(locations[0]?.id || '');
      setActivityTitle('');
      setNotes('');
    }
  }, [open, initialStop, insertAtOrderIndex, sortedStops, trip.startDate, locations]);

  const filteredLocations = useMemo(() => {
    const q = locationSearch.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter((l) =>
      `${l.code} ${l.name} ${l.address}`.toLowerCase().includes(q)
    );
  }, [locations, locationSearch]);

  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === locationId) || null,
    [locations, locationId]
  );

  // Sync departure time whenever arrivalTime or activityDurationMinutes changes
  const handleArrivalChange = (newArrival: string) => {
    setArrivalTime(newArrival);
    const nextDep = minutesToTimeHHMM(
      parseTimeToMinutes(newArrival) + Math.max(0, activityDurationMinutes)
    );
    setDepartureTime(nextDep);
  };

  const handleDurationChange = (mins: number) => {
    const clamped = Math.max(0, Math.min(SCHEMA_LIMITS.travelStop.maxDurationMinutes, Math.round(mins || 0)));
    setActivityDurationMinutes(clamped);
    const nextDep = minutesToTimeHHMM(parseTimeToMinutes(arrivalTime) + clamped);
    setDepartureTime(nextDep);
  };

  const handleDepartureManualChange = (newDep: string) => {
    setDepartureTime(newDep);
    const arrM = parseTimeToMinutes(arrivalTime);
    const depM = parseTimeToMinutes(newDep);
    const diff = depM >= arrM ? depM - arrM : 1440 - arrM + depM;
    setActivityDurationMinutes(diff);
  };

  const handleQuickCreateLocation = async () => {
    if (!newLocCode.trim() || !newLocName.trim() || !newLocAddress.trim()) {
      setErrorMsg('Nhập đủ Mã địa điểm, Tên địa điểm và Địa chỉ để tạo nhanh.');
      return;
    }
    setCreatingLoc(true);
    setErrorMsg('');
    try {
      const createdId = await createLocation(ownerId, {
        code: newLocCode.trim(),
        name: newLocName.trim(),
        address: newLocAddress.trim(),
        category: newLocCategory,
        notes: `Tạo nhanh từ chuyến du lịch ${trip.code}`,
      });
      setLocationId(createdId);
      setNewLocCode('');
      setNewLocName('');
      setNewLocAddress('');
      setShowQuickLoc(false);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể tạo địa điểm mới.');
    } finally {
      setCreatingLoc(false);
    }
  };

  const transitPreview = useMemo(() => {
    if (!previousStop) return null;
    const prevDep = getStopDepartureDateTime(previousStop);
    const mins = diffDateTimeMinutes(prevDep.date, prevDep.time, stopDate, arrivalTime);
    return {
      fromCode: previousStop.locationCode,
      fromDate: prevDep.date,
      fromTime: prevDep.time,
      mins,
    };
  }, [previousStop, stopDate, arrivalTime]);

  const calculatedDepInfo = useMemo(
    () =>
      getStopDepartureDateTime({
        stopDate,
        arrivalTime,
        activityDurationMinutes,
        departureTime,
      }),
    [stopDate, arrivalTime, activityDurationMinutes, departureTime]
  );

  if (!open) return null;

  const pointLetter = getStopPointLabel(Math.max(0, orderIndex - 1));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationId || !selectedLocation) {
      setErrorMsg('Vui lòng chọn một Mã địa điểm hợp lệ từ Bảng Địa điểm.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const payload = {
        orderIndex,
        locationId: selectedLocation.id,
        locationCode: selectedLocation.code,
        stopDate,
        arrivalTime,
        activityDurationMinutes,
        departureTime,
        transportMode,
        activityTitle: activityTitle.trim(),
        notes: notes.trim(),
      };
      if (initialStop) {
        await updateTravelStop(trip.id, initialStop.id, payload, currentStops);
        onSaved(`Đã cập nhật Điểm ${pointLetter} (${selectedLocation.code})`);
      } else {
        await createTravelStop(ownerId, trip.id, payload, currentStops);
        onSaved(`Đã thêm Điểm ${pointLetter} (${selectedLocation.code}) vào chuyến ${trip.code}`);
      }
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể lưu điểm dừng.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {initialStop
                ? `Chỉnh sửa Điểm ${pointLetter} — Chuyến ${trip.code}`
                : `Thêm Điểm ${pointLetter} vào tuyến ${trip.code}`}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Liên kết trực tiếp bằng Mã địa điểm · Tự động tính thời gian di chuyển & rời điểm
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {errorMsg}
            </div>
          )}

          {/* Live Transit Preview from previous stop */}
          {transitPreview && (
            <div
              className={`p-3 rounded-lg border text-xs ${
                transitPreview.mins < 0
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span>
                  Chặng từ{' '}
                  <strong className="font-mono-tabular text-[#1E3A5F]">
                    {transitPreview.fromCode}
                  </strong>{' '}
                  (xuất phát{' '}
                  <span className="font-mono-tabular font-semibold">
                    {transitPreview.fromTime} {transitPreview.fromDate}
                  </span>
                  ) → đến Điểm {pointLetter} lúc{' '}
                  <span className="font-mono-tabular font-semibold">
                    {arrivalTime} {stopDate}
                  </span>
                </span>
                <span className="font-mono-tabular font-semibold">
                  {transitPreview.mins < 0
                    ? `Lệch giờ (${formatDurationVi(transitPreview.mins)})`
                    : `Di chuyển: ${formatDurationVi(transitPreview.mins)}`}
                </span>
              </div>
            </div>
          )}

          {/* Location Link Selector (by Location Code) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-slate-700">
                Liên kết Mã địa điểm (Bảng Địa điểm) *
              </label>
              {canManageLocations && (
                <button
                  type="button"
                  onClick={() => {
                    setShowQuickLoc((v) => !v);
                    if (!newLocCode) {
                      setNewLocCode(`DL-${String(locations.length + 1).padStart(3, '0')}`);
                    }
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#1E3A5F] hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {showQuickLoc ? 'Đóng tạo nhanh' : 'Tạo mã địa điểm mới'}
                </button>
              )}
            </div>

            {showQuickLoc && canManageLocations && (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                <div className="text-xs font-semibold text-slate-800">
                  Thêm địa điểm mới vào Bảng Địa điểm
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    maxLength={SCHEMA_LIMITS.location.codeMax}
                    value={newLocCode}
                    onChange={(e) => setNewLocCode(e.target.value)}
                    placeholder="Mã địa điểm (VD: DL-HN01)"
                    className="min-h-[38px] px-3 py-1.5 text-xs font-mono-tabular bg-white border border-slate-300 rounded-lg"
                  />
                  <select
                    value={newLocCategory}
                    onChange={(e) => setNewLocCategory(e.target.value as LocationCategory)}
                    className="min-h-[38px] px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="personal">Cá nhân / Du lịch</option>
                    <option value="site">Điểm thực địa / Tham quan</option>
                    <option value="client">Khách sạn / Đối tác</option>
                    <option value="office">Văn phòng / Trụ sở</option>
                    <option value="agency">Cơ quan / Sân bay / Bến xe</option>
                  </select>
                </div>
                <input
                  type="text"
                  maxLength={SCHEMA_LIMITS.location.nameMax}
                  value={newLocName}
                  onChange={(e) => setNewLocName(e.target.value)}
                  placeholder="Tên địa điểm (VD: Sân bay Nội Bài / Hồ Xuân Hương)"
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={SCHEMA_LIMITS.location.addressMax}
                    value={newLocAddress}
                    onChange={(e) => setNewLocAddress(e.target.value)}
                    placeholder="Địa chỉ chi tiết..."
                    className="flex-1 min-h-[38px] px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    disabled={creatingLoc}
                    onClick={handleQuickCreateLocation}
                    className="min-h-[38px] px-3.5 py-1.5 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] disabled:opacity-50 whitespace-nowrap"
                  >
                    {creatingLoc ? 'Đang tạo...' : 'Lưu địa điểm'}
                  </button>
                </div>
              </div>
            )}

            {locations.length > 6 && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={locationSearch}
                  onChange={(e) => setLocationSearch(e.target.value)}
                  placeholder="Lọc nhanh theo mã địa điểm hoặc tên..."
                  className="w-full min-h-[38px] pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
                />
              </div>
            )}

            <select
              required
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
            >
              {filteredLocations.length === 0 ? (
                <option value="">Chưa có địa điểm khớp — hãy tạo địa điểm mới</option>
              ) : (
                filteredLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    [{loc.code}] {loc.name} — {loc.address}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Timing & Stay Duration Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Ngày tại điểm *
              </label>
              <input
                type="date"
                required
                value={stopDate}
                onChange={(e) => setStopDate(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {orderIndex === 1 ? 'Giờ tập trung / Có mặt *' : 'Giờ đến điểm này *'}
              </label>
              <input
                type="time"
                required
                value={arrivalTime}
                onChange={(e) => handleArrivalChange(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Giờ xuất phát rời điểm *
              </label>
              <input
                type="time"
                required
                value={departureTime}
                onChange={(e) => handleDepartureManualChange(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
              {calculatedDepInfo.dayOffset > 0 && (
                <div className="text-[11px] font-mono-tabular text-[#1E3A5F] mt-1">
                  Rời điểm ngày {calculatedDepInfo.date} (+{calculatedDepInfo.dayOffset} ngày)
                </div>
              )}
            </div>
          </div>

          {/* Activity Duration with Presets */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-slate-700">
                Thời gian hoạt động / lưu trú tại điểm này (phút)
              </label>
              <span className="text-xs font-mono-tabular font-semibold text-[#1E3A5F]">
                {formatDurationVi(activityDurationMinutes)}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
              <input
                type="number"
                min={0}
                max={SCHEMA_LIMITS.travelStop.maxDurationMinutes}
                step={5}
                value={activityDurationMinutes}
                onChange={(e) => handleDurationChange(Number(e.target.value))}
                className="sm:col-span-4 min-h-[40px] px-3 py-1.5 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
              <div className="sm:col-span-8 flex items-center gap-1.5 flex-wrap">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset.mins}
                    type="button"
                    onClick={() => handleDurationChange(preset.mins)}
                    className={`min-h-[34px] px-2.5 py-1 text-xs rounded-md border transition-colors whitespace-nowrap ${
                      activityDurationMinutes === preset.mins
                        ? 'bg-[#1E3A5F] text-white border-[#1E3A5F]'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Activity Title & Transport to Next Stop */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-8">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Hoạt động chính tại điểm dừng
              </label>
              <input
                type="text"
                maxLength={SCHEMA_LIMITS.travelStop.activityTitleMax}
                value={activityTitle}
                onChange={(e) => setActivityTitle(e.target.value)}
                placeholder="VD: Tham quan đồi cát, ăn trưa hải sản, nhận phòng..."
                className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>

            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Phương tiện rời điểm
              </label>
              <select
                value={transportMode}
                onChange={(e) => setTransportMode(e.target.value as TravelTransportMode)}
                className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              >
                {(Object.keys(TRAVEL_TRANSPORT_LABELS) as TravelTransportMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {TRAVEL_TRANSPORT_LABELS[mode]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Ghi chú chi tiết chặng / điểm dừng
            </label>
            <textarea
              rows={2}
              maxLength={SCHEMA_LIMITS.travelStop.notesMax}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Lưu ý vé tham quan, số chuyến bay/tàu, tuyến đường di chuyển..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
            />
          </div>

          <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving || !locationId}
              className="min-h-[44px] px-5 py-2 text-sm font-medium text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] disabled:opacity-50"
            >
              {saving ? 'Đang lưu...' : initialStop ? 'Cập nhật điểm dừng' : `Lưu Điểm ${pointLetter}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
