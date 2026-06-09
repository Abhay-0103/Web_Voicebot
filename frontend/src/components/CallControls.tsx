type CallControlsProps = {
  isCalling: boolean;
  onStart: () => void;
  onStop: () => void;
};

export const CallControls = ({ isCalling, onStart, onStop }: CallControlsProps) => {
  return (
    <div className="call-controls">
      {!isCalling ? (
        <button onClick={onStart} className="call-button call-button-start">
          Start Voice Call
        </button>
      ) : (
        <button onClick={onStop} className="call-button call-button-stop">
          End Call
        </button>
      )}
    </div>
  );
};
