import { useState } from 'react'
import { EMOJI_GROUPS, cleanEmoji } from '@shared/emoji.js'

/**
 * A small emoji picker: a few groups to choose from, a box for any other emoji
 * (typed, pasted, or from the system's own picker — Win + . or Ctrl ⌘ Space), and
 * a way to take the emoji off again.
 */
export function EmojiPicker({ value, onPick, onClear }) {
  const [group, setGroup] = useState(EMOJI_GROUPS[0].id)
  const [typed, setTyped] = useState('')
  const list = EMOJI_GROUPS.find((g) => g.id === group).list
  const own = cleanEmoji(typed)
  return (
    <div className="emoji-picker">
      <div className="emoji-tabs" role="tablist">
        {EMOJI_GROUPS.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={group === g.id ? 'active' : ''} onClick={() => setGroup(g.id)}>
            {g.name}
          </button>
        ))}
      </div>
      <div className="emoji-grid" key={group}>
        {list.map((e, i) => (
          <button key={e} type="button" className={`emoji-cell ${value === e ? 'active' : ''}`} style={{ animationDelay: `${Math.min(i, 30) * 6}ms` }} onClick={() => onPick(e)} aria-label={e}>
            {e}
          </button>
        ))}
      </div>
      <div className="emoji-foot">
        <input
          className="input emoji-own"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && own && onPick(own)}
          placeholder="Any emoji… (Win + .)"
          aria-label="Any other emoji"
          maxLength={16}
        />
        <button type="button" className="btn btn-sm" disabled={!own} onClick={() => onPick(own)}>
          Use
        </button>
        {value && onClear && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClear}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}
