import { useState, useEffect } from "react";
import { checkClaudeVersion } from "../lib/tauri";
import { dbSaveSetting } from "../lib/tauri";
import { useSessionStore } from "../stores/sessionStore";
import { open } from "@tauri-apps/plugin-dialog";

interface Props {
  onComplete: () => void;
}

export function OnboardingModal({ onComplete }: Props) {
  const createSession = useSessionStore((s) => s.createSession);
  const [step, setStep] = useState(0);
  const [cliStatus, setCliStatus] = useState<"checking" | "found" | "missing">("checking");
  const [cliVersion, setCliVersion] = useState("");

  useEffect(() => {
    checkClaudeVersion()
      .then((version) => {
        setCliStatus("found");
        setCliVersion(version);
      })
      .catch(() => setCliStatus("missing"));
  }, []);

  async function handleCreateSession() {
    const dir = await open({ directory: true, multiple: false });
    if (dir) {
      await createSession(dir as string);
      await dbSaveSetting("onboarding_complete", "true");
      onComplete();
    }
  }

  async function handleSkip() {
    await dbSaveSetting("onboarding_complete", "true");
    onComplete();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl w-[480px] flex flex-col">
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Welcome to Claude Window
          </h2>
        </div>

        <div className="px-6 py-6">
          {step === 0 && (
            <div>
              <p className="text-sm text-[var(--text-primary)] mb-4">
                Claude Window lets you manage multiple Claude Code sessions, watch code changes in real-time, and review diffs — all in one app.
              </p>

              <div className="bg-[var(--bg-primary)] rounded-lg p-4 mb-4">
                <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                  Claude CLI Status
                </h3>
                {cliStatus === "checking" && (
                  <p className="text-sm text-[var(--text-secondary)]">Checking...</p>
                )}
                {cliStatus === "found" && (
                  <p className="text-sm text-green-400">
                    ✓ Claude CLI found ({cliVersion})
                  </p>
                )}
                {cliStatus === "missing" && (
                  <p className="text-sm text-[var(--error)]">
                    ✗ Claude CLI not found. Install it to use Claude Window.
                  </p>
                )}
              </div>

              <button
                onClick={() => setStep(1)}
                disabled={cliStatus === "missing"}
                className="w-full px-4 py-2 text-sm rounded bg-[var(--accent)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Get Started
              </button>
            </div>
          )}

          {step === 1 && (
            <div>
              <p className="text-sm text-[var(--text-primary)] mb-4">
                Select a project directory to start your first Claude Code session.
              </p>
              <button
                onClick={handleCreateSession}
                className="w-full px-4 py-2 text-sm rounded bg-[var(--accent)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity mb-2"
              >
                Choose Directory
              </button>
              <button
                onClick={handleSkip}
                className="w-full px-4 py-2 text-sm rounded border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Skip for now
              </button>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-[var(--border)] flex justify-center">
          <div className="flex gap-2">
            {[0, 1].map((i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full ${i === step ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
