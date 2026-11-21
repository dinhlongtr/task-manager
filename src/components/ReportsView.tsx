import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, Printer, Sparkles } from 'lucide-react';
import {
  getLocalTodayISO,
  STATUS_LABELS,
  WORK_TYPE_LABELS,
  type AppTab,
  type LocationRecord,
  type WorkItemRecord,
} from '../types';

interface ReportsViewProps {
  workItems: WorkItemRecord[];
  locationsMap: Map<string, LocationRecord>;
  onNavigate: (tab: AppTab) => void;
}

const CHART_COLORS = ['#1E3A5F', '#0F766E', '#D97706', '#64748B'];

export const ReportsView: React.FC<ReportsViewProps> = ({
  workItems,
  locationsMap,
  onNavigate,
}) => {
  const [reportMode, setReportMode] = useState<'monthly' | 'project'>('monthly');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getLocalTodayISO().slice(0, 7));

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workItems) {
      const code = w.projectCode || (w.itemType === 'project' ? w.code : '');
      if (!code) continue;
      if (!map.has(code)) {
        map.set(code, w.projectName || w.title);
      }
    }
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [workItems]);

  const [selectedProjectCode, setSelectedProjectCode] = useState<string>('');
  const activeProjectCode = selectedProjectCode || projectOptions[0]?.code || '';

  const [aiSummary, setAiSummary] = useState<string>('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const scopedItems = useMemo(() => {
    if (reportMode === 'monthly') {
      return workItems.filter((w) => w.scheduledDate.startsWith(selectedMonth));
    }
    if (!activeProjectCode) return [];
    return workItems.filter(
      (w) =>
        w.projectCode === activeProjectCode ||
        (w.itemType === 'project' && w.code === activeProjectCode)
    );
  }, [workItems, reportMode, selectedMonth, activeProjectCode]);

  const stats = useMemo(() => {
    const total = scopedItems.length;
    const completed = scopedItems.filter((w) => w.status === 'completed').length;
    const inProgress = scopedItems.filter((w) => w.status === 'in_progress').length;
    const pending = scopedItems.filter((w) => w.status === 'pending').length;
    const cancelled = scopedItems.filter((w) => w.status === 'cancelled').length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    const byType = [
      {
        name: WORK_TYPE_LABELS.task,
        count: scopedItems.filter((w) => w.itemType === 'task').length,
      },
      {
        name: WORK_TYPE_LABELS.project,
        count: scopedItems.filter((w) => w.itemType === 'project').length,
      },
      {
        name: WORK_TYPE_LABELS.invitation,
        count: scopedItems.filter((w) => w.itemType === 'invitation').length,
      },
    ];

    const byStatus = [
      { name: STATUS_LABELS.completed, value: completed, color: '#16A34A' },
      { name: STATUS_LABELS.in_progress, value: inProgress, color: '#1E3A5F' },
      { name: STATUS_LABELS.pending, value: pending, color: '#D97706' },
      { name: STATUS_LABELS.cancelled, value: cancelled, color: '#94A3B8' },
    ].filter((s) => s.value > 0);

    const locAgg = new Map<
      string,
      { code: string; name: string; total: number; completed: number }
    >();
    for (const w of scopedItems) {
      const loc = locationsMap.get(w.locationId);
      const key = w.locationId || 'unknown';
      const entry = locAgg.get(key) || {
        code: loc?.code || 'N/A',
        name: loc?.name || 'Địa điểm khác',
        total: 0,
        completed: 0,
      };
      entry.total += 1;
      if (w.status === 'completed') entry.completed += 1;
      locAgg.set(key, entry);
    }
    const byLocation = Array.from(locAgg.values()).sort((a, b) => b.total - a.total);

    return {
      total,
      completed,
      inProgress,
      pending,
      cancelled,
      completionRate,
      byType,
      byStatus,
      byLocation,
    };
  }, [scopedItems, locationsMap]);

  const scopeLabel =
    reportMode === 'monthly'
      ? `Tháng ${selectedMonth.slice(5, 7)}/${selectedMonth.slice(0, 4)}`
      : activeProjectCode
        ? `Dự án ${activeProjectCode} — ${
            projectOptions.find((p) => p.code === activeProjectCode)?.name || ''
          }`
        : 'Chưa chọn dự án';

  const handleGenerateAISummary = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      const res = await fetch('/api/ai/report-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scopeLabel,
          stats: {
            total: stats.total,
            completed: stats.completed,
            inProgress: stats.inProgress,
            pending: stats.pending,
            completionRate: `${stats.completionRate}%`,
            byType: stats.byType,
            topLocations: stats.byLocation.slice(0, 5),
          },
        }),
      });
      const rawText = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
      } catch {
        if (res.status === 504) {
          throw new Error(
            'Hệ thống AI tổng hợp báo cáo quá thời gian chờ trên máy chủ (HTTP 504). Vui lòng thử bấm lại.'
          );
        }
        throw new Error(
          res.status === 404
            ? 'Không tìm thấy endpoint /api/ai/report-summary trên máy chủ (404). Hãy đảm bảo thư mục api/ đã được đẩy lên Vercel.'
            : `Máy chủ trả về phản hồi không hợp lệ (HTTP ${res.status}).`
        );
      }
      if (!res.ok) {
        throw new Error(String(data.error || 'Không thể tổng hợp báo cáo bằng AI.'));
      }
      setAiSummary(String(data.summary || ''));
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : 'Lỗi kết nối máy chủ AI.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Mã',
      'Phân loại',
      'Tiêu đề',
      'Mã dự án',
      'Ngày',
      'Giờ',
      'Mã địa điểm',
      'Tên địa điểm',
      'Trạng thái',
    ];
    const rows = scopedItems.map((w) => {
      const loc = locationsMap.get(w.locationId);
      return [
        w.code,
        WORK_TYPE_LABELS[w.itemType],
        w.title,
        w.projectCode,
        w.scheduledDate,
        `${w.startTime}-${w.endTime}`,
        loc?.code || '',
        loc?.name || '',
        STATUS_LABELS[w.status],
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(',');
    });
    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bao-cao-${reportMode === 'monthly' ? selectedMonth : activeProjectCode || 'du-an'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Báo cáo tổng hợp tự động
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Tổng hợp số liệu thời gian thực theo từng tháng hoặc theo từng mã dự án cụ thể.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            disabled={scopedItems.length === 0}
            onClick={handleExportCsv}
            className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            Xuất CSV
          </button>
          <button
            type="button"
            onClick={() => onNavigate('print')}
            className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            In lịch trình A4 / A3
          </button>
        </div>
      </div>

      {/* Mode Switch & Scope Selector */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
          <button
            type="button"
            onClick={() => {
              setReportMode('monthly');
              setAiSummary('');
            }}
            className={`min-h-[38px] px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              reportMode === 'monthly'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Theo tháng
          </button>
          <button
            type="button"
            onClick={() => {
              setReportMode('project');
              setAiSummary('');
            }}
            className={`min-h-[38px] px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              reportMode === 'project'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Theo dự án cụ thể
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {reportMode === 'monthly' ? (
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => {
                setSelectedMonth(e.target.value);
                setAiSummary('');
              }}
              className="min-h-[40px] px-3 py-1.5 text-sm font-mono-tabular border border-slate-300 rounded-lg"
            />
          ) : (
            <select
              value={activeProjectCode}
              onChange={(e) => {
                setSelectedProjectCode(e.target.value);
                setAiSummary('');
              }}
              className="min-h-[40px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg min-w-[240px]"
            >
              {projectOptions.length === 0 ? (
                <option value="">Chưa có dự án nào được gắn mã</option>
              ) : (
                projectOptions.map((p) => (
                  <option key={p.code} value={p.code}>
                    [{p.code}] {p.name}
                  </option>
                ))
              )}
            </select>
          )}

          <button
            type="button"
            disabled={aiLoading || stats.total === 0}
            onClick={handleGenerateAISummary}
            className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-[#1E3A5F] bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4" />
            {aiLoading ? 'Đang phân tích...' : 'AI nhận xét báo cáo'}
          </button>
        </div>
      </div>

      {/* AI Executive Summary Box (only when requested) */}
      {(aiSummary || aiError) && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
          <div className="text-xs font-semibold text-[#1E3A5F]">
            Tổng hợp nhận xét từ Google AI — {scopeLabel}
          </div>
          {aiError ? (
            <p className="text-xs text-red-700">{aiError}</p>
          ) : (
            <div className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">
              {aiSummary}
            </div>
          )}
        </div>
      )}

      {/* KPI Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Tổng hạng mục</div>
          <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">
            {stats.total}
          </div>
          <div className="text-xs text-slate-500 mt-0.5 truncate">{scopeLabel}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Tỷ lệ hoàn thành</div>
          <div className="text-2xl font-bold font-mono-tabular text-emerald-700 mt-1">
            {stats.completionRate}%
          </div>
          <div className="text-xs text-slate-500 font-mono-tabular mt-0.5">
            {stats.completed} hoàn thành
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Đang thực hiện</div>
          <div className="text-2xl font-bold font-mono-tabular text-[#1E3A5F] mt-1">
            {stats.inProgress}
          </div>
          <div className="text-xs text-slate-500 font-mono-tabular mt-0.5">
            {stats.pending} chờ xử lý
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Địa điểm phát sinh</div>
          <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">
            {stats.byLocation.length}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">địa điểm liên kết</div>
        </div>
      </div>

      {/* Charts */}
      {stats.total === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
          Chưa có số liệu công việc trong phạm vi <strong className="text-slate-700">{scopeLabel}</strong>.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">
              Phân bổ theo loại hạng mục
            </h2>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.byType} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#475569' }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Số lượng" radius={[6, 6, 0, 0]} maxBarSize={52}>
                    {stats.byType.map((_, idx) => (
                      <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">
              Cơ cấu trạng thái thực hiện
            </h2>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.byStatus}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={78}
                    paddingAngle={2}
                  >
                    {stats.byStatus.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
              {stats.byStatus.map((s) => (
                <div key={s.name} className="flex items-center justify-between">
                  <span className="text-slate-600">{s.name}</span>
                  <span className="font-mono-tabular font-semibold text-slate-900">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Breakdown Table by Location */}
      {stats.byLocation.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              Thống kê khối lượng theo bảng Địa điểm
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Mã địa điểm</th>
                  <th className="py-2.5 px-4">Tên địa điểm</th>
                  <th className="py-2.5 px-4 text-right">Tổng việc</th>
                  <th className="py-2.5 px-4 text-right">Hoàn thành</th>
                  <th className="py-2.5 px-4 text-right">Tỷ lệ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.byLocation.map((row) => {
                  const pct = row.total > 0 ? Math.round((row.completed / row.total) * 100) : 0;
                  return (
                    <tr key={row.code}>
                      <td className="py-2.5 px-4 font-mono-tabular text-xs font-semibold text-[#1E3A5F]">
                        {row.code}
                      </td>
                      <td className="py-2.5 px-4 text-slate-900">{row.name}</td>
                      <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-900">
                        {row.total}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-tabular text-emerald-700">
                        {row.completed}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-700">
                        {pct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
