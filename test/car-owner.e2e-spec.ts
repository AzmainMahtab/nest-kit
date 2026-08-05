import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/platform/http/configure-app';
import { NatsClient, STREAM_NAME } from './../src/platform/messaging';
import { OutboxRelay } from './../src/platform/outbox';

const PASSWORD = 'correct-horse-battery';

interface UserBody {
  uuid: string;
}
interface OwnerBody {
  uuid: string;
  userUuid: string;
  address: string;
  dateOfBirth: string;
  status: string;
}
interface CarBody {
  uuid: string;
  ownerUuid: string;
  licensePlate: string;
  amount: string;
  currency: string;
  status: string;
}
interface ErrorBody {
  success: false;
  error: { code: string; details: { field: string }[] };
}

const ok = <T>(res: { body: unknown }): T => (res.body as { data: T }).data;
const fail = (res: { body: unknown }): ErrorBody => res.body as ErrorBody;

describe('Owner + Car (e2e — requires Postgres, Redis, NATS + `make migrate-up`)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let relay: OutboxRelay;
  let nats: NatsClient;
  let auth: string;

  const http = () => request(app.getHttpServer());

  const registerUser = async (email: string): Promise<string> => {
    const res = await http().post('/api/users').send({ email, password: PASSWORD }).expect(201);
    return ok<UserBody>(res).uuid;
  };

  const registerOwner = async (userUuid: string, address = '12 Cedar Road, Leeds') =>
    ok<OwnerBody>(
      await http()
        .post('/api/owners')
        .set('Authorization', auth)
        .send({ userUuid, address, dateOfBirth: '1990-04-12' })
        .expect(201),
    );

  const registerCar = async (ownerUuid: string, licensePlate: string, amount = '18500.00') =>
    ok<CarBody>(
      await http()
        .post('/api/cars')
        .set('Authorization', auth)
        .send({
          ownerUuid,
          make: 'Toyota',
          model: 'Corolla',
          year: 2021,
          colour: 'silver',
          licensePlate,
          amount,
          currency: 'USD',
        })
        .expect(201),
    );

  const waitFor = async <T>(check: () => Promise<T>, predicate: (v: T) => boolean, ms = 8000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const value = await check();
      if (predicate(value)) return value;
      if (Date.now() > deadline) return value;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  const carsOf = () =>
    dataSource.query<{ uuid: string; status: string }[]>(
      'SELECT uuid, status FROM car.cars ORDER BY id',
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    relay = app.get(OutboxRelay);
    nats = app.get(NatsClient);
  });

  beforeEach(async () => {
    await nats.manager().streams.purge(STREAM_NAME);
    await dataSource.query('TRUNCATE car.cars RESTART IDENTITY');
    await dataSource.query('TRUNCATE owner.owners RESTART IDENTITY');
    await dataSource.query('TRUNCATE identity.users RESTART IDENTITY');
    await dataSource.query('TRUNCATE auth.sessions RESTART IDENTITY');
    await dataSource.query('TRUNCATE outbox.events RESTART IDENTITY');
    await dataSource.query('TRUNCATE messaging.processed_events');
    await dataSource.query('TRUNCATE messaging.dead_letters RESTART IDENTITY');
    await dataSource.query('TRUNCATE notification.notifications RESTART IDENTITY');

    await http()
      .post('/api/users')
      .send({ email: 'operator@example.com', password: PASSWORD })
      .expect(201);
    const login = await http()
      .post('/api/auth/login')
      .send({ email: 'operator@example.com', password: PASSWORD })
      .expect(200);
    auth = `Bearer ${ok<{ accessToken: string }>(login).accessToken}`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('owner', () => {
    it('registers an owner against an existing user', async () => {
      const userUuid = await registerUser('ada@example.com');
      const owner = await registerOwner(userUuid);

      expect(owner.userUuid).toBe(userUuid);
      expect(owner.status).toBe('ACTIVE');
      expect(owner.dateOfBirth).toBe('1990-04-12');
    });

    it('refuses a user that does not exist, without a foreign key', async () => {
      const res = await http()
        .post('/api/owners')
        .set('Authorization', auth)
        .send({
          // Well-formed but unknown. A nil-style uuid would be rejected by
          // @IsUUID() before the handler ever runs, which tests the DTO rather
          // than the cross-context check.
          userUuid: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
          address: '12 Cedar Road',
          dateOfBirth: '1990-04-12',
        })
        .expect(400);

      expect(fail(res).error.code).toBe('USER_NOT_FOUND');
    });

    it('allows only one owner per user', async () => {
      const userUuid = await registerUser('ada@example.com');
      await registerOwner(userUuid);

      const res = await http()
        .post('/api/owners')
        .set('Authorization', auth)
        .send({ userUuid, address: 'somewhere else', dateOfBirth: '1990-04-12' })
        .expect(409);

      expect(fail(res).error.code).toBe('OWNER_ALREADY_REGISTERED');
    });

    it('enforces the minimum age in the domain, not the DTO', async () => {
      const userUuid = await registerUser('ada@example.com');

      const res = await http()
        .post('/api/owners')
        .set('Authorization', auth)
        .send({ userUuid, address: '12 Cedar Road', dateOfBirth: '2015-01-01' })
        .expect(400);

      expect(fail(res).error.details[0]?.field).toBe('dateOfBirth');
    });
  });

  describe('car', () => {
    it('registers a car and keeps the price a decimal string', async () => {
      const owner = await registerOwner(await registerUser('ada@example.com'));
      const car = await registerCar(owner.uuid, 'ab-12 cd', '18500.5');

      // Normalised by the value object, not the DTO.
      expect(car.licensePlate).toBe('AB12CD');
      expect(car.amount).toBe('18500.50');
      expect(typeof car.amount).toBe('string');

      // And it survives the round trip through NUMERIC without becoming a float.
      const fetched = ok<CarBody>(
        await http().get(`/api/cars/${car.uuid}`).set('Authorization', auth).expect(200),
      );
      expect(fetched.amount).toBe('18500.50');
    });

    it('rejects a duplicate plate however it is formatted', async () => {
      const owner = await registerOwner(await registerUser('ada@example.com'));
      await registerCar(owner.uuid, 'AB12CD');

      const res = await http()
        .post('/api/cars')
        .set('Authorization', auth)
        .send({
          ownerUuid: owner.uuid,
          make: 'Honda',
          model: 'Civic',
          year: 2020,
          colour: 'blue',
          licensePlate: 'ab-12-cd',
          amount: '1000.00',
          currency: 'USD',
        })
        .expect(409);

      expect(fail(res).error.code).toBe('PLATE_ALREADY_REGISTERED');
    });

    it('refuses to register against an inactive owner', async () => {
      const owner = await registerOwner(await registerUser('ada@example.com'));
      await http()
        .patch(`/api/owners/${owner.uuid}/deactivate`)
        .set('Authorization', auth)
        .send({ reason: 'test' })
        .expect(200);

      const res = await http()
        .post('/api/cars')
        .set('Authorization', auth)
        .send({
          ownerUuid: owner.uuid,
          make: 'Honda',
          model: 'Civic',
          year: 2020,
          colour: 'blue',
          licensePlate: 'ZZ99ZZ',
          amount: '1000.00',
          currency: 'USD',
        })
        .expect(400);

      expect(fail(res).error.code).toBe('OWNER_NOT_ACCEPTING_CARS');
    });

    it('transfers between owners and refuses a no-op transfer', async () => {
      const first = await registerOwner(await registerUser('ada@example.com'));
      const second = await registerOwner(
        await registerUser('grace@example.com'),
        '9 Oak Lane, York',
      );
      const car = await registerCar(first.uuid, 'AB12CD');

      const moved = ok<CarBody>(
        await http()
          .patch(`/api/cars/${car.uuid}/transfer`)
          .set('Authorization', auth)
          .send({ toOwnerUuid: second.uuid })
          .expect(200),
      );
      expect(moved.ownerUuid).toBe(second.uuid);

      const res = await http()
        .patch(`/api/cars/${car.uuid}/transfer`)
        .set('Authorization', auth)
        .send({ toOwnerUuid: second.uuid })
        .expect(400);
      expect(fail(res).error.code).toBe('SAME_OWNER_TRANSFER');
    });

    it('filters the list by owner', async () => {
      const first = await registerOwner(await registerUser('ada@example.com'));
      const second = await registerOwner(
        await registerUser('grace@example.com'),
        '9 Oak Lane, York',
      );
      await registerCar(first.uuid, 'AA11AA');
      await registerCar(first.uuid, 'BB22BB');
      await registerCar(second.uuid, 'CC33CC');

      const page = ok<{ total: number; items: CarBody[] }>(
        await http()
          .get(`/api/cars?ownerUuid=${first.uuid}`)
          .set('Authorization', auth)
          .expect(200),
      );

      expect(page.total).toBe(2);
      expect(page.items.every((c) => c.ownerUuid === first.uuid)).toBe(true);
    });

    it('refuses to modify a retired car', async () => {
      const owner = await registerOwner(await registerUser('ada@example.com'));
      const car = await registerCar(owner.uuid, 'AB12CD');

      await http()
        .patch(`/api/cars/${car.uuid}/retire`)
        .set('Authorization', auth)
        .send({})
        .expect(200);

      const res = await http()
        .patch(`/api/cars/${car.uuid}/price`)
        .set('Authorization', auth)
        .send({ amount: '1.00', currency: 'USD' })
        .expect(409);
      expect(fail(res).error.code).toBe('CAR_RETIRED');
    });
  });

  describe('cross-context choreography', () => {
    it("retires an owner's cars when the owner is deactivated", async () => {
      const owner = await registerOwner(await registerUser('ada@example.com'));
      await registerCar(owner.uuid, 'AA11AA');
      await registerCar(owner.uuid, 'BB22BB');

      await http()
        .patch(`/api/owners/${owner.uuid}/deactivate`)
        .set('Authorization', auth)
        .send({ reason: 'fraud review' })
        .expect(200);

      await relay.tick();

      const cars = await waitFor(carsOf, (rows) => rows.every((c) => c.status === 'RETIRED'));
      expect(cars).toHaveLength(2);
      expect(cars.map((c) => c.status)).toEqual(['RETIRED', 'RETIRED']);
    });

    it('carries a deletion two hops: identity -> owner -> car', async () => {
      const userUuid = await registerUser('ada@example.com');
      const owner = await registerOwner(userUuid);
      await registerCar(owner.uuid, 'AA11AA');

      // Only identity is touched. Nothing here mentions owner or car.
      await http().delete(`/api/users/${userUuid}`).set('Authorization', auth).expect(204);

      // Hop one: the owner context reacts and publishes its own event.
      await relay.tick();
      const owners = await waitFor(
        () =>
          dataSource.query<{ status: string }[]>(
            'SELECT status FROM owner.owners WHERE uuid = $1',
            [owner.uuid],
          ),
        (rows) => rows[0]?.status === 'INACTIVE',
      );
      expect(owners[0]?.status).toBe('INACTIVE');

      // Hop two: the car context reacts to the owner event.
      await relay.tick();
      const cars = await waitFor(carsOf, (rows) => rows.every((c) => c.status === 'RETIRED'));
      expect(cars).toHaveLength(1);
      expect(cars[0]?.status).toBe('RETIRED');
    }, 30000);

    it('leaves no dead letters behind', async () => {
      const owner = await registerOwner(await registerUser('ada@example.com'));
      await registerCar(owner.uuid, 'AA11AA');
      await http()
        .patch(`/api/owners/${owner.uuid}/deactivate`)
        .set('Authorization', auth)
        .send({})
        .expect(200);

      await relay.tick();
      await waitFor(carsOf, (rows) => rows.every((c) => c.status === 'RETIRED'));

      const dead = await dataSource.query<unknown[]>('SELECT * FROM messaging.dead_letters');
      expect(dead).toHaveLength(0);
    });
  });
});
