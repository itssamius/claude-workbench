import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import TitleBar from './components/TitleBar';
import SessionRail from './components/SessionRail';
import Conversation from './components/Conversation';
import ReviewPanel from './components/ReviewPanel';
import StatusBar from './components/StatusBar';
import DebugMenu from './components/DebugMenu';
import Onboarding from './components/Onboarding';
import SettingsOverlay from './components/Settings';
import { SESSIONS, TASK, DIFF_FILES } from './data/sample';
import type { Message, PlanItem, ToolCall } from './data/sample';
import type { AgentEvent } from './types/agent-events';

export default function App() {
  const [onboardingDone, setOnboardingDone] = useState(
    () => localStorage.getItem('workbench-profile') !== null
  );
  const [showSettings, setShowSettings] = useState(false);

  // ── Live agent state ──────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [diffFiles] = useState(DIFF_FILES); // keep static for file list
  const [diffPatch, setDiffPatch] = useState<string>('');
  const [isRunning, setIsRunning] = useState(false);
  const [taskTitle, setTaskTitle] = useState(TASK.title);

  // ── Submit handler ────────────────────────────────────────────────────────
  async function handleSubmit(prompt: string) {
    if (!prompt.trim() || isRunning) return;

    setIsRunning(true);
    setTaskTitle(prompt);

    // Add user message
    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      author: 'You',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: prompt,
    };
    setMessages((prev) => [...prev, userMsg]);

    // Get project path from saved profile, fallback to /tmp
    let projectPath = '/tmp';
    try {
      const raw = localStorage.getItem('workbench-profile');
      if (raw && raw !== 'saved') {
        const profile = JSON.parse(raw);
        if (profile.projectPath) projectPath = profile.projectPath;
      }
    } catch {
      // ignore
    }

    // Set up event listener before invoking so we don't miss early events
    const unlisten = await listen<AgentEvent>('agent-event', (event) => {
      const ev = event.payload;

      switch (ev.type) {
        case 'token': {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              return [
                ...prev.slice(0, -1),
                { ...last, content: (last.content ?? '') + ev.content },
              ];
            }
            // Start a new assistant message
            const assistantMsg: Message = {
              id: `msg-${Date.now()}-assistant`,
              role: 'assistant',
              author: 'Claude',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: ev.content,
            };
            return [...prev, assistantMsg];
          });
          break;
        }

        case 'plan': {
          const mapped: PlanItem[] = ev.items.map((item, i) => ({
            id: i + 1,
            status: item.status as 'pending' | 'active' | 'done',
            text: item.label,
          }));
          setPlanItems(mapped);
          // Insert a plan message if we don't already have one
          setMessages((prev) => {
            const hasPlan = prev.some((m) => m.role === 'plan');
            if (hasPlan) return prev;
            const planMsg: Message = {
              id: `msg-plan-${Date.now()}`,
              role: 'plan',
              author: 'Claude',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: "Here's my plan. I'll mark each step done as I go.",
              planItems: mapped,
              planLabel: `0 OF ${mapped.length} COMPLETE`,
            };
            return [...prev, planMsg];
          });
          break;
        }

        case 'tool': {
          if (ev.status === 'done') {
            // Update existing tool call status to done
            setToolCalls((prev) =>
              prev.map((tc) => (tc.id === ev.id ? { ...tc, status: 'done' } : tc))
            );
          } else if (ev.tool) {
            // New running tool call
            const tc: ToolCall = {
              id: ev.id,
              tool: ev.tool as ToolCall['tool'],
              path: ev.path,
              detail: ev.detail,
            };
            setToolCalls((prev) => {
              const exists = prev.find((t) => t.id === ev.id);
              if (exists) return prev;
              return [...prev, tc];
            });
            // Insert a tools message grouping
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === 'tools') {
                return [
                  ...prev.slice(0, -1),
                  { ...last, tools: [...(last.tools ?? []), tc] },
                ];
              }
              return [
                ...prev,
                {
                  id: `msg-tools-${Date.now()}`,
                  role: 'tools' as const,
                  tools: [tc],
                },
              ];
            });
          }
          break;
        }

        case 'diff': {
          setDiffPatch(ev.patch);
          break;
        }

        case 'done': {
          setIsRunning(false);
          unlisten();
          break;
        }

        case 'error': {
          const errMsg: Message = {
            id: `msg-err-${Date.now()}`,
            role: 'assistant',
            author: 'Claude',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `Error: ${ev.message}`,
          };
          setMessages((prev) => [...prev, errMsg]);
          setIsRunning(false);
          unlisten();
          break;
        }
      }
    });

    // Invoke the Rust command (returns immediately; agent runs in background)
    try {
      await invoke('start_task', { projectPath, prompt });
    } catch (err) {
      const errMsg: Message = {
        id: `msg-err-${Date.now()}`,
        role: 'assistant',
        author: 'Claude',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: `Failed to start task: ${String(err)}`,
      };
      setMessages((prev) => [...prev, errMsg]);
      setIsRunning(false);
      unlisten();
    }
  }

  if (!onboardingDone) {
    return <Onboarding onComplete={() => setOnboardingDone(true)} />;
  }

  const displayTask = { ...TASK, title: taskTitle };

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
        taskTitle={taskTitle}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <SessionRail sessions={SESSIONS} onSettingsOpen={() => setShowSettings(true)} />
        <Conversation
          task={displayTask}
          messages={messages}
          planItems={planItems}
          onSubmit={handleSubmit}
          isRunning={isRunning}
        />
        <ReviewPanel
          files={diffFiles}
          diffLines={[]}
          diffPatch={diffPatch}
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
