import { AppHeader } from './components/AppHeader';
import { CallControls } from './components/CallControls';
import { ConversationPanel } from './components/ConversationPanel';
import { VoiceVisualizer } from './components/VoiceVisualizer';
import { useVoiceCall } from './hooks/useVoiceCall';
import './styles/app.css';

const App = () => {
  const {
    isCalling,
    transcript,
    status,
    isBotSpeaking,
    volume,
    startCall,
    stopCall,
  } = useVoiceCall();

  return (
    <div className="app-shell">
      <AppHeader status={status} isCalling={isCalling} />
      <main className="app-body">
        <VoiceVisualizer isCalling={isCalling} isBotSpeaking={isBotSpeaking} volume={volume} />
        <ConversationPanel transcript={transcript} isBotSpeaking={isBotSpeaking} />
        <CallControls isCalling={isCalling} onStart={startCall} onStop={stopCall} />
      </main>
    </div>
  );
};

export default App;
