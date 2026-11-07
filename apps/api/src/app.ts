import { randomUUID } from 'node:crypto';
import {
  canCreateProject,
  canEditFloorPlans,
  canEditProjectSetup,
  canViewProject,
  createEmptyProject,
  migrateProjectData,
  uniqueProjectName,
  outsideEditRights,
  lockedChange,
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
import type { LegendSymbol } from './symbols/catalogue.js';
import { sendError } from './errors.js';
import { EXPORT_KINDS, type ProjectRepository } from './projects/repository.js';

export interface AppDeps {
  auth: AuthProvider;
  sessions: SessionStore;
  /** Secure flag on the session cookie (HTTPS); off in development. */
  secureCookies?: boolean;
  /** Login attempt limits; default 5 failures per email and 20 per address in 15 minutes. */
  limits?: { byEmail: LoginLimiter; byAddress: LoginLimiter };
  projects: ProjectRepository;
  plans: PlanStorage;
  /** Legend symbols of the component library (A-11); none when not given. */
  symbols?: LegendSymbol[];
  now?: () => string;
  newId?: () => string;
}

const SignInBody = z.object({ email: z.string(), password: z.string() });
/** One single-page PDF per floor, at most 20 MB (FR-07, A-02). */
export const MAX_PLAN_BYTES = 20 * 1024 * 1024;
/** JSON bodies: whole projects are large; everything else (sign-in, exports) is small. */
export const MAX_PROJECT_JSON = '20mb';
export const MAX_OTHER_JSON = '100kb';

/** Builds the Express app without listening, so tests can drive it directly. */
export function createApp(deps?: AppDeps): Express {
  const app = express();
  // Security review (WBS 1.8.2): do not name the server software in every reply.
  app.disable('x-powered-by');
  // Only signed-in project saves may send large bodies; a sign-in attempt cannot send 20 MB.
  app.use('/api/projects', express.json({ limit: MAX_PROJECT_JSON }));
  app.use(express.json({ limit: MAX_OTHER_JSON }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'neuromep-api' });
  });

  if (!deps) {
    app.use(errorReply);
    return app;
  }
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
  // ----- component library symbols (A-11, #TASK-11) -----
  app.get('/api/symbols', signedIn, (_req, res) => {
    res.set('cache-control', 'private, max-age=3600');
    res.json({ symbols: deps.symbols ?? [] });
  });

  app.get('/api/users', signedIn, async (_req, res) => {
    res.json({ users: await auth.listUsers() });
  });

  // ----- projects -----
  type Plan = NonNullable<Project['building']['floors'][number]['plan']>;
  const readAll = async (stream: NodeJS.ReadableStream) => {
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
    return Buffer.concat(chunks);
  };
  /** Copies one stored plan file (same id, name and upload details) into another project. */
  const copyFile = async (
    fromId: string,
    toId: string,
    f: { fileId: string; fileName: string },
    by: string,
    at: string,
  ) => {
    const stream = await plans.open(fromId, f.fileId);
    if (!stream) return false;
    await plans.put({
      projectId: toId,
      fileName: f.fileName,
      data: await readAll(stream),
      userId: by,
      now: at,
      fileId: f.fileId,
    });
    return true;
  };
  /** A floor's plan in the new project, or null when its file is not stored in the source. */
  const copyPlan = async (fromId: string, toId: string, plan: Plan): Promise<Plan | null> => {
    if (!(await copyFile(fromId, toId, plan, plan.uploadedBy, plan.uploadedAt))) return null;
    const { replaced: previous, ...rest } = plan;
    const keepPrevious =
      previous && (await copyFile(fromId, toId, previous, plan.uploadedBy, previous.replacedAt));
    return keepPrevious ? plan : rest;
  };

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
      // the import keeps every floor but asks for its plan again (#TASK-02, A-02). "Save as new
      // project" names the project it was opened from: its plan files are copied when this user
      // may open that project (user request 7 Nov 2026).
      const floors = imported.data.building.floors;
      // A copy never takes the name of an existing project: name_duplicated, _duplicated_2 ...
      const names = (await projects.listSummaries(() => true)).map((s) => s.name);
      const name = uniqueProjectName(imported.data.details.name, names);
      const fromId = typeof req.body.copyPlansFrom === 'string' ? req.body.copyPlansFrom : null;
      const from = fromId ? await projects.get(fromId) : null;
      const source = from && canViewProject(user, from) ? from : null;
      const copied = await Promise.all(
        floors.map((f) => (source && f.plan ? copyPlan(source.id, base.id, f.plan) : null)),
      );
      plansToUpload = floors.filter((f, i) => f.plan && !copied[i]).length;
      project = {
        ...imported.data,
        id: base.id,
        version: 0,
        details: { ...imported.data.details, name },
        // Saved as a new project: it opens on the pages already reached.
        meta: source
          ? {
              ...base.meta,
              lastPage: imported.data.meta.lastPage,
              reachedPage: imported.data.meta.reachedPage,
            }
          : base.meta,
        building: {
          ...imported.data.building,
          floors: floors.map((f, i) => ({ ...f, plan: copied[i] ?? null })),
        },
      };
    }
    res.status(201).json({ project: await projects.create(project), plansToUpload });
  });

  // Delete a project (Technical Lead, user request 7 Nov 2026): its data and plan files.
  app.delete('/api/projects/:id', signedIn, async (req, res) => {
    const project = await loadVisible(req, res);
    if (!project) return;
    if (!canCreateProject(currentUser(req))) {
      sendError(res, 403, 'E0202');
      return;
    }
    await projects.remove(project.id);
    await plans.removeProject(project.id);
    res.status(204).end();
  });

  app.get('/api/projects/:id', signedIn, async (req, res) => {
    const project = await loadVisible(req, res);
    if (project) res.json({ project });
  });

  // Export file names never repeat (_v1, _v2): the server hands out the next number.
  app.post('/api/projects/:id/exports', signedIn, async (req, res) => {
    const project = await loadVisible(req, res);
    if (!project) return;
    const kind = z.enum(EXPORT_KINDS).safeParse(req.body?.kind);
    if (!kind.success) {
      sendError(res, 400, 'E0803');
      return;
    }
    const version = await deps.projects.nextExportVersion(
      project.id,
      kind.data,
      currentUser(req).id,
      now(),
    );
    res.json({ version });
  });

  app.put('/api/projects/:id', signedIn, async (req, res) => {
    const user = currentUser(req);
    const stored = await loadVisible(req, res);
    if (!stored) return;
    const parsed = ProjectSchema.safeParse(req.body?.project);
    if (!parsed.success || parsed.data.id !== req.params.id) {
      sendError(res, 400, 'E0803');
      return;
    }
    // Section 2: the Technical Lead changes everything; engineers only their discipline layer.
    if (!canEditProjectSetup(user)) {
      const outside = outsideEditRights(user, stored, parsed.data);
      if (outside === 'Project Set-up' || outside === 'this project') {
        sendError(res, 403, 'E0301');
        return;
      }
      if (outside) {
        sendError(res, 403, 'E1002', { element: outside });
        return;
      }
    }
    // A-08: a floor flagged done stays locked for everyone until the Lead reopens it.
    const locked = lockedChange(stored, parsed.data);
    if (locked) {
      sendError(res, 403, 'E1003', { element: locked });
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
      if (!canEditFloorPlans(user, project)) {
        sendError(res, 403, 'E1002');
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
      const fileName = fileNameOf(req.get('x-file-name'));
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
  app.use(errorReply);

  return app;
}

/** The uploaded file's name (display only; never part of a path), '' -> plan.pdf. */
function fileNameOf(header: string | undefined): string {
  if (!header) return 'plan.pdf';
  try {
    return decodeURIComponent(header).slice(0, 255) || 'plan.pdf';
  } catch {
    return 'plan.pdf'; // malformed %-encoding
  }
}

/**
 * Last error handler (security review, WBS 1.8.2): unreadable bodies get 400 / 413, anything else
 * a plain 500 - always the catalogue JSON, never Express's HTML page or a stack trace. The
 * details go to the server log only (log line format, Section 4).
 */
function errorReply(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.parse.failed' || type === 'entity.too.large') {
    sendError(res, type === 'entity.too.large' ? 413 : 400, 'E3202');
    return;
  }
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(
    `[${new Date().toISOString()}] [error] [#TASK-32] [E3201] ${req.method} ${req.path}: ${message}`,
  );
  sendError(res, 500, 'E3201');
}
