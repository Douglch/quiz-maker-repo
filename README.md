# Quiz Maker

Upload a PDF, DOCX, or TXT file of practice questions and take it as a timed,
self-graded multiple-choice quiz — entirely in your browser. No backend, no
build step, free to host on GitHub Pages.

## How it works

1. You upload a file. It's parsed **locally in your browser** — nothing is
   uploaded to a server.
   - **PDF** → text is extracted with [pdf.js](https://mozilla.github.io/pdf.js/).
   - **DOCX** → text is extracted with [mammoth.js](https://github.com/mturnley/mammoth.js).
   - **TXT** → read as-is.
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
3. You pick how many questions and whether to shuffle, then take the quiz.
   Each question is timed overall (a running stopwatch), and submitting an
   answer immediately reveals whether you were right, highlights the correct
   choice(s), and shows any explanation text found near the question.
4. At the end you get a score, total time, and a full review of every
   question with your answer vs. the correct one.

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

## Known limitation: PDFs with no real text layer

Some PDFs — especially ones deliberately exported from "exam dump" sites —
have every character converted to vector outline paths instead of real,
selectable text (a common anti-copy/anti-scraping measure). No text-layer
extractor, including pdf.js, can read text out of a file like that; it would
require OCR (rendering each page to an image and recognizing characters),
which this app does not currently do. If you upload a file like this, you'll
see an error saying no text could be extracted. Workarounds:

- Use the DOCX or a plain-text version of the same content instead, if you have one.
- Copy/paste the questions into a `.txt` file in the format shown above.

## Project structure

```
index.html          Upload / quiz / results screens
styles.css           All styling (light + dark mode)
js/textExtract.js     File → raw text (PDF via pdf.js, DOCX via mammoth, TXT passthrough)
js/quizParser.js       Raw text → structured question objects
js/quizEngine.js       Timer, question rendering, scoring, results/review
js/main.js             Wires the upload screen to the parser and quiz engine
vendor/pdfjs/          Self-hosted pdf.js build + worker (must be same-origin as the page)
vendor/mammoth/        Self-hosted mammoth.js browser build
```

### Adding support for another file type

Add an extractor function to `EXTRACTORS` in `js/textExtract.js` keyed by
file extension — it just needs to return the raw text of the file.
`js/quizParser.js` doesn't need to change, since it works on plain text
regardless of source format.
