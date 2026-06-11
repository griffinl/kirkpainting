#!/usr/bin/env bash
# setup-stats.sh — Stand up a stats.<niche>.com vhost on the Umami analytics box.
#
# Issues a Cloudflare Origin CA cert (15-year, no renewal) for the hostname and
# installs an nginx reverse-proxy to the shared Umami container (127.0.0.1:3000).
# Reusable for every niche — pass that niche's stats hostname.
#
# Prereqs on the server (the CentOS Umami box, 45.79.108.49):
#   - nginx installed and running; Umami listening on 127.0.0.1:3000
#   - the Cloudflare DNS record stats.<domain> → this server, PROXIED (orange)
#   - SSL/TLS mode "Full (strict)" for the zone
#   - a Cloudflare token with "SSL and Certificates : Edit"
#
#   Usage (run as root):
#     CF_TOKEN=xxxxxxxx ./setup-stats.sh stats.kirkpainting.com
#
set -euo pipefail

HOST="${1:?usage: CF_TOKEN=... $0 <stats.hostname>}"
: "${CF_TOKEN:?set CF_TOKEN to a Cloudflare token with SSL and Certificates:Edit}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SSL_DIR="/etc/nginx/ssl"
CONF="/etc/nginx/conf.d/${HOST}.conf"
UPSTREAM="127.0.0.1:3000"   # shared Umami container

# 1. Issue + install the Cloudflare Origin CA cert (→ $SSL_DIR/$HOST.{crt,key})
echo ">> [1/3] issuing Cloudflare Origin CA cert for $HOST"
CF_TOKEN="$CF_TOKEN" bash "$HERE/issue-origin-cert.sh" "$HOST"

# 2. Write the nginx vhost
echo ">> [2/3] writing $CONF"
cat > "$CONF" <<NGINX
# ${HOST} — reverse proxy to the shared Umami analytics container.
# TLS terminates here with a Cloudflare Origin cert (trusted by CF proxy only),
# so ${HOST} MUST stay Proxied (orange) with SSL/TLS = Full (strict).

server {
    listen 80;
    listen [::]:80;
    server_name ${HOST};
    return 301 https://\$host\$request_uri;
}

server {
    # listen-line http2 form for broad nginx compatibility (the standalone
    # "http2 on;" directive only exists on nginx >= 1.25.1).
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${HOST};

    ssl_certificate     ${SSL_DIR}/${HOST}.crt;
    ssl_certificate_key ${SSL_DIR}/${HOST}.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    # NB: no per-server `ssl_session_cache shared:SSL:..` — multiple niche vhosts
    # reusing the same shared-zone name with different sizes makes nginx -t fail.

    # Umami is lightweight; allow room for the dashboard.
    client_max_body_size 2m;

    location / {
        proxy_pass http://${UPSTREAM};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 60s;
    }
}
NGINX

# 3. Validate + reload
echo ">> [3/3] testing nginx config + reloading"
nginx -t
systemctl reload nginx

echo ""
echo "✅ ${HOST} is up. Verify:  curl -I https://${HOST}/script.js"
echo "   It should return 200 and serve the Umami tracker."
