/**
 * Server-side plan checks (WBS 1.2.7, A-02): the file must be a readable PDF with exactly one
 * page. The browser checks the same before uploading; the server checks again because any client
 * can call the API. pdf.js is loaded on first use (it is large) and only parses the structure.
 */
export type PdfCheck =
  | { ok: true; pages: 1; widthPt: number; heightPt: number }
  | { ok: false; code: 'E0601' | 'E0604'; pages?: number };

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjs: Promise<PdfJs> | null = null;

export async function checkPlanPdf(data: Buffer): Promise<PdfCheck> {
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  const { getDocument } = await pdfjs;
  // pdf.js takes ownership of the bytes it is given, so it reads a copy.
  const task = getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    if (doc.numPages !== 1) return { ok: false, code: 'E0604', pages: doc.numPages };
    const [x0, y0, x1, y1] = (await doc.getPage(1)).view as [number, number, number, number];
    return { ok: true, pages: 1, widthPt: x1 - x0, heightPt: y1 - y0 };
  } catch {
    // Damaged, password-protected or not really a PDF.
    return { ok: false, code: 'E0601' };
  } finally {
    await task.destroy();
  }
}
