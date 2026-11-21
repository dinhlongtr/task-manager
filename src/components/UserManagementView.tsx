import React, { useMemo, useState } from 'react';
import {
  Edit3,
  Lock,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Unlock,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { OWNER_EMAIL } from '../firebase';
import {
  DEFAULT_ROLE_PERMISSIONS,
  isValidEmailAddress,
  normalizeEmailKey,
  USER_ROLE_DESCRIPTIONS,
  USER_ROLE_LABELS,
  USER_STATUS_LABELS,
  type AppUserRecord,
  type UserPermissions,
  type UserRole,
  type UserStatus,
} from '../types';
import {
  createAppUser,
  deleteAppUser,
  updateAppUser,
} from '../services/firestoreService';

interface UserManagementViewProps {
  currentAdminUid: string;
  currentAdminEmail: string;
  isSuperAdmin: boolean;
  appUsers: AppUserRecord[];
  onNotify: (msg: string) => void;
}

const PERMISSION_META: Array<{
  key: keyof UserPermissions;
  label: string;
  description: string;
}> = [
  {
    key: 'canManageWork',
    label: 'Quản lý Công việc, Dự án & Giấy mời',
    description: 'Thêm, sửa, cập nhật trạng thái và xóa hạng mục lịch trình theo phạm vi vai trò.',
  },
  {
    key: 'canManageLocations',
    label: 'Quản lý Bảng Địa điểm',
    description: 'Thêm, sửa, xóa danh mục mã địa điểm, tên địa điểm và địa chỉ.',
  },
  {
    key: 'canViewContacts',
    label: 'Xem Danh bạ khách hàng & người thân (PII)',
    description: 'Cho phép truy cập danh sách số điện thoại, email và quan hệ riêng tư.',
  },
  {
    key: 'canManageContacts',
    label: 'Thêm / Sửa / Xóa Danh bạ (PII)',
    description: 'Yêu cầu bật quyền Xem Danh bạ trước khi cho phép chỉnh sửa danh bạ.',
  },
  {
    key: 'canUseAI',
    label: 'Sử dụng Nhập liệu & Phân tích AI',
    description: 'Cho phép trích xuất lịch trình/giấy mời từ văn bản, ảnh và tóm tắt báo cáo bằng AI.',
  },
  {
    key: 'canPrintReports',
    label: 'Xem Báo cáo tự động & In lịch A4 / A3',
    description: 'Cho phép xem biểu đồ thống kê theo tháng/dự án và in ấn lịch trình.',
  },
];

function summarizePermissions(u: AppUserRecord): string {
  if (u.role === 'admin') return 'Toàn quyền hệ thống & Quản trị người dùng';
  const list: string[] = [];
  if (u.canManageWork) list.push('Công việc');
  if (u.canManageLocations) list.push('Địa điểm');
  if (u.canManageContacts) list.push('Sửa danh bạ');
  else if (u.canViewContacts) list.push('Xem danh bạ');
  if (u.canUseAI) list.push('AI');
  if (u.canPrintReports) list.push('Báo cáo & In');
  return list.length > 0 ? list.join(' · ') : 'Chỉ xem lịch trình cơ bản';
}

function formatLastLogin(iso: string): string {
  if (!iso) return 'Chưa đăng nhập lần đầu';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${dt.getFullYear()} ${hh}:${mi}`;
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({
  currentAdminUid,
  currentAdminEmail,
  isSuperAdmin,
  appUsers,
  onNotify,
}) => {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | UserStatus>('all');
  const [confirmDeleteEmail, setConfirmDeleteEmail] = useState<string | null>(null);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUserRecord | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [department, setDepartment] = useState('');
  const [role, setRole] = useState<UserRole>('staff');
  const [status, setStatus] = useState<UserStatus>('active');
  const [notes, setNotes] = useState('');
  const [permissions, setPermissions] = useState<UserPermissions>({
    ...DEFAULT_ROLE_PERMISSIONS.staff,
  });
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const metrics = useMemo(() => {
    const total = appUsers.length;
    const active = appUsers.filter((u) => u.status === 'active').length;
    const adminsAndManagers = appUsers.filter(
      (u) => u.role === 'admin' || u.role === 'manager'
    ).length;
    const suspended = appUsers.filter((u) => u.status === 'suspended').length;
    return { total, active, adminsAndManagers, suspended };
  }, [appUsers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return appUsers.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      if (!q) return true;
      return `${u.displayName} ${u.email} ${u.department} ${u.notes}`
        .toLowerCase()
        .includes(q);
    });
  }, [appUsers, search, roleFilter, statusFilter]);

  const openCreateModal = () => {
    setEditingUser(null);
    setEmail('');
    setDisplayName('');
    setDepartment('');
    setRole('staff');
    setStatus('active');
    setNotes('');
    setPermissions({ ...DEFAULT_ROLE_PERMISSIONS.staff });
    setErrorMsg('');
    setModalOpen(true);
  };

  const openEditModal = (target: AppUserRecord) => {
    setEditingUser(target);
    setEmail(target.email);
    setDisplayName(target.displayName);
    setDepartment(target.department);
    setRole(target.role);
    setStatus(target.status);
    setNotes(target.notes);
    setPermissions({
      canManageWork: target.canManageWork,
      canManageLocations: target.canManageLocations,
      canViewContacts: target.canViewContacts,
      canManageContacts: target.canManageContacts,
      canUseAI: target.canUseAI,
      canPrintReports: target.canPrintReports,
    });
    setErrorMsg('');
    setModalOpen(true);
  };

  const handleRoleChange = (nextRole: UserRole) => {
    setRole(nextRole);
    setPermissions({ ...DEFAULT_ROLE_PERMISSIONS[nextRole] });
  };

  const handlePermissionToggle = (key: keyof UserPermissions, checked: boolean) => {
    setPermissions((prev) => {
      const next = { ...prev, [key]: checked };
      if (key === 'canManageContacts' && checked) {
        next.canViewContacts = true;
      }
      if (key === 'canViewContacts' && !checked) {
        next.canManageContacts = false;
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const normalizedEmail = normalizeEmailKey(email);
    if (!editingUser && !isValidEmailAddress(normalizedEmail)) {
      setErrorMsg('Vui lòng nhập đúng định dạng địa chỉ email Google của người dùng.');
      return;
    }
    if (!displayName.trim()) {
      setErrorMsg('Vui lòng nhập họ tên hiển thị của người dùng.');
      return;
    }

    setSaving(true);
    try {
      if (editingUser) {
        await updateAppUser(editingUser.email, {
          displayName: displayName.trim(),
          role,
          status,
          department: department.trim(),
          notes: notes.trim(),
          ...permissions,
        });
        onNotify(`Đã cập nhật phân quyền cho ${editingUser.email}`);
      } else {
        await createAppUser(currentAdminUid, {
          email: normalizedEmail,
          displayName: displayName.trim(),
          role,
          status,
          department: department.trim(),
          notes: notes.trim(),
          ...permissions,
        });
        onNotify(`Đã thêm người dùng ${normalizedEmail} (${USER_ROLE_LABELS[role]})`);
      }
      setModalOpen(false);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể lưu thông tin người dùng.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSuspend = async (target: AppUserRecord) => {
    if (target.email === OWNER_EMAIL) return;
    const nextStatus: UserStatus = target.status === 'active' ? 'suspended' : 'active';
    setBusyEmail(target.email);
    try {
      await updateAppUser(target.email, {
        displayName: target.displayName,
        role: target.role,
        status: nextStatus,
        department: target.department,
        notes: target.notes,
        canManageWork: target.canManageWork,
        canManageLocations: target.canManageLocations,
        canViewContacts: target.canViewContacts,
        canManageContacts: target.canManageContacts,
        canUseAI: target.canUseAI,
        canPrintReports: target.canPrintReports,
      });
      onNotify(
        nextStatus === 'suspended'
          ? `Đã tạm khóa tài khoản ${target.email}`
          : `Đã kích hoạt lại tài khoản ${target.email}`
      );
    } finally {
      setBusyEmail(null);
    }
  };

  const handleDelete = async (target: AppUserRecord) => {
    if (target.email === OWNER_EMAIL) return;
    setBusyEmail(target.email);
    try {
      await deleteAppUser(target.email);
      setConfirmDeleteEmail(null);
      onNotify(`Đã xóa tài khoản ${target.email} khỏi hệ thống`);
    } finally {
      setBusyEmail(null);
    }
  };

  const editingIsSuperAdmin = editingUser?.email === OWNER_EMAIL;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Quản lý Người dùng & Phân quyền
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Thêm tài khoản Google được phép truy cập, gán vai trò và tùy chỉnh quyền chi tiết theo thời gian thực.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] whitespace-nowrap"
        >
          <UserPlus className="w-4 h-4" />
          Thêm người dùng
        </button>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Tổng tài khoản</div>
          <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-slate-900">
            {metrics.total}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Đang hoạt động</div>
          <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-emerald-700">
            {metrics.active}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Quản trị & Quản lý</div>
          <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-[#1E3A5F]">
            {metrics.adminsAndManagers}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Đang tạm khóa</div>
          <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-amber-700">
            {metrics.suspended}
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(
              [
                ['all', 'Tất cả'],
                ['admin', 'Quản trị viên'],
                ['manager', 'Quản lý'],
                ['staff', 'Nhân viên'],
                ['viewer', 'Chỉ xem'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setRoleFilter(val)}
                className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  roleFilter === val
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 md:justify-end">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | UserStatus)}
              className="min-h-[40px] px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
            >
              <option value="all">Mọi trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="suspended">Đang tạm khóa</option>
            </select>

            <div className="relative flex-1 max-w-xs">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm tên, email, phòng ban..."
                className="w-full min-h-[40px] pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Onboarding Note */}
      <div className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl flex items-start gap-2.5 text-xs text-slate-600">
        <ShieldCheck className="w-4 h-4 text-[#1E3A5F] shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          Chỉ những email Google có trong danh sách này và ở trạng thái <strong className="text-slate-900">Đang hoạt động</strong> mới được phép đăng nhập và truy xuất dữ liệu trên Cloud Firestore. Khi bạn khóa hoặc xóa tài khoản, quyền truy cập bị thu hồi ngay lập tức.
        </p>
      </div>

      {/* User Directory */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <p className="text-sm text-slate-600">Không tìm thấy người dùng nào phù hợp bộ lọc.</p>
          <button
            type="button"
            onClick={openCreateModal}
            className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg"
          >
            <Plus className="w-4 h-4" />
            Thêm người dùng mới
          </button>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden lg:block bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 pl-4 pr-3">Người dùng & Email</th>
                    <th className="py-3 px-3">Vai trò</th>
                    <th className="py-3 px-3">Phạm vi quyền</th>
                    <th className="py-3 px-3">Trạng thái</th>
                    <th className="py-3 px-3">Đăng nhập gần nhất</th>
                    <th className="py-3 pl-3 pr-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filtered.map((u) => {
                    const isOwner = u.email === OWNER_EMAIL;
                    const isSelf = u.email === normalizeEmailKey(currentAdminEmail);
                    const canModifyTarget = !isOwner || isSuperAdmin;
                    const canDeleteOrSuspend = !isOwner && !isSelf;

                    return (
                      <tr key={u.email} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 pl-4 pr-3 align-top">
                          <div className="font-semibold text-slate-900 flex items-center gap-1.5 flex-wrap">
                            <span>{u.displayName}</span>
                            {isOwner && (
                              <span className="text-[11px] font-medium text-[#1E3A5F]">
                                · Quản trị gốc
                              </span>
                            )}
                            {isSelf && !isOwner && (
                              <span className="text-[11px] font-medium text-slate-500">
                                · Bạn
                              </span>
                            )}
                          </div>
                          <div className="text-xs font-mono-tabular text-slate-600 mt-0.5">
                            {u.email}
                          </div>
                          {u.department && (
                            <div className="text-xs text-slate-500 mt-0.5">{u.department}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-3 align-top whitespace-nowrap">
                          <div
                            className={`text-xs font-semibold ${
                              u.role === 'admin'
                                ? 'text-[#1E3A5F]'
                                : u.role === 'manager'
                                  ? 'text-slate-900'
                                  : 'text-slate-700'
                            }`}
                          >
                            {USER_ROLE_LABELS[u.role]}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 align-top max-w-xs">
                          <p className="text-xs text-slate-700 leading-relaxed">
                            {summarizePermissions(u)}
                          </p>
                          {u.notes && (
                            <p className="text-[11px] text-slate-500 mt-0.5 truncate">{u.notes}</p>
                          )}
                        </td>
                        <td className="py-3.5 px-3 align-top whitespace-nowrap text-xs">
                          <span
                            className={
                              u.status === 'active'
                                ? 'text-emerald-700 font-medium'
                                : 'text-red-700 font-medium'
                            }
                          >
                            {USER_STATUS_LABELS[u.status]}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 align-top whitespace-nowrap text-xs font-mono-tabular text-slate-600">
                          {formatLastLogin(u.lastLoginIso)}
                        </td>
                        <td className="py-3.5 pl-3 pr-4 align-top text-right whitespace-nowrap">
                          {confirmDeleteEmail === u.email ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={busyEmail === u.email}
                                onClick={() => handleDelete(u)}
                                className="px-2.5 py-1 text-xs font-semibold text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50"
                              >
                                Xóa
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteEmail(null)}
                                className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900"
                              >
                                Hủy
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1">
                              {canModifyTarget && (
                                <button
                                  type="button"
                                  onClick={() => openEditModal(u)}
                                  aria-label="Sửa & phân quyền"
                                  title="Sửa & phân quyền"
                                  className="p-2 text-slate-500 hover:text-[#1E3A5F] hover:bg-slate-100 rounded-lg"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                              )}
                              {canDeleteOrSuspend && (
                                <>
                                  <button
                                    type="button"
                                    disabled={busyEmail === u.email}
                                    onClick={() => handleToggleSuspend(u)}
                                    aria-label={u.status === 'active' ? 'Tạm khóa tài khoản' : 'Mở khóa tài khoản'}
                                    title={u.status === 'active' ? 'Tạm khóa tài khoản' : 'Mở khóa tài khoản'}
                                    className="p-2 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg disabled:opacity-40"
                                  >
                                    {u.status === 'active' ? (
                                      <Lock className="w-4 h-4" />
                                    ) : (
                                      <Unlock className="w-4 h-4 text-emerald-700" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteEmail(u.email)}
                                    aria-label="Xóa tài khoản"
                                    title="Xóa tài khoản"
                                    className="p-2 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Cards */}
          <div className="lg:hidden bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {filtered.map((u) => {
              const isOwner = u.email === OWNER_EMAIL;
              const isSelf = u.email === normalizeEmailKey(currentAdminEmail);
              const canModifyTarget = !isOwner || isSuperAdmin;
              const canDeleteOrSuspend = !isOwner && !isSelf;

              return (
                <div key={u.email} className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">
                        {u.displayName}
                        {isOwner && (
                          <span className="text-xs font-medium text-[#1E3A5F]"> · Quản trị gốc</span>
                        )}
                      </div>
                      <div className="text-xs font-mono-tabular text-slate-600 truncate mt-0.5">
                        {u.email}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-medium shrink-0 ${
                        u.status === 'active' ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {USER_STATUS_LABELS[u.status]}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1">
                    <div>
                      Vai trò: <strong className="text-slate-900">{USER_ROLE_LABELS[u.role]}</strong>
                      {u.department ? ` · ${u.department}` : ''}
                    </div>
                    <div className="text-slate-500">{summarizePermissions(u)}</div>
                    <div className="text-[11px] font-mono-tabular text-slate-500">
                      Đăng nhập gần nhất: {formatLastLogin(u.lastLoginIso)}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-3 text-xs">
                    {canModifyTarget && (
                      <button
                        type="button"
                        onClick={() => openEditModal(u)}
                        className="min-h-[38px] font-medium text-[#1E3A5F]"
                      >
                        Sửa & Phân quyền
                      </button>
                    )}
                    {canDeleteOrSuspend && (
                      <>
                        <button
                          type="button"
                          disabled={busyEmail === u.email}
                          onClick={() => handleToggleSuspend(u)}
                          className="min-h-[38px] font-medium text-amber-800"
                        >
                          {u.status === 'active' ? 'Tạm khóa' : 'Mở khóa'}
                        </button>
                        {confirmDeleteEmail === u.email ? (
                          <button
                            type="button"
                            disabled={busyEmail === u.email}
                            onClick={() => handleDelete(u)}
                            className="min-h-[38px] font-semibold text-red-700"
                          >
                            Xác nhận xóa
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteEmail(u.email)}
                            className="min-h-[38px] text-slate-500 hover:text-red-700"
                          >
                            Xóa
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Add / Edit User & Role Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-0 sm:p-4">
          <div className="w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-[#1E3A5F]" />
                <h2 className="text-base font-semibold text-slate-900">
                  {editingUser ? 'Chỉnh sửa & Phân quyền người dùng' : 'Thêm người dùng mới qua Admin'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-5">
              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  {errorMsg}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email tài khoản Google *
                  </label>
                  <input
                    type="email"
                    required
                    disabled={Boolean(editingUser)}
                    maxLength={160}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nhanvien@gmail.com"
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F] disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Họ và tên hiển thị *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="VD: Nguyễn Văn Minh"
                    className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Vai trò phân quyền
                  </label>
                  <select
                    value={role}
                    disabled={editingIsSuperAdmin}
                    onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
                  >
                    {(Object.keys(USER_ROLE_LABELS) as UserRole[]).map((r) => (
                      <option key={r} value={r}>
                        {USER_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Trạng thái tài khoản
                  </label>
                  <select
                    value={status}
                    disabled={editingIsSuperAdmin}
                    onChange={(e) => setStatus(e.target.value as UserStatus)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
                  >
                    <option value="active">Đang hoạt động</option>
                    <option value="suspended">Tạm khóa (Chặn truy cập)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Phòng ban / Nhóm
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="VD: Phòng Dự án"
                    className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <p className="text-xs text-slate-500 -mt-2">{USER_ROLE_DESCRIPTIONS[role]}</p>

              {/* Granular Permission Matrix */}
              <div className="space-y-2.5 pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Chi tiết phân quyền chức năng
                  </h3>
                  {role === 'admin' && (
                    <span className="text-[11px] text-[#1E3A5F] font-medium">
                      Quản trị viên mặc định có toàn quyền
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {PERMISSION_META.map((item) => {
                    const checked = role === 'admin' ? true : permissions[item.key];
                    const disabled = role === 'admin' || editingIsSuperAdmin;
                    return (
                      <label
                        key={item.key}
                        className={`flex items-start gap-3 p-3 border rounded-lg transition-colors ${
                          disabled
                            ? 'bg-slate-50 border-slate-200 cursor-not-allowed'
                            : checked
                              ? 'border-[#1E3A5F]/40 bg-slate-50/70 cursor-pointer'
                              : 'border-slate-200 hover:bg-slate-50 cursor-pointer'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={(e) => handlePermissionToggle(item.key, e.target.checked)}
                          className="mt-0.5 h-4 w-4 accent-[#1E3A5F]"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900">{item.label}</div>
                          <div className="text-[11px] text-slate-500 leading-snug mt-0.5">
                            {item.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ghi chú phân quyền (tùy chọn)
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Phạm vi phụ trách, thời hạn cộng tác..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-slate-200">
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
                  className="min-h-[44px] px-5 py-2 text-sm font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] disabled:opacity-50"
                >
                  {saving ? 'Đang lưu...' : editingUser ? 'Lưu phân quyền' : 'Tạo & Cấp quyền'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
