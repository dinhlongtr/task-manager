import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MODEL_NAME = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY chưa được cấu hình trên máy chủ.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastError: unknown;
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
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

function formatApiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('GEMINI_API_KEY')) {
    return {
      status: 500,
      message: 'Chưa tìm thấy khóa API Google AI trong phần Settings > Secrets.',
    };
  }
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return {
      status: 403,
      message: 'Khóa Google AI API không hợp lệ hoặc thiếu quyền truy cập. Vui lòng kiểm tra trong Settings > Secrets.',
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

interface ExistingLocationHint {
  id: string;
  code: string;
  name: string;
  address: string;
}

interface ExistingContactHint {
  id: string;
  code: string;
  fullName: string;
  organization: string;
  phone: string;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.post('/api/ai/parse-input', async (req: Request, res: Response) => {
    try {
      const {
        text = '',
        imageBase64 = '',
        imageMimeType = '',
        todayDate = new Date().toISOString().slice(0, 10),
        existingLocations = [],
        existingContacts = [],
      } = req.body as {
        text?: string;
        imageBase64?: string;
        imageMimeType?: string;
        todayDate?: string;
        existingLocations?: ExistingLocationHint[];
        existingContacts?: ExistingContactHint[];
      };

      const trimmedText = typeof text === 'string' ? text.trim() : '';
      const hasImage = typeof imageBase64 === 'string' && imageBase64.length > 20;

      if (!trimmedText && !hasImage) {
        res.status(400).json({ error: 'Vui lòng nhập nội dung văn bản hoặc tải lên hình ảnh lịch trình/giấy mời.' });
        return;
      }

      const ai = getGeminiClient();

      const locationsContext = existingLocations
        .slice(0, 25)
        .map((l) => `- id="${l.id}", code="${l.code}", name="${l.name}", addr="${String(l.address || '').slice(0, 80)}"`)
        .join('\n');

      const contactsContext = existingContacts
        .slice(0, 25)
        .map((c) => `- id="${c.id}", code="${c.code}", name="${c.fullName}", org="${String(c.organization || '').slice(0, 60)}", phone="${c.phone || ''}"`)
        .join('\n');

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

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
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
                summary: {
                  type: Type.STRING,
                  description: 'Tóm tắt ngắn gọn 1 câu những gì AI đã nhận diện được.',
                },
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
      res.json(parsed);
    } catch (err: unknown) {
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/ai/report-summary', async (req: Request, res: Response) => {
    try {
      const { scopeLabel, stats } = req.body as {
        scopeLabel?: string;
        stats?: Record<string, unknown>;
      };
      if (!scopeLabel || !stats) {
        res.status(400).json({ error: 'Thiếu dữ liệu báo cáo để tổng hợp.' });
        return;
      }

      const ai = getGeminiClient();
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: `Hãy viết một bản nhận xét tổng hợp báo cáo công việc ngắn gọn (3-4 gạch đầu dòng súc tích, không dùng markdown rườm rà) bằng tiếng Việt chuyên nghiệp cho phạm vi: "${scopeLabel}".
Số liệu thực tế: ${JSON.stringify(stats)}
Nêu rõ tỷ lệ hoàn thành, điểm nổi bật theo địa điểm/loại công việc, các hạng mục cần ưu tiên xử lý sớm.`,
          config: {
            systemInstruction:
              'Bạn là trợ lý điều hành cá nhân. Trả lời bằng tiếng Việt súc tích, chính xác theo đúng số liệu được cung cấp, không bịa thêm số liệu.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        })
      );

      res.json({ summary: (response.text ?? '').trim() });
    } catch (err: unknown) {
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
