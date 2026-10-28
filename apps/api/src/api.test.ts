import { completeProject, sequentialIds } from '@neuromep/shared/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { LoginLimiter } from './auth/attempts.js';
import { ConfigAuthProvider, loadUsersFile } from './auth/config-provider.js';
import { MongoSessionStore } from './auth/sessions.js';
import { DEV_USERS_FILE } from './config.js';
import { connectMongo, type Database } from './db/mongo.js';
import { GridFsPlanStorage } from './plans/storage.js';
import { ProjectRepository } from './projects/repository.js';

const DEV_USERS = loadUsersFile(DEV_USERS_FILE);
const PASSWORD = 'neuromep-dev'; // password of the development user file

let replSet: MongoMemoryReplSet;
let database: Database;
let app: ReturnType<typeof createApp>;
let clock: number;
let clockIso: string;

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
  clock = Date.parse('2026-10-22T10:00:00.000Z');
  clockIso = '2026-10-22T10:00:00.000Z';
  const projects = new ProjectRepository(database.client, database.db);
  await projects.init();
  const sessions = new MongoSessionStore(database.db, () => clock);
  await sessions.init();
  app = createApp({
    auth: new ConfigAuthProvider(DEV_USERS),
    sessions,
    limits: {
      byEmail: new LoginLimiter(5, 15 * 60_000, () => clock),
      byAddress: new LoginLimiter(20, 15 * 60_000, () => clock),
    },
    projects,
    plans: new GridFsPlanStorage(database.db),
    now: () => clockIso,
    newId: sequentialIds('proj'),
  });
});

const signIn = (email: string, password = PASSWORD) =>
  request(app).post('/api/auth/sign-in').send({ email, password });

/** The session cookie (name=value) for a user. */
async function tokenFor(email: string) {
  const res = await signIn(email);
  return cookieOf(res.headers['set-cookie']);
}
function cookieOf(header: string | string[] | undefined) {
  const first = Array.isArray(header) ? header[0] : header;
  return (first ?? '').split(';')[0]!;
}
const LEAD = 'lead@neuromep.dev';
const ELEC = 'electrical@neuromep.dev';
const MECH = 'mechanical@neuromep.dev';

describe('#TASK-01 authentication (WBS 1.2.2)', () => {
  it('signs in a user of the user file with an httpOnly, SameSite=Strict session cookie', async () => {
    const res = await signIn(LEAD);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: expect.objectContaining({ email: LEAD, role: 'TECHNICAL_LEAD' }),
    });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(
      /^neuromep_session=[\w-]{40,}; Path=\/; HttpOnly; SameSite=Strict; Expires=/,
    );
    const me = await request(app)
      .get('/api/auth/me')
      .set('cookie', cookieOf(res.headers['set-cookie']));
    expect(me.body.user.id).toBe('u-lead');
  });

  it('gives the same message for a wrong password and an unknown email', async () => {
    const wrong = await signIn(LEAD, 'x');
    const unknown = await signIn('no@x.dev');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual({ code: 'E0101', error: 'Email or password is incorrect.' });
    expect(unknown.body).toEqual(wrong.body);
  });

  it('rejects requests without a valid session', async () => {
    expect((await request(app).get('/api/projects')).status).toBe(401);
    const forged = await request(app).get('/api/projects').set('cookie', 'neuromep_session=abc');
    expect(forged.status).toBe(401);
    expect(forged.body.code).toBe('E0102');
  });

  it('ends the session after 12 hours and on Sign Out', async () => {
    const cookie = await tokenFor(LEAD);
    clock += 13 * 3600_000;
    expect((await request(app).get('/api/auth/me').set('cookie', cookie)).status).toBe(401);

    const second = await tokenFor(LEAD);
    const out = await request(app).post('/api/auth/sign-out').set('cookie', second);
    expect(out.status).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/^neuromep_session=; .*Max-Age=0/);
    expect((await request(app).get('/api/auth/me').set('cookie', second)).status).toBe(401);
  });

  it('locks an email for 15 minutes after 5 failed sign-ins (E0103)', async () => {
    for (let i = 0; i < 5; i++) expect((await signIn(LEAD, 'wrong')).status).toBe(401);
    const locked = await signIn(LEAD);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('E0103');
    expect((await signIn(ELEC)).status).toBe(200); // other users are not affected
    clock += 15 * 60_000 + 1;
    expect((await signIn(LEAD)).status).toBe(200);
  });
});

describe('projects', () => {
  it('only the Technical Lead creates projects', async () => {
    const lead = await request(app)
      .post('/api/projects')
      .set('cookie', await tokenFor(LEAD))
      .send({});
    expect(lead.status).toBe(201);
    expect(lead.body.project).toMatchObject({ id: 'proj-1', version: 1, schemaVersion: 2 });
    const elec = await request(app)
      .post('/api/projects')
      .set('cookie', await tokenFor(ELEC))
      .send({});
    expect(elec.status).toBe(403);
  });

  it('saves with optimistic locking and round-trips floors and audit log', async () => {
    const auth = await tokenFor(LEAD);
    const created = (await request(app).post('/api/projects').set('cookie', auth).send({})).body
      .project;
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
      .set('cookie', auth)
      .send({ project: edited });
    expect(saved.status).toBe(200);
    expect(saved.body.project.version).toBe(2);

    const loaded = (await request(app).get(`/api/projects/${created.id}`).set('cookie', auth)).body
      .project;
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
      .set('cookie', auth)
      .send({ project: { ...edited, details: { ...edited.details, name: 'Other' } } });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'E0802', currentVersion: 2 });
    const after = (await request(app).get(`/api/projects/${created.id}`).set('cookie', auth)).body
      .project;
    expect(after.details.name).toBe('NeoTower');
  });

  it('removes floors that are no longer in the registry', async () => {
    const auth = await tokenFor(LEAD);
    const created = (await request(app).post('/api/projects').set('cookie', auth).send({})).body
      .project;
    const p = { ...completeProject(), id: created.id, version: 1 };
    const v2 = (
      await request(app).put(`/api/projects/${p.id}`).set('cookie', auth).send({ project: p })
    ).body.project;
    v2.building.floors = v2.building.floors.slice(0, 2);
    await request(app).put(`/api/projects/${p.id}`).set('cookie', auth).send({ project: v2 });
    expect(await database.db.collection('floors').countDocuments({ projectId: p.id })).toBe(2);
  });

  it('engineers see only projects they are assigned to, and cannot edit Page 1', async () => {
    const lead = await tokenFor(LEAD);
    const a = (await request(app).post('/api/projects').set('cookie', lead).send({})).body.project;
    await request(app).post('/api/projects').set('cookie', lead).send({});
    await request(app)
      .put(`/api/projects/${a.id}`)
      .set('cookie', lead)
      .send({
        project: { ...a, disciplines: { electrical: ['u-elec'], mechanical: [], phe: [] } },
      });

    const elec = await tokenFor(ELEC);
    const list = (await request(app).get('/api/projects').set('cookie', elec)).body.projects;
    expect(list.map((p: { id: string }) => p.id)).toEqual([a.id]);
    const put = await request(app)
      .put(`/api/projects/${a.id}`)
      .set('cookie', elec)
      .send({ project: a });
    expect(put.status).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/projects')
          .set('cookie', await tokenFor(MECH))
      ).body.projects,
    ).toEqual([]);
  });

  it('#TASK-02 imports a project file as a new project; floor plans must be uploaded again', async () => {
    const source = completeProject(); // its Ground Floor has a plan
    const res = await request(app)
      .post('/api/projects')
      .set('cookie', await tokenFor(LEAD))
      .send({ project: source });
    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({
      id: 'proj-1',
      version: 1,
      details: { name: 'NeoTower' },
      meta: { createdBy: 'u-lead', lastPage: 'setup' },
    });
    expect(res.body.project.building.floors).toHaveLength(5);
    expect(res.body.plansToUpload).toBe(1);
    expect(res.body.project.building.floors.every((f: { plan: unknown }) => f.plan === null)).toBe(
      true,
    );
  });

  it('#TASK-02 upgrades an older project file on import and refuses a damaged one (E0203)', async () => {
    const lead = await tokenFor(LEAD);
    const v2 = completeProject();
    const { workingDirectory: _w, model: _m, ...rest } = v2;
    const v1 = { ...rest, schemaVersion: 1, meta: { ...v2.meta, lastPage: 'building-modelling' } };
    const upgraded = await request(app)
      .post('/api/projects')
      .set('cookie', lead)
      .send({ project: v1 });
    expect(upgraded.status).toBe(201);
    expect(upgraded.body.project.schemaVersion).toBe(2);
    const damaged = await request(app)
      .post('/api/projects')
      .set('cookie', lead)
      .send({ project: { schemaVersion: 2, details: 'x' } });
    expect(damaged.status).toBe(400);
    expect(damaged.body.code).toBe('E0203');
  });

  it('#TASK-02 lists the most recently modified project first', async () => {
    const lead = await tokenFor(LEAD);
    const first = (await request(app).post('/api/projects').set('cookie', lead).send({})).body
      .project;
    await request(app).post('/api/projects').set('cookie', lead).send({});
    // Saving the first project makes it the most recent.
    clockIso = '2026-10-22T11:00:00.000Z';
    await request(app)
      .put(`/api/projects/${first.id}`)
      .set('cookie', lead)
      .send({ project: { ...first, details: { ...first.details, name: 'Changed' } } });
    const list = (await request(app).get('/api/projects').set('cookie', lead)).body.projects;
    expect(list.map((p: { name: string }) => p.name)).toEqual(['Changed', '']);
  });
});

describe('floor-plan PDFs', () => {
  const pdf = Buffer.from('%PDF-1.7\n%test plan\n');

  it('stores a PDF and returns it unchanged; refuses other files', async () => {
    const auth = await tokenFor(LEAD);
    const project = (await request(app).post('/api/projects').set('cookie', auth).send({})).body
      .project;
    const up = await request(app)
      .post(`/api/projects/${project.id}/plans`)
      .set('cookie', auth)
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
      .set('cookie', auth)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(down.status).toBe(200);
    expect(Buffer.compare(down.body as Buffer, pdf)).toBe(0);

    const other = (await request(app).post('/api/projects').set('cookie', auth).send({})).body
      .project;
    expect(
      (
        await request(app)
          .get(`/api/projects/${other.id}/plans/${up.body.fileId}`)
          .set('cookie', auth)
      ).status,
    ).toBe(404);

    const notPdf = await request(app)
      .post(`/api/projects/${project.id}/plans`)
      .set('cookie', auth)
      .set('content-type', 'application/pdf')
      .send(Buffer.from('hello'));
    expect(notPdf.status).toBe(400);
  });
});

describe('#TASK-08 network model persistence', () => {
  it('stores elements and cables in the elements collection and reads them back in order', async () => {
    const auth = await tokenFor(LEAD);
    const created = (await request(app).post('/api/projects').set('cookie', auth).send({})).body
      .project;
    const base = {
      version: 0,
      description: '',
      floorId: 'f-1',
      location: '',
      discipline: 'electrical',
      ipRating: null,
      fireRated: false,
    };
    const project = {
      ...created,
      model: {
        elements: [
          {
            ...base,
            id: 'tx',
            tag: 'Tx_GF_1',
            kind: 'transformer',
            position: { x: 1, y: 1 },
            kva: 1500,
            primaryV: 11000,
            ukPct: 6.25,
            urPct: 1.2,
            vectorGroup: 'Dyn11',
          },
          { ...base, id: 'ats', tag: 'ATS-1', kind: 'ats', position: { x: 3, y: 1 } },
        ],
        cables: [],
      },
    };
    const saved = await request(app)
      .put(`/api/projects/${created.id}`)
      .set('cookie', auth)
      .send({ project });
    expect(saved.status).toBe(200);
    expect(await database.db.collection('elements').countDocuments({ projectId: created.id })).toBe(
      2,
    );
    const loaded = (await request(app).get(`/api/projects/${created.id}`).set('cookie', auth)).body
      .project;
    expect(loaded.model.elements.map((e: { tag: string }) => e.tag)).toEqual(['Tx_GF_1', 'ATS-1']);
  });
});
