# XEDOC Play

Multi-user web player that brings a Yandex Music library and VK taste signals into one personal account. The interface focuses on fast access to playlists, calm recommendations, search, a persistent queue and listening sessions without recent repeats.

## Highlights

- XEDOC account registration and isolated playlists, listening statistics, recommendations and connections for every user.
- Per-user Yandex Device Flow connection; the Yandex password never enters this application.
- Full VK collection import through a personal browser bookmark: it reads only title/artist/duration from the user's already-authorized “My music” tab, then matches playable tracks in the background and uses unmatched titles as recommendation signals.
- Encrypted per-user token storage, scrypt password hashing and opaque HttpOnly sessions.
- Personal playlists, recommendations, search, likes and audio streaming.
- Editable XEDOC playlists with descriptions, links, custom covers and public sharing.
- A separate recommendation layer that learns from listening signals while keeping Yandex recommendations intact.
- XEDOC Session Builder: 25/50/90-minute mixes, discovery balance, playlist/liked sources and 7/30/90-day local-history exclusion.
- Lazy playlist loading, persistent local listening history, keyboard controls and responsive mobile UI.
- Installable PWA shell with a privacy-scoped static cache.
- A social layer with public/friends-only posts, images, video and web links, playable track/playlist cards and polls.
- Mutual friend requests, profile walls and separate “For You”/friends feeds.
- Transparent `xedoc-social-v1` ranking: freshness + friendship + music-taste affinity + social response. It uses the listener's own play history for track/artist affinity and keeps visibility filtering separate from ranking.
- WebMCP site tools for ChatGPT Work and Codex: catalog search, player state, queue inspection, playback, add-next, session building, playlist access and listening statistics through the open signed-in page.

## WebMCP site tools

When XEDOC Play is open in the built-in browser of the ChatGPT desktop app, compatible ChatGPT Work and Codex clients can discover these tools:

- `search_music`, `get_player_state`, `get_queue`, `list_playlists` and `get_listening_stats` are read-only.
- `play_track`, `add_next` and `build_session` change local playback or the queue.
- `add_to_playlist` adds a known track to an editable XEDOC playlist owned by the signed-in user.

Tools reuse the same API calls, HttpOnly session and server-side authorization as the visible interface. Track IDs returned by search, queue, session and statistics tools can be passed to the playback and playlist tools. Browser autoplay rules can leave a selected track paused until the user presses Play; `get_player_state` reports the actual playback state. Browsers without [`document.modelContext`](https://learn.chatgpt.com/docs/webmcp) continue to receive the normal application without site tools.

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

This project is not affiliated with Yandex or VK. It uses the community-maintained, reverse-engineered [`yandex-music`](https://github.com/MarshalX/yandex-music-api) client, so upstream changes can require adapter updates. VK credentials are never requested: the browser collector reads title, artist and duration from the user's authorized VK tab, while XEDOC only plays tracks available through a legally connected music catalog. The first successfully connected Yandex UID is pinned separately for every XEDOC account; `PLAY_YANDEX_ALLOWED_UID` can additionally predeclare a global allowlist UID.
