// main.js — wires the upload screen to the extractor/parser and hands off
// to QuizEngine. Also owns the "parse report" dialog (parsed vs skipped).

(function () {
  const el = (id) => document.getElementById(id);

  let parsedQuestions = [];
  let parseReport = null;    // { questions, skipped, missing } for the dialog
  let currentQuizName = '';  // file name, shown on the leaderboard

  const fileInput = el('file-input');
  const dropzone = el('dropzone');
  const statusBox = el('parse-status');
  const summaryBox = el('parse-summary');

  function setStatus(message, isError) {
    statusBox.hidden = false;
    statusBox.textContent = message;
    statusBox.className = `status${isError ? ' error' : ''}`;
  }

  function clearStatus() {
    statusBox.hidden = true;
    statusBox.textContent = '';
  }

  // ------------------------------------------------- OCR merge helpers ----

  // Question numbers that appear in neither the parsed nor the skipped list —
  // i.e. the parser never even saw them (checked between min and max seen).
  function missingNumbers(questions, skipped) {
    const seen = new Set([...questions, ...skipped].map((q) => Number(q.number)));
    if (seen.size === 0) return [];
    const nums = [...seen];
    const missing = [];
    for (let n = Math.min(...nums); n <= Math.max(...nums); n++) {
      if (!seen.has(n)) missing.push(n);
    }
    return missing;
  }

  // Combines the text-layer parse with an OCR parse: OCR questions fill in
  // numbers the fast path missed, and an item only stays "skipped" if
  // neither pass could read it. Questions are matched by their number.
  function mergeParses(base, ocr) {
    const have = new Set(base.questions.map((q) => Number(q.number)));
    const recovered = ocr.questions.filter((q) => !have.has(Number(q.number)));
    recovered.forEach((q) => { q.recoveredByOcr = true; });

    const questions = base.questions.concat(recovered)
      .sort((a, b) => Number(a.number) - Number(b.number));

    const finalNumbers = new Set(questions.map((q) => Number(q.number)));
    const skipped = [];
    const seen = new Set();
    for (const s of [...base.skipped, ...ocr.skipped]) {
      const n = Number(s.number);
      if (finalNumbers.has(n) || seen.has(n)) continue;
      seen.add(n);
      skipped.push(s);
    }
    return { questions, skipped };
  }

  // --------------------------------------------------------- main flow ----

  async function handleFile(file) {
    if (!file) return;
    summaryBox.hidden = true;
    const progress = (msg) => setStatus(msg, false);
    progress(`Reading ${file.name}…`);

    try {
      const { text, runOcr } = await TextExtract.extract(file, progress);
      progress(`Parsing questions from ${file.name}…`);
      let { questions, skipped } = QuizParser.parse(text);

      // Fast path incomplete? Run the deferred OCR pass over the whole
      // document and merge in whatever it can recover.
      const needsOcr = questions.length === 0 || skipped.length > 0 ||
        missingNumbers(questions, skipped).length > 0;
      if (runOcr && needsOcr) {
        progress(`${questions.length} parsed, ${skipped.length} skipped — trying OCR to recover the rest…`);
        try {
          const ocrText = await runOcr(progress);
          ({ questions, skipped } = mergeParses({ questions, skipped }, QuizParser.parse(ocrText)));
        } catch (err) {
          console.error('OCR recovery failed; keeping fast-path results.', err);
        }
      }

      parsedQuestions = questions;
      parseReport = { questions, skipped, missing: missingNumbers(questions, skipped) };
      currentQuizName = file.name;

      if (questions.length === 0) {
        setStatus(
          'No questions matched the expected pattern (number, options A-D/H, "Answer:" line).\n' +
          'Check the "How question parsing works" section below for the expected format.',
          true
        );
        return;
      }

      clearStatus();
      renderSummary(parseReport);
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message}`, true);
    }
  }

  function renderSummary({ questions, skipped, missing }) {
    el('summary-count').textContent = questions.length;

    const recovered = questions.filter((q) => q.recoveredByOcr).length;
    const parts = [];
    if (recovered) parts.push(`${recovered} recovered via OCR`);
    if (skipped.length) parts.push(`${skipped.length} skipped (didn't match the MCQ pattern)`);
    if (missing.length) parts.push(`${missing.length} question number(s) not found at all`);
    el('summary-detail').textContent = parts.join(' · ');

    el('opt-limit').max = String(questions.length);
    el('opt-limit').value = String(questions.length);
    el('opt-limit-max').textContent = `of ${questions.length} available`;
    summaryBox.hidden = false;
  }

  // ------------------------------------------------ parse report dialog ----

  // Lists every question's fate: parsed (with an OCR badge if the fallback
  // rescued it), skipped (with the reason), or missing entirely. Question
  // text only — options are deliberately not shown.
  function renderParseReport() {
    const body = el('parse-dialog-body');
    body.innerHTML = '';
    if (!parseReport) return;
    const { questions, skipped, missing } = parseReport;

    const section = (title) => {
      const h = document.createElement('h4');
      h.textContent = title;
      body.appendChild(h);
    };
    const item = (cls, label, text, badge) => {
      const div = document.createElement('div');
      div.className = `report-item ${cls}`;
      const strong = document.createElement('strong');
      strong.textContent = label + ' ';
      div.appendChild(strong);
      if (badge) {
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = badge;
        div.appendChild(b);
        div.appendChild(document.createTextNode(' '));
      }
      div.appendChild(document.createTextNode(text));
      body.appendChild(div);
    };

    section(`✅ Parsed (${questions.length})`);
    questions.forEach((q) => {
      item('parsed', `${q.number}.`, q.text, q.recoveredByOcr ? 'OCR' : null);
    });

    if (skipped.length) {
      section(`⚠️ Skipped (${skipped.length})`);
      skipped.forEach((s) => {
        item('skipped', `${s.number}.`, `${s.questionPreview || '(no text captured)'} — ${s.reason}`);
      });
    }
    if (missing.length) {
      section(`❓ Not detected at all (${missing.length})`);
      item('skipped', '', `Question number(s) ${missing.join(', ')} were never seen by the parser ` +
        '(possibly a non-MCQ item, or unreadable in both the text layer and OCR).');
    }
  }

  el('btn-view-questions').addEventListener('click', () => {
    renderParseReport();
    el('parse-dialog').showModal();
  });
  el('btn-close-dialog').addEventListener('click', () => el('parse-dialog').close());

  // ------------------------------------------------------ quiz controls ----

  // Reads the current option controls and starts (or restarts) the quiz.
  function startQuiz() {
    const limit = Math.max(1, Math.min(parsedQuestions.length,
      Number(el('opt-limit').value) || parsedQuestions.length));
    QuizEngine.start(parsedQuestions, {
      shuffleQuestions: el('opt-shuffle-q').checked,
      shuffleAnswers: el('opt-shuffle-a').checked,
      limit,
      quizName: currentQuizName,
    });
  }

  fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

  // Drag & drop is just a second way to feed handleFile.
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) {
      fileInput.files = e.dataTransfer.files;
      handleFile(file);
    }
  });

  el('btn-start').addEventListener('click', startQuiz);
  el('btn-restart-same').addEventListener('click', startQuiz);

  el('btn-restart-new').addEventListener('click', () => {
    fileInput.value = '';
    parsedQuestions = [];
    parseReport = null;
    summaryBox.hidden = true;
    clearStatus();
    QuizEngine.show('screen-upload');
  });
})();
