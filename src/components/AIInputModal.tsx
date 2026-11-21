import React, { useRef, useState } from 'react';
import { Check, ImagePlus, Sparkles, Trash2, X } from 'lucide-react';
import {
  getLocalTodayISO,
  WORK_TYPE_LABELS,
  type AIExtractedPayload,
  type ContactRecord,
  type LocationRecord,
} from '../types';
import {
  createContact,
  createLocation,
  createWorkItem,
} from '../services/firestoreService';

interface AIInputModalProps {
  open: boolean;
  ownerId: string;
  locations: LocationRecord[];
  contacts: ContactRecord[];
  onClose: () => void;
  onCommitted: (msg: string) => void;
}

export const AIInputModal: React.FC<AIInputModalProps> = ({
  open,
  ownerId,
  locations,
  contacts,
  onClose,
  onCommitted,
}) => {
  const [promptText, setPromptText] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string>('');
  const [imageMimeType, setImageMimeType] = useState<string>('');
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [extracted, setExtracted] = useState<AIExtractedPayload | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const compressImageFile = (file: File): Promise<{ dataUrl: string; base64: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
      const readRaw = () => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const commaIdx = result.indexOf(',');
          resolve({
            dataUrl: result,
            base64: commaIdx !== -1 ? result.slice(commaIdx + 1) : '',
            mimeType: file.type || 'image/jpeg',
          });
        };
        reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh tải lên.'));
        reader.readAsDataURL(file);
      };

      if (!file.type.startsWith('image/') || file.size < 180 * 1024) {
        readRaw();
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const MAX_DIM = 1280;
          let { width, height } = img;
          if (width > MAX_DIM || height > MAX_DIM) {
            if (width >= height) {
              height = Math.round((height * MAX_DIM) / width);
              width = MAX_DIM;
            } else {
              width = Math.round((width * MAX_DIM) / height);
              height = MAX_DIM;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(objectUrl);
            readRaw();
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          URL.revokeObjectURL(objectUrl);
          const commaIdx = dataUrl.indexOf(',');
          resolve({
            dataUrl,
            base64: commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : '',
            mimeType: 'image/jpeg',
          });
        } catch {
          URL.revokeObjectURL(objectUrl);
          readRaw();
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        readRaw();
      };
      img.src = objectUrl;
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg('Ảnh tải lên không được vượt quá 10MB.');
      return;
    }
    setErrorMsg('');
    try {
      const compressed = await compressImageFile(file);
      setImagePreview(compressed.dataUrl);
      setImageBase64(compressed.base64);
      setImageMimeType(compressed.mimeType);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể xử lý ảnh tải lên.');
    }
  };

  const clearImage = () => {
    setImagePreview(null);
    setImageBase64('');
    setImageMimeType('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAnalyze = async () => {
    if (!promptText.trim() && !imageBase64) {
      setErrorMsg('Vui lòng nhập mô tả lịch trình hoặc tải lên hình ảnh giấy mời.');
      return;
    }
    setAnalyzing(true);
    setErrorMsg('');
    setExtracted(null);

    try {
      const res = await fetch('/api/ai/parse-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: promptText.trim(),
          imageBase64,
          imageMimeType,
          todayDate: getLocalTodayISO(),
          existingLocations: locations.slice(0, 25).map((l) => ({
            id: l.id,
            code: l.code,
            name: l.name,
            address: l.address,
          })),
          existingContacts: contacts.slice(0, 25).map((c) => ({
            id: c.id,
            code: c.code,
            fullName: c.fullName,
            organization: c.organization,
            phone: c.phone,
          })),
        }),
      });
      const rawText = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
      } catch {
        if (res.status === 504) {
          throw new Error(
            'Hệ thống AI xử lý quá thời gian chờ trên máy chủ (HTTP 504). Vui lòng rút gọn nội dung hoặc bấm "Phân tích bằng AI" lại.'
          );
        }
        if (res.status === 413) {
          throw new Error(
            'Ảnh hoặc nội dung gửi lên vượt giới hạn máy chủ (HTTP 413). Vui lòng chọn ảnh nhẹ hơn hoặc cắt gọn văn bản.'
          );
        }
        throw new Error(
          res.status === 404
            ? 'Không tìm thấy endpoint /api/ai/parse-input trên máy chủ (404). Hãy đảm bảo thư mục api/ đã được đẩy lên Vercel.'
            : `Máy chủ trả về phản hồi không hợp lệ (HTTP ${res.status}).`
        );
      }
      if (!res.ok) {
        throw new Error(String(data.error || 'Không thể phân tích dữ liệu bằng Google AI.'));
      }
      setExtracted(data as unknown as AIExtractedPayload);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi kết nối Google AI.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSaveExtracted = async () => {
    if (!extracted) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const createdLocationIds = new Map<string, string>();
      const createdContactIds = new Map<string, string>();

      // 1. Create suggested new locations first so foreign keys exist in Firestore
      for (const loc of extracted.suggestedLocations || []) {
        const newId = await createLocation(ownerId, {
          code: loc.code,
          name: loc.name,
          address: loc.address,
          category: loc.category,
          notes: loc.notes,
        });
        createdLocationIds.set(loc.tempKey, newId);
      }

      // Ensure we always have at least one valid location ID if AI left location unmatched
      let fallbackLocId = locations[0]?.id || Array.from(createdLocationIds.values())[0] || '';
      if (!fallbackLocId && (extracted.workItems || []).length > 0) {
        fallbackLocId = await createLocation(ownerId, {
          code: 'DD-CANHAN',
          name: 'Văn phòng Cá nhân',
          address: 'Địa điểm mặc định',
          category: 'office',
          notes: 'Tạo tự động từ nhập liệu AI',
        });
      }

      // 2. Create suggested new contacts next
      for (const ct of extracted.suggestedContacts || []) {
        const newId = await createContact(ownerId, {
          code: ct.code,
          fullName: ct.fullName,
          group: ct.group,
          relationship: ct.relationship,
          organization: ct.organization,
          phone: ct.phone,
          email: ct.email,
          locationId: '',
          address: '',
          notes: ct.notes,
        });
        createdContactIds.set(ct.tempKey, newId);
      }

      // 3. Create work items with verified relational IDs
      const existingLocSet = new Set(locations.map((l) => l.id));
      const existingContactSet = new Set(contacts.map((c) => c.id));

      for (const wi of extracted.workItems || []) {
        let resolvedLocationId = '';
        if (wi.matchedLocationId && existingLocSet.has(wi.matchedLocationId)) {
          resolvedLocationId = wi.matchedLocationId;
        } else if (wi.locationTempKey && createdLocationIds.has(wi.locationTempKey)) {
          resolvedLocationId = createdLocationIds.get(wi.locationTempKey)!;
        } else {
          resolvedLocationId = fallbackLocId;
        }

        let resolvedContactId = '';
        if (wi.matchedContactId && existingContactSet.has(wi.matchedContactId)) {
          resolvedContactId = wi.matchedContactId;
        } else if (wi.contactTempKey && createdContactIds.has(wi.contactTempKey)) {
          resolvedContactId = createdContactIds.get(wi.contactTempKey)!;
        }

        await createWorkItem(ownerId, {
          itemType: wi.itemType,
          code: wi.code,
          title: wi.title,
          projectCode: wi.projectCode,
          projectName: wi.projectName,
          locationId: resolvedLocationId,
          contactId: resolvedContactId,
          scheduledDate: wi.scheduledDate,
          startTime: wi.startTime,
          endTime: wi.endTime,
          priority: wi.priority,
          status: 'pending',
          reminderMinutes: wi.reminderMinutes,
          notes: wi.notes,
        });
      }

      const totalSaved =
        (extracted.workItems?.length || 0) +
        (extracted.suggestedLocations?.length || 0) +
        (extracted.suggestedContacts?.length || 0);

      setPromptText('');
      clearImage();
      setExtracted(null);
      onCommitted(`Đã lưu tự động ${totalSaved} bản ghi từ AI lên đám mây.`);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi khi lưu dữ liệu trích xuất.');
    } finally {
      setSaving(false);
    }
  };

  const removeWorkItemAt = (idx: number) => {
    if (!extracted) return;
    setExtracted({
      ...extracted,
      workItems: extracted.workItems.filter((_, i) => i !== idx),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#1E3A5F]" />
            <h2 className="text-base font-semibold text-slate-900">
              Nhập dữ liệu thông minh bằng Google AI
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            Dán tin nhắn, email, ghi chú tự nhiên hoặc tải ảnh chụp giấy mời. Google AI sẽ tự động tách{' '}
            <strong className="text-slate-900">Mã công việc/giấy mời</strong>,{' '}
            <strong className="text-slate-900">Thời gian</strong>,{' '}
            <strong className="text-slate-900">Địa điểm</strong> và{' '}
            <strong className="text-slate-900">Danh bạ liên hệ</strong> rồi liên kết vào đúng bảng dữ liệu.
          </p>

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {errorMsg}
            </div>
          )}

          <div className="space-y-2">
            <textarea
              rows={4}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="Ví dụ: Sáng mai 8h30 họp nghiệm thu dự án DA-HTD26 tại UBND Quận 1 số 47 Lê Duẩn theo giấy mời số GM-45/UBND, gặp anh Minh 0909123456, nhắc trước 30 phút."
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
            />

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[40px] inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100"
                >
                  <ImagePlus className="w-4 h-4" />
                  Đính kèm ảnh giấy mời / lịch họp
                </button>
                {imagePreview && (
                  <button
                    type="button"
                    onClick={clearImage}
                    className="text-xs text-red-700 hover:underline"
                  >
                    Bỏ ảnh
                  </button>
                )}
              </div>

              <button
                type="button"
                disabled={analyzing}
                onClick={handleAnalyze}
                className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                {analyzing ? 'Đang phân tích dữ liệu...' : 'Phân tích bằng AI'}
              </button>
            </div>

            {imagePreview && (
              <div className="pt-2">
                <img
                  src={imagePreview}
                  alt="Ảnh giấy mời tải lên"
                  className="max-h-44 rounded-lg border border-slate-200 object-contain"
                />
              </div>
            )}
          </div>

          {/* Preview Extracted Entities */}
          {extracted && (
            <div className="pt-4 border-t border-slate-200 space-y-4">
              <div className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                {extracted.summary || 'AI đã trích xuất xong dữ liệu. Vui lòng kiểm tra trước khi lưu.'}
              </div>

              {extracted.suggestedLocations.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-700">
                    Địa điểm mới sẽ được thêm vào bảng Địa điểm ({extracted.suggestedLocations.length})
                  </h3>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                    {extracted.suggestedLocations.map((loc) => (
                      <div key={loc.tempKey} className="p-3 text-xs space-y-0.5">
                        <div className="font-mono-tabular font-semibold text-[#1E3A5F]">
                          {loc.code} · <span className="font-sans text-slate-900">{loc.name}</span>
                        </div>
                        <div className="text-slate-600">{loc.address}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {extracted.suggestedContacts.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-700">
                    Liên hệ mới sẽ được thêm vào Danh bạ ({extracted.suggestedContacts.length})
                  </h3>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                    {extracted.suggestedContacts.map((ct) => (
                      <div key={ct.tempKey} className="p-3 text-xs space-y-0.5">
                        <div className="font-semibold text-slate-900">
                          <span className="font-mono-tabular text-[#1E3A5F]">{ct.code}</span> ·{' '}
                          {ct.fullName}
                        </div>
                        <div className="text-slate-600">
                          {[ct.relationship, ct.organization, ct.phone].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-700">
                  Công việc / Dự án / Giấy mời sẽ được lưu ({extracted.workItems.length})
                </h3>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {extracted.workItems.map((wi, idx) => (
                    <div key={`${wi.code}-${idx}`} className="p-3 flex items-start justify-between gap-3">
                      <div className="space-y-1 text-xs min-w-0">
                        <div className="font-mono-tabular text-slate-500 flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-slate-900">{wi.code}</span>
                          <span>·</span>
                          <span>{WORK_TYPE_LABELS[wi.itemType] || 'Công việc'}</span>
                          <span>·</span>
                          <span>
                            {wi.scheduledDate} ({wi.startTime}–{wi.endTime})
                          </span>
                          <span>·</span>
                          <span>Nhắc trước {wi.reminderMinutes}p</span>
                        </div>
                        <div className="text-sm font-semibold text-slate-900">{wi.title}</div>
                        {wi.notes && <div className="text-slate-600">{wi.notes}</div>}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeWorkItemAt(idx)}
                        aria-label="Bỏ mục này"
                        className="p-1.5 text-slate-400 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setExtracted(null)}
                  className="min-h-[42px] px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Phân tích lại
                </button>
                <button
                  type="button"
                  disabled={saving || extracted.workItems.length === 0}
                  onClick={handleSaveExtracted}
                  className="min-h-[42px] inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  {saving ? 'Đang lưu lên Cloud...' : 'Xác nhận lưu tất cả lên Cloud'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
