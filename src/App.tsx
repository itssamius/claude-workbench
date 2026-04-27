import { useState, useEffect } from 'react';
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
import PermissionBanner from './components/PermissionBanner';
import PermissionModal from './components/PermissionModal';
import { SESSIONS, TASK, DIFF_FILES } from './data/sample';
import type { Message, PlanItem, ToolCall } from './data/sample';
import type { AgentEvent } from './types/agent-events';
import type { PermissionRequest } from './types/permissions';

export default function App() {
  // Onboarding gate: null = loading, false = needs onboarding, true = done
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Profile data (loaded from ~/.workbench/profile.json)
  const [projectPath, setProjectPath] = useState('/tmp');
  const [apiKey, setApiKey] = useState('');

  // Live agent state
  const [messages, setMessages] = useState<Message[]>([]);
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [diffPatch, setDiffPatch] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [taskTitle, setTaskTitle] = useState(TASK.title);

  // Permission state
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);

  // ── Load profile on startup ────────────────────────────────────────────────
  useEffect(() => {
    invoke<string | null>('load_profile')
      .then((raw) => {
        if (raw) {
          try {
            const profile = JSON.parse(raw);
            if (profile.projectPath) setProjectPath(profile.projectPath);
            if (profile.apiKey) setApiKey(profile.apiKey);
            // Mark onboarding done if we have a project path
            setOnboardingDone(!!profile.projectPath);
            return;
          } catch {}
        }
        // Fall back to localStorage gate check
        setOnboardingDone(localStorage.getItem('workbench-profile') !== null);
      })
      .catch(() => {
        setOnboardingDone(localStorage.getItem('workbench-profile') !== null);
      });
  }, []);

  // ── Submit handler ─────────────────────────────────────────────────────────
  async function handleSubmit(prompt: string) {
    if (!prompt.trim() || isRunning) return;

    setIsRunning(true);
    setTaskTitle(prompt);

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      author: 'You',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: prompt,
    };
    setMessages((prev) => [...prev, userMsg]);

    // Resolve API key: use profile key or ANTHROPIC_API_KEY (env not accessible
    // in renderer — the Rust side will also check env as fallback)
    const effectiveApiKey = apiKey || '';

    const unlisten = await listen<AgentEvent>('agent-event', (event) => {
      const ev = event.payload;
      switch (ev.type) {
        case 'token': {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), { ...last, content: (last.content ?? '') + ev.content }];
            }
            return [...prev, {
              id: `msg-${Date.now()}-a`,
              role: 'assistant' as const,
              author: 'Claude',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: ev.content,
            }];
          });
          break;
        }
        case 'plan': {
          const mapped: PlanItem[] = ev.items.map((item, i) => ({
            id: i + 1,
            status: item.status as PlanItem['status'],
            text: item.label,
          }));
          setPlanItems(mapped);
          setMessages((prev) => {
            if (prev.some((m) => m.role === 'plan')) return prev;
            return [...prev, {
              id: `msg-plan-${Date.now()}`,
              role: 'plan' as const,
              author: 'Claude',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: "Here's my plan. I'll mark each step done as I go.",
              planItems: mapped,
              planLabel: `0 OF ${mapped.length} COMPLETE`,
            }];
          });
          break;
        }
        case 'tool': {
          if (ev.status === 'done') {
            setToolCalls((prev) => prev.map((tc) => tc.id === ev.id ? { ...tc } : tc));
          } else if (ev.tool) {
            const tc: ToolCall = {
              id: ev.id,
              tool: ev.tool as ToolCall['tool'],
              path: ev.path,
              detail: ev.detail,
            };
            setToolCalls((prev) => prev.some((t) => t.id === ev.id) ? prev : [...prev, tc]);
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === 'tools') {
                return [...prev.slice(0, -1), { ...last, tools: [...(last.tools ?? []), tc] }];
              }
              return [...prev, { id: `msg-tools-${Date.now()}`, role: 'tools' as const, tools: [tc] }];
            });
          }
          break;
        }
        case 'diff': {
          setDiffPatch(ev.patch);
          break;
        }
        case 'permission': {
          const req: PermissionRequest = {
            id: ev.id,
            tool: ev.tool,
            path: ev.path,
            detail: ev.detail,
            risk: ev.risk,
          };
          setPendingPermissions((prev) => [...prev, req]);
          break;
        }
        case 'done': {
          setIsRunning(false);
          unlisten();
          break;
        }
        case 'error': {
          setMessages((prev) => [...prev, {
            id: `msg-err-${Date.now()}`,
            role: 'assistant' as const,
            author: 'Claude',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `Error: ${ev.message}`,
          }]);
          setIsRunning(false);
          unlisten();
          break;
        }
      }
    });

    try {
      await invoke('start_task', { projectPath, prompt, apiKey: effectiveApiKey });
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: `msg-err-${Date.now()}`,
        role: 'assistant' as const,
        author: 'Claude',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: `Failed to start task: ${String(err)}`,
      }]);
      setIsRunning(false);
      unlisten();
    }
  }

  // ── Permission handlers ────────────────────────────────────────────────────
  function dismissPermission(id: string) {
    setPendingPermissions((prev) => prev.filter((p) => p.id !== id));
  }

  async function handlePermAllow(id: string) {
    await invoke('resolve_permission', { id, allow: true, always: false });
    dismissPermission(id);
  }

  async function handlePermDeny(id: string) {
    await invoke('resolve_permission', { id, allow: false, always: false });
    dismissPermission(id);
  }

  async function handlePermAlwaysAllow(id: string, tool: string, pattern: string) {
    await invoke('save_policy', { projectPath, tool, pattern });
    await invoke('resolve_permission', { id, allow: true, always: true });
    dismissPermission(id);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (onboardingDone === null) {
    return (
      <div style={{ height: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-mute)' }}>Loading…</span>
      </div>
    );
  }

  if (!onboardingDone) {
    return (
      <Onboarding
        onComplete={() => {
          // Re-load profile after onboarding saves it
          invoke<string | null>('load_profile').then((raw) => {
            if (raw) {
              try {
                const p = JSON.parse(raw);
                if (p.projectPath) setProjectPath(p.projectPath);
                if (p.apiKey) setApiKey(p.apiKey);
              } catch {}
            }
          });
          setOnboardingDone(true);
        }}
      />
    );
  }

  const displayTask = { ...TASK, title: taskTitle };

  // Separate low-risk banners from high-risk modals
  const lowRiskPerms  = pendingPermissions.filter((p) => p.risk === 'low');
  const highRiskPerms = pendingPermissions.filter((p) => p.risk === 'high');

  // Suppress unused variable warning — toolCalls used by ReviewPanel in future
  void toolCalls;
  void planItems;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)', overflow: 'hidden' }}>
      <TitleBar project={TASK.project} branch={TASK.branch} taskTitle={taskTitle} />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <SessionRail sessions={SESSIONS} onSettingsOpen={() => setShowSettings(true)} />
        <Conversation
          task={displayTask}
          messages={messages}
          planItems={planItems}
          onSubmit={handleSubmit}
          isRunning={isRunning}
          permissionBanners={lowRiskPerms.map((req) => (
            <PermissionBanner
              key={req.id}
              request={req}
              onAllow={handlePermAllow}
              onDeny={handlePermDeny}
            />
          ))}
        />
        <ReviewPanel
          files={DIFF_FILES}
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

      {/* High-risk permission modals — show the first one */}
      {highRiskPerms[0] && (
        <PermissionModal
          request={highRiskPerms[0]}
          onDeny={handlePermDeny}
          onAllow={handlePermAllow}
          onAlwaysAllow={handlePermAlwaysAllow}
        />
      )}

      {showSettings && <SettingsOverlay onClose={() => setShowSettings(false)} />}
    </div>
  );
}
