import type { Project, ProjectSummary, UserSummary } from '@neuromep/shared';

/** An API error with a plain-language message for the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

/** Typed calls to apps/api. The session cookie (httpOnly) goes with every same-origin request. */
export class ApiClient {
  private onUnauthorized: (() => void) | null = null;

  constructor(private readonly baseUrl = '') {}

  /** Called when a request is refused because the session ended (401); returns an unsubscribe. */
  setUnauthorizedHandler(handler: () => void): () => void {
    this.onUnauthorized = handler;
    return () => {
      if (this.onUnauthorized === handler) this.onUnauthorized = null;
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        credentials: 'same-origin',
        headers: {
          ...(init.body && typeof init.body === 'string'
            ? { 'content-type': 'application/json' }
            : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new ApiError(
        0,
        'Cannot reach the NeuroMEP server. Check your connection and try again.',
      );
    }
    if (res.status === 401 && !path.startsWith('/api/auth/')) this.onUnauthorized?.();
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const text = typeof body.error === 'string' ? body.error : `Request failed (${res.status}).`;
      const code = typeof body.code === 'string' ? body.code : null;
      // Plain-language message with its code (design doc Section 6 Usability).
      throw new ApiError(
        res.status,
        code ? `${text.replace(/\.$/, '')} (${code})` : text,
        body,
        code,
      );
    }
    if (res.status === 204) return undefined as T;
    return (res.headers.get('content-type') ?? '').includes('application/json')
      ? ((await res.json()) as T)
      : ((await res.arrayBuffer()) as T);
  }

  signIn(email: string, password: string) {
    return this.request<{ user: UserSummary }>('/api/auth/sign-in', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }
  signOut() {
    return this.request<void>('/api/auth/sign-out', { method: 'POST' });
  }
  me() {
    return this.request<{ user: UserSummary }>('/api/auth/me');
  }
  users() {
    return this.request<{ users: UserSummary[] }>('/api/users');
  }
  listProjects() {
    return this.request<{ projects: ProjectSummary[] }>('/api/projects');
  }
  /** New project, or an import when a project is passed; `plansToUpload` = plans the file could not carry. */
  createProject(project?: Project) {
    return this.request<{ project: Project; plansToUpload: number }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(project ? { project } : {}),
    });
  }
  getProject(id: string) {
    return this.request<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}`);
  }
  saveProject(project: Project) {
    return this.request<{ project: Project }>(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ project }),
    });
  }
  uploadPlan(projectId: string, file: File) {
    return this.request<{ fileId: string; fileName: string; uploadedAt: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/plans`,
      {
        method: 'POST',
        body: file,
        headers: {
          'content-type': 'application/pdf',
          'x-file-name': encodeURIComponent(file.name),
        },
      },
    );
  }
  downloadPlan(projectId: string, fileId: string) {
    return this.request<ArrayBuffer>(
      `/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(fileId)}`,
    );
  }
}
