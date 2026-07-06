// quizParser.js
// Turns raw extracted text (from a PDF, DOCX, or TXT) into an array of
// question objects. Designed around the common exam-dump layout:
//
//   1. Question text, possibly spanning
//   multiple lines?
//   A. Choice one
//   B. Choice two
//   C. Choice three
//   D. Choice four
//   Answer: D
//   Explanation: optional free text...
//
// Multi-answer questions look like "Answer: A,B,G" and become checkbox
// questions. Anything that doesn't yield at least 2 options + a valid
// answer is returned separately as "skipped" (e.g. HOTSPOT / drag-drop
// items that don't fit an MCQ shape).

const QuizParser = (function () {

  const QUESTION_START = /^(\d{1,4})\.\s+(.*)$/;
  const OPTION_START = /^([A-Ha-h])[.)]\s+(.*)$/;
  const ANSWER_LINE = /^Answer\s*:\s*([A-Za-z](?:\s*,\s*[A-Za-z])*)\s*$/i;
  const EXPLANATION_START = /^Explanation\s*:\s*(.*)$/i;

  // Remove repeated boilerplate lines (running headers/footers that show up
  // on every page of a converted PDF, e.g. "Page 3 of 40" or a vendor banner).
  function stripBoilerplate(lines) {
    const freq = new Map();
    for (const raw of lines) {
      const l = raw.trim();
      if (!l) continue;
      freq.set(l, (freq.get(l) || 0) + 1);
    }
    const threshold = Math.max(3, Math.floor(lines.length / 40));
    const noisy = new Set();
    for (const [l, count] of freq.entries()) {
      // Short, frequently repeated, non-question-like lines are boilerplate.
      if (count >= threshold && l.length < 120 && !QUESTION_START.test(l) && !OPTION_START.test(l)) {
        noisy.add(l);
      }
    }
    return lines.filter((raw) => !noisy.has(raw.trim()));
  }

  function finalizeQuestion(q) {
    if (!q) return null;
    const questionText = q.questionLines.join('\n').trim();
    const options = q.options.map((o) => ({
      letter: o.letter.toUpperCase(),
      text: o.text.trim(),
    })).filter((o) => o.text.length > 0);

    const explanation = q.explanationLines.join('\n').trim();

    if (!questionText || options.length < 2 || !q.answer || q.answer.length === 0) {
      return { ok: false, number: q.rawNumber, reason: 'Missing question text, options, or answer', questionPreview: questionText.slice(0, 80) };
    }

    const validLetters = new Set(options.map((o) => o.letter));
    const answer = q.answer.filter((a) => validLetters.has(a));
    if (answer.length === 0) {
      return { ok: false, number: q.rawNumber, reason: 'Answer key referenced a choice that was not parsed', questionPreview: questionText.slice(0, 80) };
    }

    return {
      ok: true,
      question: {
        number: q.rawNumber,
        text: questionText,
        options,
        answer,
        multiple: answer.length > 1,
        explanation: explanation || null,
      },
    };
  }

  function parse(rawText) {
    const rawLines = rawText.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());
    const lines = stripBoilerplate(rawLines);

    const questions = [];
    const skipped = [];
    let current = null;

    function pushCurrent() {
      const result = finalizeQuestion(current);
      if (!result) return;
      if (result.ok) questions.push(result.question);
      else skipped.push(result);
    }

    for (const line of lines) {
      if (!line) continue;

      const qMatch = line.match(QUESTION_START);
      if (qMatch && (!current || Number(qMatch[1]) > Number(current.rawNumber))) {
        pushCurrent();
        current = {
          rawNumber: qMatch[1],
          questionLines: qMatch[2] ? [qMatch[2]] : [],
          options: [],
          answer: null,
          explanationLines: [],
          mode: 'question',
        };
        continue;
      }

      if (!current) continue; // preamble / title page noise before question 1

      const optMatch = line.match(OPTION_START);
      if (optMatch && current.mode !== 'explanation' && current.mode !== 'answer') {
        current.options.push({ letter: optMatch[1], text: optMatch[2] });
        current.mode = 'options';
        continue;
      }

      const ansMatch = line.match(ANSWER_LINE);
      if (ansMatch) {
        current.answer = ansMatch[1].split(',').map((s) => s.trim().toUpperCase());
        current.mode = 'answer';
        continue;
      }

      const expMatch = line.match(EXPLANATION_START);
      if (expMatch) {
        current.mode = 'explanation';
        if (expMatch[1]) current.explanationLines.push(expMatch[1]);
        continue;
      }

      // Continuation line: append to whatever section we're currently in.
      if (current.mode === 'question') {
        current.questionLines.push(line);
      } else if (current.mode === 'options' && current.options.length) {
        current.options[current.options.length - 1].text += '\n' + line;
      } else if (current.mode === 'explanation' || current.mode === 'answer') {
        current.explanationLines.push(line);
      }
    }
    pushCurrent();

    return { questions, skipped };
  }

  return { parse };
})();

if (typeof module !== 'undefined') module.exports = QuizParser;
