// main.js — wires the upload screen to the extractor/parser and hands off
// to QuizEngine. All state here is just "the questions from the last file".

(function () {
  const el = (id) => document.getElementById(id);

  let parsedQuestions = [];

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

  async function handleFile(file) {
    if (!file) return;
    summaryBox.hidden = true;
    setStatus(`Reading ${file.name}…`, false);

    try {
      // Extraction can be slow (OCR of a scanned PDF takes seconds per
      // page), so it reports progress back into the status box.
      const rawText = await TextExtract.extract(file, (msg) => setStatus(msg, false));
      setStatus(`Parsing questions from ${file.name}…`, false);

      const { questions, skipped } = QuizParser.parse(rawText);
      parsedQuestions = questions;

      if (questions.length === 0) {
        setStatus(
          'No questions matched the expected pattern (number, options A-D/H, "Answer:" line).\n' +
          'Check the "How question parsing works" section below for the expected format.',
          true
        );
        return;
      }

      clearStatus();
      el('summary-count').textContent = questions.length;
      el('summary-skipped').textContent = skipped.length
        ? `${skipped.length} item(s) skipped (didn't match the MCQ pattern — e.g. hotspot/drag-drop questions).`
        : '';
      el('opt-limit').max = String(questions.length);
      el('opt-limit').value = String(questions.length);
      el('opt-limit-max').textContent = `of ${questions.length} available`;
      summaryBox.hidden = false;
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message}`, true);
    }
  }

  // Reads the current option controls and starts (or restarts) the quiz.
  function startQuiz() {
    const limit = Math.max(1, Math.min(parsedQuestions.length,
      Number(el('opt-limit').value) || parsedQuestions.length));
    QuizEngine.start(parsedQuestions, {
      shuffleQuestions: el('opt-shuffle-q').checked,
      shuffleAnswers: el('opt-shuffle-a').checked,
      limit,
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
    summaryBox.hidden = true;
    clearStatus();
    QuizEngine.show('screen-upload');
  });
})();
