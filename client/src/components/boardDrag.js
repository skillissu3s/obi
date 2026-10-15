// Dragging cards and lists on a project board the way Trello does: what is
// picked up lifts and tilts under the pointer, the others slide out of its way,
// and it settles into its new place when let go. Pointer events rather than the
// browser's drag and drop, which can do none of that.
//
// useBoardDrag gives `drag` (what is being dragged: { kind, id, height }),
// `drop` (where it would land: { lane, index } for a card — `index` among the
// lane's cards that are shown — or { list: index } for a list), `press(e, item)`
// for a card's or a list header's pointerdown, and `justDragged()` for the click
// that follows a drop. `onDrop(item, drop)` makes the move.
import { useLayoutEffect, useRef, useState } from 'react'

const START = 5 // px the pointer moves before a press becomes a drag
const LONG_PRESS = 260 // ms a finger rests on a card to pick it up
const EDGE = 70 // px from an edge where the board scrolls by itself
const SETTLE = 180 // ms what was dragged takes to settle where it lands

const sameDrop = (a, b) => (!a && !b) || (!!a && !!b && a.lane === b.lane && a.index === b.index && a.list === b.list)

export function useBoardDrag({ lanesRef, onDrop, startDrop }) {
  const [drag, setDragState] = useState(null)
  const [drop, setDropState] = useState(null)
  const dropRef = useRef(null)
  const flip = useRef(null) // where things were before the last move of the gap
  const live = useRef(null) // the press or drag going on
  const quietUntil = useRef(0)
  const cbs = useRef(null)
  cbs.current = { onDrop, startDrop }

  // the gap moves: the cards (or lists) around it slide to their new places
  const setDrop = (d) => {
    if (sameDrop(dropRef.current, d)) return
    const root = lanesRef.current
    if (root) {
      const pos = new Map()
      for (const el of root.querySelectorAll('[data-card]:not(.is-dragging), .pb-list[data-lane]:not(.is-dragging)')) pos.set(el, el.getBoundingClientRect())
      flip.current = pos
    }
    dropRef.current = d
    setDropState(d)
  }
  useLayoutEffect(() => {
    const pos = flip.current
    flip.current = null
    if (!pos) return
    for (const [el, was] of pos) {
      if (!el.isConnected) continue
      const now = el.getBoundingClientRect()
      const dx = was.left - now.left
      const dy = was.top - now.top
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
      el.style.transition = 'none'
      el.style.transform = `translate(${dx}px, ${dy}px)`
      void el.offsetWidth // (lays it out there before it moves back)
      el.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)'
      el.style.transform = ''
      const done = () => {
        el.style.transition = ''
        el.removeEventListener('transitionend', done)
      }
      el.addEventListener('transitionend', done)
    }
  }, [drop])

  // Where a pointer at (x, y) would drop what `g` carries
  const target = (g) => {
    const root = lanesRef.current
    if (!root) return null
    if (g.item.kind === 'list') {
      const lists = [...root.querySelectorAll(':scope > .pb-list[data-lane]:not(.is-dragging)')]
      const rr = root.getBoundingClientRect()
      let index = lists.length
      for (let i = 0; i < lists.length; i++) {
        const mid = rr.left - root.scrollLeft + lists[i].offsetLeft + lists[i].offsetWidth / 2
        if (g.x < mid) {
          index = i
          break
        }
      }
      return { list: index }
    }
    // the list under the pointer, or the nearest one sideways
    let best = null
    let bestD = Infinity
    for (const l of root.querySelectorAll(':scope > .pb-list[data-lane]')) {
      const r = l.getBoundingClientRect()
      const d = g.x < r.left ? r.left - g.x : g.x > r.right ? g.x - r.right : 0
      if (d < bestD) {
        best = l
        bestD = d
      }
    }
    if (!best) return null
    const box = best.querySelector('.pb-cards')
    const cards = [...box.querySelectorAll(':scope > [data-card]:not(.is-dragging)')]
    const br = box.getBoundingClientRect()
    let index = cards.length
    // (from the layout, not the screen: a card sliding out of the way doesn't count where it is mid-slide)
    for (let i = 0; i < cards.length; i++) {
      const mid = br.top - box.scrollTop + cards[i].offsetTop + cards[i].offsetHeight / 2
      if (g.y < mid) {
        index = i
        break
      }
    }
    g.box = box
    return { lane: best.dataset.lane, index }
  }

  const follow = (g) => {
    g.ghost.style.translate = `${g.x - g.x0}px ${g.y - g.y0}px`
    const t = target(g)
    if (t) setDrop(t)
  }

  // near an edge the board (sideways) or the list (up and down) scrolls by itself
  const scrollTick = (g) => {
    if (live.current !== g || !g.started || g.ending) return
    const root = lanesRef.current
    if (root) {
      const r = root.getBoundingClientRect()
      const speed = (d) => Math.ceil(((EDGE - d) / EDGE) * 18)
      let moved = false
      if (g.x < r.left + EDGE && root.scrollLeft > 0) {
        root.scrollLeft -= speed(g.x - r.left)
        moved = true
      } else if (g.x > r.right - EDGE && root.scrollLeft + root.clientWidth < root.scrollWidth) {
        root.scrollLeft += speed(r.right - g.x)
        moved = true
      }
      const box = g.item.kind === 'card' ? g.box : null
      if (box) {
        const b = box.getBoundingClientRect()
        if (g.y < b.top + EDGE / 2 && box.scrollTop > 0) {
          box.scrollTop -= speed((g.y - b.top) * 2)
          moved = true
        } else if (g.y > b.bottom - EDGE / 2 && box.scrollTop + box.clientHeight < box.scrollHeight) {
          box.scrollTop += speed((b.bottom - g.y) * 2)
          moved = true
        }
      }
      if (moved) follow(g)
    }
    g.raf = requestAnimationFrame(() => scrollTick(g))
  }

  const preventTouch = (e) => live.current?.started && e.cancelable && e.preventDefault()

  const begin = (g) => {
    if (live.current !== g || g.started) return
    g.started = true
    const r = g.el.getBoundingClientRect()
    g.rect = r
    const ghost = g.el.cloneNode(true)
    ghost.classList.add('pb-ghost')
    ghost.classList.remove('is-dragging')
    ghost.removeAttribute('data-card')
    ghost.removeAttribute('data-lane')
    Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
    ;(lanesRef.current?.closest('.pb') || document.body).appendChild(ghost)
    g.ghost = ghost
    requestAnimationFrame(() => ghost.classList.add('lifted'))
    document.documentElement.classList.add('pb-dragging')
    if (g.touch) {
      navigator.vibrate?.(8)
      window.addEventListener('touchmove', preventTouch, { passive: false })
    }
    window.getSelection()?.removeAllRanges()
    const first = cbs.current.startDrop(g.item)
    g.first = first
    setDragState({ kind: g.item.kind, id: g.item.id, height: r.height })
    dropRef.current = first
    setDropState(first)
    g.raf = requestAnimationFrame(() => scrollTick(g))
  }

  const cleanup = (g) => {
    clearTimeout(g.timer)
    cancelAnimationFrame(g.raf)
    window.removeEventListener('pointermove', g.move)
    window.removeEventListener('pointerup', g.up)
    window.removeEventListener('pointercancel', g.cancel)
    window.removeEventListener('keydown', g.key, true)
    window.removeEventListener('touchmove', preventTouch)
  }

  // Let go: what was dragged settles into the gap (or back where it came from), then the move is made
  const finish = (g, commit) => {
    if (g.ending) return
    g.ending = true
    cleanup(g)
    if (!commit) setDrop(g.first)
    requestAnimationFrame(() => {
      const gap = lanesRef.current?.querySelector(g.item.kind === 'card' ? '.pb-placeholder' : '.pb-list-placeholder')
      const to = gap ? gap.getBoundingClientRect() : g.rect
      g.ghost.classList.add('settling')
      g.ghost.classList.remove('lifted')
      g.ghost.style.translate = `${to.left - g.rect.left}px ${to.top - g.rect.top}px`
      setTimeout(() => {
        const where = dropRef.current
        try {
          if (commit && where && !sameDrop(where, g.first)) cbs.current.onDrop(g.item, where)
        } finally {
          // whatever the move did, the drag is over: nothing stays hidden or held open
          dropRef.current = null
          setDragState(null)
          setDropState(null)
          quietUntil.current = Date.now() + 250
          requestAnimationFrame(() => {
            g.ghost.remove()
            document.documentElement.classList.remove('pb-dragging')
          })
          live.current = null
        }
      }, SETTLE)
    })
  }

  /** item: { kind: 'card', id, lane } or { kind: 'list', id }, and `el`, the element that lifts (else the one pressed) */
  const press = (e, item) => {
    if (e.button !== 0 || live.current) return
    if (e.target.closest('button, a, input, textarea, select, [contenteditable="true"]')) return
    const g = { item, el: item.el || e.currentTarget, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, pid: e.pointerId, touch: e.pointerType === 'touch', started: false }
    live.current = g
    g.move = (ev) => {
      if (ev.pointerId !== g.pid || g.ending) return
      g.x = ev.clientX
      g.y = ev.clientY
      if (!g.started) {
        const d = Math.hypot(g.x - g.x0, g.y - g.y0)
        if (g.touch) {
          // moving before the long press is scrolling, not dragging
          if (d > 8) {
            cleanup(g)
            live.current = null
          }
          return
        }
        if (d < START) return
        begin(g)
      }
      ev.preventDefault()
      follow(g)
    }
    g.up = (ev) => {
      if (ev.pointerId !== g.pid) return
      if (!g.started) {
        cleanup(g)
        live.current = null
        return
      }
      finish(g, true)
    }
    g.cancel = () => (g.started ? finish(g, false) : (cleanup(g), (live.current = null)))
    g.key = (ev) => {
      if (ev.key !== 'Escape' || !g.started) return
      ev.preventDefault()
      ev.stopPropagation()
      finish(g, false)
    }
    if (g.touch) g.timer = setTimeout(() => begin(g), LONG_PRESS)
    window.addEventListener('pointermove', g.move, { passive: false })
    window.addEventListener('pointerup', g.up)
    window.addEventListener('pointercancel', g.cancel)
    window.addEventListener('keydown', g.key, true)
  }

  return { drag, drop, press, justDragged: () => Date.now() < quietUntil.current }
}
