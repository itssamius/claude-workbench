import { useState } from 'react'

interface Props {
  defaultMessage: string
  onCommit: (message: string) => void
  onCancel: () => void
}

export default function CommitModal({ defaultMessage, onCommit, onCancel }: Props) {
  const [message, setMessage] = useState(defaultMessage)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: 320,
          background: 'var(--bg-paper)',
          borderRadius: 10,
          border: '1px solid var(--border)',
          padding: 16,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--text)',
          }}
        >
          Commit changes
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            resize: 'vertical',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--text)',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 8,
            marginTop: 10,
            marginBottom: 12,
            outline: 'none',
          }}
        />

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onCancel}
            style={{
              height: 30,
              padding: '0 12px',
              fontSize: 12,
              fontWeight: 500,
              fontFamily: 'var(--font-sans)',
              background: 'transparent',
              color: 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onCommit(message)}
            style={{
              height: 30,
              padding: '0 12px',
              fontSize: 12,
              fontWeight: 500,
              fontFamily: 'var(--font-sans)',
              background: 'var(--green)',
              color: '#fff',
              border: '1px solid var(--green)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Commit
          </button>
        </div>
      </div>
    </div>
  )
}
