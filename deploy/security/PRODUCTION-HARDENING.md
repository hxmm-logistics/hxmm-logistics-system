# HX MM Production Hardening Runbook

This runbook is for the Ubuntu 24.04 VPS. Keep the current SSH session open until a second SSH login is verified.

## 1. PostgreSQL bind check

```bash
sudo ss -tulpn | grep 5432 || true
sudo grep -E "^[[:space:]]*listen_addresses" /etc/postgresql/16/main/postgresql.conf || true
```

Expected: PostgreSQL listens on `127.0.0.1:5432` or Unix socket, not `0.0.0.0:5432`.

If needed:

```bash
sudo cp /etc/postgresql/16/main/postgresql.conf /etc/postgresql/16/main/postgresql.conf.bak.$(date +%Y%m%d%H%M%S)
sudo sed -i "s/^#*listen_addresses.*/listen_addresses = 'localhost'/" /etc/postgresql/16/main/postgresql.conf
sudo systemctl restart postgresql
sudo ss -tulpn | grep 5432 || true
```

## 2. UFW firewall

Replace `22222` with the verified SSH port.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22222/tcp
sudo ufw enable
sudo ufw status verbose
sudo ss -tulpn
```

Rollback:

```bash
sudo ufw disable
```

## 3. SSH hardening without lockout

Do not close the current SSH session.

```bash
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%Y%m%d%H%M%S)
sudo mkdir -p /etc/ssh/sshd_config.d
sudo tee /etc/ssh/sshd_config.d/99-hxmm-hardening.conf >/dev/null <<'EOF'
Port 22222
PermitRootLogin prohibit-password
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
EOF
sudo sshd -t
sudo systemctl reload ssh
```

Before closing the old session, open a second terminal and verify:

```bash
ssh -p 22222 your_user@45.76.145.107
```

Rollback from the still-open session:

```bash
sudo rm /etc/ssh/sshd_config.d/99-hxmm-hardening.conf
sudo sshd -t
sudo systemctl reload ssh
```

## 4. Fail2ban

```bash
sudo apt update
sudo apt install -y fail2ban
sudo cp deploy/security/hxmm-nginx-api-scan.filter /etc/fail2ban/filter.d/hxmm-nginx-api-scan.conf
sudo cp deploy/security/fail2ban-hxmm-nginx.conf /etc/fail2ban/jail.d/hxmm-nginx.conf
sudo tee /etc/fail2ban/jail.d/sshd-hxmm.conf >/dev/null <<'EOF'
[sshd]
enabled = true
port = 22222
maxretry = 3
findtime = 600
bantime = 3600
EOF
sudo systemctl enable --now fail2ban
sudo systemctl restart fail2ban
sudo fail2ban-client status
sudo fail2ban-client status sshd
sudo fail2ban-client status hxmm-nginx-api-scan
```

Rollback:

```bash
sudo rm -f /etc/fail2ban/jail.d/hxmm-nginx.conf /etc/fail2ban/filter.d/hxmm-nginx-api-scan.conf /etc/fail2ban/jail.d/sshd-hxmm.conf
sudo systemctl restart fail2ban
```

## 5. Nginx

```bash
sudo cp deploy/nginx/hxmm.conf /etc/nginx/sites-available/hxmm.conf
sudo ln -sf /etc/nginx/sites-available/hxmm.conf /etc/nginx/sites-enabled/hxmm.conf
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl status nginx --no-pager
curl -i http://127.0.0.1/api/health
```

The included Nginx config adds basic API and login rate limits. If Cloudflare is later enabled, update real IP handling before trusting `$remote_addr`:

```nginx
# Example only. Replace with current Cloudflare IP ranges.
set_real_ip_from 173.245.48.0/20;
real_ip_header CF-Connecting-IP;
```

## 6. PM2

```bash
pm2 start ecosystem.config.cjs
pm2 restart hx-mm-api --update-env
pm2 save
pm2 startup
pm2 status
```

## 7. HTTPS with Let's Encrypt

Only run this after a real domain points to the server.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example
sudo certbot renew --dry-run
```

## 8. PostgreSQL daily backup

```bash
sudo mkdir -p /var/backups/hxmm-postgres
sudo chmod 700 /var/backups/hxmm-postgres
sudo cp deploy/backup/postgres-backup.sh /usr/local/bin/hxmm-postgres-backup
sudo chmod 700 /usr/local/bin/hxmm-postgres-backup
sudo tee /etc/cron.d/hxmm-postgres-backup >/dev/null <<'EOF'
DATABASE_URL=postgresql://hxmm_user:change-this-password@127.0.0.1:5432/hx_logistics
BACKUP_DIR=/var/backups/hxmm-postgres
RETENTION_DAYS=7
15 2 * * * root /usr/local/bin/hxmm-postgres-backup >> /var/log/hxmm-postgres-backup.log 2>&1
EOF
sudo /usr/local/bin/hxmm-postgres-backup
sudo ls -lh /var/backups/hxmm-postgres
```

## 9. Access log rotation

```bash
sudo cp deploy/security/hxmm-logrotate /etc/logrotate.d/hxmm
sudo logrotate -t /etc/logrotate.d/hxmm
```

Rollback:

```bash
sudo rm -f /etc/cron.d/hxmm-postgres-backup /usr/local/bin/hxmm-postgres-backup
```
