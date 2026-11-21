import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  getLocalTodayISO,
  SCHEMA_LIMITS,
  TRAVEL_TRIP_STATUS_LABELS,
  type TravelTripRecord,
  type TravelTripStatus,
} from '../types';
import { createTravelTrip, updateTravelTrip } from '../services/firestoreService';

interface TravelTripFormModalProps {
  open: boolean;
  ownerId: string;
  initialTrip: TravelTripRecord | null;
  existingTripsCount: number;
  onClose: () => void;
  onSaved: (msg: string, createdTripId?: string) => void;
}

export const TravelTripFormModal: React.FC<TravelTripFormModalProps> = ({
  open,
  ownerId,
  initialTrip,
  existingTripsCount,
  onClose,
  onSaved,
}) => {
  const today = getLocalTodayISO();
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [status, setStatus] = useState<TravelTripStatus>('planned');
  const [transportSummary, setTransportSummary] = useState('');
  const [travelers, setTravelers] = useState('');
  const [budgetNote, setBudgetNote] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    setErrorMsg('');
    if (initialTrip) {
      setCode(initialTrip.code);
      setTitle(initialTrip.title);
      setStartDate(initialTrip.startDate);
      setEndDate(initialTrip.endDate);
      setStatus(initialTrip.status);
      setTransportSummary(initialTrip.transportSummary);
      setTravelers(initialTrip.travelers);
      setBudgetNote(initialTrip.budgetNote);
      setNotes(initialTrip.notes);
    } else {
      const year = today.slice(0, 4);
      setCode(`DL-${year}-${String(existingTripsCount + 1).padStart(2, '0')}`);
      setTitle('');
      setStartDate(today);
      setEndDate(today);
      setStatus('planned');
      setTransportSummary('');
      setTravelers('');
      setBudgetNote('');
      setNotes('');
    }
  }, [open, initialTrip, existingTripsCount, today]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !title.trim()) {
      setErrorMsg('Vui lòng nhập đầy đủ Mã chuyến và Tên chuyến du lịch.');
      return;
    }
    if (endDate < startDate) {
      setErrorMsg('Ngày kết thúc không được nhỏ hơn ngày bắt đầu.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const payload = {
        code: code.trim(),
        title: title.trim(),
        startDate,
        endDate,
        status,
        transportSummary: transportSummary.trim(),
        travelers: travelers.trim(),
        budgetNote: budgetNote.trim(),
        notes: notes.trim(),
      };
      if (initialTrip) {
        await updateTravelTrip(initialTrip.id, payload);
        onSaved(`Đã cập nhật chuyến du lịch ${payload.code}`);
      } else {
        const newId = await createTravelTrip(ownerId, payload);
        onSaved(`Đã tạo chuyến du lịch ${payload.code}`, newId);
      }
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể lưu chuyến du lịch.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-0 sm:p-4">
      <div className="w-full sm:max-w-xl bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            {initialTrip ? 'Chỉnh sửa chuyến du lịch' : 'Tạo chuyến du lịch mới'}
          </h2>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Mã chuyến du lịch *
              </label>
              <input
                type="text"
                required
                maxLength={SCHEMA_LIMITS.travelTrip.codeMax}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="VD: DL-2026-01"
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Trạng thái chuyến
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TravelTripStatus)}
                className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              >
                {(Object.keys(TRAVEL_TRIP_STATUS_LABELS) as TravelTripStatus[]).map((st) => (
                  <option key={st} value={st}>
                    {TRAVEL_TRIP_STATUS_LABELS[st]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Tên chuyến du lịch / Hành trình *
            </label>
            <input
              type="text"
              required
              maxLength={SCHEMA_LIMITS.travelTrip.titleMax}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Khám phá Đà Lạt — Nha Trang 3 ngày 2 đêm"
              className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Ngày bắt đầu *
              </label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (endDate < e.target.value) setEndDate(e.target.value);
                }}
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Ngày kết thúc *
              </label>
              <input
                type="date"
                required
                min={startDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Phương tiện chính
              </label>
              <input
                type="text"
                maxLength={SCHEMA_LIMITS.travelTrip.transportSummaryMax}
                value={transportSummary}
                onChange={(e) => setTransportSummary(e.target.value)}
                placeholder="VD: Ô tô 7 chỗ, Máy bay Vietnam Airlines"
                className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Thành viên tham gia
              </label>
              <input
                type="text"
                maxLength={SCHEMA_LIMITS.travelTrip.travelersMax}
                value={travelers}
                onChange={(e) => setTravelers(e.target.value)}
                placeholder="VD: Gia đình 4 người / Nhóm bạn 6 người"
                className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Dự trù kinh phí / Ngân sách
            </label>
            <input
              type="text"
              maxLength={SCHEMA_LIMITS.travelTrip.budgetNoteMax}
              value={budgetNote}
              onChange={(e) => setBudgetNote(e.target.value)}
              placeholder="VD: 12.000.000 VNĐ (đã đặt cọc khách sạn)"
              className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Ghi chú chung & Hành trang cần chuẩn bị
            </label>
            <textarea
              rows={3}
              maxLength={SCHEMA_LIMITS.travelTrip.notesMax}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Giấy tờ tùy thân, mã đặt phòng, lưu ý thời tiết..."
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
              disabled={saving}
              className="min-h-[44px] px-5 py-2 text-sm font-medium text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] disabled:opacity-50"
            >
              {saving ? 'Đang lưu...' : initialTrip ? 'Lưu thay đổi' : 'Tạo chuyến du lịch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
