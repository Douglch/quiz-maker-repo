// textExtract.js
// Turns an uploaded File into raw text. Dispatch is by file extension via
// the EXTRACTORS table — to support a new format, add one entry there.
//
// PDFs get two chances:
//   1. Fast path: read the embedded text layer with pdf.js.
//   2. Fallback: if that yields (almost) nothing — a scanned or outline-only
//      PDF — render each page to a canvas and OCR it with Tesseract.js.
//
// Design note: we OCR the rendered pages directly rather than converting the
// PDF to another format first. pdf.js can already rasterize pages in the
// browser, so a conversion step would only add an external tool or server —
// which would break the "free, static, GitHub Pages" constraint.

const TextExtract = (function () {

  if (typeof pdfjsLib !== 'undefined') {
    // The worker must be same-origin (browsers refuse cross-origin Workers),
    // hence vendored locally instead of loaded from a CDN.
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
  }

  // A real text layer averages hundreds of chars per page; below this
  // per-page average we assume the PDF is scanned and fall back to OCR.
  const MIN_CHARS_PER_PAGE = 30;

  // Render scale for OCR. 2x ≈ 150–200 DPI: enough detail for Tesseract to
  // read normal body text without making canvases huge and slow.
  const OCR_SCALE = 2;

  function readAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  // ---------------------------------------------------------------- OCR ----

  // The OCR worker is expensive to start (loads a ~4 MB WASM engine plus an
  // ~11 MB language model), so it's created once and reused across files.
  let ocrWorkerPromise = null;

  // Tesseract's progress logger is fixed at worker creation, but we want
  // per-call progress messages — so the fixed logger just forwards to
  // whatever function is currently assigned here.
  let activeLogger = null;

  function getOcrWorker() {
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract.js failed to load, so OCR is unavailable.');
    }
    if (!ocrWorkerPromise) {
      // Paths are made absolute because relative URLs inside a Web Worker
      // resolve against the worker script, not this page. Tesseract appends
      // "/<filename>" itself, so the directory paths must not end in "/".
      const base = new URL('vendor/tesseract/', document.baseURI).href;
      const dir = base.replace(/\/$/, '');
      ocrWorkerPromise = Tesseract.createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: dir,   // engine picks the right tesseract-core-*.wasm.js
        langPath: dir,   // where eng.traineddata.gz lives
        logger: (m) => activeLogger && activeLogger(m),
      });
    }
    return ocrWorkerPromise;
  }

  // Reports "recognizing" progress (0–1) for the current page/image.
  function reportOcrProgress(onProgress, label) {
    activeLogger = (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(`${label} — ${Math.round(m.progress * 100)}%`);
      }
    };
  }

  async function ocrPdf(pdf, onProgress) {
    const worker = await getOcrWorker();
    const canvas = document.createElement('canvas'); // reused for every page
    const ctx = canvas.getContext('2d');
    const pageTexts = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      reportOcrProgress(onProgress, `OCR: page ${pageNum} of ${pdf.numPages}`);
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: OCR_SCALE });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const { data } = await worker.recognize(canvas);
      pageTexts.push(data.text);
    }
    activeLogger = null;
    return pageTexts.join('\n');
  }

  // Direct image upload (photo/screenshot of questions) — pure OCR.
  async function extractImage(file, onProgress) {
    const worker = await getOcrWorker();
    reportOcrProgress(onProgress, `OCR: reading ${file.name}`);
    const { data } = await worker.recognize(file);
    activeLogger = null;
    return data.text;
  }

  // ---------------------------------------------------------------- PDF ----

  // Fast path: pull the embedded (selectable) text out of the PDF.
  async function extractPdfTextLayer(pdf) {
    const lines = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      // pdf.js returns positioned fragments, not lines. Group fragments into
      // visual rows by y-coordinate, then sort each row left-to-right, so
      // the original line structure survives extraction.
      const rows = new Map();
      for (const item of content.items) {
        const y = Math.round(item.transform[5]);
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push(item);
      }

      const sortedY = Array.from(rows.keys()).sort((a, b) => b - a); // top → bottom
      for (const y of sortedY) {
        const rowItems = rows.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
        const lineText = rowItems.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
        if (lineText) lines.push(lineText);
      }
      lines.push(''); // page break
    }
    return lines.join('\n');
  }

  async function extractPdf(file, onProgress) {
    const buffer = await readAsArrayBuffer(file);
    // isEvalSupported: false — never let pdf.js eval() font programs from the
    // document. Mitigates CVE-2024-4367 (arbitrary JS via a crafted font in a
    // malicious PDF), which matters because users upload PDFs from anywhere.
    const pdf = await pdfjsLib.getDocument({ data: buffer, isEvalSupported: false }).promise;

    const text = await extractPdfTextLayer(pdf);
    const meaningfulChars = text.replace(/\s/g, '').length;

    if (meaningfulChars < MIN_CHARS_PER_PAGE * pdf.numPages) {
      // No usable text layer at all: OCR is the only option, run it now.
      if (onProgress) onProgress('No usable text layer — looks scanned. Starting OCR (first run downloads the OCR engine)…');
      return { text: await ocrPdf(pdf, onProgress), runOcr: null };
    }

    // The text layer looks healthy, but it may still parse incompletely
    // (e.g. some questions rendered as images). Hand back a deferred OCR
    // pass so the caller can run it only if parsing leaves gaps.
    return { text, runOcr: (op) => ocrPdf(pdf, op) };
  }

  // -------------------------------------------------------- other types ----

  async function extractDocx(file) {
    if (typeof mammoth === 'undefined') {
      throw new Error('mammoth.js failed to load.');
    }
    const buffer = await readAsArrayBuffer(file);
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value;
  }

  function extractTxt(file) {
    return file.text();
  }

  const EXTRACTORS = {
    pdf: extractPdf,
    docx: extractDocx,
    txt: extractTxt,
    png: extractImage,
    jpg: extractImage,
    jpeg: extractImage,
    webp: extractImage,
    bmp: extractImage,
  };

  function extensionOf(filename) {
    const parts = filename.toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
  }

  // Public entry point. Returns { text, runOcr } where runOcr is either null
  // or an async fallback the caller can invoke for a second, OCR-based pass
  // over the same document (PDFs with a text layer only). onProgress
  // (optional) receives human-readable status strings for slow steps.
  async function extract(file, onProgress) {
    const ext = extensionOf(file.name);
    const extractor = EXTRACTORS[ext];
    if (!extractor) {
      throw new Error(`Unsupported file type ".${ext}". Supported: ${Object.keys(EXTRACTORS).join(', ')}`);
    }
    const result = await extractor(file, onProgress);
    // Most extractors return a plain string; extractPdf returns { text, runOcr }.
    const { text, runOcr } = typeof result === 'string' ? { text: result, runOcr: null } : result;
    if (!text || !text.trim()) {
      throw new Error('No text could be extracted from this file, even with OCR.');
    }
    return { text, runOcr };
  }

  return { extract, supportedExtensions: Object.keys(EXTRACTORS) };
})();
