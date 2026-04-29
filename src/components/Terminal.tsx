import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface Props {
  /// Working directory for the shell. The PTY is opened in this directory.
  cwd: string;
  /// Existing terminal id to attach to. If absent, a new PTY is opened.
  terminalId?: string;
  /// Called once the terminal is ready, with the (possibly newly created) id.
  onReady?: (id: string) => void;
  /// Called when the underlying shell exits.
  onExit?: (id: string) => void;
}

interface TermOutputEvent { id: string; data: string }
interface TermExitEvent   { id: string; code: number | null }

const TERM_THEME = {
  background: '#1d1a14',
  foreground: '#e6dbc8',
  cursor:     '#e6dbc8',
  black:   '#2a241d', red:     '#cc6e5e', green:   '#7ab98a', yellow: '#d2b67c',
  blue:    '#6e9cb7', magenta: '#a98ab2', cyan:    '#5fa896', white:  '#e6dbc8',
  brightBlack:   '#5a5247', brightRed:     '#cc6e5e', brightGreen:   '#7ab98a',
  brightYellow:  '#d2b67c', brightBlue:    '#6e9cb7', brightMagenta: '#a98ab2',
  brightCyan:    '#5fa896', brightWhite:   '#fffdf9',
};

function decodeBase64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export default function Terminal({ cwd, terminalId, onReady, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(terminalId ?? null);

  useEffect(() => {
    let term: XTerm | null = null;
    let fitAddon: FitAddon | null = null;
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    let resizeObs: ResizeObserver | null = null;

    (async () => {
      const container = containerRef.current;
      if (!container) return;

      term = new XTerm({
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 12,
        theme: TERM_THEME,
        cursorBlink: true,
        scrollback: 5000,
        allowProposedApi: true,
      });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());
      term.open(container);
      try { fitAddon.fit(); } catch {}

      const cols = term.cols || 80;
      const rows = term.rows || 24;

      let id = idRef.current;
      if (!id) {
        const info = await invoke<{ id: string; cwd: string }>('term_open', {
          cwd, cols, rows,
        });
        if (cancelled) {
          await invoke('term_close', { id: info.id }).catch(() => {});
          return;
        }
        id = info.id;
        idRef.current = id;
        onReady?.(id);
      }

      const unlistenOut = await listen<TermOutputEvent>('term-output', (ev) => {
        if (ev.payload.id !== id) return;
        const bytes = decodeBase64ToBytes(ev.payload.data);
        term?.write(bytes);
      });
      const unlistenExit = await listen<TermExitEvent>('term-exit', (ev) => {
        if (ev.payload.id !== id) return;
        onExit?.(id!);
      });

      const dataDisposer = term.onData((data) => {
        const bytes = new TextEncoder().encode(data);
        invoke('term_write', { id, data: encodeBytesToBase64(bytes) }).catch(() => {});
      });

      resizeObs = new ResizeObserver(() => {
        try {
          fitAddon?.fit();
          if (id && term) invoke('term_resize', { id, cols: term.cols, rows: term.rows }).catch(() => {});
        } catch {}
      });
      resizeObs.observe(container);

      cleanup = () => {
        unlistenOut();
        unlistenExit();
        dataDisposer.dispose();
      };
    })();

    return () => {
      cancelled = true;
      resizeObs?.disconnect();
      cleanup?.();
      term?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: TERM_THEME.background,
        padding: 6,
        boxSizing: 'border-box',
      }}
    />
  );
}
