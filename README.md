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
| Quality | eslint + prettier + strict tsc + a custom architecture gate |

---

## Quick start

```bash
pnpm install
cp .env.example .env          # optional; every value has a default
make db-up                    # Postgres + Redis + NATS
make migrate-up               # apply migrations
pnpm start:dev                # or: make dev  (full stack in Docker)
```

- API: `http://localhost:3000/api`
- Health: `http://localhost:3000/health` (deliberately outside the API prefix)
- Swagger: `http://localhost:3000/docs` (non-production only)

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
│   │   └── event-handlers/       # durable + in-process subscribers
│   ├── presentation/http/        # controllers, DTOs, Swagger
│   ├── index.ts                  # the context's ONLY public surface
│   └── <context>.module.ts
├── platform/                     # config, database, http, crypto, eventbus,
│                                 # messaging, outbox, health
├── shared/                       # shared kernel — pure, framework-free
└── database/migrations/
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

## Authentication

**Access is denied by default.** The guard is global, so a new route is protected the moment it exists. Public routes opt out explicitly with `@Public()`, which makes every unauthenticated entry point greppable:

| Public route | Why |
|---|---|
| `POST /api/users` | registration must precede having a token |
| `POST /api/auth/login` · `POST /api/auth/refresh` | they *produce* tokens |
| `GET /health` | probes run without credentials |

```bash
# 1. register
curl -X POST localhost:3000/api/users \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse-battery"}'

# 2. log in -> { accessToken, refreshToken, expiresAt }
TOKEN=$(curl -sX POST localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse-battery"}' \
  | jq -r .data.accessToken)

# 3. call anything
curl localhost:3000/api/users -H "Authorization: Bearer $TOKEN"
```

`make keygen` must have run first — the tokenizer reads `certs/private.pem` at boot.

**Tokens.** ES256 (ECDSA P-256), never HS256: a shared secret lets every verifier also mint. Access and refresh are signed by the same key and separated only by a `typ` claim, checked on every parse — without it a refresh token would authenticate every request for its whole lifetime. Defaults: access 15 min, refresh 30 days.

**Revocation.** Logout revokes the session (killing refresh) *and* blacklists the access token's `jti` in Redis with a TTL bounded by the token's own `exp`, so an entry can never outlive the token it revokes.

**Refresh rotation with replay detection.** A refresh token is single-use. Presenting a superseded one means it was captured — the legitimate client has already rotated past it — so the whole session is revoked, not just that request, because the attacker may hold a newer token too. The revocation is committed *before* the request is rejected; throwing first would roll it back.

Inside a handler, `@CurrentUser()` yields `{ uuid, sessionUuid, jti, expiresAt }`.

---

## API

| Method | Path | Auth |
|---|---|---|
| `POST` | `/api/users` | public |
| `GET` | `/api/users` | bearer |
| `GET` | `/api/users/:uuid` | bearer |
| `PATCH` | `/api/users/:uuid` | bearer |
| `DELETE` | `/api/users/:uuid` | bearer (soft delete) |
| `POST` | `/api/auth/login` | public |
| `POST` | `/api/auth/refresh` | public |
| `POST` | `/api/auth/logout` | bearer |
| `GET` | `/api/admin/messaging/status` | bearer ⚠️ |
| `GET` | `/api/admin/messaging/outbox/dead-lettered` | bearer ⚠️ |
| `POST` | `/api/admin/messaging/outbox/replay` | bearer ⚠️ |
| `GET` | `/api/admin/messaging/dead-letters` | bearer ⚠️ |
| `POST` | `/api/admin/messaging/dead-letters/discard` | bearer ⚠️ |
| `POST` `GET` | `/api/owners`, `/api/owners/:uuid` | bearer |
| `PATCH` | `/api/owners/:uuid/address`, `/api/owners/:uuid/deactivate` | bearer |
| `POST` `GET` | `/api/cars`, `/api/cars/:uuid` | bearer |
| `PATCH` | `/api/cars/:uuid/transfer`, `/price`, `/retire` | bearer |
| `GET` | `/health` | public, outside the API prefix |

⚠️ The admin routes are authenticated but **not yet authorised** — any logged-in
user can replay and discard events. Restrict them with `@Roles('admin')` when
RBAC lands, or keep them off the public ingress.

Full schemas at `/docs` when not in production.

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

Published to `evt.<name>` on the `DOMAIN_EVENTS` stream. Durable consumers:

| Consumer | Subscribes to | Does |
|---|---|---|
| `notification_welcome` | `identity.user.registered` | queues a welcome notification |
| `owner_deactivate_on_user_deleted` | `identity.user.deleted` | deactivates the matching owner |
| `car_retire_on_owner_deactivated` | `owner.owner.deactivated` | retires that owner's cars |

The last two form a **two-hop choreography** — deleting a user deactivates their owner record, which retires their cars — with no context importing another's internals and no foreign keys between schemas.

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
| Config | `platform/config` only — `process.env` elsewhere is a gate failure |
| Money | never `number`; a decimal string end to end |
| CORS | explicit allowlist, never `*` with credentials |

### 8. Migrations own the schema

`synchronize: false` in every environment, test included. One schema per bounded context (`identity.`, `notification.`, `outbox.`, `messaging.`) — it makes the extraction cut line visible in the database.

Every table: `id BIGSERIAL PRIMARY KEY`, `uuid UUID NOT NULL UNIQUE`, `created_at`/`updated_at`/`deleted_at` as `TIMESTAMPTZ`. No explicit index on `uuid` — the `UNIQUE` constraint already creates the btree, and a second is pure write and disk overhead.

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

---

## Repository rules

1. **`make check` must pass before work is considered finished** — lint, strict typecheck, architecture gate, unit tests.
2. **The architecture gate is not advisory.** It rejects framework imports in `domain/`, cross-context reach-in, layer inversion, and `process.env` outside `platform/config`.
3. **Migrations own the schema.** Never enable `synchronize`. Always write `down()`.
4. **Never commit** `certs/`, `.env`, `dist/`, `node_modules/`, or `graphify-out/`. The repo is public — the `certs/` ignore is load-bearing.
5. **Never add comments unless they explain a decision** the code cannot. Prefer explaining *why*, not *what*.
6. **Commit messages explain the reasoning**, not the diff. Record defects found and why the fix is shaped that way.
7. **Read `AGENTS.md` before changing architecture.** Where it and a comment disagree, `AGENTS.md` wins.
8. **e2e tests need infrastructure**: `make db-up` then `make migrate-up`. They run `--runInBand` because they share one database, and any suite touching the JetStream stream must purge it like it truncates tables.
9. **A new bounded context is cloned from `identity`** — it is the reference module.

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

Clone that shape rather than inventing one.

1. `src/modules/<context>/` with `domain/`, `application/`, `infrastructure/`, `presentation/http/`.
2. **Domain first** — entity with behaviour, value objects, `errors.ts` as `AppError` factories, `events/`, and `ports/` as `abstract class`. No framework imports.
3. **Application** — one file per use case, `*.command.ts` plus `*.handler.ts`. Wrap writes in `uow.withTransaction` and publish inside it.
4. **Infrastructure** — `*.orm-entity.ts`, `*.mapper.ts`, `*-repository.ts` extending `TransactionalRepository`. The ORM entity never leaves this folder.
5. **Presentation** — controller plus `dto/`. Routes are protected unless marked `@Public()`.
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
| `make keygen` | ES256 keypair into `certs/` |
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
| ✅ | HTTP: response envelope, single error filter, validation pipe, Swagger |
| ✅ | Architecture gate (`check-arch.mjs`), 7 rules, verified against real violations |
| ✅ | Strict TypeScript, eslint, prettier |
| ❌ | CI pipeline (GitHub Actions with Postgres + NATS services) |

### Persistence

| | Item |
|---|---|
| ✅ | `DataSource` provider, pool shutdown, shared CLI/runtime options |
| ✅ | `UnitOfWork` over `AsyncLocalStorage`, nested calls join |
| ✅ | `TransactionalRepository` base |
| ✅ | Migration tooling, one schema per context |
| ❌ | Seeding |
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
| ❌ | Prometheus scrape endpoint (belongs with observability) |

### Contexts

| | Item |
|---|---|
| ✅ | `identity` — register, get, list, update, soft delete; Argon2id |
| ✅ | `notification` — durable subscriber proving cross-context reaction |
| ✅ | `owner` + `car` — the worked reference pair (see below) |
| ✅ | `auth` — ES256, `typ` claim, refresh rotation with replay detection, Redis blacklist |
| ✅ | Global auth guard, deny by default, `@Public()` opt-out |
| ❌ | RBAC — roles, permissions, `@Roles()` guard |

### Operations

| | Item |
|---|---|
| 🚧 | Health — liveness only; no readiness probe for Postgres/NATS |
| ✅ | Redis — access-token blacklist, TTL bounded by the token's own expiry |
| ❌ | Structured logging, metrics, Sentry (`platform/observability`) |
| ❌ | Rate limiting |
| ❌ | Admin / back-office |
| ❌ | API versioning |

### Testing

| | Item |
|---|---|
| ✅ | 46 unit tests — domain, use cases, transactions, serialisation |
| ✅ | 27 e2e tests against live Postgres + NATS |
| ✅ | Shared `configureApp()` so tests cannot drift from production wiring |
| ❌ | Load / soak testing |
| ❌ | Coverage thresholds enforced in CI |

---

## Troubleshooting

**`401` on every route.** Expected — access is denied by default. Get a token (see [Authentication](#authentication)) or mark the route `@Public()`.

**Boot fails reading `certs/private.pem`.** Run `make keygen`. The keypair is gitignored, so every clone and every CI run needs its own.

**e2e fails with "relation does not exist".** e2e needs real infrastructure: `make db-up` then `make migrate-up`.

**e2e passes alone but fails in the suite.** They share one database, so they run `--runInBand`. A suite touching the JetStream stream must also purge it — the stream outlives the process, and `DeliverPolicy.All` replays history the moment `processed_events` is truncated.

**An env override in a spec does nothing.** `ConfigModule.forRoot()` reads and validates the environment when `app.module.ts` is first imported, and imports evaluate before any statement in the importing file. Put overrides in `test/setup-e2e.ts`.

**`SyntaxError: Unexpected token 'export'` from jose.** It is ESM-only and jest's runtime is CJS. Both jest configs carry `transformIgnorePatterns: ["node_modules/(?!.*jose)"]`; the naive `(?!jose)` fails because pnpm nests packages under `.pnpm/`.

**Events never reach a consumer.** Start at `GET /api/admin/messaging/status`. A rising `outbox.pending` with a growing `oldestPendingAgeSeconds` means the relay is not draining (is NATS up? is `OUTBOX_ENABLED` true?). `outbox.deadLettered` above zero means publishing failed `OUTBOX_MAX_ATTEMPTS` times — list them at `outbox/dead-lettered` to see `lastError`, then `POST outbox/replay`. If the outbox is clear but nothing reacts, check the consumer: `present: false` means it failed to start, rising `redelivered` without `pending` falling means the handler keeps throwing, and `deadLetters` above zero means it gave up — inspect at `dead-letters`.

**"consumer already exists" at boot.** A durable consumer's configuration changed. It is reconciled automatically; if it still fails the consumer is skipped and logged rather than taking the API down.

**Host `pnpm build` fails with `EACCES`.** A stale root-owned `dist/` from an older container. Every stage now runs as `node` (uid 1000); remove `dist/` and rebuild.

---

## License

[MIT](LICENSE) © 2026 Azmain Mahtab.

`package.json` keeps `"private": true` so the kit cannot be published to npm by accident. It is a template to clone, not a package to install — that flag is about distribution, not licensing.
