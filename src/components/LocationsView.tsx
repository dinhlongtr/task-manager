import React, { useMemo, useState } from 'react';
import { Edit3, MapPin, Plus, Search, Trash2, X } from 'lucide-react';
import {
  LOCATION_CATEGORY_LABELS,
  maskSensitiveAddress,
  STATUS_LABELS,
  TRAVEL_TRIP_STATUS_LABELS,
  type ContactRecord,
  type LocationCategory,
  type LocationRecord,
  type TravelTripRecord,
  type WorkItemRecord,
} from '../types';
import {
  createLocation,
  deleteLocation,
  updateLocation,
} from '../services/firestoreService';

interface LocationsViewProps {
  ownerId: string;
  locations: LocationRecord[];
  workItems: WorkItemRecord[];
  contacts: ContactRecord[];
  travelTrips?: TravelTripRecord[];
  privacyMaskEnabled: boolean;
  canManageLocations: boolean;
  isManagerOrAdmin: boolean;
  onNotify: (msg: string) => void;
}

export const LocationsView: React.FC<LocationsViewProps> = ({
  ownerId,
  locations,
  workItems,
  contacts,
  travelTrips = [],
  privacyMaskEnabled,
  canManageLocations,
  isManagerOrAdmin,
  onNotify,
}) => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | LocationCategory>('all');
  const [selectedLocId, setSelectedLocId] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLoc, setEditingLoc] = useState<LocationRecord | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [category, setCategory] = useState<LocationCategory>('office');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [deleteWarningId, setDeleteWarningId] = useState<string | null>(null);

  const relationCounts = useMemo(() => {
    const workCounts = new Map<string, number>();
    const contactCounts = new Map<string, number>();
    const tripCountsByCode = new Map<string, number>();

    for (const w of workItems) {
      workCounts.set(w.locationId, (workCounts.get(w.locationId) || 0) + 1);
    }
    for (const c of contacts) {
      if (c.locationId) {
        contactCounts.set(c.locationId, (contactCounts.get(c.locationId) || 0) + 1);
      }
    }
    for (const t of travelTrips) {
      const codesInRoute = new Set(
        (t.routePreview || '')
          .split('→')
          .map((token) => token.trim())
          .filter(Boolean)
      );
      codesInRoute.forEach((codeToken) => {
        tripCountsByCode.set(codeToken, (tripCountsByCode.get(codeToken) || 0) + 1);
      });
    }
    return { workCounts, contactCounts, tripCountsByCode };
  }, [workItems, contacts, travelTrips]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return locations.filter((l) => {
      if (categoryFilter !== 'all' && l.category !== categoryFilter) return false;
      if (!q) return true;
      return `${l.code} ${l.name} ${l.address} ${l.notes}`.toLowerCase().includes(q);
    });
  }, [locations, search, categoryFilter]);

  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === selectedLocId) || null,
    [locations, selectedLocId]
  );

  const linkedWorkItems = useMemo(
    () => (selectedLocation ? workItems.filter((w) => w.locationId === selectedLocation.id) : []),
    [workItems, selectedLocation]
  );

  const linkedTravelTrips = useMemo(() => {
    if (!selectedLocation) return [];
    const targetCode = selectedLocation.code.trim();
    return travelTrips.filter((t) =>
      (t.routePreview || '')
        .split('→')
        .map((token) => token.trim())
        .includes(targetCode)
    );
  }, [travelTrips, selectedLocation]);

  const openCreate = () => {
    setEditingLoc(null);
    setCode(`DD-${String(locations.length + 1).padStart(3, '0')}`);
    setName('');
    setAddress('');
    setCategory('office');
    setNotes('');
    setErrorMsg('');
    setModalOpen(true);
  };

  const openEdit = (loc: LocationRecord) => {
    setEditingLoc(loc);
    setCode(loc.code);
    setName(loc.name);
    setAddress(loc.address);
    setCategory(loc.category);
    setNotes(loc.notes);
    setErrorMsg('');
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim() || !address.trim()) {
      setErrorMsg('Vui lòng nhập đầy đủ Mã địa điểm, Tên địa điểm và Địa chỉ.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const payload = {
        code: code.trim(),
        name: name.trim(),
        address: address.trim(),
        category,
        notes: notes.trim(),
      };
      if (editingLoc) {
        await updateLocation(editingLoc.id, payload);
        onNotify(`Đã cập nhật địa điểm ${payload.code}`);
      } else {
        await createLocation(ownerId, payload);
        onNotify(`Đã thêm địa điểm mới ${payload.code}`);
      }
      setModalOpen(false);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể lưu địa điểm.');
    } finally {
      setSaving(false);
    }
  };

  const handleAttemptDelete = async (loc: LocationRecord) => {
    const linkedCount =
      (relationCounts.workCounts.get(loc.id) || 0) +
      (relationCounts.contactCounts.get(loc.id) || 0) +
      (relationCounts.tripCountsByCode.get(loc.code.trim()) || 0);
    if (linkedCount > 0) {
      setDeleteWarningId(loc.id);
      return;
    }
    await deleteLocation(loc.id);
    if (selectedLocId === loc.id) setSelectedLocId(null);
    onNotify(`Đã xóa địa điểm ${loc.code}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Bảng quản lý Địa điểm
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Bảng dữ liệu độc lập lưu Mã địa điểm, Tên địa điểm, Địa chỉ — liên kết quan hệ với Công việc, Lịch trình Du lịch, Giấy mời và Danh bạ.
          </p>
        </div>
        {canManageLocations && (
          <button
            type="button"
            onClick={openCreate}
            className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Thêm địa điểm
          </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo mã, tên địa điểm hoặc địa chỉ..."
            className="w-full min-h-[40px] pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as 'all' | LocationCategory)}
          className="min-h-[40px] px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
        >
          <option value="all">Tất cả phân loại ({locations.length})</option>
          {(Object.keys(LOCATION_CATEGORY_LABELS) as LocationCategory[]).map((cat) => (
            <option key={cat} value={cat}>
              {LOCATION_CATEGORY_LABELS[cat]}
            </option>
          ))}
        </select>
      </div>

      {/* Relational Master-Detail Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm text-slate-600">Chưa có địa điểm nào trong danh mục.</p>
              {canManageLocations && (
                <button
                  type="button"
                  onClick={openCreate}
                  className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg"
                >
                  <Plus className="w-4 h-4" />
                  Thêm địa điểm đầu tiên
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filtered.map((loc) => {
                const wCount = relationCounts.workCounts.get(loc.id) || 0;
                const cCount = relationCounts.contactCounts.get(loc.id) || 0;
                const tCount = relationCounts.tripCountsByCode.get(loc.code.trim()) || 0;
                const isSelected = selectedLocId === loc.id;

                return (
                  <div
                    key={loc.id}
                    className={`p-4 transition-colors ${
                      isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedLocId(loc.id)}
                        className="flex-1 min-w-0 text-left space-y-1"
                      >
                        <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                          <span className="font-mono-tabular font-semibold text-[#1E3A5F]">
                            {loc.code}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{LOCATION_CATEGORY_LABELS[loc.category]}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular">
                            {wCount} công việc / {tCount} chuyến du lịch / {cCount} liên hệ
                          </span>
                        </div>
                        <h3 className="text-sm font-semibold text-slate-900">{loc.name}</h3>
                        <p className="text-xs text-slate-600">
                          {maskSensitiveAddress(loc.address, privacyMaskEnabled)}
                        </p>
                        {loc.notes && <p className="text-xs text-slate-500">{loc.notes}</p>}
                      </button>

                      {canManageLocations && (isManagerOrAdmin || loc.ownerId === ownerId) && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEdit(loc)}
                            aria-label="Sửa địa điểm"
                            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-[#1E3A5F] hover:bg-slate-100 rounded-lg"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAttemptDelete(loc)}
                            aria-label="Xóa địa điểm"
                            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    {deleteWarningId === loc.id && (
                      <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between gap-3 text-xs text-amber-900">
                        <span>
                          Không thể xóa <strong className="font-mono-tabular">{loc.code}</strong> vì đang được liên kết với{' '}
                          <strong className="font-mono-tabular">{wCount}</strong> công việc,{' '}
                          <strong className="font-mono-tabular">{tCount}</strong> chuyến du lịch và{' '}
                          <strong className="font-mono-tabular">{cCount}</strong> liên hệ. Hãy chuyển các bản ghi sang địa điểm khác trước.
                        </span>
                        <button
                          type="button"
                          onClick={() => setDeleteWarningId(null)}
                          className="font-semibold underline shrink-0"
                        >
                          Đóng
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Relational Detail Panel */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 pb-2.5 border-b border-slate-200">
            <MapPin className="w-4 h-4 text-[#1E3A5F]" />
            <h2 className="text-sm font-semibold text-slate-900">Lịch trình tại địa điểm</h2>
          </div>

          {!selectedLocation ? (
            <p className="text-xs text-slate-500 leading-relaxed">
              Chọn một địa điểm ở danh sách bên trái để xem toàn bộ công việc, dự án và giấy mời đang liên kết tại đó.
            </p>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="text-xs font-mono-tabular font-semibold text-[#1E3A5F]">
                  {selectedLocation.code}
                </div>
                <div className="text-sm font-semibold text-slate-900 mt-0.5">
                  {selectedLocation.name}
                </div>
                <div className="text-xs text-slate-600 mt-0.5">
                  {maskSensitiveAddress(selectedLocation.address, privacyMaskEnabled)}
                </div>
              </div>

              {linkedWorkItems.length === 0 ? (
                <p className="text-xs text-slate-500 pt-2 border-t border-slate-100">
                  Chưa có hạng mục công việc nào gắn với địa điểm này.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {linkedWorkItems.map((w) => (
                    <div key={w.id} className="py-2.5 space-y-0.5">
                      <div className="flex items-center justify-between text-xs font-mono-tabular text-slate-500">
                        <span className="font-semibold text-slate-800">{w.code}</span>
                        <span>
                          {w.scheduledDate} · {w.startTime}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-slate-900">{w.title}</p>
                      <p className="text-[11px] text-slate-500">{STATUS_LABELS[w.status]}</p>
                    </div>
                  ))}
                </div>
              )}

              {linkedTravelTrips.length > 0 && (
                <div className="pt-3 border-t border-slate-200 space-y-2">
                  <div className="text-xs font-semibold text-slate-700">
                    Chuyến du lịch đi qua mã {selectedLocation.code} ({linkedTravelTrips.length})
                  </div>
                  <div className="divide-y divide-slate-100">
                    {linkedTravelTrips.map((trip) => (
                      <div key={trip.id} className="py-2 space-y-0.5">
                        <div className="flex items-center justify-between text-xs font-mono-tabular text-slate-500">
                          <span className="font-semibold text-[#1E3A5F]">{trip.code}</span>
                          <span>{trip.startDate}</span>
                        </div>
                        <p className="text-xs font-medium text-slate-900">{trip.title}</p>
                        <p className="text-[11px] text-slate-500">
                          {TRAVEL_TRIP_STATUS_LABELS[trip.status]} · {trip.stopCount} điểm
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Location Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-0 sm:p-4">
          <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">
                {editingLoc ? 'Chỉnh sửa địa điểm' : 'Thêm địa điểm mới'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  {errorMsg}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Mã địa điểm *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={32}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="VD: DD-VP01"
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Phân loại</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as LocationCategory)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
                  >
                    {(Object.keys(LOCATION_CATEGORY_LABELS) as LocationCategory[]).map((cat) => (
                      <option key={cat} value={cat}>
                        {LOCATION_CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Tên địa điểm *
                </label>
                <input
                  type="text"
                  required
                  maxLength={160}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="VD: Trụ sở UBND Quận 1"
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Địa chỉ chi tiết *
                </label>
                <input
                  type="text"
                  required
                  maxLength={300}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành..."
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ghi chú chỉ đường / phòng họp
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Tầng, số phòng, chỗ gửi xe..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
                />
              </div>
              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] px-5 py-2 text-sm font-medium text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] disabled:opacity-50"
                >
                  {saving ? 'Đang lưu...' : editingLoc ? 'Cập nhật' : 'Lưu địa điểm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
