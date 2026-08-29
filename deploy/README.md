# play.xedoc.ru deployment

These files are templates. Review them before installing anything on the server.

## One-time bootstrap

1. Install `backend.env.example` as `/etc/play.xedoc.ru/backend.env`, replace every placeholder, and set ownership/mode to `root:www-data 0640`.
2. Install `systemd/play.xedoc.ru.service` as `/etc/systemd/system/play.xedoc.ru.service`, then run `systemctl daemon-reload` and `systemctl enable play.xedoc.ru.service`. Do not start it before the first release exists.
3. Create `/var/www/_letsencrypt/.well-known/acme-challenge`, install the bootstrap nginx vhost, enable it, validate with `nginx -t`, and reload nginx.
4. Obtain the certificate with `certbot certonly --webroot -w /var/www/_letsencrypt -d play.xedoc.ru`.
5. Replace the bootstrap vhost with `nginx/play.xedoc.ru.conf`, then validate with `nginx -t` and reload nginx.

The server already has a twice-daily Certbot timer and a deploy hook that validates and reloads nginx after renewal.

## Deploy

Install `deploy.sh` as `/usr/local/sbin/deploy-play.xedoc.ru`, make it executable, and run it as root. It fetches `origin/main`, creates an immutable release named by commit SHA, builds the frontend, reuses an immutable Python environment keyed by the dependency files and Python runtime, atomically switches `current`, restarts only the application service, and rolls back automatically if `/api/health` does not become healthy. Build-only `node_modules` are removed before the release is published.

The backend must expose `GET /api/health` without authentication. Runtime data belongs in `/var/www/play.xedoc.ru/shared`; secrets belong only in `/etc/play.xedoc.ru/backend.env`.

After a successful health check, the deploy script retains the active release and the two most recent previous releases. Set `RELEASES_TO_KEEP` to a larger integer when more rollback releases are required; the minimum is two. Release pruning never runs before the new release passes its health check.
