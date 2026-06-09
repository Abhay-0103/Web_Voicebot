type AppHeaderProps = {
  status: string;
  isCalling: boolean;
};

export const AppHeader = ({ status, isCalling }: AppHeaderProps) => {
  return (
    <header className="app-header">
      <div>
        <h1>Garden City University</h1>
        <span>Reconnect&apos;26 Alumni Voicebot</span>
      </div>
      <div className="status-pill" data-active={isCalling}>
        ● {status.toUpperCase()}
      </div>
    </header>
  );
};
