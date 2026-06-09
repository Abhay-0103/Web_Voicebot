const axios = require('axios');
const { TTS_SAMPLE_RATE, TTS_SPEAKER_BY_LANGUAGE, TTS_SPEAKER_FALLBACKS } = require('../config');

const extractAudioBase64 = (data) => {
  if (!data) return null;
  if (typeof data.audio_base64 === 'string') return data.audio_base64;
  if (typeof data.audio === 'string') {
    return data.audio.replace(/^data:audio\/[a-z0-9.+-]+;base64,/, '');
  }
  if (Array.isArray(data.audios) && typeof data.audios[0] === 'string') {
    return data.audios[0];
  }
  return null;
};

const getTtsSpeakerCandidates = (targetLanguageCode) => {
  return TTS_SPEAKER_FALLBACKS[targetLanguageCode] || TTS_SPEAKER_FALLBACKS['en-IN'];
};

const createSpeechSynthesizer = (apiKey) => {
  return async ({ text, targetLanguageCode }) => {
    const speakerCandidates = getTtsSpeakerCandidates(targetLanguageCode);
    let lastError = null;

    for (const speaker of speakerCandidates) {
      try {
        console.log(`[SARVAM] TTS using speaker=${speaker} lang=${targetLanguageCode}`);
        const res = await axios.post(
          'https://api.sarvam.ai/text-to-speech',
          {
            text,
            target_language_code: targetLanguageCode,
            model: 'bulbul:v3',
            speaker,
            speech_sample_rate: TTS_SAMPLE_RATE,
            enable_preprocessing: true,
            output_format: 'wav',
          },
          {
            headers: { 'api-subscription-key': apiKey },
            timeout: 10000,
          },
        );

        const audio = extractAudioBase64(res.data);
        if (audio) {
          return audio;
        }

        lastError = new Error(`Sarvam returned empty audio for speaker ${speaker}.`);
      } catch (error) {
        lastError = error;
        console.error('[SARVAM] Speaker failed:', speaker, error.response?.data || error.message);
      }
    }

    throw lastError || new Error('Sarvam text-to-speech failed.');
  };
};

module.exports = {
  createSpeechSynthesizer,
};
