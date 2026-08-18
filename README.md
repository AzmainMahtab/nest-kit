# nest-kit

A NestJS starter built as a **modular monolith** — Clean Architecture, ports and adapters, DDD and CQRS, sliced vertically by bounded context, with a transactional outbox over NATS JetStream.

It is the TypeScript member of the `fast-kit` / `go-kit` / `django-kit` family and follows their conventions. The design target is a codebase whose bounded contexts can be lifted out into separate services years later without rewriting their domain or application layers.

> **This is not the base-class CRUD stack.**
> `claude-fullstack-workspace/.claude/stacks/nestjs/` defines a different NestJS architecture — `BaseController` / `BaseService` / `BaseRepository` inheritance, the TypeORM entity used directly as the domain model. That stack optimises for generation speed; this one optimises for boundaries that survive extraction. They are opposite trades. Do not blend them — you would get base-class CRUD with a `domain/` folder that nothing enforces.

The authoritative rules live in [`AGENTS.md`](AGENTS.md). This README summarises them and records why each was chosen.

---

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node 24, pnpm 11 |
| Framework | NestJS 11 |
| CQRS | `@nestjs/cqrs` (CommandBus / QueryBus / EventBus) |
| Database | PostgreSQL 18, TypeORM 1.x (DataMapper only) |
| Migrations | TypeORM CLI, `synchronize: false` everywhere |
| Messaging | NATS 2.14 JetStream |
| Passwords | Argon2id (`@node-rs/argon2`) |
| Tokens | ES256 (ECDSA P-256) via `jose` |
| Validation | class-validator at the HTTP boundary, zod for environment |
| Observability | `prom-client` metrics, JSON logs, correlation id; Prometheus + Loki + Grafana in an overlay |
| Rate limiting | Redis fixed window, shared across replicas |
| Quality | eslint + prettier + strict tsc + a custom architecture gate |

---

## Quick start

```bash
pnpm install
cp .env.example .env          # optional; every value has a default
make db-up                    # Postgres + Redis + NATS
make migrate-up               # apply migrations
make seed                     # roles, permissions and the first admin
pnpm start:dev                # or: make dev  (full stack in Docker)
```

- API: `http://localhost:3000/api/v1`
- Health: `http://localhost:3000/health`, readiness at `/health/ready` (deliberately outside the prefix *and* the version)
- Metrics: `http://localhost:3000/metrics` (Prometheus text format)
- Swagger UI: `http://localhost:3000/docs` — see [API documentation](#api-documentation)

`make obs-up` adds Prometheus, Loki and Grafana on top of the dev stack — see
[Observability](#observability).

Set `SEED_SUPERADMIN_EMAIL` and `SEED_SUPERADMIN_PASSWORD` before seeding to get
an administrator account. Without one, nobody can reach the admin routes — see
[Seeding](#seeding).

---

## Layout

```
src/
├── main.ts                       # bootstrap
├── app.module.ts                 # composition root — wiring only
├── modules/<context>/            # bounded contexts
│   ├── domain/                   # entities, value objects, ports, events, errors
│   ├── application/
│   │   ├── commands/             # write use cases  (*.command.ts + *.handler.ts)
│   │   └── queries/              # read use cases   (*.query.ts + *.handler.ts)
│   ├── infrastructure/
│   │   ├── persistence/          # orm-entities, mappers, repositories
│   │   ├── cache/                # redis adapters
│   │   └── event-handlers/       # durable + in-process subscribers
│   ├── presentation/http/        # controllers, DTOs, Swagger
│   ├── index.ts                  # the context's ONLY public surface
│   └── <context>.module.ts
├── platform/                     # config, database, http, crypto, eventbus,
│                                 # messaging, outbox, health, observability,
│                                 # storage, mail, upstream, scheduling
├── shared/                       # shared kernel — pure, framework-free
└── database/
    ├── migrations/
    └── seeds/                    # role/permission catalogue + superadmin
```

`shared/` is pure TypeScript: no `@nestjs/*`, no `typeorm`. `platform/` is where the framework lives.

| Concern | Location |
|---|---|
| Business rule about one aggregate | `domain/` — a method on the entity |
| Orchestration across ports | `application/commands` or `queries` |
| SQL, Redis, HTTP clients | `infrastructure/` |
| HTTP decode / authorize / respond | `presentation/http/` |
| Genuinely cross-context abstraction | `shared/` |
| Technical infrastructure with no domain meaning | `platform/` |

---

## Contexts

| Context | Owns | Read it for |
|---|---|---|
| `identity` | users, credentials | the minimal context — the shape everything else follows |
| `auth` | sessions, tokens | ES256, refresh rotation with replay detection, Redis revocation |
| `rbac` | roles, permissions, assignments | a cached read model kept fresh by its own events; an aggregate that deliberately excludes an unbounded collection |
| `owner` | car owners, linked to a user by uuid | a value object enforcing a domain rule; one-per-user uniqueness |
| `car` | cars, linked to an owner by uuid | money as a decimal string; aggregate invariants; batch writes |
| `notification` | queued notifications | the smallest possible durable subscriber |

Each owns a Postgres schema of the same name. **No foreign keys cross a schema
boundary** — a cross-context reference is a `uuid` column, and integrity is
checked in the use case against the other context's port. That is what makes
any of them liftable into its own service (§10).

`owner` and `car` are the pair to copy when adding a context; see
[Adding a bounded context](#adding-a-bounded-context).

---

## Authentication

**Access is denied by default.** The guard is global, so a new route is protected the moment it exists. Public routes opt out explicitly with `@Public()`, which makes every unauthenticated entry point greppable:

| Public route | Why |
|---|---|
| `POST /api/v1/users` | registration must precede having a token |
| `POST /api/v1/auth/login` · `POST /api/v1/auth/refresh` | they *produce* tokens |
| `GET /health` · `GET /health/ready` | probes run without credentials |
| `GET /metrics` | a Prometheus scrape has no bearer token |

```bash
# 1. register
curl -X POST localhost:3000/api/v1/users \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse-battery"}'

# 2. log in -> { accessToken, refreshToken, expiresAt }
TOKEN=$(curl -sX POST localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse-battery"}' \
  | jq -r .data.accessToken)

# 3. call anything
curl localhost:3000/api/v1/users -H "Authorization: Bearer $TOKEN"
```

`make keygen` must have run first — the tokenizer reads `certs/private.pem` at boot.

**Tokens.** ES256 (ECDSA P-256), never HS256: a shared secret lets every verifier also mint. Access and refresh are signed by the same key and separated only by a `typ` claim, checked on every parse — without it a refresh token would authenticate every request for its whole lifetime. Defaults: access 15 min, refresh 30 days.

**Revocation.** Logout revokes the session (killing refresh) *and* blacklists the access token's `jti` in Redis with a TTL bounded by the token's own `exp`, so an entry can never outlive the token it revokes.

**Refresh rotation with replay detection.** A refresh token is single-use. Presenting a superseded one means it was captured — the legitimate client has already rotated past it — so the whole session is revoked, not just that request, because the attacker may hold a newer token too. The revocation is committed *before* the request is rejected; throwing first would roll it back.

Inside a handler, `@CurrentUser()` yields `{ uuid, sessionUuid, jti, expiresAt }`.

---

## Authorization (RBAC)

Authentication is global and deny-by-default. **Authorization is opt-in per route**, because most routes need a caller, not a privilege:

```ts
@RequirePermissions('messaging:admin')   // any one of the named permissions
@RequireRoles('admin')                   // the escape hatch — prefer the above
```

Name a **permission**, never a role, in a controller. `messaging:admin` means the same thing in a year; which roles carry it is an operational decision that should change without a deploy.

Users hold roles, roles hold permissions, and a route checks permissions:

```
user ──< user_roles >── role ──< role_permissions >── permission ──> @RequirePermissions
```

Both junctions record **who** granted the row and **when** — the first question after an incident, and one that cannot be reconstructed later.

### The seeded catalogue

`make migrate-up` creates three permissions and one role:

| Permission | Guards |
|---|---|
| `rbac:admin` | creating roles and permissions, granting and assigning them |
| `rbac:read` | reading roles, permissions and assignments |
| `messaging:admin` | the whole `/api/v1/admin/messaging` surface |

The `admin` role holds all three and is **protected**: its permissions cannot be changed. It is the only role seeded with `rbac:admin`, so revoking that would lock every administrator out of the endpoint that could grant it back — recoverable only by hand-written SQL. Curate a new role instead.

### Getting the first admin

Assigning a role requires `rbac:admin`, which only the `admin` role holds, so something has to break the circularity. `make seed` does — see [Seeding](#seeding).

```bash
SEED_SUPERADMIN_EMAIL=ops@example.com
SEED_SUPERADMIN_PASSWORD=a-long-enough-password
make seed
```

```bash
# what am I allowed to do?
curl localhost:3000/api/v1/rbac/me/grants -H "Authorization: Bearer $TOKEN"
# -> { "data": { "roles": ["admin"], "permissions": ["rbac:admin", ...] } }
```

### Freshness

A user's resolved grants are cached in Redis — the guard runs on every authorized request, and resolving three tables each time would put a join on the critical path of the whole API. Correctness never depends on it: a miss, a decode failure or a Redis outage all fall through to Postgres.

Assigning, revoking or changing a role's permissions evicts the affected users immediately, by reacting to the domain event after the transaction commits. `RBAC_CACHE_TTL_SECONDS` (default 60) bounds the one case eviction cannot cover — the process dying between the commit and the dispatch. It is a backstop, not the mechanism: the e2e suite runs with it set to 300s so a broken eviction fails the suite rather than passing on expiry.

### Adding a permission

1. `POST /api/v1/rbac/permissions` with `{"name":"billing:refund"}` — lowercase `resource:action`. Case is rejected, not folded: `Billing:refund` and `billing:refund` as two rows would split a grant in half silently.
2. Put `@RequirePermissions('billing:refund')` on the route.
3. Grant it to a role, and assign that role to whoever needs it.

Creating a permission grants nothing on its own. If a route requires a name no role holds, it is simply unreachable.

---

## Seeding

```bash
make seed          # on the host
make dev-seed      # inside the development stack
make prod-seed     # inside the production stack
```

Idempotent and **additive**. Run it after migrating, on every deploy if you like — it creates what is missing and changes nothing else.

### What it does

| Step | |
|---|---|
| Permissions | creates any of `rbac:admin`, `rbac:read`, `messaging:admin` that are absent |
| Roles | `admin` (protected, holds all three), `auditor` (`rbac:read`), `messaging-operator` (`messaging:admin`) |
| Superadmin | creates `SEED_SUPERADMIN_EMAIL` as an **active** user and gives it `admin` |

`auditor` and `messaging-operator` exist so that least privilege is the obvious default. Reaching for `admin` because no narrower role exists is how every account ends up with everything.

The catalogue lives in [`src/database/seeds/rbac.catalog.ts`](src/database/seeds/rbac.catalog.ts). Add a permission there, add `@RequirePermissions()` to the route, re-run the seed.

### What it will not do

- **Never revokes.** The seed grants what the catalogue lists and ignores what it does not. A role an operator extended by hand must not be silently stripped by the next deploy, and removing a permission has a blast radius that belongs in a reviewed migration.
- **Never resets a password.** An existing account is reused as-is, so re-running with a different `SEED_SUPERADMIN_PASSWORD` does nothing. Change a password through the application.
- **Never seeds a non-local database** without `ALLOW_REMOTE_SEED=true`. The failure guarded against is a `.env` pointed at a shared database through a tunnel, followed by a reflex `make seed` that creates an administrator from local configuration. It is a host allowlist rather than a `NODE_ENV` check, because `NODE_ENV` is whatever the shell last exported while the host is the thing actually being written to.

Omit either superadmin variable and the account step is skipped; roles and permissions are still reconciled.

### Why not on boot

Starting the API does not write data. An earlier version granted `admin` during `onApplicationBootstrap`; provisioning is now an explicit act, which keeps it out of every replica's startup path — they all raced to do the same write — and puts it in the shell history where it can be audited.

The same reasoning applies to migrations, which is why the container has three commands rather than one that migrates and then serves — see [Container commands](#container-commands).

### Seeds and migrations

`CreateRbac` seeds the same three permissions and the `admin` role inline, and that duplication is deliberate. A migration is frozen the moment it ships: editing one that has already run changes nothing on a database that already applied it. The migration records how the schema arrived; the catalogue is where the vocabulary *grows*, and the seed reconciles a database to it.

---

## Container commands

One image, three jobs, dispatched by `docker-entrypoint.sh` on the first argument:

| Command | Does | Development | Production |
|---|---|---|---|
| `serve` *(default)* | Start the API | `nest start --debug 0.0.0.0:9229 --watch` | `node dist/main` |
| `migrate` | Apply pending migrations, exit | `pnpm run migrate` | `node dist/main.migrate` |
| `seed` | Reconcile the catalogue and superadmin, exit | `pnpm run seed` | `node dist/main.seed` |

Anything else runs verbatim, so `docker compose run --rm api sh` still works.

```bash
docker compose run --rm api migrate      # or: make dev-migrate / make prod-migrate
docker compose run --rm api seed         # or: make dev-seed    / make prod-seed
```

The script branches on `NODE_ENV`, so the verbs mean the same thing in both stacks — development runs from the mounted source through ts-node, production from compiled output with no devDependencies present.

**Deploy order: `migrate` → `seed` → roll out `serve`.**

### Why not migrate on start

The tempting version is an entrypoint that migrates and then serves. It is wrong for the same reason boot does not seed:

- On a rolling deploy **every replica migrates at once**. TypeORM wraps each migration in a transaction but takes no cross-process lock, so they race.
- A failed migration becomes a **crash loop** instead of a failed pipeline step you can see and stop on.
- A rollback has old and new code both trying to migrate.

`migrationsRun` is `false` and `synchronize` is `false` everywhere, including test. The application assumes its schema already exists.

### The keypair is mounted, never baked in

`.dockerignore` excludes `certs/` and `*.pem`, because an image is a distributable artifact and a private key inside one leaks with every copy. The production overlay mounts `./certs:/app/certs:ro` at runtime; a real deployment substitutes a secret manager or a Kubernetes secret. The only contract is that `/app/certs` exists at boot — without it the container exits with `ENOENT: certs/private.pem`.

---

## API

| Method | Path | Auth |
|---|---|---|
| `POST` | `/api/v1/users` | public |
| `GET` | `/api/v1/users` | bearer |
| `GET` | `/api/v1/users/:uuid` | bearer |
| `PATCH` | `/api/v1/users/:uuid` | bearer |
| `DELETE` | `/api/v1/users/:uuid` | bearer (soft delete) |
| `POST` | `/api/v1/auth/login` | public |
| `POST` | `/api/v1/auth/refresh` | public |
| `POST` | `/api/v1/auth/logout` | bearer |
| `GET` | `/api/v1/admin/messaging/status` | `messaging:admin` |
| `GET` | `/api/v1/admin/messaging/outbox/dead-lettered` | `messaging:admin` |
| `POST` | `/api/v1/admin/messaging/outbox/replay` | `messaging:admin` |
| `GET` | `/api/v1/admin/messaging/dead-letters` | `messaging:admin` |
| `POST` | `/api/v1/admin/messaging/dead-letters/discard` | `messaging:admin` |
| `GET` | `/api/v1/rbac/me/grants` | bearer |
| `POST` | `/api/v1/rbac/permissions` | `rbac:admin` |
| `GET` | `/api/v1/rbac/permissions` | `rbac:read` |
| `POST` | `/api/v1/rbac/roles` | `rbac:admin` |
| `GET` | `/api/v1/rbac/roles`, `/api/v1/rbac/roles/:uuid` | `rbac:read` |
| `POST` | `/api/v1/rbac/roles/:uuid/permissions` | `rbac:admin` |
| `DELETE` | `/api/v1/rbac/roles/:uuid/permissions/:permission` | `rbac:admin` |
| `GET` | `/api/v1/rbac/users/:uuid/roles`, `/api/v1/rbac/users/:uuid/grants` | `rbac:read` |
| `POST` | `/api/v1/rbac/users/:uuid/roles` | `rbac:admin` |
| `DELETE` | `/api/v1/rbac/users/:uuid/roles/:roleUuid` | `rbac:admin` |
| `POST` `GET` | `/api/v1/owners`, `/api/v1/owners/:uuid` | bearer |
| `PATCH` | `/api/v1/owners/:uuid/address`, `/api/v1/owners/:uuid/deactivate` | bearer |
| `POST` `GET` | `/api/v1/cars`, `/api/v1/cars/:uuid` | bearer |
| `PATCH` | `/api/v1/cars/:uuid/transfer`, `/price`, `/retire` | bearer |
| `GET` | `/health` | public, unversioned, outside the prefix |
| `GET` | `/health/ready` | public, unversioned — 503 when a required dependency is down |
| `GET` | `/metrics` | public, unversioned, not enveloped |

A permission in the Auth column means bearer **plus** that permission; `rbac:admin`
satisfies every route marked `rbac:read`. See [Authorization](#authorization-rbac).

Full schemas and a live console at [`/docs`](#api-documentation).

### Versioning

Routes live under `/api/v1`. The version is in the **path**, not a header,
because that is where it is visible — in an access log, a curl pasted into a
bug report, a Grafana label and the Swagger URL. A header carries the same
information where nobody looks, and makes "which version broke?" unanswerable
from logs.

`API_DEFAULT_VERSION` sets what an undecorated controller serves. Introducing
v2 for one route is `@Version('2')` on that handler; everything else keeps
answering on v1 from the same code. There is no unversioned alias — two live
spellings of one route means clients pin neither, and the day v2 lands they all
break at once.

`/health`, `/health/ready` and `/metrics` are `VERSION_NEUTRAL`. A probe is
configured once in a deployment manifest and must not have to follow an API
version.

### Rate limiting

A fixed window per client IP, counted in Redis so the budget is shared across
replicas — an in-memory limiter with two replicas behind a balancer is a limit
of twice what it says, and it resets on every deploy.

| Scope | Default | Applies to |
|---|---|---|
| `global` | 100 / 60s | every route without a tighter setting |
| `auth` | 10 / 60s | `POST /api/v1/auth/login`, `/auth/refresh`, `POST /api/v1/users` |

The buckets are separate, so a password-guessing loop cannot lock the rest of
the API out. Every response carries `X-RateLimit-Limit`, `-Remaining` and
`-Reset`; a rejection is `429 RATE_LIMITED` with `Retry-After`.

Three deliberate choices:

- **It runs before authentication.** `RateLimitGuard` is registered in
  `platform/http/http.module.ts`, which `app.module.ts` imports *above*
  `AuthModule` — Nest runs global guards in registration order. A flood is
  rejected before it costs a signature verification and a Redis lookup, and
  login, which has no token yet, is covered at all.
- **It fails open.** If Redis is unreachable the request is allowed and a
  warning is logged. A limiter outage must not become an outage; this is a
  safeguard, not an authorization decision.
- **`X-Forwarded-For` is ignored** unless `TRUST_PROXY=true`. The header is
  caller-supplied: trusting it by default hands every client an unlimited
  supply of fresh budgets.

Opt out with `@NoRateLimit()` (the probes do), or set a route-specific budget
with `@RateLimit({ scope: 'export', limit: 1, windowSeconds: 3600 })`.

### Probes

| | |
|---|---|
| `GET /health` | Liveness. Static, touches nothing. |
| `GET /health/ready` | Readiness. Checks Postgres, Redis and NATS; `503` when a *required* one is down. |

They are different questions. Liveness asks "is the event loop turning?" and
the right response to a failure is a restart. Readiness asks "can this instance
serve?" and the right response is to stop sending it traffic. Wiring one probe
to both is how a Postgres blip becomes a cluster-wide restart loop.

Not every dependency votes:

| Dependency | Required | Why |
|---|---|---|
| Postgres | yes | nothing works without it |
| Redis | yes | `JwtAuthGuard` checks the revocation list on every authenticated request, and that lookup throws when Redis is gone — the outage is a 500 on every protected route, whatever the word "cache" suggests |
| NATS | **no** | the outbox exists so the API keeps accepting writes while the broker is away. Failing readiness would pull every replica out of rotation for a fault the design already absorbs, turning a delayed projection into a full outage. It reports `degraded` instead |

---

## API documentation

| | |
|---|---|
| **Swagger UI** | **http://localhost:3000/docs** |
| Raw OpenAPI document | `http://localhost:3000/docs-json` |
| Written to a file | `pnpm openapi:export [file]` — defaults to `openapi.json`, gitignored |

### Calling a protected route from the UI

Everything except registration, login, refresh, the two health probes and the
metrics scrape shows a padlock. To unlock them:

1. **`POST /api/v1/users`** — register. Public, so no token needed.
2. **`POST /api/v1/auth/login`** — copy `data.accessToken` from the response.
3. Click **Authorize** (top right), paste the token, **Close**.
4. Every padlocked route now works from *Try it out*.

The token is kept in browser storage (`persistAuthorization`), so it survives a
page reload — paste it once per session rather than after every refresh.

### Configuration

| Variable | Default | |
|---|---|---|
| `SWAGGER_ENABLED` | on unless `NODE_ENV=production` | set `true` to expose it in production, `false` to hide it anywhere |
| `SWAGGER_PATH` | `docs` | serve the UI somewhere else |
| `APP_VERSION` | `0.0.1` | shown as the document version; set it from the image tag |

Both the UI and `/docs-json` follow `SWAGGER_PATH`, and neither is registered at
all when disabled — the switch is configuration, not an `if` in `main.ts`.

### The spec matches what is sent

A `201` on `POST /api/v1/users` documents `{ success, data: UserResponseDto }`, not
a bare `UserResponseDto`. That distinction is the whole point: a spec describing
the inner object generates clients that never unwrap `data` and fail on the
first call.

Failures document `error.code` as the schema example, so the value to match on
is machine-readable rather than prose in a description. Bearer auth is declared
on exactly the routes the guard protects — a class-level `@ApiBearerAuth()` on a
controller with a `@Public()` route would claim registration needs a token.

Four tests hold this true: every 2xx JSON response must wrap the envelope; the
documented fields must equal the keys of a real `201`; and of a real `409`; and
the declared security must match the routes the guard actually leaves open.

`/metrics` is the one documented exception to the envelope, and the test that
enforces it skips it correctly: the Prometheus exposition format is a fixed
text contract, and wrapping it in `{ success, data }` would make it unreadable
to every scraper.

---

## Events

```
                       ┌── UnitOfWork, after commit ──▶ @EventsHandler
use case               │                                (in-process, immediate, best effort)
  └─ publish() ──▶ outbox.events ──▶ OutboxRelay ──▶ evt.<name> ──▶ DurableEventHandler
     (inside the txn)                 (after commit)   JetStream     (at-least-once, idempotent)
```

| Event | Emitted when |
|---|---|
| `identity.user.registered` | a user is created |
| `identity.user.email-changed` | the address actually changes |
| `identity.user.status-changed` | status transitions |
| `identity.user.deleted` | soft delete |
| `auth.user.logged-in` | a session starts |
| `auth.user.logged-out` | logout |
| `auth.session.revoked` | logout, or replay detection |
| `owner.owner.registered` · `.address-changed` · `.deactivated` · `.reactivated` | owner lifecycle |
| `car.car.registered` · `.transferred` · `.repriced` · `.retired` | car lifecycle |
| `rbac.permission.created` · `rbac.role.created` | the catalogue grows |
| `rbac.role.permission-granted` · `.permission-revoked` | a role's permissions change |
| `rbac.role.assigned` · `.unassigned` | a user gains or loses a role |

Published to `evt.<name>` on the `DOMAIN_EVENTS` stream. Durable consumers:

| Consumer | Subscribes to | Does |
|---|---|---|
| `notification_welcome` | `identity.user.registered` | queues a welcome notification |
| `owner_deactivate_on_user_deleted` | `identity.user.deleted` | deactivates the matching owner |
| `car_retire_on_owner_deactivated` | `owner.owner.deactivated` | retires that owner's cars |

The last two form a **two-hop choreography** — deleting a user deactivates their owner record, which retires their cars — with no context importing another's internals and no foreign keys between schemas.

In-process `@EventsHandler` subscribers, for work that is worthless if it arrives late:

| Handler | Subscribes to | Does |
|---|---|---|
| `InvalidateGrantsOnAssignment` | `rbac.role.assigned` · `.unassigned` | evicts that user's cached grants |
| `InvalidateGrantsOnRoleChange` | `rbac.role.permission-granted` · `.permission-revoked` | expands the role to its holders and evicts each |

Both are in-process rather than durable on purpose: the cache is Redis, so one replica's `DEL` serves every replica, and the only failure mode — a lost eviction — is already bounded by `RBAC_CACHE_TTL_SECONDS`. Adding at-least-once machinery would buy nothing.

---

## Observability

Three pieces, all open formats, none of them a vendor SDK the application has
to import:

| | |
|---|---|
| **Metrics** | `GET /metrics` in the Prometheus text format — HTTP rate/latency by route, event throughput, outbox depth, consumer lag, rate-limit rejections, plus the default process metrics |
| **Logs** | JSON on stdout, one object per line, with `level`, `context`, `message` and `correlationId`. One line per request, plus whatever the handlers log |
| **Correlation id** | `X-Request-Id` on every response, and in the body of every error |

```bash
make obs-up     # Prometheus + Loki + Promtail + Grafana on top of the dev stack
```

- Grafana — `http://localhost:3001` (`admin` / `admin`), with the **nest-kit — API and messaging** dashboard already provisioned
- Prometheus — `http://localhost:9090`, scraping `api:3000/metrics` every 15s, with the alert rules in `docker/observability/alerts.yml`
- Loki — `http://localhost:3100`, fed by Promtail from the containers' stdout

### The correlation id is what joins them

Metrics answer *how much and how bad*; logs answer *what exactly broke*. The id
is what turns two dashboards into one investigation:

1. An alert fires on `http_requests_total{status_code=~"5.."}`.
2. The Errors panel at the bottom of the dashboard is Loki, filtered to
   `{service="api", level="error"}`. Take a `correlationId` from any line.
3. `{service="api"} | json | correlationId="019fd1…"` returns that one request
   end to end, across every module it touched.
4. The same id is in the error body the client saw, so a user can paste it into
   a bug report and land on step 3 directly.

It is carried in `AsyncLocalStorage`, not passed as an argument. A logger
parameter on every use case, repository and handler would put a transport
concern into `application/` — exactly what the dependency rule forbids — and
would mean touching every signature to add one field.

`correlationId` is deliberately **not** a Loki label (and no metric is labelled
by URL or user): one label value per request multiplies the index by the
request rate. It stays a parsed field, which is exactly as fast for the one
request you are chasing. Promtail labels only `level` and `context`, and
`http_requests_total` is labelled by route *pattern* — `/api/v1/users/:uuid`,
never `/api/v1/users/019fd1…`.

### Why no Sentry

Prometheus and Loki cover both halves — the aggregate and the single failure —
and self-host with no DSN, no SaaS account and no SDK in the dependency tree.
What a hosted error tracker adds on top is issue grouping and dedup, release
regression tracking, and alert-on-new-error-type. Those are real, and they are
a deployment's decision rather than a starter's dependency: adding
`@sentry/node` here would put a vendor in every consumer's tree for a feature
half of them would rip out. Nothing stops you — initialise it in `main.ts`
beside the logger.

### What is instrumented, and where

| Metric | Emitted by |
|---|---|
| `http_requests_total` · `http_request_duration_seconds` | `HttpMetricsMiddleware` — middleware, not an interceptor, so 404s and requests a guard rejects are counted too |
| one log line per request (`HTTP` context) | `RequestLogMiddleware`. Probes are skipped: a liveness check every five seconds is 17k lines a day that say nothing, and they are already visible as metrics |
| `events_published_total` | `OutboxRelay`, on broker acknowledgement |
| `events_consumed_total{outcome}` · `event_handler_duration_seconds` | `DurableConsumerService`; `outcome` separates `ok`, `duplicate` and `failed`, because a climbing duplicate rate is a relay fault and a climbing failure rate is a handler fault |
| `events_dlq_total` | `DurableConsumerService`, on dead-lettering |
| `rate_limit_rejected_total{scope}` | `RateLimitGuard` |
| `outbox_*` · `consumer_*` · `messaging_broker_reachable` | `MessagingMetricsCollector`, read at scrape time — the same numbers as `GET /api/v1/admin/messaging/status`, so what an operator can curl is also alertable |

`prom-client` is confined to `platform/observability/metrics.service.ts`;
everything else records through its typed methods. Metric names and label sets
then live in one file, which is what stops two spellings of the same counter
becoming two series that each show half the traffic.

---

## Architectural rules

### 1. The dependency rule

```
presentation/ → application/ → domain/
                                  ↑
                     infrastructure/ (implements ports)
```

`domain/` may import: stdlib, `uuid`, `shared/**`. It may **not** import `@nestjs/*`, `typeorm`, `ioredis`, `class-validator`, `express`, or another context's non-domain folders.

Enforced by `pnpm check:arch`, not by review.

### 2. Ports are declared by the consumer

A port lives in the context that needs it. There is no central `ports/` module — that becomes a god-node every context imports, which defeats vertical slicing and blocks extraction.

Ports are `abstract class`, never `interface`. An interface is erased at runtime and cannot be a DI token; an abstract class is both the contract and the token, with no `Symbol` indirection.

```ts
export abstract class UserRepository {
  abstract findByUuid(uuid: string): Promise<User | null>;
}
// identity.module.ts
providers: [{ provide: UserRepository, useClass: TypeOrmUserRepository }]
```

"Not found" returns `null`. Never a throw, never a sentinel — the use case decides what absence means.

### 3. One error model

Everything thrown from `domain/`, `application/` or `infrastructure/` is an `AppError` carrying a `kind`, a machine-readable `code`, field-level `details`, and a `cause` that is never serialised.

A single `AppErrorFilter` maps them. Controllers contain no `try/catch` and no error mapping, and adding a new error code touches neither.

**Never throw `@nestjs/common` HTTP exceptions from `domain/` or `application/`.** They are framework types; throwing them from a use case is what makes a context unextractable and forces per-module mapping. Match on `err.code`, never on message text.

### 4. Public UUID, internal BIGSERIAL

| | Type | Purpose | Visibility |
|---|---|---|---|
| Public identity | `uuid` (UUIDv7) | domain identity, API surface, cross-service references | everywhere |
| Internal key | `BIGSERIAL` | primary key, foreign keys, indexes, joins | `infrastructure/persistence/` only |

UUID primary keys are 16 bytes and randomly ordered, bloating every secondary index and fragmenting the B-tree. A `BIGSERIAL` is 8 bytes and monotonic. The UUID stays the public, opaque, non-enumerable handle. UUIDv7 — never v4, which is not time-ordered and forfeits insert locality.

The repository resolves the internal key by uuid before writing, so updates preserve it without the domain ever seeing it.

### 5. Events

The aggregate **records** events; the use case **publishes** them, inside the transaction:

```ts
return this.uow.withTransaction(async () => {
  await this.users.save(user);
  await this.events.publishAll(user.pullEvents());
  return user;
});
```

`EventBus` routes the event into `outbox.events` on the same connection, so it commits or rolls back with the data that produced it. The `UnitOfWork` dispatches to in-process handlers only *after* the commit.

There is **one** `publish()`. Call sites never choose a durability mode — `fast-kit`'s `publish` / `publish_durable` split makes every call site a chance to silently drop an event everyone assumes is durable, invisible until a downstream projection is missing rows.

Event names are `<context>.<aggregate>.<past-tense-verb>`, published to `evt.<name>`.

**In-process vs durable — a reaction is one or the other, never both.** Registering the same work twice double-applies it.

| | `@EventsHandler` | `DurableEventHandler` |
|---|---|---|
| Delivery | in-process, right after commit | JetStream, at-least-once |
| Survives a crash | no | yes |
| Use for | immediate work you can afford to lose | durable, slow, or cross-context work |

Durable handlers run inside a transaction that also writes the `messaging.processed_events` marker, so a handler that fails after the marker is genuinely retried rather than silently skipped. After `DURABLE_MAX_DELIVER` failures the message goes to `messaging.dead_letters` and is terminated — a poison message must not wedge the consumer.

### 6. Transactions

`UnitOfWork` carries the transactional `EntityManager` in `AsyncLocalStorage`. Repositories resolve it per call and are unaware a transaction exists.

Nested `withTransaction` **joins** the transaction in progress rather than opening a savepoint. Savepoints read as isolation but are not — an inner block can "roll back" and still be committed by the outer one, which is worse than having no nesting at all. Only the outermost call flushes the outbox.

Every persistence adapter extends `TransactionalRepository` and goes through `manager()`. Reaching for the injected `DataSource` checks out a *different* pooled connection: the write neither sees uncommitted rows nor rolls back with them.

### 7. HTTP

| Concern | Rule |
|---|---|
| Envelope | `{ success, data }` / `{ success, error, path, timestamp }` — fixed contract, do not rename |
| Errors | `AppErrorFilter` is the only error path |
| DTOs | class-validator classes, boundary only — a DTO never reaches `application/` |
| Commands | plain classes, no decorators, no validation |
| Controllers | decode → dispatch → map. No business logic, no repository access |
| Validation | global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` |
| Authentication | global and deny-by-default; `@Public()` is the only opt-out |
| Authorization | opt-in per route with `@RequirePermissions('resource:action')`. Name a permission, never a role |
| Config | `platform/config` only — `process.env` elsewhere is a gate failure |
| Docs | `@ApiEnvelope` / `@ApiFailure`, never bare `@ApiResponse({ type })` — the raw DTO is not what goes on the wire |
| Money | never `number`; a decimal string end to end |
| CORS | explicit allowlist, never `*` with credentials |

### 8. Migrations own the schema

`synchronize: false` in every environment, test included. One schema per bounded context (`identity.`, `auth.`, `rbac.`, `owner.`, `car.`, `notification.`, `outbox.`, `messaging.`) — it makes the extraction cut line visible in the database.

Every table: `id BIGSERIAL PRIMARY KEY`, `uuid UUID NOT NULL UNIQUE`, `created_at`/`updated_at`/`deleted_at` as `TIMESTAMPTZ`. No explicit index on `uuid` — the `UNIQUE` constraint already creates the btree, and a second is pure write and disk overhead.

The exception is a table whose identity *is* its natural key — `rbac.role_permissions`, `rbac.user_roles`, `messaging.processed_events`. Those take a composite primary key and no `uuid`, because a surrogate key would add an index nothing ever reads.

Soft-delete uniqueness is a **partial** index (`WHERE deleted_at IS NULL`), so a deleted row does not permanently reserve its value. Repository queries must match that predicate or the database and the application will disagree about what is taken.

### 9. Raw SQL

Allowed and expected in `infrastructure/` — that layer's job is SQL. It is a violation only if it leaks upward.

- Positional parameters only. Never build SQL with template interpolation.
- Always go through `manager()`, never the `DataSource`.
- Wrap every `UPDATE … RETURNING` in a CTE ending in a `SELECT`. TypeORM's `query()` returns `[rows, affectedCount]` for update-shaped commands and a plain row array for selects; wrapping keeps the return shape predictable rather than driver-dependent.

### 10. Extraction path

1. Move `src/modules/<ctx>/` into a new Nest app.
2. Give it its own `main.ts` / `app.module.ts`.
3. Swap the `EventBus` provider to a `ClientProxy`; `@EventsHandler` becomes `@EventPattern`.
4. Distribute `certs/public.pem` so it verifies tokens without minting them.
5. `domain/` and `application/` are unchanged. That is the point.

Forbidden because it breaks the above: importing another context's internals (only its `index.ts` and published events), a shared `ports/` module, injecting another context's service into a use case, cross-context foreign keys, and throwing framework HTTP exceptions from inner layers.

---

## Decision log

| Decision | Choice | Why | Rejected |
|---|---|---|---|
| ORM | TypeORM, DataMapper | House consistency; the mapper layer neutralises most leakage | Prisma — its single global client exposes every table to every context, the exact coupling being designed out |
| ORM integration | Provide `DataSource` directly | `@InjectRepository`/`forFeature` serve a pattern this architecture does not use | `@nestjs/typeorm` |
| Domain model | Plain classes + mapper | ORM-bound domain is the one thing that cannot be retrofitted | TypeORM entity as domain model |
| CQRS lib | `@nestjs/cqrs`, without `AggregateRoot` | `apply()`/`commit()` drags the framework into `domain/` | `@nestjs/event-emitter` — no seam for the outbox |
| Durability | One `publish()`, UnitOfWork-driven outbox | Removes the durability decision from every call site | `publish` / `publish_durable` split (fast-kit) |
| Boundary enforcement | Custom `check-arch.mjs` | Package-level rules eslint cannot express against relative imports | Convention + review |
| Env validation | zod at boot | Fail fast with a readable message, typed everywhere after | Runtime `process.env` reads |
| Password hashing | `@node-rs/argon2` | Prebuilt musl binaries; the alpine image needs no toolchain | `argon2` (node-gyp) |
| Test env overrides | `test/setup-e2e.ts` | `ConfigModule.forRoot()` reads env at import time, so in-spec assignment is too late and silently does nothing | `process.env` at the top of a spec |
| Authorization unit | Permission named in the route, role named nowhere in code | A permission is stable; which roles carry it is operational and must change without a deploy | `@Roles('admin')` on controllers |
| Authorization guard | Route-scoped, shipped by the decorator | A second `APP_GUARD` must run after `JwtAuthGuard` to see the caller it attaches, and global order is module-resolution order — a silent 401 waiting to happen. Route guards always run after global ones | A second global `APP_GUARD` |
| Grant lookup | Redis cache-aside, evicted by the context's own events | The guard runs on every authorized request; a three-table join on that path is not affordable. Postgres stays authoritative, so a cache outage degrades latency, not correctness | Roles as JWT claims — revocation would lag until the token expires |
| Eviction transport | In-process `@EventsHandler` | The cache is shared, so one replica's `DEL` serves all, and a lost eviction is already bounded by the TTL | `DurableEventHandler` — at-least-once machinery for a `DEL` |
| Admin role | Seeded and `is_protected` | It is the only role holding `rbac:admin`; letting that be revoked locks everyone out of the endpoint that grants it back | Freely editable, recoverable by hand-written SQL |
| First admin | `make seed`, from `SEED_SUPERADMIN_*` | Assigning a role requires `rbac:admin`, so a fresh environment otherwise has no way in | A documented manual `INSERT` — the step that gets skipped |
| Seeding trigger | An explicit command | Booting must not write data: every replica raced to do the same write, and provisioning belongs in shell history where it can be audited | `onApplicationBootstrap` (what this replaced) |
| Seed semantics | Additive — grants, never revokes | A deploy must not silently undo what an operator granted by hand; removing a permission belongs in a reviewed migration | Full reconciliation, catalogue as the only truth |
| Seed safety | Host allowlist, `ALLOW_REMOTE_SEED` to override | `NODE_ENV` is whatever the shell last exported; the host is what is actually written to | `NODE_ENV !== 'production'` |
| API versioning | URI, `/api/v1`, no unversioned alias | The version is then visible in an access log, a curl from a bug report and a dashboard label — "which version broke?" is answerable. Two live spellings of one route means clients pin neither and v2 breaks all of them at once | Header versioning; `/api/…` kept as a permanent alias |
| Error tracking | Prometheus + Loki + Grafana, self-hosted | Metrics give the aggregate, structured logs give the individual stack trace, and the correlation id joins them. No DSN, no SaaS account, no SDK every consumer has to rip out | `@sentry/node` — its real additions (issue grouping, release regressions) are a deployment's decision, not a starter's dependency |
| Metrics library | `prom-client`, imported in exactly one file | Metric names and label sets in one place. Named at the call site, two spellings of one counter become two series that each show half the traffic | Recording from anywhere; a hand-rolled exposition format |
| HTTP instrumentation | Middleware, not an interceptor | An interceptor only runs for a matched route, so 404s and guard rejections — the traffic you actually investigate — would be missing from the counter | `NestInterceptor` |
| Correlation id transport | `AsyncLocalStorage` | Reaches every existing log statement without changing one of them. A logger parameter on every use case would put a transport concern into `application/`, which §1 forbids | Threading a logger through use case signatures |
| Rate limiter store | Redis fixed window, one Lua `eval` | Two replicas behind a balancer make an in-memory limit of 10 a limit of 20, and it resets on every deploy. One script keeps INCR + EXPIRE + TTL from interleaving and returns the reset for `Retry-After` | In-memory counters; separate INCR and EXPIRE round trips |
| Rate limiter failure mode | Fails open | A limiter outage must not become an outage — this is a safeguard, not an authorization decision | Fail closed, on the grounds that it is "safer" |
| Limiter guard position | `APP_GUARD` registered above `AuthModule` | Rejects a credential-less flood before it costs a signature verification and a Redis lookup, and covers login, which has no token to check. Pinned by an e2e test expecting 429 rather than 401 | Below the auth guard, or route-scoped |
| Storage backend | The S3 API, with MinIO in the dev stack | Written against the API rather than against AWS: an endpoint and path-style addressing make the same adapter MinIO on a laptop, R2, Backblaze, Wasabi or AWS itself. A local-disk adapter was written first and deleted — it made the *seam* real while leaving the ceiling in place, and the ceiling was the problem | A disk adapter as the default; an S3 adapter that only works against AWS |
| Body type | `Readable \| Buffer` in, a stream out | The files this exists for are print-ready artwork. A `Buffer` signature quietly caps the product at whatever the process can hold, and the cap is discovered in production. `lib-storage` switches to multipart on its own, which a plain `PutObject` cannot | `Buffer` everywhere, with a "we will stream it later" note |
| Presigned URLs | On the port, not bolted on afterwards | Without them every byte of every upload and download transits the API, and an API that proxies hundreds of megabytes falls over on a busy morning. Adding the methods after call sites existed would have meant rewriting them | Proxying bytes through the API; adding signing when it hurts |
| Key alphabet | Letters, digits, dot, dash, underscore, slash-separated — narrower than S3 allows | Keys are generated, not typed by a person, and a narrow alphabet is safe in a URL, a path and a log line with no escaping. A customer's filename is *sanitised into* a key rather than used as one | Accepting anything S3 accepts, and discovering which characters break a signed URL later |
| S3 credentials | Default to the MinIO container's, exactly as `POSTGRES_USER` defaults to the local database's | A clone runs `make db-up` and the suite passes with nothing configured. Setting **both** to empty is the documented way to hand resolution to the SDK's own chain — an instance role or IRSA — which is what production should do | Empty defaults, which fail with "could not load credentials" on a fresh clone |
| Upload limit location | `MulterModule`, once, from configuration | multer refuses an oversized part while it is still streaming, so the process never holds the whole of a hostile upload. Registered centrally, a route cannot quietly grant itself a bigger budget than the deployment allows | A `limits` option on each `FileInterceptor`; a size check inside the handler, which is already too late |
| Retry safety | Automatic for GET/HEAD/PUT/DELETE; POST and PATCH opt in | The retry that turns one charge into two is the expensive kind of bug, and the safe default is the one nobody has to remember. A POST carrying an idempotency key the upstream honours can opt back in | One retry count for every method |
| Breaker scope | One per upstream host | A dead carrier must not suspend calls to the payment gateway. A 4xx never counts — tripping a breaker on our own bad requests takes out a healthy dependency | A single global breaker; counting every non-2xx |
| Scheduler shutdown | Clears the timers, then awaits work already in flight | Returning immediately leaves a task mid-write against a pool about to be destroyed, still holding its lock so no other replica can take over. Found exactly that way — as an e2e run that would not exit | Clearing the interval and returning |
| Scheduler failure mode | Fails **closed** | The opposite of the limiter, deliberately. A limiter that fails open loses a safeguard; a lock that fails open runs the nightly billing job on every replica, which is damage done. A skipped tick is recovered by the next one | Fail open for consistency with the limiter |
| Lock release | Compare-and-delete in Lua | Releasing without checking the holder is the classic defect: A overruns the TTL, the lock expires, B acquires it, A finishes and deletes B's lock — after which both run, which is what the lock existed to prevent | `DEL` on the way out |
| Delivery record | Written **before** the send | A row that appears only on success cannot describe the send that crashed the process, and that is precisely the case somebody telephones about. One extra write buys a class of failure that is otherwise invisible by construction | Recording the outcome once the transport returns |
| Mail default | `LogMailer`, reporting itself unconfigured until `MAIL_ENABLED` | "We never sent it" has two causes needing two different fixes — no credentials, which an operator repairs once, and a provider that refused, which a resend repairs. Counting them together hides an outage behind a configuration gap | A no-op mailer that reports success; an SMTP dependency chosen on the kit's behalf |
| Recipient address | Copied onto the notification when it is queued | A cross-context join would couple this table to identity's, and an address looked up at send time is the address *now*, not the one the customer had when the thing happened | Joining identity at send time |
| Readiness dependencies | Postgres and Redis required; NATS advisory | The outbox exists so the API keeps accepting writes while the broker is away. Failing readiness there pulls every replica out of rotation for a fault the design already absorbs — a delayed projection becomes a full outage | All three required; NATS omitted from the probe entirely |

---

## Repository rules

1. **`make check` must pass before work is considered finished** — lint, strict typecheck, architecture gate, unit tests.
2. **The architecture gate is not advisory.** It rejects framework imports in `domain/`, cross-context reach-in, layer inversion, and `process.env` outside `platform/config`.
3. **Migrations own the schema.** Never enable `synchronize`. Always write `down()`.
4. **Never commit** `certs/`, `.env`, `dist/`, `node_modules/`, or `graphify-out/`. The repo is public — the `certs/` ignore is load-bearing.
5. **Never add comments unless they explain a decision** the code cannot. Prefer explaining *why*, not *what*.
6. **Commit messages explain the reasoning**, not the diff. Record defects found and why the fix is shaped that way.
7. **Read `AGENTS.md` before changing architecture.** Where it and a comment disagree, `AGENTS.md` wins.
8. **e2e tests need infrastructure**: `make db-up` then `make migrate-up`. They run `--runInBand` because they share one database, and any suite touching the JetStream stream must purge it like it truncates tables. The rate limiter counts in Redis, which also outlives the process — a suite that exercises it must clear its `ratelimit:*` keys for the same reason.
9. **A metric label is never unbounded.** Route patterns, not URLs; no uuids, user ids or correlation ids in a label — on a Prometheus series or a Loki stream. The same value belongs in the log *body*, where it costs nothing.
10. **A new bounded context is cloned from `identity`** — it is the reference module.

---

## Adding a bounded context

`identity` is the minimal reference. **`owner` and `car` are the worked pair**, and between them exercise every rule in this README:

| Principle | Where to look |
|---|---|
| Value object enforcing a domain rule | `owner/domain/value-objects/date-of-birth.ts` — minimum age |
| Value object normalising input | `car/domain/value-objects/license-plate.ts` — `ab-12 cd` and `AB12CD` are one plate |
| Money as a decimal string | `car/domain/value-objects/money.ts` and `NUMERIC(12,2)` — never a float |
| Aggregate invariants | `car.transferTo` rejects a no-op transfer; a retired car refuses every change |
| Idempotent state change | `owner.deactivate` / `car.retire` emit once, because the caller may be a redelivered event |
| Cross-context read via a port | `RegisterOwnerHandler` takes identity's `UserRepository`; `RegisterCarHandler` takes owner's `OwnerRepository` |
| Referential integrity without a foreign key | checked in the use case, since a cross-schema FK would block extraction |
| Cross-context reaction | the two durable handlers above |
| Batch write in one transaction | `CarRepository.saveAll` when an owner's cars are retired together |
| Partial index for the hot query | `cars_active_owner_idx` covers exactly the deactivation reaction |
| Drawing an aggregate boundary | `rbac`'s `Role` owns its permission grants but not the users holding it — that set is unbounded |
| A cached read model kept fresh | `RedisAccessControl` plus the two in-process invalidators, with the TTL as a backstop, not the mechanism |

Clone that shape rather than inventing one.

1. `src/modules/<context>/` with `domain/`, `application/`, `infrastructure/`, `presentation/http/`.
2. **Domain first** — entity with behaviour, value objects, `errors.ts` as `AppError` factories, `events/`, and `ports/` as `abstract class`. No framework imports.
3. **Application** — one file per use case, `*.command.ts` plus `*.handler.ts`. Wrap writes in `uow.withTransaction` and publish inside it.
4. **Infrastructure** — `*.orm-entity.ts`, `*.mapper.ts`, `*-repository.ts` extending `TransactionalRepository`. The ORM entity never leaves this folder.
5. **Presentation** — controller plus `dto/`. Routes are authenticated unless marked `@Public()`; add `@RequirePermissions('<context>:<action>')` where a route needs more than a caller, and create the permission so a role can hold it. A new controller needs no version decorator — it inherits `/api/v1` — and is rate limited by the global budget already; reach for `@AuthRateLimit()` only if it takes a credential.
6. **Migration** — `make migrate-create NAME=X`, its own schema, `BIGSERIAL` + `uuid`, no cross-context foreign keys.
7. **`index.ts`** exporting only the module, its ports, entities and events — never adapters or handlers.
8. Register in `app.module.ts`, then `make check`.

To react to another context, add a `DurableEventHandler` in *your* `infrastructure/event-handlers/`. Never import the other context's internals.

---

## Commands

| Command | Does |
|---|---|
| `make check` | Every gate: lint, typecheck, architecture, tests |
| `pnpm check:arch` | Architecture gate alone |
| `pnpm test` / `pnpm test:e2e` | Unit tests / e2e (needs infrastructure) |
| `make dev` / `make prod` | Full stack in Docker |
| `make db-up` / `make db-down` | Postgres + Redis + NATS only |
| `make migrate-create NAME=X` | New empty migration |
| `make migrate-up` / `migrate-down` / `migrate-status` | Apply / revert / inspect |
| `make seed` | Roles, permissions and the superadmin — idempotent |
| `make dev-migrate` / `dev-seed` | Same, inside the development stack |
| `make prod-migrate` / `prod-seed` | Same, inside the production stack |
| `make keygen` | ES256 keypair into `certs/` |
| `pnpm openapi:export [file]` | Write the OpenAPI document (default `openapi.json`) |
| `make obs-up` / `obs-down` / `obs-logs` | Prometheus + Loki + Promtail + Grafana |
| `make psql` / `make redis-cli` / `make nats-info` | Inspect infrastructure |
| `make clean` | Remove containers, volumes and the built image |

---

## Status

✅ done  🚧 partial / in progress  ❌ not started

### Foundation

| | Item |
|---|---|
| ✅ | Docker dev + prod stacks, non-root, healthchecks, log rotation |
| ✅ | Shared kernel — `AppError`, `DomainEvent`, ports, pagination |
| ✅ | zod-validated config, single `AppConfig` reader |
| ✅ | HTTP: response envelope, single error filter, validation pipe |
| ✅ | OpenAPI — envelope-accurate schemas, error codes, exportable spec |
| ✅ | Architecture gate (`check-arch.mjs`), 7 rules, verified against real violations |
| ✅ | Strict TypeScript, eslint, prettier |
| ✅ | Bounded input — JSON/urlencoded body limit, a multer file cap, and 413 as its own error kind |
| ✅ | `FileStorage` — streaming S3 adapter (MinIO, R2, Wasabi or AWS), presigned upload and download URLs, traversal-safe keys |
| ❌ | CI pipeline (GitHub Actions with Postgres, Redis and NATS services) |

### Persistence

| | Item |
|---|---|
| ✅ | `DataSource` provider, pool shutdown, shared CLI/runtime options |
| ✅ | `UnitOfWork` over `AsyncLocalStorage`, nested calls join |
| ✅ | `TransactionalRepository` base |
| ✅ | Migration tooling, one schema per context |
| ✅ | Seeding — idempotent, additive, guarded against non-local hosts |
| ❌ | Read replicas / connection routing |

### Messaging

| | Item |
|---|---|
| ✅ | Transactional outbox, atomic with the business write |
| ✅ | Relay to NATS JetStream, at-least-once, `SKIP LOCKED` for multi-replica |
| ✅ | Outbox retry, dead-lettering and replay |
| ✅ | Durable consumers with transactional idempotency markers |
| ✅ | Consumer DLQ + config reconciliation on boot |
| ✅ | Dead-letter admin API — inspect, replay, discard |
| ✅ | Backlog and per-consumer lag via `GET /admin/messaging/status` |
| ✅ | Prometheus scrape endpoint — the same backlog as gauges, plus publish/consume/DLQ rates |

### Contexts

| | Item |
|---|---|
| ✅ | `identity` — register, get, list, update, soft delete; Argon2id |
| ✅ | `notification` — durable subscriber, plus a delivery record written *before* the send: attempts, last error, `UNCONFIGURED` |
| ✅ | `owner` + `car` — the worked reference pair (see below) |
| ✅ | `auth` — ES256, `typ` claim, refresh rotation with replay detection, Redis blacklist |
| ✅ | Global auth guard, deny by default, `@Public()` opt-out |
| ✅ | `rbac` — roles, permissions, audited assignments, cached grants with event-driven eviction |
| ✅ | `@RequirePermissions()` / `@RequireRoles()`, enforced on `/api/v1/admin/messaging` |

### Operations

| | Item |
|---|---|
| ✅ | Liveness *and* readiness — `/health/ready` checks Postgres, Redis and NATS, 503 on a required one |
| ✅ | Redis — access-token blacklist, TTL bounded by the token's own expiry |
| ✅ | Structured JSON logging with a correlation id, `platform/observability` |
| ✅ | Prometheus metrics at `/metrics`, plus a Grafana + Loki stack (`make obs-up`) and alert rules |
| ✅ | Rate limiting — Redis fixed window, tighter budget on credential routes, fails open |
| ✅ | API versioning — URI, `/api/v1`, probes and scrape version-neutral |
| ✅ | Scheduler — tasks discovered like durable handlers, one replica per tick via a Redis lock, fails closed |
| ✅ | Outbound HTTP — one timeout, one retry policy and a per-host circuit breaker for every integration |
| ✅ | `Mailer` port with a log adapter and a sweeping dispatcher; a real transport is the provider line |
| ❌ | Admin / back-office |
| ❌ | Alertmanager routing (rules exist; where a page goes is a deployment decision) |

### Testing

| | Item |
|---|---|
| ✅ | 215 unit tests — domain, value objects, use cases, guards, limiter, logger, health, metrics, seeders, transactions, serialisation |
| ✅ | 119 e2e tests against live Postgres, Redis and NATS |
| ✅ | Shared `configureApp()` so tests cannot drift from production wiring |
| ❌ | Load / soak testing |
| ❌ | Coverage thresholds enforced in CI |

---

## Troubleshooting

**`GET /api` returns 404.** Expected. `/api` is the global *prefix*, not a route — nothing is mounted at the bare prefix, and there is no root route either. The well-formed error envelope you get back is the filter working. Go to **`/docs`**.

**A route 404s in the browser but works in `curl`.** A browser only issues `GET`. `POST /api/v1/auth/login` is POST-only, and Nest matches method and path together, so a `GET` is simply an unmatched route. Use `/docs` and its *Try it out*, or `curl -X POST`.

**`404` on a path that exists, e.g. `/api/users`.** Routes are versioned: it is `/api/v1/users`. There is no unversioned alias on purpose — see [Versioning](#versioning). `/health` and `/metrics` are the exception and take no version.

**`401` on every route.** Expected — access is denied by default. Get a token (see [Authentication](#authentication)) or mark the route `@Public()`.

**`429 RATE_LIMITED` while developing.** The limiter counts per client IP in Redis, and a hot reload loop or a seeded test script burns the budget fast. `X-RateLimit-Reset` says how long until the window rolls; raise `RATE_LIMIT_LIMIT` / `RATE_LIMIT_AUTH_LIMIT`, or set `RATE_LIMIT_ENABLED=false` locally. Counters live in Redis, so `make redis-cli` then `DEL` the `ratelimit:*` keys clears it immediately.

**`/health/ready` returns `degraded`.** A non-required dependency is down — in practice NATS. The API keeps serving and events queue in the outbox; check `messaging_broker_reachable` and `GET /api/v1/admin/messaging/status`. It only returns 503 when Postgres or Redis is down.

**Grafana shows "No data".** Check `http://localhost:9090/targets` — the scrape target is `api:3000`, which resolves only when the API runs *in* the compose network. Running the app on the host with `pnpm start:dev` means Prometheus cannot reach it: use `make dev` (or add a `host.docker.internal` target). Also confirm `METRICS_ENABLED` is not `false`.

**`403 FORBIDDEN` with a perfectly good token.** The token authenticated you; the route wants a permission you do not hold. `GET /api/v1/rbac/me/grants` shows what you have. If it comes back empty on a fresh database, nobody has been made an admin yet — set `SEED_SUPERADMIN_EMAIL`/`_PASSWORD` and run `make seed`.

**A route 403s for everyone, including admin.** It requires a permission that is not in the catalogue, so no role can hold it. Compare the string in `@RequirePermissions()` against `GET /api/v1/rbac/permissions`; a permission has to be created before a route can ask for it.

**`STORAGE_UNAVAILABLE`, and the log says "could not load credentials from any providers".** Both `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are empty, which deliberately hands resolution to the AWS SDK's own chain — correct in production behind an instance role, and nothing at all on a laptop. Set them to the MinIO defaults, or start the container with `make db-up`.

**`STORAGE_UNAVAILABLE` against a bucket that exists.** Two usual causes. `S3_FORCE_PATH_STYLE` must be `true` for MinIO and most self-hosted stores, which cannot do virtual-host addressing without wildcard DNS. And `S3_ENDPOINT` is `http://minio:9000` *inside* the compose network but `http://localhost:9000` from the host — running the app with `pnpm start:dev` against the container needs the latter.

**Boot fails reading `certs/private.pem`.** Run `make keygen`. The keypair is gitignored, so every clone and every CI run needs its own.

**e2e fails with "relation does not exist".** e2e needs real infrastructure: `make db-up` then `make migrate-up`.

**e2e passes alone but fails in the suite.** They share one database, so they run `--runInBand`. A suite touching the JetStream stream must also purge it — the stream outlives the process, and `DeliverPolicy.All` replays history the moment `processed_events` is truncated.

**An env override in a spec does nothing.** `ConfigModule.forRoot()` reads and validates the environment when `app.module.ts` is first imported, and imports evaluate before any statement in the importing file. Put overrides in `test/setup-e2e.ts`.

**`SyntaxError: Unexpected token 'export'` from jose.** It is ESM-only and jest's runtime is CJS. Both jest configs carry `transformIgnorePatterns: ["node_modules/(?!.*jose)"]`; the naive `(?!jose)` fails because pnpm nests packages under `.pnpm/`.

**Events never reach a consumer.** Start at `GET /api/v1/admin/messaging/status`. A rising `outbox.pending` with a growing `oldestPendingAgeSeconds` means the relay is not draining (is NATS up? is `OUTBOX_ENABLED` true?). `outbox.deadLettered` above zero means publishing failed `OUTBOX_MAX_ATTEMPTS` times — list them at `outbox/dead-lettered` to see `lastError`, then `POST outbox/replay`. If the outbox is clear but nothing reacts, check the consumer: `present: false` means it failed to start, rising `redelivered` without `pending` falling means the handler keeps throwing, and `deadLetters` above zero means it gave up — inspect at `dead-letters`.

**"consumer already exists" at boot.** A durable consumer's configuration changed. It is reconciled automatically; if it still fails the consumer is skipped and logged rather than taking the API down.

**Host `pnpm build` fails with `EACCES`.** A stale root-owned `dist/` from an older container. Every stage now runs as `node` (uid 1000); remove `dist/` and rebuild.

---

## License

[MIT](LICENSE) © 2026 Azmain Mahtab.

`package.json` keeps `"private": true` so the kit cannot be published to npm by accident. It is a template to clone, not a package to install — that flag is about distribution, not licensing.
