# VPS production deployment

Production runs on one x86-64 Linux VPS, from any provider, as the Docker
Compose project in this directory. Cloudflare Tunnel is the only public ingress:
the host accepts no inbound connections except key-only SSH, and PostgreSQL is
never reachable from the internet. On every push to `main`, GitHub Actions runs
the full CI, builds and smoke-tests the image, publishes it to GitHub Container
Registry (GHCR) tagged with the commit SHA, and sends that SHA and the image's
digest to `bin/release` on the server over SSH. The server runs the image by
digest, checks that the release serves, and restores the previous release when
it does not. Nightly encrypted backups go to S3-compatible storage with restic.
There is one environment; local development and CI are the checks before
production.

| Path                                                                     | Purpose                                                              |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [`compose.yml`](compose.yml)                                             | Production services: PostgreSQL, migrate, API, worker, `cloudflared` |
| [`bin/`](bin/)                                                           | `compose`, `release`, and `backup` scripts                           |
| [`systemd/`](systemd/)                                                   | Nightly backup service and timer                                     |
| [`env.example`](env.example), [`restic.env.example`](restic.env.example) | Templates for the server's secrets files                             |

The image carries this directory as `/app/deploy/vps`. Each release installs
`compose.yml` and `bin/` on the server from the image it releases.

## What runs

| Service       | Image                                               | Reachable from                         | Data                   |
| ------------- | --------------------------------------------------- | -------------------------------------- | ---------------------- |
| `cloudflared` | `cloudflare/cloudflared`, pinned by digest          | Outbound only                          | None                   |
| `api`         | `<APP_IMAGE_REPOSITORY>:<sha>@<digest>`             | `cloudflared`                          | None                   |
| `worker`      | Same image, `node apps/worker/src/main.ts`          | Nothing inbound                        | None                   |
| `migrate`     | Same image, `node packages/database/src/migrate.ts` | Nothing inbound; runs once per release | None                   |
| `postgresql`  | `postgres` Alpine image, pinned by digest           | Docker network; host `127.0.0.1:5432`  | `postgres_data` volume |

Every service has a read-only root filesystem, drops all Linux capabilities and
sets `no-new-privileges`. `api`, `worker` and `migrate` write only to a 16 MB
`/tmp` and run at most 128 processes and threads. `postgresql` starts as the
image's `postgres` user (uid 70) and writes only to its volume,
`/var/run/postgresql` and `/tmp`. Keep `postgres_data` a named volume: Docker
creates it owned by that user, while a bind-mounted host directory would have to
be given to uid 70 first. `cloudflared` runs as its image's non-root user and
writes nothing.

`compose.yml` differs from the local `docker-compose.yml`:

- It pulls images from GHCR and never builds on the host. The app image is
  pinned by digest; until the first release, its tag and digest are placeholders
  that fail if started.
- `migrate` runs only when `bin/release` invokes it, under the `release`
  profile.
- Every long-running service (`postgresql`, `api`, `worker`, `cloudflared`)
  restarts unless stopped and has a memory ceiling. The worker exits on any
  failure and relies on that restart policy. Every service, `migrate` included,
  rotates its logs with Docker's `local` driver.
- It adds `cloudflared`, whose healthcheck passes only while the tunnel is
  connected to Cloudflare (see step 5).

On the server the files are laid out as:

```text
/opt/node-effect-template/   owned by deploy
  compose.yml                deploy/vps/compose.yml from the current release's image
  bin/compose                Docker Compose with .env and release.env loaded
  bin/release                release script
  bin/backup                 backup script
  .env                       secrets, from env.example, mode 0600
  release.env                APP_IMAGE_TAG and APP_IMAGE_DIGEST of the current release, written by bin/release
  releases.log               one line per release attempt: time, commit, image digest, outcome
  release-output.log         everything the latest release attempt printed
  .previous/                 compose.yml, bin/ and release.env of the release before, for rollback
/etc/node-effect-template/restic.env   backup credentials, mode 0600, owned by root
```

`bin/` holds exactly the scripts of the current release's image, like
`compose.yml`.

### Database roles

`api` and `worker` connect as the runtime role, `APP_DATABASE_USER`
(`node_effect_app` by default). It can log in and read, insert, update and
delete rows in the tables of the `public` schema, and use their sequences. It is
not a superuser and belongs to no other role, so it cannot create, alter, drop
or truncate those tables, create schemas or roles, read the migration journal in
the `drizzle` schema, read or write server files, or run programs on the server
with `COPY ... TO PROGRAM`. SQL injection in the API is therefore limited to the
application's rows rather than the schema or a shell next to the data volume.

It keeps what PostgreSQL grants every role: it can connect to the cluster's
other databases without creating anything there, create temporary tables and
functions for the length of its session, create large objects, call functions
open to everyone, and change its own password and session defaults. Every
release's `migrate` sets the password again and clears those defaults.

`migrate` and `bin/backup` use the owner, `POSTGRES_USER`, which the PostgreSQL
image makes a superuser. After applying the migrations, every `migrate` run
creates the runtime role or updates it, sets its password from
`APP_DATABASE_PASSWORD`, clears settings stored for it, and grants it those
privileges on every table in `public`, including those the owner creates later.
`migrate` sends PostgreSQL only a salted SCRAM-SHA-256 hash of the password,
never the password itself. A table in a schema other than `public` needs its own
grants, in the migration that creates it.

`APP_DATABASE_USER` is lowercase letters, digits and `_`, does not start with a
digit, has at most 63 characters, and is not `public`, `none` or a name starting
with `pg_`. Before it applies any migration, `migrate` fails, and the release
with it, when the name is the owner or an existing role that is a superuser,
belongs to another role, or owns database objects: such a role is someone
else's. To change the name after a release, see
[Day-to-day operations](#day-to-day-operations).

## Setup

The commands assume Ubuntu 24.04 LTS or Debian 13, run as root on the server
unless they show `ssh` or `scp` from the repository root on your machine.

### 1. Prerequisites

- A domain whose DNS zone is on Cloudflare (the Free plan is enough).
- Two-factor authentication on the VPS provider, Cloudflare, registrar, and
  GitHub accounts.
- An Ed25519 SSH key for each operator, plus a separate one used only by GitHub
  Actions for releases.
- A password manager vault for production. It holds the master copy of every
  secret created below.
- An S3-compatible bucket for backups, with a different provider than the
  server.

### 2. Server and provider firewall

A VPS with 2 vCPUs and 4 GB of RAM is plenty to start. Take a provider snapshot
before risky host maintenance.

Choose an x86-64 (amd64) plan, not an Arm one such as Hetzner CAX, Oracle Ampere
or AWS Graviton: the Release workflow builds `linux/amd64` only, and on an arm64
host `bin/release` stops at the pull with no matching image. An arm64 image
would have to run the image build's `pnpm check` under emulation on every
release, and CI smoke-tests only amd64. To run on Arm, build on an arm64 runner
and smoke-test that image too.

If the provider has a network firewall, allow only inbound TCP 22 (IPv4 and
IPv6). It filters traffic before it reaches the host, which also covers ports
Docker publishes: Docker's own rules bypass `ufw`. The tunnel connects outbound,
so the application needs no inbound rule.

### 3. Host baseline

```bash
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y full-upgrade
apt-get -y install ufw restic unattended-upgrades curl
dpkg-reconfigure -f noninteractive unattended-upgrades

# Release account. Its only SSH key is the CI deploy key from step 7.
adduser --disabled-password --gecos "" deploy

# Keys only. This file sorts before cloud-init's 50-cloud-init.conf, so its
# values take precedence.
cat > /etc/ssh/sshd_config.d/10-hardening.conf <<'EOF'
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
sshd -t && systemctl reload ssh

# Host firewall as a second layer.
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw --force enable

# 2 GB of swap as a buffer against memory spikes.
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Before closing the session that changed SSH, confirm from a second terminal that
a key login works and a password login is refused. Reboot if
`/var/run/reboot-required` exists.

### 4. Docker

Install Docker Engine and the Compose plugin from
[Docker's apt repository](https://docs.docker.com/engine/install/), not the
distribution's `docker.io` package. Then:

```bash
docker compose version
usermod -aG docker deploy
```

Membership in the `docker` group is equivalent to root: anyone who can run
commands as `deploy` controls the host. Only `deploy` gets it, and its only SSH
key runs `bin/release` with nothing but a commit SHA and an image digest (step
7). `compose.yml` rotates each service's logs itself, so
`/etc/docker/daemon.json` needs no changes. It publishes only PostgreSQL, on
loopback; keep it that way, because published ports bypass `ufw`.

### 5. Cloudflare Tunnel and DNS

1. In Cloudflare Zero Trust, create a remotely managed tunnel, for example
   `node-effect-template-production`, and copy the token from its install
   command into the vault. Do not run the install command: the `cloudflared`
   service is the connector.
2. Add a public hostname, for example `api.example.com`, with service type
   `HTTP` and URL `api:8000`. `cloudflared` resolves `api` on the Compose
   network.
3. In the zone, turn on **Always Use HTTPS** and add a Cache Rule that bypasses
   the cache for the API hostname.

If the API is not meant to be public, put the hostname, or at least `/docs` and
`/openapi.json`, behind Cloudflare Access.

`cloudflared` serves its metrics and a `/ready` endpoint on `127.0.0.1:20241`
inside its container only (`TUNNEL_METRICS`). Its healthcheck,
`cloudflared tunnel ready`, reads that endpoint, which answers 200 once the
tunnel has a connection to Cloudflare, so a release waits for the tunnel and
fails when it does not connect. A Cloudflare outage during a release therefore
fails the release. `bin/release` restores the previous release but reports
`ROLLBACK FAILED`, because that release cannot pass the tunnel check either. The
previous release is back in place and serves again once the tunnel reconnects;
release again after the outage. After an image update, check that the new
`cloudflared` still has `tunnel ready`.

The API keeps idle connections open for 95 seconds (`keepAliveTimeout` in
`apps/api/src/main.ts`), longer than `cloudflared`'s default
`originRequest.keepAliveTimeout` of 90 seconds, so the tunnel never reuses a
connection the API is closing. If you raise the tunnel's keep-alive timeout,
raise the API's above it.

### 6. Files and secrets on the host

```bash
ssh root@<server> 'install -d -m 750 -o deploy -g deploy /opt/node-effect-template /opt/node-effect-template/bin'
scp deploy/vps/compose.yml root@<server>:/opt/node-effect-template/
scp deploy/vps/bin/* root@<server>:/opt/node-effect-template/bin/
scp deploy/vps/env.example root@<server>:/opt/node-effect-template/.env
ssh root@<server> 'chown -R deploy:deploy /opt/node-effect-template && chmod 755 /opt/node-effect-template/bin/* && chmod 600 /opt/node-effect-template/.env'
```

These copies only bootstrap the first release. From then on, every release
installs `compose.yml` and `bin/` from the image it releases, after its
migration has succeeded, so the server always runs the files that match its
image.

Fill in `/opt/node-effect-template/.env` following its comments, and keep every
value in the vault:

- `APP_IMAGE_REPOSITORY`: `ghcr.io/<owner>/<repository>` in lowercase, as the
  Release workflow names the image.
- `POSTGRES_PASSWORD`: generate it with `openssl rand -hex 32`. Characters such
  as `/` or `+` would break the database URL.
- `APP_DATABASE_PASSWORD`: the runtime role's password (see
  [Database roles](#database-roles)); generate it the same way.
- `CLOUDFLARE_TUNNEL_TOKEN`: from step 5.

Run every Compose command through `bin/compose`, which loads both `.env` and
`release.env`.

### 7. GitHub

After CI, the Release workflow runs two jobs, only on `main` and only once the
repository variable `PRODUCTION_HOST` is set. Until then, pushes to `main` run
CI only.

- `publish` builds, smoke-tests and pushes the image, labelled with its commit
  (`org.opencontainers.image.revision`), and outputs the digest `docker push`
  reported. It may write packages, and it never sees the SSH key.
- `deploy` runs in the `production` environment, which holds the SSH key. It
  checks out no code, its token has no permissions, and it only sends
  `<sha> <digest>` to the server.

1. Under **Settings → Environments**, create `production`. Under **Deployment
   branches and tags**, choose **Selected branches and tags** and allow only
   `main`. Add required reviewers if a merge alone should not deploy.
2. Add `PRODUCTION_SSH_KEY` as a secret of the `production` environment, never
   as a repository secret: a workflow on any branch can read repository secrets,
   while this environment's secrets reach only jobs from `main`.
3. Under **Settings → Secrets and variables → Actions → Variables**, add the two
   repository variables. `PRODUCTION_HOST` cannot be an environment variable,
   because the job checks it before it enters the environment.

| Name                     | Where                           | Value                                                                               |
| ------------------------ | ------------------------------- | ----------------------------------------------------------------------------------- |
| `PRODUCTION_SSH_KEY`     | `production` environment secret | Private half of a new Ed25519 key used only for releases                            |
| `PRODUCTION_HOST`        | Repository variable             | The server's IP address or hostname                                                 |
| `PRODUCTION_KNOWN_HOSTS` | Repository variable             | Output of `ssh-keyscan -t ed25519 <server>`, checked against the provider's console |

Also protect `main` with a ruleset (**Settings → Rules → Rulesets**) that
requires the `check`, `static`, `smoke` and `postgres` status checks, so changes
reach `main` through pull requests that passed CI, and blocks force pushes. The
Release workflow runs the same CI again on the pushed commit and deploys only
when it passes, so a commit that reaches `main` another way cannot skip it.

Install the key's public half for `deploy`, with `bin/release` as its forced
command:

```bash
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo 'restrict,command="/opt/node-effect-template/bin/release" ssh-ed25519 AAAA... github-actions-release' \
  > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
```

`restrict` turns off port, agent and X11 forwarding, terminals and `~/.ssh/rc`.
Whatever the client asks to run, sshd runs `bin/release` instead and passes the
request in `SSH_ORIGINAL_COMMAND`. `bin/release` accepts exactly a 40-character
lowercase hexadecimal SHA, optionally followed by one space and
`sha256:<64 lowercase hexadecimal characters>`, and never reads standard input.
It takes the image repository from `.env`, and `compose.yml` and `bin/` from the
image it pulls, so the key cannot send files, pick another image repository or
run any other command.

What the key can still do is release, by digest, any image in
`APP_IMAGE_REPOSITORY` whose revision label names the commit it sends, including
an older one, and a release runs that image's `compose.yml`, `bin/` and
migrations on the host. The server never resolves a tag: CI sends the digest it
pushed, and a rollback by SHA alone uses the digest `releases.log` recorded. So
replacing a tag in GHCR, which any workflow in this repository that asks for
`packages: write` can do on any branch, no longer changes what a release or a
rollback runs. Anyone with write access can still push an image labelled with
any commit, but it runs only if its digest reaches `bin/release`: through this
key, which only `main`'s `deploy` job holds, or from an operator. When you pass
a digest by hand, take it from that commit's Release run, whose `publish` job
summary shows it.

GHCR packages are private by default. Give `deploy` read access with a classic
personal access token that has only `read:packages` (GHCR does not accept
fine-grained tokens); keep it in the vault, run
`runuser -u deploy -- docker login ghcr.io -u <github-user>`, and paste it at
the prompt.

### 8. First start

1. Start the database: `/opt/node-effect-template/bin/compose up -d postgresql`.
2. Run the first release: with `PRODUCTION_HOST` set, push to `main`, or open
   **Actions → Release → Run workflow** on `main`.
3. Verify through the tunnel:

   ```bash
   curl -fsS https://api.example.com/health/live
   curl -fsS https://api.example.com/health/ready
   ```

Do not run `scripts/smoke-api.ts` against production: it creates users.

## Releases and rollback

Every push to `main`, including a merge, starts
[the Release workflow](../../.github/workflows/release.yml). It first runs the
whole of [CI](../../.github/workflows/ci.yml): checks, static checks of the
scripts and workflows, the image smoke test and vulnerability scan, and the
PostgreSQL tests. Then its `publish` job builds the image without the Actions
build cache (the build runs `pnpm check`), runs the Docker smoke test on it and
pushes `ghcr.io/<owner>/<repository>:<sha>`, and its `deploy` job connects to
the server as `deploy` and sends `<sha> <digest>`; the forced command runs
`bin/release`. Releases queue rather than cancel each other. Without staging,
merging to `main` is the deploy decision.

[`bin/release`](bin/release) runs as `deploy`; started as root, it switches to
`deploy` itself. It takes `<sha> <digest>`, or `<sha>` alone for a commit that
`releases.log` shows as released, and then:

1. Takes a lock and pulls `<APP_IMAGE_REPOSITORY>@<digest>`. It refuses an image
   whose `org.opencontainers.image.revision` label is not the SHA, then tags it
   `<APP_IMAGE_REPOSITORY>:<sha>` on the host and copies `compose.yml` and
   `bin/` out of it into a staging directory.
2. With the staged `compose.yml`, the server's `.env` and the new tag and
   digest, validates the configuration, pulls the images and runs `migrate`
   once. Compose recreates any service whose definition changed, PostgreSQL
   included, while the previous release keeps serving. If any of this fails, the
   release stops and `compose.yml`, `bin/`, `release.env` and the running
   containers stay as they were.
3. Copies the current `compose.yml`, `bin/` and `release.env` to `.previous/`,
   then installs the staged `compose.yml` and `bin/` and a `release.env` with
   the new `APP_IMAGE_TAG` and `APP_IMAGE_DIGEST`.
4. Checks the release:
   - `bin/compose up -d --wait` for the API, worker and tunnel succeeds, which
     needs the API's liveness healthcheck and the tunnel's readiness healthcheck
     to pass.
   - `/health/ready` answers 200 within 30 seconds, asked from inside the API
     container, so the API reaches the database.
   - The worker and `cloudflared` keep running for 15 seconds without another
     restart. `up --wait` alone cannot tell: it accepts a container without a
     healthcheck once it has started, even one that exits at once and restarts
     in a loop.
5. If every check passes, appends a `RELEASED` line to `releases.log` and
   removes this repository's images except those of the three latest releases
   and of the previous one. That includes untagged ones: an image refused for
   its label, or one whose tag a newer image of the same commit took over.
6. If a check fails, appends a `FAILED` line, restores `.previous/`, runs the
   same checks on the restored release and exits 1, printing which check failed
   and that it rolled back. Images are not pruned. The first release has no
   previous one: it stays installed, unhealthy, and still exits 1. If the
   restored release fails its checks too, `bin/release` prints `ROLLBACK FAILED`
   and production needs attention.

Exit status 2 means the request was malformed, or named only a SHA that
`releases.log` has no release of; 1 means any other failure. Either way the
output says what happened.

Once the request is valid, `bin/release` runs to the end even if the `deploy`
job is cancelled or the SSH connection drops, so it never stops between
installing a release and restoring the previous one. It also writes its output
to `release-output.log`, replacing the previous attempt's. After a cancelled or
interrupted deploy, read the outcome there and in `releases.log`.

`releases.log` has one line per release attempt that reached step 4, separated
by single spaces:

```text
2026-10-27T15:37:28Z 6dcd4ce23d88e2ee9568ba546c007c63d9131c1b sha256:8dc9d8ff3672f752c2c0fac2f4206604f7921ca31a11a2d6623657fe55587161 RELEASED
```

`release.env` always names the installed release. After a successful release or
rollback, that is the last `RELEASED` line; a failed first release or a failed
rollback leaves an unverified release installed.

The single API replica is unavailable for a few seconds while it restarts, and
the tunnel returns an error page meanwhile. An automatic rollback restarts it
again.

**Upgrading a server set up before the runtime role.** Add
`APP_DATABASE_PASSWORD`, generated as in step 6, to `.env` before releasing the
commit that introduces it. Without it, that release stops in step 2, at the
staged `config --quiet`, and changes nothing; add it and release again.

Migrations never run at application startup. They must work with the previous
release still running, because it serves traffic while `migrate` runs and a
rollback does not undo them: add columns and tables first, and remove old ones
in a later release.

`migrate` gives up after waiting 5 seconds for a lock. Otherwise an ALTER TABLE
queued behind a long transaction would hold up every query on that table while
the previous release serves. The release then fails at step 2 and changes
nothing; run it again, for example by re-running the `deploy` job, once that
transaction has ended. Statements themselves have no time limit, so a long index
build finishes, but it blocks writes to its table until it does, and a write
waiting for it gives up after 8 seconds, or after
`DATABASE_STATEMENT_TIMEOUT_MS` if that is shorter.

**Rollback.** A release that fails its checks rolls itself back. To return to an
earlier release by hand, run `/opt/node-effect-template/bin/release <sha>` on
the server; it releases the digest `releases.log` recorded for that commit. For
a commit this server never released, pass the digest from that commit's Release
run: `bin/release <sha> sha256:<digest>`. Re-running only the `deploy` job of
that commit's Release run does the same, because it reuses the `publish` job's
digest; re-running every job builds and publishes a new image instead. Either
way the release's `compose.yml` and `bin/` come back with its image. Fix forward
when the previous code cannot work with the newer schema.

## Backups and restore

1. Create an access key limited to the backup bucket, with read and write
   access.
2. Install the credentials file, then fill it in following its comments:

   ```bash
   ssh root@<server> 'install -d -m 700 /etc/node-effect-template'
   scp deploy/vps/restic.env.example root@<server>:/etc/node-effect-template/restic.env
   ssh root@<server> 'chmod 600 /etc/node-effect-template/restic.env'
   ```

3. Initialize the repository once:
   `set -a; . /etc/node-effect-template/restic.env; set +a; restic init`.
4. Install and start the nightly timer:

   ```bash
   scp deploy/vps/systemd/backup.service root@<server>:/etc/systemd/system/node-effect-template-backup.service
   scp deploy/vps/systemd/backup.timer root@<server>:/etc/systemd/system/node-effect-template-backup.timer
   ssh root@<server> 'systemctl daemon-reload && systemctl enable --now node-effect-template-backup.timer'
   ```

5. Run it once and read the result:
   `systemctl start node-effect-template-backup.service && journalctl -u node-effect-template-backup -n 30`.

[`bin/backup`](bin/backup) writes a `pg_dump -Fc` of the database to
`/var/backups/node-effect-template/database.dump`, uploads it with restic,
applies the retention policy (7 daily, 4 weekly, 6 monthly), and pings
`HEARTBEAT_URL` when it is set. The service keeps restic's cache in
`/var/cache/node-effect-template-restic`, so a run downloads only what changed.

**Restore drill.** Run it before launch, then monthly:

```bash
set -a; . /etc/node-effect-template/restic.env; set +a
restic restore latest --target /tmp/restore
postgres_image=$(/opt/node-effect-template/bin/compose config --images postgresql)
docker run -d --name restore-pg -e POSTGRES_PASSWORD=drill "$postgres_image"
until docker exec restore-pg pg_isready -h 127.0.0.1 -U postgres; do sleep 1; done
docker cp /tmp/restore/var/backups/node-effect-template/database.dump restore-pg:/tmp/database.dump
docker exec restore-pg pg_restore -U postgres --no-owner --no-privileges --create -d postgres /tmp/database.dump
docker exec restore-pg psql -U postgres -d node_effect -c 'select count(*) from users'
docker rm -f -v restore-pg && rm -rf /tmp/restore
```

The dump holds the runtime role's grants, but not the role itself, which belongs
to the whole PostgreSQL cluster rather than the database. Restoring them into a
cluster without that role fails with `role "node_effect_app" does not exist`, so
both restores skip every grant with `--no-privileges`. The next `migrate`
creates the role and grants it access again; re-apply any grant you added by
hand.

A full restore follows the same path on a new server: repeat setup steps 2–7,
start PostgreSQL with `bin/compose up -d postgresql`, load the dump with
`bin/compose exec -T postgresql sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' < database.dump`,
then release the last commit, whose `migrate` creates the runtime role before
the API and worker start.

## Monitoring

- **Uptime:** an external HTTP check on `/health/ready` through the tunnel every
  minute, alerting by email or phone.
- **Host:** an agent such as Grafana Alloy shipping host metrics and container
  logs. Alert on disk above 80%, memory above 90%, and container restart loops.
- **Logs:** the API, worker and `migrate` write one JSON object per line (see
  [Logs](../../README.md#logs)); an agent can alert on `"level":"ERROR"`. The
  API logs every request except passing health probes, and a 5xx at Error.
- **Backups:** a dead man's switch, such as Healthchecks.io, pinged through
  `HEARTBEAT_URL`. It alerts when no successful backup arrives within 26 hours.

## Day-to-day operations

```bash
ssh root@<server>
sudo -iu deploy
cd /opt/node-effect-template

bin/compose ps
bin/compose logs -f --since 10m api worker
bin/compose restart worker
bin/compose exec postgresql sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
tail releases.log
```

`bin/compose exec postgresql` runs as the `postgres` user, not root, and the
container's root filesystem is read-only: pass files on standard input, as the
full restore does, rather than copying them into the container.

- **Find a request:** Cloudflare gives every request a ray ID, which the client
  receives in the `cf-ray` response header.
  `bin/compose logs api | grep <ray ID>` finds the request's access line, which
  records it as `cfRay`, and `bin/compose logs api | grep <traceId>` then finds
  every line the request logged. Ray IDs are not guaranteed to be unique, so
  check the timestamp. `bin/compose logs` shows only the current containers'
  output, rotated at the size `x-logging` in `compose.yml` sets: a release, a
  rollback or a `LOG_LEVEL` change recreates them and discards what they wrote,
  so search older lines in the log-shipping agent from
  [Monitoring](#monitoring).
- **Change `LOG_LEVEL`:** recreating a container discards its logs, so first
  save what you may need:
  `bin/compose logs --no-color --timestamps api worker > "logs-$(date -u +%Y%m%dT%H%M%SZ).txt"`.
  Then set it in `.env` and recreate only the services it should change. `Debug`
  adds a line for each worker pass, so `bin/compose up -d --wait worker` is
  enough. Recreate the API too (`bin/compose up -d --wait worker api`) only when
  it should log differently, at `Warn` for example: it is unavailable for a few
  seconds and loses its log history. A release recreates both with the value in
  `.env`. The names are case-sensitive (`All`, `Trace`, `Debug`, `Info`, `Warn`,
  `Error`, `Fatal`, `None`): with any other value a process exits 1 after one
  `Invalid logging configuration` line and restarts until it is fixed, so
  `--wait` fails, and the next release's `migrate` fails before anything
  restarts. Set it back to `Info` afterwards.
- **Database tools:** from your machine, open a tunnel with
  `ssh -N -L 5432:127.0.0.1:5432 root@<server>`.
- **Change `POSTGRES_PASSWORD`:** PostgreSQL reads `POSTGRES_PASSWORD` only when
  it creates an empty data directory, so change the role's password first.
  Generate the new one with `openssl rand -hex 32` and store it in the vault.
  Open `psql` as in the block above, run `\password` (it changes the connected
  role's password) and paste it. Then put it in `.env` and run
  `bin/compose up -d --wait postgresql`, which recreates PostgreSQL with the new
  value. Only `migrate` and database tools log in with it, but any later
  `bin/compose up`, of `cloudflared` say, would recreate PostgreSQL too, because
  its definition changed, so do it now, at a time you choose. The database is
  unavailable for a few seconds: API requests fail and the worker may restart.
- **Change `APP_DATABASE_PASSWORD`:** generate the new one the same way, store
  it in the vault and put it in `.env`. Then release the current commit again:
  `bin/release $(sed -n 's/^APP_IMAGE_TAG=//p' release.env)`. Its `migrate` sets
  the new password, and its restart gives the API and the worker the new value.
  Connections they open between the two steps fail to log in, so for a few
  seconds the worker may restart and API requests may fail.
- **Rename `APP_DATABASE_USER`:** provisioning only touches the role the release
  names, so the old role can still log in with its old password and grants. Once
  the release with the new name serves, open `psql` as in the block above and
  remove it, with `<old>` replaced by its name:
  `REASSIGN OWNED BY <old> TO CURRENT_USER; DROP OWNED BY <old>; DROP ROLE <old>;`.
- **Change `CLOUDFLARE_TUNNEL_TOKEN`:** put the new token in the vault and in
  `.env`, run `bin/compose up -d --wait cloudflared`, check `/health/ready`
  through the tunnel, then revoke the old token at Cloudflare. Restarting the
  API or worker does not apply it, because only `cloudflared` uses it.
- **Host updates:** `unattended-upgrades` installs security patches. Once a
  month, take a provider snapshot, run `apt-get full-upgrade`, and reboot if
  required.
- **Image updates:** Renovate proposes PostgreSQL minor versions and
  `cloudflared` as tag and digest changes in `compose.yml` (see
  [Dependency updates](../../README.md#dependency-updates)), and the restore
  drill reads PostgreSQL's image from it. The release of that commit applies
  them; a PostgreSQL change restarts the database briefly before `migrate` runs.
  A PostgreSQL major upgrade needs a dump and restore, so Renovate leaves it
  out; plan it separately. If PostgreSQL moves to a non-Alpine image, change the
  `uid` and `gid` of its `/var/run/postgresql` tmpfs in both Compose files: 70
  is Alpine's `postgres` user, and Debian's is 999.

## Pre-launch checklist

Keep production private until every item passes.

- [ ] `/health/live` and `/health/ready` pass through the tunnel hostname.
- [ ] Stopping PostgreSQL briefly turns `/health/ready` into 503 while
      `/health/live` stays 200, and the worker restarts and recovers once the
      database is back: at the default level a healthy worker writes nothing, so
      check that `bin/compose logs worker` shows no new `Worker failed` line and
      that
      `docker inspect --format '{{.RestartCount}}' $(bin/compose ps -q worker)`
      stops rising.
- [ ] After `reboot`, every service and the tunnel return without manual action.
- [ ] The API and the worker connect as the runtime role: in `psql`,
      `select distinct usename from pg_stat_activity where application_name = 'node-effect-template'`
      lists only `APP_DATABASE_USER`, and
      `select count(*) from pg_auth_members where member = '<APP_DATABASE_USER>'::regrole`
      returns 0.
- [ ] A release with a migration, then a rollback to the previous commit.
- [ ] A release whose API cannot reach the database rolls itself back.
- [ ] The backup and restore drill passes.
- [ ] From outside, only port 22 answers (`nmap -Pn <server>`); PostgreSQL is
      unreachable.
- [ ] Memory and CPU under representative load fit the server. Adjust
      `mem_limit` or resize if not.
- [ ] Alerts fire: stop `api` and expect the uptime alert; skip a backup and
      expect the heartbeat alert.
