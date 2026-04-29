import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CommitModal from "../components/CommitModal";

describe("CommitModal", () => {
  it("renders with the default message in the textarea", () => {
    render(<CommitModal defaultMessage="Initial commit" onCommit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("textbox")).toHaveValue("Initial commit");
  });

  it("submits with the default message when unmodified", async () => {
    const onCommit = vi.fn();
    render(<CommitModal defaultMessage="feat: add thing" onCommit={onCommit} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /commit/i }));
    expect(onCommit).toHaveBeenCalledWith("feat: add thing");
  });

  it("submits the edited message", async () => {
    const onCommit = vi.fn();
    render(<CommitModal defaultMessage="draft" onCommit={onCommit} onCancel={vi.fn()} />);
    const textarea = screen.getByRole("textbox");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "fix: corrected message");
    await userEvent.click(screen.getByRole("button", { name: /commit/i }));
    expect(onCommit).toHaveBeenCalledWith("fix: corrected message");
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    render(<CommitModal defaultMessage="" onCommit={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
