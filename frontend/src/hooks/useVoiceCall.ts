import { useCallback, useEffect, useRef, useState } from 'react';
import { base64ToObjectUrl, float32ToWavBase64, getAudioContextConstructor } from '../lib/audio';
import type { ServerMessage, TranscriptEntry } from '../types';

const WS_URL = 'ws://localhost:5005';
const VOICE_ACTIVITY_THRESHOLD = 0.0015;

export const useVoiceCall = () => {
  const [isCalling, setIsCalling] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [status, setStatus] = useState('Ready');
  const [isBotSpeaking, setIsBotSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const isBotSpeakingRef = useRef(false);
  const isStoppingRef = useRef(false);
  const playNextAudioRef = useRef<() => void>(() => {});

  const appendMessage = useCallback((role: TranscriptEntry['role'], text: string) => {
    const message = text.trim();
    if (!message) {
      return;
    }

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setTranscript((prev) => [...prev, { role, text: message, time: now }]);
  }, []);

  const resetAudioState = useCallback(() => {
    isPlayingRef.current = false;
    isBotSpeakingRef.current = false;
    audioQueueRef.current = [];

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      URL.revokeObjectURL(currentAudioRef.current.src);
      currentAudioRef.current.src = '';
      currentAudioRef.current = null;
    }

    setIsBotSpeaking(false);
    setVolume(0);
  }, []);

  const playNextAudio = useCallback(() => {
    if (isPlayingRef.current) {
      return;
    }

    const nextAudio = audioQueueRef.current.shift();
    if (!nextAudio) {
      return;
    }

    isPlayingRef.current = true;
    isBotSpeakingRef.current = true;
    setIsBotSpeaking(true);

    try {
      const url = base64ToObjectUrl(nextAudio);
      const audio = new Audio(url);

      currentAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        setIsBotSpeaking(false);
        isBotSpeakingRef.current = false;
        isPlayingRef.current = false;
        playNextAudioRef.current();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        setIsBotSpeaking(false);
        isBotSpeakingRef.current = false;
        isPlayingRef.current = false;
        playNextAudioRef.current();
      };

      audio.play().catch((error) => {
        console.error('Audio Playback Error:', error);
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        setIsBotSpeaking(false);
        isBotSpeakingRef.current = false;
        isPlayingRef.current = false;
        playNextAudioRef.current();
      });
    } catch (error) {
      console.error('Audio Preparation Error:', error);
      isPlayingRef.current = false;
      isBotSpeakingRef.current = false;
      setIsBotSpeaking(false);
      playNextAudioRef.current();
    }
  }, []);

  useEffect(() => {
    playNextAudioRef.current = playNextAudio;
  }, [playNextAudio]);

  const queueAudio = useCallback((base64Audio: string) => {
    audioQueueRef.current.push(base64Audio);
    playNextAudio();
  }, [playNextAudio]);

  const stopCall = useCallback(() => {
    isStoppingRef.current = true;
    window.setTimeout(() => {
      isStoppingRef.current = false;
    }, 0);

    setIsCalling(false);
    setStatus('Ready');
    resetAudioState();

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [resetAudioState]);

  const startCall = useCallback(async () => {
    try {
      isStoppingRef.current = false;
      setTranscript([]);
      setStatus('Connecting...');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
        },
      });
      streamRef.current = stream;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('Connected');
        ws.send(JSON.stringify({ type: 'start' }));

        const AudioContextCtor = getAudioContextConstructor();
        audioContextRef.current = new AudioContextCtor({ sampleRate: 16000 });
        const source = audioContextRef.current.createMediaStreamSource(stream);

        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
        source.connect(analyserRef.current);

        processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        const silentGain = audioContextRef.current.createGain();
        silentGain.gain.value = 0;

        processorRef.current.onaudioprocess = (event) => {
          if (ws.readyState === WebSocket.OPEN && !isBotSpeakingRef.current && !isStoppingRef.current) {
            if (analyserRef.current) {
              analyserRef.current.getByteTimeDomainData(dataArray);
              let sum = 0;
              for (let i = 0; i < dataArray.length; i += 1) {
                const sample = (dataArray[i] - 128) / 128;
                sum += sample * sample;
              }
              const rms = Math.sqrt(sum / dataArray.length);
              setVolume(Math.min(100, rms * 180));

            }

            const inputData = event.inputBuffer.getChannelData(0);
            let inputSum = 0;
            for (let i = 0; i < inputData.length; i += 1) {
              inputSum += inputData[i] * inputData[i];
            }

            const inputRms = Math.sqrt(inputSum / inputData.length);
            if (inputRms < VOICE_ACTIVITY_THRESHOLD) {
              return;
            }

            const audioPayload = float32ToWavBase64(inputData, 16000);

            ws.send(JSON.stringify({
              type: 'audio',
              audio: {
                data: audioPayload,
                sample_rate: '16000',
                encoding: 'audio/wav',
              },
            }));
          } else {
            setVolume(0);
          }
        };

        source.connect(processorRef.current);
        processorRef.current.connect(silentGain);
        silentGain.connect(audioContextRef.current.destination);
        setIsCalling(true);
      };

      ws.onmessage = (event) => {
        try {
          const data: ServerMessage = JSON.parse(event.data);

          if (data.type === 'assistant_text') {
            appendMessage('Poonam', data.text);
            return;
          }

          if (data.type === 'transcript') {
            appendMessage('You', data.text);
            return;
          }

          if (data.type === 'audio') {
            queueAudio(data.audio);
            return;
          }

          if (data.type === 'status') {
            setStatus(data.text);
            return;
          }

          if (data.type === 'error') {
            setStatus(data.message);
          }
        } catch (error) {
          console.error('WebSocket JSON Error:', error);
        }
      };

      ws.onclose = () => {
        if (isStoppingRef.current) {
          isStoppingRef.current = false;
          return;
        }
        stopCall();
      };

      ws.onerror = (error) => {
        console.error('WebSocket Error:', error);
        stopCall();
      };
    } catch (error) {
      console.error('Microphone Error:', error);
      setStatus('Mic Denied');
    }
  }, [appendMessage, queueAudio, stopCall]);

  useEffect(() => {
    return () => {
      stopCall();
    };
  }, [stopCall]);

  return {
    isCalling,
    transcript,
    status,
    isBotSpeaking,
    volume,
    startCall,
    stopCall,
  };
};
