// quizEngine.js
// Drives the quiz screen: timer, question rendering, per-answer feedback,
// scoring, and the final results/review screen.

const QuizEngine = (function () {

  const el = (id) => document.getElementById(id);

  let state = null; // { questions, currentIndex, answers, startTime, timerHandle }

  // Fisher–Yates shuffle on a copy (never mutates the input).
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  // "B. Some choice text" — used for feedback and the review screen.
  const optionLabel = (o) => `${o.letter}. ${o.text}`;

  // Converts parser output (letter-keyed answers) into the engine's shape
  // (per-option `correct` flags), applying shuffle/limit options. Marking
  // correctness on each option means shuffling can't break the answer key.
  function buildQuizQuestions(parsedQuestions, opts) {
    let pool = parsedQuestions.map((q) => ({
      number: q.number,
      text: q.text,
      explanation: q.explanation,
      multiple: q.multiple,
      options: q.options.map((o) => ({ text: o.text, correct: q.answer.includes(o.letter) })),
    }));

    if (opts.shuffleQuestions) pool = shuffle(pool);
    if (opts.limit && opts.limit > 0) pool = pool.slice(0, opts.limit);

    // Re-letter options A, B, C… in their final (possibly shuffled) order.
    for (const q of pool) {
      if (opts.shuffleAnswers) q.options = shuffle(q.options);
      q.options.forEach((o, i) => { o.letter = String.fromCharCode(65 + i); });
    }
    return pool;
  }

  function start(parsedQuestions, opts) {
    const questions = buildQuizQuestions(parsedQuestions, opts);
    state = {
      questions,
      quizName: opts.quizName || '',
      currentIndex: 0,
      answers: new Array(questions.length).fill(null),
      startTime: Date.now(),
      timerHandle: null,
    };

    show('screen-quiz');
    state.timerHandle = setInterval(updateTimer, 250);
    updateTimer();
    renderQuestion();
  }

  function show(screenId) {
    ['screen-upload', 'screen-quiz', 'screen-results'].forEach((id) => {
      el(id).hidden = id !== screenId;
    });
  }

  function updateTimer() {
    el('quiz-timer').textContent = formatTime(Date.now() - state.startTime);
  }

  function optionInputs() {
    return Array.from(el('options-form').querySelectorAll('input'));
  }

  function optionLabels() {
    return Array.from(el('options-form').querySelectorAll('label.option'));
  }

  function renderQuestion() {
    const { questions, currentIndex } = state;
    const q = questions[currentIndex];
    const total = questions.length;

    el('quiz-progress').textContent = `Question ${currentIndex + 1} of ${total}`;
    el('progress-bar-fill').style.width = `${(currentIndex / total) * 100}%`;
    el('question-text').textContent = `${currentIndex + 1}. ${q.text}`;

    const multiHint = el('multi-hint');
    multiHint.hidden = !q.multiple;
    if (q.multiple) {
      const correctCount = q.options.filter((o) => o.correct).length;
      multiHint.textContent = `Select all that apply (${correctCount} correct answers)`;
    }

    // Build one <label><input><span> row per option. Checkboxes for
    // multi-answer questions, radios otherwise.
    const form = el('options-form');
    form.innerHTML = '';
    q.options.forEach((opt, i) => {
      const label = document.createElement('label');
      label.className = 'option';
      const input = document.createElement('input');
      input.type = q.multiple ? 'checkbox' : 'radio';
      input.name = 'quiz-option';
      input.value = String(i);
      input.addEventListener('change', updateSubmitEnabled);
      const span = document.createElement('span');
      span.textContent = optionLabel(opt);
      label.append(input, span);
      form.appendChild(label);
    });

    el('feedback').hidden = true;
    el('feedback').textContent = '';
    el('btn-submit').hidden = false;
    el('btn-submit').disabled = true;
    el('btn-next').hidden = true;
    el('btn-next').textContent = currentIndex === total - 1 ? 'See Results 🏁' : 'Next Question ▶';
  }

  // Submit stays disabled until at least one option is picked.
  function updateSubmitEnabled() {
    el('btn-submit').disabled = !optionInputs().some((input) => input.checked);
  }

  function submitAnswer() {
    const q = state.questions[state.currentIndex];
    const inputs = optionInputs();
    const selected = inputs.filter((i) => i.checked).map((i) => Number(i.value));

    // Correct = the selected set exactly matches the correct set.
    const correctIndices = q.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);
    const isCorrect =
      selected.length === correctIndices.length &&
      selected.every((i) => correctIndices.includes(i));

    state.answers[state.currentIndex] = { selected, correct: isCorrect };

    // Lock the options and color them: green for correct choices, red for
    // wrong picks — this is the instant per-question feedback.
    optionLabels().forEach((label, i) => {
      inputs[i].disabled = true;
      label.classList.add('disabled');
      if (q.options[i].correct) label.classList.add('correct-answer');
      else if (selected.includes(i)) label.classList.add('wrong-answer');
    });

    const feedback = el('feedback');
    feedback.hidden = false;
    feedback.className = `feedback ${isCorrect ? 'correct' : 'wrong'}`;
    let msg = isCorrect ? '✅ Correct!' : '❌ Incorrect.';
    if (!isCorrect) {
      msg += `\nCorrect answer: ${correctIndices.map((i) => optionLabel(q.options[i])).join('; ')}`;
    }
    feedback.textContent = msg;
    if (q.explanation) {
      const expSpan = document.createElement('span');
      expSpan.className = 'explanation';
      expSpan.textContent = `Explanation: ${q.explanation}`;
      feedback.appendChild(expSpan);
    }

    el('btn-submit').hidden = true;
    el('btn-next').hidden = false;
  }

  function nextQuestion() {
    state.currentIndex += 1;
    if (state.currentIndex >= state.questions.length) {
      finish();
    } else {
      renderQuestion();
    }
  }

  function finish() {
    clearInterval(state.timerHandle);
    el('progress-bar-fill').style.width = '100%';
    const total = state.questions.length;
    const scored = state.answers.filter((a) => a && a.correct).length;
    const elapsed = Date.now() - state.startTime;

    show('screen-results');
    el('score-big').textContent = `${scored} / ${total}`;
    el('score-pct').textContent = `${Math.round((scored / total) * 100)}%`;
    el('score-time').textContent = `Completed in ${formatTime(elapsed)}`;

    // Hand the result to the leaderboard so the user can save this attempt.
    if (typeof Leaderboard !== 'undefined') {
      Leaderboard.onQuizFinished({
        quizName: state.quizName, score: scored, total, timeMs: elapsed,
      });
    }

    // Full review: every question, your answer, and (if wrong) the right one.
    const reviewList = el('review-list');
    reviewList.innerHTML = '';
    state.questions.forEach((q, idx) => {
      const answer = state.answers[idx];
      const item = document.createElement('div');
      item.className = `review-item ${answer && answer.correct ? 'correct' : 'wrong'}`;

      const qDiv = document.createElement('div');
      qDiv.className = 'review-q';
      qDiv.textContent = `${idx + 1}. ${q.text}`;
      item.appendChild(qDiv);

      const yourText = answer && answer.selected.length
        ? answer.selected.map((i) => optionLabel(q.options[i])).join('; ')
        : '(no answer)';
      const yourLine = document.createElement('div');
      yourLine.className = `review-line ${answer && answer.correct ? 'you-correct' : 'you-wrong'}`;
      yourLine.textContent = `Your answer: ${yourText}`;
      item.appendChild(yourLine);

      if (!answer || !answer.correct) {
        const correctLine = document.createElement('div');
        correctLine.className = 'review-line correct-line';
        correctLine.textContent =
          `Correct answer: ${q.options.filter((o) => o.correct).map(optionLabel).join('; ')}`;
        item.appendChild(correctLine);
      }

      reviewList.appendChild(item);
    });
  }

  // Keyboard controls: 1–9 (or A–H) picks an option, Enter/Space confirms
  // the answer or advances to the next question. Confirming does nothing
  // while no option is selected (mirrors the disabled Submit button).
  document.addEventListener('keydown', (e) => {
    if (!state || el('screen-quiz').hidden) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    const inputs = optionInputs();
    const answered = !el('btn-next').hidden; // feedback is showing

    // Map "1"–"9" and "a"–"h" to an option index.
    let idx = -1;
    if (/^[1-9]$/.test(e.key)) idx = Number(e.key) - 1;
    else if (/^[a-h]$/i.test(e.key)) idx = e.key.toUpperCase().charCodeAt(0) - 65;

    if (idx >= 0) {
      if (answered || idx >= inputs.length) return; // locked or no such option
      const input = inputs[idx];
      if (input.type === 'checkbox') input.checked = !input.checked;
      else input.checked = true;
      updateSubmitEnabled();
      e.preventDefault();
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      // preventDefault so a focused option/button doesn't also fire natively
      // (which would toggle a checkbox or double-trigger the button).
      e.preventDefault();
      if (answered) nextQuestion();
      else if (!el('btn-submit').disabled) submitAnswer();
    }
  });

  el('btn-submit').addEventListener('click', submitAnswer);
  el('btn-next').addEventListener('click', nextQuestion);

  return { start, show, formatTime };
})();
