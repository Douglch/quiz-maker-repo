// textExtract.js
// Extracts raw text from an uploaded File, dispatching on file extension.
// Add a new entry to EXTRACTORS to support another file type later.

const TextExtract = (function () {

  if (typeof pdfjsLib !== 'undefined') {
    // Must be same-origin: browsers refuse to construct a Worker from a
    // cross-origin script URL, so the worker is vendored locally rather
    // than loaded from a CDN.
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
  }

  function readAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  async function extractPdf(file) {
    const buffer = await readAsArrayBuffer(file);
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const lines = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      // Group text items into visual rows using their y-coordinate, then
      // sort each row left-to-right, so line structure survives extraction.
      const rows = new Map();
      for (const item of content.items) {
        const y = Math.round(item.transform[5]);
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push(item);
      }

      const sortedY = Array.from(rows.keys()).sort((a, b) => b - a);
      for (const y of sortedY) {
        const rowItems = rows.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
        const lineText = rowItems.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
        if (lineText) lines.push(lineText);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  async function extractDocx(file) {
    if (typeof mammoth === 'undefined') {
      throw new Error('mammoth.js failed to load (check your internet connection).');
    }
    const buffer = await readAsArrayBuffer(file);
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value;
  }

  async function extractTxt(file) {
    return await file.text();
  }

  const EXTRACTORS = {
    pdf: extractPdf,
    docx: extractDocx,
    txt: extractTxt,
  };

  function extensionOf(filename) {
    const parts = filename.toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
  }

  async function extract(file) {
    const ext = extensionOf(file.name);
    const extractor = EXTRACTORS[ext];
    if (!extractor) {
      throw new Error(`Unsupported file type ".${ext}". Supported: ${Object.keys(EXTRACTORS).join(', ')}`);
    }
    const text = await extractor(file);
    if (!text || !text.trim()) {
      throw new Error('No text could be extracted from this file (it may be scanned/image-only).');
    }
    return text;
  }

  return { extract, supportedExtensions: Object.keys(EXTRACTORS) };
})();
