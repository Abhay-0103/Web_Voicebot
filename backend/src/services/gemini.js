const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GEMINI_MODEL, SYSTEM_INSTRUCTIONS } = require('../config');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientGeminiError = (error) => {
  const status = error?.status || error?.response?.status;
  return status === 429 || status === 503 || status === 500;
};

const createGeminiResponder = (apiKey) => {
  const genAI = new GoogleGenerativeAI(apiKey);

  return async ({ chatHistory, text, languageCode = 'en-IN' }) => {
    const languageInstruction = languageCode === 'hi-IN'
      ? 'Reply only in clean Hindi. Do not mix English unless required for a name or technical term.'
      : 'Reply only in clean English. Do not mix Hindi unless required for a name or technical term.';

    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: `${SYSTEM_INSTRUCTIONS}\n- ${languageInstruction}`,
      generationConfig: {
        temperature: 0.65,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 180,
      },
    });

    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await model.generateContent({
          contents: [
            ...chatHistory,
            { role: 'user', parts: [{ text }] },
          ],
        });

        const botText = result.response.text().trim();
        if (!botText) {
          throw new Error('Gemini returned an empty response.');
        }

        return botText;
      } catch (error) {
        lastError = error;
        if (!isTransientGeminiError(error) || attempt === 2) {
          throw error;
        }

        await sleep(700 * (attempt + 1));
      }
    }

    throw lastError;
  };
};

module.exports = {
  createGeminiResponder,
};
