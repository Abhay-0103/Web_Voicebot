const DEVANAGARI_RE = /[\u0900-\u097F]/;
const HINDI_HINT_RE = /\b(kya|kaise|hai|hain|nahi|nahin|haan|ji|aap|main|mai|mera|meri|kyun|kyunki|shukriya|dhanyavaad|thik|theek)\b/i;

const detectLanguageCode = (text = '') => {
  if (DEVANAGARI_RE.test(text)) {
    return 'hi-IN';
  }

  if (HINDI_HINT_RE.test(text)) {
    return 'hi-IN';
  }

  return 'en-IN';
};

module.exports = {
  detectLanguageCode,
};
