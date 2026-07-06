// leaderboard.js
// Records quiz attempts locally ("leaderboard"). Everything lives in
// localStorage — nothing ever leaves this computer. Ranking is highest
// score % first, ties broken by fastest time.

const Leaderboard = (function () {
  const el = (id) => document.getElementById(id);

  const STORE_KEY = 'quiz-maker-records';
  const NAME_KEY = 'quiz-maker-last-name'; // remembered so you type it once
  const MAX_RECORDS = 200;

  let pending = null; // the just-finished attempt, waiting for a name + save

  function loadRecords() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return []; // corrupted storage — start fresh rather than crash
    }
  }

  function saveRecords(records) {
    localStorage.setItem(STORE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
  }

  function ranked(records) {
    return records.slice().sort((a, b) => (b.pct - a.pct) || (a.timeMs - b.timeMs));
  }

  // Called by QuizEngine when a quiz finishes: arm the save form and show
  // the existing records.
  function onQuizFinished({ quizName, score, total, timeMs }) {
    pending = {
      id: Date.now(), // good enough as a unique id for local records
      quiz: quizName || 'Untitled quiz',
      score, total, timeMs,
      pct: Math.round((score / total) * 100),
    };
    el('lb-name').value = localStorage.getItem(NAME_KEY) || '';
    el('lb-save-row').hidden = false;
    el('lb-saved-msg').hidden = true;
    render(null);
  }

  function saveAttempt() {
    if (!pending) return;
    const name = el('lb-name').value.trim() || 'Anonymous';
    localStorage.setItem(NAME_KEY, name);

    const record = { ...pending, name, date: new Date().toISOString() };
    saveRecords(ranked([...loadRecords(), record])); // stored ranked, so the cap keeps the best
    pending = null;

    el('lb-save-row').hidden = true;
    el('lb-saved-msg').hidden = false;
    render(record.id);
  }

  function clearAll() {
    if (!confirm('Delete all saved attempts on this computer?')) return;
    localStorage.removeItem(STORE_KEY);
    render(null);
  }

  // Renders the records table; highlightId marks the freshly saved row.
  function render(highlightId) {
    const container = el('lb-table');
    container.innerHTML = '';
    const records = ranked(loadRecords());

    el('btn-lb-clear').hidden = records.length === 0;
    if (records.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'hint';
      empty.textContent = 'No attempts saved yet — be the first on the board!';
      container.appendChild(empty);
      return;
    }

    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    ['#', 'Name', 'Score', '%', 'Time', 'Quiz', 'Date'].forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      head.appendChild(th);
    });

    const body = table.createTBody();
    records.forEach((r, i) => {
      const row = body.insertRow();
      if (r.id === highlightId) row.className = 'lb-new';
      const cells = [
        `${i + 1}`, r.name, `${r.score}/${r.total}`, `${r.pct}%`,
        QuizEngine.formatTime(r.timeMs), r.quiz,
        new Date(r.date).toLocaleDateString(),
      ];
      cells.forEach((c) => { row.insertCell().textContent = c; });
    });
    container.appendChild(table);
  }

  el('btn-lb-save').addEventListener('click', saveAttempt);
  el('lb-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveAttempt(); });
  el('btn-lb-clear').addEventListener('click', clearAll);

  return { onQuizFinished };
})();
