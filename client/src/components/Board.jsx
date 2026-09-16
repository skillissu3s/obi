import { useEffect, useRef, useState, useCallback } from 'react'
import { Plus, MoreHorizontal, Trash2, Pencil, ArrowRight } from 'lucide-react'
import { parseBoard, serializeBoard, cloneBoard } from '../lib/kanban.js'
import { applyToYText } from '@shared/textdiff.js'
import { renderInline } from '../lib/render.js'
import { useUI } from '../store/ui.js'
import { menuFromElement } from './ui.jsx'
import { openLink } from '../lib/actions.js'

export function Board({ handle, readOnly }) {
  const [board, setBoard] = useState(() => parseBoard(handle.ytext.toString()))
  const [editing, setEditing] = useState(null) // {laneId, itemId} | {laneId:'new', ...}
  const [adding, setAdding] = useState(null)
  const [drag, setDrag] = useState(null)
  const localRef = useRef(false)

  useEffect(() => {
    const update = () => {
      if (localRef.current) {
        localRef.current = false
        return
      }
      setBoard(parseBoard(handle.ytext.toString()))
    }
    const off = handle.on('change', update)
    const off2 = handle.on('synced', update)
    setBoard(parseBoard(handle.ytext.toString()))
    return () => {
      off()
      off2()
    }
  }, [handle])

  const commit = useCallback(
    (next) => {
      setBoard(next)
      localRef.current = true
      applyToYText(handle.ytext, serializeBoard(next))
    },
    [handle],
  )

  const mutate = (fn) => {
    const next = cloneBoard(board)
    fn(next)
    commit(next)
  }

  const addCard = (laneId, text) => {
    if (!text.trim()) return
    mutate((b) => {
      const lane = b.lanes.find((l) => l.id === laneId)
      lane.items.push({ id: `n${Date.now()}`, checked: false, hasCheckbox: true, text: text.trim(), extra: [] })
    })
  }

  const moveCard = (fromLane, itemId, toLane, index) => {
    mutate((b) => {
      const src = b.lanes.find((l) => l.id === fromLane)
      const dst = b.lanes.find((l) => l.id === toLane)
      if (!src || !dst) return
      const i = src.items.findIndex((x) => x.id === itemId)
      if (i < 0) return
      const [card] = src.items.splice(i, 1)
      const at = index == null ? dst.items.length : index > i && src === dst ? index - 1 : index
      dst.items.splice(Math.max(0, Math.min(at, dst.items.length)), 0, card)
      if (dst.title.toLowerCase().includes('done') && !card.checked) card.checked = true
      else if (src.title.toLowerCase().includes('done') && card.checked && !dst.title.toLowerCase().includes('done')) card.checked = false
    })
  }

  const cardMenu = (e, lane, item) => {
    const others = board.lanes.filter((l) => l.id !== lane.id)
    useUI.getState().showContextMenu(menuFromElement(e.currentTarget), [
      { label: 'Edit', icon: Pencil, run: () => setEditing({ laneId: lane.id, itemId: item.id }) },
      ...(others.length ? [{ section: 'Move to' }] : []),
      ...others.map((l) => ({ label: l.title, icon: ArrowRight, run: () => moveCard(lane.id, item.id, l.id, null) })),
      'divider',
      {
        label: 'Delete card',
        icon: Trash2,
        danger: true,
        run: () =>
          mutate((b) => {
            const ln = b.lanes.find((x) => x.id === lane.id)
            ln.items = ln.items.filter((x) => x.id !== item.id)
          }),
      },
    ])
  }

  const laneMenu = (e, lane) => {
    useUI.getState().showContextMenu(menuFromElement(e.currentTarget), [
      { label: 'Rename list', icon: Pencil, run: () => setEditing({ laneId: lane.id, title: true }) },
      {
        label: 'Clear completed',
        icon: Trash2,
        run: () =>
          mutate((b) => {
            const ln = b.lanes.find((x) => x.id === lane.id)
            ln.items = ln.items.filter((i) => !i.checked)
          }),
      },
      'divider',
      {
        label: 'Delete list',
        icon: Trash2,
        danger: true,
        run: () =>
          mutate((b) => {
            b.lanes = b.lanes.filter((l) => l.id !== lane.id)
          }),
      },
    ])
  }

  return (
    <div className="board" onDragOver={(e) => e.preventDefault()}>
      {board.lanes.map((lane) => (
        <div
          key={lane.id}
          className={`lane ${drag?.overLane === lane.id ? 'drag-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            if (drag && drag.overLane !== lane.id) setDrag({ ...drag, overLane: lane.id, overIndex: null })
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (!drag) return
            moveCard(drag.laneId, drag.itemId, lane.id, drag.overIndex)
            setDrag(null)
          }}
        >
          <div className="lane-head">
            {editing?.laneId === lane.id && editing.title ? (
              <input
                className="input"
                style={{ height: 26 }}
                defaultValue={lane.title}
                autoFocus
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== lane.title)
                    mutate((b) => {
                      b.lanes.find((l) => l.id === lane.id).title = v
                    })
                  setEditing(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.target.blur()
                  if (e.key === 'Escape') setEditing(null)
                }}
              />
            ) : (
              <div className="lane-title" onDoubleClick={() => !readOnly && setEditing({ laneId: lane.id, title: true })}>
                {lane.title}
              </div>
            )}
            <span className="lane-count">{lane.items.length}</span>
            {!readOnly && (
              <button className="icon-btn sm" onClick={(e) => laneMenu(e, lane)}>
                <MoreHorizontal />
              </button>
            )}
          </div>
          <div className="lane-cards">
            {lane.items.map((item, idx) => (
              <div key={item.id}>
                {drag?.overLane === lane.id && drag.overIndex === idx && <div className="drop-indicator" />}
                <div
                  className={`kcard ${item.checked ? 'done' : ''} ${drag?.itemId === item.id ? 'dragging' : ''}`}
                  draggable={!readOnly && editing?.itemId !== item.id}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', item.text)
                    setDrag({ laneId: lane.id, itemId: item.id, overLane: lane.id, overIndex: null })
                  }}
                  onDragEnd={() => setDrag(null)}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (!drag) return
                    const r = e.currentTarget.getBoundingClientRect()
                    const after = e.clientY > r.top + r.height / 2
                    const i = idx + (after ? 1 : 0)
                    if (drag.overLane !== lane.id || drag.overIndex !== i) setDrag({ ...drag, overLane: lane.id, overIndex: i })
                  }}
                  onDoubleClick={() => !readOnly && setEditing({ laneId: lane.id, itemId: item.id })}
                >
                  {item.hasCheckbox !== false && (
                    <input
                      type="checkbox"
                      className="task-cb"
                      checked={item.checked}
                      disabled={readOnly}
                      onChange={() =>
                        mutate((b) => {
                          const it = b.lanes.find((l) => l.id === lane.id).items.find((x) => x.id === item.id)
                          it.checked = !it.checked
                        })
                      }
                    />
                  )}
                  {editing?.itemId === item.id ? (
                    <textarea
                      className="textarea"
                      style={{ minHeight: 60 }}
                      defaultValue={item.text}
                      autoFocus
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v && v !== item.text)
                          mutate((b) => {
                            b.lanes.find((l) => l.id === lane.id).items.find((x) => x.id === item.id).text = v.replace(/\n/g, ' ')
                          })
                        setEditing(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          e.target.blur()
                        }
                        if (e.key === 'Escape') setEditing(null)
                      }}
                    />
                  ) : (
                    <div
                      className="kcard-text markdown"
                      onClick={(e) => {
                        const a = e.target.closest('a')
                        if (a?.dataset.href) {
                          e.preventDefault()
                          openLink(handle.ws, handle.path, a.dataset.href, {})
                        }
                      }}
                      dangerouslySetInnerHTML={{ __html: renderInline(item.text, { ws: handle.ws, path: handle.path }) }}
                    />
                  )}
                  {!readOnly && (
                    <button className="icon-btn sm" onClick={(e) => cardMenu(e, lane, item)}>
                      <MoreHorizontal />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {drag?.overLane === lane.id && (drag.overIndex == null || drag.overIndex >= lane.items.length) && <div className="drop-indicator" />}
          </div>
          {!readOnly &&
            (adding === lane.id ? (
              <div className="lane-add">
                <textarea
                  className="textarea"
                  style={{ minHeight: 56 }}
                  placeholder="Card text… (Enter to add)"
                  autoFocus
                  onBlur={(e) => {
                    addCard(lane.id, e.target.value)
                    setAdding(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      addCard(lane.id, e.target.value)
                      e.target.value = ''
                    }
                    if (e.key === 'Escape') {
                      e.target.value = ''
                      setAdding(null)
                    }
                  }}
                />
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm lane-add" onClick={() => setAdding(lane.id)}>
                <Plus /> Add card
              </button>
            ))}
        </div>
      ))}
      {!readOnly && (
        <div className="lane-new">
          <button
            className="btn btn-ghost"
            onClick={() =>
              mutate((b) => {
                b.lanes.push({ id: `l${Date.now()}`, title: 'New list', items: [], extra: [] })
              })
            }
          >
            <Plus /> Add list
          </button>
        </div>
      )}
    </div>
  )
}
