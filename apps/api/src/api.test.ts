import { completeProject, sequentialIds } from '@neuromep/shared/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { DEV_PASSWORD, DevAuthProvider } from './auth/dev-provider.js';
import { connectMongo, type Database } from './db/mongo.js';
import { GridFsPlanStorage } from './plans/storage.js';
import { ProjectRepository } from './projects/repository.js';

let replSet: MongoMemoryReplSet;
let database: Database;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  database = await connectMongo(replSet.getUri(), 'neuromep-test');
}, 120_000);

afterAll(async () => {
  await database?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  await database.db.dropDatabase();
  const projects = new ProjectRepository(database.client, database.db);
  await projects.init();
  app = createApp({
    auth: new DevAuthProvider('test-secret'),
    projects,
    plans: new GridFsPlanStorage(database.db),
    now: () => '2026-10-22T10:00:00.000Z',
    newId: sequentialIds('proj'),
  });
});

async function tokenFor(email: string) {
  const res = await request(app).post('/api/auth/sign-in').send({ email, password: DEV_PASSWORD });
  return `Bearer ${res.body.token as string}`;
}
const LEAD = 'lead@neuromep.dev';
const ELEC = 'electrical@neuromep.dev';
const MECH = 'mechanical@neuromep.dev';

describe('authentication', () => {
  it('signs in a seeded user', async () => {
    const res = await request(app)
      .post('/api/auth/sign-in')
      .send({ email: LEAD, password: DEV_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: LEAD, role: 'TECHNICAL_LEAD' });
    const me = await request(app)
      .get('/api/auth/me')
      .set('authorization', `Bearer ${res.body.token}`);
    expect(me.body.user.id).toBe('u-lead');
  });

  it('gives the same message for a wrong password and an unknown email', async () => {
    const wrong = await request(app).post('/api/auth/sign-in').send({ email: LEAD, password: 'x' });
    const unknown = await request(app)
      .post('/api/auth/sign-in')
      .send({ email: 'no@x.dev', password: DEV_PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual({ error: 'Email or password is incorrect.' });
    expect(unknown.body).toEqual(wrong.body);
  });

  it('rejects requests without a valid token', async () => {
    expect((await request(app).get('/api/projects')).status).toBe(401);
    const forged = await request(app).get('/api/projects').set('authorization', 'Bearer abc.def');
    expect(forged.status).toBe(401);
  });

  it('rejects expired tokens', async () => {
    let t = 0;
    const auth = new DevAuthProvider('s', () => t);
    const { token } = (await auth.signIn(LEAD, DEV_PASSWORD))!;
    t = 13 * 3600_000;
    expect(await auth.verify(token)).toBeNull();
  });
});

describe('projects', () => {
  it('only the Technical Lead creates projects', async () => {
    const lead = await request(app)
      .post('/api/projects')
      .set('authorization', await tokenFor(LEAD))
      .send({});
    expect(lead.status).toBe(201);
    expect(lead.body.project).toMatchObject({ id: 'proj-1', version: 1, schemaVersion: 1 });
    const elec = await request(app)
      .post('/api/projects')
      .set('authorization', await tokenFor(ELEC))
      .send({});
    expect(elec.status).toBe(403);
  });

  it('saves with optimistic locking and round-trips floors and audit log', async () => {
    const auth = await tokenFor(LEAD);
    const created = (await request(app).post('/api/projects').set('authorization', auth).send({}))
      .body.project;
    const edited = { ...completeProject(), id: created.id, version: created.version };
    edited.auditLog = [
      {
        id: 'a1',
        at: '2026-10-22T09:00:00.000Z',
        userId: 'u-lead',
        area: 'demandFactor',
        key: 'byLoadType.1',
        from: null,
        to: 0.8,
      },
    ];

    const saved = await request(app)
      .put(`/api/projects/${created.id}`)
      .set('authorization', auth)
      .send({ project: edited });
    expect(saved.status).toBe(200);
    expect(saved.body.project.version).toBe(2);

    const loaded = (
      await request(app).get(`/api/projects/${created.id}`).set('authorization', auth)
    ).body.project;
    expect(loaded).toEqual({
      ...edited,
      version: 2,
      meta: { ...edited.meta, updatedAt: '2026-10-22T10:00:00.000Z' },
    });
    expect(await database.db.collection('floors').countDocuments({ projectId: created.id })).toBe(
      5,
    );
    expect(await database.db.collection('auditLog').countDocuments({ projectId: created.id })).toBe(
      1,
    );

    // A second save from the stale version 1 is a conflict and changes nothing.
    const stale = await request(app)
      .put(`/api/projects/${created.id}`)
      .set('authorization', auth)
      .send({ project: { ...edited, details: { ...edited.details, name: 'Other' } } });
    expect(stale.status).toBe(409);
    expect(stale.body.currentVersion).toBe(2);
    const after = (await request(app).get(`/api/projects/${created.id}`).set('authorization', auth))
      .body.project;
    expect(after.details.name).toBe('NeoTower');
  });

  it('removes floors that are no longer in the registry', async () => {
    const auth = await tokenFor(LEAD);
    const created = (await request(app).post('/api/projects').set('authorization', auth).send({}))
      .body.project;
    const p = { ...completeProject(), id: created.id, version: 1 };
    const v2 = (
      await request(app)
        .put(`/api/projects/${p.id}`)
        .set('authorization', auth)
        .send({ project: p })
    ).body.project;
    v2.building.floors = v2.building.floors.slice(0, 2);
    await request(app)
      .put(`/api/projects/${p.id}`)
      .set('authorization', auth)
      .send({ project: v2 });
    expect(await database.db.collection('floors').countDocuments({ projectId: p.id })).toBe(2);
  });

  it('engineers see only projects they are assigned to, and cannot edit Page 1', async () => {
    const lead = await tokenFor(LEAD);
    const a = (await request(app).post('/api/projects').set('authorization', lead).send({})).body
      .project;
    await request(app).post('/api/projects').set('authorization', lead).send({});
    await request(app)
      .put(`/api/projects/${a.id}`)
      .set('authorization', lead)
      .send({
        project: { ...a, disciplines: { electrical: ['u-elec'], mechanical: [], phe: [] } },
      });

    const elec = await tokenFor(ELEC);
    const list = (await request(app).get('/api/projects').set('authorization', elec)).body.projects;
    expect(list.map((p: { id: string }) => p.id)).toEqual([a.id]);
    const put = await request(app)
      .put(`/api/projects/${a.id}`)
      .set('authorization', elec)
      .send({ project: a });
    expect(put.status).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/projects')
          .set('authorization', await tokenFor(MECH))
      ).body.projects,
    ).toEqual([]);
  });

  it('imports a project file as a new project', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('authorization', await tokenFor(LEAD))
      .send({ project: completeProject() });
    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({
      id: 'proj-1',
      version: 1,
      details: { name: 'NeoTower' },
    });
    expect(res.body.project.building.floors).toHaveLength(5);
  });
});

describe('floor-plan PDFs', () => {
  const pdf = Buffer.from('%PDF-1.7\n%test plan\n');

  it('stores a PDF and returns it unchanged; refuses other files', async () => {
    const auth = await tokenFor(LEAD);
    const project = (await request(app).post('/api/projects').set('authorization', auth).send({}))
      .body.project;
    const up = await request(app)
      .post(`/api/projects/${project.id}/plans`)
      .set('authorization', auth)
      .set('content-type', 'application/pdf')
      .set('x-file-name', encodeURIComponent('Ground Floor.pdf'))
      .send(pdf);
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({
      fileName: 'Ground Floor.pdf',
      uploadedAt: '2026-10-22T10:00:00.000Z',
    });

    const down = await request(app)
      .get(`/api/projects/${project.id}/plans/${up.body.fileId}`)
      .set('authorization', auth)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(down.status).toBe(200);
    expect(Buffer.compare(down.body as Buffer, pdf)).toBe(0);

    const other = (await request(app).post('/api/projects').set('authorization', auth).send({}))
      .body.project;
    expect(
      (
        await request(app)
          .get(`/api/projects/${other.id}/plans/${up.body.fileId}`)
          .set('authorization', auth)
      ).status,
    ).toBe(404);

    const notPdf = await request(app)
      .post(`/api/projects/${project.id}/plans`)
      .set('authorization', auth)
      .set('content-type', 'application/pdf')
      .send(Buffer.from('hello'));
    expect(notPdf.status).toBe(400);
  });
});
