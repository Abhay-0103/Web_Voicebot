type VoiceVisualizerProps = {
  isCalling: boolean;
  isBotSpeaking: boolean;
  volume: number;
};

export const VoiceVisualizer = ({ isCalling, isBotSpeaking, volume }: VoiceVisualizerProps) => {
  if (!isCalling) {
    return <div className="voice-visualizer-spacer" />;
  }

  return (
    <div className="voice-visualizer">
      <div
        className="voice-visualizer-ring"
        style={{
          width: `${60 + volume * 0.8}px`,
          height: `${60 + volume * 0.8}px`,
          backgroundColor: isBotSpeaking ? '#3b82f6' : '#22c55e',
        }}
      />
      <div className="voice-visualizer-core" data-speaking={isBotSpeaking}>
        {isBotSpeaking ? '👩‍💼' : '🎤'}
      </div>
    </div>
  );
};
