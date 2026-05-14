# 4 в ряд - Firebase Multiplayer

Минималистичная браузерная игра "4 в ряд" с комнатами для двух игроков.

Стек:

- React + Vite
- Firebase Anonymous Auth
- Firebase Realtime Database
- Cloudflare Pages

## Что уже есть

- Создание комнаты по короткому коду
- Вход по коду или по ссылке `?room=XXXXX`
- Два игрока: гранатовый и золотой
- Realtime-синхронизация ходов через Firebase Realtime Database
- Транзакции на ходах, чтобы параллельные клики не ломали поле
- Победа по вертикали, горизонтали и диагоналям
- Ничья
- Новая партия
- Отображение online/offline через `onDisconnect`
- Адаптивный премиальный UI

## 1. Установка

```bash
npm install
cp .env.example .env.local
npm run dev
```

## 2. Firebase настройка

1. Открой Firebase Console.
2. Создай проект.
3. Добавь Web App.
4. Включи Authentication -> Sign-in method -> Anonymous.
5. Создай Realtime Database.
6. Скопируй Firebase config в `.env.local`.
7. Вставь правила из `database.rules.json` в Realtime Database -> Rules.

Пример `.env.local`:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_DATABASE_URL=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## 3. Cloudflare Pages

В Cloudflare Pages укажи:

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
```

В настройках проекта Cloudflare Pages добавь все переменные из `.env.local` в Environment variables.

## 4. Прямой деплой через Wrangler

```bash
npm run build
npx wrangler pages deploy dist
```

## 5. Важное ограничение

Это client-authoritative MVP: правила Firebase ограничивают доступ только авторизованными анонимными пользователями, а логика честного хода находится в клиенте. Для учебного проекта и игры с друзьями этого достаточно.

Для публичной соревновательной игры с античитом нужно перенести проверку ходов на серверную сторону, например Cloudflare Workers + Durable Objects.
