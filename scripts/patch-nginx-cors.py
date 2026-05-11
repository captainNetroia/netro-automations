#!/usr/bin/env python3
"""
patch-nginx-cors.py
Injecte un bloc location ~* ^/webhook/ dans nginx/conf.d/n8n.conf
Restaure depuis .bak avant patch pour idempotence.
Run via: cat scripts/patch-nginx-cors.py | ssh root@187.124.36.81 python3
"""
import re, shutil, sys

CONF = '/opt/n8n/compose/nginx/conf.d/n8n.conf'
BAK  = CONF + '.bak'

# Restore backup to start from clean state
print(f"[1/4] Restauration depuis {BAK} ...", flush=True)
try:
    shutil.copy2(BAK, CONF)
    print("      OK", flush=True)
except FileNotFoundError:
    print(f"      WARN: backup introuvable, on continue avec le fichier existant", flush=True)

# Read current config
print(f"[2/4] Lecture de {CONF} ...", flush=True)
with open(CONF, 'r') as fh:
    content = fh.read()

print(f"      {len(content)} octets lus", flush=True)

# The block to inject — Python strings, no bash expansion
WEBHOOK_BLOCK = """\
    location ~* ^/webhook/ {
        if ($request_method = OPTIONS) {
            add_header 'Access-Control-Allow-Origin' 'https://netroia.tech';
            add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS';
            add_header 'Access-Control-Allow-Headers' 'Content-Type';
            add_header 'Access-Control-Max-Age' '86400';
            return 204;
        }
        proxy_pass         http://n8n:5678;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   X-Forwarded-Host  $host;
        proxy_read_timeout    3600;
        proxy_send_timeout    3600;
        proxy_connect_timeout 60;
        proxy_buffering        off;
        proxy_request_buffering off;
        client_max_body_size   100M;
    }

"""

print(f"[3/4] Injection du bloc webhook CORS ...", flush=True)

if 'location ~* ^/webhook/' in content:
    print("      Bloc deja present — rien a faire.", flush=True)
    sys.exit(0)

# Insert before the first standalone `location / {`
pattern = r'(\n\s+location\s+/\s+\{)'
new_content, count = re.subn(pattern, '\n' + WEBHOOK_BLOCK + r'\1', content, count=1)

if count == 0:
    # Try simpler pattern
    pattern2 = r'(location\s+/\s+\{)'
    new_content, count = re.subn(pattern2, WEBHOOK_BLOCK + r'\1', content, count=1)

if count == 0:
    print("ERREUR: pattern 'location / {' introuvable dans le fichier.", flush=True)
    print("Contenu actuel:", flush=True)
    print(content[:2000], flush=True)
    sys.exit(1)

print(f"      Insertion effectuee ({count} remplacement(s))", flush=True)

print(f"[4/4] Ecriture du fichier patche ...", flush=True)
with open(CONF, 'w') as fh:
    fh.write(new_content)

print("      OK — fichier ecrit", flush=True)
print("", flush=True)
print("Prochaines etapes:", flush=True)
print("  docker exec n8n_nginx nginx -t", flush=True)
print("  docker exec n8n_nginx nginx -s reload", flush=True)
