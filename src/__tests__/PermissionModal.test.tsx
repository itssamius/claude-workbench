import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PermissionModal from "../components/PermissionModal";
import type { PermissionRequest } from "../types/permissions";

const request: PermissionRequest = {
  id: "perm-1",
  tool: "SHELL",
  path: "dist/",
  detail: "rm -rf dist",
  risk: "high",
};

describe("PermissionModal", () => {
  it("renders the tool, path, and command", () => {
    render(
      <PermissionModal
        request={request}
        onDeny={vi.fn()}
        onAllow={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />
    );
    expect(screen.getByText("SHELL")).toBeInTheDocument();
    expect(screen.getAllByText("dist/").length).toBeGreaterThan(0);
    expect(screen.getAllByText("rm -rf dist").length).toBeGreaterThan(0);
  });

  it("calls onDeny with the request id when Deny is clicked", async () => {
    const onDeny = vi.fn();
    render(
      <PermissionModal request={request} onDeny={onDeny} onAllow={vi.fn()} onAlwaysAllow={vi.fn()} />
    );
    await userEvent.click(screen.getByRole("button", { name: /deny/i }));
    expect(onDeny).toHaveBeenCalledWith("perm-1");
  });

  it("calls onAllow with the request id when Allow once is clicked", async () => {
    const onAllow = vi.fn();
    render(
      <PermissionModal request={request} onDeny={vi.fn()} onAllow={onAllow} onAlwaysAllow={vi.fn()} />
    );
    await userEvent.click(screen.getByRole("button", { name: /allow once/i }));
    expect(onAllow).toHaveBeenCalledWith("perm-1");
  });

  it("calls onAlwaysAllow with id, tool, and detail when Always allow is clicked", async () => {
    const onAlwaysAllow = vi.fn();
    render(
      <PermissionModal request={request} onDeny={vi.fn()} onAllow={vi.fn()} onAlwaysAllow={onAlwaysAllow} />
    );
    await userEvent.click(screen.getByRole("button", { name: /always allow in project/i }));
    expect(onAlwaysAllow).toHaveBeenCalledWith("perm-1", "SHELL", "rm -rf dist");
  });

  it("expands and collapses the why section", async () => {
    render(
      <PermissionModal request={request} onDeny={vi.fn()} onAllow={vi.fn()} onAlwaysAllow={vi.fn()} />
    );
    expect(screen.queryByText(/review the command carefully/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText(/why is claude asking/i));
    expect(screen.getByText(/review the command carefully/i)).toBeInTheDocument();
  });
});
