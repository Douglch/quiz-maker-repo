# Quiz Maker

Upload a PDF, DOCX, or TXT file of practice questions and take it as a timed,
self-graded multiple-choice quiz — entirely in your browser. No backend, no
build step, free to host on GitHub Pages.

## How it works

1. You upload a file. It's parsed **locally in your browser** — nothing is
   uploaded to a server.
   - **PDF** → text is extracted with [pdf.js](https://mozilla.github.io/pdf.js/).
     If the PDF has no usable text layer (scanned pages, outlined fonts),
     it automatically falls back to OCR — see below.
   - **DOCX** → text is extracted with [mammoth.js](https://github.com/mturnley/mammoth.js).
   - **TXT** → read as-is.
   - **PNG / JPG / WEBP / BMP** → read with OCR
     ([Tesseract.js](https://tesseract.projectnaptha.com/)).
2. The extracted text is scanned for this pattern (the common exam-dump layout):

   ```
   1. Question text, possibly spanning
   multiple lines?
   A. Choice one
   B. Choice two
   C. Choice three
   D. Choice four
   Answer: D
   Explanation: optional free text...
   ```

   - `Answer: A,B,G` (comma-separated) becomes a "select all that apply" checkbox question.
   - Anything that doesn't match this shape (drag-and-drop, hotspot, matching questions)
     is skipped and reported separately rather than silently dropped.
3. If the fast text-layer pass leaves anything behind (skipped items, or
   question numbers missing from the sequence), the app automatically runs
   the OCR pass over the same PDF and merges in any questions it recovers —
   matched by question number, so nothing is duplicated. A **"View parse
   report"** button shows exactly which questions parsed (with an `OCR`
   badge if the fallback rescued them), which were skipped and why, and
   which numbers were never detected at all.
4. Every successfully parsed upload is **saved to history** (browser
   `localStorage`), listed under "Saved question sets" on the upload screen.
   From there you can instantly **Load** a set without the original file,
   **Rename** it, **Delete** it, or **➕ Add question** to hand-write extra
   MCQs (question text, options one-per-line, answer letters, optional
   explanation). Re-uploading a file with the same name updates its existing
   set rather than duplicating it.
5. You pick how many questions and whether to shuffle, then take the quiz.
   Each question is timed overall (a running stopwatch), and submitting an
   answer immediately reveals whether you were right, highlights the correct
   choice(s), and shows any explanation text found near the question.
6. At the end you get a score, total time, and a full review of every
   question with your answer vs. the correct one.
7. You can save each attempt to a **local leaderboard**: enter a name and
   your score, time, quiz file, and date are recorded — ranked by score %
   then speed. Records live in your browser's `localStorage` only (nothing
   is uploaded; "Clear all records" wipes them).

## Running locally

No build step — just serve the folder statically (opening `index.html`
directly via `file://` also mostly works, but a local server avoids some
browser file-access quirks):

```powershell
# any static file server works, e.g.:
npx serve .
# or, PowerShell only, no dependencies:
python -m http.server 8080
```

Then open the printed local URL.

## Deploying to GitHub Pages (free)

1. Push this repo to GitHub.
2. In the repo, go to **Settings → Pages**.
3. Under "Build and deployment", set **Source** to "Deploy from a branch",
   pick the `main` branch and `/ (root)` folder, then save.
4. GitHub will publish the site at `https://<your-username>.github.io/<repo-name>/`
   within a minute or two.

No further configuration needed — `pdf.js` and `mammoth.js` are vendored
locally under `vendor/` (see below), so the whole site is self-contained.

## OCR: PDFs with no real text layer

Some PDFs — especially ones deliberately exported from "exam dump" sites —
have every character converted to vector outline paths instead of real,
selectable text (a common anti-copy/anti-scraping measure), or are simply
scans of paper pages. No text-layer extractor, including pdf.js, can read
text out of files like that.

For these, the app falls back to **OCR, entirely in the browser**: each page
is rendered to a canvas at 2× scale with pdf.js and recognized with
[Tesseract.js](https://tesseract.projectnaptha.com/) (WASM build of the
Tesseract OCR engine). OCR kicks in for two reasons:

- The text layer averages fewer than ~30 characters per page (fully
  scanned/outlined PDF) → OCR replaces the text layer entirely.
- The text layer parsed, but some questions were skipped or missing →
  OCR runs as a *recovery pass* and only fills in the gaps.

**Design decision — why OCR the rendered pages instead of converting the PDF
to another format first?** Any PDF → image/DOCX conversion step would need
either a server or an external tool, breaking the "free, static, GitHub
Pages" constraint. pdf.js can already rasterize pages in the browser, so
rendering + OCR keeps the whole pipeline client-side with zero extra steps
for the user.

Things to know about the OCR path:

- **It's slower** — a few seconds per page; a progress message shows which
  page it's on.
- **First OCR run loads ~15 MB** (WASM engine + English language model,
  both self-hosted under `vendor/tesseract/`); the browser caches them
  afterwards, and the OCR worker is reused across files in the same session.
- **Accuracy depends on scan quality.** Questions that come out garbled
  usually just fail to match the parser pattern and show up as "skipped"
  rather than as wrong quiz content.

## Project structure

```
index.html          Upload / quiz / results screens
styles.css           All styling (light + dark mode)
js/textExtract.js     File → raw text (PDF via pdf.js + OCR fallback, DOCX via mammoth,
                      TXT passthrough, images via Tesseract OCR)
js/quizParser.js       Raw text → structured question objects
js/quizStore.js        Saved question-set history (localStorage): load/rename/delete/add
js/quizEngine.js       Timer, question rendering, scoring, results/review
js/leaderboard.js      Local attempt records (localStorage) + leaderboard table
js/main.js             Upload flow, OCR-recovery merge, parse report dialog
vendor/pdfjs/          Self-hosted pdf.js build + worker (must be same-origin as the page)
vendor/mammoth/        Self-hosted mammoth.js browser build
vendor/tesseract/      Self-hosted Tesseract.js v5 + WASM cores + eng.traineddata.gz
```

### Adding support for another file type

Add an extractor function to `EXTRACTORS` in `js/textExtract.js` keyed by
file extension — it just needs to return the raw text of the file.
`js/quizParser.js` doesn't need to change, since it works on plain text
regardless of source format.
