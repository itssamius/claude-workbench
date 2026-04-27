import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  onComplete: () => void;
}

// ── Traffic lights (shared) ──────────────────────────────────────────────────
function TrafficLights() {
  return (
    <div
      data-tauri-drag-region
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        paddingLeft: 16,
        paddingTop: 16,
        paddingBottom: 4,
        flexShrink: 0,
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#FF5F57' }} />
      <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#FEBC2E' }} />
      <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#28C840' }} />
    </div>
  );
}

// ── Step rail ────────────────────────────────────────────────────────────────
const STEPS = ['Welcome', 'Account', 'Project', 'First task'] as const;

function StepRail({ current }: { current: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', paddingLeft: 16, paddingRight: 16 }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-mute)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        Setup &nbsp;·&nbsp; {current + 1} of {STEPS.length}
      </div>
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 8px',
              borderRadius: 6,
              background: active ? 'var(--accent-soft)' : 'transparent',
            }}
          >
            {/* step indicator */}
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: done ? 'var(--accent)' : active ? 'var(--accent)' : 'transparent',
                border: done || active ? 'none' : '1.5px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {done ? (
                // checkmark SVG
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5.5L4 7.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    fontWeight: 600,
                    color: active ? '#fff' : 'var(--text-mute)',
                    lineHeight: 1,
                  }}
                >
                  {i + 1}
                </span>
              )}
            </div>
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                fontWeight: active ? 500 : 400,
                color: active ? 'var(--text)' : done ? 'var(--text-dim)' : 'var(--text-mute)',
              }}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Left panel ───────────────────────────────────────────────────────────────
function LeftPanel({ step }: { step: number }) {
  return (
    <div
      style={{
        width: 228,
        minWidth: 228,
        height: '100vh',
        background: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      <TrafficLights />

      {/* Brand */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          paddingLeft: 16,
          paddingTop: 16,
          paddingBottom: 20,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 15,
              fontWeight: 700,
              color: '#fff',
              lineHeight: 1,
            }}
          >
            W
          </span>
        </div>
        <span
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text)',
          }}
        >
          Workbench
        </span>
      </div>

      {/* Step rail */}
      <StepRail current={step} />

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Tagline */}
      <div
        style={{
          paddingLeft: 16,
          paddingRight: 16,
          paddingBottom: 24,
          fontFamily: 'var(--font-serif)',
          fontSize: 12,
          fontStyle: 'italic',
          color: 'var(--text-mute)',
        }}
      >
        "Your workbench, your tempo. Claude does the heavy lifting."
      </div>
    </div>
  );
}

// ── Screen layout wrapper ────────────────────────────────────────────────────
interface ScreenProps {
  step: number;
  eyebrow: string;
  headline: string;
  lede: string;
  children: React.ReactNode;
  onBack?: () => void;
  onCta: () => void;
  ctaLabel: string;
  secondaryLabel?: string;
  onSecondary?: () => void;
  footerLeft?: React.ReactNode;
}

function Screen({
  step,
  eyebrow,
  headline,
  lede,
  children,
  onBack,
  onCta,
  ctaLabel,
  secondaryLabel,
  onSecondary,
  footerLeft,
}: ScreenProps) {
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden' }}>
      <LeftPanel step={step} />

      {/* Right panel */}
      <div
        style={{
          flex: 1,
          background: 'var(--bg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Content area */}
        <div style={{ flex: 1, padding: 48, overflowY: 'auto' }}>
          {/* Eyebrow */}
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-mute)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: 12,
            }}
          >
            {eyebrow}
          </div>

          {/* H1 */}
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 28,
              fontWeight: 400,
              color: 'var(--text)',
              lineHeight: 1.25,
              marginBottom: 12,
            }}
          >
            {headline}
          </h1>

          {/* Lede */}
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 14,
              color: 'var(--text-dim)',
              lineHeight: 1.6,
              marginBottom: 32,
              maxWidth: 480,
            }}
          >
            {lede}
          </p>

          {children}
        </div>

        {/* Footer */}
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          {/* Footer left */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {footerLeft}
            {onBack && (
              <button
                onClick={onBack}
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  color: 'var(--text-mute)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '6px 0',
                }}
              >
                ← Back
              </button>
            )}
          </div>

          {/* Footer right */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {secondaryLabel && onSecondary && (
              <button
                onClick={onSecondary}
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  color: 'var(--text-mute)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '6px 0',
                }}
              >
                {secondaryLabel}
              </button>
            )}
            <button
              onClick={onCta}
              style={{
                height: 32,
                padding: '0 18px',
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                fontWeight: 500,
                color: '#fff',
                background: 'var(--green)',
                border: 'none',
                borderRadius: 7,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {ctaLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Screen 1: Welcome ─────────────────────────────────────────────────────────
const FEATURE_CARDS = [
  {
    icon: '⟳',
    title: 'Run agents on real codebases',
    desc: 'Connect a repo and let Claude refactor, fix, or build features end-to-end.',
  },
  {
    icon: '◈',
    title: 'Review every change',
    desc: 'Inline diffs, plan tracking, and one-click commit when you\'re happy.',
  },
  {
    icon: '⊞',
    title: 'Many tasks at once',
    desc: 'Background long jobs and check in when they\'re ready for review.',
  },
  {
    icon: '◧',
    title: 'Bring your own tools',
    desc: 'MCP servers, custom slash commands, your editor of choice.',
  },
];

function WelcomeScreen({ onNext }: { onNext: () => void }) {
  return (
    <Screen
      step={0}
      eyebrow="Welcome"
      headline="A workbench for coding with Claude."
      lede="Workbench is a desktop app for running Claude Code agents on your projects — review diffs, manage long-running tasks, and ship from the same window."
      onCta={onNext}
      ctaLabel="Get started →"
      secondaryLabel="I have an account →"
      onSecondary={onNext}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          maxWidth: 560,
        }}
      >
        {FEATURE_CARDS.map((card) => (
          <div
            key={card.title}
            style={{
              background: 'var(--bg-paper)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 16,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text)',
                marginBottom: 6,
              }}
            >
              {card.title}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 12,
                color: 'var(--text-dim)',
                lineHeight: 1.55,
              }}
            >
              {card.desc}
            </div>
          </div>
        ))}
      </div>
    </Screen>
  );
}

// ── Screen 2: Sign In ─────────────────────────────────────────────────────────
function SignInScreen({
  onNext,
  onBack,
}: {
  onNext: (apiKey?: string) => void;
  onBack: () => void;
}) {
  const [apiKey, setApiKey] = useState('');

  return (
    <Screen
      step={1}
      eyebrow="Step 2 of 4 — Sign In"
      headline="Connect your account"
      lede="Sign in with your Anthropic account or paste an API key."
      onBack={onBack}
      onCta={() => onNext(apiKey)}
      ctaLabel="Continue →"
    >
      <div style={{ maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* OAuth button */}
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            height: 44,
            width: '100%',
            background: 'var(--bg-paper)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--text)',
            cursor: 'pointer',
          }}
        >
          {/* Anthropic logo placeholder */}
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 11, color: '#fff', fontWeight: 700 }}>A</span>
          </div>
          Continue with Anthropic
        </button>

        {/* Divider */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              color: 'var(--text-mute)',
            }}
          >
            or
          </span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        {/* API key input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-dim)',
            }}
          >
            API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
            style={{
              height: 36,
              padding: '0 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--text)',
              background: 'var(--bg-paper)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              outline: 'none',
              width: '100%',
            }}
          />
        </div>

        {/* Skip link */}
        <button
          onClick={() => onNext(apiKey)}
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            color: 'var(--text-mute)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            padding: 0,
          }}
        >
          Skip for now →
        </button>
      </div>
    </Screen>
  );
}

// ── Screen 3: Open Project ────────────────────────────────────────────────────
function OpenProjectScreen({
  onNext,
  onBack,
}: {
  onNext: (path?: string) => void;
  onBack: () => void;
}) {
  const [chosen, setChosen] = useState('');

  async function handleChoose() {
    const dir = await invoke<string | null>('choose_directory');
    if (dir) setChosen(dir);
  }

  return (
    <Screen
      step={2}
      eyebrow="Step 3 of 4 — Open Project"
      headline="Open a project directory"
      lede="Point Claude Workbench at a git repository to get started."
      onBack={onBack}
      onCta={() => onNext(chosen)}
      ctaLabel="Continue →"
    >
      <div style={{ maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Drop zone */}
        <div
          style={{
            border: '2px dashed var(--border)',
            borderRadius: 12,
            height: 80,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            background: chosen ? 'var(--accent-soft)' : 'transparent',
          }}
        >
          {chosen ? (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--accent)',
              }}
            >
              {chosen}
            </span>
          ) : (
            <>
              {/* Folder icon */}
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M3 5.5A1.5 1.5 0 014.5 4h3.086a1.5 1.5 0 011.06.44l.915.914A1.5 1.5 0 0010.621 6H15.5A1.5 1.5 0 0117 7.5v7A1.5 1.5 0 0115.5 16h-11A1.5 1.5 0 013 14.5v-9z"
                  stroke="var(--text-mute)"
                  strokeWidth="1.25"
                  fill="none"
                />
              </svg>
              <button
                onClick={() => { handleChoose(); }}
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--accent)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Choose Directory
              </button>
            </>
          )}
        </div>

        {/* Skip link */}
        <button
          onClick={() => onNext(chosen)}
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            color: 'var(--text-mute)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            padding: 0,
          }}
        >
          Skip for now →
        </button>
      </div>
    </Screen>
  );
}

// ── Screen 4: First Task ──────────────────────────────────────────────────────
const STARTERS = [
  'Explain this codebase',
  'Add tests for files without coverage',
  'Find and fix any TODOs',
  'Upgrade outdated dependencies',
];

function FirstTaskScreen({
  onComplete,
  onBack,
}: {
  onComplete: (task: string) => void;
  onBack: () => void;
}) {
  const [task, setTask] = useState('');

  function handleComplete() {
    onComplete(task.trim() || 'Explore the codebase');
  }

  return (
    <Screen
      step={3}
      eyebrow="Almost there"
      headline="What should Claude do first?"
      lede="Type a task or pick a starter. Workbench will create a branch and start working in the background."
      onBack={onBack}
      onCta={handleComplete}
      ctaLabel="Start working →"
      secondaryLabel="I'll explore first →"
      onSecondary={handleComplete}
    >
      <div style={{ maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Textarea */}
        <div
          style={{
            background: 'var(--bg-paper)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 14,
          }}
        >
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="e.g. Add user authentication with JWT tokens..."
            rows={4}
            style={{
              width: '100%',
              resize: 'none',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              color: 'var(--text)',
              lineHeight: 1.55,
            }}
          />
          {/* Simulated git branch indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 8,
              paddingTop: 8,
              borderTop: '1px solid var(--border)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-mute)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="3" cy="3" r="1.5" stroke="currentColor" strokeWidth="1" />
                <circle cx="9" cy="9" r="1.5" stroke="currentColor" strokeWidth="1" />
                <circle cx="9" cy="3" r="1.5" stroke="currentColor" strokeWidth="1" />
                <path d="M3 4.5V6a3 3 0 003 3h3" stroke="currentColor" strokeWidth="1" />
                <path d="M9 4.5V7.5" stroke="currentColor" strokeWidth="1" />
              </svg>
              <span style={{ color: 'var(--text-dim)' }}>main</span>
              <span style={{ color: 'var(--text-mute)' }}>→</span>
              <span style={{ color: 'var(--accent)' }}>feat/new-task</span>
            </div>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--text-mute)' }}>
              Sonnet 4.5 · Conservative
            </span>
          </div>
        </div>

        {/* Starters */}
        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-mute)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            Or try a starter
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
            }}
          >
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => setTask(s)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  background: 'var(--bg-paper)',
                  border: '1px solid var(--border)',
                  borderRadius: 7,
                  fontFamily: 'var(--font-sans)',
                  fontSize: 12,
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ color: 'var(--accent)', fontSize: 10 }}>✦</span>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Screen>
  );
}

// ── Root Onboarding component ────────────────────────────────────────────────
export default function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [projectPath, setProjectPath] = useState('');

  async function handleComplete(taskDescription: string) {
    const profile = {
      accountId: 'user@example.com',
      projectPath: projectPath || '/tmp',
      defaultModel: 'claude-sonnet-4-6',
      apiKey,
      taskDescription,
    };
    try {
      await invoke('save_profile', { data: JSON.stringify(profile) });
    } catch {
      // Fallback: if Tauri command fails (e.g. in dev/browser), ignore silently
    }
    localStorage.setItem('workbench-profile', 'saved'); // keep as gate check
    onComplete();
  }

  switch (step) {
    case 0:
      return <WelcomeScreen onNext={() => setStep(1)} />;
    case 1:
      return (
        <SignInScreen
          onNext={(key) => { setApiKey(key ?? ''); setStep(2); }}
          onBack={() => setStep(0)}
        />
      );
    case 2:
      return (
        <OpenProjectScreen
          onNext={(path) => { setProjectPath(path ?? ''); setStep(3); }}
          onBack={() => setStep(1)}
        />
      );
    case 3:
      return <FirstTaskScreen onComplete={handleComplete} onBack={() => setStep(2)} />;
    default:
      return <WelcomeScreen onNext={() => setStep(1)} />;
  }
}
