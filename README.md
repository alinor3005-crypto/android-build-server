# Cloud Build Server

خادم وسيط لبناء تطبيقات Android عبر GitHub Actions.

## التثبيت

```bash
cd server
npm install
```

## الإعداد

1. انسخ ملف `.env.example` إلى `.env`:
```bash
cp .env.example .env
```

2. عدّل ملف `.env`:
```
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=your-username
GITHUB_REPO=android-build-server
PORT=3000
SECRET_KEY=your-secret-key-here
```

3. أنشئ Personal Access Token على GitHub:
   - اذهب إلى Settings → Developer settings → Personal access tokens
   - أنشئ توكن بصلاحية `repo`

4. أنشئ مستودع `android-build-server` على GitHub

5. ارفع ملفات Workflow إليه:
   ```
   .github/workflows/build.yml
   .github/workflows/build-from-archive.yml
   ```

## التشغيل

```bash
npm start
```

## النشر

### Railway (مجاني)
1. اذهب إلى [railway.app](https://railway.app)
2. أنشئ مشروع جديد
3. اربط المستودع
4. أضف المتغيرات البيئية

### Vercel (مجاني)
1. اذهب إلى [vercel.com](https://vercel.com)
2. استورد المشروع
3. أضف المتغيرات البيئية

### Heroku
1. اذهب إلى [heroku.com](https://heroku.com)
2. أنشئ تطبيق جديد
3. ارفع الكود
4. أضف المتغيرات البيئية

## API

### إنشاء بناء
```
POST /api/build
Headers: x-api-key: YOUR_SECRET_KEY
Body: FormData with source file
```

### التحقق من الحالة
```
GET /api/build/:id/status
Headers: x-api-key: YOUR_SECRET_KEY
```

### تحميل APK
```
GET /api/build/:id/download
Headers: x-api-key: YOUR_SECRET_KEY
```
