import { useEffect, useState } from 'react'
import { CloudOff, RefreshCw } from 'lucide-react'
import { useApp } from '../store/app.js'
import { conn } from '../lib/socket.js'

// A steady "Live" chip told you nothing you needed. What matters is the opposite:
// that the connection is gone and typing is only safe in this tab for now.
export function ConnectionBanner() {
  const connection = useApp((s) => s.connection)
  const down = connection === 'offline' || connection === 'reconnecting'
  const [show, setShow] = useState(false)

  // A brief reconnect while switching notes isn't worth a banner.
  useEffect(() => {
    if (!down) {
      setShow(false)
      return undefined
    }
    const t = setTimeout(() => setShow(true), 1500)
    return () => clearTimeout(t)
  }, [down])

  if (!show) return null
  return (
    <div className="conn-banner" role="status">
      <CloudOff />
      <span className="grow">
        <b>{connection === 'offline' ? 'No connection to the server.' : 'Reconnecting to the server…'}</b> Keep writing — your changes stay in this tab and save as soon as it is back. Leave the tab open until then.
      </span>
      <button className="btn btn-sm" onClick={() => conn.reconnectNow?.()}>
        <RefreshCw /> Try now
      </button>
    </div>
  )
}
