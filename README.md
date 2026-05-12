# md.qixin.ch

Typora-style web markdown editor. All data stored in browser (IndexedDB).

## Development

```
npm install
npm run dev
```

## Build & Deploy

```
npm run build
# Caddy at /etc/caddy/sites/md.qixin.ch.conf serves /opt/app/md/dist.
# Use restart (not reload) — the global Caddyfile has `admin off`,
# which disables the admin API that `systemctl reload caddy` depends on.
sudo systemctl restart caddy
```

See `docs/superpowers/specs/` for design and `docs/superpowers/plans/` for the build plan.

## Caddy config

```
md.qixin.ch {
    root * /opt/app/md/dist
    encode gzip zstd
    try_files {path} /index.html
    file_server
}
```
