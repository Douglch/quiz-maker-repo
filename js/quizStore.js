// quizStore.js
// Saved question-set history. Every successfully parsed upload is stored in
// localStorage so it can be re-taken later without the original file.
// Sets are kept newest-first and capped so storage can't grow forever.

const QuizStore = (function () {
  const KEY = 'quiz-maker-sets';
  const MAX_SETS = 30;

  function list() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return []; // corrupted storage — start fresh rather than crash
    }
  }

  function persist(sets) {
    try {
      localStorage.setItem(KEY, JSON.stringify(sets.slice(0, MAX_SETS)));
    } catch (err) {
      // Quota exceeded (huge sets) — the app still works, history just
      // doesn't stick. Not worth breaking the upload flow over.
      console.warn('Could not save question sets:', err);
    }
  }

  function get(id) {
    return list().find((s) => s.id === id) || null;
  }

  // Saves a parsed upload. Re-uploading a file with the same name updates
  // that set (moved to the top) instead of piling up duplicates.
  function saveSet(name, questions) {
    const sets = list();
    const existingIdx = sets.findIndex((s) => s.name === name);
    const set = existingIdx >= 0 ? sets.splice(existingIdx, 1)[0] : {
      id: String(Date.now()),
      name,
    };
    set.questions = questions;
    set.updatedAt = new Date().toISOString();
    sets.unshift(set);
    persist(sets);
    return set;
  }

  function rename(id, newName) {
    const sets = list();
    const set = sets.find((s) => s.id === id);
    if (!set || !newName.trim()) return null;
    set.name = newName.trim();
    persist(sets);
    return set;
  }

  function remove(id) {
    persist(list().filter((s) => s.id !== id));
  }

  // Appends a hand-written question (already in parser shape) to a set.
  function addQuestion(id, question) {
    const sets = list();
    const set = sets.find((s) => s.id === id);
    if (!set) return null;
    // Continue the set's numbering so merging/reports stay consistent.
    const maxNum = Math.max(0, ...set.questions.map((q) => Number(q.number) || 0));
    question.number = String(maxNum + 1);
    set.questions.push(question);
    set.updatedAt = new Date().toISOString();
    persist(sets);
    return set;
  }

  return { list, get, saveSet, rename, remove, addQuestion };
})();
