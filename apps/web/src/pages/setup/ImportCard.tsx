import { parseProjectFile, serializeProject, type Project } from '@neuromep/shared';
import { useRef, useState } from 'react';
import { Card, Modal } from '../../components/fields';
import type { CardProps } from './cardProps';

/** File name with design stage and revision (design doc 12.1, Section 14). */
export function exportFileName(p: Project): string {
  const clean = (s: string) =>
    s
      .trim()
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const parts = [
    clean(p.details.name) || 'NeuroMEP_project',
    p.details.designStage ?? '',
    p.details.revision ? `Rev${clean(p.details.revision)}` : '',
  ];
  return `${parts.filter(Boolean).join('_')}.json`;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Card 7 - Import Saved Project (.json), plus export of the current project. */
export function ImportCard({ project, dispatch, readOnly }: CardProps) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ name: string; project: Project } | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const parsed = parseProjectFile(await file.text());
    if (!parsed.ok) setError(parsed.error);
    else setPending({ name: file.name, project: parsed.project });
  }

  return (
    <Card n={7} title="Import Saved Project (.json)">
      <div className="input-group">
        <button className="btn" disabled={readOnly} onClick={() => input.current?.click()}>
          Browse Project File (.json)
        </button>
        <button
          className="btn"
          onClick={() => download(exportFileName(project), serializeProject(project))}
        >
          Export Project (.json)
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {error && (
        <div className="banner banner-error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      {pending && (
        <Modal
          title="Replace this project's set-up?"
          onClose={() => setPending(null)}
          actions={
            <>
              <button className="btn" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  dispatch({ type: 'replaceContent', source: pending.project });
                  setPending(null);
                }}
              >
                Replace with file
              </button>
            </>
          }
        >
          <p>
            Everything on this page, including any unsaved changes, is replaced by the contents of{' '}
            <strong>{pending.name}</strong> ({pending.project.details.name || 'untitled'}).
          </p>
        </Modal>
      )}
    </Card>
  );
}
