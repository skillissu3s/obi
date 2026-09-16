import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { api } from '../lib/api.js'

const SOURCE_LABEL = {
  none: "the container's own filesystem",
  anonymous: 'an unnamed Docker volume',
}

// Shown to admins when /data won't survive a redeploy.
export function StorageWarning({ storage: given, compact = false }) {
  const [storage, setStorage] = useState(given || null)
  const [hidden, setHidden] = useState(() => sessionStorage.getItem('obi:storage-warning-hidden') === '1')

  useEffect(() => {
    if (given) {
      setStorage(given)
      return
    }
    api
      .adminStorage()
      .then((r) => setStorage(r.storage))
      .catch(() => {})
  }, [given])

  if (!storage || storage.persistent || (compact && hidden)) return null

  return (
    <div className={`storage-warning ${compact ? 'compact' : ''}`} role="alert">
      <AlertTriangle />
      <div className="grow">
        <b>Data will be lost on the next redeploy.</b>{' '}
        <span>
          <code>{storage.dataDir}</code> is on {SOURCE_LABEL[storage.kind] || storage.source}. In Dokploy open the app → <b>Advanced → Mounts</b> → add a <b>Volume Mount</b> named <code>obi-data</code> at <code>/data</code>, then redeploy
          {compact ? '.' : ' — or deploy with the docker-compose.yml from the repo, which declares that volume. Existing data from earlier deploys can be recovered with scripts/find-obi-data.sh (see the README).'}
        </span>
      </div>
      {compact && (
        <button
          className="icon-btn sm"
          title="Hide until next visit"
          onClick={() => {
            sessionStorage.setItem('obi:storage-warning-hidden', '1')
            setHidden(true)
          }}
        >
          <X />
        </button>
      )}
    </div>
  )
}
