---
sidebar_position: 2
id: vps-and-systemd
title: VPS & Systemd Service
description: Running NodeStack as a managed Linux systemd service
---

️ VPS & Systemd Service

Running NodeStack on a Linux server (Ubuntu/Debian) with `systemd` ensures auto-restart on crashes and reboot.

---

## 1. Systemd Service Unit File

Create `/etc/systemd/system/nodestack.service`:

```ini
[Unit]
Description=NodeStack Backend Service
After=network.target

[Service]
Type=simple
User=nodestack
WorkingDirectory=/var/www/nodestack
ExecStart=/usr/bin/node bin/nodestack.js start
Restart=on-failure
RestartSec=5s
Environment=NODE_ENV=production
Environment=NODESTACK_PORT=8090
Environment=NODESTACK_HOST=127.0.0.1
Environment=NODESTACK_DATA_DIR=/var/data/nodestack

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nodestack
sudo systemctl status nodestack
```

---

## 2. Reverse Proxy (Caddy or Nginx)

### Caddyfile (Automatic SSL)

```caddy
api.myapp.com {
    reverse_proxy 127.0.0.1:8090
}
```

### Nginx

```nginx
server {
    server_name api.myapp.com;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_cache off;
    }
}
```
