import type { Project, ProjectSummary, UserSummary } from '@neuromep/shared';

/** An API error with a plain-language message for the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export type TokenSource = () => string | null;

/** Typed calls to apps/api. */
export class ApiClient {
  constructor(
    private readonly getToken: TokenSource,
    private readonly baseUrl = '',
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.body && typeof init.body === 'string'
            ? { 'content-type': 'application/json' }
            : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new ApiError(
        0,
        'Cannot reach the NeuroMEP server. Check your connection and try again.',
      );
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const message =
        typeof body.error === 'string' ? body.error : `Request failed (${res.status}).`;
      throw new ApiError(res.status, message, body);
    }
    if (res.status === 204) return undefined as T;
    return (res.headers.get('content-type') ?? '').includes('application/json')
      ? ((await res.json()) as T)
      : ((await res.arrayBuffer()) as T);
  }

  signIn(email: string, password: string) {
    return this.request<{ token: string; user: UserSummary }>('/api/auth/sign-in', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
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
  createProject(project?: Project) {
    return this.request<{ project: Project }>('/api/projects', {
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
