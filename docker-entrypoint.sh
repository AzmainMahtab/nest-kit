#!/bin/sh
#
# One image, three jobs:
#
#   serve     start the API                                    (default)
#   migrate   apply pending migrations, then exit
#   seed      reconcile roles, permissions and the superadmin, then exit
#
# Anything else is executed verbatim, so `docker compose run --rm api sh` and
# ad-hoc one-offs still work.
#
# migrate and seed are deliberately separate commands rather than steps folded
# into serve. Booting must not write data: on a rolling deploy every replica
# would migrate at once and TypeORM takes no cross-process lock, so they race.
# Keeping them apart also turns a failed migration into a failed pipeline step
# you can see, instead of a crash-looping container.
#
# The intended deploy order is: migrate -> seed -> roll out serve.
set -e

# The two stages differ only in how they run: development has the source, a
# watcher and devDependencies; production has compiled output in dist/ and was
# installed with --prod, so ts-node is not there to fall back on.
is_production() {
  [ "$NODE_ENV" = "production" ]
}

serve() {
  if is_production; then
    exec node dist/main
  fi

  # --debug binds to 127.0.0.1 by default, which is unreachable from the host;
  # 0.0.0.0:9229 is what makes the published debug port usable.
  exec pnpm exec nest start --debug 0.0.0.0:9229 --watch
}

migrate() {
  if is_production; then
    exec node dist/main.migrate
  fi

  exec pnpm run migrate
}

seed() {
  # The relay and the consumers belong to the API. A short-lived seed process
  # starting them would attach JetStream consumers it is about to abandon, and
  # would make seeding depend on NATS being reachable.
  OUTBOX_ENABLED=false
  DURABLE_CONSUMER_ENABLED=false
  export OUTBOX_ENABLED DURABLE_CONSUMER_ENABLED

  if is_production; then
    exec node dist/main.seed
  fi

  exec pnpm run seed
}

case "${1:-serve}" in
  serve) serve ;;
  migrate) migrate ;;
  seed) seed ;;
  *) exec "$@" ;;
esac
