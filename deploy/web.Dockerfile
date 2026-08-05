FROM caddy:2.10-alpine

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY index.html manifest.json sw.js icon.svg icon-192.png icon-512.png /srv/
COPY js /srv/js
