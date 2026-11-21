import React, { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import {
  getLocalTodayISO,
  LOCATION_CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  WORK_TYPE_LABELS,
  type ContactRecord,
  type LocationCategory,
  type LocationRecord,
  type WorkItemRecord,
  type WorkItemType,
  type WorkPriority,
  type WorkStatus,
} from '../types';
import {
  createLocation,
  createWorkItem,
  updateWorkItem,
} from '../services/firestoreService';

interface WorkItemFormModalProps {
  open: boolean;
  ownerId: string;
  initialItem: WorkItemRecord | null;
  defaultDate?: string;
  locations: LocationRecord[];
  contacts: ContactRecord[];
  canManageLocations?: boolean;
  onClose: () => void;
  onSaved?: (message: string) => void;
}

const REMINDER_OPTIONS = [
  { value: 0, label: 'Không nhắc' },
  { value: 5, label: 'Trước 5 phút' },
  { value: 15, label: 'Trước 15 phút' },
  { value: 30, label: 'Trước 30 phút' },
  { value: 60, label: 'Trước 1 giờ' },
  { value: 1440, label: 'Trước 1 ngày' },
];

export const WorkItemFormModal: React.FC<WorkItemFormModalProps> = ({
  open,
  ownerId,
  initialItem,
  defaultDate,
  locations,
  contacts,
  canManageLocations = true,
  onClose,
  onSaved,
}) => {
  const [itemType, setItemType] = useState<WorkItemType>('task');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [projectName, setProjectName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [contactId, setContactId] = useState('');
  const [scheduledDate, setScheduledDate] = useState(defaultDate || getLocalTodayISO());
  const [startTime, setStartTime] = useState('08:30');
  const [endTime, setEndTime] = useState('09:30');
  const [priority, setPriority] = useState<WorkPriority>('medium');
  const [status, setStatus] = useState<WorkStatus>('pending');
  const [reminderMinutes, setReminderMinutes] = useState<number>(15);
  const [notes, setNotes] = useState('');

  // Quick inline new location creation
  const [showQuickLoc, setShowQuickLoc] = useState(false);
  const [newLocCode, setNewLocCode] = useState('');
  const [newLocName, setNewLocName] = useState('');
  const [newLocAddress, setNewLocAddress] = useState('');
  const [newLocCategory, setNewLocCategory] = useState<LocationCategory>('office');
  const [creatingLoc, setCreatingLoc] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFormError('');
    setShowQuickLoc(false);
    if (initialItem) {
      setItemType(initialItem.itemType);
      setCode(initialItem.code);
      setTitle(initialItem.title);
      setProjectCode(initialItem.projectCode);
      setProjectName(initialItem.projectName);
      setLocationId(initialItem.locationId);
      setContactId(initialItem.contactId);
      setScheduledDate(initialItem.scheduledDate);
      setStartTime(initialItem.startTime);
      setEndTime(initialItem.endTime);
      setPriority(initialItem.priority);
      setStatus(initialItem.status);
      setReminderMinutes(initialItem.reminderMinutes);
      setNotes(initialItem.notes);
    } else {
      const seq = String(Date.now()).slice(-3);
      setItemType('task');
      setCode(`CV-${new Date().getFullYear()}-${seq}`);
      setTitle('');
      setProjectCode('');
      setProjectName('');
      setLocationId(locations[0]?.id || '');
      setContactId('');
      setScheduledDate(defaultDate || getLocalTodayISO());
      setStartTime('08:30');
      setEndTime('09:30');
      setPriority('medium');
      setStatus('pending');
      setReminderMinutes(15);
      setNotes('');
    }
  }, [open, initialItem, defaultDate, locations]);

  if (!open) return null;

  const handleTypeChange = (nextType: WorkItemType) => {
    setItemType(nextType);
    if (!initialItem) {
      const prefix = nextType === 'project' ? 'DA' : nextType === 'invitation' ? 'GM' : 'CV';
      const seq = String(Date.now()).slice(-3);
      setCode(`${prefix}-${new Date().getFullYear()}-${seq}`);
    }
  };

  const handleQuickCreateLocation = async () => {
    if (!newLocName.trim() || !newLocAddress.trim()) {
      setFormError('Vui lòng nhập tên địa điểm và địa chỉ để tạo nhanh.');
      return;
    }
    setCreatingLoc(true);
    setFormError('');
    try {
      const createdId = await createLocation(ownerId, {
        code: newLocCode.trim() || `DD-${String(Date.now()).slice(-3)}`,
        name: newLocName.trim(),
        address: newLocAddress.trim(),
        category: newLocCategory,
        notes: '',
      });
      setLocationId(createdId);
      setShowQuickLoc(false);
      setNewLocCode('');
      setNewLocName('');
      setNewLocAddress('');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Không thể tạo địa điểm mới.');
    } finally {
      setCreatingLoc(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!title.trim()) {
      setFormError('Vui lòng nhập tên công việc / dự án / nội dung giấy mời.');
      return;
    }
    if (!locationId) {
      setFormError('Vui lòng chọn địa điểm liên kết (hoặc bấm "Tạo địa điểm nhanh" bên dưới).');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        itemType,
        code: code.trim(),
        title: title.trim(),
        projectCode: projectCode.trim(),
        projectName: projectName.trim(),
        locationId,
        contactId,
        scheduledDate,
        startTime,
        endTime,
        priority,
        status,
        reminderMinutes,
        reminderDismissed: initialItem ? initialItem.reminderDismissed : false,
        notes: notes.trim(),
      };

      if (initialItem) {
        await updateWorkItem(initialItem.id, payload);
        onSaved?.('Đã cập nhật hạng mục công việc.');
      } else {
        await createWorkItem(ownerId, payload);
        onSaved?.('Đã thêm hạng mục mới và đồng bộ lên đám mây.');
      }
      onClose();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Lỗi khi lưu dữ liệu lên Firestore.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
        <div className="sm:hidden flex justify-center pt-2.5 pb-1">
          <div className="w-10 h-1 bg-slate-300 rounded-full" />
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            {initialItem ? 'Chỉnh sửa hạng mục công việc' : 'Thêm công việc / Dự án / Giấy mời'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto px-5 py-4 space-y-4">
          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {formError}
            </div>
          )}

          {/* Segmented item type selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700">Phân loại hạng mục</label>
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
              {(['task', 'project', 'invitation'] as WorkItemType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTypeChange(t)}
                  className={`min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    itemType === t
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {WORK_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {itemType === 'invitation'
                  ? 'Số giấy mời'
                  : itemType === 'project'
                    ? 'Mã dự án'
                    : 'Mã công việc'}
              </label>
              <input
                type="text"
                required
                maxLength={48}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="VD: GM-128/UBND"
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Tên công việc / Dự án / Nội dung giấy mời
              </label>
              <input
                type="text"
                required
                maxLength={220}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="VD: Họp giao ban triển khai giai đoạn 2..."
                className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>
          </div>

          {/* Relational Location Selector */}
          <div className="space-y-2 p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-semibold text-slate-800">
                Địa điểm thực hiện (Liên kết bảng Địa điểm)
              </label>
              {canManageLocations && (
                <button
                  type="button"
                  onClick={() => setShowQuickLoc((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#1E3A5F] hover:underline whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {showQuickLoc ? 'Ẩn form tạo nhanh' : 'Tạo địa điểm nhanh'}
                </button>
              )}
            </div>

            <select
              required
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
            >
              <option value="">-- Chọn địa điểm từ danh mục --</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  [{loc.code}] {loc.name} — {loc.address}
                </option>
              ))}
            </select>

            {showQuickLoc && (
              <div className="pt-2 space-y-2.5 border-t border-slate-200">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={newLocCode}
                    onChange={(e) => setNewLocCode(e.target.value)}
                    placeholder="Mã (VD: DD-05)"
                    className="min-h-[40px] px-3 py-1.5 text-xs font-mono-tabular bg-white border border-slate-300 rounded-lg"
                  />
                  <input
                    type="text"
                    value={newLocName}
                    onChange={(e) => setNewLocName(e.target.value)}
                    placeholder="Tên địa điểm *"
                    className="sm:col-span-2 min-h-[40px] px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={newLocAddress}
                    onChange={(e) => setNewLocAddress(e.target.value)}
                    placeholder="Địa chỉ chi tiết *"
                    className="sm:col-span-2 min-h-[40px] px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  />
                  <select
                    value={newLocCategory}
                    onChange={(e) => setNewLocCategory(e.target.value as LocationCategory)}
                    className="min-h-[40px] px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  >
                    {(Object.keys(LOCATION_CATEGORY_LABELS) as LocationCategory[]).map((cat) => (
                      <option key={cat} value={cat}>
                        {LOCATION_CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={creatingLoc}
                  onClick={handleQuickCreateLocation}
                  className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] disabled:opacity-50"
                >
                  {creatingLoc ? 'Đang lưu địa điểm...' : 'Lưu & chọn địa điểm này'}
                </button>
              </div>
            )}
          </div>

          {/* Schedule Date & Time */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Ngày thực hiện</label>
              <input
                type="date"
                required
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Giờ bắt đầu</label>
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Giờ kết thúc</label>
              <input
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>
          </div>

          {/* Project Grouping & Contact Relation */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Mã dự án nhóm (Báo cáo)
              </label>
              <input
                type="text"
                maxLength={48}
                value={projectCode}
                onChange={(e) => setProjectCode(e.target.value)}
                placeholder="VD: DA-HTD26"
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Tên dự án liên quan (tùy chọn)
              </label>
              <input
                type="text"
                maxLength={160}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="VD: Dự án Hạ tầng Phía Đông 2026"
                className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Người liên hệ / Khách mời (Danh bạ)
              </label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              >
                <option value="">-- Không liên kết người cụ thể --</option>
                {contacts.map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    [{ct.code}] {ct.fullName} {ct.organization ? `(${ct.organization})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nhắc nhở trước</label>
              <select
                value={reminderMinutes}
                onChange={(e) => setReminderMinutes(Number(e.target.value))}
                className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              >
                {REMINDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Mức ưu tiên</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as WorkPriority)}
                className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              >
                {(Object.keys(PRIORITY_LABELS) as WorkPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Trạng thái</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as WorkStatus)}
                className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              >
                {(Object.keys(STATUS_LABELS) as WorkStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Ghi chú / Thành phần / Tài liệu cần chuẩn bị
            </label>
            <textarea
              rows={3}
              maxLength={1500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú chi tiết nội dung, hồ sơ mang theo..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
            />
          </div>

          <div className="pt-2 pb-1 flex items-center justify-end gap-2.5 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] px-5 py-2 text-sm font-medium text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Đang đồng bộ...' : initialItem ? 'Lưu thay đổi' : 'Lưu hạng mục'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
