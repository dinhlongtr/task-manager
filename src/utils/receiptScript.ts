import {
  diffDateTimeMinutes,
  formatDurationVi,
  getStopDepartureDateTime,
  getStopPointLabel,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TRAVEL_TRANSPORT_LABELS,
  TRAVEL_TRIP_STATUS_LABELS,
  WORK_TYPE_LABELS,
  type ContactRecord,
  type LocationRecord,
  type TravelStopRecord,
  type TravelTripRecord,
  type UserSettingsRecord,
  type WorkItemRecord,
} from '../types';

export type ReceiptPaperMode = 'K80' | 'K58' | 'DOT_A4' | 'DOT_A5';

export interface ReceiptPaperSpec {
  id: ReceiptPaperMode;
  label: string;
  shortLabel: string;
  cols: number;
  cssPageSize: string;
  cssPageMargin: string;
  previewWidthPx: number;
  fontSizePx: number;
  isTractorFeed: boolean;
}

export const RECEIPT_PAPER_SPECS: Record<ReceiptPaperMode, ReceiptPaperSpec> = {
  K80: {
    id: 'K80',
    label: 'Hóa đơn K80 (80mm · 46 cột)',
    shortLabel: 'Bill K80',
    cols: 46,
    cssPageSize: '80mm auto',
    cssPageMargin: '3mm',
    previewWidthPx: 380,
    fontSizePx: 11.5,
    isTractorFeed: false,
  },
  K58: {
    id: 'K58',
    label: 'Hóa đơn K58 (58mm · 32 cột)',
    shortLabel: 'Bill K58',
    cols: 32,
    cssPageSize: '58mm auto',
    cssPageMargin: '2mm',
    previewWidthPx: 290,
    fontSizePx: 10.5,
    isTractorFeed: false,
  },
  DOT_A4: {
    id: 'DOT_A4',
    label: 'In kim liên tục A4 (80 cột)',
    shortLabel: 'In kim A4',
    cols: 80,
    cssPageSize: 'A4 portrait',
    cssPageMargin: '10mm',
    previewWidthPx: 760,
    fontSizePx: 12.5,
    isTractorFeed: true,
  },
  DOT_A5: {
    id: 'DOT_A5',
    label: 'In kim phiếu A5 (58 cột)',
    shortLabel: 'In kim A5',
    cols: 58,
    cssPageSize: 'A5 portrait',
    cssPageMargin: '8mm',
    previewWidthPx: 540,
    fontSizePx: 11.5,
    isTractorFeed: true,
  },
};

export function stripVietnameseDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/→/g, '->')
    .replace(/–|—/g, '-')
    .replace(/·/g, '|');
}

function norm(text: string, asciiOnly: boolean): string {
  const clean = (text || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  return asciiOnly ? stripVietnameseDiacritics(clean) : clean;
}

function repeatChar(ch: string, count: number): string {
  return ch.repeat(Math.max(0, count));
}

function hr(ch: '=' | '-' | '.', cols: number): string {
  return repeatChar(ch, cols);
}

function centerLine(text: string, cols: number): string {
  const s = text.trim();
  if (s.length >= cols) return s.slice(0, cols);
  const leftPad = Math.floor((cols - s.length) / 2);
  return `${repeatChar(' ', leftPad)}${s}`;
}

function pairLine(left: string, right: string, cols: number): string {
  const l = left.trim();
  const r = right.trim();
  if (l.length + r.length + 1 <= cols) {
    return `${l}${repeatChar(' ', cols - l.length - r.length)}${r}`;
  }
  const maxLeft = Math.max(4, cols - r.length - 1);
  if (r.length >= cols - 4) {
    return `${l}\n${repeatChar(' ', Math.max(0, cols - r.length))}${r}`;
  }
  return `${l.slice(0, maxLeft)} ${r}`;
}

function wrapText(text: string, width: number, prefix = ''): string[] {
  const effectiveWidth = Math.max(8, width - prefix.length);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > effectiveWidth) {
      if (current) {
        lines.push(prefix + current);
        current = '';
      }
      let idx = 0;
      while (idx < word.length) {
        lines.push(prefix + word.slice(idx, idx + effectiveWidth));
        idx += effectiveWidth;
      }
      continue;
    }

    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= effectiveWidth) {
      current = `${current} ${word}`;
    } else {
      lines.push(prefix + current);
      current = word;
    }
  }

  if (current) {
    lines.push(prefix + current);
  }
  return lines;
}

function kvLines(label: string, value: string, cols: number): string[] {
  const cleanVal = value.trim() || '-';
  const prefix = `${label}: `;
  if (prefix.length + cleanVal.length <= cols) {
    return [`${prefix}${cleanVal}`];
  }
  const firstRoom = Math.max(8, cols - prefix.length);
  const wrapped = wrapText(cleanVal, cols, '');
  if (wrapped.length === 0) return [`${prefix}-`];
  if (wrapped[0].length <= firstRoom && wrapped.length === 1) {
    return [`${prefix}${wrapped[0]}`];
  }
  const indent = repeatChar(' ', Math.min(prefix.length, cols <= 34 ? 2 : 12));
  const out: string[] = [];
  const restLines = wrapText(cleanVal, cols, indent);
  if (prefix.length + cleanVal.length <= cols * 1.4 && cols >= 44) {
    // Fit start on same line when wide enough
    const firstChunk = wrapText(cleanVal, cols - prefix.length, '');
    out.push(`${prefix}${firstChunk[0] || ''}`);
    for (let i = 1; i < firstChunk.length; i++) {
      out.push(`${repeatChar(' ', prefix.length)}${firstChunk[i]}`);
    }
    return out;
  }
  out.push(prefix.trimEnd());
  return out.concat(restLines);
}

function formatPrintTimestamp(todayIso: string): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${todayIso} ${hh}:${mm}`;
}

export interface TravelReceiptInput {
  trip: TravelTripRecord;
  stops: TravelStopRecord[];
  locationsMap: Map<string, LocationRecord>;
  settings: UserSettingsRecord | null;
  todayIso: string;
  cols: number;
  asciiOnly: boolean;
}

export function buildTravelReceiptScript({
  trip,
  stops,
  locationsMap,
  settings,
  todayIso,
  cols,
  asciiOnly,
}: TravelReceiptInput): string {
  const lines: string[] = [];
  const org = norm(
    settings?.organizationHeader || 'SỔ TAY CÔNG TÁC & LỊCH TRÌNH',
    asciiOnly
  ).toUpperCase();
  const owner = norm(settings?.ownerTitle || 'Cá nhân', asciiOnly);
  const arrow = asciiOnly ? '->' : '→';

  lines.push(hr('=', cols));
  wrapText(org, cols).forEach((l) => lines.push(centerLine(l, cols)));
  lines.push(centerLine(norm('PHIẾU LỊCH TRÌNH DU LỊCH', asciiOnly), cols));
  lines.push(hr('=', cols));

  lines.push(pairLine(norm('MÃ CHUYẾN', asciiOnly), norm(trip.code, asciiOnly), cols));
  lines.push(
    pairLine(
      norm('TRẠNG THÁI', asciiOnly),
      norm(TRAVEL_TRIP_STATUS_LABELS[trip.status], asciiOnly),
      cols
    )
  );
  lines.push(
    pairLine(
      norm('THỜI GIAN', asciiOnly),
      `${trip.startDate} ${arrow} ${trip.endDate}`,
      cols
    )
  );
  lines.push(pairLine(norm('NGÀY IN', asciiOnly), formatPrintTimestamp(todayIso), cols));
  lines.push(pairLine(norm('NGƯỜI LẬP', asciiOnly), owner, cols));
  lines.push(hr('-', cols));

  lines.push(...kvLines(norm('TÊN CHUYẾN', asciiOnly), norm(trip.title, asciiOnly), cols));
  if (trip.transportSummary) {
    lines.push(
      ...kvLines(norm('PHƯƠNG TIỆN', asciiOnly), norm(trip.transportSummary, asciiOnly), cols)
    );
  }
  if (trip.travelers) {
    lines.push(...kvLines(norm('THÀNH VIÊN', asciiOnly), norm(trip.travelers, asciiOnly), cols));
  }
  if (trip.budgetNote) {
    lines.push(...kvLines(norm('DỰ TRÙ', asciiOnly), norm(trip.budgetNote, asciiOnly), cols));
  }
  if (trip.routePreview) {
    lines.push(...kvLines(norm('TUYẾN MÃ', asciiOnly), norm(trip.routePreview, asciiOnly), cols));
  }
  if (trip.notes) {
    lines.push(...kvLines(norm('GHI CHÚ', asciiOnly), norm(trip.notes, asciiOnly), cols));
  }

  lines.push(hr('=', cols));
  lines.push(
    centerLine(
      norm(`CHI TIẾT HÀNH TRÌNH (${stops.length} ĐIỂM)`, asciiOnly),
      cols
    )
  );
  lines.push(hr('=', cols));

  let totalActivityMins = 0;
  let totalTransitMins = 0;

  if (stops.length === 0) {
    lines.push(centerLine(norm('(Chưa có điểm dừng nào)', asciiOnly), cols));
  } else {
    stops.forEach((stop, idx) => {
      const loc = locationsMap.get(stop.locationId);
      const liveCode = norm(loc?.code || stop.locationCode, asciiOnly);
      const locName = norm(loc?.name || 'Địa điểm chưa đồng bộ', asciiOnly);
      const locAddress = norm(loc?.address || '', asciiOnly);
      const pointLabel = getStopPointLabel(idx);
      const isFirst = idx === 0;
      const isLast = idx === stops.length - 1;
      const depInfo = getStopDepartureDateTime(stop);

      totalActivityMins += Math.max(0, stop.activityDurationMinutes);

      // Incoming transit connector from previous stop
      if (idx > 0) {
        const prevStop = stops[idx - 1];
        const prevLoc = locationsMap.get(prevStop.locationId);
        const prevCode = norm(prevLoc?.code || prevStop.locationCode, asciiOnly);
        const prevLabel = getStopPointLabel(idx - 1);
        const prevDep = getStopDepartureDateTime(prevStop);
        const legMins = diffDateTimeMinutes(
          prevDep.date,
          prevDep.time,
          stop.stopDate,
          stop.arrivalTime
        );
        if (legMins > 0) totalTransitMins += legMins;

        const modeText = norm(TRAVEL_TRANSPORT_LABELS[prevStop.transportMode], asciiOnly);
        const legDurText =
          legMins < 0
            ? norm(`! LỆCH GIỜ (${formatDurationVi(legMins)})`, asciiOnly)
            : norm(formatDurationVi(legMins), asciiOnly);

        lines.push(hr('.', cols));
        lines.push(
          pairLine(
            `  | ${norm(`CHẶNG ${idx}`, asciiOnly)}: ${prevLabel}(${prevCode}) ${arrow} ${pointLabel}(${liveCode})`,
            `[${modeText}]`,
            cols
          )
        );
        lines.push(
          pairLine(
            `  v ${prevDep.time} ${arrow} ${stop.arrivalTime}`,
            norm(`Di chuyển: ${legDurText}`, asciiOnly),
            cols
          )
        );
        lines.push(hr('.', cols));
      }

      // Stop header line
      const roleTag = isFirst
        ? norm('XUẤT PHÁT', asciiOnly)
        : isLast
          ? norm('ĐIỂM CUỐI', asciiOnly)
          : norm(`ĐIỂM ${pointLabel}`, asciiOnly);

      lines.push(
        pairLine(
          `[${pointLabel}] ${liveCode} (${roleTag})`,
          stop.stopDate,
          cols
        )
      );

      wrapText(locName, cols, '    ').forEach((l) => lines.push(l));
      if (locAddress) {
        wrapText(norm(`ĐC: ${locAddress}`, asciiOnly), cols, '    ').forEach((l) => lines.push(l));
      }

      const arrLabel = isFirst ? norm('Tập trung', asciiOnly) : norm('Đến nơi', asciiOnly);
      const durLabel = norm(formatDurationVi(stop.activityDurationMinutes), asciiOnly);
      const depDateSuffix = depInfo.date !== stop.stopDate ? ` (${depInfo.date})` : '';

      lines.push(
        pairLine(
          `    ${arrLabel}: ${stop.arrivalTime}`,
          norm(`Lưu lại: ${durLabel}`, asciiOnly),
          cols
        )
      );

      wrapText(
        norm(`Hoạt động: ${stop.activityTitle}`, asciiOnly),
        cols,
        '    '
      ).forEach((l) => lines.push(l));

      if (stop.notes) {
        wrapText(norm(`Ghi chú  : ${stop.notes}`, asciiOnly), cols, '    ').forEach((l) =>
          lines.push(l)
        );
      }

      if (isLast) {
        lines.push(
          pairLine(
            `    ${norm('Kết thúc', asciiOnly)}: ${depInfo.time}${depDateSuffix}`,
            norm('HOÀN TẤT', asciiOnly),
            cols
          )
        );
      } else {
        const nextLabel = getStopPointLabel(idx + 1);
        lines.push(
          pairLine(
            `    ${norm(`Xuất phát ${arrow} ${nextLabel}`, asciiOnly)}: ${depInfo.time}${depDateSuffix}`,
            norm(TRAVEL_TRANSPORT_LABELS[stop.transportMode], asciiOnly),
            cols
          )
        );
      }
    });
  }

  lines.push(hr('=', cols));
  lines.push(
    pairLine(
      norm('TỔNG SỐ ĐIỂM / CHẶNG', asciiOnly),
      `${stops.length} / ${Math.max(0, stops.length - 1)}`,
      cols
    )
  );
  lines.push(
    pairLine(
      norm('TỔNG THỜI GIAN DI CHUYỂN', asciiOnly),
      norm(formatDurationVi(totalTransitMins), asciiOnly),
      cols
    )
  );
  lines.push(
    pairLine(
      norm('TỔNG THỜI GIAN HOẠT ĐỘNG', asciiOnly),
      norm(formatDurationVi(totalActivityMins), asciiOnly),
      cols
    )
  );
  lines.push(
    pairLine(
      norm('TỔNG THỜI LƯỢNG HÀNH TRÌNH', asciiOnly),
      norm(formatDurationVi(totalTransitMins + totalActivityMins), asciiOnly),
      cols
    )
  );
  lines.push(hr('=', cols));
  lines.push(centerLine(norm(`*** MÃ CHUYẾN: ${trip.code} ***`, asciiOnly), cols));
  lines.push(centerLine(norm('CHÚC CHUYẾN ĐI THUẬN LỢI & AN TOÀN', asciiOnly), cols));
  lines.push(hr('-', cols));

  return lines.join('\n');
}

export interface ScheduleReceiptInput {
  items: WorkItemRecord[];
  rangeLabel: string;
  locationsMap: Map<string, LocationRecord>;
  contactsMap: Map<string, ContactRecord>;
  settings: UserSettingsRecord | null;
  todayIso: string;
  cols: number;
  asciiOnly: boolean;
}

export function buildScheduleReceiptScript({
  items,
  rangeLabel,
  locationsMap,
  contactsMap,
  settings,
  todayIso,
  cols,
  asciiOnly,
}: ScheduleReceiptInput): string {
  const lines: string[] = [];
  const org = norm(
    settings?.organizationHeader || 'SỔ TAY CÔNG TÁC & LỊCH TRÌNH',
    asciiOnly
  ).toUpperCase();
  const owner = norm(settings?.ownerTitle || 'Cá nhân', asciiOnly);

  lines.push(hr('=', cols));
  wrapText(org, cols).forEach((l) => lines.push(centerLine(l, cols)));
  lines.push(centerLine(norm('BẢNG KÊ LỊCH TRÌNH CÔNG TÁC', asciiOnly), cols));
  lines.push(hr('=', cols));
  lines.push(pairLine(norm('PHẠM VI', asciiOnly), norm(rangeLabel, asciiOnly), cols));
  lines.push(pairLine(norm('NGÀY IN', asciiOnly), formatPrintTimestamp(todayIso), cols));
  lines.push(pairLine(norm('NGƯỜI LẬP', asciiOnly), owner, cols));
  lines.push(pairLine(norm('TỔNG HẠNG MỤC', asciiOnly), String(items.length), cols));
  lines.push(hr('=', cols));

  if (items.length === 0) {
    lines.push(centerLine(norm('(Không có hạng mục nào trong phạm vi)', asciiOnly), cols));
  } else {
    items.forEach((item, index) => {
      const loc = locationsMap.get(item.locationId);
      const ct = item.contactId ? contactsMap.get(item.contactId) : undefined;

      if (index > 0) {
        lines.push(hr('-', cols));
      }

      lines.push(
        pairLine(
          `${String(index + 1).padStart(2, '0')}. [${norm(item.code, asciiOnly)}] ${norm(
            WORK_TYPE_LABELS[item.itemType],
            asciiOnly
          )}`,
          `${item.scheduledDate} ${item.startTime}-${item.endTime}`,
          cols
        )
      );
      wrapText(norm(item.title, asciiOnly), cols, '    ').forEach((l) => lines.push(l));

      if (item.projectCode) {
        wrapText(
          norm(
            `Dự án: ${item.projectCode}${item.projectName ? ` - ${item.projectName}` : ''}`,
            asciiOnly
          ),
          cols,
          '    '
        ).forEach((l) => lines.push(l));
      }

      if (loc) {
        wrapText(
          norm(`Địa điểm: [${loc.code}] ${loc.name}`, asciiOnly),
          cols,
          '    '
        ).forEach((l) => lines.push(l));
        if (loc.address) {
          wrapText(norm(`ĐC: ${loc.address}`, asciiOnly), cols, '    ').forEach((l) =>
            lines.push(l)
          );
        }
      }

      if (ct) {
        wrapText(
          norm(`Liên hệ: ${ct.fullName}${ct.phone ? ` (${ct.phone})` : ''}`, asciiOnly),
          cols,
          '    '
        ).forEach((l) => lines.push(l));
      }

      lines.push(
        pairLine(
          `    ${norm(`Trạng thái: ${STATUS_LABELS[item.status]}`, asciiOnly)}`,
          norm(`Ưu tiên: ${PRIORITY_LABELS[item.priority]}`, asciiOnly),
          cols
        )
      );

      if (item.notes) {
        wrapText(norm(`Ghi chú: ${item.notes}`, asciiOnly), cols, '    ').forEach((l) =>
          lines.push(l)
        );
      }
    });
  }

  lines.push(hr('=', cols));
  lines.push(pairLine(norm('TỔNG CỘNG', asciiOnly), norm(`${items.length} hạng mục`, asciiOnly), cols));
  lines.push(centerLine(norm('*** HẾT BẢNG LỊCH CÔNG TÁC ***', asciiOnly), cols));
  lines.push(hr('-', cols));

  return lines.join('\n');
}

export interface NoticeReceiptInput {
  item: WorkItemRecord;
  locationsMap: Map<string, LocationRecord>;
  contactsMap: Map<string, ContactRecord>;
  settings: UserSettingsRecord | null;
  todayIso: string;
  cols: number;
  asciiOnly: boolean;
}

export function buildNoticeReceiptScript({
  item,
  locationsMap,
  contactsMap,
  settings,
  todayIso,
  cols,
  asciiOnly,
}: NoticeReceiptInput): string {
  const lines: string[] = [];
  const org = norm(
    settings?.organizationHeader || 'SỔ TAY CÔNG TÁC & LỊCH TRÌNH',
    asciiOnly
  ).toUpperCase();
  const owner = norm(settings?.ownerTitle || 'Cá nhân', asciiOnly);
  const loc = locationsMap.get(item.locationId);
  const ct = item.contactId ? contactsMap.get(item.contactId) : undefined;

  lines.push(hr('=', cols));
  wrapText(org, cols).forEach((l) => lines.push(centerLine(l, cols)));
  lines.push(centerLine(norm('PHIẾU THÔNG BÁO LỊCH CÔNG TÁC', asciiOnly), cols));
  lines.push(hr('=', cols));

  lines.push(pairLine(norm('SỐ THAM CHIẾU', asciiOnly), norm(item.code, asciiOnly), cols));
  lines.push(
    pairLine(norm('PHÂN LOẠI', asciiOnly), norm(WORK_TYPE_LABELS[item.itemType], asciiOnly), cols)
  );
  lines.push(
    pairLine(norm('MỨC ƯU TIÊN', asciiOnly), norm(PRIORITY_LABELS[item.priority], asciiOnly), cols)
  );
  lines.push(
    pairLine(norm('TRẠNG THÁI', asciiOnly), norm(STATUS_LABELS[item.status], asciiOnly), cols)
  );
  lines.push(hr('-', cols));

  lines.push(...kvLines(norm('NỘI DUNG', asciiOnly), norm(item.title, asciiOnly), cols));
  lines.push(
    pairLine(
      norm('THỜI GIAN', asciiOnly),
      `${item.startTime}-${item.endTime} (${item.scheduledDate})`,
      cols
    )
  );

  if (item.projectCode) {
    lines.push(
      ...kvLines(
        norm('DỰ ÁN', asciiOnly),
        norm(`${item.projectCode}${item.projectName ? ` - ${item.projectName}` : ''}`, asciiOnly),
        cols
      )
    );
  }

  lines.push(hr('-', cols));
  if (loc) {
    lines.push(...kvLines(norm('MÃ ĐỊA ĐIỂM', asciiOnly), norm(loc.code, asciiOnly), cols));
    lines.push(...kvLines(norm('ĐỊA ĐIỂM', asciiOnly), norm(loc.name, asciiOnly), cols));
    lines.push(...kvLines(norm('ĐỊA CHỈ', asciiOnly), norm(loc.address, asciiOnly), cols));
    if (loc.notes) {
      lines.push(...kvLines(norm('CHỈ ĐƯỜNG', asciiOnly), norm(loc.notes, asciiOnly), cols));
    }
  } else {
    lines.push(norm('ĐỊA ĐIỂM: Chưa cập nhật', asciiOnly));
  }

  if (ct) {
    lines.push(hr('-', cols));
    lines.push(
      ...kvLines(
        norm('ĐẦU MỐI', asciiOnly),
        norm(
          `${ct.fullName}${ct.organization ? ` (${ct.organization})` : ''}${ct.phone ? ` - ${ct.phone}` : ''}`,
          asciiOnly
        ),
        cols
      )
    );
  }

  if (item.notes) {
    lines.push(hr('-', cols));
    lines.push(...kvLines(norm('GHI CHÚ', asciiOnly), norm(item.notes, asciiOnly), cols));
  }

  lines.push(hr('=', cols));
  lines.push(pairLine(norm('NGÀY IN', asciiOnly), formatPrintTimestamp(todayIso), cols));
  lines.push(pairLine(norm('NGƯỜI LẬP', asciiOnly), owner, cols));
  lines.push('');
  lines.push(centerLine(norm('*** XIN CẢM ƠN ***', asciiOnly), cols));
  lines.push(hr('-', cols));

  return lines.join('\n');
}

/**
 * Generates deterministic monochrome barcode bar widths for visual receipt footer.
 */
export function buildBarcodeSegments(code: string): Array<{ x: number; w: number }> {
  const seed = (code || 'SO-TAY-CONG-TAC').toUpperCase();
  const bars: Array<{ x: number; w: number }> = [];
  let cursor = 0;

  // Start guard
  bars.push({ x: cursor, w: 2 });
  cursor += 3;
  bars.push({ x: cursor, w: 1 });
  cursor += 3;

  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    for (let bit = 0; bit < 5; bit++) {
      const isWide = ((ch >> bit) & 1) === 1;
      const barW = isWide ? 2.4 : 1.1;
      const gapW = ((ch + bit) % 2 === 0) ? 1.2 : 2.1;
      bars.push({ x: cursor, w: barW });
      cursor += barW + gapW;
    }
  }

  // End guard
  bars.push({ x: cursor, w: 1 });
  cursor += 2.5;
  bars.push({ x: cursor, w: 2 });
  return bars;
}
