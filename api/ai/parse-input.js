import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const MODEL_NAME = 'gemini-4-hydrogen';

async function withRetry(fn, maxAttempts = 2) {
  let lastError;
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = msg.includes('503') || msg.includes('500') || msg.includes('UNAVAILABLE');
      const elapsed = Date.now() - startedAt;
      if (!isTransient || attempt === maxAttempts || elapsed > 12000) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 350 * attempt));
    }
  }
  throw lastError;
}

function formatApiError(err) {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('GEMINI_API_KEY')) {
    return {
      status: 500,
      message: 'Chưa cấu hình biến môi trường GEMINI_API_KEY trên Vercel (Settings → Environment Variables).',
    };
  }
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return {
      status: 403,
      message: 'Khóa Google AI API không hợp lệ hoặc thiếu quyền truy cập. Vui lòng kiểm tra GEMINI_API_KEY.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message: 'Đã vượt quá hạn mức gọi Google AI API tạm thời. Vui lòng thử lại sau ít phút.',
    };
  }
  if (raw.includes('DEADLINE_EXCEEDED') || raw.includes('ETIMEDOUT') || raw.includes('504')) {
    return {
      status: 504,
      message: 'Google AI phản hồi quá thời gian chờ. Vui lòng rút gọn nội dung hoặc thử lại.',
    };
  }
  return {
    status: 500,
    message: `Lỗi xử lý AI: ${raw}`,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY missing');
    }

    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body ?? {});

    const {
      text = '',
      imageBase64 = '',
      imageMimeType = '',
      todayDate = new Date().toISOString().slice(0, 10),
      existingLocations = [],
      existingContacts = [],
    } = body;

    const trimmedText = typeof text === 'string' ? text.trim() : '';
    const hasImage = typeof imageBase64 === 'string' && imageBase64.length > 20;

    if (!trimmedText && !hasImage) {
      res.status(400).json({ error: 'Vui lòng nhập nội dung văn bản hoặc tải lên hình ảnh lịch trình/giấy mời.' });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const locationsContext = Array.isArray(existingLocations)
      ? existingLocations
          .slice(0, 25)
          .map((l) => `- id="${l.id}", code="${l.code}", name="${l.name}", addr="${String(l.address || '').slice(0, 80)}"`)
          .join('\n')
      : '';

    const contactsContext = Array.isArray(existingContacts)
      ? existingContacts
          .slice(0, 25)
          .map((c) => `- id="${c.id}", code="${c.code}", name="${c.fullName}", org="${String(c.organization || '').slice(0, 60)}", phone="${c.phone || ''}"`)
          .join('\n')
      : '';

    const systemInstruction = `Bạn là trợ lý nhập liệu nhanh cho ứng dụng "Sổ Tay Công Tác". Ngày hiện tại: ${todayDate}.
Trích xuất ngắn gọn, chính xác dữ liệu từ văn bản hoặc ảnh giấy mời/lịch họp sang 3 danh sách JSON:
1. suggestedLocations: Địa điểm MỚI chưa có trong danh sách hiện có (tempKey như "LOC_NEW_1", code chỉ gồm A-Z/0-9/-/_, name, address, category: "office"|"agency"|"client"|"site"|"personal", notes).
2. suggestedContacts: Liên hệ MỚI chưa có trong danh bạ hiện có (tempKey như "CT_NEW_1", code như "LH-MINH", fullName, group: "client"|"family"|"partner"|"colleague"|"other", relationship, organization, phone, email, notes).
3. workItems: Công việc / dự án / giấy mời:
   - itemType: "task" | "project" | "invitation"
   - code: mã số (chỉ A-Z, a-z, 0-9, -, _, /, .; tự tạo CV-01/DA-01/GM-01 nếu chưa có)
   - title: tiêu đề tiếng Việt súc tích
   - projectCode & projectName: điền nếu có, không thì ""
   - matchedLocationId: id địa điểm hiện có nếu khớp; nếu địa điểm mới thì "" và điền locationTempKey. Nếu không nêu địa điểm, chọn id địa điểm đầu tiên hiện có hoặc đề xuất "VP-CANHAN" ("Văn phòng cá nhân", "Chưa cập nhật địa chỉ").
   - matchedContactId / contactTempKey: tương tự (đều "" nếu không có người liên hệ).
   - scheduledDate: YYYY-MM-DD (suy luận từ ${todayDate}).
   - startTime, endTime: HH:mm (24h; nếu thiếu endTime thì +1 giờ).
   - priority: "low" | "medium" | "high" | "urgent"
   - reminderMinutes: số nguyên phút nhắc trước (mặc định 15).
   - notes: chi tiết ngắn gọn (thành phần, tài liệu).

Địa điểm hiện có:
${locationsContext || '(Chưa có)'}

Danh bạ hiện có:
${contactsContext || '(Chưa có)'}`;

    const parts = [];
    if (hasImage) {
      parts.push({
        inlineData: {
          mimeType: imageMimeType || 'image/jpeg',
          data: imageBase64,
        },
      });
    }
    parts.push({
      text: trimmedText || 'Đọc thông tin lịch họp, giấy mời, mã số, thời gian, địa điểm và người liên hệ từ hình ảnh này.',
    });

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: MODEL_NAME,
        contents: { parts },
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              suggestedLocations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    tempKey: { type: Type.STRING },
                    code: { type: Type.STRING },
                    name: { type: Type.STRING },
                    address: { type: Type.STRING },
                    category: { type: Type.STRING },
                    notes: { type: Type.STRING },
                  },
                  required: ['tempKey', 'code', 'name', 'address', 'category', 'notes'],
                },
              },
              suggestedContacts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    tempKey: { type: Type.STRING },
                    code: { type: Type.STRING },
                    fullName: { type: Type.STRING },
                    group: { type: Type.STRING },
                    relationship: { type: Type.STRING },
                    organization: { type: Type.STRING },
                    phone: { type: Type.STRING },
                    email: { type: Type.STRING },
                    notes: { type: Type.STRING },
                  },
                  required: [
                    'tempKey',
                    'code',
                    'fullName',
                    'group',
                    'relationship',
                    'organization',
                    'phone',
                    'email',
                    'notes',
                  ],
                },
              },
              workItems: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    itemType: { type: Type.STRING },
                    code: { type: Type.STRING },
                    title: { type: Type.STRING },
                    projectCode: { type: Type.STRING },
                    projectName: { type: Type.STRING },
                    matchedLocationId: { type: Type.STRING },
                    locationTempKey: { type: Type.STRING },
                    matchedContactId: { type: Type.STRING },
                    contactTempKey: { type: Type.STRING },
                    scheduledDate: { type: Type.STRING },
                    startTime: { type: Type.STRING },
                    endTime: { type: Type.STRING },
                    priority: { type: Type.STRING },
                    reminderMinutes: { type: Type.INTEGER },
                    notes: { type: Type.STRING },
                  },
                  required: [
                    'itemType',
                    'code',
                    'title',
                    'projectCode',
                    'projectName',
                    'matchedLocationId',
                    'locationTempKey',
                    'matchedContactId',
                    'contactTempKey',
                    'scheduledDate',
                    'startTime',
                    'endTime',
                    'priority',
                    'reminderMinutes',
                    'notes',
                  ],
                },
              },
            },
            required: ['summary', 'suggestedLocations', 'suggestedContacts', 'workItems'],
          },
        },
      })
    );

    const rawJson = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawJson);
    res.status(200).json(parsed);
  } catch (err) {
    const formatted = formatApiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
}
