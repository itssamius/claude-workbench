import { describe, it, expect, vi, beforeEach } from "vitest";
import { basename, tildeify, relativeTime, diffStats, deriveHeuristicTitle } from "../lib/utils";

describe("basename", () => {
  it("returns filename from absolute path", () => {
    expect(basename("/Users/sam/projects/foo")).toBe("foo");
  });
  it("strips trailing slashes", () => {
    expect(basename("/Users/sam/projects/foo/")).toBe("foo");
  });
  it("returns the input when no slash present", () => {
    expect(basename("myfile.ts")).toBe("myfile.ts");
  });
  it("handles empty string", () => {
    expect(basename("")).toBe("");
  });
});

describe("tildeify", () => {
  it("collapses /Users/<name> prefix to ~", () => {
    expect(tildeify("/Users/sam/workspace/foo")).toBe("~/workspace/foo");
  });
  it("collapses /home/<name> prefix to ~", () => {
    expect(tildeify("/home/sam/projects/bar")).toBe("~/projects/bar");
  });
  it("leaves paths outside home unchanged", () => {
    expect(tildeify("/etc/hosts")).toBe("/etc/hosts");
  });
  it("leaves already-collapsed paths unchanged", () => {
    expect(tildeify("~/foo")).toBe("~/foo");
  });
});

describe("relativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T12:00:00Z"));
  });

  it("returns 'now' for less than 1 minute ago", () => {
    const ts = Date.now() - 30_000;
    expect(relativeTime(ts)).toBe("now");
  });
  it("returns minutes for less than 1 hour ago", () => {
    const ts = Date.now() - 5 * 60_000;
    expect(relativeTime(ts)).toBe("5m");
  });
  it("returns hours for less than 24 hours ago", () => {
    const ts = Date.now() - 3 * 60 * 60_000;
    expect(relativeTime(ts)).toBe("3h");
  });
  it("returns days for 24+ hours ago", () => {
    const ts = Date.now() - 2 * 24 * 60 * 60_000;
    expect(relativeTime(ts)).toBe("2d");
  });
});

describe("diffStats", () => {
  it("counts additions and deletions", () => {
    const patch = `--- a/foo\n+++ b/foo\n+added line\n-removed line\n context`;
    expect(diffStats(patch)).toEqual({ additions: 1, deletions: 1 });
  });
  it("ignores +++ and --- header lines", () => {
    const patch = `--- a/foo\n+++ b/foo\n+real add`;
    expect(diffStats(patch)).toEqual({ additions: 1, deletions: 0 });
  });
  it("returns zeros for empty patch", () => {
    expect(diffStats("")).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("deriveHeuristicTitle", () => {
  it("strips common prefixes and title-cases", () => {
    expect(deriveHeuristicTitle("can you add a dark mode")).toBe("Add A Dark Mode");
  });
  it("truncates long prompts at 48 chars", () => {
    const long = "Fix the thing that is extremely long and goes on and on";
    expect(deriveHeuristicTitle(long).length).toBeLessThanOrEqual(48);
  });
  it("stops at the first sentence", () => {
    expect(deriveHeuristicTitle("Add tests. Also refactor.")).toBe("Add Tests");
  });
});
