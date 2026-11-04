import {
  boardSchedule,
  busbarSchedule,
  exportProblems,
  loadSummaries,
  type BoardSchedule,
  type Project,
  SCHEDULE_LEVELS,
  scheduleLevelOf,
  type ElementKind,
  type ScheduleLevel,
} from '@neuromep/shared';
import { useState } from 'react';
import { useApi } from '../../auth/AuthContext';
import { DisciplineTabs, Shell, useNotice } from '../../layout/Shell';
import { Toolbar } from '../../layout/Toolbar';
import { safeFileName, saveBlob } from '../../workspace/fileNames';
import { defaultPf, lengthRule } from '../../workspace/projectDefaults';
import { useCableSize } from '../../workspace/useCableSize';
import { SaveBanner, useProjectToolbar, useWorkspace } from '../../workspace/ProjectWorkspace';
import { scheduleWorkbook } from './scheduleExcel';
import { emptyMeters, missingMeters, ScheduleSheet, type BoardMeters } from './ScheduleSheet';
import '../schematic/schematic.css';

/** Report Library (Figma screen 5); levels by board hierarchy (decision 2 Nov 2026). */
const REPORTS: { key: ScheduleLevel | 'completed' | 'generator'; label: string }[] = [
  { key: 'completed', label: 'Completed Schedule' },
  { key: 'first', label: 'First Level Schedule' },
  { key: 'second', label: 'Second Level Schedule' },
  { key: 'floor', label: 'Floor Level Schedule' },
  { key: 'generator', label: 'Generator Load Analysis' },
];
type ReportKey = (typeof REPORTS)[number]['key'];

/**
 * Schedule Type narrows the ticked levels to one board type. Busbar (riser) schedules go with the
 * First Level - risers are fed from the main panels (Section 14).
 */
const SCHEDULE_TYPES: { label: string; kinds: readonly ElementKind[] | null; busbar: boolean }[] = [
  { label: 'All schedules', kinds: null, busbar: true },
  { label: 'DB Schedule', kinds: ['db'], busbar: false },
  { label: 'SMDB Schedule', kinds: ['smdb', 'esmdb'], busbar: false },
  { label: 'MDB Schedule', kinds: SCHEDULE_LEVELS.first, busbar: false },
  { label: 'Busbar Schedule', kinds: [], busbar: true },
  { label: 'MCC Schedule', kinds: ['mcc', 'emcc'], busbar: false },
];
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Output (Figma screen 5): Report Library, schedule previews from the model, and the inputs the
 * sheet needs before download (logo, planned completion date, kWh meters, type of meter) - asked
 * at every download and not stored (decision 2 Nov 2026). Download (WBS 1.7.2) runs Cable Size
 * first (FR-21), stops on results that are blocked or failing (E3101), then saves one Excel
 * workbook `<project>_Schedules_v<n>.xlsx`, a sheet per board, never overwritten.
 */
export function OutputPage() {
  const { project } = useWorkspace();
  const api = useApi();
  const notice = useNotice();
  const cableSize = useCableSize();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'All' | 'Electrical' | 'Mechanical' | 'PHE'>('All');
  const [reports, setReports] = useState<Set<ReportKey>>(new Set());
  const [typeIndex, setTypeIndex] = useState(0);
  const [logo, setLogo] = useState<string | null>(null);
  const [completionDate, setCompletionDate] = useState('');
  const [meters, setMeters] = useState<Record<string, BoardMeters>>({});
  const toolbar = useProjectToolbar('output', {
    status: () => notice('Floor status (A-08) is shown on Floor Setup.'),
  });
  const toggle = (r: ReportKey) =>
    setReports((s) => {
      const n = new Set(s);
      if (n.has(r)) n.delete(r);
      else n.add(r);
      return n;
    });

  const electrical = tab === 'All' || tab === 'Electrical';
  /** The ticked schedules of a project: boards in building order, then the risers. */
  function schedulesOf(p: Project): BoardSchedule[] {
    if (!electrical) return [];
    const floorOrder = new Map(p.building.floors.map((f, i) => [f.id, i]));
    const type = SCHEDULE_TYPES[typeIndex]!;
    const boards = p.model.elements
      .filter((e) => {
        const level = scheduleLevelOf(e.kind);
        if (!level || (type.kinds && !type.kinds.includes(e.kind))) return false;
        return reports.has('completed') || reports.has(level);
      })
      .sort(
        (a, b) =>
          (floorOrder.get(a.floorId) ?? 0) - (floorOrder.get(b.floorId) ?? 0) ||
          a.tag.localeCompare(b.tag, undefined, { numeric: true }),
      );
    const summaries = loadSummaries(p, defaultPf(p));
    const length = lengthRule(p) ?? { allowancePct: 0, additionM: null };
    const risers =
      type.busbar && (reports.has('completed') || reports.has('first')) ? p.model.risers : [];
    return [
      ...boards.map((b) => boardSchedule(p, b.id, summaries, length)!),
      ...risers.map((r) => busbarSchedule(p, r.id, summaries)!),
    ];
  }
  const schedules = schedulesOf(project);
  const missing = [
    ...(schedules.length && !logo ? ['logo'] : []),
    ...(schedules.length && !completionDate ? ['planned completion date'] : []),
    ...schedules.flatMap((s) => missingMeters(s, meters[s.id])),
  ];
  const canDownload = schedules.length > 0 && missing.length === 0 && !busy;

  async function download() {
    setBusy(true);
    try {
      // Cable Size runs before every export (FR-21), on the whole project.
      const run = await cableSize.run({ kind: 'project' }, 'the whole project');
      if (!run) return;
      const sheets = schedulesOf(run.project);
      const problems = exportProblems(sheets);
      if (problems.length) {
        notice(
          `E3101 Export blocked - ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` and ${problems.length - 3} more` : ''}. Fix them, then download again.`,
        );
        return;
      }
      const { version } = await api.nextExportVersion(project.id, 'schedules');
      const data = await scheduleWorkbook(sheets, {
        logo,
        completionDate,
        client: project.details.clientName,
        meters,
      });
      const name = `${safeFileName(project.details.name) || 'NeuroMEP'}_Schedules_v${version}.xlsx`;
      saveBlob(new Blob([data], { type: XLSX }), name);
      notice(`Downloaded ${name} (${sheets.length} schedule${sheets.length === 1 ? '' : 's'}).`);
    } catch (err) {
      notice(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      tab="output"
      projectId={project.id}
      sidebar={
        <div aria-label="Report Library">
          <p className="sidebar-title">Report Library</p>
          <DisciplineTabs value={tab} onChange={setTab} />
          <ul className="check-list">
            {REPORTS.map((r) => (
              <li key={r.key}>
                <label>
                  {r.label}
                  <input
                    type="checkbox"
                    checked={reports.has(r.key)}
                    onChange={() => toggle(r.key)}
                  />
                </label>
              </li>
            ))}
          </ul>
          <label className="schedule-type">
            Schedule Type:
            <select value={typeIndex} onChange={(e) => setTypeIndex(Number(e.target.value))}>
              {SCHEDULE_TYPES.map((t, i) => (
                <option key={t.label} value={i}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      }
      sidebarFooter={
        <button
          className="btn btn-primary download-btn"
          disabled={!canDownload}
          title={
            canDownload
              ? undefined
              : schedules.length
                ? `Fill in before download: ${missing.slice(0, 4).join('; ')}${missing.length > 4 ? ' …' : ''}`
                : 'Tick a schedule in the Report Library'
          }
          onClick={() => void download()}
        >
          {busy ? 'Preparing…' : 'Download'}
        </button>
      }
      toolbar={
        <Toolbar
          {...toolbar}
          enabled={['open', 'save', 'sync', 'status', 'back', 'next', 'guide']}
        />
      }
    >
      <SaveBanner />
      <section className="panel drawing-area output-area" aria-label="Report preview">
        {reports.has('generator') && (
          <p className="banner banner-info">
            Generator Load Analysis is awaiting its definition by the Senior Electrical Engineer
            (which loads go on the generator, OI-11). It will be the one editable report.
          </p>
        )}
        {!electrical && reports.size > 0 && (
          <p className="muted">
            Phase 1 schedules are electrical; {tab.toLowerCase()} components supply electrical data.
          </p>
        )}
        {electrical && reports.size > 0 && schedules.length === 0 && !reports.has('generator') && (
          <p className="muted">No boards of the ticked levels in this project yet.</p>
        )}
        {schedules.length > 0 && (
          <>
            <form
              className="download-inputs"
              aria-label="Before download"
              onSubmit={(e) => e.preventDefault()}
            >
              <strong>Before download</strong>
              <label className={logo ? undefined : 'missing'}>
                Logo{' '}
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  aria-label="Logo"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => setLogo(String(reader.result));
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              <label className={completionDate ? undefined : 'missing'}>
                Planned completion date{' '}
                <input
                  type="date"
                  aria-label="Planned completion date"
                  value={completionDate}
                  onChange={(e) => setCompletionDate(e.target.value)}
                />
              </label>
              <span className="muted" role="status">
                {missing.length
                  ? `${missing.length} input${missing.length === 1 ? '' : 's'} still needed (highlighted).`
                  : 'Ready to download.'}
              </span>
            </form>
            {schedules.some((s) => s.sizesPending) && (
              <p className="sample-note">
                Breaker, fault duty, size and ECC come from Cable Size; Download runs it first.
              </p>
            )}
            <div className="sheet-stack">
              {schedules.map((s) => (
                <ScheduleSheet
                  key={s.id}
                  schedule={s}
                  meters={meters[s.id] ?? emptyMeters()}
                  onMeters={(m) => setMeters((all) => ({ ...all, [s.id]: m }))}
                  logo={logo}
                  completionDate={completionDate}
                  client={project.details.clientName}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </Shell>
  );
}
