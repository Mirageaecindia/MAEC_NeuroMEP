import { planStatus, type Floor } from '@neuromep/shared';
import { useRef, useState, type DragEvent } from 'react';
import { useApi } from '../../auth/AuthContext';
import { Card, fieldDomId, Modal } from '../../components/fields';
import { readFirstPageSize } from '../../viewer/pdf';
import { PlanViewer } from '../../viewer/PlanViewer';
import type { CardProps } from './cardProps';
import { STATUS_CLASS } from './FloorsCard';

const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

/** Card 6 - Floor Plans & Scale Calibration (FR-07 to FR-09). */
export function PlansCard({ project, dispatch, readOnly, user, errorFor }: CardProps) {
  const api = useApi();
  const floors = [...project.building.floors].reverse(); // top to bottom, as in the registry
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replace, setReplace] = useState<{ floor: Floor; file: File } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string | null>(null);

  const selected =
    floors.find((f) => f.id === selectedId) ??
    floors.find((f) => f.plan) ??
    floors.find((f) => f.type === 'ground') ??
    null;

  function begin(floor: Floor, file: File | undefined) {
    if (!file || readOnly) return;
    setError(null);
    if (!isPdf(file)) {
      setError('Only PDF files are accepted.');
      return;
    }
    if (floor.plan) setReplace({ floor, file });
    else void upload(floor, file);
  }

  async function upload(floor: Floor, file: File) {
    setBusyId(floor.id);
    try {
      let page;
      try {
        page = await readFirstPageSize(file);
      } catch {
        throw new Error(`${file.name} could not be read as a PDF.`);
      }
      const stored = await api.uploadPlan(project.id, file);
      dispatch({
        type: 'planUploaded',
        floorId: floor.id,
        plan: { kind: 'pdf', ...stored, uploadedBy: user.id, page },
        now: new Date().toISOString(),
      });
      setSelectedId(floor.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const onDrop = (floor: Floor) => (e: DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    begin(floor, e.dataTransfer.files[0]);
  };

  return (
    <Card n={6} title="Floor Plans & Scale Calibration" id={fieldDomId('plans')}>
      {errorFor('plans') && <p className="field-error">{errorFor('plans')}</p>}
      {error && (
        <div className="banner banner-error" role="alert" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}
      {floors.length === 0 ? (
        <p className="muted">
          Generate the floor registry (card 4) first, then upload a PDF plan for each floor.
        </p>
      ) : (
        <div className="plans-layout">
          <div>
            <p className="field-hint" style={{ marginTop: 0 }}>
              Select a floor and click Upload, or drop a PDF on its row.
            </p>
            <ul className="plan-list" aria-label="Floor plans">
              {floors.map((f) => {
                const status = planStatus(f);
                return (
                  <li
                    key={f.id}
                    className={`plan-row${selected?.id === f.id ? ' selected' : ''}${dragOver === f.id ? ' drag' : ''}`}
                    onClick={() => setSelectedId(f.id)}
                    onDragOver={(e) => {
                      if (readOnly) return;
                      e.preventDefault();
                      setDragOver(f.id);
                    }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={onDrop(f)}
                  >
                    <div className="plan-row-main">
                      <strong>{f.code}</strong> <span>{f.name}</span>
                      <span className={STATUS_CLASS[status]} style={{ marginLeft: 'auto' }}>
                        {status}
                      </span>
                    </div>
                    <div className="plan-row-sub">
                      <span className="muted plan-file">
                        {f.plan
                          ? `${f.plan.fileName} · ${formatTime(f.plan.uploadedAt)}`
                          : 'No plan uploaded'}
                      </span>
                      {!readOnly && (
                        <button
                          className="btn btn-sm"
                          disabled={busyId !== null}
                          onClick={(e) => {
                            e.stopPropagation();
                            uploadTarget.current = f.id;
                            fileInput.current?.click();
                          }}
                        >
                          {busyId === f.id ? 'Uploading…' : f.plan ? 'Replace' : 'Upload'}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(e) => {
                const floor = project.building.floors.find((f) => f.id === uploadTarget.current);
                if (floor) begin(floor, e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <div className="plans-viewer">
            {selected?.plan ? (
              <PlanViewer
                key={`${selected.id}:${selected.plan.fileId}`}
                projectId={project.id}
                plan={selected.plan}
                floorLabel={`${selected.code} – ${selected.name}`}
                readOnly={readOnly}
                userId={user.id}
                onCalibration={(calibration) =>
                  dispatch({ type: 'calibration', floorId: selected.id, calibration })
                }
              />
            ) : (
              <div className="viewer-placeholder">
                <strong>CAD Blueprint Workspace</strong>
                <span className="muted">
                  {selected
                    ? `No plan for ${selected.code} yet – upload a PDF to view and calibrate it.`
                    : 'Select a floor.'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      {replace && (
        <Modal
          title={`Replace the plan of ${replace.floor.code}?`}
          onClose={() => setReplace(null)}
          actions={
            <>
              <button className="btn" onClick={() => setReplace(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  void upload(replace.floor, replace.file);
                  setReplace(null);
                }}
              >
                Replace plan
              </button>
            </>
          }
        >
          <p>
            {replace.file.name} replaces {replace.floor.plan?.fileName}. The floor becomes{' '}
            <strong>Uncalibrated</strong> and must be calibrated again. Components placed on this
            floor are kept; aligning the new plan to the old one is done in Floor Modelling (FR-09).
          </p>
        </Modal>
      )}
    </Card>
  );
}
