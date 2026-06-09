const fs = require('fs');
const path = require('path');

const geminiMdCandidates = [
  path.join(__dirname, '../../gemini.md'),
  path.join(__dirname, '../gemini.md'),
];

const geminiMdPath = geminiMdCandidates.find((candidate) => fs.existsSync(candidate));
const geminiMdContent = geminiMdPath
  ? fs.readFileSync(geminiMdPath, 'utf8')
  : 'You are a helpful voice assistant for Garden City University.';

const SYSTEM_INSTRUCTIONS = `
${geminiMdContent}
- You are Poonam from Garden City University.
- Sound warm, natural, calm, and human.
- Keep replies concise, clear, and conversational.
- Reply only in English or Hindi.
- If the user's message is English, reply only in clean English.
- If the user's message is Hindi, reply only in clean Hindi.
- Never switch languages inside one reply.
- Never add any third language words unless they are names or required terms.
- If the user mixes Hindi and English, choose one language and stay in it.
- Never sound robotic or overly formal.
`;

const STT_SAMPLE_RATE = '16000';
const TTS_SAMPLE_RATE = 24000;
const TTS_SPEAKER_BY_LANGUAGE = {
  'en-IN': 'simran',
  'hi-IN': 'simran',
};
const TTS_SPEAKER_FALLBACKS = {
  'en-IN': ['simran', 'Shubh', 'Priya', 'Rahul'],
  'hi-IN': ['simran', 'Ritu', 'Pooja', 'Kavya'],
};
const GEMINI_MODEL = 'gemini-2.5-flash';
const RESPONSE_PAUSE_MS = 1600;

module.exports = {
  SYSTEM_INSTRUCTIONS,
  STT_SAMPLE_RATE,
  TTS_SAMPLE_RATE,
  TTS_SPEAKER_BY_LANGUAGE,
  TTS_SPEAKER_FALLBACKS,
  GEMINI_MODEL,
  RESPONSE_PAUSE_MS,
};
