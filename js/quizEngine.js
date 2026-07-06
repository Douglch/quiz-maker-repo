// quizEngine.js
// Drives the quiz screen: timer, question rendering, per-answer feedback,
// scoring, and the final results/review screen.

const QuizEngine = (function () {

  const el = (id) => document.getElementById(id);

  let state = null; // { questions, currentIndex, answers, startTime, timerHandle }

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

  // parsedQuestions: array from QuizParser (letter-based answer keys).
  // opts: { shuffleQuestions, shuffleAnswers, limit }
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

    for (const q of pool) {
      let options = q.options;
      if (opts.shuffleAnswers) options = shuffle(options);
      options.forEach((o, i) => { o.letter = String.fromCharCode(65 + i); });
      q.options = options;
    }
    return pool;
  }

  function start(parsedQuestions, opts) {
    const questions = buildQuizQuestions(parsedQuestions, opts);
    state = {
      questions,
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

  function renderQuestion() {
    const { questions, currentIndex } = state;
    const q = questions[currentIndex];
    const total = questions.length;

    el('quiz-progress').textContent = `Question ${currentIndex + 1} of ${total}`;
    el('progress-bar-fill').style.width = `${(currentIndex / total) * 100}%`;
    el('question-text').textContent = `${currentIndex + 1}. ${q.text}`;

    const correctCount = q.options.filter((o) => o.correct).length;
    const multiHint = el('multi-hint');
    if (q.multiple) {
      multiHint.hidden = false;
      multiHint.textContent = `Select all that apply (${correctCount} correct answers)`;
    } else {
      multiHint.hidden = true;
    }

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
      span.textContent = `${opt.letter}. ${opt.text}`;
      label.appendChild(input);
      label.appendChild(span);
      form.appendChild(label);
    });

    el('feedback').hidden = true;
    el('feedback').textContent = '';
    el('btn-submit').hidden = false;
    el('btn-submit').disabled = true;
    el('btn-next').hidden = true;
    el('btn-next').textContent = currentIndex === total - 1 ? 'See Results 🏁' : 'Next Question ▶';
  }

  function updateSubmitEnabled() {
    const anyChecked = Array.from(el('options-form').elements['quiz-option'] || [])
      .some((input) => input.checked);
    el('btn-submit').disabled = !anyChecked;
  }

  function submitAnswer() {
    const q = state.questions[state.currentIndex];
    const inputs = Array.from(el('options-form').elements['quiz-option']);
    const selected = inputs.filter((i) => i.checked).map((i) => Number(i.value));

    const correctIndices = q.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);
    const isCorrect =
      selected.length === correctIndices.length &&
      selected.every((i) => correctIndices.includes(i));

    state.answers[state.currentIndex] = { selected, correct: isCorrect };

    const labels = form_labels();
    labels.forEach((label, i) => {
      const input = inputs[i];
      input.disabled = true;
      label.classList.add('disabled');
      if (q.options[i].correct) label.classList.add('correct-answer');
      else if (selected.includes(i)) label.classList.add('wrong-answer');
    });

    const feedback = el('feedback');
    feedback.hidden = false;
    feedback.className = `feedback ${isCorrect ? 'correct' : 'wrong'}`;
    let msg = isCorrect ? '✅ Correct!' : '❌ Incorrect.';
    if (!isCorrect) {
      const correctText = correctIndices.map((i) => `${q.options[i].letter}. ${q.options[i].text}`).join('; ');
      msg += `\nCorrect answer: ${correctText}`;
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

  function form_labels() {
    return Array.from(el('options-form').querySelectorAll('label.option'));
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
        ? answer.selected.map((i) => `${q.options[i].letter}. ${q.options[i].text}`).join('; ')
        : '(no answer)';
      const yourLine = document.createElement('div');
      yourLine.className = `review-line ${answer && answer.correct ? 'you-correct' : 'you-wrong'}`;
      yourLine.textContent = `Your answer: ${yourText}`;
      item.appendChild(yourLine);

      if (!answer || !answer.correct) {
        const correctText = q.options.filter((o) => o.correct)
          .map((o) => `${o.letter}. ${o.text}`).join('; ');
        const correctLine = document.createElement('div');
        correctLine.className = 'review-line correct-line';
        correctLine.textContent = `Correct answer: ${correctText}`;
        item.appendChild(correctLine);
      }

      reviewList.appendChild(item);
    });
  }

  function getLastQuestions() {
    return state ? state.questions : null;
  }

  el('btn-submit').addEventListener('click', submitAnswer);
  el('btn-next').addEventListener('click', nextQuestion);

  return { start, show };
})();
