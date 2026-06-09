const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const geminiMdPath = path.join(__dirname, '../gemini.md');
const geminiMdContent = fs.readFileSync(geminiMdPath, 'utf8');

const systemInstructionText = `
${geminiMdContent}
- You are Poonam from Garden City University.
- Maximum 3 sentences per response.
- Auto-detect English/Hindi/Hinglish.
`;

const STT_SAMPLE_RATE = '16000';
const TTS_SAMPLE_RATE = 24000;
const TTS_SPEAKER = 'simran';
const GEMINI_MODEL = 'gemini-2.5-flash';

const inferLanguageCode = (text) => (/[ऀ-ॿ]/.test(text) ? 'hi-IN' : 'en-IN');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const extractAudioBase64 = (data) => {
    if (!data) return null;
    if (typeof data.audio_base64 === 'string') return data.audio_base64;
    if (typeof data.audio === 'string') return data.audio.replace(/^data:audio\/[a-z0-9.+-]+;base64,/, '');
    if (Array.isArray(data.audios) && typeof data.audios[0] === 'string') return data.audios[0];
    if (typeof data.audios?.[0] === 'string') return data.audios[0];
    return null;
};

const extractTranscript = (data) => {
    if (!data) return '';
    if (typeof data.transcript === 'string') return data.transcript.trim();
    if (typeof data.text === 'string') return data.text.trim();
    return '';
};

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
    
    const callGemini = async (text) => {
        const model = genAI.getGenerativeModel({
            model: GEMINI_MODEL,
            systemInstruction: systemInstructionText,
            generationConfig: {
                temperature: 0.7,
                topP: 0.9,
                topK: 40,
                maxOutputTokens: 180
            }
        });

        const result = await model.generateContent({
            contents: [
                ...chatHistory,
                { role: 'user', parts: [{ text }] }
            ]
        });

        const botText = result.response.text().trim();
        if (!botText) {
            throw new Error('Gemini returned an empty response.');
        }

        pushChatHistory({ role: 'user', parts: [{ text }] });
        pushChatHistory({ role: 'model', parts: [{ text: botText }] });
        return botText;
    };

    const callSarvamTTS = async (text) => {
        try {
            console.log('[SARVAM] Synthesizing...');
            const url = 'https://api.sarvam.ai/text-to-speech';
            const targetLanguageCode = inferLanguageCode(text);
            const payload = {
                text,
                target_language_code: targetLanguageCode,
                model: "bulbul:v3",
                speaker: TTS_SPEAKER,
                speech_sample_rate: TTS_SAMPLE_RATE,
                enable_preprocessing: true,
                output_format: "wav"
            };

            const res = await axios.post(url, payload, {
                headers: { 'api-subscription-key': process.env.SARVAM_API_KEY },
                timeout: 10000
            });

            return extractAudioBase64(res.data);
        } catch (err) {
            console.error('[SARVAM] TTS Error:', err.response?.data || err.message);
            return null;
        }
    };

    const sendToClient = (payload) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(payload));
        }
    };

    const handleAILoop = async (textInput) => {
        try {
            console.log('[GEMINI] Input:', textInput);
            const botText = await callGemini(textInput);
            console.log('[GEMINI] Response:', botText);

            sendToClient({ type: 'assistant_text', text: botText });

            const audio = await callSarvamTTS(botText);

            if (audio) {
                console.log('[SERVER] Sending audio back');
                sendToClient({ type: 'audio', audio, text: botText, language: inferLanguageCode(botText) });
            } else {
                console.error('[SARVAM] Failed to get audio');
                sendToClient({ type: 'error', message: 'Voice output could not be generated.' });
            }
        } catch (error) {
            console.error('[AI LOOP] Global Failure:', error.message);
            sendToClient({ type: 'error', message: 'Conversation processing failed.' });
        }
    };

    const sarvamAsrWs = new WebSocket(`wss://api.sarvam.ai/speech-to-text/ws?language-code=unknown&model=saaras:v3&mode=transcribe&sample_rate=${STT_SAMPLE_RATE}&input_audio_codec=pcm_s16le`, {
        headers: { 'api-subscription-key': process.env.SARVAM_API_KEY }
    });

    sarvamAsrWs.on('open', () => console.log('[SARVAM] ASR WebSocket Open'));
    
    sarvamAsrWs.on('message', (data) => {
        try {
            const res = JSON.parse(data.toString());
            if (res.type === 'data') {
                const transcript = extractTranscript(res.data);
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
                    }, 650);
                }
            } else if (res.type === 'error') {
                console.error('[SARVAM] ASR Error:', res.data?.error || 'Unknown ASR error');
                sendToClient({ type: 'error', message: res.data?.error || 'Speech recognition failed.' });
            }
        } catch (e) {}
    });

    ws.on('message', (data, isBinary) => {
        if (isBinary) {
            return;
        } else {
            const msg = data.toString();
            try {
                const parsed = JSON.parse(msg);
                if (parsed.type === 'start') {
                    console.log('[SERVER] START received');
                    sendToClient({ type: 'status', text: 'Connected' });
                    handleAILoop("Hello, please greet me as Poonam from Garden City University.");
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
        }
    });

    ws.on('close', () => {
        console.log('[SERVER] Client disconnected');
        shouldIgnoreTranscript = true;
        clearTimeout(transcriptTimer);
        if (sarvamAsrWs.readyState === WebSocket.OPEN) sarvamAsrWs.close();
    });
});

const PORT = process.env.PORT || 5005;
server.listen(PORT, () => console.log(`SERVER RUNNING ON PORT ${PORT}`));
