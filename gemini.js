// gemini.js — استدعاء Gemini المجاني بذكاء: تبديل المفاتيح + تبديل النماذج + فترات تبريد
// المتغيرات:
//   GEMINI_API_KEYS = مفتاح1،مفتاح2،مفتاح3   (يقبل الفاصلة , أو ، أو ; أو مسافة أو سطر جديد)
//   GEMINI_MODELS   = اختياري، قائمة نماذج مرتبة بالأفضلية (الأول يُجرَّب أولاً)
//   AI_MAX_TRIES    = أقصى عدد محاولات للرسالة الواحدة (افتراضي 8)
//   AI_TIMEOUT_MS   = مهلة المحاولة الواحدة (افتراضي 9000)
//   AI_BUDGET_MS    = أقصى زمن كلي للرسالة قبل الاستسلام للردود الجاهزة (افتراضي 22000)

const splitList = s => String(s || '').split(/[,،;؛\s]+/).map(x => x.trim()).filter(Boolean);

const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.6-flash', 'gemini-2.0-flash'];

function createGemini(opts = {}) {
  const env = opts.env || process.env;
  const doFetch = opts.fetch || fetch;
  const keys = [...new Set(splitList(env.GEMINI_API_KEYS || env.GEMINI_API_KEY || env.GOOGLE_API_KEY))];
  const models = [...new Set(splitList(env.GEMINI_MODELS))];
  if (!models.length) models.push(...DEFAULT_MODELS);
  const MAX_TRIES = Number(env.AI_MAX_TRIES) || 8;
  const TIMEOUT = Number(env.AI_TIMEOUT_MS) || 9000;
  const BUDGET = Number(env.AI_BUDGET_MS) || 22000;

  const keyBad = new Map();   // فهرس المفتاح -> وقت انتهاء الإيقاف (مفتاح خاطئ/محظور)
  const modelBad = new Map(); // اسم النموذج -> وقت انتهاء الإيقاف (غير موجود)
  const cool = new Map();     // "مفتاح|نموذج" -> وقت انتهاء التبريد (تجاوز الحصة)
  const stats = { ok: 0, fail: 0, last: '', lastErr: '', byModel: {} };
  let start = 0;

  const alive = (m, k) => (m.get(k) || 0) <= Date.now();
  const mask = i => '#' + (i + 1);

  async function call(model, key, system, contents) {
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), TIMEOUT);
    const gen = { maxOutputTokens: 1024, temperature: 1, responseMimeType: 'application/json' };
    if (/gemini-2\.5-flash/.test(model)) gen.thinkingConfig = { thinkingBudget: 0 }; // بلا تفكير = أسرع وأوفر حصة
    try {
      const r = await doFetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST', signal: ac.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: gen })
      });
      const raw = await r.text();
      if (!r.ok) return { ok: false, status: r.status, raw };
      let j; try { j = JSON.parse(raw); } catch (e) { return { ok: false, status: 502, raw }; }
      const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
      const text = parts.filter(p => !p.thought).map(p => p.text || '').join('').trim();
      if (!text) return { ok: false, status: 204, raw: JSON.stringify(j.promptFeedback || j.candidates || {}).slice(0, 200) };
      return { ok: true, text };
    } catch (e) {
      return { ok: false, status: 0, raw: e.name };
    } finally { clearTimeout(tm); }
  }

  // يعيد النص الخام من أول نموذج/مفتاح ينجح، أو null إن فشل الجميع
  async function generate(system, contents) {
    if (!keys.length || !models.length) return null;
    const t0 = Date.now(), first = start; start = (start + 1) % keys.length; // تدوير نقطة البداية لتوزيع الحمل
    let tries = 0;
    outer:
    for (const model of models) {
      if (!alive(modelBad, model)) continue;
      for (let j = 0; j < keys.length; j++) {
        if (tries >= MAX_TRIES || Date.now() - t0 > BUDGET) break outer;
        const ki = (first + j) % keys.length, ck = ki + '|' + model;
        if (!alive(keyBad, ki) || !alive(cool, ck)) continue;
        tries++;
        const r = await call(model, keys[ki], system, contents);
        if (r.ok) { stats.ok++; stats.last = model; stats.byModel[model] = (stats.byModel[model] || 0) + 1; return r.text; }
        stats.fail++; stats.lastErr = `${model} ${mask(ki)} → ${r.status}`;
        console.warn('Gemini', stats.lastErr, String(r.raw || '').slice(0, 160).replace(/\s+/g, ' '));
        const s = r.status, raw = String(r.raw || '');
        if (s === 429) { // تجاوز الحصة: جرّب المفتاح التالي ثم النموذج التالي
          const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(raw);
          const daily = /PerDay|per day/i.test(raw);
          cool.set(ck, Date.now() + (daily ? 30 * 60e3 : Math.min(300, m ? Math.ceil(+m[1]) + 1 : 60) * 1000));
        } else if (s === 401 || s === 403 || (s === 400 && /API key|API_KEY/i.test(raw))) {
          keyBad.set(ki, Date.now() + 10 * 60e3); // مفتاح غير صالح: أوقفه 10 دقائق
        } else if (s === 404) {
          modelBad.set(model, Date.now() + 6 * 3600e3); continue outer; // النموذج غير موجود: انتقل للتالي
        } else if (s === 400) {
          continue outer; // مشكلة في طلب هذا النموذج: جرّب غيره
        } else {
          cool.set(ck, Date.now() + 20e3); // 5xx / مهلة / رد فارغ
        }
      }
    }
    return null;
  }

  const info = () => ({
    keys: keys.length, models: models.slice(), ok: stats.ok, fail: stats.fail, last: stats.last, lastErr: stats.lastErr,
    byModel: { ...stats.byModel },
    badKeys: [...keyBad].filter(([, t]) => t > Date.now()).length,
    badModels: [...modelBad].filter(([, t]) => t > Date.now()).map(([m]) => m)
  });

  return { keys, models, generate, info };
}

module.exports = { createGemini, splitList };
