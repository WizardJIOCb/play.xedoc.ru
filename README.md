# XEDOC Play

Private, single-user web player for a Yandex Music library. The interface focuses on fast access to playlists, calm recommendations, search, a persistent queue and listening sessions without recent repeats.

## Highlights

- Yandex Device Flow connection; the password never enters this application.
- Encrypted server-side token storage and signed HttpOnly cookies.
- Personal playlists, recommendations, search, likes and audio streaming.
- XEDOC Session Builder: 25/50/90-minute mixes, discovery balance, playlist/liked sources and 7/30/90-day local-history exclusion.
- Lazy playlist loading, persistent local listening history, keyboard controls and responsive mobile UI.
- Installable PWA shell with a privacy-scoped static cache.

## Local development

```bash
npm ci
cp .env.example .env
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements-dev.txt
backend/.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
npm run dev
```

On Linux/macOS, use `backend/.venv/bin/python` instead. Vite proxies `/api` to `127.0.0.1:8000`.

Checks:

```bash
npm run check
npm run build
backend/.venv/Scripts/python -m pytest -q backend/tests
```

## Production

The hardened nginx, systemd and atomic release templates are documented in [`deploy/README.md`](deploy/README.md). Runtime secrets belong in `/etc/play.xedoc.ru/backend.env`; SQLite data belongs in `/var/www/play.xedoc.ru/shared/data`.

## Important

This project is not affiliated with Yandex. It uses the community-maintained, reverse-engineered [`yandex-music`](https://github.com/MarshalX/yandex-music-api) client, so upstream changes can require adapter updates. Keep the application private and use a long access key. The first successfully connected Yandex UID is pinned in protected server storage; `PLAY_YANDEX_ALLOWED_UID` can additionally predeclare it.
