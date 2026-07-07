// main.js — wires the upload screen to the extractor/parser and hands off
// to QuizEngine. Also owns the saved-set history, the "parse report"
// dialog, and the manual add-question dialog.

(function () {
  const el = (id) => document.getElementById(id);

  let parsedQuestions = [];
  let parseReport = null;    // { questions, skipped, missing } for the dialog
  let currentQuizName = '';  // set name, shown on the leaderboard
  let currentSetId = null;   // active QuizStore set (for add/rename/delete)
  let isParsing = false;     // one parse at a time — new uploads are blocked meanwhile
  let addQuestionTargetId = null; // set the add-question dialog writes into
  let exportTargetId = null;      // set the export dialog downloads
  let reportFilter = 'all';       // parse report filter: all | parsed | unparsed

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
    // One parse at a time: the status box, summary, and OCR pipeline are all
    // shared, so a second upload mid-parse would clobber the first one's UI.
    if (isParsing) {
      setStatus('⏳ A file is already being parsed — wait for it to finish before uploading another.', true);
      return;
    }
    isParsing = true;
    fileInput.disabled = true;
    dropzone.classList.add('busy');
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

      if (questions.length === 0) {
        setStatus(
          'No questions matched the expected pattern (number, options A-D/H, "Answer:" line).\n' +
          'Check the "How question parsing works" section below for the expected format.',
          true
        );
        return;
      }

      // Persist to history so this set can be re-taken without the file.
      const set = QuizStore.saveSet(file.name, questions);
      activateSet(set, skipped);
      renderHistory();
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message}`, true);
    } finally {
      isParsing = false;
      fileInput.disabled = false;
      dropzone.classList.remove('busy');
    }
  }

  // Makes a set the active quiz source and shows the summary box.
  function activateSet(set, skipped = []) {
    currentSetId = set.id;
    currentQuizName = set.name;
    parsedQuestions = set.questions;
    parseReport = {
      questions: set.questions,
      skipped,
      missing: missingNumbers(set.questions, skipped),
    };
    clearStatus();
    renderSummary(parseReport);
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

  // ---------------------------------------------------- saved set history ----

  function renderHistory() {
    const listBox = el('history-list');
    listBox.innerHTML = '';
    const sets = QuizStore.list();
    el('history-section').hidden = sets.length === 0;

    sets.forEach((set) => {
      const row = document.createElement('div');
      row.className = 'history-item';

      const info = document.createElement('div');
      info.className = 'history-info';
      const name = document.createElement('strong');
      name.textContent = set.name;
      const meta = document.createElement('div');
      meta.className = 'hint';
      meta.textContent = `${set.questions.length} questions · saved ${new Date(set.updatedAt).toLocaleDateString()}`;
      info.append(name, meta);

      const actions = document.createElement('div');
      actions.className = 'history-actions';
      const btn = (label, cls, onClick) => {
        const b = document.createElement('button');
        b.className = `btn ${cls} btn-small`;
        b.textContent = label;
        b.addEventListener('click', onClick);
        actions.appendChild(b);
      };
      btn('Load ▶', 'btn-primary', () => activateSet(QuizStore.get(set.id)));
      btn('➕ Add Q', 'btn-secondary', () => openAddQuestion(set.id, set.name));
      btn('💾 Export', 'btn-secondary', () => openExport(set.id, set.name));
      btn('✏️ Rename', 'btn-secondary', () => {
        const newName = prompt('New name for this question set:', set.name);
        if (!newName || !newName.trim()) return;
        const renamed = QuizStore.rename(set.id, newName);
        if (renamed && set.id === currentSetId) currentQuizName = renamed.name;
        renderHistory();
      });
      btn('🗑 Delete', 'btn-secondary', () => {
        if (!confirm(`Delete "${set.name}" (${set.questions.length} questions)?`)) return;
        QuizStore.remove(set.id);
        if (set.id === currentSetId) {
          // The active set is gone — clear the summary to avoid stale state.
          currentSetId = null;
          parsedQuestions = [];
          summaryBox.hidden = true;
        }
        renderHistory();
      });

      row.append(info, actions);
      listBox.appendChild(row);
    });
  }

  // ------------------------------------------------ add-question dialog ----

  // Opens the add-question form targeting a specific set — from the summary
  // box (the active set) or any saved set's "Add Q" button in the history.
  function openAddQuestion(setId, setName) {
    addQuestionTargetId = setId;
    el('addq-set-name').textContent = setName ? `Adding to: ${setName}` : '';
    el('addq-error').hidden = true;
    el('add-q-dialog').showModal();
  }

  function saveNewQuestion() {
    const fail = (msg) => {
      const box = el('addq-error');
      box.hidden = false;
      box.textContent = msg;
    };

    const text = el('addq-text').value.trim();
    const optionTexts = el('addq-options').value.split('\n')
      .map((t) => t.trim()).filter(Boolean)
      // Tolerate pasted "A. choice" / "b) choice" prefixes — letters are
      // assigned by line position anyway.
      .map((t) => t.replace(/^[A-Ha-h][.)]\s*/, ''));
    const options = optionTexts.map((t, i) => ({
      letter: String.fromCharCode(65 + i),
      text: t,
    }));
    const answer = el('addq-answer').value.split(',')
      .map((s) => s.trim().toUpperCase()).filter(Boolean);
    const explanation = el('addq-explanation').value.trim();

    if (!text) return fail('Question text is required.');
    if (options.length < 2) return fail('At least 2 options are required (one per line).');
    const validLetters = new Set(options.map((o) => o.letter));
    if (answer.length === 0 || !answer.every((a) => validLetters.has(a))) {
      return fail(`Answer must be letter(s) between A and ${options[options.length - 1].letter}, e.g. "B" or "A,C".`);
    }

    const set = QuizStore.addQuestion(addQuestionTargetId, {
      text,
      options,
      answer,
      multiple: answer.length > 1,
      explanation: explanation || null,
    });
    if (!set) return fail('This question set no longer exists — reload or re-upload it first.');

    // Refresh everything that shows question counts. Only re-activate when
    // the question went into the currently active set.
    if (set.id === currentSetId) activateSet(set, parseReport ? parseReport.skipped : []);
    renderHistory();
    el('add-q-dialog').close();
    ['addq-text', 'addq-options', 'addq-answer', 'addq-explanation']
      .forEach((id) => { el(id).value = ''; });
  }

  el('btn-add-question').addEventListener('click', () => openAddQuestion(currentSetId, currentQuizName));
  el('btn-addq-save').addEventListener('click', saveNewQuestion);
  el('btn-close-addq').addEventListener('click', () => el('add-q-dialog').close());

  // ------------------------------------------------ parse report dialog ----

  // Lists every question's fate: parsed (with an OCR badge if the fallback
  // rescued it), skipped (with the reason), or missing entirely. Question
  // text only — options are deliberately not shown. The list can be filtered
  // (all / parsed / not parsed) or shown as two side-by-side columns.

  // One "parsed" or "unparsed" column: heading(s) + item list.
  function buildReportColumn(kind) {
    const { questions, skipped, missing } = parseReport;
    const col = document.createElement('div');
    col.className = 'report-col';

    const section = (title) => {
      const h = document.createElement('h4');
      h.textContent = title;
      col.appendChild(h);
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
      col.appendChild(div);
    };

    if (kind === 'parsed') {
      section(`✅ Parsed (${questions.length})`);
      questions.forEach((q) => {
        item('parsed', `${q.number}.`, q.text, q.recoveredByOcr ? 'OCR' : null);
      });
      if (questions.length === 0) item('', '', 'No questions were parsed.');
    } else {
      section(`⚠️ Skipped (${skipped.length})`);
      skipped.forEach((s) => {
        item('skipped', `${s.number}.`, `${s.questionPreview || '(no text captured)'} — ${s.reason}`);
      });
      if (missing.length) {
        section(`❓ Not detected at all (${missing.length})`);
        item('skipped', '', `Question number(s) ${missing.join(', ')} were never seen by the parser ` +
          '(possibly a non-MCQ item, or unreadable in both the text layer and OCR).');
      }
      if (skipped.length === 0 && missing.length === 0) {
        item('', '', 'Nothing here — every question parsed cleanly. 🎉');
      }
    }
    return col;
  }

  function renderParseReport() {
    const body = el('parse-dialog-body');
    body.innerHTML = '';
    if (!parseReport) return;

    const split = el('report-split').checked;
    el('parse-dialog').classList.toggle('split-mode', split);
    body.classList.toggle('split', split);

    // The filter only applies in single-column mode; split always shows both.
    document.querySelectorAll('#report-filter .chip').forEach((b) => {
      b.disabled = split;
      b.classList.toggle('active', !split && b.dataset.filter === reportFilter);
    });

    if (split || reportFilter !== 'unparsed') body.appendChild(buildReportColumn('parsed'));
    if (split || reportFilter !== 'parsed') body.appendChild(buildReportColumn('unparsed'));
  }

  document.querySelectorAll('#report-filter .chip').forEach((b) => {
    b.addEventListener('click', () => {
      reportFilter = b.dataset.filter;
      renderParseReport();
    });
  });
  el('report-split').addEventListener('change', renderParseReport);

  el('btn-view-questions').addEventListener('click', () => {
    renderParseReport();
    el('parse-dialog').showModal();
  });
  el('btn-close-dialog').addEventListener('click', () => el('parse-dialog').close());

  // ------------------------------------------------------- export dialog ----

  // Plain text mirrors the exact layout QuizParser reads, so an exported
  // .txt file round-trips: it can be re-uploaded and parsed again.
  function exportTxt(set) {
    return set.questions.map((q) => {
      const lines = [`${q.number}. ${q.text}`];
      q.options.forEach((o) => lines.push(`${o.letter}. ${o.text}`));
      lines.push(`Answer: ${q.answer.join(',')}`);
      if (q.explanation) lines.push(`Explanation: ${q.explanation}`);
      return lines.join('\n');
    }).join('\n\n');
  }

  function exportMd(set) {
    const out = [`# ${set.name}`];
    set.questions.forEach((q) => {
      out.push('', `### Question ${q.number}`, '', q.text, '');
      q.options.forEach((o) => out.push(`- **${o.letter}.** ${o.text}`));
      out.push('', `**Answer:** ${q.answer.join(', ')}`);
      if (q.explanation) out.push('', `**Explanation:** ${q.explanation}`);
    });
    return out.join('\n') + '\n';
  }

  const EXPORTERS = {
    md:   { build: exportMd, mime: 'text/markdown' },
    txt:  { build: exportTxt, mime: 'text/plain' },
    json: {
      build: (set) => JSON.stringify({ name: set.name, questions: set.questions }, null, 2),
      mime: 'application/json',
    },
  };

  function openExport(setId, setName) {
    exportTargetId = setId;
    const set = QuizStore.get(setId);
    el('export-set-name').textContent = set
      ? `${setName} — ${set.questions.length} question(s)` : '';
    el('export-dialog').showModal();
  }

  function downloadExport() {
    const set = QuizStore.get(exportTargetId);
    if (!set) return el('export-dialog').close();
    const format = document.querySelector('input[name="export-format"]:checked').value;
    const { build, mime } = EXPORTERS[format];

    // "my quiz.pdf" -> "my quiz.md"; strip characters that break filenames.
    const safeName = set.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '').trim() || 'questions';
    const blob = new Blob([build(set)], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    el('export-dialog').close();
  }

  el('btn-export').addEventListener('click', () => openExport(currentSetId, currentQuizName));
  el('btn-export-save').addEventListener('click', downloadExport);
  el('btn-close-export').addEventListener('click', () => el('export-dialog').close());

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
    currentSetId = null;
    summaryBox.hidden = true;
    clearStatus();
    renderHistory();
    QuizEngine.show('screen-upload');
  });

  renderHistory(); // show saved sets as soon as the page opens
})();
