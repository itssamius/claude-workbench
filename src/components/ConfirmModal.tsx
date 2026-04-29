interface Props {
  title: string
  body: string
  confirmLabel: string
  confirmStyle: 'red' | 'green'
  onConfirm: () => void
  onCancel: () => void
}

const confirmButtonStyle = (style: 'red' | 'green'): React.CSSProperties => ({
  height: 30,
  padding: '0 12px',
  fontSize: 12,
  fontWeight: 500,
  fontFamily: 'var(--font-sans)',
  background: style === 'red' ? 'var(--red)' : 'var(--green)',
  color: '#fff',
  border: `1px solid ${style === 'red' ? 'var(--red)' : 'var(--green)'}`,
  borderRadius: 6,
  cursor: 'pointer',
})

export default function ConfirmModal({
  title,
  body,
  confirmLabel,
  confirmStyle,
  onConfirm,
  onCancel,
}: Props) {
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
          {title}
        </div>

        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            color: 'var(--text-dim)',
            marginTop: 8,
            marginBottom: 16,
            lineHeight: 1.5,
          }}
        >
          {body}
        </div>

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
            onClick={onConfirm}
            style={confirmButtonStyle(confirmStyle)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
