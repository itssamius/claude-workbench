import { useState } from 'react';
import TitleBar from './components/TitleBar';
import SessionRail from './components/SessionRail';
import Conversation from './components/Conversation';
import ReviewPanel from './components/ReviewPanel';
import StatusBar from './components/StatusBar';
import DebugMenu from './components/DebugMenu';
import Onboarding from './components/Onboarding';
import SettingsOverlay from './components/Settings';
import { SESSIONS, TASK, MESSAGES, DIFF_FILES, DIFF_LINES } from './data/sample';

export default function App() {
  const [onboardingDone, setOnboardingDone] = useState(
    () => localStorage.getItem('workbench-profile') !== null
  );
  const [showSettings, setShowSettings] = useState(false);

  if (!onboardingDone) {
    return <Onboarding onComplete={() => setOnboardingDone(true)} />;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      <TitleBar
        project={TASK.project}
        branch={TASK.branch}
        taskTitle={TASK.title}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <SessionRail sessions={SESSIONS} onSettingsOpen={() => setShowSettings(true)} />
        <Conversation task={TASK} messages={MESSAGES} />
        <ReviewPanel
          files={DIFF_FILES}
          diffLines={DIFF_LINES}
          totalAdditions={TASK.additions}
          totalDeletions={TASK.deletions}
        />
      </div>

      <StatusBar
        branch={TASK.branch}
        tokens={15420}
        cost="0.18"
        version="0.42.1"
        testsTotal={4}
        testsPassed={4}
        migrationsPending={1}
      />

      <DebugMenu />

      {showSettings && (
        <SettingsOverlay onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
