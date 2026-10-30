import type { Floor } from '@neuromep/shared';
import { useRef, useState } from 'react';
import { useApi, useUser } from '../../auth/AuthContext';
import { Modal } from '../../components/fields';
import { useNotice } from '../../layout/Shell';
import { useWorkspace } from '../../workspace/ProjectWorkspace';
import { uploadPlanFile } from '../../workspace/planUpload';

/**
 * Floor plans on Import File (optional): one or many single-page PDFs, matched to the floors in the
 * order chosen, bottom-up (basements, Ground, then upper floors). A review list lets the user change
 * any match before uploading. Plans can still be added per floor with Open on Floor Setup.
 */
export function FloorPlansUpload() {
  const { editor, project } = useWorkspace();
  const api = useApi();
  const user = useUser();
  const notice = useNotice();
  const input = useRef<HTMLInputElement>(null);
  const floors = project.building.floors;
  /** File index per floor id (null = no plan from this upload). */
  const [review, setReview] = useState<{ files: File[]; match: Record<string, number | null> }>();
  const [busy, setBusy] = useState(false);

  function chosen(list: FileList | null) {
    const files = [...(list ?? [])];
    if (files.length === 0) return;
    setReview({
      files,
      match: Object.fromEntries(floors.map((f, i) => [f.id, i < files.length ? i : null])),
    });
  }

  async function upload() {
    if (!review) return;
    setBusy(true);
    const failed: string[] = [];
    for (const floor of floors) {
      const i = review.match[floor.id];
      const file = i == null ? undefined : review.files[i];
      if (!file) continue;
      try {
        const plan = await uploadPlanFile(api, project.id, file, user.id);
        editor.dispatch({
          type: 'planUploaded',
          floorId: floor.id,
          plan,
          now: new Date().toISOString(),
        });
      } catch (e) {
        failed.push(`${floor.name}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
    setReview(undefined);
    notice(failed.length ? `Not uploaded - ${failed.join(' ')}` : 'Floor plans uploaded.');
  }

  const withPlan = floors.filter((f) => f.plan).length;
  return (
    <div className="form-row">
      <span className="form-label">Floor Plans</span>
      <div className="form-control floor-plans">
        <button
          type="button"
          className="btn btn-sm"
          disabled={!editor.canEdit || floors.length === 0 || busy}
          onClick={() => input.current?.click()}
        >
          Upload floor plans (PDF)
        </button>
        <span className="field-hint">
          {floors.length === 0
            ? 'Enter the number of floors first.'
            : `${withPlan} of ${floors.length} floors have a plan. Optional - plans can also be opened per floor on Floor Setup.`}
        </span>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          aria-label="Floor plan files"
          onChange={(e) => {
            chosen(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {review && (
        <Modal
          title="Match floor plans to floors"
          onClose={() => setReview(undefined)}
          actions={
            <>
              <button className="btn" onClick={() => setReview(undefined)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || Object.values(review.match).every((i) => i == null)}
                onClick={() => void upload()}
              >
                {busy ? 'Uploading…' : 'Upload'}
              </button>
            </>
          }
        >
          <p>
            Files are matched in the order chosen, from the lowest floor up. Change any match before
            uploading.
          </p>
          <table className="plan-match">
            <tbody>
              {floors.map((f: Floor) => (
                <tr key={f.id}>
                  <th scope="row">{f.name}</th>
                  <td>
                    <select
                      aria-label={`Plan for ${f.name}`}
                      value={review.match[f.id] ?? ''}
                      onChange={(e) =>
                        setReview({
                          ...review,
                          match: {
                            ...review.match,
                            [f.id]: e.target.value === '' ? null : Number(e.target.value),
                          },
                        })
                      }
                    >
                      <option value="">{f.plan ? 'Keep current plan' : 'No plan'}</option>
                      {review.files.map((file, i) => (
                        <option key={i} value={i}>
                          {file.name}
                        </option>
                      ))}
                    </select>
                    {f.plan && review.match[f.id] != null && (
                      <span className="field-hint"> replaces {f.plan.fileName}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}
