# IQ-67 — симулятор переговоров

Веб-приложение для тренировки переговоров с виртуальным заказчиком. Пользователь настраивает сложность и ситуацию, ведёт диалог с AI-оппонентом, получает подсказки, отслеживает задачи по SPIN и после завершения изучает результат и дерево альтернативных веток.

- Рабочая версия: [iq-67.vercel.app](https://iq-67.vercel.app/)
- Техническая документация: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Репозиторий: [github.com/Sp404s/IQ-67](https://github.com/Sp404s/IQ-67)

## Возможности

- настройка заказчика и сложности переговоров;
- AI-оппонент на Gemini с фиксированной ролью и памятью разговора;
- методика выявления потребности SPIN;
- методы отработки возражений и завершения сделки;
- теоретические советы и три готовые подсказки за сессию;
- голосовой ввод;
- аккаунты и профили пользователей через Supabase Auth;
- сохранение сообщений и состояния после каждого хода;
- возврат к прошлому ходу и создание до трёх альтернативных веток;
- история в виде интерактивного дерева;
- результаты: выигрыш, компромисс или проигрыш;
- адаптивный интерфейс для компьютеров и телефонов.

## Стек

- Next.js 16, React 19 и TypeScript;
- Supabase: Auth, PostgreSQL и Row Level Security;
- Google Gemini API;
- Vercel;
- ESLint.

## Локальный запуск

Потребуются Node.js 20 или новее, npm, проект Supabase и API-ключ Google AI Studio.

1. Клонируйте репозиторий:

   ```bash
   git clone https://github.com/Sp404s/IQ-67.git
   cd IQ-67
   ```

2. Установите зависимости:

   ```bash
   npm install
   ```

3. Создайте локальный файл окружения:

   **Windows PowerShell**

   ```powershell
   Copy-Item .env.example .env.local
   ```

   **macOS/Linux**

   ```bash
   cp .env.example .env.local
   ```

4. Заполните `.env.local`:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   GEMINI_API_KEY=your-google-ai-studio-key
   GEMINI_MODEL=gemini-3.1-flash-lite
   GEMINI_TRANSCRIBE_MODEL=gemini-3.5-transcribe
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

   `GEMINI_API_KEY` используется только на сервере. Не добавляйте `.env.local` в Git.

5. В Supabase откройте **SQL Editor** и по порядку выполните миграции:

   1. `supabase/migrations/001_negotiation_core.sql`
   2. `supabase/migrations/002_session_history_and_branches.sql`
   3. `supabase/migrations/003_retention_and_cleanup.sql`
   4. `supabase/migrations/004_user_profiles.sql`

6. В Supabase откройте **Authentication → URL Configuration** и добавьте:

   - Site URL: `http://localhost:3000`
   - Redirect URL: `http://localhost:3000/**`

7. Запустите приложение:

   ```bash
   npm run dev
   ```

8. Откройте [http://localhost:3000](http://localhost:3000).

## Проверка перед публикацией

```bash
npm run lint
npm run build
npm run test:quality
```

## Развёртывание

Проект готов к Vercel. Импортируйте репозиторий, добавьте переменные из `.env.example` в **Project Settings → Environment Variables** и выполните deployment. Для production укажите `NEXT_PUBLIC_APP_URL` с публичным адресом сайта и добавьте этот адрес в Supabase Auth Redirect URLs.

Полная схема компонентов, базы данных, API и развёртывания находится в [технической документации](docs/ARCHITECTURE.md).

## Безопасность данных

- приватный ключ Gemini не передаётся в браузер;
- клиент использует только публичный Supabase publishable key;
- таблицы защищены RLS, пользователь видит только свои данные;
- `.env.local` исключён из Git;
- сессии старше семи дней удаляются функцией очистки Supabase.
