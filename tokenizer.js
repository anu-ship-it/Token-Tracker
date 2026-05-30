/**
 * tokenizer.js
 * Lightweight token estimator — no WASM, no network, <2KB
 *
 * Strategy: character-based approximation
 *   ~4 chars per token for English prose (OpenAI's documented rule of thumb)
 *   Code/JSON is slightly denser: ~3.5 chars per token
 *   We use 4 as the universal divisor — errs slightly conservative (shows fewer tokens used)
 *   which is the safe direction: user sees more remaining than actual → no false urgency
 *
 * If you want tighter accuracy in a future iteration, swap this with a
 * BPE-approximating regex tokenizer (~15KB), still no WASM needed.
 */

const Tokenizer = (() => {
  const CHARS_PER_TOKEN = 4;

  function estimate(text) {
    if (!text || typeof text !== "string") return 0;
    // Collapse whitespace runs — multiple spaces count as 1 token boundary
    const normalized = text.replace(/\s+/g, " ").trim();
    return Math.ceil(normalized.length / CHARS_PER_TOKEN);
  }

  function estimateMessages(messages) {
    // ~4 overhead tokens per message (role, formatting)
    return messages.reduce((sum, m) => sum + estimate(m) + 4, 0);
  }

  return { estimate, estimateMessages };
})();
