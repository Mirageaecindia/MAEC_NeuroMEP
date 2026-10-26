import { randomUUID } from 'node:crypto';
import {
  canCreateProject,
  canEditProjectSetup,
  canViewProject,
  createEmptyProject,
  ProjectSchema,
  type Project,
} from '@neuromep/shared';
import express, { type Express, type Request, type Response } from 'express';
import { z } from 'zod';
import { currentUser, requireUser } from './auth/middleware.js';
import type { AuthProvider } from './auth/provider.js';
import type { PlanStorage } from './plans/storage.js';
import { sendError } from './errors.js';
import type { ProjectRepository } from './projects/repository.js';

export interface AppDeps {
  auth: AuthProvider;
  projects: ProjectRepository;
  plans: PlanStorage;
  now?: () => string;
  newId?: () => string;
}

const SignInBody = z.object({ email: z.string(), password: z.string() });
const MAX_PLAN_BYTES = 200 * 1024 * 1024; // A0 vector plans can be large

/** Builds the Express app without listening, so tests can drive it directly. */
export function createApp(deps?: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'neuromep-api' });
  });

  if (!deps) return app;
  const { auth, projects, plans } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? randomUUID;
  const signedIn = requireUser(auth);

  // ----- authentication (OI-28: provider behind an interface) -----
  app.post('/api/auth/sign-in', async (req, res) => {
    const body = SignInBody.safeParse(req.body);
    const result = body.success ? await auth.signIn(body.data.email, body.data.password) : null;
    if (!result) {
      sendError(res, 401, 'E0101');
      return;
    }
    res.json(result);
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
    if (req.body?.project !== undefined) {
      const imported = ProjectSchema.safeParse(req.body.project);
      if (!imported.success) {
        sendError(res, 400, 'E0203');
        return;
      }
      project = { ...imported.data, id: base.id, version: 0, meta: base.meta };
    }
    res.status(201).json({ project: await projects.create(project) });
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
    stream.pipe(res);
  });

  return app;
}
