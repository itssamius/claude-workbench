import type { PermissionRequest } from '../types/permissions'

export const MOCK_LOW_RISK_REQUEST: PermissionRequest = {
  id: 'perm-1',
  tool: 'SHELL',
  path: 'dist/',
  detail: 'rm -rf dist',
  risk: 'low',
}

interface PermissionBannerProps {
  request: PermissionRequest
  onAllow: (id: string) => void
  onDeny: (id: string) => void
}

export default function PermissionBanner({ request, onAllow, onDeny }: PermissionBannerProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        background: 'rgba(200, 144, 32, 0.10)',
        border: '1px solid #c89020',
        borderRadius: 8,
      }}
    >
      {/* Left side: tool + path + detail */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            color: 'var(--accent)',
            flexShrink: 0,
          }}
        >
          {request.tool}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            color: 'var(--text)',
            flexShrink: 0,
          }}
        >
          {request.path}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            color: 'var(--text-mute)',
          }}
        >
          ·
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            color: 'var(--text-mute)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {request.detail}
        </span>
      </div>

      {/* Right side: action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button
          onClick={() => onAllow(request.id)}
          style={{
            height: 28,
            padding: '0 12px',
            background: 'var(--green)',
            color: '#fff',
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
            lineHeight: '28px',
          }}
        >
          Allow once
        </button>
        <button
          onClick={() => onDeny(request.id)}
          style={{
            height: 28,
            padding: '0 12px',
            background: 'transparent',
            color: 'var(--text-mute)',
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 400,
            borderRadius: 6,
            border: '1px solid var(--border)',
            cursor: 'pointer',
            lineHeight: '28px',
          }}
        >
          Deny
        </button>
      </div>
    </div>
  )
}
