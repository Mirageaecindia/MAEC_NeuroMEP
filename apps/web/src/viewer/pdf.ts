import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { extractSnapPoints, SnapIndex } from './snap';

/** pdf.js is loaded on first use so it stays out of the main bundle. */
async function pdfjs() {
  const lib = await import('pdfjs-dist');
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = (
      await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    ).default;
  }
  return lib;
}

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  return lib.getDocument({ data: new Uint8Array(data) }).promise;
}

/** Snap targets for calibration: endpoints of the page's vector lines (#TASK-07). */
export async function loadSnapIndex(page: PDFPageProxy): Promise<SnapIndex> {
  const lib = await pdfjs();
  const list = await page.getOperatorList();
  return new SnapIndex(extractSnapPoints(list.fnArray, list.argsArray, lib.OPS));
}

/** Page 1 size in PDF units (points) and the page count. Throws if the file is not a readable PDF. */
export async function readFirstPageSize(
  file: Blob,
): Promise<{ widthPt: number; heightPt: number; pages: number }> {
  const doc = await openPdf(await file.arrayBuffer());
  try {
    const page: PDFPageProxy = await doc.getPage(1);
    const [x0, y0, x1, y1] = page.view as [number, number, number, number];
    return { widthPt: x1 - x0, heightPt: y1 - y0, pages: doc.numPages };
  } finally {
    void doc.loadingTask.destroy();
  }
}
