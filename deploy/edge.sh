#!/bin/bash
# TLS edge for bdc-it.uk. Idempotent. Does not print or rewrite backend/.env.
# If /etc/letsencrypt/live/bdc-it.uk/fullchain.pem already exists, certbot is not run.
set -euo pipefail

domain=bdc-it.uk
script_dir=$(cd "$(dirname "$0")" && pwd)
deploy_path=$(cd "$script_dir/.." && pwd)
cert="/etc/letsencrypt/live/${domain}/fullchain.pem"
key="/etc/letsencrypt/live/${domain}/privkey.pem"
webroot=/var/www/certbot
site_avail=/etc/nginx/sites-available/qa_test
site_enabled=/etc/nginx/sites-enabled/qa_test
snippet_src="${script_dir}/nginx/qa_api_proxy.conf"
site_src="${script_dir}/nginx/qa_test.conf"

if [ "$(id -u)" -ne 0 ]; then
  echo "edge.sh must run as root"
  exit 1
fi

case "$deploy_path" in
  *[!A-Za-z0-9/_.-]*)
    echo "Refusing unexpected deploy path"
    exit 1
    ;;
esac

if [ ! -f "$snippet_src" ] || [ ! -f "$site_src" ]; then
  echo "Missing nginx files next to edge.sh"
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1 || ! command -v certbot >/dev/null 2>&1; then
  apt-get update
  apt-get install -y nginx certbot ca-certificates
fi

mkdir -p "$webroot" /etc/nginx/snippets /etc/letsencrypt/renewal-hooks/deploy
chmod 755 "$webroot"
install -m 644 "$snippet_src" /etc/nginx/snippets/qa_api_proxy.conf

install_site() {
  sed "s|__DEPLOY_PATH__|${deploy_path}|g" "$site_src" > "$site_avail"
  ln -sfn "$site_avail" "$site_enabled"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  if systemctl is-active --quiet nginx; then
    systemctl reload nginx
  else
    systemctl start nginx
  fi
}

if [ ! -f "$cert" ] || [ ! -f "$key" ]; then
  cat > "$site_avail" <<EOF
server {
    listen 80;
    server_name ${domain};
    location ^~ /.well-known/acme-challenge/ {
        root ${webroot};
        default_type "text/plain";
    }
    root ${deploy_path}/frontend;
    index index.html;
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
  ln -sfn "$site_avail" "$site_enabled"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  if systemctl is-active --quiet nginx; then
    systemctl reload nginx
  else
    systemctl start nginx
  fi

  email=""
  env_file="${deploy_path}/backend/.env"
  if [ -f "$env_file" ]; then
    email=$(sed -n 's/^CERTBOT_EMAIL=//p' "$env_file" | head -n 1 | tr -d "\"'[:space:]")
  fi
  if [ -n "$email" ]; then
    certbot certonly --webroot -w "$webroot" -d "$domain" --non-interactive --agree-tos --keep-until-expiring -m "$email"
  else
    certbot certonly --webroot -w "$webroot" -d "$domain" --non-interactive --agree-tos --keep-until-expiring --register-unsafely-without-email
  fi
else
  echo "Certificate already present. Skipping certbot."
fi

if [ ! -f "$cert" ] || [ ! -f "$key" ]; then
  echo "Certificate files are missing after the certbot step"
  exit 1
fi

install_site

hook=/etc/letsencrypt/renewal-hooks/deploy/qa-reload-nginx.sh
if [ ! -f "$hook" ]; then
  printf '%s\n' '#!/bin/sh' 'systemctl reload nginx' > "$hook"
  chmod 755 "$hook"
fi

if systemctl list-unit-files --no-legend 'certbot.timer' 2>/dev/null | grep -q '^certbot.timer'; then
  systemctl enable --now certbot.timer
fi

close_port_3000() {
  if ! command -v ufw >/dev/null 2>&1; then
    echo "ufw is not installed. Port 3000 is closed by binding Node to 127.0.0.1."
    return 0
  fi
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  local i=0
  while ufw show added 2>/dev/null | grep -Eiq 'allow[[:space:]].*3000'; do
    ufw --force delete allow 3000/tcp >/dev/null 2>&1 || ufw --force delete allow 3000 >/dev/null 2>&1 || true
    i=$((i + 1))
    if [ "$i" -ge 8 ]; then
      echo "Stopped removing ufw allow rules for port 3000 after ${i} attempts"
      break
    fi
  done
  if ! ufw show added 2>/dev/null | grep -Eiq 'deny[[:space:]].*3000'; then
    ufw deny 3000/tcp
  fi
  if ufw status | grep -q 'Status: active'; then
    echo "ufw active: incoming tcp/3000 is denied"
  else
    echo "ufw is not active. The tcp/3000 deny rule is stored and applies after 'ufw enable'."
  fi
}

close_port_3000
echo "TLS edge is in place for https://${domain}/"
