import { randomUUID } from 'node:crypto';
import {
  canCreateProject,
  canEditProjectSetup,
  canViewProject,
  createEmptyProject,
  migrateProjectData,
  ProjectSchema,
  type Project,
} from '@neuromep/shared';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { LoginLimiter } from './auth/attempts.js';
import { currentUser, requireUser, sessionCookie, sessionToken } from './auth/middleware.js';
import type { AuthProvider } from './auth/provider.js';
import type { SessionStore } from './auth/sessions.js';
import { checkPlanPdf } from './plans/pdf-check.js';
import type { PlanStorage } from './plans/storage.js';
import { sendError } from './errors.js';
import type { ProjectRepository } from './projects/repository.js';

export interface AppDeps {
  auth: AuthProvider;
  sessions: SessionStore;
  /** Secure flag on the session cookie (HTTPS); off in development. */
  secureCookies?: boolean;
  /** Login attempt limits; default 5 failures per email and 20 per address in 15 minutes. */
  limits?: { byEmail: LoginLimiter; byAddress: LoginLimiter };
  projects: ProjectRepository;
  plans: PlanStorage;
  now?: () => string;
  newId?: () => string;
}

const SignInBody = z.object({ email: z.string(), password: z.string() });
/** One single-page PDF per floor, at most 20 MB (FR-07, A-02). */
export const MAX_PLAN_BYTES = 20 * 1024 * 1024;

/** Builds the Express app without listening, so tests can drive it directly. */
export function createApp(deps?: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'neuromep-api' });
  });

  if (!deps) return app;
  const { auth, sessions, projects, plans } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? randomUUID;
  const signedIn = requireUser(auth, sessions);
  const secure = deps.secureCookies ?? false;
  const limits = deps.limits ?? {
    byEmail: new LoginLimiter(5, 15 * 60_000),
    byAddress: new LoginLimiter(20, 15 * 60_000),
  };

  // ----- authentication (WBS 1.2.2; OI-28: provider behind an interface) -----
  app.post('/api/auth/sign-in', async (req, res) => {
    const body = SignInBody.safeParse(req.body);
    const emailKey = body.success ? body.data.email.trim().toLowerCase() : '';
    const addressKey = req.ip ?? 'unknown';
    if (limits.byEmail.isLocked(emailKey) || limits.byAddress.isLocked(addressKey)) {
      sendError(res, 429, 'E0103');
      return;
    }
    const user = body.success ? await auth.authenticate(body.data.email, body.data.password) : null;
    if (!user) {
      limits.byEmail.fail(emailKey);
      limits.byAddress.fail(addressKey);
      sendError(res, 401, 'E0101');
      return;
    }
    limits.byEmail.clear(emailKey);
    const { token, expiresAt } = await sessions.create(user.id);
    res.setHeader('set-cookie', sessionCookie(token, expiresAt, secure));
    res.json({ user });
  });
  app.post('/api/auth/sign-out', async (req, res) => {
    const token = sessionToken(req);
    if (token) await sessions.delete(token);
    res.setHeader('set-cookie', sessionCookie('', null, secure));
    res.status(204).end();
  });
  app.get('/api/auth/me', signedIn, (req, res) => {
    res.json({ user: currentUser(req) });
  });
  app.get('/api/users', signedIn, async (_req, res) => {
    res.json({ users: await auth.listUsers() });
  });

  // ----- projects -----
  const loadVisible = async (req: Request, res: Response): Promise<Project | null> => {
    const project = await projects.get(String(req.params.id));
    if (!project || !canViewProject(currentUser(req), project)) {
      sendError(res, 404, 'E0201');
      return null;
    }
    return project;
  };

  app.get('/api/projects', signedIn, async (req, res) => {
    const user = currentUser(req);
    res.json({ projects: await projects.listSummaries((p) => canViewProject(user, p)) });
  });

  /** New Project, or Import Project (.json) when a project is sent (D-13). */
  app.post('/api/projects', signedIn, async (req, res) => {
    const user = currentUser(req);
    if (!canCreateProject(user)) {
      sendError(res, 403, 'E0202');
      return;
    }
    const stamp = now();
    const base = createEmptyProject({ id: newId(), userId: user.id, now: stamp });
    let project = base;
    let plansToUpload = 0;
    if (req.body?.project !== undefined) {
      // Older project files are upgraded first, as on the Import File page.
      const imported = ProjectSchema.safeParse(migrateProjectData(req.body.project));
      if (!imported.success) {
        sendError(res, 400, 'E0203');
        return;
      }
      // Plan PDFs are not inside a project file and stored plans belong to the source project:
      // the import keeps every floor but asks for its plan again (#TASK-02, A-02).
      const floors = imported.data.building.floors;
      plansToUpload = floors.filter((f) => f.plan).length;
      project = {
        ...imported.data,
        id: base.id,
        version: 0,
        meta: base.meta,
        building: { ...imported.data.building, floors: floors.map((f) => ({ ...f, plan: null })) },
      };
    }
    res.status(201).json({ project: await projects.create(project), plansToUpload });
  });

  app.get('/api/projects/:id', signedIn, async (req, res) => {
    const project = await loadVisible(req, res);
    if (project) res.json({ project });
  });

  app.put('/api/projects/:id', signedIn, async (req, res) => {
    const user = currentUser(req);
    if (!(await loadVisible(req, res))) return;
    if (!canEditProjectSetup(user)) {
      sendError(res, 403, 'E0301');
      return;
    }
    const parsed = ProjectSchema.safeParse(req.body?.project);
    if (!parsed.success || parsed.data.id !== req.params.id) {
      sendError(res, 400, 'E0803');
      return;
    }
    const result = await projects.save(parsed.data, now());
    if (result.ok) res.json({ project: result.project });
    else if (result.reason === 'conflict') {
      sendError(res, 409, 'E0802', { currentVersion: result.currentVersion });
    } else sendError(res, 404, 'E0201');
  });

  // ----- floor-plan PDFs (FR-07, #TASK-06) -----
  app.post(
    '/api/projects/:id/plans',
    signedIn,
    express.raw({ type: 'application/pdf', limit: MAX_PLAN_BYTES }),
    async (req, res) => {
      const user = currentUser(req);
      const project = await loadVisible(req, res);
      if (!project) return;
      if (!canEditProjectSetup(user)) {
        sendError(res, 403, 'E0301');
        return;
      }
      const data = req.body as unknown;
      if (!Buffer.isBuffer(data) || data.subarray(0, 5).toString('latin1') !== '%PDF-') {
        sendError(res, 400, 'E0602');
        return;
      }
      const check = await checkPlanPdf(data);
      if (!check.ok) {
        sendError(res, 400, check.code, check.pages ? { pages: check.pages } : {});
        return;
      }
      const fileName = decodeURIComponent(req.get('x-file-name') ?? 'plan.pdf');
      res
        .status(201)
        .json(
          await plans.put({ projectId: project.id, fileName, data, userId: user.id, now: now() }),
        );
    },
  );

  app.get('/api/projects/:id/plans/:fileId', signedIn, async (req, res) => {
    const project = await loadVisible(req, res);
    if (!project) return;
    const stream = await plans.open(project.id, String(req.params.fileId));
    if (!stream) {
      sendError(res, 404, 'E0605');
      return;
    }
    res.type('application/pdf');
    // A file id is never reused for other content, so the browser may keep the file (A-02 cache).
    res.set('cache-control', 'private, max-age=31536000, immutable');
    stream.pipe(res);
  });

  // A plan upload over the size limit is refused by express.raw before the route runs.
  app.use((err: { type?: string }, req: Request, res: Response, next: NextFunction) => {
    if (err?.type === 'entity.too.large' && req.path.endsWith('/plans')) {
      sendError(res, 413, 'E0603');
      return;
    }
    next(err);
  });

  return app;
}
