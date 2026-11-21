import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, Printer } from 'lucide-react';
import {
  diffDateTimeMinutes,
  formatDurationVi,
  getLocalTodayISO,
  getStopDepartureDateTime,
  getStopPointLabel,
  PAPER_SIZE_META,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TRAVEL_TRANSPORT_LABELS,
  TRAVEL_TRIP_STATUS_LABELS,
  WORK_TYPE_LABELS,
  type ContactRecord,
  type LocationRecord,
  type PaperSizeOption,
  type TravelStopRecord,
  type TravelTripRecord,
  type UserSettingsRecord,
  type WorkItemRecord,
} from '../types';
import { fetchTravelStopsOnce } from '../services/firestoreService';
import {
  buildBarcodeSegments,
  buildNoticeReceiptScript,
  buildScheduleReceiptScript,
  buildTravelReceiptScript,
  RECEIPT_PAPER_SPECS,
  type ReceiptPaperMode,
} from '../utils/receiptScript';

interface PrintStudioViewProps {
  workItems: WorkItemRecord[];
  travelTrips: TravelTripRecord[];
  initialTravelTripId?: string | null;
  locationsMap: Map<string, LocationRecord>;
  contactsMap: Map<string, ContactRecord>;
  settings: UserSettingsRecord | null;
}

type PrintStyle = 'receipt_script' | 'standard';
type PrintTemplate = 'schedule_table' | 'formal_notice' | 'travel_itinerary';
type RangePreset = 'today' | 'week' | 'month' | 'all';

function addDaysISO(iso: string, days: number): string {
  const dt = new Date(`${iso}T00:00:00`);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
}

export const PrintStudioView: React.FC<PrintStudioViewProps> = ({
  workItems,
  travelTrips,
  initialTravelTripId,
  locationsMap,
  contactsMap,
  settings,
}) => {
  const todayIso = getLocalTodayISO();
  const [printStyle, setPrintStyle] = useState<PrintStyle>('receipt_script');
  const [receiptPaper, setReceiptPaper] = useState<ReceiptPaperMode>('K80');
  const [asciiOnly, setAsciiOnly] = useState(false);
  const [showBarcode, setShowBarcode] = useState(true);
  const [copiedScript, setCopiedScript] = useState(false);

  const [paperSize, setPaperSize] = useState<PaperSizeOption>(
    settings?.defaultPaperSize || 'A4_portrait'
  );
  const [template, setTemplate] = useState<PrintTemplate>(
    initialTravelTripId ? 'travel_itinerary' : 'schedule_table'
  );
  const [rangePreset, setRangePreset] = useState<RangePreset>('week');
  const [selectedNoticeId, setSelectedNoticeId] = useState<string>('');
  const [selectedTravelTripId, setSelectedTravelTripId] = useState<string>(
    initialTravelTripId || ''
  );
  const [travelStops, setTravelStops] = useState<TravelStopRecord[]>([]);
  const [loadingTravelStops, setLoadingTravelStops] = useState(false);

  useEffect(() => {
    if (initialTravelTripId) {
      setSelectedTravelTripId(initialTravelTripId);
      setTemplate('travel_itinerary');
    }
  }, [initialTravelTripId]);

  const filteredItems = useMemo(() => {
    if (rangePreset === 'today') {
      return workItems.filter((w) => w.scheduledDate === todayIso);
    }
    if (rangePreset === 'week') {
      const end = addDaysISO(todayIso, 7);
      return workItems.filter((w) => w.scheduledDate >= todayIso && w.scheduledDate <= end);
    }
    if (rangePreset === 'month') {
      const monthPrefix = todayIso.slice(0, 7);
      return workItems.filter((w) => w.scheduledDate.startsWith(monthPrefix));
    }
    return workItems;
  }, [workItems, rangePreset, todayIso]);

  const activeNoticeItem = useMemo(() => {
    if (selectedNoticeId) {
      return workItems.find((w) => w.id === selectedNoticeId) || filteredItems[0] || workItems[0] || null;
    }
    return (
      filteredItems.find((w) => w.itemType === 'invitation') ||
      filteredItems[0] ||
      workItems[0] ||
      null
    );
  }, [selectedNoticeId, workItems, filteredItems]);

  const activeTravelTrip = useMemo(() => {
    if (selectedTravelTripId) {
      const found = travelTrips.find((t) => t.id === selectedTravelTripId);
      if (found) return found;
    }
    return travelTrips[0] || null;
  }, [selectedTravelTripId, travelTrips]);

  useEffect(() => {
    if (template !== 'travel_itinerary' || !activeTravelTrip) {
      setTravelStops([]);
      setLoadingTravelStops(false);
      return;
    }
    let cancelled = false;
    setLoadingTravelStops(true);
    fetchTravelStopsOnce(activeTravelTrip.id)
      .then((rows) => {
        if (!cancelled) {
          setTravelStops(rows);
          setLoadingTravelStops(false);
        }
      })
      .catch((err) => {
        console.error('Failed to load travel stops for print:', err);
        if (!cancelled) {
          setTravelStops([]);
          setLoadingTravelStops(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [template, activeTravelTrip]);

  const travelSummary = useMemo(() => {
    let totalActivityMins = 0;
    let totalTransitMins = 0;
    const legMinutes: Array<number | null> = [];

    for (let i = 0; i < travelStops.length; i++) {
      const stop = travelStops[i];
      totalActivityMins += Math.max(0, stop.activityDurationMinutes);
      if (i === 0) {
        legMinutes.push(null);
      } else {
        const prevDep = getStopDepartureDateTime(travelStops[i - 1]);
        const diff = diffDateTimeMinutes(prevDep.date, prevDep.time, stop.stopDate, stop.arrivalTime);
        legMinutes.push(diff);
        if (diff > 0) totalTransitMins += diff;
      }
    }

    return { totalActivityMins, totalTransitMins, legMinutes };
  }, [travelStops]);

  const paperMeta = PAPER_SIZE_META[paperSize];
  const isA3 = paperSize.startsWith('A3');
  const isLandscape = paperSize.endsWith('landscape');
  const receiptSpec = RECEIPT_PAPER_SPECS[receiptPaper];

  const rangeLabel = useMemo(() => {
    if (rangePreset === 'today') return `Ngày ${todayIso}`;
    if (rangePreset === 'week') return `${todayIso} → ${addDaysISO(todayIso, 7)}`;
    if (rangePreset === 'month') return `Tháng ${todayIso.slice(5, 7)}/${todayIso.slice(0, 4)}`;
    return 'Toàn bộ lịch trình';
  }, [rangePreset, todayIso]);

  const receiptScriptText = useMemo(() => {
    if (printStyle !== 'receipt_script') return '';

    if (template === 'travel_itinerary') {
      if (!activeTravelTrip) return '';
      return buildTravelReceiptScript({
        trip: activeTravelTrip,
        stops: travelStops,
        locationsMap,
        settings,
        todayIso,
        cols: receiptSpec.cols,
        asciiOnly,
      });
    }

    if (template === 'formal_notice') {
      if (!activeNoticeItem) return '';
      return buildNoticeReceiptScript({
        item: activeNoticeItem,
        locationsMap,
        contactsMap,
        settings,
        todayIso,
        cols: receiptSpec.cols,
        asciiOnly,
      });
    }

    return buildScheduleReceiptScript({
      items: filteredItems,
      rangeLabel,
      locationsMap,
      contactsMap,
      settings,
      todayIso,
      cols: receiptSpec.cols,
      asciiOnly,
    });
  }, [
    printStyle,
    template,
    activeTravelTrip,
    travelStops,
    activeNoticeItem,
    filteredItems,
    rangeLabel,
    locationsMap,
    contactsMap,
    settings,
    todayIso,
    receiptSpec.cols,
    asciiOnly,
  ]);

  const barcodeCode = useMemo(() => {
    if (template === 'travel_itinerary' && activeTravelTrip) return activeTravelTrip.code;
    if (template === 'formal_notice' && activeNoticeItem) return activeNoticeItem.code;
    return `LICH-${todayIso.replace(/-/g, '')}`;
  }, [template, activeTravelTrip, activeNoticeItem, todayIso]);

  const barcodeBars = useMemo(() => buildBarcodeSegments(barcodeCode), [barcodeCode]);
  const barcodeTotalWidth = useMemo(() => {
    const last = barcodeBars[barcodeBars.length - 1];
    return last ? last.x + last.w : 120;
  }, [barcodeBars]);

  const scriptLineCount = useMemo(
    () => (receiptScriptText ? receiptScriptText.split('\n').length : 0),
    [receiptScriptText]
  );

  const handlePrint = () => {
    window.print();
  };

  const handleCopyScript = async () => {
    if (!receiptScriptText) return;
    try {
      await navigator.clipboard.writeText(receiptScriptText);
      setCopiedScript(true);
      window.setTimeout(() => setCopiedScript(false), 2000);
    } catch {
      // Fallback textarea copy
      const ta = document.createElement('textarea');
      ta.value = receiptScriptText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedScript(true);
      window.setTimeout(() => setCopiedScript(false), 2000);
    }
  };

  const handleDownloadTxt = () => {
    if (!receiptScriptText) return;
    const prefix = asciiOnly ? '' : '\uFEFF';
    const blob = new Blob([prefix + receiptScriptText + '\n'], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `script-${barcodeCode.toLowerCase().replace(/[^a-z0-9_-]/gi, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const activePageSizeCss =
    printStyle === 'receipt_script' ? receiptSpec.cssPageSize : paperMeta.cssSize;
  const activePageMarginCss =
    printStyle === 'receipt_script' ? receiptSpec.cssPageMargin : '12mm';
  const activePaperShortLabel =
    printStyle === 'receipt_script' ? receiptSpec.shortLabel : paperMeta.shortLabel;

  return (
    <div className="space-y-5">
      {/* Dynamic @page CSS injection matching receipt roll (K80/K58) or dot-matrix / A4 / A3 / A5 */}
      <style>{`@media print { @page { size: ${activePageSizeCss}; margin: ${activePageMarginCss}; } }`}</style>

      {/* Controls Bar (hidden when printing) */}
      <div className="no-print space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              In lịch trình, Hóa đơn & In kim
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Hỗ trợ in dạng phiếu hóa đơn (K80/K58), giấy in kim liên tục, xuất script .TXT hoặc mẫu văn bản A4/A3 chuẩn.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {printStyle === 'receipt_script' && (
              <>
                <button
                  type="button"
                  disabled={!receiptScriptText}
                  onClick={handleCopyScript}
                  className="min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
                >
                  {copiedScript ? <Check className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />}
                  {copiedScript ? 'Đã sao chép' : 'Sao chép script'}
                </button>
                <button
                  type="button"
                  disabled={!receiptScriptText}
                  onClick={handleDownloadTxt}
                  className="min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
                >
                  <Download className="w-4 h-4" />
                  Tải .TXT
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handlePrint}
              className="min-h-[42px] inline-flex items-center justify-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] whitespace-nowrap"
            >
              <Printer className="w-4 h-4" />
              In ngay ({activePaperShortLabel})
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">Phong cách bản in</label>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setPrintStyle('receipt_script')}
                  className={`min-h-[36px] px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    printStyle === 'receipt_script'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  In kim / Bill
                </button>
                <button
                  type="button"
                  onClick={() => setPrintStyle('standard')}
                  className={`min-h-[36px] px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    printStyle === 'standard'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Văn bản chuẩn
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">Nội dung cần in</label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setTemplate('schedule_table')}
                  className={`min-h-[36px] px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    template === 'schedule_table'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Công tác
                </button>
                <button
                  type="button"
                  onClick={() => setTemplate('formal_notice')}
                  className={`min-h-[36px] px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    template === 'formal_notice'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Thông báo
                </button>
                <button
                  type="button"
                  onClick={() => setTemplate('travel_itinerary')}
                  className={`min-h-[36px] px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    template === 'travel_itinerary'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Du lịch
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                {printStyle === 'receipt_script' ? 'Khổ cuộn / Giấy in kim' : 'Khổ giấy (A4, A3, A5)'}
              </label>
              {printStyle === 'receipt_script' ? (
                <select
                  value={receiptPaper}
                  onChange={(e) => setReceiptPaper(e.target.value as ReceiptPaperMode)}
                  className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {(Object.keys(RECEIPT_PAPER_SPECS) as ReceiptPaperMode[]).map((key) => (
                    <option key={key} value={key}>
                      {RECEIPT_PAPER_SPECS[key].label}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={paperSize}
                  onChange={(e) => setPaperSize(e.target.value as PaperSizeOption)}
                  className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {(Object.keys(PAPER_SIZE_META) as PaperSizeOption[]).map((key) => (
                    <option key={key} value={key}>
                      {PAPER_SIZE_META[key].label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              {template === 'schedule_table' ? (
                <>
                  <label className="block text-xs font-semibold text-slate-700">Phạm vi thời gian</label>
                  <select
                    value={rangePreset}
                    onChange={(e) => setRangePreset(e.target.value as RangePreset)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="today">Hôm nay ({todayIso})</option>
                    <option value="week">7 ngày tới</option>
                    <option value="month">Tháng hiện tại</option>
                    <option value="all">Toàn bộ danh sách ({workItems.length})</option>
                  </select>
                </>
              ) : template === 'formal_notice' ? (
                <>
                  <label className="block text-xs font-semibold text-slate-700">
                    Chọn giấy mời / lịch cần in
                  </label>
                  <select
                    value={activeNoticeItem?.id || ''}
                    onChange={(e) => setSelectedNoticeId(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    {workItems.map((w) => (
                      <option key={w.id} value={w.id}>
                        [{w.code}] {w.title}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <label className="block text-xs font-semibold text-slate-700">
                    Chọn chuyến du lịch theo mã
                  </label>
                  <select
                    value={activeTravelTrip?.id || ''}
                    onChange={(e) => setSelectedTravelTripId(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    {travelTrips.length === 0 ? (
                      <option value="">Chưa có chuyến du lịch nào</option>
                    ) : (
                      travelTrips.map((t) => (
                        <option key={t.id} value={t.id}>
                          [{t.code}] {t.title} ({t.stopCount} điểm)
                        </option>
                      ))
                    )}
                  </select>
                </>
              )}
            </div>
          </div>

          {printStyle === 'receipt_script' && (
            <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
              <div className="flex items-center gap-5 flex-wrap">
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={asciiOnly}
                    onChange={(e) => setAsciiOnly(e.target.checked)}
                    className="w-4 h-4 accent-[#1E3A5F] rounded"
                  />
                  <span>Bỏ dấu tiếng Việt (ASCII cho máy in kim / ESC-POS đời cũ)</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showBarcode}
                    onChange={(e) => setShowBarcode(e.target.checked)}
                    className="w-4 h-4 accent-[#1E3A5F] rounded"
                  />
                  <span>Kèm mã vạch cuối phiếu</span>
                </label>
              </div>
              <div className="font-mono-tabular text-slate-500 whitespace-nowrap">
                {receiptSpec.cols} ký tự/dòng · {scriptLineCount} dòng
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Live Preview & Print Output */}
      {printStyle === 'receipt_script' ? (
        <div className="overflow-x-auto pb-6 flex justify-center">
          <div
            className="print-only-container"
            style={{ width: `${receiptSpec.previewWidthPx}px` }}
          >
            {/* Top serrated tear-off edge for thermal bill preview (screen only) */}
            {!receiptSpec.isTractorFeed && <div className="no-print receipt-serrated-top" />}

            <div
              className={`receipt-paper-sheet border-x border-slate-300 shadow-sm ${
                receiptSpec.isTractorFeed ? 'border-y flex items-stretch' : ''
              }`}
            >
              {/* Left tractor-feed sprocket margin for dot-matrix continuous paper (screen only) */}
              {receiptSpec.isTractorFeed && (
                <div
                  aria-hidden="true"
                  className="no-print tractor-feed-strip shrink-0 border-r border-dashed border-slate-300"
                />
              )}

              {/* Printable Monospace Script Content */}
              <div className="flex-1 min-w-0 px-4 sm:px-5 py-5">
                {template === 'travel_itinerary' && loadingTravelStops ? (
                  <div className="py-12 text-center text-xs font-mono-tabular text-slate-500">
                    DANG TAI CHI TIET LICH TRINH...
                  </div>
                ) : !receiptScriptText ? (
                  <div className="py-12 text-center text-xs font-mono-tabular text-slate-500">
                    CHUA CO DU LIEU DE TAO SCRIPT IN PHIEU.
                  </div>
                ) : (
                  <>
                    <pre
                      className="font-mono-tabular whitespace-pre overflow-x-auto text-slate-950 leading-[1.45] tracking-[-0.01em] select-all"
                      style={{ fontSize: `${receiptSpec.fontSizePx}px` }}
                    >
                      {receiptScriptText}
                    </pre>

                    {showBarcode && (
                      <div className="mt-4 pt-2 flex flex-col items-center justify-center print-break-avoid">
                        <svg
                          viewBox={`0 0 ${barcodeTotalWidth} 38`}
                          className="h-9 max-w-[85%] text-slate-950"
                          role="img"
                          aria-label={`Mã vạch ${barcodeCode}`}
                        >
                          {barcodeBars.map((bar, i) => (
                            <rect
                              key={i}
                              x={bar.x}
                              y={0}
                              width={bar.w}
                              height={38}
                              fill="currentColor"
                            />
                          ))}
                        </svg>
                        <div className="mt-1 text-[10px] font-mono-tabular tracking-[0.22em] text-slate-900">
                          *{barcodeCode.toUpperCase()}*
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Right tractor-feed sprocket margin for dot-matrix continuous paper (screen only) */}
              {receiptSpec.isTractorFeed && (
                <div
                  aria-hidden="true"
                  className="no-print tractor-feed-strip shrink-0 border-l border-dashed border-slate-300"
                />
              )}
            </div>

            {/* Bottom serrated tear-off edge for thermal bill preview (screen only) */}
            {!receiptSpec.isTractorFeed && <div className="no-print receipt-serrated-bottom" />}
          </div>
        </div>
      ) : (
      /* Standard Formal Paper Sheet (A4 / A3 / A5) */
      <div className="overflow-x-auto pb-4">
        <div
          className={`print-only-container mx-auto bg-white border border-slate-300 shadow-sm text-slate-900 ${
            isA3 ? 'p-8 sm:p-12' : 'p-6 sm:p-10'
          }`}
          style={{
            width: isLandscape ? (isA3 ? '1180px' : '980px') : isA3 ? '900px' : '794px',
            minHeight: isLandscape ? '680px' : '1050px',
          }}
        >
          {/* Formal Header */}
          <div className="flex items-start justify-between gap-6 pb-5 border-b-2 border-slate-900">
            <div className="space-y-1">
              <div className="text-xs font-bold tracking-wide text-slate-700">
                {settings?.organizationHeader || 'SỔ TAY CÔNG TÁC & LỊCH TRÌNH CÁ NHÂN'}
              </div>
              <div className="text-xs text-slate-600">
                Chủ sở hữu: <span className="font-semibold text-slate-900">{settings?.ownerTitle || 'Cá nhân'}</span>
              </div>
            </div>
            <div className="text-right text-xs text-slate-600 font-mono-tabular">
              <div>Ngày in: {todayIso}</div>
              <div>Khổ giấy: {paperMeta.shortLabel}</div>
            </div>
          </div>

          {template === 'schedule_table' ? (
            <div className="mt-6 space-y-5">
              <div className="text-center space-y-1">
                <h2 className={`${isA3 ? 'text-2xl' : 'text-xl'} font-bold text-slate-900`}>
                  LỊCH TRÌNH CÔNG TÁC & THEO DÕI CÔNG VIỆC
                </h2>
                <p className="text-xs text-slate-600">
                  Phạm vi:{' '}
                  {rangePreset === 'today'
                    ? `Ngày ${todayIso}`
                    : rangePreset === 'week'
                      ? `Từ ${todayIso} đến ${addDaysISO(todayIso, 7)}`
                      : rangePreset === 'month'
                        ? `Tháng ${todayIso.slice(5, 7)}/${todayIso.slice(0, 4)}`
                        : 'Toàn bộ lịch trình hiện có'}{' '}
                  · Tổng số: {filteredItems.length} hạng mục
                </p>
              </div>

              {filteredItems.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-500 border border-dashed border-slate-300">
                  Không có hạng mục công việc nào trong phạm vi thời gian đã chọn.
                </div>
              ) : (
                <table className={`w-full border-collapse border border-slate-800 ${isA3 ? 'text-sm' : 'text-xs'}`}>
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-slate-800 px-2.5 py-2 text-center w-10">STT</th>
                      <th className="border border-slate-800 px-2.5 py-2 text-left">Thời gian</th>
                      <th className="border border-slate-800 px-2.5 py-2 text-left">Mã / Phân loại</th>
                      <th className="border border-slate-800 px-2.5 py-2 text-left">Nội dung công việc / Dự án</th>
                      <th className="border border-slate-800 px-2.5 py-2 text-left">Địa điểm & Địa chỉ</th>
                      <th className="border border-slate-800 px-2.5 py-2 text-left">Liên hệ & Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item, index) => {
                      const loc = locationsMap.get(item.locationId);
                      const ct = item.contactId ? contactsMap.get(item.contactId) : undefined;
                      return (
                        <tr key={item.id} className="print-break-avoid align-top">
                          <td className="border border-slate-800 px-2 py-2 text-center font-mono-tabular">
                            {index + 1}
                          </td>
                          <td className="border border-slate-800 px-2.5 py-2 font-mono-tabular whitespace-nowrap">
                            <div className="font-semibold">{item.scheduledDate}</div>
                            <div>
                              {item.startTime}–{item.endTime}
                            </div>
                          </td>
                          <td className="border border-slate-800 px-2.5 py-2 whitespace-nowrap">
                            <div className="font-mono-tabular font-semibold">{item.code}</div>
                            <div className="text-slate-600">{WORK_TYPE_LABELS[item.itemType]}</div>
                          </td>
                          <td className="border border-slate-800 px-2.5 py-2">
                            <div className="font-semibold text-slate-900">{item.title}</div>
                            {item.projectCode && (
                              <div className="text-slate-600 mt-0.5">
                                Dự án: {item.projectCode}
                                {item.projectName ? ` — ${item.projectName}` : ''}
                              </div>
                            )}
                            {item.notes && <div className="text-slate-600 mt-0.5">{item.notes}</div>}
                          </td>
                          <td className="border border-slate-800 px-2.5 py-2">
                            {loc ? (
                              <>
                                <div className="font-semibold">
                                  [{loc.code}] {loc.name}
                                </div>
                                <div className="text-slate-700 mt-0.5">{loc.address}</div>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="border border-slate-800 px-2.5 py-2">
                            {ct && (
                              <div className="font-medium">
                                {ct.fullName}
                                {ct.phone ? ` (${ct.phone})` : ''}
                              </div>
                            )}
                            <div className="text-slate-700">
                              {STATUS_LABELS[item.status]} · {PRIORITY_LABELS[item.priority]}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ) : template === 'formal_notice' ? (
            /* Formal Schedule Notice / Invitation Sheet */
            <div className="mt-8 space-y-6">
              {!activeNoticeItem ? (
                <div className="py-12 text-center text-sm text-slate-500">
                  Chưa có hạng mục nào để tạo thông báo lịch trình.
                </div>
              ) : (
                (() => {
                  const loc = locationsMap.get(activeNoticeItem.locationId);
                  const ct = activeNoticeItem.contactId
                    ? contactsMap.get(activeNoticeItem.contactId)
                    : undefined;
                  return (
                    <>
                      <div className="text-center space-y-1.5">
                        <div className="text-xs font-mono-tabular text-slate-600">
                          Số tham chiếu: {activeNoticeItem.code}
                        </div>
                        <h2 className={`${isA3 ? 'text-3xl' : 'text-2xl'} font-bold text-slate-900`}>
                          THÔNG BÁO LỊCH TRÌNH CÔNG TÁC
                        </h2>
                        <div className="text-sm font-medium text-slate-700">
                          ({WORK_TYPE_LABELS[activeNoticeItem.itemType]} · Mức ưu tiên:{' '}
                          {PRIORITY_LABELS[activeNoticeItem.priority]})
                        </div>
                      </div>

                      <div className={`border border-slate-800 p-6 space-y-4 ${isA3 ? 'text-base' : 'text-sm'}`}>
                        <div>
                          <div className="text-xs font-semibold text-slate-600">Nội dung chính</div>
                          <div className="text-lg font-bold text-slate-900 mt-1">
                            {activeNoticeItem.title}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-200">
                          <div>
                            <div className="text-xs font-semibold text-slate-600">Thời gian</div>
                            <div className="font-mono-tabular font-semibold text-slate-900 mt-0.5">
                              {activeNoticeItem.startTime} – {activeNoticeItem.endTime}, ngày{' '}
                              {activeNoticeItem.scheduledDate}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-slate-600">Dự án liên quan</div>
                            <div className="font-medium text-slate-900 mt-0.5">
                              {activeNoticeItem.projectCode
                                ? `${activeNoticeItem.projectCode}${
                                    activeNoticeItem.projectName
                                      ? ` — ${activeNoticeItem.projectName}`
                                      : ''
                                  }`
                                : 'Lịch công tác độc lập'}
                            </div>
                          </div>
                        </div>

                        <div className="pt-3 border-t border-slate-200">
                          <div className="text-xs font-semibold text-slate-600">
                            Địa điểm tổ chức (Theo danh mục địa điểm)
                          </div>
                          {loc ? (
                            <div className="mt-1 space-y-0.5">
                              <div className="font-semibold text-slate-900">
                                [{loc.code}] {loc.name}
                              </div>
                              <div className="text-slate-700">Địa chỉ: {loc.address}</div>
                              {loc.notes && (
                                <div className="text-xs text-slate-600">Lưu ý: {loc.notes}</div>
                              )}
                            </div>
                          ) : (
                            <div className="mt-1 text-slate-600">Chưa cập nhật địa điểm</div>
                          )}
                        </div>

                        {ct && (
                          <div className="pt-3 border-t border-slate-200">
                            <div className="text-xs font-semibold text-slate-600">
                              Đầu mối liên hệ / Khách mời
                            </div>
                            <div className="mt-1">
                              <span className="font-semibold text-slate-900">{ct.fullName}</span>
                              {ct.relationship ? ` — ${ct.relationship}` : ''}
                              {ct.organization ? ` (${ct.organization})` : ''}
                              {ct.phone ? ` · SĐT: ${ct.phone}` : ''}
                            </div>
                          </div>
                        )}

                        {activeNoticeItem.notes && (
                          <div className="pt-3 border-t border-slate-200">
                            <div className="text-xs font-semibold text-slate-600">
                              Ghi chú & Hồ sơ chuẩn bị
                            </div>
                            <p className="mt-1 text-slate-800 whitespace-pre-line leading-relaxed">
                              {activeNoticeItem.notes}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="pt-8 flex justify-end">
                        <div className="text-center w-64 space-y-12 text-xs">
                          <div>
                            <div className="font-semibold text-slate-900">NGƯỜI LẬP LỊCH</div>
                            <div className="text-slate-500 italic">(Ký và ghi rõ họ tên)</div>
                          </div>
                          <div className="font-semibold text-slate-900">
                            {settings?.ownerTitle || 'Chủ sở hữu cá nhân'}
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()
              )}
            </div>
          ) : (
            /* Travel Itinerary Sheet (A -> B -> C -> ... -> N) */
            <div className="mt-6 space-y-5">
              {!activeTravelTrip ? (
                <div className="py-12 text-center text-sm text-slate-500 border border-dashed border-slate-300">
                  Chưa có chuyến du lịch nào để in lịch trình.
                </div>
              ) : (
                <>
                  <div className="text-center space-y-1">
                    <div className="text-xs font-mono-tabular font-semibold text-slate-700">
                      Mã chuyến: {activeTravelTrip.code} · {TRAVEL_TRIP_STATUS_LABELS[activeTravelTrip.status]}
                    </div>
                    <h2 className={`${isA3 ? 'text-2xl' : 'text-xl'} font-bold text-slate-900`}>
                      LỊCH TRÌNH DU LỊCH CHI TIẾT
                    </h2>
                    <div className="text-sm font-semibold text-slate-900">{activeTravelTrip.title}</div>
                    <p className="text-xs text-slate-600 font-mono-tabular">
                      Thời gian: {activeTravelTrip.startDate} → {activeTravelTrip.endDate} ·{' '}
                      {travelStops.length} điểm ({Math.max(0, travelStops.length - 1)} chặng)
                    </p>
                  </div>

                  {/* Trip Metadata & Totals Box */}
                  <div className={`border border-slate-800 p-3.5 grid grid-cols-2 sm:grid-cols-4 gap-3 ${isA3 ? 'text-sm' : 'text-xs'}`}>
                    <div>
                      <div className="text-slate-500">Tổng di chuyển</div>
                      <div className="font-mono-tabular font-semibold text-slate-900 mt-0.5">
                        {formatDurationVi(travelSummary.totalTransitMins)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Tổng thời gian hoạt động</div>
                      <div className="font-mono-tabular font-semibold text-slate-900 mt-0.5">
                        {formatDurationVi(travelSummary.totalActivityMins)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Phương tiện / Đoàn</div>
                      <div className="font-medium text-slate-900 mt-0.5">
                        {[activeTravelTrip.transportSummary, activeTravelTrip.travelers]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Dự trù ngân sách</div>
                      <div className="font-medium text-slate-900 mt-0.5">
                        {activeTravelTrip.budgetNote || '—'}
                      </div>
                    </div>
                    {activeTravelTrip.notes && (
                      <div className="col-span-2 sm:col-span-4 pt-2 border-t border-slate-200 text-slate-700">
                        <span className="font-semibold">Ghi chú chuyến đi:</span> {activeTravelTrip.notes}
                      </div>
                    )}
                  </div>

                  {loadingTravelStops ? (
                    <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-slate-300">
                      Đang tải chi tiết các điểm dừng của chuyến {activeTravelTrip.code}...
                    </div>
                  ) : travelStops.length === 0 ? (
                    <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-300">
                      Chuyến du lịch này chưa có điểm dừng nào (A → B → C...).
                    </div>
                  ) : (
                    <table className={`w-full border-collapse border border-slate-800 ${isA3 ? 'text-sm' : 'text-xs'}`}>
                      <thead>
                        <tr className="bg-slate-100">
                          <th className="border border-slate-800 px-2 py-2 text-center w-12">Điểm</th>
                          <th className="border border-slate-800 px-2.5 py-2 text-left">
                            Mã địa điểm & Địa chỉ
                          </th>
                          <th className="border border-slate-800 px-2.5 py-2 text-left">
                            Đến & Di chuyển
                          </th>
                          <th className="border border-slate-800 px-2.5 py-2 text-left">
                            Hoạt động tại điểm & Thời lượng
                          </th>
                          <th className="border border-slate-800 px-2.5 py-2 text-left">
                            Xuất phát chặng tiếp
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {travelStops.map((stop, idx) => {
                          const loc = locationsMap.get(stop.locationId);
                          const pointLabel = getStopPointLabel(idx);
                          const prevPointLabel = idx > 0 ? getStopPointLabel(idx - 1) : '';
                          const nextPointLabel =
                            idx < travelStops.length - 1 ? getStopPointLabel(idx + 1) : '';
                          const legMin = travelSummary.legMinutes[idx];
                          const depInfo = getStopDepartureDateTime(stop);
                          const isLast = idx === travelStops.length - 1;

                          return (
                            <tr key={stop.id} className="print-break-avoid align-top">
                              <td className="border border-slate-800 px-2 py-2 text-center font-mono-tabular font-bold">
                                {pointLabel}
                              </td>
                              <td className="border border-slate-800 px-2.5 py-2">
                                <div className="font-semibold text-slate-900">
                                  <span className="font-mono-tabular">
                                    [{loc?.code || stop.locationCode}]
                                  </span>{' '}
                                  {loc?.name || 'Địa điểm chưa đồng bộ'}
                                </div>
                                {loc?.address && (
                                  <div className="text-slate-700 mt-0.5">{loc.address}</div>
                                )}
                              </td>
                              <td className="border border-slate-800 px-2.5 py-2 font-mono-tabular whitespace-nowrap">
                                <div className="font-semibold text-slate-900">
                                  {stop.stopDate}
                                </div>
                                <div>Đến: {stop.arrivalTime}</div>
                                <div className="text-slate-600 mt-0.5 font-sans">
                                  {idx === 0
                                    ? 'Điểm xuất phát'
                                    : legMin !== null && legMin >= 0
                                      ? `Từ ${prevPointLabel}: ${formatDurationVi(legMin)}`
                                      : `Từ ${prevPointLabel}: lệch giờ`}
                                </div>
                              </td>
                              <td className="border border-slate-800 px-2.5 py-2">
                                <div className="font-semibold text-slate-900">
                                  {stop.activityTitle}
                                </div>
                                <div className="text-slate-700 mt-0.5">
                                  Thời lượng:{' '}
                                  <span className="font-mono-tabular font-medium">
                                    {formatDurationVi(stop.activityDurationMinutes)}
                                  </span>
                                </div>
                                {stop.notes && (
                                  <div className="text-slate-600 mt-0.5">{stop.notes}</div>
                                )}
                              </td>
                              <td className="border border-slate-800 px-2.5 py-2 whitespace-nowrap">
                                {isLast ? (
                                  <div className="text-slate-600">
                                    <div className="font-mono-tabular font-semibold text-slate-900">
                                      Kết thúc {depInfo.time}
                                    </div>
                                    {depInfo.date !== stop.stopDate && (
                                      <div className="font-mono-tabular text-[11px]">
                                        ({depInfo.date})
                                      </div>
                                    )}
                                    <div>Điểm cuối hành trình</div>
                                  </div>
                                ) : (
                                  <div>
                                    <div className="font-mono-tabular font-semibold text-slate-900">
                                      Đi {nextPointLabel}: {depInfo.time}
                                    </div>
                                    {depInfo.date !== stop.stopDate && (
                                      <div className="font-mono-tabular text-[11px] text-slate-600">
                                        Ngày {depInfo.date}
                                      </div>
                                    )}
                                    <div className="text-slate-700 mt-0.5">
                                      {TRAVEL_TRANSPORT_LABELS[stop.transportMode]}
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}

                  <div className="pt-6 flex justify-end">
                    <div className="text-center w-64 space-y-10 text-xs">
                      <div>
                        <div className="font-semibold text-slate-900">NGƯỜI LẬP LỊCH TRÌNH</div>
                        <div className="text-slate-500 italic">(Ký và ghi rõ họ tên)</div>
                      </div>
                      <div className="font-semibold text-slate-900">
                        {settings?.ownerTitle || 'Chủ sở hữu cá nhân'}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
};
