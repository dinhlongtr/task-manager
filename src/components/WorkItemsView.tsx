import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  Edit3,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  maskSensitiveAddress,
  PRIORITY_LABELS,
  STATUS_LABELS,
  WORK_TYPE_LABELS,
  type ContactRecord,
  type LocationRecord,
  type WorkItemRecord,
  type WorkItemType,
  type WorkStatus,
} from '../types';
import { deleteWorkItem, quickUpdateWorkItemStatus } from '../services/firestoreService';

interface WorkItemsViewProps {
  currentUserId: string;
  workItems: WorkItemRecord[];
  locations: LocationRecord[];
  locationsMap: Map<string, LocationRecord>;
  contactsMap: Map<string, ContactRecord>;
  privacyMaskEnabled: boolean;
  canManageWork: boolean;
  canUseAI: boolean;
  isManagerOrAdmin: boolean;
  onOpenNew: () => void;
  onEdit: (item: WorkItemRecord) => void;
  onOpenAIInput: () => void;
  onNotify: (msg: string) => void;
}

export const WorkItemsView: React.FC<WorkItemsViewProps> = ({
  currentUserId,
  workItems,
  locations,
  locationsMap,
  contactsMap,
  privacyMaskEnabled,
  canManageWork,
  canUseAI,
  isManagerOrAdmin,
  onOpenNew,
  onEdit,
  onOpenAIInput,
  onNotify,
}) => {
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | WorkItemType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | WorkStatus>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return workItems.filter((item) => {
      if (typeFilter !== 'all' && item.itemType !== typeFilter) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (locationFilter !== 'all' && item.locationId !== locationFilter) return false;
      if (!q) return true;
      const loc = locationsMap.get(item.locationId);
      const ct = item.contactId ? contactsMap.get(item.contactId) : undefined;
      const haystack = [
        item.code,
        item.title,
        item.projectCode,
        item.projectName,
        item.notes,
        loc?.code,
        loc?.name,
        loc?.address,
        ct?.fullName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [workItems, typeFilter, statusFilter, locationFilter, searchText, locationsMap, contactsMap]);

  const handleToggleDone = async (item: WorkItemRecord) => {
    const nextStatus = item.status === 'completed' ? 'pending' : 'completed';
    await quickUpdateWorkItemStatus(item.id, nextStatus, nextStatus === 'completed');
    onNotify(nextStatus === 'completed' ? `Đã hoàn thành ${item.code}` : `Đã mở lại ${item.code}`);
  };

  const handleDelete = async (item: WorkItemRecord) => {
    await deleteWorkItem(item.id);
    setConfirmDeleteId(null);
    onNotify(`Đã xóa hạng mục ${item.code}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Công việc, Dự án & Giấy mời
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Quản lý mã định danh, lịch trình và liên kết trực tiếp với bảng Địa điểm & Danh bạ.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {canUseAI && canManageWork && (
            <button
              type="button"
              onClick={onOpenAIInput}
              className="min-h-[42px] inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4 text-[#1E3A5F]" />
              Nhập bằng AI
            </button>
          )}
          {canManageWork && (
            <button
              type="button"
              onClick={onOpenNew}
              className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Thêm mới
            </button>
          )}
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Interactive Type Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(
              [
                ['all', 'Tất cả'],
                ['task', 'Công việc'],
                ['project', 'Dự án'],
                ['invitation', 'Giấy mời'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setTypeFilter(val)}
                className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  typeFilter === val
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Tìm mã, tên, dự án, địa điểm..."
              className="w-full min-h-[40px] pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-2 border-t border-slate-100">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | WorkStatus)}
            className="min-h-[40px] px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
          >
            <option value="all">Tất cả trạng thái</option>
            {(Object.keys(STATUS_LABELS) as WorkStatus[]).map((s) => (
              <option key={s} value={s}>
                Trạng thái: {STATUS_LABELS[s]}
              </option>
            ))}
          </select>

          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="min-h-[40px] px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
          >
            <option value="all">Tất cả địa điểm ({locations.length})</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                [{loc.code}] {loc.name}
              </option>
            ))}
          </select>

          <div className="flex items-center justify-end text-xs text-slate-500 font-mono-tabular">
            Hiển thị {filtered.length} / {workItems.length} bản ghi
          </div>
        </div>
      </div>

      {/* Empty State */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <p className="text-sm font-medium text-slate-700">
            Không tìm thấy hạng mục công việc nào phù hợp với bộ lọc hiện tại.
          </p>
          {canManageWork && (
            <button
              type="button"
              onClick={onOpenNew}
              className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg"
            >
              <Plus className="w-4 h-4" />
              Tạo công việc đầu tiên
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop High-Density Table */}
          <div className="hidden lg:block bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 pl-4 pr-2 w-10">Xong</th>
                    <th className="py-3 px-3">Mã / Loại</th>
                    <th className="py-3 px-3">Tên hạng mục & Dự án</th>
                    <th className="py-3 px-3">Địa điểm liên kết</th>
                    <th className="py-3 px-3">Thời gian</th>
                    <th className="py-3 px-3">Trạng thái</th>
                    <th className="py-3 pl-3 pr-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filtered.map((item) => {
                    const loc = locationsMap.get(item.locationId);
                    const ct = item.contactId ? contactsMap.get(item.contactId) : undefined;
                    const isDone = item.status === 'completed';

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 pl-4 pr-2 align-top">
                          <button
                            type="button"
                            disabled={!canManageWork}
                            onClick={() => canManageWork && handleToggleDone(item)}
                            className="p-1 text-slate-400 hover:text-[#1E3A5F] disabled:opacity-40 disabled:cursor-not-allowed"
                            aria-label="Chuyển trạng thái hoàn thành"
                          >
                            {isDone ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            ) : (
                              <Circle className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                        <td className="py-3 px-3 align-top whitespace-nowrap">
                          <div className="font-mono-tabular font-semibold text-slate-900 text-xs">
                            {item.code}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {WORK_TYPE_LABELS[item.itemType]}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-top max-w-xs">
                          <div
                            className={`font-medium leading-snug ${
                              isDone ? 'text-slate-400 line-through' : 'text-slate-900'
                            }`}
                          >
                            {item.title}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 space-x-1.5">
                            {item.projectCode && (
                              <span className="font-mono-tabular text-slate-700">
                                {item.projectCode}
                              </span>
                            )}
                            {ct && (
                              <>
                                {item.projectCode && <span aria-hidden="true">·</span>}
                                <span>Liên hệ: {ct.fullName}</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-top max-w-xs">
                          {loc ? (
                            <>
                              <div className="text-xs font-medium text-slate-900">
                                <span className="font-mono-tabular text-[#1E3A5F]">{loc.code}</span>{' '}
                                · {loc.name}
                              </div>
                              <div className="text-xs text-slate-500 truncate mt-0.5">
                                {maskSensitiveAddress(loc.address, privacyMaskEnabled)}
                              </div>
                            </>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 align-top whitespace-nowrap font-mono-tabular text-xs">
                          <div className="text-slate-900 font-medium">{item.scheduledDate}</div>
                          <div className="text-slate-500 mt-0.5">
                            {item.startTime}–{item.endTime}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-top whitespace-nowrap text-xs">
                          <div
                            className={
                              item.status === 'completed'
                                ? 'text-emerald-700 font-medium'
                                : item.status === 'in_progress'
                                  ? 'text-[#1E3A5F] font-medium'
                                  : item.status === 'cancelled'
                                    ? 'text-slate-400'
                                    : 'text-amber-700 font-medium'
                            }
                          >
                            {STATUS_LABELS[item.status]}
                          </div>
                          <div className="text-slate-500 mt-0.5">
                            Ưu tiên {PRIORITY_LABELS[item.priority]}
                          </div>
                        </td>
                        <td className="py-3 pl-3 pr-4 align-top text-right whitespace-nowrap">
                          {canManageWork && (isManagerOrAdmin || item.ownerId === currentUserId) ? (
                            confirmDeleteId === item.id ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleDelete(item)}
                                  className="px-2.5 py-1 text-xs font-semibold text-white bg-red-600 rounded hover:bg-red-700"
                                >
                                  Xóa
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900"
                                >
                                  Hủy
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => onEdit(item)}
                                  aria-label="Sửa"
                                  className="p-2 text-slate-500 hover:text-[#1E3A5F] hover:bg-slate-100 rounded-lg"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(item.id)}
                                  aria-label="Xóa"
                                  className="p-2 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            )
                          ) : (
                            <span className="text-xs text-slate-400">Chỉ xem</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile & Tablet Touch List */}
          <div className="lg:hidden bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {filtered.map((item) => {
              const loc = locationsMap.get(item.locationId);
              const isDone = item.status === 'completed';

              return (
                <div key={item.id} className="p-4 space-y-2.5">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      disabled={!canManageWork}
                      onClick={() => canManageWork && handleToggleDone(item)}
                      className="min-h-[44px] min-w-[44px] -ml-2 -mt-2 flex items-center justify-center text-slate-400 shrink-0 disabled:opacity-40"
                    >
                      {isDone ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      ) : (
                        <Circle className="w-5 h-5" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
                        <span className="font-mono-tabular font-semibold text-slate-900">
                          {item.code}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{WORK_TYPE_LABELS[item.itemType]}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">
                          {item.scheduledDate} {item.startTime}
                        </span>
                      </div>
                      <h3
                        className={`text-sm font-semibold mt-1 ${
                          isDone ? 'text-slate-400 line-through' : 'text-slate-900'
                        }`}
                      >
                        {item.title}
                      </h3>
                      {loc && (
                        <p className="text-xs text-slate-600 mt-1">
                          {loc.code} — {loc.name} ·{' '}
                          {maskSensitiveAddress(loc.address, privacyMaskEnabled)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1 pl-9 text-xs">
                    <span className="text-slate-500">
                      {STATUS_LABELS[item.status]} · Ưu tiên {PRIORITY_LABELS[item.priority]}
                    </span>
                    {canManageWork && (isManagerOrAdmin || item.ownerId === currentUserId) && (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => onEdit(item)}
                          className="min-h-[36px] font-medium text-[#1E3A5F]"
                        >
                          Chỉnh sửa
                        </button>
                        {confirmDeleteId === item.id ? (
                          <button
                            type="button"
                            onClick={() => handleDelete(item)}
                            className="min-h-[36px] font-semibold text-red-700"
                          >
                            Xác nhận xóa
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(item.id)}
                            className="min-h-[36px] text-slate-500 hover:text-red-700"
                          >
                            Xóa
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
