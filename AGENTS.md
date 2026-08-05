# nest-kit — Architecture Rules

Authoritative conventions for this codebase. Read before writing code. Where this file and a comment disagree, this file wins.

Architecture: **Modular Monolith + Clean Architecture (Ports & Adapters) + DDD + CQRS**, sliced vertically by bounded context.

> This kit is the TypeScript member of the `fast-kit` / `go-kit` / `django-kit` family and follows their conventions.
> It deliberately does **not** follow the base-class CRUD pattern in
> `claude-fullstack-workspace/.claude/stacks/nestjs/` — that stack optimizes for generation speed,
> this one optimizes for boundaries that survive extraction. Do not mix them.

---

## 1. Layout

```
nest-kit/
├── src/
│   ├── main.ts                      # bootstrap only
│   ├── app.module.ts                # composition root — wiring only
│   ├── modules/<context>/           # bounded contexts
│   │   ├── domain/                  # entities, value objects, ports, events, errors
│   │   ├── application/
│   │   │   ├── commands/            # write use cases  (*.command.ts + *.handler.ts)
│   │   │   └── queries/             # read use cases   (*.query.ts + *.handler.ts)
│   │   ├── infrastructure/
│   │   │   ├── persistence/         # orm-entities, mappers, TypeORM repositories
│   │   │   ├── cache/               # redis adapters
│   │   │   └── event-handlers/      # @EventsHandler subscribers
│   │   ├── presentation/http/       # controllers, dto/, swagger
│   │   ├── index.ts                 # the module's ONLY public surface
│   │   └── <context>.module.ts      # facade: providers in, exports out
│   ├── platform/                    # db, cache, http, config, health, observability
│   ├── shared/                      # shared kernel — pure, framework-free
│   └── database/migrations/         # TypeORM migrations
└── test/                            # e2e only; unit tests live next to the code
```

### What goes where

| Concern | Location |
|---|---|
| Business rule about one aggregate | `domain/` — a method on the entity |
| Orchestration across ports | `application/commands/` or `queries/` |
| SQL, Redis, HTTP clients | `infrastructure/` |
| HTTP decode / authorize / respond | `presentation/http/` |
| Genuinely cross-context abstraction | `src/shared/` |
| Technical infrastructure with no domain meaning | `src/platform/` |

`shared/` is pure TypeScript — no `@nestjs/*`, no `typeorm`. `platform/` is where the framework lives.

---

## 2. Dependency Rule

```
presentation/ → application/ → domain/
                                  ↑
                     infrastructure/ (implements ports)
```

`domain/` may import: stdlib, `uuid`, `src/shared/**`.

`domain/` may NOT import: `@nestjs/*`, `typeorm`, `ioredis`, `class-validator`, `express`, or any other context's folders except another context's `domain/`.

`application/` may import `@nestjs/cqrs` and `@nestjs/common` decorators only. It may **not** import `@nestjs/common` HTTP exceptions — see §4.

Enforced by `pnpm check:arch` (eslint `no-restricted-imports` zones). A violation fails the build, not a review.

---

## 3. Ports

Ports are declared **by the consumer, inside the context that needs them**.

There is no `src/ports/` module. A central ports module becomes a god-node that every context imports, which defeats vertical slicing and blocks extraction.

Declare a port as an `abstract class`, never an `interface`. An interface is erased at runtime and cannot be a DI token; an abstract class is both the contract and the token, with no `Symbol` indirection and no `@Inject()` at every call site.

```ts
// modules/identity/domain/ports/user-repository.port.ts
export abstract class UserRepository {
  abstract findByUuid(uuid: string): Promise<User | null>;
  abstract findByEmail(email: Email): Promise<User | null>;
  abstract save(user: User): Promise<void>;
}
```

```ts
// modules/identity/identity.module.ts
providers: [{ provide: UserRepository, useClass: TypeOrmUserRepository }]
```

| Port | Declared in |
|---|---|
| `UserRepository` | `modules/identity/domain/ports/` |
| `SessionRepository`, `TokenBlacklist` | `modules/auth/domain/ports/` |
| `EventBus`, `UnitOfWork`, `Hasher`, `Tokenizer`, `Clock` | `src/shared/application/ports/` |

A port belongs in `src/shared/` only if two or more contexts genuinely need it.

### Repository contract

- "Not found" returns `null`. Never throw, never a sentinel. The use case decides what absence means.
- Repositories take and return **domain** entities, never ORM entities.
- Every method routes through the context-aware `EntityManager` (§8) so a use case can wrap it in a transaction transparently.

---

## 4. Error Model — one mechanism

Every error thrown from `domain/`, `application/`, or `infrastructure/` is an `AppError`.

```ts
// shared/errors/app-error.ts
export class AppError extends Error {
  constructor(
    readonly kind: ErrorKind,      // NOT_FOUND | CONFLICT | INVALID | UNAUTHORIZED | FORBIDDEN | INTERNAL
    readonly code: string,         // machine-readable: 'USER_NOT_FOUND'
    message: string,               // safe to show a client
    readonly details: ErrorItem[] = [],
    readonly cause?: unknown,      // never serialized
  ) { super(message); }
}
```

Constructors: `AppError.notFound`, `.conflict`, `.invalid`, `.unauthorized`, `.forbidden`, `.validation(field, msg)`, `.internal(cause)`.

Module errors are exported as factories so callers can match on `code`:

```ts
// modules/identity/domain/errors.ts
export const UserNotFound = () => AppError.notFound('USER_NOT_FOUND', 'user not found');
export const EmailTaken = () =>
  AppError.conflict('EMAIL_TAKEN', 'email already registered').withField('email', 'already registered');
```

Match on `err instanceof AppError && err.code === 'USER_NOT_FOUND'` — **never on message text**.

### Controllers

There is exactly one mapper: `AppErrorFilter`, registered globally in `platform/http/filters/`. Controllers contain no `try/catch` and no error mapping.

**Never** throw `NotFoundException`, `ConflictException`, or any other `@nestjs/common` HTTP exception from `domain/` or `application/`. Those are framework types; throwing them from a use case is what makes a module unextractable and forces per-module mapping.

Adding a new error code must not require touching any controller or filter. `kind` determines the status; `code` travels to the client as data.

`INTERNAL` never leaks a cause — the filter emits a generic message and logs the `cause`.

---

## 5. Identity & Keys

Two distinct identifiers, deliberately:

| | Type | Purpose | Visibility |
|---|---|---|---|
| **Public identity** | `uuid` (UUIDv7) | Domain identity, API surface, cross-service references | Everywhere |
| **Internal key** | `BIGSERIAL` → `bigint` | Primary key, foreign keys, indexes, joins | `infrastructure/persistence/` only |

Rationale: UUID primary keys are 16 bytes and randomly ordered, which bloats every secondary index and fragments the B-tree. A `BIGSERIAL` is 8 bytes and monotonic. The UUID stays the public, opaque, non-enumerable handle.

Rules:

- `domain/` entities carry `uuid: string`. They never see the internal key.
- The internal key exists only on the `*.orm-entity.ts` class in `infrastructure/persistence/`.
- Generate with UUIDv7 (`uuidv7()`), never v4 — v4 is not time-ordered and forfeits the insert locality.
- Every table has `id BIGSERIAL PRIMARY KEY` and `uuid UUID NOT NULL UNIQUE`.
- Foreign keys reference the parent's `BIGINT id`, resolved on write from the parent's uuid.

---

## 6. Authentication

### Tokens — ES256, never HS256

Signing uses an **ECDSA P-256 keypair**. The private key signs; the public key verifies.

Why not HS256: a shared secret means every service that verifies a token can also mint one. With ES256 the public key can be distributed freely — to another service, to a gateway — without granting the ability to forge tokens. This is the prerequisite for the extraction path in §13.

```
certs/private.pem   # PKCS#8 EC private key — never committed, never logged
certs/public.pem    # SPKI public key — safe to distribute
```

Generate with `make keygen`. Configured via `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH`.

The parser rejects any token whose algorithm is not ES256. Never accept `alg: none` or an HMAC algorithm — pass `algorithms: ['ES256']` explicitly on every verify.

### Access vs refresh

Both token types are signed by the same key, so they **must** be distinguished by a claim:

```ts
{ typ: 'access' }   // or 'refresh'
```

`parseAccessToken` rejects anything that is not `typ: 'access'`; `parseRefreshToken` rejects anything that is not `typ: 'refresh'`. Without this a long-lived refresh token would authenticate every request.

### Guard order

`JwtAuthGuard` must, in order:

1. Extract the bearer token
2. Verify the signature (ES256 only)
3. Verify `typ === 'access'`
4. Check the Redis blacklist by `jti`
5. Attach `CurrentUser` to the request

### Refresh rotation

Every refresh issues a new refresh token and stores its `jti` on the session. A presented `jti` that does not match the stored one means a replayed or stolen token: **revoke the whole session**.

### Authorization

`src/shared/auth-context/` holds the `CurrentUser` **type** only — `shared/` is framework-free, so the `@CurrentUser()` decorator lives in `platform/http/decorators/`. Any context may import the type. **Never** import `modules/auth/presentation/` from another context — that creates a module cycle and breaks extraction.

Public endpoints never bind privilege-bearing fields (`role`, `status`, `ownerId`) from the request body. `ValidationPipe` runs with `whitelist: true, forbidNonWhitelisted: true` globally; that is a backstop, not the rule.

---

## 7. Events

### Domain events — durable via the outbox

Use `@nestjs/cqrs`'s bus behind our own `EventBus` port. Do **not** extend `AggregateRoot` — its `apply()`/`commit()` pattern drags `@nestjs/cqrs` into `domain/`, violating §2. The aggregate *records* events; the use case publishes them:

```ts
return this.uow.withTransaction(async () => {
  await this.users.save(user);
  await this.events.publishAll(user.pullEvents());   // inside the transaction
  return user;
});
```

- **Publish inside the transaction.** `EventBus` routes the event into `outbox.events` on the same connection, so it commits or rolls back with the data that produced it. The `UnitOfWork` dispatches to in-process `@EventsHandler`s only *after* the commit, so a handler still never sees a rolled-back write.
- Outside a transaction, `publish` dispatches in-process immediately.
- There is **one** `publish`. Call sites never choose a durability mode — fast-kit's `publish` vs `publish_durable` split makes every call site a chance to silently drop an event that everyone assumes is durable.
- Event name format: `<context>.<aggregate>.<past-tense-verb>` — e.g. `identity.user.registered`.
- Every event extends `shared/domain/DomainEvent`, which carries `version` and `idempotencyKey`.
- Handlers live in `infrastructure/event-handlers/` in the **consuming** context, registered with `@EventsHandler(SomeEvent)`.
- A handler must be idempotent. Assume redelivery.

The `EventBus` port exists — rather than injecting `@nestjs/cqrs`'s `EventBus` directly — because it is the seam where `publishDurable(event, tx)` lands when the outbox arrives. Use cases must not depend on `@nestjs/cqrs`.

### Cross-context communication

A context reads another context's events. It does not import its services, repositories, or entities. The only compile-time coupling permitted between contexts is the published event class and the context's `index.ts`.

### The outbox and the relay

`outbox.events` is written inside the caller's transaction. `OutboxRelay` polls committed rows, publishes to NATS JetStream on `evt.<event.name>`, and marks them published **only after the broker acknowledges persistence**.

- Delivery is **at-least-once**. A crash between publish and mark re-sends, so every message carries `idempotencyKey` and **consumers must be idempotent**.
- `FOR UPDATE SKIP LOCKED` lets multiple API replicas relay concurrently without racing on the same row.
- After `OUTBOX_MAX_ATTEMPTS` failures a row is dead-lettered and skipped. `replayDeadLettered` revives it. Every failed publish is logged, not just the final one.
- A broker outage is not an API outage: events accumulate in the outbox and drain when NATS returns.

Raw SQL in this layer wraps every `UPDATE ... RETURNING` in a CTE ending in a `SELECT`. TypeORM's `query()` returns `[rows, affectedCount]` for update-shaped commands and a plain row array for selects; wrapping keeps the return shape predictable rather than driver-dependent.

### Durable consumers

A reaction is **either** an in-process `@EventsHandler` **or** a `DurableEventHandler`, never both — registering the same work twice double-applies it.

| | `@EventsHandler` | `DurableEventHandler` |
|---|---|---|
| Delivery | in-process, right after commit | JetStream, at-least-once |
| Survives a crash | no | yes |
| Use for | immediate work you can afford to lose | anything durable, slow, or cross-context |

```ts
@Injectable()
export class WelcomeOnUserRegistered extends DurableEventHandler {
  readonly consumerName = 'notification_welcome';   // stable; changing it replays from the start
  readonly subjects = ['identity.user.registered'];

  async handle(event: EventMessage): Promise<void> { ... }
}
```

Declare it in the *consuming* context's `infrastructure/event-handlers/`. It is discovered automatically — no central registry, so a context stays self-contained.

- `handle` runs in a transaction that also writes the `messaging.processed_events` marker. Both commit or both roll back, so a handler that fails after the marker is genuinely retried instead of silently skipped.
- After `DURABLE_MAX_DELIVER` failures the message goes to `messaging.dead_letters` and is terminated — a poison message must not wedge the consumer.
- Valid JSON is not a valid envelope. Anything unrecognised on the subject is terminated, not retried, and never reaches the dead-letter table.
- Consumer configuration is reconciled on boot. `consumers.add` throws on an existing durable whose config differs, so create and update are distinguished; a consumer that still cannot start is logged and skipped rather than taking the API down with it.
- Handlers see `EventMessage` — the wire shape — never a domain class from the producing context, which may be a separate service by then.

---

## 8. Transactions

`UnitOfWork` carries the transactional `EntityManager` in an `AsyncLocalStorage` context. Repositories resolve the manager per call and are unaware of which they got.

```ts
await this.uow.withTransaction(async () => {
  await this.orders.save(order);
  await this.jobs.saveAll(order.jobs);
});
await this.events.publish(new OrderCreated({ orderUuid: order.uuid }));
```

Wrap any use case that performs more than one write. Events are published *inside* the block (§7) — the outbox row is what makes that safe, and the `UnitOfWork` holds in-process dispatch until after the commit.

Nested `withTransaction` calls join the transaction in progress rather than opening a savepoint, and only the outermost call flushes the outbox.

---

## 9. HTTP Conventions

| Concern | Rule |
|---|---|
| Envelope | `ResponseEnvelope<T>` via a global interceptor — fixed external contract, do not rename fields |
| Errors | `AppErrorFilter` — the only error path |
| DTOs | `class-validator` classes in `presentation/http/dto/`. Boundary only — a DTO never reaches `application/` or `domain/` |
| Commands | Plain classes in `application/commands/`. No decorators, no validation |
| Controllers | Decode → build command/query → `commandBus.execute()` → map result. No business logic, no repository access |
| Validation | Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` |
| Swagger | `@ApiTags` on every controller, `@ApiOperation` on every method |
| Documented responses | `@ApiEnvelope(Dto, { status })` and `@ApiFailure(status, 'CODE')` — never bare `@ApiResponse({ type })`. The controller returns the inner DTO but the interceptor sends `{ success, data }`, so a bare type documents a shape that is never sent |
| Documented auth | `@ApiBearerAuth()` per method on a controller that mixes public and protected routes. At class level it would claim a `@Public()` route needs a token |
| Pagination | `Page<T>` from `shared/pagination`; `limit` capped at `MAX_PAGE_SIZE` |
| CORS | Explicit origin allowlist from config. Never `*` with credentials |
| Config | `platform/config` only. Direct `process.env` outside it is a lint error |
| Money / decimals | Never `number`. Use a decimal string end-to-end; TypeORM `numeric` already returns `string` — do not "fix" that with `parseFloat` |

---

## 10. Migrations

TypeORM migrations in `src/database/migrations/`. `synchronize: false` in every environment, including test.

```bash
make migrate-create NAME=CreateUsersTable
make migrate-up
make migrate-status
```

Every table:

```sql
CREATE TABLE <schema>.<name> (
    id          BIGSERIAL PRIMARY KEY,
    uuid        UUID NOT NULL UNIQUE,
    ...
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);
```

Do **not** add an explicit index on `uuid` — the `UNIQUE` constraint already creates a btree, and a second one is pure write and disk overhead, which defeats the reason the split in §5 exists.

Always write `down()`. Use `TIMESTAMPTZ`, never `TIMESTAMP`. One schema per bounded context (`identity.`, `ordering.`) — it makes the extraction cut line visible in the database.

---

## 11. Testing

- Unit tests sit next to the code: `create-order.handler.spec.ts`.
- Use in-memory fakes implementing the port. Never mock the ORM, never spin up `Test.createTestingModule` for a use case — a use case is a plain class, construct it directly:

```ts
const handler = new CreateOrderHandler(new FakeOrderRepository(), new NoopEventBus(), new NoopUnitOfWork());
```

- `Test.createTestingModule` is for controllers and module wiring only.
- Assert on `err.code`, never on message text.
- One test per behaviour, not per function.
- `test/` holds e2e specs against a real Postgres and NATS (`make db-up`), run with `--runInBand` because they share one database.
- Environment overrides for e2e go in `test/setup-e2e.ts`, never at the top of a spec. `ConfigModule.forRoot()` loads and validates the environment when `app.module.ts` is first imported, and imports are evaluated before any statement in the importing file — an override written in a spec is read too late and silently does nothing.
- The JetStream stream is external state that outlives the process. A suite touching it must purge it, the same way it truncates tables.
- `jose` is ESM-only and jest's runtime is CJS, so both jest configs carry `transformIgnorePatterns: ["node_modules/(?!.*jose)"]`. The default pattern skips everything under `node_modules`, and pnpm's `.pnpm/` layout defeats a naive `(?!jose)`.

---

## 12. Quality Gates

```bash
pnpm lint            # eslint --fix
pnpm typecheck       # tsc --noEmit
pnpm check:arch      # asserts domain/ imports no framework, no cross-module reach-in
pnpm test            # jest
make check           # all of the above
make keygen          # generate the ES256 keypair into certs/
```

All must pass before work is considered finished.

---

## 13. Extraction Path

Each context is designed to lift out into its own service:

1. Move `src/modules/<ctx>/` into the new Nest app.
2. Add its own `main.ts` and `app.module.ts`.
3. Swap the `EventBus` provider from the in-process adapter to a `ClientProxy` (`@nestjs/microservices`, NATS transport). `@EventsHandler(X)` becomes `@EventPattern('ctx.aggregate.verb')` — the handler body is unchanged.
4. Distribute `certs/public.pem` so the new service verifies tokens without minting them.
5. `domain/` and `application/` are unchanged. That is the whole point.

What would break this, and is therefore forbidden:

- Importing another context's `domain/`, `application/`, `infrastructure/`, or `presentation/` — only its `index.ts` and its published events.
- A shared `ports/` module.
- Injecting another context's **concrete service or adapter**. Depending on another context's *port*, taken from its public index, is permitted and is how `auth` reads `identity` — at extraction time that port becomes a remote client and the use case is unchanged.
- Cross-context foreign keys or joins added without a plan to denormalize.
- Throwing `@nestjs/common` HTTP exceptions from `application/` or `domain/`.
