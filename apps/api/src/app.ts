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
      res.status(401).json({ error: 'Email or password is incorrect.' });
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
      res.status(404).json({ error: 'Project not found.' });
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
      res.status(403).json({ error: 'Only the Technical Lead can create projects.' });
      return;
    }
    const stamp = now();
    const base = createEmptyProject({ id: newId(), userId: user.id, now: stamp });
    let project = base;
    if (req.body?.project !== undefined) {
      const imported = ProjectSchema.safeParse(req.body.project);
      if (!imported.success) {
        res.status(400).json({ error: 'The project file is damaged or incomplete.' });
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
      res.status(403).json({ error: 'Only the Technical Lead can change Project Set-up.' });
      return;
    }
    const parsed = ProjectSchema.safeParse(req.body?.project);
    if (!parsed.success || parsed.data.id !== req.params.id) {
      res.status(400).json({ error: 'Invalid project.' });
      return;
    }
    const result = await projects.save(parsed.data, now());
    if (result.ok) res.json({ project: result.project });
    else if (result.reason === 'conflict') {
      res.status(409).json({
        error: 'Someone else saved this project since you opened it. Reload to see their changes.',
        currentVersion: result.currentVersion,
      });
    } else res.status(404).json({ error: 'Project not found.' });
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
        res.status(403).json({ error: 'Only the Technical Lead can upload floor plans.' });
        return;
      }
      const data = req.body as unknown;
      if (!Buffer.isBuffer(data) || data.subarray(0, 5).toString('latin1') !== '%PDF-') {
        res.status(400).json({ error: 'Only PDF files can be uploaded.' });
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
      res.status(404).json({ error: 'Plan file not found.' });
      return;
    }
    res.type('application/pdf');
    stream.pipe(res);
  });

  return app;
}
