#!/usr/bin/env bash
# NeuroMEP port exposure check (security review, WBS 1.8.2): the site must be reachable through
# its one published port only; the API (4000) and MongoDB (27017) never from outside.
#
#   docker/check-exposure.sh config                 # compose files: what would be published
#   docker/check-exposure.sh server                 # on the server: running containers + sockets
#   docker/check-exposure.sh remote <server-ip> [https://site]   # from another machine
#
# config / server read COMPOSE_FILE from .env.docker (company server: both files), or
# ENV_FILE=<file> to use another. remote tries only NeuroMEP's own ports - it is not a scan.
set -u
ENV_FILE=${ENV_FILE:-.env.docker}
fails=0
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; fails=$((fails + 1)); }
info() { printf '  ....  %s\n' "$1"; }

# The port the site should be on: 127.0.0.1:8085 with compose.server.yaml, else 80 / 443.
expected_binding() {
  case "${COMPOSE_FILE:-$(grep -E '^COMPOSE_FILE=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)}" in
    *compose.server.yaml*) echo server ;;
    *) echo default ;;
  esac
}

check_config() {
  echo "Compose configuration ($ENV_FILE)"
  local json
  if ! json=$(docker compose --env-file "$ENV_FILE" config --format json 2>&1); then
    fail "docker compose config failed: $json"
    return
  fi
  # Published ports per service as service=host_ip:published->target.
  local ports
  ports=$(printf '%s' "$json" | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const c = JSON.parse(s);
      for (const [name, svc] of Object.entries(c.services ?? {}))
        for (const p of svc.ports ?? [])
          console.log(`${name}=${p.host_ip ?? "0.0.0.0"}:${p.published}->${p.target}`);
      if (!Object.values(c.services ?? {}).some((x) => x.ports?.length)) console.log("none");
    });')
  for svc in db api; do
    if printf '%s\n' "$ports" | grep -q "^$svc="; then
      fail "$svc publishes a port: $(printf '%s\n' "$ports" | grep "^$svc=" | tr '\n' ' ')"
    else
      pass "$svc publishes no port (project network only)"
    fi
  done
  local front
  front=$(printf '%s\n' "$ports" | grep '^frontend=' | cut -d= -f2 | sort | tr '\n' ' ')
  if [ "$(expected_binding)" = server ]; then
    [ "$front" = "127.0.0.1:8085->80 " ] &&
      pass "frontend publishes only 127.0.0.1:8085 -> 80 (Caddy in front)" ||
      fail "frontend publishes '$front' - expected only 127.0.0.1:8085->80"
  else
    info "frontend publishes: $front(no compose.server.yaml: 80 / 443 on every address)"
  fi
}

check_server() {
  echo "Running containers"
  local project
  project=$(docker compose --env-file "$ENV_FILE" config --format json 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).name))')
  [ -n "$project" ] || { fail "cannot read the compose project name"; return; }
  info "project $project"
  local running=0
  for svc in db api frontend; do
    local id
    id=$(docker compose --env-file "$ENV_FILE" ps -q "$svc" 2>/dev/null)
    if [ -z "$id" ]; then
      fail "$svc is not running"
      continue
    fi
    running=$((running + 1))
    local published
    published=$(docker port "$id" 2>/dev/null | sort | tr '\n' ' ')
    case "$svc" in
      db | api)
        [ -z "$published" ] && pass "$svc container publishes no port" ||
          fail "$svc container publishes: $published"
        ;;
      frontend)
        if [ "$(expected_binding)" = server ]; then
          [ "$published" = "80/tcp -> 127.0.0.1:8085 " ] &&
            pass "frontend container publishes only 127.0.0.1:8085" ||
            fail "frontend container publishes: $published"
        else
          info "frontend container publishes: $published"
        fi
        ;;
    esac
  done

  echo "Listening sockets on the host"
  if command -v ss >/dev/null; then
    local listen
    listen=$(ss -ltnH 2>/dev/null | awk '{print $4}')
    for port in 4000 27017; do
      printf '%s\n' "$listen" | grep -Eq "[:.]$port\$" &&
        fail "something listens on host port $port: $(printf '%s\n' "$listen" | grep -E "[:.]$port\$" | tr '\n' ' ')" ||
        pass "nothing listens on host port $port"
    done
    if [ "$(expected_binding)" = server ]; then
      local on8085
      on8085=$(printf '%s\n' "$listen" | grep -E '[:.]8085$' | sort -u | tr '\n' ' ')
      [ "$on8085" = "127.0.0.1:8085 " ] && pass "port 8085 listens on 127.0.0.1 only" ||
        fail "port 8085 listens on: ${on8085:-nothing}"
    fi
  else
    info "ss not found: socket check skipped"
  fi

  echo "Reachability from this server"
  local health
  health=$(curl -s -m 5 http://127.0.0.1:8085/healthz 2>/dev/null)
  if [ "$(expected_binding)" = server ]; then
    [ "$health" = "ok" ] && pass "site answers on 127.0.0.1:8085 (/healthz ok)" ||
      fail "no answer on 127.0.0.1:8085/healthz"
    # The server's own non-loopback addresses must not answer on 8085.
    for ip in $(hostname -I 2>/dev/null); do
      case "$ip" in 127.* | ::1 | 172.1[6-9].* | 172.2[0-9].* | 172.3[01].* | 10.231.4.*) continue ;; esac
      curl -s -m 3 -o /dev/null "http://$ip:8085/healthz" 2>/dev/null &&
        fail "port 8085 answers on $ip - it must be on 127.0.0.1 only" ||
        pass "port 8085 does not answer on $ip"
    done
  fi
  [ "$running" -gt 0 ] || info "no containers running: start the stack first"
}

check_remote() {
  local ip=${1:-}
  local site=${2:-}
  [ -n "$ip" ] || { echo "usage: $0 remote <server-ip> [https://site]"; exit 2; }
  echo "From this machine to $ip (NeuroMEP's ports only)"
  for port in 8085 4000 27017; do
    if (exec 3<>"/dev/tcp/$ip/$port") 2>/dev/null; then
      fail "port $port is open on $ip - it must not be reachable from outside"
    else
      pass "port $port is closed or filtered on $ip"
    fi
  done
  if [ -n "$site" ]; then
    local code
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$site/healthz")
    [ "$code" = 200 ] && pass "site answers through Caddy: $site/healthz" ||
      fail "site $site/healthz answered HTTP $code"
    local headers
    headers=$(curl -sI -m 10 "$site/")
    for h in strict-transport-security x-content-type-options x-frame-options; do
      printf '%s\n' "$headers" | grep -qi "^$h:" && pass "header $h present" ||
        fail "header $h missing"
    done
    printf '%s\n' "$headers" | grep -qi '^x-powered-by:' && fail "x-powered-by header present" ||
      pass "no x-powered-by header"
    printf '%s\n' "$headers" | grep -qiE '^server:.*[0-9]' &&
      fail "server header shows a version: $(printf '%s\n' "$headers" | grep -i '^server:')" ||
      pass "server header shows no version"
    local plain
    plain=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://${site#https://}/")
    case "$plain" in 301 | 302 | 308) pass "plain HTTP redirects to HTTPS ($plain)" ;;
      000) pass "plain HTTP is closed" ;;
      *) fail "plain HTTP answered $plain - expected a redirect to HTTPS" ;; esac
  fi
}

case "${1:-}" in
  config) check_config ;;
  server) check_config; check_server ;;
  remote) shift; check_remote "$@" ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
echo
[ "$fails" -eq 0 ] && echo "All checks passed." || echo "$fails check(s) failed."
exit $((fails > 0))
