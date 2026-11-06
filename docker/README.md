# Running NeuroMEP with Docker

The server needs **Docker Engine with the Compose plugin** and nothing else. Node, npm, MongoDB
and Nginx all run inside the images, and the app is built inside them too.

| Service    | Image          | Built from (`Dockerfile` target) | What it runs                                                                    | Published                                       |
| ---------- | -------------- | -------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| `frontend` | `neuromep-web` | `web` (nginx 1.28-alpine)        | The React build; proxies `/api` to the API; HTTPS when certificates are mounted | 80, 443 (company server: `127.0.0.1:8085` only) |
| `api`      | `neuromep-api` | `api` (node 24-alpine)           | Express API, production dependencies only, as the unprivileged `node` user      | no (project network)                            |
| `db`       | `neuromep-db`  | `db` (mongo 8.0)                 | MongoDB single-node replica set (transactions need one), with authentication    | no (project network)                            |

`compose.yaml` builds the three images and runs them together. Data is kept in three named volumes:

- `mongo-data`: the database
- `mongo-config`: the replica-set key file, created on first start
- `plans`: floor-plan PDFs (A-02)

## First deployment

```sh
# 1. Get the code on the server
git clone https://github.com/Mirageaecindia/MAEC_NeuroMEP.git neuromep && cd neuromep

# 2. Settings: passwords for the MongoDB administrator and for the API's own account
cp .env.docker.example .env.docker
openssl rand -hex 24          # run twice: one value for MONGO_ROOT_PASSWORD, one for MONGO_APP_PASSWORD
nano .env.docker              # paste them; set SERVER_NAME to the domain, e.g. neuromep.example.com

# 3. Users (prototype user file, WBS 1.2.2): one entry per person, roles as in apps/api/config/users.dev.json
cp docker/users.example.json docker/users.json
docker compose --env-file .env.docker build api          # the API image has the password tool
docker compose --env-file .env.docker run --rm --no-deps api node apps/api/dist/auth/hash-password.js
                              # type the password (12+ characters); paste the printed hash into docker/users.json

# 4. HTTPS certificate (see below), then start everything
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps                 # all three "healthy" after about 30 s
```

Open `https://<SERVER_NAME>` and sign in with a user from `docker/users.json`.

Passwords go into the API's connection string, so use only letters, digits, `-` and `_` (the
`openssl rand -hex` output qualifies). The MongoDB accounts are created on the **first start
only**. To change them later, change them in MongoDB as well, or start over with empty volumes.

## Company server (maec-neuromep)

On the company server Caddy on the host ends TLS and forwards the site to `127.0.0.1:8085`.
`compose.server.yaml` sets that up on top of `compose.yaml`:

- the project is called `maec-neuromep`; containers, the network and the volumes take that
  prefix (`maec-neuromep_mongo-data`, `_mongo-config`, `_plans`). **Never rename it once data
  exists**: the app would start on new, empty volumes and the data would sit under the old name;
- `frontend` publishes only `127.0.0.1:8085` -> 80, plain HTTP, instead of 80 / 443;
- the project network has the fixed subnet `10.231.4.0/24`;
- MongoDB's cache is capped at 0.5 GB (`--wiredTigerCacheSizeGB`), as the server is shared.

Check the server first:

```sh
grep -c -w avx /proc/cpuinfo   # above 0: MongoDB 8 needs AVX; 0 means it crashes on start
free -h                        # room for one more database
docker compose version         # 2.24.4 or newer: compose.server.yaml uses "!override"
```

Set the two files in `.env.docker`, so every `docker compose --env-file .env.docker ...`
command uses both - an `export` would last for one shell only:

```sh
# in .env.docker (the line is in .env.docker.example, commented out):
COMPOSE_FILE=compose.yaml:compose.server.yaml
```

```sh
docker compose --env-file .env.docker config | head -1   # name: maec-neuromep
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps                 # frontend shows 127.0.0.1:8085->80/tcp
curl -s http://127.0.0.1:8085/healthz                    # ok
```

Leave `docker/certs/` empty there: the certificate belongs to Caddy. Keep `COOKIE_SECURE=true`
(Caddy serves the site over HTTPS, so browsers keep the session cookie). Caddy passes `Host`,
`X-Forwarded-For` and `X-Forwarded-Proto` on and sets no upload limit by default, which is what
the sign-in limits (E0103) and the 20 MB floor plans need:

```caddy
neuromep.example.com {
    reverse_proxy 127.0.0.1:8085
}
```

## HTTPS

Session cookies are `Secure` in production, so browsers sign in only over HTTPS. Put the
certificate and key in `docker/certs/`:

```
docker/certs/fullchain.pem
docker/certs/privkey.pem
```

On start, the frontend container uses HTTPS on 443 and redirects port 80 to it. With no files there it
serves plain HTTP on 80. With Let's Encrypt (certbot on the host, or any other ACME client),
copy or link the two files there, then reload:

```sh
docker compose --env-file .env.docker restart frontend   # after every certificate renewal
```

A test server reached over `http://<ip>` without a certificate needs `COOKIE_SECURE=false` in
`.env.docker`. Never use that setting on a public server.

## Updating

```sh
git pull
docker compose --env-file .env.docker up -d --build      # rebuilds changed images, keeps the volumes
docker image prune -f                                    # removes the old image layers
```

## Backups

```sh
# Database: a compressed archive of the neuromep database
docker compose --env-file .env.docker exec -T db sh -c 'mongodump --quiet --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db neuromep --archive --gzip' > neuromep-$(date +%F).archive.gz

# Floor plans: the plans volume as a tar file (maec-neuromep_plans on the company server,
# neuromep_plans without compose.server.yaml)
docker run --rm -v maec-neuromep_plans:/data/plans -v "$PWD":/backup alpine tar czf /backup/plans-$(date +%F).tar.gz -C /data plans
```

To restore, pipe the archive into `mongorestore` with the same flags, adding `--drop`. Run both
commands nightly from cron for the backups listed in WBS 1.8.3.

## Building on another machine

If the server should not build the images, build them where Docker is available and copy them over:

```sh
docker compose --env-file .env.docker build
docker save neuromep-web neuromep-api neuromep-db | gzip > neuromep-images.tar.gz
# on the server, next to compose.yaml, .env.docker and docker/:
gunzip -c neuromep-images.tar.gz | docker load
docker compose --env-file .env.docker up -d              # no --build: uses the loaded images
```

The images are built for the CPU of the machine that builds them. For an x86 server built on an
ARM laptop, add `--platform linux/amd64` (`DOCKER_DEFAULT_PLATFORM=linux/amd64`).

## Checking a deployment

```sh
docker compose --env-file .env.docker logs -f api        # or db / frontend
curl -fsS https://<SERVER_NAME>/api/health               # {"status":"ok",...}
E2E_BASE_URL=https://<SERVER_NAME> npm run test:e2e      # from a development machine; needs the dev users
```

The Playwright smoke tests sign in with the development users, so run them only against a
staging stack whose `docker/users.json` is a copy of `apps/api/config/users.dev.json`.

### Port exposure (security review, WBS 1.8.2)

The site must be reachable through Caddy only. The API (4000) and MongoDB (27017) must never be
reachable from outside, and port 8085 only on `127.0.0.1`. `docker/check-exposure.sh` checks this:

```sh
docker/check-exposure.sh config    # compose files: db / api publish nothing, frontend only 127.0.0.1:8085
docker/check-exposure.sh server    # on the server: + running containers, listening sockets, 8085 not on public addresses
docker/check-exposure.sh remote <server-ip> https://<site>   # from your laptop: 8085 / 4000 / 27017 closed, site + headers through Caddy
```

`remote` tries only NeuroMEP's three ports and the site address, so it is not a port scan. Run
`server` after every change to the compose files. Docker's published ports bypass a host
firewall such as `ufw`, so the `127.0.0.1` binding is what keeps 8085 private, not the firewall.

The web image sends a Content Security Policy in report-only mode
(`Content-Security-Policy-Report-Only` in `docker/web/headers.conf`). Use the site for a while
with the browser console open (Floor Setup with a plan, Cable Size, each Output download). If no
"Content-Security-Policy" report appears, rename the header to `Content-Security-Policy` to
enforce it.

## Settings

| `.env.docker`                                 | Default               | Meaning                                                                           |
| --------------------------------------------- | --------------------- | --------------------------------------------------------------------------------- |
| `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD` | `root` / required     | MongoDB administrator (backups, maintenance)                                      |
| `MONGO_APP_USERNAME` / `MONGO_APP_PASSWORD`   | `neuromep` / required | Account the API uses: read / write on the NeuroMEP database only                  |
| `MONGODB_DB`                                  | `neuromep`            | Database name                                                                     |
| `SERVER_NAME`                                 | `_` (any)             | Domain name for Nginx                                                             |
| `HTTP_PORT` / `HTTPS_PORT`                    | `80` / `443`          | Ports published on the server                                                     |
| `COOKIE_SECURE`                               | `true`                | `false` only for a plain-HTTP test server                                         |
| `NEUROMEP_TAG`                                | `latest`              | Tag of the three images                                                           |
| `VITE_DEMO_EMAIL` / `VITE_DEMO_PASSWORD`      | empty                 | Staging only: the login page's "Demo Credentials" line (built into the web image) |

The API inside the stack also gets the following settings from `compose.yaml`; you don't set them:

- `NODE_ENV=production`
- `MONGODB_URI`, built from the settings above
- `USERS_FILE=/run/neuromep/users.json`
- `TRUST_PROXY=loopback,uniquelocal`, so the API takes the client address passed on by the frontend container, for the sign-in limits (E0103)
