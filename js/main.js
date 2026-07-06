// main.js — wires the upload screen to the parser and hands off to QuizEngine.

(function () {
  const el = (id) => document.getElementById(id);

  let parsedQuestions = [];
  let skippedQuestions = [];

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
      const rawText = await TextExtract.extract(file);
      setStatus(`Parsing questions from ${file.name}…`, false);

      const { questions, skipped } = QuizParser.parse(rawText);
      parsedQuestions = questions;
      skippedQuestions = skipped;

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

  fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

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

  el('btn-start').addEventListener('click', () => {
    const limit = Math.max(1, Math.min(parsedQuestions.length, Number(el('opt-limit').value) || parsedQuestions.length));
    QuizEngine.start(parsedQuestions, {
      shuffleQuestions: el('opt-shuffle-q').checked,
      shuffleAnswers: el('opt-shuffle-a').checked,
      limit,
    });
  });

  el('btn-restart-same').addEventListener('click', () => {
    const limit = Math.max(1, Math.min(parsedQuestions.length, Number(el('opt-limit').value) || parsedQuestions.length));
    QuizEngine.start(parsedQuestions, {
      shuffleQuestions: el('opt-shuffle-q').checked,
      shuffleAnswers: el('opt-shuffle-a').checked,
      limit,
    });
  });

  el('btn-restart-new').addEventListener('click', () => {
    fileInput.value = '';
    parsedQuestions = [];
    skippedQuestions = [];
    summaryBox.hidden = true;
    clearStatus();
    QuizEngine.show('screen-upload');
  });
})();
