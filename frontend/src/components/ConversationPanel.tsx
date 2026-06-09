import { useEffect, useRef } from 'react';
import type { TranscriptEntry } from '../types';

type ConversationPanelProps = {
  transcript: TranscriptEntry[];
  isBotSpeaking: boolean;
};

export const ConversationPanel = ({ transcript, isBotSpeaking }: ConversationPanelProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript]);

  return (
    <section ref={scrollRef} className="conversation-panel">
      {transcript.length === 0 && (
        <p className="conversation-empty">Your conversation will appear here...</p>
      )}

      {transcript.map((msg, index) => (
        <div key={`${msg.time}-${index}`} className="conversation-item">
          <div className="conversation-meta">
            {msg.role} • {msg.time}
          </div>
          <div className="conversation-bubble">{msg.text}</div>
        </div>
      ))}

      {isBotSpeaking && <div className="bot-speaking">Poonam is speaking...</div>}
    </section>
  );
};
