import { Settings, ListChecks, ShieldCheck, LogOut } from 'lucide-react'
import { useUI } from '../store/ui.js'
import { useApp } from '../store/app.js'
import { menuFromElement } from '../components/ui.jsx'
import { api } from './api.js'
import { conn } from './socket.js'
import { navigate } from './router.js'
import { isDesktop } from './desktop.js'

export function userMenu(e, user) {
  useUI.getState().showContextMenu(menuFromElement(e.currentTarget), [
    { label: user.displayName, section: `@${user.username}` },
    { label: 'Settings', icon: Settings, hint: '⌘,', run: () => useUI.getState().openModal('settings') },
    { label: 'Keyboard shortcuts', icon: ListChecks, run: () => useUI.getState().openModal('shortcuts') },
    // the desktop app has one local user: no admin, nothing to sign out of
    !isDesktop && user.isAdmin && { label: 'Admin console', icon: ShieldCheck, run: () => navigate('/admin') },
    !isDesktop && 'divider',
    !isDesktop && {
      label: 'Sign out',
      icon: LogOut,
      run: async () => {
        await api.logout()
        conn.stop()
        useApp.setState({ user: null })
        navigate('/login')
      },
    },
  ])
}
