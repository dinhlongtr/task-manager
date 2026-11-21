import React, { useState } from 'react';
import { signInWithPopup, signOut, type User } from 'firebase/auth';
import { Lock, LogOut, ShieldAlert, ShieldCheck, KeyRound } from 'lucide-react';
import { auth, googleProvider, OWNER_EMAIL } from '../firebase';
import { sha256Hex } from '../types';

interface AuthGateProps {
  user: User | null;
  authLoading: boolean;
  isAuthorizedUser: boolean;
  denialReason: 'none' | 'not_registered' | 'suspended' | 'unverified';
  pinHash: string;
  isPinLocked: boolean;
  onUnlockPin: () => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({
  user,
  authLoading,
  isAuthorizedUser,
  denialReason,
  pinHash,
  isPinLocked,
  onUnlockPin,
}) => {
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setAuthError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: string }).code || '')
          : '';
      const msg = err instanceof Error ? err.message : String(err);

      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return;
      }
      if (code === 'auth/unauthorized-domain' || msg.includes('unauthorized-domain')) {
        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        setAuthError(
          `Tên miền "${host}" chưa được cấp phép trong Firebase Authentication. Hãy vào Firebase Console → Authentication → Settings → Authorized domains và thêm "${host}".`
        );
      } else if (code === 'auth/popup-blocked' || msg.includes('popup-blocked')) {
        setAuthError(
          'Trình duyệt đang chặn cửa sổ đăng nhập (Popup). Vui lòng cho phép mở popup cho trang này rồi bấm đăng nhập lại.'
        );
      } else if (code === 'auth/operation-not-allowed') {
        setAuthError(
          'Phương thức đăng nhập Google chưa được bật trong Firebase Console → Authentication → Sign-in method.'
        );
      } else {
        setAuthError(
          `Không thể đăng nhập bằng Google (${code || 'lỗi xác thực'}). Vui lòng kiểm tra kết nối hoặc thử lại.`
        );
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');
    if (!pinInput.trim()) return;
    const hashed = await sha256Hex(pinInput.trim());
    if (hashed === pinHash) {
      setPinInput('');
      onUnlockPin();
    } else {
      setPinError('Mã PIN không chính xác. Vui lòng nhập lại.');
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-[#1E3A5F] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-600 font-medium">Đang xác thực tài khoản và quyền truy cập...</p>
        </div>
      </div>
    );
  }

  // Case 1: Signed in, but NOT authorized or suspended
  if (user && !isAuthorizedUser) {
    const title =
      denialReason === 'suspended'
        ? 'Tài khoản đang bị tạm khóa'
        : denialReason === 'unverified'
          ? 'Email chưa được xác minh'
          : 'Tài khoản chưa được cấp quyền';

    const description =
      denialReason === 'suspended'
        ? 'Quản trị viên đã tạm khóa quyền truy cập của tài khoản này vào hệ thống Sổ Tay Công Tác.'
        : denialReason === 'unverified'
          ? 'Tài khoản Google của bạn cần có email đã xác minh để đảm bảo an toàn bảo mật dữ liệu.'
          : 'Email này chưa có trong danh sách người dùng được Quản trị viên cấp phép. Vui lòng liên hệ Quản trị viên để được thêm tài khoản và phân quyền.';

    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-5">
          <div className="w-11 h-11 rounded-lg bg-red-50 text-red-700 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
            <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 space-y-1">
            <div>
              Tài khoản đang đăng nhập:{' '}
              <span className="font-mono-tabular text-slate-900 font-medium">{user.email}</span>
            </div>
            <div>
              Trạng thái quyền:{' '}
              <span className="text-red-700 font-medium">
                {denialReason === 'suspended' ? 'Tạm khóa bởi Admin' : 'Chưa được cấp phép'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Đăng xuất & đổi tài khoản khác
          </button>
        </div>
      </div>
    );
  }

  // Case 2: Authorized user, but Quick-Lock PIN screen is engaged
  if (user && isAuthorizedUser && isPinLocked && pinHash) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-5">
          <div className="w-11 h-11 rounded-lg bg-slate-100 text-[#1E3A5F] flex items-center justify-center">
            <KeyRound className="w-5 h-5" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold text-slate-900">Mở khóa sổ tay cá nhân</h1>
            <p className="text-sm text-slate-600">
              Nhập mã PIN bảo mật để tiếp tục xem lịch trình và danh bạ riêng tư.
            </p>
          </div>
          <form onSubmit={handleVerifyPin} className="space-y-4">
            <div>
              <label htmlFor="vault-pin" className="block text-xs font-medium text-slate-700 mb-1.5">
                Mã PIN cá nhân
              </label>
              <input
                id="vault-pin"
                type="password"
                inputMode="numeric"
                autoFocus
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="Nhập mã PIN..."
                className="w-full min-h-[44px] px-3.5 py-2 text-base tracking-widest font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/20 focus:border-[#1E3A5F]"
              />
              {pinError && <p className="mt-1.5 text-xs text-red-600">{pinError}</p>}
            </div>
            <button
              type="submit"
              className="w-full min-h-[44px] px-4 py-2.5 text-sm font-medium text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] transition-colors"
            >
              Mở khóa
            </button>
          </form>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full min-h-[44px] text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors"
          >
            Đăng xuất tài khoản Google
          </button>
        </div>
      </div>
    );
  }

  // Case 3: Not signed in yet
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="lg:col-span-7 p-6 sm:p-10 flex flex-col justify-between bg-[#0F172A] text-white space-y-8">
          <div className="space-y-6">
            <div className="text-sm font-semibold tracking-tight text-slate-300">Sổ Tay Công Tác</div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight text-balance">
              Quản lý công việc, lịch trình hằng ngày & dữ liệu cá nhân bảo mật tuyệt đối.
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed max-w-lg">
              Đồng bộ thời gian thực trên đám mây giữa máy tính và điện thoại. Liên kết chặt chẽ giữa
              công việc, dự án, giấy mời, bảng địa điểm riêng và danh bạ quan hệ cá nhân.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-6 border-t border-slate-800 text-xs text-slate-300">
            <div>
              <div className="font-semibold text-white">Phân quyền chặt chẽ (RBAC)</div>
              <div className="mt-1 text-slate-400">Chỉ tài khoản được Admin cấp phép mới truy cập</div>
            </div>
            <div>
              <div className="font-semibold text-white">Nhập liệu AI & In A4 / A3</div>
              <div className="mt-1 text-slate-400">Trích xuất lịch tự động, in lịch trình chuẩn</div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 p-6 sm:p-10 flex flex-col justify-center space-y-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-[#1E3A5F]">
              <Lock className="w-4 h-4" />
              Xác thực & Phân quyền
            </div>
            <h2 className="text-xl font-semibold text-slate-900">Đăng nhập hệ thống</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Sử dụng tài khoản Google đã được Quản trị viên cấp quyền để đồng bộ dữ liệu thời gian thực từ Cloud Firestore.
            </p>
          </div>

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 space-y-1">
            <div className="flex items-center gap-1.5 font-medium text-slate-800">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              Kiểm soát truy cập qua Quản trị viên
            </div>
            <p>
              Quản trị viên gốc:{' '}
              <span className="font-mono-tabular text-slate-900">{OWNER_EMAIL}</span>
            </p>
          </div>

          {authError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {authError}
            </div>
          )}

          <button
            type="button"
            disabled={signingIn}
            onClick={handleGoogleSignIn}
            className="w-full min-h-[48px] inline-flex items-center justify-center gap-3 px-4 py-3 text-sm font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] disabled:opacity-60 transition-colors"
          >
            {signingIn ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Đang kết nối Google...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M21.35 11.1h-9.18v2.92h5.27c-.23 1.24-.92 2.29-1.97 3l3.18 2.47c1.86-1.71 2.93-4.23 2.93-7.21 0-.69-.06-1.35-.23-1.18z"
                  />
                  <path
                    fill="currentColor"
                    d="M12.17 21c2.65 0 4.88-.88 6.5-2.38l-3.18-2.47c-.88.59-2 .94-3.32.94-2.55 0-4.71-1.72-5.48-4.04H3.4v2.54C5.01 18.79 8.33 21 12.17 21z"
                  />
                  <path
                    fill="currentColor"
                    d="M6.69 13.05a5.65 5.65 0 0 1 0-3.62V6.89H3.4a9.49 9.49 0 0 0 0 8.7l3.29-2.54z"
                  />
                  <path
                    fill="currentColor"
                    d="M12.17 5.38c1.44 0 2.74.5 3.76 1.47l2.82-2.82C17.04 2.44 14.82 1.5 12.17 1.5 8.33 1.5 5.01 3.71 3.4 6.89l3.29 2.54c.77-2.32 2.93-4.05 5.48-4.05z"
                  />
                </svg>
                Đăng nhập bằng Google
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
