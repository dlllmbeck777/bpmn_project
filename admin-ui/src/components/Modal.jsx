export default function Modal({ title, onClose, children, wide }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className={`modal${wide ? ' wide' : ''}`} style={wide ? { width: 720 } : {}} onClick={e => e.stopPropagation()}>
        <div className="flex-between mb-16">
          <div className="modal-title" style={{ margin: 0 }}>{title}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
