import type { Project, ProjectSummary, UserSummary } from '@neuromep/shared';

/** An API error with a plain-language message for the user. */
/** A legend symbol as served by GET /api/symbols. */
export interface LegendSymbol {
  key: string;
  cmpCode: string | null;
  status: 'draft' | 'approved';
  svg: string;
}

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
  /** A-02: PDFs of the open floor and the previous one, most recently used last. */
  private readonly planFiles = new Map<string, ArrayBuffer>();
  static readonly PLAN_CACHE_SIZE = 2;
  private symbolList: Promise<{ symbols: LegendSymbol[] }> | null = null;

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
    this.planFiles.clear(); // the next user of this browser must not see these plans
    return this.request<void>('/api/auth/sign-out', { method: 'POST' });
  }
  me() {
    return this.request<{ user: UserSummary }>('/api/auth/me');
  }
  /** Legend symbols of the component library (A-11), fetched once. */
  symbols() {
    this.symbolList ??= this.request<{ symbols: LegendSymbol[] }>('/api/symbols').catch((e) => {
      this.symbolList = null; // try again next time
      throw e;
    });
    return this.symbolList;
  }
  users() {
    return this.request<{ users: UserSummary[] }>('/api/users');
  }
  listProjects() {
    return this.request<{ projects: ProjectSummary[] }>('/api/projects');
  }
  /** New project, or an import when a project is passed; `plansToUpload` = plans the file could not carry. */
  /** New project; with `project`, an import; with `copyPlansFrom`, "Save as new project". */
  createProject(project?: Project, copyPlansFrom?: string) {
    return this.request<{ project: Project; plansToUpload: number }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(project ? { project, ...(copyPlansFrom && { copyPlansFrom }) } : {}),
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
  /** Next version of an export (_v1, _v2 ...): export files never overwrite. */
  nextExportVersion(
    projectId: string,
    kind:
      | 'sld'
      | 'schedules'
      | 'schedules-pdf'
      | 'calc-sheet'
      | 'calc-sheet-pdf'
      | 'generator-analysis'
      | 'generator-analysis-pdf',
  ) {
    return this.request<{ version: number }>(
      `/api/projects/${encodeURIComponent(projectId)}/exports`,
      { method: 'POST', body: JSON.stringify({ kind }) },
    );
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
  /**
   * A floor's plan PDF. The open floor and the previous one stay in memory (A-02), so switching
   * between two floors does not download again. Each call returns its own copy, because pdf.js
   * takes ownership of the bytes it reads.
   */
  async downloadPlan(projectId: string, fileId: string): Promise<ArrayBuffer> {
    const key = `${projectId}/${fileId}`;
    let data = this.planFiles.get(key);
    if (data) this.planFiles.delete(key);
    else {
      data = await this.request<ArrayBuffer>(
        `/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(fileId)}`,
      );
    }
    this.planFiles.set(key, data);
    while (this.planFiles.size > ApiClient.PLAN_CACHE_SIZE) {
      this.planFiles.delete(this.planFiles.keys().next().value!);
    }
    return data.slice(0);
  }
}
