# 08 — YunoHost Package

The YunoHost package is a **separate repo** named `panoramax-review_ynh`. It contains the install scripts and config templates that let a YunoHost admin install the app with `yunohost app install https://github.com/<you>/panoramax-review_ynh`.

## Repo layout

```
panoramax-review_ynh/
├── manifest.toml
├── scripts/
│   ├── _common.sh         (optional helper sourced by other scripts)
│   ├── install
│   ├── remove
│   ├── upgrade
│   ├── backup
│   └── restore
└── conf/
    ├── nginx.conf
    └── systemd.service
```

## `manifest.toml`

```toml
packaging_format = 2

id = "panoramax-review"
name = "Panoramax Image Review"
description.en = "Self-hosted review tool for Panoramax street-level imagery"

version = "1.0.0~ynh1"

maintainers = ["thibaultmol"]

[upstream]
license = "MIT"
code = "https://github.com/thibaultmol/panoramax-review"

[integration]
yunohost = ">= 11.0"
architectures = "all"
multi_instance = true
ldap = "true"
sso = "true"

resources = {
    quota = 100,
    ram.build = 512
}

[install]
    [install.domain]
    type = "domain"

    [install.path]
    type = "path"
    default = "/panoramax"

    [install.init_main_permission]
    type = "group"
    default = "users"
    help.en = "Users allowed to access the app. SSO will gate the entire app for these users."
```

Notes:
- No database questions (no MySQL/Postgres).
- No admin password question — auth is YunoHost SSO.
- `multi_instance = true` because the app is small and a user might want multiple instances on different paths.
- The install path defaults to `/panoramax` but the user can change it.
- `init_main_permission` controls which YunoHost group can access; defaulting to `users` is sane for single-user.

## `scripts/install`

YunoHost install scripts are bash. The script runs as root. Use YunoHost helpers (functions prefixed `ynh_`).

Pseudocode:

```bash
#!/bin/bash
source /usr/share/yunohost/helpers

# === Manifest variables ===
domain=$YNH_DOMAIN_ARG
path=$YNH_PATH_ARG

# === Normalize the path ===
path=$(ynh_normalize_path $path)

# === Reserve a port ===
port=$(ynh_port_get --bind=127.0.0.1)
ynh_app_setting_set $app port $port

# === Create system user ===
ynh_systemd_create_admin_user $app   # creates $app user/group

# === Define paths ===
install_dir=/var/www/$app
data_dir=/var/www/$app/data
ynh_app_setting_set $app install_dir $install_dir
ynh_app_setting_set $app data_dir $data_dir

# === Download / clone the app ===
# Option A: clone from the app repo (requires git on the box)
ynh_setup_source --dest_dir=$install_dir --source_id=main

# Or: download a release tarball and extract (preferred for reproducibility)
# ynh_setup_source --dest_dir=$install_dir --source_id=stable

# === Install Node.js ===
# YunoHost 11 has a nodejs helper
ynh_install_nodejs --nodejs_version=20

# === Build the app ===
pushd $install_dir
    ynh_exec_as $app npm ci --production=false
    ynh_exec_as $app npm run build
popd

# === Create data dir with correct permissions ===
mkdir -p $data_dir
chown -R $app:$app $data_dir
chmod 750 $data_dir

# === Render the systemd service ===
ynh_add_systemd_config

# === Render nginx config ===
ynh_add_nginx_config

# === Configure SSO ===
yunohost app ssowatconf

# === Start the service ===
ynh_systemd_action --service_name=$app --action=start --log_path=systemd

# === Reload nginx ===
ynh_systemd_action --service_name=nginx --action=reload
```

### Source definition

YunoHost's `ynh_setup_source` reads from a `sources/` folder or a `sources` extra config. For a GitHub release tarball, add to `manifest.toml`:

```toml
[sources]
    [sources.main]
    url = "https://github.com/thibaultmol/panoramax-review/archive/refs/tags/v1.0.0.tar.gz"
    sha256 = "..."  # pre-computed by `sha256sum` on the tarball
    format = "tar.gz"
    in_subdir = true
```

Or, if you prefer git clone, leave it out and clone manually in the install script.

## `conf/systemd.service`

Template (YunoHost replaces `__APP__`, `__INSTALL_DIR__`, `__PORT__`, `__DATA_DIR__`, `__APP_USER__`):

```ini
[Unit]
Description=Panoramax Image Review app
After=network.target

[Service]
Type=simple
User=__APP_USER__
Group=__APP_USER__
WorkingDirectory=__INSTALL_DIR__
Environment=NODE_ENV=production
Environment=PORT=__PORT__
Environment=DATA_DIR=__DATA_DIR__
ExecStart=/usr/bin/node __INSTALL_DIR__/dist/server.cjs
Restart=on-failure
RestartSec=5s

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=__DATA_DIR__ __INSTALL_DIR__
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LockPersonality=true
MemoryDenyWriteExecute=false   # Node needs JIT
RestrictRealtime=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
```

Important: `ReadWritePaths` must include both `data_dir` (where the SQLite file lives) and `install_dir` (only if the app writes logs there — it shouldn't, but better-safe). Node itself needs to read `node_modules`.

## `conf/nginx.conf`

YunoHost templates use `__PATH__`, `__PORT__`, `__DOMAIN__`:

```nginx
location __PATH__/ {
    # Redirect sub-path to root if needed
    # YunoHost usually handles this; the rest is the actual proxy block.

    proxy_pass http://127.0.0.1:__PORT__/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Remote-User $remote_user;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket support (not strictly needed, but cheap)
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # Streaming for proxy-image
    proxy_buffering off;
    proxy_request_buffering off;

    # Long-running uploads (import endpoint)
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    client_max_body_size 20m;
}
```

Key line: `proxy_set_header X-Remote-User $remote_user;` — this is what tells the Node backend who is signed in. `$remote_user` is populated by YunoHost's `auth_request` to LDAP when the user has a valid session.

### Sub-path install

If the user installs at `/panoramax` instead of root, YunoHost strips the `/panoramax` prefix before proxying (the trailing `/` on `proxy_pass http://...__PORT__/;` does this). The app must be built with `base: '/panoramax/'` in `vite.config.ts` so assets load correctly. **Detect this at build time:**

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  // ...
});
```

The YunoHost install script passes `VITE_BASE_PATH=/$path/` when running `npm run build`. For root installs (`path=/`), `VITE_BASE_PATH` is `/` (or unset).

This is the only thing in the app that's sub-path-sensitive. All `/api/*` calls are relative and Just Work.

## `scripts/upgrade`

```bash
#!/bin/bash
source /usr/share/yunohost/helpers

app=$YNH_APP_INSTANCE_NAME
install_dir=$(ynh_app_setting_get $app install_dir)

# Pull new source and rebuild
ynh_setup_source --dest_dir=$install_dir --source_id=main --keep=data/

pushd $install_dir
    ynh_exec_as $app npm ci --production=false
    ynh_exec_as $app npm run build
popd

ynh_systemd_action --service_name=$app --action=restart --log_path=systemd
```

`--keep=data/` ensures the SQLite file survives an upgrade.

## `scripts/backup`

```bash
#!/bin/bash
source /usr/share/yunohost/helpers

app=$YNH_APP_INSTANCE_NAME
install_dir=$(ynh_app_setting_get $app install_dir)
data_dir=$(ynh_app_setting_get $app data_dir)

ynh_backup --src_path=$install_dir --dest_path=app
ynh_backup --src_path=$data_dir --dest_path=data
ynh_backup --src_path=/etc/systemd/system/$app.service --dest_path=systemd
ynh_backup --src_path=/etc/nginx/conf.d/$domain.d/$app.conf --dest_path=nginx
```

## `scripts/restore`

Reverse of backup: stop service, restore files, re-render configs (since paths may have changed), start service.

```bash
#!/bin/bash
source /usr/share/yunohost/helpers

app=$YNH_APP_INSTANCE_NAME
domain=$YNH_DOMAIN_ARG
path=$YNH_PATH_ARG
port=$(ynh_port_get --bind=127.0.0.1)

ynh_restore --src_path=app --dest_path=$install_dir
ynh_restore --src_path=data --dest_path=$data_dir

chown -R $app:$app $install_dir $data_dir

ynh_add_systemd_config
ynh_add_nginx_config
yunohost app ssowatconf
ynh_systemd_action --service_name=$app --action=start
ynh_systemd_action --service_name=nginx --action=reload
```

## `scripts/remove`

```bash
#!/bin/bash
source /usr/share/yunohost/helpers

app=$YNH_APP_INSTANCE_NAME
install_dir=$(ynh_app_setting_get $app install_dir)

ynh_systemd_action --service_name=$app --action=stop
ynh_secure_remove $install_dir
ynh_secure_remove /etc/systemd/system/$app.service
ynh_secure_remove /etc/nginx/conf.d/$domain.d/$app.conf
ynh_systemd_action --service_name=nginx --action=reload
yunohost app ssowatconf
```

## Testing the package locally

YunoHost provides a CI tool: `yunohost-bordeaux-test` or the official [package_check](https://github.com/YunoHost/package_check). Recommended workflow:

1. Set up a test YunoHost VM (the project provides Vagrant/LXC images).
2. Copy the package repo into `/tmp/panoramax-review_ynh`.
3. Run `yunohost app install /tmp/panoramax-review_ynh`.
4. Watch for script errors, fix, iterate.
5. Once install succeeds, visit the URL, log in via YunoHost SSO, verify the app works.
6. Test `yunohost app upgrade`, `yunohost app remove`, `yunohost backup create --apps panoramax-review` + restore.

## Common pitfalls

- **Node not available:** YunoHost 11+ has the `ynh_install_nodejs` helper. If it fails, fall back to installing NodeSource's Node 20 apt repo manually in the install script.
- **`better-sqlite3` native build:** The package includes a prebuilt binary for common platforms, but if it falls back to source build, `python3` and `make` and `g++` must be available. The install script should `ynh_install_build_dependencies` those, then `ynh_remove_build_dependencies` after build.
- **Permissions on `data/`:** must be owned by the $app user and not world-readable. The systemd unit's `ProtectSystem=strict` enforces this regardless.
- **`X-Remote-User` spoofing:** Only nginx (on localhost) sets this header. The Node backend MUST additionally check `req.ip` is loopback. Without that check, any client that bypasses nginx could spoof the header.
- **Sub-path install:** Use `VITE_BASE_PATH` to set the Vite `base` option. Without it, JS/CSS assets won't load when installed at `/panoramax`.
- **Service worker scope:** The SW must be registered at `${base}sw.js`. Vite copies `public/sw.js` to `dist/sw.js` at build time; the registration path in `main.tsx` must account for the base path (`${import.meta.env.BASE_URL}sw.js`).
