// quizParser.js
// Turns raw extracted text (from a PDF, DOCX, or TXT) into an array of
// question objects. Two layouts are recognised:
//
// Classic exam-dump format:
//   1. Question text, possibly spanning
//   multiple lines?
//   A. Choice one
//   B. Choice two
//   Answer: D
//   Explanation: optional free text...
//
// ExamTopics-style format (with community discussion):
//   Question #12 Topic 1
//   Question text...
//   A. Choice one
//   B. Choice two
//   Correct Answer: A
//   <community vote bars, comments, "Selected Answer: ...", etc.>
//
// Multi-answer questions look like "Answer: A,B,G" or "Correct Answer: BD"
// and become checkbox questions. Anything that doesn't yield at least
// 2 options + a valid answer is returned separately as "skipped" (e.g.
// HOTSPOT / drag-drop items that don't fit an MCQ shape).

const QuizParser = (function () {

  // Classic format: "12. Question text..."
  const QUESTION_START = /^(\d{1,4})\.\s+(.*)$/;
  // ExamTopics-style header: "Question #12 Topic 1" — the question text
  // follows on the next lines. Numbering may restart when the topic changes.
  const QUESTION_HEADER = /^Question\s*#?\s*(\d{1,4})(?:\s+Topic\s+\d+)?\s*$/i;
  const OPTION_START = /^([A-Ha-h])[.)]\s+(.*)$/;
  // "Answer: D", "Correct Answer: A", "Suggested Answer: BD", "Answer: A,C" —
  // letters may be comma-separated or run together.
  const ANSWER_LINE = /^(?:Correct\s+|Suggested\s+)?Answer\s*:\s*([A-Ha-h](?:\s*,?\s*[A-Ha-h])*)\s*$/i;
  const EXPLANATION_START = /^Explanation\s*:\s*(.*)$/i;

  // Lines that are never quiz content — page counters and the voting chrome
  // ExamTopics-style dumps put between the answer and the comments. Dropped
  // wherever they appear.
  const NOISE_LINES = [
    /^\d+\s*\/\s*\d+$/,                      // "12/926" page counter
    /^Community vote distribution/i,
    /^(?:[A-H]{1,4}\s*\(\d+%\)[\s,]*)+$/,    // "A (98%)" / "BD (70%)" vote bars
    /^upvoted\s+\d+\s+times?$/i,
    /^Selected Answer\s*:\s*[A-H]/i,         // a commenter's vote, not the key
    /^Topic\s+\d+$/i,                        // header fragment on its own line
  ];

  // Forum-comment markers. Once a question's answer is known, hitting one of
  // these means everything until the next question is discussion, not content
  // (comments freely quote options and answer lines, so they must be
  // discarded rather than parsed).
  const DISCUSSION_MARKERS = [
    /\bHighly Voted\b/i,
    /\bMost Recent\b/i,
    /\b(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/i,
  ];

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
      // Short, frequently repeated lines are boilerplate — unless they look
      // like question/option/answer content, which legitimately repeats
      // (e.g. "Answer: B" appears ~50 times in a 200-question dump).
      if (count >= threshold && l.length < 120 &&
          !QUESTION_START.test(l) && !OPTION_START.test(l) && !ANSWER_LINE.test(l)) {
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

      if (NOISE_LINES.some((re) => re.test(line))) {
        // Once the answer is known, noise also marks the start of the
        // discussion section — nothing after it belongs to the question.
        if (current && current.answer) current.mode = 'discussion';
        continue;
      }
      if (current && current.answer && current.mode !== 'discussion' &&
          DISCUSSION_MARKERS.some((re) => re.test(line))) {
        current.mode = 'discussion';
        continue;
      }

      const headerMatch = line.match(QUESTION_HEADER);
      const qMatch = headerMatch ? null : line.match(QUESTION_START);
      // A "Question #N" header always starts a new question (numbering can
      // restart per topic). A bare "12. text" line only counts when the
      // number increases, so numbered lists inside question text or comments
      // don't split the current question.
      if (headerMatch || (qMatch && (!current || Number(qMatch[1]) > Number(current.rawNumber)))) {
        pushCurrent();
        current = {
          rawNumber: (headerMatch || qMatch)[1],
          questionLines: qMatch && qMatch[2] ? [qMatch[2]] : [],
          options: [],
          answer: null,
          explanationLines: [],
          mode: 'question',
        };
        continue;
      }

      // Preamble noise before question 1, or discussion junk after an
      // ExamTopics answer — ignore until the next question starts.
      if (!current || current.mode === 'discussion') continue;

      const optMatch = line.match(OPTION_START);
      if (optMatch && current.mode !== 'explanation' && current.mode !== 'answer') {
        current.options.push({ letter: optMatch[1], text: optMatch[2] });
        current.mode = 'options';
        continue;
      }

      const ansMatch = line.match(ANSWER_LINE);
      if (ansMatch && !current.answer) {
        // First answer line wins — later matches are commenters quoting it.
        current.answer = ansMatch[1].replace(/[^A-Ha-h]/g, '').toUpperCase().split('');
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
