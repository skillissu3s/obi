import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { useToasts, useUI } from '../store/ui.js'

export function Modal({ title, onClose, children, footer, className = '', center = false, icon, headerExtra, bodyClass = 'modal-body' }) {
  const ref = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return createPortal(
    <div
      className={`overlay ${center ? 'center' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div className={`modal ${className}`} ref={ref} role="dialog" aria-modal="true" style={{ position: 'relative' }}>
        {title == null && onClose && (
          <button className="icon-btn" onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 10, right: 12, zIndex: 5 }}>
            <X />
          </button>
        )}
        {title != null && (
          <div className="modal-header">
            {icon}
            <h2>{title}</h2>
            {headerExtra}
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X />
            </button>
          </div>
        )}
        <div className={bodyClass}>{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Avatar({ name = '?', color = '#888', size = 24, title }) {
  const initials = name
    .split(/\s+/)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <span className="avatar" title={title ?? name} style={{ width: size, height: size, fontSize: size * 0.42, background: color }}>
      {initials}
    </span>
  )
}

export function AvatarStack({ users, size = 22, max = 4 }) {
  if (!users?.length) return null
  return (
    <span className="avatar-stack">
      {users.slice(0, max).map((u) => (
        <Avatar key={u.id || u.name} name={u.name || u.displayName} color={u.color} size={size} />
      ))}
      {users.length > max && <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: 'var(--bg-active)', color: 'var(--text-2)' }}>+{users.length - max}</span>}
    </span>
  )
}

export function Switch({ checked, onChange, disabled }) {
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} />
}

export function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button type="button" key={o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)} title={o.title}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function WsIcon({ ws, size = 26 }) {
  if (!ws) return null
  const isEmoji = ws.icon && !/^[a-z0-9]/i.test(ws.icon)
  const colors = ['#2f9e78', '#d1703f', '#c0913a', '#2a93a3', '#b8604f', '#5566cf', '#96549e']
  let h = 0
  for (const c of ws.id) h = (h * 31 + c.charCodeAt(0)) | 0
  const bg = colors[Math.abs(h) % colors.length]
  return (
    <span className="ws-icon" style={{ width: size, height: size, fontSize: size * 0.55, background: isEmoji ? 'var(--bg-active)' : `linear-gradient(135deg, ${bg}, color-mix(in srgb, ${bg} 60%, #000))` }}>
      {isEmoji ? ws.icon : (ws.name || '?')[0].toUpperCase()}
    </span>
  )
}

const EMOJIS = ['🌱', '📓', '🧠', '💡', '🚀', '📚', '🗂️', '✍️', '🎯', '🧪', '🏠', '💼', '🎨', '🎵', '🌍', '⚡', '🔥', '🌙', '☀️', '🍀', '📝', '📌', '🗓️', '🔬', '🧩', '🛠️', '💻', '📈', '❤️', '⭐']
export function EmojiPicker({ value, onChange }) {
  return (
    <div className="emoji-grid">
      {EMOJIS.map((e) => (
        <button type="button" key={e} className={value === e ? 'active' : ''} onClick={() => onChange(value === e ? '' : e)}>
          {e}
        </button>
      ))}
    </div>
  )
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return createPortal(
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'success' ? <CheckCircle2 /> : t.kind === 'error' ? <AlertCircle /> : <Info />}
          <div className="grow">{t.message}</div>
          {t.action && (
            <button
              className="btn btn-sm"
              onClick={() => {
                t.action.run()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="icon-btn sm" onClick={() => dismiss(t.id)}>
            <X />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}

export function Dialogs() {
  const dialog = useUI((s) => s.dialog)
  const [value, setValue] = useState('')
  const inputRef = useRef(null)
  useEffect(() => {
    if (dialog?.kind === 'prompt') {
      setValue(dialog.value || '')
      setTimeout(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        if (dialog.selectBase && dialog.value) {
          const dot = dialog.value.lastIndexOf('.')
          el.setSelectionRange(0, dot > 0 ? dot : dialog.value.length)
        } else el.select()
      }, 20)
    }
  }, [dialog])
  if (!dialog) return null
  const close = (result) => {
    useUI.setState({ dialog: null })
    dialog.resolve(result)
  }
  const submit = () => {
    if (dialog.kind === 'prompt') {
      const v = value.trim()
      if (!v && !dialog.allowEmpty) return
      close(v)
    } else close(true)
  }
  return (
    <Modal
      title={dialog.title}
      center
      onClose={() => close(dialog.kind === 'prompt' ? null : false)}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => close(dialog.kind === 'prompt' ? null : false)}>
            Cancel
          </button>
          <button className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`} onClick={submit} autoFocus={dialog.kind === 'confirm'}>
            {dialog.confirmText}
          </button>
        </>
      }
    >
      {dialog.message && <p className="muted" style={{ margin: '0 0 12px', lineHeight: 1.55 }}>{dialog.message}</p>}
      {dialog.kind === 'prompt' && (
        <input
          ref={inputRef}
          className="input"
          value={value}
          placeholder={dialog.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      )}
    </Modal>
  )
}

export function ContextMenu() {
  const menu = useUI((s) => s.contextMenu)
  const close = useUI((s) => s.closeContextMenu)
  const ref = useRef(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [hl, setHl] = useState(-1)

  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const x = Math.min(menu.x, window.innerWidth - r.width - 8)
    const y = menu.y + r.height > window.innerHeight - 8 ? Math.max(8, menu.y - r.height) : menu.y
    setPos({ x: Math.max(8, x), y })
    setHl(-1)
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onDown = (e) => {
      if (!ref.current || ref.current.contains(e.target)) return
      close(true)
    }
    const actionable = menu.items.map((it, i) => (it.label && !it.disabled ? i : -1)).filter((i) => i >= 0)
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setHl((h) => {
          const idx = actionable.indexOf(h)
          const next = e.key === 'ArrowDown' ? actionable[(idx + 1) % actionable.length] : actionable[(idx - 1 + actionable.length) % actionable.length]
          return next ?? -1
        })
      } else if (e.key === 'Enter') {
        setHl((h) => {
          const it = menu.items[h]
          if (it?.run) {
            close()
            it.run()
          }
          return h
        })
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu, close])

  if (!menu) return null
  return createPortal(
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((it, i) => {
        if (it === 'divider' || it.divider) return <div key={i} className="divider" />
        if (it.section) return <div key={i} className="menu-label">{it.section}</div>
        const Icon = it.icon
        return (
          <button
            key={i}
            className={`menu-item ${it.danger ? 'danger' : ''} ${hl === i ? 'hl' : ''}`}
            disabled={it.disabled}
            style={it.disabled ? { opacity: 0.45 } : undefined}
            onMouseEnter={() => setHl(i)}
            onClick={() => {
              close()
              it.run?.()
            }}
          >
            {Icon ? <Icon /> : it.emoji ? <span style={{ width: 15, textAlign: 'center' }}>{it.emoji}</span> : <span style={{ width: 15 }} />}
            <span className="grow truncate">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}

export function menuFromElement(el) {
  const r = el.getBoundingClientRect()
  // trigger travels with the menu so clicking the same button closes it
  return { clientX: r.left, clientY: r.bottom + 4, trigger: el, preventDefault() {}, stopPropagation() {} }
}

export function Spinner({ size }) {
  return <span className={`spinner ${size === 'sm' ? 'sm' : ''}`} />
}

export function Kbd({ combo }) {
  return (
    <span className="row" style={{ gap: 3 }}>
      {combo.map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  )
}
