import { useMemo, useState } from 'react'
import { Repeat, Trash2 } from 'lucide-react'
import { PIN_COLORS, PIN_TEMPLATES, daysBetween, pinOn, upcomingPins } from '@shared/pins.js'
import { addDays } from '@shared/tasks.js'
import { addPin, removePin, updatePin } from '../lib/pins.js'
import { dateOfIso, formatDate } from '../lib/util.js'
import { Switch } from './ui.jsx'

/** The pins on each of the days shown: Map<iso, pin[]> */
export function usePinDays(pins, days) {
  return useMemo(() => {
    const map = new Map()
    if (!pins.length) return map
    for (const iso of days) {
      const on = pins.filter((p) => pinOn(p, iso))
      if (on.length) map.set(iso, on)
    }
    return map
  }, [pins, days])
}

const pinStyle = (pin) => ({ '--pin': PIN_COLORS[pin.color] || PIN_COLORS.gray })

/** A pin on a day: its mark and its name, in its colour */
export function PinChip({ pin, onOpen, compact }) {
  return (
    <button
      type="button"
      className={`calv-pin ${compact ? 'compact' : ''}`}
      style={pinStyle(pin)}
      title={`${pin.title}${pin.repeat === 'yearly' ? ' · every year' : ''}${pin.until ? ` · until ${formatDate(dateOfIso(pin.until), 'D MMM')}` : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onOpen?.(pin, e.currentTarget)
      }}
    >
      <span className="calv-pin-mark">{pin.emoji}</span>
      <span className="calv-pin-text">{pin.title}</span>
      {pin.repeat === 'yearly' && <Repeat className="calv-pin-repeat" />}
    </button>
  )
}

const countdown = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`)

/** The next pin coming up, as a countdown in the calendar's bar */
export function PinCountdown({ pins, today, onGo }) {
  const next = upcomingPins(pins, today, 1)[0]
  if (!next) return null
  const n = daysBetween(today, next.date)
  if (n > 365) return null
  return (
    <button type="button" className={`calv-countdown ${n === 0 ? 'now' : ''}`} style={pinStyle(next.pin)} title={`${next.pin.title} — ${formatDate(dateOfIso(next.date), 'dddd D MMMM YYYY')}`} onClick={() => onGo(next.date)}>
      <span className="calv-pin-mark">{next.pin.emoji}</span>
      <b>{next.pin.title}</b>
      <span>{countdown(n)}</span>
    </button>
  )
}

/** Pins still to come, for the side panel */
export function UpcomingPins({ pins, today, onGo, onOpen }) {
  const list = upcomingPins(pins, today, 6)
  if (!list.length) return null
  return (
    <div className="calv-upcoming">
      {list.map(({ pin, date }) => (
        <div key={pin.id} className="calv-upcoming-row" style={pinStyle(pin)}>
          <button type="button" className="calv-upcoming-go" onClick={() => onGo(date)} title="Show this day">
            <span className="calv-pin-mark">{pin.emoji}</span>
            <span className="calv-upcoming-text">
              <b>{pin.title}</b>
              <em>{formatDate(dateOfIso(date), 'ddd D MMM')}</em>
            </span>
            <span className="calv-upcoming-when">{countdown(daysBetween(today, date))}</span>
          </button>
          <button type="button" className="calv-btn calv-upcoming-edit" title="Change this pin" aria-label="Change this pin" onClick={(e) => onOpen(pin, e.currentTarget)}>
            ···
          </button>
        </div>
      ))}
    </div>
  )
}

// The templates: the ready-made ones, then your own (pins you made that aren't
// one of those), so a mark you use often is one click away.
function useTemplates(pins) {
  return useMemo(() => {
    const builtin = PIN_TEMPLATES.filter((t) => t.id !== 'custom')
    const known = new Set(builtin.map((t) => `${t.emoji}|${t.title}`))
    const mine = []
    for (const p of [...pins].reverse()) {
      const k = `${p.emoji}|${p.title}`
      if (known.has(k)) continue
      known.add(k)
      mine.push({ id: `mine:${p.id}`, title: p.title, emoji: p.emoji, color: p.color, repeat: p.repeat, mine: true })
      if (mine.length >= 4) break
    }
    return [...builtin, ...mine, PIN_TEMPLATES.find((t) => t.id === 'custom')]
  }, [pins])
}

/**
 * Pinning a day, or changing a pin: a template to start from, then its name,
 * mark, colour, how long it lasts and whether it comes back every year.
 */
export function PinEditor({ iso, pin, pins, onDone }) {
  const templates = useTemplates(pins)
  const [t, setT] = useState(null)
  const [title, setTitle] = useState(pin?.title || '')
  const [emoji, setEmoji] = useState(pin?.emoji || '📌')
  const [color, setColor] = useState(pin?.color || 'violet')
  const [date, setDate] = useState(pin?.date || iso)
  const [until, setUntil] = useState(pin?.until || '')
  const [yearly, setYearly] = useState(pin?.repeat === 'yearly')
  const [busy, setBusy] = useState(false)

  const pick = (tpl) => {
    setT(tpl.id)
    // a name typed by hand stays; one that came from a template follows the next
    const fromTemplate = !title || templates.some((x) => x.title === title)
    if (fromTemplate) setTitle(tpl.title)
    setEmoji(tpl.emoji)
    setColor(tpl.color)
    setYearly(tpl.repeat === 'yearly')
    if (tpl.id === 'custom') setTimeout(() => document.querySelector('.pin-editor .pin-title')?.focus(), 0)
  }

  const save = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    const body = { title: title.trim(), emoji, color, date, repeat: yearly ? 'yearly' : null, until: !yearly && until && until > date ? until : null }
    const ok = pin ? await updatePin(pin.id, body) : await addPin({ ...body, repeat: body.repeat || undefined, until: body.until || undefined })
    setBusy(false)
    if (ok) onDone()
  }

  return (
    <div
      className="pin-editor"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'BUTTON') {
          e.preventDefault()
          save()
        }
      }}
    >
      <div className="pin-editor-head">
        <span className="pin-preview" style={{ '--pin': PIN_COLORS[color] }}>
          <span className="calv-pin-mark">{emoji}</span>
        </span>
        <div>
          <div className="pin-editor-title">{pin ? 'Change pin' : 'Pin this day'}</div>
          <div className="faint">{formatDate(dateOfIso(date), 'dddd D MMMM YYYY')}</div>
        </div>
      </div>
      {!pin && (
        <div className="pin-templates" role="group" aria-label="Templates">
          {templates.map((tpl, i) => (
            <button
              type="button"
              key={tpl.id}
              className={`pin-template ${t === tpl.id ? 'active' : ''} ${tpl.mine ? 'mine' : ''}`}
              style={{ '--pin': PIN_COLORS[tpl.color], animationDelay: `${i * 14}ms` }}
              onClick={() => pick(tpl)}
              title={tpl.mine ? 'One of yours' : undefined}
            >
              <span className="calv-pin-mark">{tpl.emoji}</span>
              <span>{tpl.title || 'Your own'}</span>
            </button>
          ))}
        </div>
      )}
      <div className="pin-fields">
        <input className="input pin-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label="Mark (an emoji)" title="Its mark: any emoji" maxLength={8} />
        <input className="input pin-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Launch day, Mum’s birthday…" aria-label="Name" maxLength={80} autoFocus={!!pin} />
      </div>
      <div className="pin-colors" role="group" aria-label="Colour">
        {Object.entries(PIN_COLORS).map(([name, hex]) => (
          <button type="button" key={name} className={`pin-color ${color === name ? 'active' : ''}`} style={{ background: hex }} title={name} aria-label={name} onClick={() => setColor(name)} />
        ))}
      </div>
      <div className="pin-row">
        <label>
          <span>Day</span>
          <input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        {!yearly && (
          <label>
            <span>Until (optional)</span>
            <input className="input" type="date" value={until} min={addDays(date, 1)} onChange={(e) => setUntil(e.target.value)} />
          </label>
        )}
      </div>
      <label className="pin-yearly">
        <span>
          <Repeat /> Every year
        </span>
        <Switch checked={yearly} onChange={setYearly} />
      </label>
      <div className="pin-actions">
        {pin && (
          <button
            type="button"
            className="btn btn-ghost danger"
            onClick={async () => {
              if (await removePin(pin)) onDone()
            }}
          >
            <Trash2 /> Remove
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={!title.trim() || busy} onClick={save}>
          {pin ? 'Save' : 'Pin it'}
        </button>
      </div>
    </div>
  )
}
