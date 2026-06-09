const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const dotenv = require('dotenv');

const { RESPONSE_PAUSE_MS, STT_SAMPLE_RATE } = require('./config');
const { createGeminiResponder } = require('./services/gemini');
const { createSpeechSynthesizer } = require('./services/sarvam');
const { detectLanguageCode } = require('./utils/language');

dotenv.config();

const geminiReply = createGeminiResponder(process.env.GEMINI_API_KEY);
const synthesizeSpeech = createSpeechSynthesizer(process.env.SARVAM_API_KEY);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('[SERVER] New client connected');

  let chatHistory = [];
  let transcriptTimer = null;
  let pendingTranscript = '';
  let lastProcessedTranscript = '';
  let shouldIgnoreTranscript = false;

  const pushChatHistory = (entry) => {
    chatHistory.push(entry);
    if (chatHistory.length > 12) {
      chatHistory = chatHistory.slice(-12);
    }
  };

  const sendToClient = (payload) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  const callGemini = async (text, languageCode) => {
    const botText = await geminiReply({
      chatHistory,
      text,
      languageCode,
    });

    pushChatHistory({ role: 'user', parts: [{ text }] });
    pushChatHistory({ role: 'model', parts: [{ text: botText }] });

    return botText;
  };

  const getFallbackReply = (languageCode) => {
    if (languageCode === 'hi-IN') {
      return 'Maaf kijiye, thoda load zyada hai. Aap apna sawaal thoda sa dobara bol sakte hain?';
    }

    return 'Sorry, I am a little busy right now. Could you please say that again?';
  };

  const callSarvamTTS = async (text, targetLanguageCode) => {
    try {
      console.log('[SARVAM] Synthesizing...');
      return await synthesizeSpeech({ text, targetLanguageCode });
    } catch (err) {
      console.error('[SARVAM] TTS Error:', err.response?.data || err.message);
      return null;
    }
  };

  const handleAILoop = async (textInput) => {
    try {
      console.log('[GEMINI] Input:', textInput);
      const targetLanguageCode = detectLanguageCode(textInput);
      let botText;

      try {
        botText = await callGemini(textInput, targetLanguageCode);
      } catch (error) {
        console.error('[GEMINI] Retry exhausted:', error.message);
        botText = getFallbackReply(targetLanguageCode);
      }

      console.log('[GEMINI] Response:', botText);

      sendToClient({ type: 'assistant_text', text: botText });

      const audio = await callSarvamTTS(botText, targetLanguageCode);
      if (audio) {
        sendToClient({ type: 'audio', audio, text: botText, language: targetLanguageCode });
      } else {
        sendToClient({ type: 'error', message: 'Voice output could not be generated.' });
      }
    } catch (error) {
      console.error('[AI LOOP] Global Failure:', error.message);
      sendToClient({ type: 'error', message: 'Conversation processing failed.' });
    }
  };

  const sarvamAsrWs = new WebSocket(
    `wss://api.sarvam.ai/speech-to-text/ws?language-code=unknown&model=saaras:v3&mode=transcribe&sample_rate=${STT_SAMPLE_RATE}&input_audio_codec=pcm_s16le`,
    {
      headers: { 'api-subscription-key': process.env.SARVAM_API_KEY },
    },
  );

  sarvamAsrWs.on('open', () => console.log('[SARVAM] ASR WebSocket Open'));

  sarvamAsrWs.on('message', (data) => {
    try {
      const res = JSON.parse(data.toString());
      if (res.type === 'data') {
        const transcript = typeof res.data?.transcript === 'string'
          ? res.data.transcript.trim()
          : typeof res.data?.text === 'string'
            ? res.data.text.trim()
            : '';

        if (transcript) {
          pendingTranscript = transcript;
          clearTimeout(transcriptTimer);

          transcriptTimer = setTimeout(() => {
            if (shouldIgnoreTranscript || pendingTranscript === lastProcessedTranscript) {
              return;
            }

            lastProcessedTranscript = pendingTranscript;
            console.log('[SARVAM] Transcript:', pendingTranscript);
            sendToClient({ type: 'transcript', role: 'user', text: pendingTranscript });
            handleAILoop(pendingTranscript);
          }, RESPONSE_PAUSE_MS);
        }
      } else if (res.type === 'error') {
        console.error('[SARVAM] ASR Error:', res.data || res);
        sendToClient({ type: 'error', message: res.data?.error || 'Speech recognition failed.' });
      }
    } catch (e) {
      console.error('[SARVAM] Invalid ASR payload:', e.message);
    }
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      return;
    }

    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === 'start') {
        console.log('[SERVER] START received');
        sendToClient({ type: 'status', text: 'Connected' });
      } else if (parsed.type === 'audio' && parsed.audio?.data) {
        if (sarvamAsrWs.readyState === WebSocket.OPEN) {
          sarvamAsrWs.send(JSON.stringify({ audio: parsed.audio }));
        }
      } else if (parsed.type === 'flush') {
        shouldIgnoreTranscript = false;
        clearTimeout(transcriptTimer);
        if (sarvamAsrWs.readyState === WebSocket.OPEN) {
          sarvamAsrWs.send(JSON.stringify({ type: 'flush' }));
        }
      }
    } catch (e) {
      console.error('[SERVER] Invalid client message:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[SERVER] Client disconnected');
    shouldIgnoreTranscript = true;
    clearTimeout(transcriptTimer);
    if (sarvamAsrWs.readyState === WebSocket.OPEN) {
      sarvamAsrWs.close();
    }
  });
});

const PORT = process.env.PORT || 5005;
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`PORT ${PORT} IS ALREADY IN USE`);
    process.exit(1);
  }

  throw error;
});

server.listen(PORT, () => console.log(`SERVER RUNNING ON PORT ${PORT}`));
