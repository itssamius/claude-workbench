import { describe, it, expect } from "vitest";
import { restoreSession, AVATAR_COLORS } from "../lib/session";

describe("restoreSession", () => {
  it("always restores taskState as idle", () => {
    const s = restoreSession({ id: "s1", taskState: "working" }, 0);
    expect(s.taskState).toBe("idle");
  });

  it("always restores isRunning as false", () => {
    const s = restoreSession({ id: "s1", isRunning: true }, 0);
    expect(s.isRunning).toBe(false);
  });

  it("fills missing fields with defaults", () => {
    const s = restoreSession({}, 0);
    expect(s.title).toBe("New task");
    expect(s.model).toBe("sonnet");
    expect(s.messages).toEqual([]);
    expect(s.planItems).toEqual([]);
    expect(s.toolCalls).toEqual([]);
    expect(s.diffPatch).toBe("");
    expect(s.panelActive).toBe("review");
    expect(s.panelCollapsed).toBe(false);
    expect(s.panelTabs).toEqual([]);
    expect(s.terminals).toEqual([]);
    expect(s.activeTerminalKey).toBeNull();
    expect(s.titleLocked).toBe(false);
    expect(s.summarizedAtTurn).toBe(0);
  });

  it("uses AVATAR_COLORS by index for missing avatarBg", () => {
    const s0 = restoreSession({}, 0);
    const s1 = restoreSession({}, 1);
    expect(s0.avatarBg).toBe(AVATAR_COLORS[0]);
    expect(s1.avatarBg).toBe(AVATAR_COLORS[1]);
  });

  it("preserves worktreePath and worktreeBranch", () => {
    const s = restoreSession({ worktreePath: "/tmp/wb-abc", worktreeBranch: "wb/abc" }, 0);
    expect(s.worktreePath).toBe("/tmp/wb-abc");
    expect(s.worktreeBranch).toBe("wb/abc");
  });

  it("preserves claudeSessionId when it is a string", () => {
    const s = restoreSession({ claudeSessionId: "claude-xyz" }, 0);
    expect(s.claudeSessionId).toBe("claude-xyz");
  });

  it("drops claudeSessionId when it is not a string", () => {
    const s = restoreSession({ claudeSessionId: 123 }, 0);
    expect(s.claudeSessionId).toBeUndefined();
  });

  it("maps terminal entries, setting activeTerminalKey to first key", () => {
    const s = restoreSession(
      { id: "s1", terminals: [{ cwd: "/home/user" }, { cwd: "/tmp" }] },
      0,
    );
    expect(s.terminals).toHaveLength(2);
    expect(s.terminals[0].cwd).toBe("/home/user");
    expect(s.terminals[1].cwd).toBe("/tmp");
    expect(s.activeTerminalKey).toBe(s.terminals[0].localKey);
  });

  it("filters non-string values out of panelTabs", () => {
    const s = restoreSession({ panelTabs: ["/foo.ts", 42, null, "/bar.ts"] }, 0);
    expect(s.panelTabs).toEqual(["/foo.ts", "/bar.ts"]);
  });

  it("defaults model to 'sonnet' for empty or non-string values", () => {
    expect(restoreSession({ model: "" }, 0).model).toBe("sonnet");
    expect(restoreSession({ model: null }, 0).model).toBe("sonnet");
    expect(restoreSession({ model: "opus" }, 0).model).toBe("opus");
  });
});
