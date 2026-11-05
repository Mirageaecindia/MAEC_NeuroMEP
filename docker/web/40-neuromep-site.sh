#!/bin/sh
# Writes the NeuroMEP site config at container start (run by the Nginx image entrypoint):
# HTTPS when a certificate pair is mounted in /etc/nginx/certs, plain HTTP otherwise.
set -eu

CERTS=/etc/nginx/certs
if [ -s "$CERTS/fullchain.pem" ] && [ -s "$CERTS/privkey.pem" ]; then
  template=/etc/neuromep/https.conf.template
  echo "neuromep: certificates found in $CERTS - serving HTTPS on 443 (80 redirects)"
else
  template=/etc/neuromep/http.conf.template
  echo "neuromep: no certificates in $CERTS - serving plain HTTP on 80"
fi

# The HTTP -> HTTPS redirect keeps a published HTTPS port other than 443 (e.g. 8443).
if [ "${PUBLIC_HTTPS_PORT:-443}" = "443" ]; then HTTPS_REDIRECT_SUFFIX=""; else HTTPS_REDIRECT_SUFFIX=":$PUBLIC_HTTPS_PORT"; fi
export HTTPS_REDIRECT_SUFFIX

# Only our variables are replaced; Nginx variables such as $host stay as they are.
envsubst '${API_UPSTREAM} ${SERVER_NAME} ${RESOLVER} ${HTTPS_REDIRECT_SUFFIX}'   < "$template" > /etc/nginx/conf.d/neuromep.conf
