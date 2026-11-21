import { GoogleGenAI, ThinkingLevel } from '@google/genai';

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
      message: 'Google AI phản hồi quá thời gian chờ. Vui lòng thử lại sau giây lát.',
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

    const { scopeLabel, stats } = body;

    if (!scopeLabel || !stats) {
      res.status(400).json({ error: 'Thiếu dữ liệu báo cáo để tổng hợp.' });
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

    res.status(200).json({ summary: (response.text ?? '').trim() });
  } catch (err) {
    const formatted = formatApiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
}
