import type { PdfPlan } from '@neuromep/shared';
import type { ApiClient } from '../api/client';
import { readFirstPageSize } from '../viewer/pdf';

const MAX_PLAN_BYTES = 20 * 1024 * 1024; // A-02

export const isPdf = (file: File) =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

/**
 * Checks a floor-plan PDF in the browser (E0601-E0604, A-02) and stores it on the server.
 * Returns the floor's new plan; throws with the engineer-facing message.
 */
export async function uploadPlanFile(
  api: ApiClient,
  projectId: string,
  file: File,
  userId: string,
): Promise<Omit<PdfPlan, 'calibration' | 'replaced'>> {
  if (!isPdf(file)) throw new Error('Only PDF files can be uploaded (E0602).');
  if (file.size > MAX_PLAN_BYTES) throw new Error('The plan is larger than 20 MB (E0603).');
  let info;
  try {
    info = await readFirstPageSize(file);
  } catch {
    throw new Error('Floor plan could not be opened (E0601).');
  }
  if (info.pages !== 1) throw new Error('The plan has more than one page (E0604).');
  const stored = await api.uploadPlan(projectId, file);
  return {
    kind: 'pdf',
    ...stored,
    uploadedBy: userId,
    page: { widthPt: info.widthPt, heightPt: info.heightPt },
  };
}
