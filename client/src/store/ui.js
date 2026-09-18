import { create } from 'zustand'

let toastId = 0
export const useToasts = create((set, get) => ({
  toasts: [],
  push(t) {
    const id = ++toastId
    const toast = { id, kind: 'info', timeout: 3500, ...t }
    set({ toasts: [...get().toasts, toast].slice(-5) })
    if (toast.timeout) setTimeout(() => get().dismiss(id), toast.timeout)
    return id
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
}))

export const toast = {
  info: (message, opts) => useToasts.getState().push({ message, kind: 'info', ...opts }),
  success: (message, opts) => useToasts.getState().push({ message, kind: 'success', ...opts }),
  error: (message, opts) => useToasts.getState().push({ message: message?.message || String(message), kind: 'error', timeout: 6000, ...opts }),
}

let lastDismissed = { el: null, at: 0 }

// Modal / dialog / palette state
export const useUI = create((set, get) => ({
  modal: null, // { type, props }
  dialog: null, // { kind: 'confirm'|'prompt', ...opts, resolve }
  palette: null, // { mode, ...opts }
  contextMenu: null, // { x, y, items }
  hover: null,
  openModal(type, props = {}) {
    set({ modal: { type, props } })
  },
  closeModal() {
    set({ modal: null })
  },
  openPalette(mode = 'commands', opts = {}) {
    set({ palette: { mode, ...opts } })
  },
  closePalette() {
    set({ palette: null })
  },
  showContextMenu(e, items) {
    e.preventDefault?.()
    e.stopPropagation?.()
    // The click that closed a menu also reaches the button that opened it,
    // which would reopen it straight away — so a button toggles instead.
    const trigger = e.trigger || null
    if (trigger && trigger === lastDismissed.el && Date.now() - lastDismissed.at < 350) {
      lastDismissed = { el: null, at: 0 }
      return
    }
    const x = e.clientX ?? e.x ?? 0
    const y = e.clientY ?? e.y ?? 0
    set({ contextMenu: { x, y, trigger, items: items.filter(Boolean) } })
  },
  closeContextMenu(dismissedByPointer) {
    if (dismissedByPointer) lastDismissed = { el: get().contextMenu?.trigger || null, at: Date.now() }
    set({ contextMenu: null })
  },
}))

export function confirmDialog(opts) {
  return new Promise((resolve) => useUI.setState({ dialog: { kind: 'confirm', confirmText: 'Confirm', ...opts, resolve } }))
}

export function promptDialog(opts) {
  return new Promise((resolve) => useUI.setState({ dialog: { kind: 'prompt', confirmText: 'OK', value: '', ...opts, resolve } }))
}
