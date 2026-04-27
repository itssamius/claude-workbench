import { useState } from 'react'
import type { PermissionRequest } from '../types/permissions'

export const MOCK_HIGH_RISK_REQUEST: PermissionRequest = {
  id: 'perm-2',
  tool: 'SHELL',
  path: 'dist/',
  detail: 'rm -rf dist',
  risk: 'high',
}

interface PermissionModalProps {
  request: PermissionRequest
  onDeny: (id: string) => void
  onAllow: (id: string) => void
  onAlwaysAllow: (id: string, tool: string, pattern: string) => void
}

export default function PermissionModal({
  request,
  onDeny,
  onAllow,
  onAlwaysAllow,
}: PermissionModalProps) {
  const [whyExpanded, setWhyExpanded] = useState(false)

  return (
    /* Fixed overlay */
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      {/* Card */}
      <div
        style={{
          width: 480,
          background: 'var(--bg-paper)',
          borderRadius: 12,
          border: '1px solid var(--border)',
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0,0,0,0.30)',
        }}
      >
        {/* Header band */}
        <div
          style={{
            background: 'var(--red)',
            padding: '14px 20px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          {/* Warning icon */}
          <div
            style={{
              width: 24,
              height: 24,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.20)" />
              <path
                d="M12 7v6M12 16.5v.5"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>

          <div>
            <div
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 15,
                fontWeight: 600,
                color: '#fff',
                lineHeight: 1.3,
                marginBottom: 3,
              }}
            >
              Permission required
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  color: 'rgba(255,255,255,0.85)',
                  lineHeight: 1.4,
                  flex: 1,
                }}
              >
                Claude wants to run a command that cannot be undone.
              </div>
              <span
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--red)',
                  background: '#fff',
                  borderRadius: 4,
                  padding: '2px 7px',
                  flexShrink: 0,
                }}
              >
                DESTRUCTIVE
              </span>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>
          {/* Tool + path row */}
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              display: 'flex',
              alignItems: 'baseline',
              gap: 6,
            }}
          >
            <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{request.tool}</span>
            <span style={{ color: 'var(--text-mute)' }}>·</span>
            <span style={{ color: 'var(--text)' }}>{request.path}</span>
          </div>

          {/* Command block */}
          <div
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 12,
              marginTop: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                color: 'var(--text-mute)',
                flexShrink: 0,
              }}
            >
              $
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                color: 'var(--text)',
                wordBreak: 'break-all',
              }}
            >
              {request.detail}
            </span>
          </div>

          {/* Warning detail block */}
          <div
            style={{
              marginTop: 12,
              padding: '10px 14px',
              background: 'var(--red-bg)',
              border: '1px solid rgba(160, 57, 47, 0.25)',
              borderRadius: 7,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            <div
              style={{
                width: 16,
                height: 16,
                flexShrink: 0,
                marginTop: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" fill="var(--red)" opacity="0.15" />
                <circle cx="8" cy="8" r="6.5" stroke="var(--red)" strokeOpacity="0.4" />
                <path
                  d="M8 5v4M8 10.5v.5"
                  stroke="var(--red)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                color: 'var(--text-dim)',
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              This will permanently delete{' '}
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {request.path}
              </span>{' '}
              and cannot be undone.
            </p>
          </div>

          {/* "Why is Claude asking?" expandable */}
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => setWhyExpanded((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontSize: 12,
                color: 'var(--text-mute)',
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                style={{
                  transform: whyExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s',
                }}
              >
                <path
                  d="M3 2l4 3-4 3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Why is Claude asking for this?
            </button>

            {whyExpanded && (
              <div
                style={{
                  marginTop: 8,
                  padding: '10px 14px',
                  background: 'var(--bg-panel)',
                  borderRadius: 7,
                  fontFamily: 'var(--font-serif)',
                  fontSize: 13,
                  color: 'var(--text-dim)',
                  lineHeight: 1.6,
                }}
              >
                Claude needs to run this command as part of the current task. Review the
                command carefully before allowing.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: '14px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {/* Buttons row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 8,
            }}
          >
            {/* Deny */}
            <button
              onClick={() => onDeny(request.id)}
              style={{
                height: 32,
                padding: '0 16px',
                background: 'transparent',
                color: 'var(--red)',
                border: '1px solid var(--red)',
                borderRadius: 7,
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                lineHeight: '32px',
              }}
            >
              Deny
            </button>

            {/* Allow once */}
            <button
              onClick={() => onAllow(request.id)}
              style={{
                height: 32,
                padding: '0 16px',
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 7,
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                lineHeight: '32px',
              }}
            >
              Allow once
            </button>

            {/* Always allow in project */}
            <button
              onClick={() => onAlwaysAllow(request.id, request.tool, request.detail)}
              style={{
                height: 32,
                padding: '0 16px',
                background: 'var(--green)',
                color: '#fff',
                border: 'none',
                borderRadius: 7,
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                lineHeight: '32px',
              }}
            >
              Always allow in project
            </button>
          </div>

          {/* Always allow label */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 6,
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                border: '1px solid var(--border)',
                borderRadius: 3,
                background: 'var(--bg-panel)',
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 12,
                color: 'var(--text-mute)',
              }}
            >
              Always allow{' '}
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                {request.detail}
              </span>{' '}
              in this project
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
