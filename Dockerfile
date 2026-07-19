# استخدام نسخة خفيفة ومستقرة ومخصصة للشركات
FROM node:18-alpine

# تثبيت متطلبات مكتبة Puppeteer (Chromium) لمنع انهيار إيصالات الصور
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# تحديد مجلد العمل داخل الحاوية
WORKDIR /usr/src/app

# نسخ ملفات التثبيت فقط أولاً (للاستفادة من الكاش)
COPY package*.json ./

# تثبيت الحزم الإنتاجية فقط (تنظيف المشروع من حزم المطورين)
RUN npm ci --only=production

# نسخ باقي ملفات المشروع السليمة
COPY . .

# إعداد متغيرات البيئة لـ Puppeteer
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# فتح البورت
EXPOSE 3000

# تشغيل النظام
CMD ["node", "app.js"]