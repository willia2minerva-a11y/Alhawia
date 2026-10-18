const express = require('express'), { MongoClient, ObjectId } = require('mongodb'), bcrypt = require('bcryptjs'),
  jwt = require('jsonwebtoken'), cookie = require('cookie-parser'), rate = require('express-rate-limit'),
  helmet = require('helmet'), path = require('path');

const { ADMIN_USERNAME, ADMIN_PASSWORD, INVITE_CODE, JWT_SECRET, MONGODB_URI } = process.env;
const PORT = process.env.PORT || 10000, prod = process.env.NODE_ENV === 'production';
for (const k of ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'INVITE_CODE', 'JWT_SECRET', 'MONGODB_URI'])
  if (!process.env[k]) { console.error('Missing environment variable: ' + k); process.exit(1); }
if (JWT_SECRET.length < 16) console.warn('WARNING: JWT_SECRET is short, use 32+ random characters');

const COST = 50, MOODS = ['normal', 'laugh', 'angry', 'sad', 'surprise', 'sleep', 'scary', 'secret'],
  CATS = ['الموقع', 'الألعاب', 'الفعاليات', 'أخرى'];
const FEEL = [[/ههه|ضحك|😂|مضحك/, 'laugh', 'هههه... أنت مسلٍّ بما يكفي لأبقيك حياً.'], [/اكرهك|غبي|غضب/, 'angry', 'احذر كلامك. للهاوية آذان.'], [/حزين|ابكي|تعبان|زعلان/, 'sad', 'الظلام يفهم الحزن أكثر من الجميع...'], [/واو|ياسلام|معقول/, 'surprise', 'أترى؟ الهاوية مليئة بالمفاجآت!'], [/ملل|زهق|نايم/, 'sleep', 'zzz... أيقظني حين يصبح الأمر ممتعاً.']];
const RND = ['هممم... أكمل، أنا أستمع.', 'كل ساقط يقول هذا في البداية.', 'الهاوية بلا قاع، فلا تتعجل.', 'لم أفهم... لكن أعجبتني جرأتك.', 'جرّب كلمة أخرى. ربما تكون سراً.', 'أخبرني المزيد... أو اصمت للأبد.'];
const BAD = /لعنة|حقير|وسخ/;
const DEFAULT_WORDS = [
  { w: ['الهاوية', 'هاوية'], r: 'أحسنت... وجدت أول خيط. الظلام يحب الفضوليين.', mood: 'secret', pts: 30, so: 5, on: true, grave: false },
  { w: ['نجمة', 'النجمة'], r: 'النجمة التي انفجرت... هل رأيتَ سقوطك؟', mood: 'surprise', pts: 20, so: 5, on: true, grave: false },
  { w: ['ساقط', 'الساقط'], r: 'أنا أعرفك. كلنا سقطنا يوماً.', mood: 'sad', pts: 15, so: 3, on: true, grave: false },
  { w: ['عودة', 'ارجع'], r: 'كلمة العودة... ارتفعْ من قبرك. لن أقول ذلك مرتين.', mood: 'secret', pts: 0, so: 30, on: true, grave: true }];

let U, W, PO, CF, FL;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), num = (v, d = 0) => Number.isFinite(+v) ? +v : d;
const today = () => new Date().toISOString().slice(0, 10);
const bad = m => { const e = new Error(m); e.pub = 1; return e; };
const DU = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const KEY = /^[\w.-]{1,80}$/;
const okU = u => !!u && typeof u._id === 'string' && typeof u.pw === 'string' && typeof u.d === 'string' && Number.isFinite(u.pts);
const put = u => U.replaceOne({ _id: u._id }, u);
const cfg = () => CF.findOne({ _id: 'main' });
function adj(u, p, s) {
  u.pts = Math.max(0, Math.round(u.pts + p)); u.so = clamp(Math.round(u.so + s), 0, 100);
  if (u.so <= 0 && !u.grave) { u.grave = true; u.gr = 'نفدت أرواحه'; }
}
async function img(key, d) {
  if (typeof d !== 'string' || d.length > 900000 || !DU.test(d)) throw bad('صورة غير صالحة');
  await FL.updateOne({ _id: key }, { $set: { d, v: Date.now() } }, { upsert: true });
}

const A = f => (q, s, n) => f(q, s, n).catch(e => {
  if (!e.pub) console.error(e);
  s.status(e.pub ? 400 : 500).json({ e: e.pub ? e.message : 'خطأ في الخادم' });
});
const lim = (n, ms) => rate({ windowMs: ms, max: n, standardHeaders: true, legacyHeaders: false, message: { e: 'محاولات كثيرة، انتظر قليلاً' } });
const setc = (res, u) => res.cookie('t', jwt.sign({ s: u }, JWT_SECRET, { expiresIn: '30d' }), { httpOnly: true, sameSite: 'lax', secure: prod, maxAge: 30 * 864e5 });
const auth = async (q, s, n) => { try { const x = await U.findOne({ _id: jwt.verify(q.cookies.t || '', JWT_SECRET).s }); q.u = okU(x) ? x : null; } catch (e) { } n(); };
const need = (q, s, n) => q.u ? n() : s.status(401).json({ e: 'سجّل الدخول أولاً' });
const admin = (q, s, n) => q.u && q.u.adm ? n() : s.status(403).json({ e: 'ممنوع' });

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '3mb' }));
app.use(cookie());
app.use('/api', lim(300, 60e3));
app.use('/api', (q, s, n) => q.method === 'POST' && !q.is('json') ? s.status(415).json({ e: 'نوع الطلب غير مدعوم' }) : n());
app.use('/api', auth);

const iu = u => u.avV ? `/api/img/av-${u._id}?v=${u.avV}` : '';
function pub(u, v) {
  const own = v && v._id === u._id, ad = v && v.adm, ph = a => Array((a || []).length).fill('·');
  return { u: u._id, d: u.d, t: u.t || '', pts: u.pts, so: u.so, grave: !!u.grave, gr: u.gr || '', sec: own || ad ? u.sec : ph(u.sec), vio: u.vio || 0, adm: !!u.adm, av: iu(u), fr: own ? u.fr : ph(u.fr), rq: own ? u.rq : [], sn: own ? u.sn : [], ch: own ? (u.ch || {}) : {}, rt: u.rt ? 1 : 0 };
}

app.get('/healthz', (q, s) => s.send('ok'));

app.get('/api/state', A(async (q, s) => {
  const me = q.u, c = await cfg();
  const r = { me: me ? me._id : null, set: { name: c.name, ticker: c.ticker, tick_on: c.tick_on, banner: c.bannerV ? `/api/img/banner?v=${c.bannerV}` : '', fallen: c.fallV ? `/api/img/fallen?v=${c.fallV}` : '' }, moods: {}, users: {}, words: [], posts: [], dec: '' };
  for (const [k, v] of Object.entries(c.moods || {})) r.moods[k] = `/api/img/mood-${k}?v=${v}`;
  r.posts = (await PO.find({}).sort({ ts: -1 }).toArray()).map(p => ({ id: p._id, c: p.c, t: p.t, b: p.b, l: p.l, i: p.i.map(k => `/api/img/${k}?v=${p.ts}`), ts: p.ts }));
  if (me) {
    (await U.find({}).toArray()).filter(okU).forEach(u => r.users[u._id] = pub(u, me));
    
    if (me.adm) r.words = (await W.find({}).toArray()).map(w => ({ id: String(w._id), w: w.w, r: w.r, mood: w.mood, pts: w.pts, so: w.so, on: w.on }));
    if (c.dec && me.decSeen !== c.dec.id && !me.adm) r.dec = c.dec.text;
  }
  s.json(r);
}));

app.get('/api/img/:k', A(async (q, s) => {
  if (!KEY.test(q.params.k)) return s.sendStatus(404);
  if (!q.u && !/^(post-|banner$|fallen$)/.test(q.params.k)) return s.sendStatus(401);
  const f = await FL.findOne({ _id: q.params.k }); if (!f) return s.sendStatus(404);
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(f.d);
  s.set({ 'Content-Type': m[1], 'Cache-Control': 'private,max-age=31536000,immutable' });
  s.send(Buffer.from(m[2], 'base64'));
}));

app.post('/api/register', lim(20, 15 * 60e3), A(async (q, s) => {
  const b = q.body || {}, k = String(b.u || '').trim().toLowerCase(), n = String(b.d || '').trim(), p = String(b.p || '');
  if (!/^[a-z0-9_]{3,20}$/.test(k)) throw bad('اسم المستخدم: إنجليزي 3-20 حرفاً');
  if (n.length < 2 || n.length > 20) throw bad('الاسم المعروض 2-20 حرفاً');
  if (p.length < 4 || p.length > 72) throw bad('كلمة السر 4 أحرف على الأقل');
  if (String(b.i || '').trim() !== INVITE_CODE) throw bad('كود الدعوة خاطئ');
  try {
    await U.insertOne({ _id: k, d: n, t: 'ساقط جديد', pw: await bcrypt.hash(p, 10), pts: 0, so: 100, grave: false, gr: '', sec: [], vio: 0, adm: false, fr: [], rq: [], sn: [], ch: {}, rt: 0, avV: 0, day: today(), created: Date.now() });
  } catch (e) { throw bad('الاسم مأخوذ'); }
  setc(s, k); s.json({ ok: 1 });
}));

app.post('/api/login', lim(20, 15 * 60e3), A(async (q, s) => {
  const b = q.body || {}, k = String(b.u || '').trim().toLowerCase(), u = await U.findOne({ _id: k });
  if (!u || !(await bcrypt.compare(String(b.p || ''), u.pw))) throw bad('بيانات الدخول خاطئة');
  const t = today(); if (u.day !== t) { u.day = t; adj(u, 0, 1); }
  u.last = Date.now(); await put(u); setc(s, k); s.json({ ok: 1 });
}));
app.post('/api/logout', (q, s) => { s.clearCookie('t'); s.json({ ok: 1 }); });

app.post('/api/san', need, lim(40, 60e3), A(async (q, s) => {
  const u = q.u, n = String((q.body || {}).t || '').slice(0, 300).replace(/[\u064B-\u0652ـ]/g, '').toLowerCase();
  const sw = (await W.find({ on: true }).toArray()).find(x => x.w.some(w => w && n.includes(w.toLowerCase())));
  if (sw) {
    const key = sw.w[0];
    if (sw.grave && !u.grave) return s.json({ r: 'لست في المقبرة أصلاً... أم أنك تتمنى ذلك؟', mood: 'laugh' });
    if (!sw.grave && u.sec.includes(key)) return s.json({ r: 'هذه الكلمة استُخدمت من قبل. لا تكرر نفسك.', mood: 'sleep' });
    if (!u.sec.includes(key)) u.sec.push(key);
    if (sw.grave) { u.grave = false; u.gr = ''; u.rt = 1; }
    adj(u, sw.pts, sw.so); await put(u);
    return s.json({ r: sw.r, mood: sw.mood, note: `🔑 كلمة سرية! +${sw.pts} ريو  +${sw.so}% أرواح` });
  }
  if (u.grave) return s.json({ r: 'الموتى لا يتكلمون... إلا بالكلمة الصحيحة.', mood: 'sad' });
  if (BAD.test(n)) { u.vio = (u.vio || 0) + 1; adj(u, 0, -5); await put(u); return s.json({ r: 'مخالفة مسجلة. خُصم 5% من أرواحك.', mood: 'scary' }); }
  const f = FEEL.find(x => x[0].test(n));
  if (f) return s.json({ r: f[2], mood: f[1] });
  s.json({ r: RND[Math.floor(Math.random() * RND.length)], mood: 'normal' });
}));

app.post('/api/profile', need, A(async (q, s) => {
  const { k, v } = q.body || {}, u = q.u; u.ch = u.ch || {};
  if (!['d', 'p', 'a'].includes(k)) throw bad('طلب غير صالح');
  let val;
  if (k === 'd') { val = String(v || '').trim(); if (val.length < 2 || val.length > 20) throw bad('الاسم 2-20 حرفاً'); }
  if (k === 'p') { val = String(v || ''); if (val.length < 4 || val.length > 72) throw bad('كلمة السر 4 أحرف على الأقل'); }
  const n = u.ch[k] || 0;
  const paid = n > 0 && !u.adm;
  if (paid && u.pts < COST) throw bad(`تحتاج ${COST} ريو للتغيير`);
  if (k === 'a') await img('av-' + u._id, v);
  if (paid) adj(u, -COST, 0);
  if (k === 'd') u.d = val;
  if (k === 'p') u.pw = await bcrypt.hash(val, 10);
  if (k === 'a') u.avV = Date.now();
  u.ch[k] = n + 1; await put(u); s.json({ ok: 1 });
}));

app.post('/api/friend', need, A(async (q, s) => {
  const { a } = q.body || {}, k = String((q.body || {}).k || ''), u = q.u, x = await U.findOne({ _id: k });
  if (!okU(x) || x._id === u._id) throw bad('عضو غير موجود');
  for (const o of [u, x]) { o.fr = o.fr || []; o.rq = o.rq || []; o.sn = o.sn || []; }
  const rm = (arr, v) => arr.filter(z => z !== v), mk = () => { u.rq = rm(u.rq, k); x.sn = rm(x.sn, u._id); if (!u.fr.includes(k)) u.fr.push(k); if (!x.fr.includes(u._id)) x.fr.push(u._id); };
  if (a === 'add') { if (u.fr.includes(k)) { } else if (u.rq.includes(k)) mk(); else { if (!u.sn.includes(k)) u.sn.push(k); if (!x.rq.includes(u._id)) x.rq.push(u._id); } }
  else if (a === 'acc') { if (!u.rq.includes(k)) throw bad('لا يوجد طلب'); mk(); }
  else if (a === 'dec') { u.rq = rm(u.rq, k); x.sn = rm(x.sn, u._id); }
  else if (a === 'cx') { u.sn = rm(u.sn, k); x.rq = rm(x.rq, u._id); }
  else if (a === 'rm') { u.fr = rm(u.fr, k); x.fr = rm(x.fr, u._id); }
  else throw bad('طلب غير صالح');
  await put(u); await put(x); s.json({ ok: 1 });
}));

app.post('/api/seen', need, A(async (q, s) => {
  const c = await cfg(); if (c.dec) await U.updateOne({ _id: q.u._id }, { $set: { decSeen: c.dec.id } }); s.json({ ok: 1 });
}));

// ---------- الإدارة ----------
app.post('/api/admin/user', need, admin, A(async (q, s) => {
  const b = q.body || {}, x = await U.findOne({ _id: String(b.k || '') }); if (!okU(x)) throw bad('العضو غير موجود');
  if (b.a === 'sv') {
    x.d = String(b.d || '').trim().slice(0, 20) || x.d; x.t = String(b.t || '').slice(0, 30);
    x.pts = Math.max(0, Math.round(num(b.pts))); x.so = clamp(Math.round(num(b.so)), 0, 100); x.vio = Math.max(0, Math.round(num(b.vio)));
    if (b.w) { if (String(b.w).length < 4 || String(b.w).length > 72) throw bad('كلمة السر 4 أحرف على الأقل'); x.pw = await bcrypt.hash(String(b.w), 10); }
    if (x.so <= 0 && !x.grave && !x.adm) { x.grave = true; x.gr = x.gr || 'قرار إداري'; }
  } else if (b.a === 'av') { x.avV = 0; await FL.deleteOne({ _id: 'av-' + x._id }); }
  else if (b.a === 'gr') { if (x.adm) throw bad('لا يمكن إرسال الأدمن للمقبرة'); x.grave = !x.grave; x.gr = x.grave ? 'قرار إداري' : ''; if (!x.grave && x.so <= 0) x.so = 30; }
  else if (b.a === 'dl') {
    if (x.adm) throw bad('لا يمكن حذف حساب الأدمن');
    await U.deleteOne({ _id: x._id }); await FL.deleteOne({ _id: 'av-' + x._id });
    await U.updateMany({}, { $pull: { fr: x._id, rq: x._id, sn: x._id } }); return s.json({ ok: 1 });
  } else throw bad('طلب غير صالح');
  await put(x); s.json({ ok: 1 });
}));

app.post('/api/admin/word', need, admin, A(async (q, s) => {
  const b = q.body || {};
  if (b.op === 'add') {
    const w = String(b.w || '').split(/[,،]/).map(x => x.trim()).filter(Boolean).slice(0, 10);
    if (!w.length) throw bad('اكتب الكلمة'); if (!MOODS.includes(b.mood)) throw bad('حالة غير صالحة');
    await W.insertOne({ w, r: String(b.r || '...').slice(0, 300), mood: b.mood, pts: clamp(Math.round(num(b.pts)), -1000, 100000), so: clamp(Math.round(num(b.so)), -100, 100), on: true, grave: false });
  } else {
    const id = new ObjectId(String(b.id));
    if (b.op === 'tg') { const x = await W.findOne({ _id: id }); if (x) await W.updateOne({ _id: id }, { $set: { on: !x.on } }); }
    else if (b.op === 'dl') await W.deleteOne({ _id: id }); else throw bad('طلب غير صالح');
  }
  s.json({ ok: 1 });
}));

app.post('/api/admin/settings', need, admin, A(async (q, s) => {
  const b = q.body || {}, st = {};
  if ('name' in b) st.name = String(b.name || '').trim().slice(0, 40) || 'الهاوية';
  if ('ticker' in b) st.ticker = String(b.ticker || '').slice(0, 200);
  if ('tick_on' in b) st.tick_on = !!b.tick_on;
  if ('banner' in b) { if (b.banner) { await img('banner', b.banner); st.bannerV = Date.now(); } else { await FL.deleteOne({ _id: 'banner' }); st.bannerV = 0; } }
  if ('fallen' in b) { if (b.fallen) { await img('fallen', b.fallen); st.fallV = Date.now(); } else { await FL.deleteOne({ _id: 'fallen' }); st.fallV = 0; } }
  if (Object.keys(st).length) await CF.updateOne({ _id: 'main' }, { $set: st });
  s.json({ ok: 1 });
}));

app.post('/api/admin/mood', need, admin, A(async (q, s) => {
  const { k, img: d } = q.body || {}; if (!MOODS.includes(k)) throw bad('حالة غير صالحة');
  if (d) { await img('mood-' + k, d); await CF.updateOne({ _id: 'main' }, { $set: { ['moods.' + k]: Date.now() } }); }
  else { await FL.deleteOne({ _id: 'mood-' + k }); await CF.updateOne({ _id: 'main' }, { $unset: { ['moods.' + k]: '' } }); }
  s.json({ ok: 1 });
}));

app.post('/api/admin/decree', need, admin, A(async (q, s) => {
  const t = String((q.body || {}).text || '').trim().slice(0, 500); if (!t) throw bad('النص فارغ');
  await CF.updateOne({ _id: 'main' }, { $set: { dec: { id: Date.now(), text: t } } }); s.json({ ok: 1 });
}));

app.post('/api/admin/post', need, admin, A(async (q, s) => {
  const b = q.body || {}, isNew = b.id === 'new', id = isNew ? 'p' + Date.now() : String(b.id);
  const old = isNew ? null : await PO.findOne({ _id: id }); if (!isNew && !old) throw bad('المنشور غير موجود');
  const t = String(b.t || '').trim().slice(0, 120), bd = String(b.b || '').trim().slice(0, 8000);
  if (!t || !bd) throw bad('العنوان والمحتوى مطلوبان'); if (!CATS.includes(b.c)) throw bad('قسم غير صالح');
  const l = (Array.isArray(b.l) ? b.l : []).slice(0, 10).map(x => ({ n: String((x || {}).n || '').slice(0, 80), u: String((x || {}).u || '').slice(0, 500) })).filter(x => /^https?:\/\//i.test(x.u));
  const keys = [];
  for (const im of (Array.isArray(b.i) ? b.i : []).slice(0, 4)) {
    const m = /^\/api\/img\/([\w.-]+)/.exec(String(im));
    if (m && old && old.i.includes(m[1])) keys.push(m[1]);
    else { const k = `post-${id}-${Date.now()}${keys.length}`; await img(k, im); keys.push(k); }
  }
  for (const k of (old ? old.i : [])) if (!keys.includes(k)) await FL.deleteOne({ _id: k });
  await PO.updateOne({ _id: id }, { $set: { c: b.c, t, b: bd, l, i: keys }, $setOnInsert: { ts: Date.now() } }, { upsert: true });
  s.json({ ok: 1 });
}));

app.post('/api/admin/post/del', need, admin, A(async (q, s) => {
  const p = await PO.findOne({ _id: String((q.body || {}).id || '') });
  if (p) { for (const k of p.i) await FL.deleteOne({ _id: k }); await PO.deleteOne({ _id: p._id }); }
  s.json({ ok: 1 });
}));

app.use('/api', (q, s) => s.status(404).json({ e: 'غير موجود' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (q, s) => s.sendFile(path.join(__dirname, 'public', 'index.html')));

(async () => {
  const cl = new MongoClient(MONGODB_URI); await cl.connect();
  const db = cl.db(process.env.DB_NAME || undefined);
  U = db.collection('users'); W = db.collection('words'); PO = db.collection('posts'); CF = db.collection('config'); FL = db.collection('files');
  await CF.updateOne({ _id: 'main' }, { $setOnInsert: { name: 'الهاوية', ticker: 'مرحباً بالساقطين... سانس يراقبكم 👁', tick_on: true, moods: {}, bannerV: 0, dec: null } }, { upsert: true });
  if (!(await W.countDocuments({}))) await W.insertMany(DEFAULT_WORDS);
  const an = ADMIN_USERNAME.trim().toLowerCase(); let a = await U.findOne({ _id: an });
  if (!a) await U.insertOne({ _id: an, d: 'المدير', t: 'الحارس', pw: await bcrypt.hash(ADMIN_PASSWORD, 10), pts: 0, so: 100, grave: false, gr: '', sec: [], vio: 0, adm: true, fr: [], rq: [], sn: [], ch: {}, rt: 0, avV: 0, day: today(), created: Date.now() });
  else if (!a.adm || !(await bcrypt.compare(ADMIN_PASSWORD, a.pw))) { a.adm = true; a.pw = await bcrypt.hash(ADMIN_PASSWORD, 10); await put(a); }
  app.listen(PORT, () => console.log('Alhawiya running on :' + PORT));
})().catch(e => { console.error(e); process.exit(1); });
