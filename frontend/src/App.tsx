import React, { useEffect, useRef, useState } from 'react';

const WS_URL = 'ws://localhost:5005';

type TranscriptEntry = {
  role: 'You' | 'Poonam';
  text: string;
  time: string;
};

type ServerMessage =
  | { type: 'audio'; audio: string; text?: string; language?: string }
  | { type: 'assistant_text'; text: string }
  | { type: 'transcript'; role?: string; text: string }
  | { type: 'status'; text: string }
  | { type: 'error'; message: string };

const App: React.FC = () => {
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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
   if (scrollRef.current) {
     scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
   }
  }, [transcript]);

  const resetAudioState = () => {
   isPlayingRef.current = false;
   isBotSpeakingRef.current = false;
   audioQueueRef.current = [];

   if (currentAudioRef.current) {
     currentAudioRef.current.pause();
     currentAudioRef.current.src = '';
     currentAudioRef.current = null;
   }

   setIsBotSpeaking(false);
   setVolume(0);
  };

  const stopCall = () => {
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
     streamRef.current.getTracks().forEach(track => track.stop());
     streamRef.current = null;
   }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const appendMessage = (role: TranscriptEntry['role'], text: string) => {
    if (!text.trim()) {
      return;
    }

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setTranscript((prev) => [...prev, { role, text: text.trim(), time: now }]);
  };

  const playNextAudio = () => {
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
      const cleaned = nextAudio.startsWith('data:') ? nextAudio.split(',')[1] : nextAudio;
      const binaryString = atob(cleaned);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i += 1) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes.buffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      currentAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        setIsBotSpeaking(false);
        isBotSpeakingRef.current = false;
        isPlayingRef.current = false;
        playNextAudio();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        setIsBotSpeaking(false);
        isBotSpeakingRef.current = false;
        isPlayingRef.current = false;
        playNextAudio();
      };

      audio.play().catch((e) => {
        console.error('Audio Playback Error:', e);
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        setIsBotSpeaking(false);
        isBotSpeakingRef.current = false;
        isPlayingRef.current = false;
        playNextAudio();
      });
    } catch (e) {
      console.error("Audio Preparation Error:", e);
      isPlayingRef.current = false;
      isBotSpeakingRef.current = false;
      setIsBotSpeaking(false);
      playNextAudio();
    }
  };

  const queueAudio = (base64Audio: string) => {
    audioQueueRef.current.push(base64Audio);
    playNextAudio();
  };

  const startCall = async () => {
    try {
      isStoppingRef.current = false;
      setTranscript([]);
      setStatus('Connecting...');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('Connected');
        ws.send(JSON.stringify({ type: 'start' }));

        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 16000
        });
        const source = audioContextRef.current.createMediaStreamSource(stream);

        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
        source.connect(analyserRef.current);

        processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);

        processorRef.current.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN && !isBotSpeakingRef.current && !isStoppingRef.current) {
            if (analyserRef.current) {
              analyserRef.current.getByteTimeDomainData(dataArray);
              let sum = 0;
              for (let i = 0; i < dataArray.length; i += 1) {
                const sample = (dataArray[i] - 128) / 128;
                sum += sample * sample;
              }
              setVolume(Math.min(100, Math.sqrt(sum / dataArray.length) * 180));
            }

            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
            }
            let binary = '';
            const bytes = new Uint8Array(pcmData.buffer);
            for (let i = 0; i < bytes.length; i += 1) {
              binary += String.fromCharCode(bytes[i]);
            }

            ws.send(JSON.stringify({
              type: 'audio',
              audio: {
                data: btoa(binary),
                sample_rate: '16000',
                encoding: 'audio/wav'
              }
            }));
          } else {
            setVolume(0);
          }
        };

        source.connect(processorRef.current);
        processorRef.current.connect(audioContextRef.current.destination);
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
            return;
          }
        } catch (e) {
          console.error('WebSocket JSON Error:', e);
        }
      };

      ws.onclose = () => {
        if (isStoppingRef.current) {
          isStoppingRef.current = false;
          return;
        }
        stopCall();
      };

      ws.onerror = (e) => {
        console.error("WebSocket Error:", e);
        stopCall();
      };

    } catch (err) {
      console.error('Microphone Error:', err);
      setStatus('Mic Denied');
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100vh', 
      backgroundColor: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ background: '#1e293b', padding: '15px 30px', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px' }}>Garden City University</h1>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>Reconnect'26 Alumni Voicebot</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', color: isCalling ? '#4ade80' : '#94a3b8' }}>● {status.toUpperCase()}</span>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: '800px', margin: '0 auto', width: '100%', padding: '20px', overflow: 'hidden' }}>
        
        {/* Voice Visualizer Area */}
        <div style={{ height: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px' }}>
          {isCalling && (
            <div style={{ position: 'relative', width: '100px', height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ 
                width: `${60 + volume * 0.8}px`, 
                height: `${60 + volume * 0.8}px`, 
                backgroundColor: isBotSpeaking ? '#3b82f6' : '#22c55e',
                borderRadius: '50%',
                transition: 'width 0.1s, height 0.1s',
                opacity: 0.6,
                position: 'absolute'
              }} />
              <div style={{ 
                width: '60px', 
                height: '60px', 
                backgroundColor: isBotSpeaking ? '#2563eb' : '#16a34a',
                borderRadius: '50%',
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '24px'
              }}>
                {isBotSpeaking ? '👩‍💼' : '🎤'}
              </div>
            </div>
          )}
        </div>

        <div ref={scrollRef} style={{ flex: 1, backgroundColor: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {transcript.length === 0 && <p style={{ textAlign: 'center', color: '#94a3b8', marginTop: '50px' }}>Your conversation will appear here...</p>}
          {transcript.map((msg, i) => (
            <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '2px', marginLeft: '4px' }}>{msg.role} • {msg.time}</div>
              <div style={{ backgroundColor: '#f1f5f9', padding: '10px 16px', borderRadius: '4px 16px 16px 16px', color: '#1e293b', fontSize: '15px', lineHeight: '1.4' }}>
                {msg.text}
              </div>
            </div>
          ))}
          {isBotSpeaking && <div style={{ fontSize: '12px', color: '#3b82f6', marginLeft: '5px', fontStyle: 'italic' }}>Poonam is speaking...</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
          {!isCalling ? (
            <button onClick={startCall} style={{ padding: '15px 40px', fontSize: '16px', fontWeight: 'bold', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '30px', cursor: 'pointer', boxShadow: '0 4px 14px 0 rgba(59, 130, 246, 0.39)' }}>
              Start Voice Call
            </button>
          ) : (
            <button onClick={stopCall} style={{ padding: '15px 40px', fontSize: '16px', fontWeight: 'bold', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '30px', cursor: 'pointer', boxShadow: '0 4px 14px 0 rgba(239, 68, 68, 0.39)' }}>
              End Call
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
