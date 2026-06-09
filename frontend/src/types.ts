export type TranscriptEntry = {
  role: 'You' | 'Poonam';
  text: string;
  time: string;
};

export type ServerMessage =
  | { type: 'audio'; audio: string; text?: string; language?: string }
  | { type: 'assistant_text'; text: string }
  | { type: 'transcript'; role?: string; text: string }
  | { type: 'status'; text: string }
  | { type: 'error'; message: string };
