import React, { useEffect, useState } from 'react';
import { signOut, type User } from 'firebase/auth';
import { Bell, EyeOff, KeyRound, Lock, LogOut, ShieldCheck, UserCog } from 'lucide-react';
import { auth } from '../firebase';
import {
  PAPER_SIZE_META,
  sha256Hex,
  USER_ROLE_LABELS,
  type AppTab,
  type EffectiveUserAccess,
  type PaperSizeOption,
  type UserSettingsRecord,
} from '../types';
import { updateUserSettings } from '../services/firestoreService';

interface SecuritySettingsViewProps {
  user: User;
  access: EffectiveUserAccess;
  userCount: number;
  settings: UserSettingsRecord | null;
  onLockNow: () => void;
  onNavigate: (tab: AppTab) => void;
  onNotify: (msg: string) => void;
}

export const SecuritySettingsView: React.FC<SecuritySettingsViewProps> = ({
  user,
  access,
  userCount,
  settings,
  onLockNow,
  onNavigate,
  onNotify,
}) => {
  const [ownerTitle, setOwnerTitle] = useState(settings?.ownerTitle || '');
  const [orgHeader, setOrgHeader] = useState(settings?.organizationHeader || '');
  const [defaultPaper, setDefaultPaper] = useState<PaperSizeOption>(
    settings?.defaultPaperSize || 'A4_portrait'
  );
  const [privacyMask, setPrivacyMask] = useState(Boolean(settings?.privacyMaskEnabled));
  const [soundAlert, setSoundAlert] = useState(settings?.soundAlertEnabled ?? true);

  const [newPin, setNewPin] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPin, setSavingPin] = useState(false);
  const [notifStatus, setNotifStatus] = useState<string>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  useEffect(() => {
    if (!settings) return;
    setOwnerTitle(settings.ownerTitle);
    setOrgHeader(settings.organizationHeader);
    setDefaultPaper(settings.defaultPaperSize);
    setPrivacyMask(settings.privacyMaskEnabled);
    setSoundAlert(settings.soundAlertEnabled);
  }, [settings]);

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateUserSettings(user.uid, {
        ownerTitle,
        organizationHeader: orgHeader,
        defaultPaperSize: defaultPaper,
        privacyMaskEnabled: privacyMask,
        soundAlertEnabled: soundAlert,
      });
      onNotify('Đã lưu cấu hình bảo mật và in ấn lên đám mây.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.trim().length < 4) {
      onNotify('Mã PIN cần tối thiểu 4 ký tự số.');
      return;
    }
    setSavingPin(true);
    try {
      const hash = await sha256Hex(newPin.trim());
      await updateUserSettings(user.uid, { pinHash: hash });
      setNewPin('');
      onNotify('Đã thiết lập mã PIN khóa nhanh cá nhân.');
    } finally {
      setSavingPin(false);
    }
  };

  const handleClearPin = async () => {
    setSavingPin(true);
    try {
      await updateUserSettings(user.uid, { pinHash: '' });
      onNotify('Đã gỡ mã PIN khóa nhanh.');
    } finally {
      setSavingPin(false);
    }
  };

  const handleRequestNotifications = async () => {
    if (typeof Notification === 'undefined') {
      setNotifStatus('unsupported');
      return;
    }
    const perm = await Notification.requestPermission();
    setNotifStatus(perm);
    onNotify(
      perm === 'granted'
        ? 'Đã bật thông báo nhắc lịch trên trình duyệt.'
        : 'Trình duyệt chưa cấp quyền thông báo.'
    );
  };

  const activePermissionLabels = [
    access.permissions.canManageWork && 'Quản lý Công việc',
    access.permissions.canManageLocations && 'Quản lý Địa điểm',
    access.permissions.canManageContacts
      ? 'Quản lý Danh bạ'
      : access.permissions.canViewContacts && 'Xem Danh bạ',
    access.permissions.canUseAI && 'Nhập liệu AI',
    access.permissions.canPrintReports && 'Báo cáo & In A4/A3',
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="pb-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Bảo mật & Cài đặt tài khoản
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Kiểm soát quyền truy cập RBAC, mã hóa khóa PIN nhanh và cấu hình nhắc nhở cá nhân.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {access.isAdmin && (
            <button
              type="button"
              onClick={() => onNavigate('users')}
              className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] whitespace-nowrap"
            >
              <UserCog className="w-4 h-4" />
              Quản lý người dùng ({userCount})
            </button>
          )}
          {settings?.pinHash && (
            <button
              type="button"
              onClick={onLockNow}
              className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <Lock className="w-4 h-4" />
              Khóa màn hình ngay
            </button>
          )}
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" />
            Đăng xuất
          </button>
        </div>
      </div>

      {/* Access Control Verification Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-emerald-800">
            <ShieldCheck className="w-5 h-5 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900">
              Trạng thái phân quyền tài khoản (RBAC Cloud Firestore)
            </h2>
          </div>
          <span className="text-xs font-semibold text-[#1E3A5F]">
            {access.isSuperAdmin ? 'Quản trị viên gốc (Super Admin)' : USER_ROLE_LABELS[access.role]}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-2 border-t border-slate-100">
          <div>
            <div className="text-slate-500">Email đang đăng nhập</div>
            <div className="font-mono-tabular font-semibold text-slate-900 mt-0.5">
              {user.email}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Quyền chức năng được cấp</div>
            <div className="text-emerald-700 font-medium mt-0.5">
              {access.isAdmin
                ? 'Toàn quyền hệ thống + Quản trị tài khoản người dùng'
                : activePermissionLabels.length > 0
                  ? activePermissionLabels.join(' · ')
                  : 'Chỉ xem lịch trình cơ bản'}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Mã định danh bảo mật (UID)</div>
            <div className="font-mono-tabular text-slate-700 mt-0.5 truncate">{user.uid}</div>
          </div>
          <div>
            <div className="text-slate-500">Bảo vệ thông tin nhạy cảm (PII)</div>
            <div className="text-slate-700 mt-0.5">
              Danh bạ được cách ly ở tầng bảo mật Firestore theo quyền tài khoản
            </div>
          </div>
        </div>
      </div>

      {/* Preferences & Privacy Form */}
      <form
        onSubmit={handleSavePreferences}
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-5"
      >
        <h2 className="text-sm font-semibold text-slate-900">
          Tùy chọn riêng tư, nhắc lịch & bản in A4/A3
        </h2>

        <div className="space-y-3">
          <label className="flex items-start justify-between gap-4 p-3.5 border border-slate-200 rounded-lg cursor-pointer">
            <div className="space-y-0.5">
              <div className="text-sm font-medium text-slate-900 flex items-center gap-2">
                <EyeOff className="w-4 h-4 text-[#1E3A5F]" />
                Chế độ ẩn thông tin nhạy cảm khi làm việc nơi công cộng
              </div>
              <p className="text-xs text-slate-500">
                Tự động che bớt số điện thoại, email và địa chỉ chi tiết trên màn hình (vẫn cho phép bấm hiện từng mục).
              </p>
            </div>
            <input
              type="checkbox"
              checked={privacyMask}
              onChange={(e) => setPrivacyMask(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[#1E3A5F]"
            />
          </label>

          <label className="flex items-start justify-between gap-4 p-3.5 border border-slate-200 rounded-lg cursor-pointer">
            <div className="space-y-0.5">
              <div className="text-sm font-medium text-slate-900 flex items-center gap-2">
                <Bell className="w-4 h-4 text-[#1E3A5F]" />
                Âm thanh nhắc nhở khi đến lịch trình
              </div>
              <p className="text-xs text-slate-500">
                Phát chuông nhẹ khi có công việc hoặc giấy mời sắp đến giờ thực hiện.
              </p>
            </div>
            <input
              type="checkbox"
              checked={soundAlert}
              onChange={(e) => setSoundAlert(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[#1E3A5F]"
            />
          </label>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 border border-slate-200 rounded-lg">
            <div className="space-y-0.5">
              <div className="text-sm font-medium text-slate-900">Thông báo đẩy của trình duyệt</div>
              <p className="text-xs text-slate-500">
                Trạng thái hiện tại:{' '}
                <span className="font-medium text-slate-800">
                  {notifStatus === 'granted'
                    ? 'Đã cấp phép'
                    : notifStatus === 'denied'
                      ? 'Đang bị chặn bởi trình duyệt'
                      : notifStatus === 'unsupported'
                        ? 'Trình duyệt không hỗ trợ'
                        : 'Chưa kích hoạt'}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={handleRequestNotifications}
              className="min-h-[38px] px-3.5 py-1.5 text-xs font-medium text-[#1E3A5F] bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 whitespace-nowrap"
            >
              Kích hoạt thông báo
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-100">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Tên người lập lịch (hiển thị trên bản in)
            </label>
            <input
              type="text"
              maxLength={120}
              value={ownerTitle}
              onChange={(e) => setOwnerTitle(e.target.value)}
              className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Khổ giấy in mặc định
            </label>
            <select
              value={defaultPaper}
              onChange={(e) => setDefaultPaper(e.target.value as PaperSizeOption)}
              className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
            >
              {(Object.keys(PAPER_SIZE_META) as PaperSizeOption[]).map((k) => (
                <option key={k} value={k}>
                  {PAPER_SIZE_META[k].label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Tiêu đề đầu trang khi in lịch trình / thông báo
            </label>
            <input
              type="text"
              maxLength={180}
              value={orgHeader}
              onChange={(e) => setOrgHeader(e.target.value)}
              className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingProfile}
            className="min-h-[42px] px-5 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] disabled:opacity-50"
          >
            {savingProfile ? 'Đang lưu...' : 'Lưu cài đặt'}
          </button>
        </div>
      </form>

      {/* Quick-Lock PIN Management */}
      <form
        onSubmit={handleSavePin}
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-[#1E3A5F]" />
          <h2 className="text-sm font-semibold text-slate-900">
            Mã PIN khóa màn hình nhanh (băm SHA-256)
          </h2>
        </div>
        <p className="text-xs text-slate-500">
          {settings?.pinHash
            ? 'Mã PIN đang được kích hoạt. Bạn có thể đổi mã PIN mới hoặc gỡ bỏ.'
            : 'Thiết lập mã PIN cá nhân (4–8 số) để khóa nhanh màn hình ứng dụng khi rời khỏi máy tính hoặc điện thoại.'}
        </p>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <input
            type="password"
            inputMode="numeric"
            maxLength={12}
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            placeholder="Nhập mã PIN mới (tối thiểu 4 số)..."
            className="flex-1 min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg"
          />
          <button
            type="submit"
            disabled={savingPin || newPin.trim().length < 4}
            className="min-h-[42px] px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] disabled:opacity-40 whitespace-nowrap"
          >
            {settings?.pinHash ? 'Đổi mã PIN' : 'Kích hoạt PIN'}
          </button>
          {settings?.pinHash && (
            <button
              type="button"
              disabled={savingPin}
              onClick={handleClearPin}
              className="min-h-[42px] px-4 py-2 text-xs font-medium text-red-700 border border-red-200 rounded-lg hover:bg-red-50 whitespace-nowrap"
            >
              Gỡ mã PIN
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
