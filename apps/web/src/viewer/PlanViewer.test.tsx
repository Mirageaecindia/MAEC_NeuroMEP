import type { Calibration, PdfPlan, UserSummary } from '@neuromep/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { AuthProviderBoundary } from '../auth/AuthContext';
import type { AuthProvider } from '../auth/AuthProvider';
import { PlanViewer } from './PlanViewer';

// pdf.js cannot run in jsdom: the viewer gets an A3-landscape page (1191 x 842 pt) instead.
vi.mock('./pdf', () => {
  const page = {
    view: [0, 0, 1191, 842],
    getViewport: ({ scale }: { scale: number }) => ({
      transform: [scale, 0, 0, -scale, 0, 842 * scale],
      width: 1191 * scale,
      height: 842 * scale,
    }),
    render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
  };
  return {
    openPdf: async () => ({
      getPage: async () => page,
      loadingTask: { destroy: async () => undefined },
    }),
    loadSnapIndex: async () => {
      throw new Error('no snapping in tests');
    },
  };
});

const LEAD: UserSummary = {
  id: 'u-lead',
  name: 'Alex Morgan',
  email: 'lead@neuromep.dev',
  role: 'TECHNICAL_LEAD',
};
const auth: AuthProvider = {
  signIn: async () => LEAD,
  signOut: async () => undefined,
  getCurrentUser: async () => LEAD,
};
const api = {
  downloadPlan: async () => new ArrayBuffer(8),
  setUnauthorizedHandler: () => () => undefined,
} as unknown as ApiClient;

const plan = (calibration: Calibration | null = null): PdfPlan => ({
  kind: 'pdf',
  fileId: 'file-1',
  fileName: 'GF.pdf',
  uploadedAt: '2026-10-28T08:00:00.000Z',
  uploadedBy: 'u-lead',
  page: { widthPt: 1191, heightPt: 842 },
  calibration,
});

const saved: Calibration = {
  method: 'two-point',
  pointA: { x: 100, y: 100 },
  pointB: { x: 400, y: 100 },
  realDistanceM: 6,
  metresPerUnit: 0.02,
  calibratedAt: '2026-10-28T08:00:00.000Z',
  calibratedBy: 'u-lead',
};

function renderViewer(p: PdfPlan, onCalibration = vi.fn()) {
  render(
    <AuthProviderBoundary auth={auth} api={api}>
      <PlanViewer
        projectId="p-1"
        plan={p}
        floorLabel="Ground Floor"
        readOnly={false}
        userId="u-lead"
        onCalibration={onCalibration}
      />
    </AuthProviderBoundary>,
  );
  return onCalibration;
}

const canvasArea = () => document.querySelector('.viewer-canvas') as HTMLElement;
const pageCanvas = () => document.querySelector('canvas.viewer-page') as HTMLCanvasElement;

// jsdom has no layout: give the viewer a 1000 x 700 px area and a ResizeObserver.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 1000,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 700,
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly cb: () => void) {}
      observe() {
        this.cb();
      }
      disconnect() {}
    },
  );
});
afterAll(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  vi.unstubAllGlobals();
});

describe('#TASK-07 plan viewer and calibration (WBS 1.2.8)', () => {
  it('asks to calibrate an uncalibrated plan and saves a two-point calibration', async () => {
    const onCalibration = renderViewer(plan());
    expect(await screen.findByText(/Calibrate this plan/)).toBeInTheDocument();
    await waitFor(() => expect(pageCanvas().style.display).not.toBe('none'));
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 200, clientY: 300 });
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 500, clientY: 300 });
    await userEvent.type(screen.getByLabelText('Real distance A–B (m)'), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Apply calibration' }));
    expect(onCalibration).toHaveBeenCalledOnce();
    const c = onCalibration.mock.calls[0]![0] as Extract<Calibration, { method: 'two-point' }>;
    expect(c).toMatchObject({ method: 'two-point', realDistanceM: 6, calibratedBy: 'u-lead' });
    // Points are stored in PDF units: 300 screen px apart at the fitted zoom.
    const pdfDistance = Math.hypot(c.pointB.x - c.pointA.x, c.pointB.y - c.pointA.y);
    expect(c.metresPerUnit).toBeCloseTo(6 / pdfDistance, 9);
    expect(c.pointA.y).toBeCloseTo(c.pointB.y, 9);
  });

  it('offers the drawing scale instead, marked less reliable', async () => {
    const onCalibration = renderViewer(plan());
    await userEvent.click(
      await screen.findByRole('button', { name: 'Use the drawing scale instead' }),
    );
    expect(screen.getByText('Less reliable')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Sheet'), 'A3');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onCalibration.mock.calls[0]![0]).toMatchObject({
      method: 'drawing-scale',
      scaleDenominator: 100,
      sheetSize: 'A3',
    });
  });

  it('Escape leaves calibration without saving', async () => {
    const onCalibration = renderViewer(plan());
    await screen.findByText(/Calibrate this plan/);
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 200, clientY: 300 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(/Calibrate this plan/)).not.toBeInTheDocument();
    expect(screen.getByText('Uncalibrated')).toBeInTheDocument();
    expect(onCalibration).not.toHaveBeenCalled();
  });

  it('pans with a left-drag on a calibrated plan and shows its scale', async () => {
    renderViewer(plan(saved));
    expect(await screen.findByText('Calibrated')).toBeInTheDocument();
    expect(screen.getByText(/20\.000 mm per PDF unit/)).toBeInTheDocument();
    await waitFor(() => expect(pageCanvas().style.display).not.toBe('none'));
    const before = parseFloat(pageCanvas().style.left);
    fireEvent.mouseDown(canvasArea(), { button: 0, clientX: 500, clientY: 300 });
    fireEvent.mouseMove(canvasArea(), { clientX: 550, clientY: 330 });
    fireEvent.mouseUp(canvasArea());
    expect(parseFloat(pageCanvas().style.left)).toBeCloseTo(before + 50, 6);
    expect(screen.getByText(/Drag to pan/)).toBeInTheDocument();
  });
});
