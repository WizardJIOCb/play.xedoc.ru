# XEDOC Play backend

FastAPI adapter for a private, single-account XEDOC Play deployment. The browser never receives the Yandex OAuth token: it is encrypted with Fernet and stored in SQLite. Browser access uses signed, `HttpOnly`, `SameSite=Strict` cookies.

## Local run

From the repository root:

```bash
python -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.txt
cp .env.example .env
cd backend
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

On Windows, use `.venv\\Scripts\\python` and `.venv\\Scripts\\uvicorn`.

Production must set unique values for `PLAY_ACCESS_KEY`, `PLAY_COOKIE_SECRET`, and `PLAY_TOKEN_ENCRYPTION_KEY`. Keep the same encryption key between deployments or the stored OAuth token cannot be decrypted. Set `PLAY_YANDEX_ALLOWED_UID` to prevent a beta-access holder from connecting a different Yandex account.

## Checks

```bash
cd backend
pytest
```

The frontend and API are expected on the same origin. Proxy `/api/` to this service and serve the built frontend for all other routes.

