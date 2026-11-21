import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  errorMessage: string;
  isPermissionError: boolean;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      isPermissionError: false,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    let message = error.message || 'Đã xảy ra lỗi không mong muốn.';
    let isPerm = false;
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed.error === 'string') {
        message = parsed.error;
        if (parsed.error.toLowerCase().includes('permission')) {
          isPerm = true;
        }
      }
    } catch {
      if (message.toLowerCase().includes('permission')) {
        isPerm = true;
      }
    }
    return {
      hasError: true,
      errorMessage: message,
      isPermissionError: isPerm,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Application ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-700">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-lg font-semibold text-slate-900">
                {this.state.isPermissionError
                  ? 'Không đủ quyền truy cập dữ liệu'
                  : 'Đã xảy ra lỗi ứng dụng'}
              </h1>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              {this.state.isPermissionError
                ? 'Hệ thống bảo mật cá nhân chỉ cho phép chủ sở hữu đã xác thực truy cập cơ sở dữ liệu đám mây này.'
                : this.state.errorMessage}
            </p>
            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Tải lại ứng dụng
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
