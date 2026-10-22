import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

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

/** Page 1 size in PDF units (points). Throws if the file is not a readable PDF. */
export async function readFirstPageSize(
  file: Blob,
): Promise<{ widthPt: number; heightPt: number }> {
  const doc = await openPdf(await file.arrayBuffer());
  try {
    const page: PDFPageProxy = await doc.getPage(1);
    const [x0, y0, x1, y1] = page.view as [number, number, number, number];
    return { widthPt: x1 - x0, heightPt: y1 - y0 };
  } finally {
    void doc.loadingTask.destroy();
  }
}
