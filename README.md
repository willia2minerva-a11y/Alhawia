# الهاوية — النسخة الكاملة (Node + MongoDB)

## متغيرات البيئة (كلها مطلوبة)
| المتغير | الوصف |
|---|---|
| ADMIN_USERNAME | اسم دخول الأدمن (إنجليزي، يُحوَّل لأحرف صغيرة) |
| ADMIN_PASSWORD | كلمة سر الأدمن |
| INVITE_CODE | كود دعوة التسجيل |
| JWT_SECRET | نص عشوائي طويل (32+ حرفاً) لتوقيع الجلسات |
| MONGODB_URI | رابط MongoDB Atlas، ويجب أن يحوي اسم القاعدة: `...mongodb.net/alhawiya?retryWrites=true&w=majority` |
| PORT | 10000 |

عند كل تشغيل يُنشأ حساب الأدمن (أو تُحدَّث كلمة سره) من هذه المتغيرات.
لتغيير كود الدعوة أو كلمة سر الأدمن عدّل المتغير في Render ثم أعد النشر.

## 1) MongoDB Atlas
1. أنشئ Cluster مجانياً (M0) ومستخدماً لقاعدة البيانات.
2. Network Access ← Add IP Address ← Allow access from anywhere (0.0.0.0/0).
3. Connect ← Drivers ← انسخ الرابط، وأضف `/alhawiya` قبل علامة `?`.

## 2) GitHub
ارفع كل محتويات هذا المجلد إلى مستودع جديد (بدون node_modules).

## 3) Render
1. New ← Web Service (وليس Static Site) ← اختر المستودع.
2. Build Command: `npm install` — Start Command: `npm start`
3. أضف متغيرات البيئة أعلاه، وأضف أيضاً `NODE_ENV=production`.
4. Create Web Service، وبعد النشر ادخل بحساب الأدمن.

(أو New ← Blueprint ليقرأ render.yaml، وسيطلب منك قيم المتغيرات.)

## ملاحظات
- الخطة المجانية في Render تنام بعد فترة خمول، والطلب الأول بعد النوم يبطئ نحو دقيقة.
- كلمات سر الأعضاء مشفّرة (bcrypt)، والجلسة JWT في كوكي httpOnly.
- الكلمات السرية وردود سانس تُعالَج في الخادم ولا تصل للمتصفح (غير الأدمن).
- الصور (أفاتار، بانر، سانس، المنشورات) تُحفظ داخل MongoDB، وتُصغَّر في المتصفح قبل الرفع.
- لتجربة محلية: عيّن المتغيرات ثم `npm install && npm start`.
