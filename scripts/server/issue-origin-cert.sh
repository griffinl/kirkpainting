#!/usr/bin/env bash
# Issue a Cloudflare Origin CA certificate for a hostname and install it for nginx.
#
# Origin CA certs are trusted ONLY by Cloudflare's proxy (not public browsers), so the
# hostname MUST be proxied (orange cloud) with SSL/TLS mode Full (strict). In return you
# get a 15-year cert with no renewal, and the origin IP stays hidden behind Cloudflare.
#
# Run as root on the analytics server. Needs only: openssl, curl, sed/awk (no python/jq).
# The token needs the "SSL and Certificates : Edit" permission.
#
#   Usage:  CF_TOKEN=xxxxxxxx ./issue-origin-cert.sh stats.onehousedecor.com
#
# Reusable for every niche: just pass that niche's stats.<domain> hostname.
set -euo pipefail

DOMAIN="${1:?usage: CF_TOKEN=... $0 <hostname>}"
: "${CF_TOKEN:?set CF_TOKEN env var to a Cloudflare token with SSL and Certificates:Edit}"
SSL_DIR="/etc/nginx/ssl"
VALIDITY=5475   # days (15 years — Cloudflare Origin CA max)

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo ">> generating private key + CSR for $DOMAIN"
openssl req -new -newkey rsa:2048 -nodes \
  -keyout "$WORK/key.pem" -out "$WORK/csr.pem" -subj "/CN=$DOMAIN" 2>/dev/null

# CSR as a single JSON-escaped line (real newlines -> literal \n). Base64/PEM has no
# quotes or backslashes, so newlines are the only thing that needs escaping.
CSR_ESCAPED="$(awk 'BEGIN{ORS="\\n"}{print}' "$WORK/csr.pem")"

cat > "$WORK/body.json" <<JSON
{"hostnames":["$DOMAIN"],"requested_validity":$VALIDITY,"request_type":"origin-rsa","csr":"$CSR_ESCAPED"}
JSON

echo ">> requesting Origin CA certificate from Cloudflare"
RESP="$(curl -s -X POST "https://api.cloudflare.com/client/v4/certificates" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$WORK/body.json")"

if ! printf '%s' "$RESP" | grep -q '"success":true'; then
  echo "!! Cloudflare API error:"
  printf '%s\n' "$RESP"
  exit 1
fi

mkdir -p "$SSL_DIR"
# pull out "certificate":"...\n..." and turn the literal \n back into real newlines
printf '%s' "$RESP" \
  | grep -o '"certificate":"[^"]*"' \
  | sed -e 's/^"certificate":"//' -e 's/"$//' -e 's/\\n/\n/g' \
  > "$SSL_DIR/$DOMAIN.crt"
cp "$WORK/key.pem" "$SSL_DIR/$DOMAIN.key"
chmod 600 "$SSL_DIR/$DOMAIN.key"

echo ">> installed:"
echo "   cert: $SSL_DIR/$DOMAIN.crt"
echo "   key : $SSL_DIR/$DOMAIN.key"
echo ">> next: point nginx at these, reload, set DNS to Proxied (orange) + SSL Full (strict)."
