import TitleBar from './components/TitleBar';
import SessionRail from './components/SessionRail';
import Conversation from './components/Conversation';
import ReviewPanel from './components/ReviewPanel';
import StatusBar from './components/StatusBar';
import { SESSIONS, TASK, MESSAGES, DIFF_FILES, DIFF_LINES } from './data/sample';

export default function App() {

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
        <SessionRail sessions={SESSIONS} />
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
    </div>
  );
}
