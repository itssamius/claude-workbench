import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { spawnTerminal, sendTerminalInput, resizeTerminal, closeTerminal, Channel } from "../lib/tauri";
import type { PtyEvent } from "../lib/types";

interface IntegratedTerminalProps {
  sessionId: string;
  workingDir: string;
}

export function IntegratedTerminal({ sessionId, workingDir }: IntegratedTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const spawnedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    if (spawnedRef.current) return;
    spawnedRef.current = true;

    const termId = crypto.randomUUID();

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Menlo', 'Monaco', 'Cascadia Code', monospace",
      scrollback: 10000,
      theme: {
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        selectionBackground: "#585b7066",
        black: "#45475a",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        blue: "#89b4fa",
        magenta: "#f5c2e7",
        cyan: "#94e2d5",
        white: "#bac2de",
        brightBlack: "#585b70",
        brightRed: "#f38ba8",
        brightGreen: "#a6e3a1",
        brightYellow: "#f9e2af",
        brightBlue: "#89b4fa",
        brightMagenta: "#f5c2e7",
        brightCyan: "#94e2d5",
        brightWhite: "#a6adc8",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // Canvas fallback
    }

    fitAddon.fit();

    const channel = new Channel<PtyEvent>();
    channel.onmessage = (event) => {
      if (event.event === "output") {
        term.write(event.data.data);
      }
    };

    spawnTerminal(termId, workingDir, channel).catch(console.error);

    const inputDisposable = term.onData((data) => {
      sendTerminalInput(termId, data).catch(console.error);
    });

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      resizeTerminal(termId, rows, cols).catch(console.error);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      closeTerminal(termId).catch(console.error);
      term.dispose();
    };
  }, [sessionId, workingDir]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ padding: "4px" }}
    />
  );
}
