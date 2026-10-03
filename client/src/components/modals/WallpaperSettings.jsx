import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, Upload, Shuffle, RotateCcw, Pipette } from 'lucide-react'
import { Segmented, Spinner } from '../ui.jsx'
import { WallpaperCredit } from '../WallpaperCredit.jsx'
import { usePrefs } from '../../store/prefs.js'
import { toast } from '../../store/ui.js'
import { COLOURS, GRADIENTS, DEFAULT_WALLPAPER, PANEL_MIN, isPhoto, wallpaperVars, getOwnImage } from '../../lib/wallpaper.js'
import { wallpaperProviders, searchWallpapers, chooseWallpaper, shuffleWallpaper, saveOwnWallpaper, setWallpaper } from '../../lib/wallpaperSource.js'

// Settings → Appearance → Background: a live preview, where the picture comes
// from, and how it sits behind the app.

const TABS = [
  { value: 'none', label: 'None' },
  { value: 'colours', label: 'Colours' },
  { value: 'photos', label: 'Photos' },
  { value: 'own', label: 'Your image' },
]
const TAB_OF = { none: 'none', colour: 'colours', gradient: 'colours', image: 'photos', own: 'own' }

// the same markup as a setting in Settings.jsx
function Row({ name, desc, children }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <div className="setting-name">{name}</div>
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

export function WallpaperSettings() {
  const w = usePrefs((s) => s.wallpaper)
  const [tab, setTab] = useState(TAB_OF[w.kind])
  return (
    <>
      <div className="wp-head">
        <h3 className="palette-group-title">
          <ImageIcon /> Background
        </h3>
        <div className="wp-preview" style={wallpaperVars(w, getOwnImage()) || undefined}>
          <div className="wp-mock-side" />
          <div className="wp-mock-page">
            <i />
            <i />
            <i />
            <i />
          </div>
          {w.kind === 'image' && <WallpaperCredit image={w.image} />}
        </div>
      </div>

      <div className="wp-tabs">
        <Segmented
          value={tab}
          options={TABS}
          onChange={(v) => {
            setTab(v)
            if (v === 'none') setWallpaper({ kind: 'none' })
          }}
        />
      </div>
      {tab === 'colours' && <Colours w={w} />}
      {tab === 'photos' && <Photos w={w} />}
      {tab === 'own' && <OwnImage w={w} />}
      {w.kind !== 'none' && <Controls w={w} />}
    </>
  )
}

function Colours({ w }) {
  const custom = w.kind === 'colour' && !COLOURS.includes(w.value)
  return (
    <>
      <div className="wp-swatches">
        {COLOURS.map((c) => (
          <button key={c} className={`wp-swatch ${w.kind === 'colour' && w.value === c ? 'active' : ''}`} style={{ background: c }} title={c} aria-label={`Colour ${c}`} onClick={() => setWallpaper({ kind: 'colour', value: c })} />
        ))}
        <label className={`wp-swatch wp-custom ${custom ? 'active' : ''}`} title="Any colour">
          <Pipette />
          <input type="color" value={w.kind === 'colour' ? w.value : '#336699'} onChange={(e) => setWallpaper({ kind: 'colour', value: e.target.value })} />
        </label>
      </div>
      <div className="wp-swatches">
        {GRADIENTS.map((g) => (
          <button
            key={g.id}
            className={`wp-swatch ${w.kind === 'gradient' && w.value === g.id ? 'active' : ''}`}
            style={{ backgroundColor: g.color, backgroundImage: g.image }}
            title={g.name}
            aria-label={`Gradient ${g.name}`}
            onClick={() => setWallpaper({ kind: 'gradient', value: g.id })}
          />
        ))}
      </div>
    </>
  )
}

const EMPTY = { items: [], page: 0, more: false, loading: false, error: '', name: '' }

function Photos({ w }) {
  const [providers, setProviders] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [provider, setProvider] = useState(w.pool?.provider || w.image?.provider || '')
  const [input, setInput] = useState(w.pool?.q || '')
  const [q, setQ] = useState(input)
  const [list, setList] = useState(EMPTY)
  const [picking, setPicking] = useState('')
  const latest = useRef(0)
  const sentinel = useRef(null)
  const current = providers?.find((p) => p.id === provider)

  useEffect(() => {
    wallpaperProviders().then(
      (all) => {
        setProviders(all)
        setProvider((now) => (all.some((p) => p.id === now) ? now : (all.find((p) => p.available) || all[0]).id))
      },
      (e) => setLoadError(e.message),
    )
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 450)
    return () => clearTimeout(t)
  }, [input])

  // a newer request makes any older one still on its way irrelevant
  function load(page) {
    const mine = ++latest.current
    setList((l) => ({ ...l, loading: true, error: '', ...(page === 1 && { items: [], more: false, page: 0 }) }))
    searchWallpapers(provider, q, page).then(
      (r) => mine === latest.current && setList((l) => ({ items: page === 1 ? r.items : [...l.items, ...r.items], page, more: r.more, loading: false, error: '', name: r.providerName })),
      (e) => mine === latest.current && setList((l) => ({ ...l, loading: false, error: e.message })),
    )
  }
  useEffect(() => {
    if (current?.available) load(1)
    else setList(EMPTY)
  }, [provider, q, current?.available])

  // more as the end of the grid scrolls into view
  useEffect(() => {
    if (!list.more || list.loading || list.error) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && load(list.page + 1), { rootMargin: '300px' })
    io.observe(sentinel.current)
    return () => io.disconnect()
  }, [list.more, list.loading, list.error, list.page])

  async function pick(item) {
    setPicking(item.id)
    try {
      await chooseWallpaper(item, { q, providerName: list.name })
    } catch (e) {
      toast.error(e)
    }
    setPicking('')
  }

  return (
    <>
      <div className="wp-bar">
        <select className="select" value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Photo source">
          {providers?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.available ? '' : ' (needs a key)'}
            </option>
          ))}
        </select>
        {current?.supportsSearch && current.available && <input className="input" type="search" placeholder={`Search ${current.name}`} value={input} onChange={(e) => setInput(e.target.value)} />}
      </div>
      {loadError && <div className="wp-notice error">{loadError}</div>}
      {!providers && !loadError && <Spinner />}
      {current && !current.available && (
        <div className="wp-notice">
          <b>{current.name} isn't set up on this server.</b> Whoever runs it needs to set <code>{current.keyEnv}</code> in its environment and restart
          {current.keyUrl && (
            <>
              {' '}
              (a free key is available from{' '}
              <a href={current.keyUrl} target="_blank" rel="noopener noreferrer">
                {new URL(current.keyUrl).hostname}
              </a>
              )
            </>
          )}
          .
        </div>
      )}
      {current?.available && (
        <p className="setting-desc wp-hint">
          {q ? `Results for “${q}”.` : `${current.featured}.`} {current.licenseNote}
        </p>
      )}
      {(list.items.length > 0 || list.loading || list.error) && (
        <div className="wp-scroll">
          <div className="wp-grid">
            {list.items.map((item) => (
              <button
                key={item.id}
                className={`wp-tile ${w.image?.provider === item.provider && w.image.id === item.id ? 'active' : ''} ${picking === item.id ? 'busy' : ''}`}
                title={[item.title, item.author].filter(Boolean).join(' — ')}
                disabled={!!picking}
                onClick={() => pick(item)}
              >
                <img src={item.thumb} alt={item.title || item.author || ''} loading="lazy" />
                {item.author && <span className="wp-by">{item.author}</span>}
                {picking === item.id && <Spinner />}
              </button>
            ))}
          </div>
          <div className="wp-more" ref={sentinel}>
            {list.loading && <Spinner />}
            {list.error && (
              <>
                <span className="wp-notice error">{list.error}</span>
                <button className="btn btn-sm" onClick={() => load(list.page + 1)}>
                  Try again
                </button>
              </>
            )}
            {!list.loading && !list.error && list.more && (
              <button className="btn btn-sm" onClick={() => load(list.page + 1)}>
                More
              </button>
            )}
          </div>
        </div>
      )}
      {!list.loading && !list.error && list.page === 1 && !list.items.length && <p className="setting-desc wp-hint">Nothing found.</p>}
    </>
  )
}

function OwnImage({ w }) {
  const file = useRef(null)
  const [busy, setBusy] = useState(false)
  async function choose(e) {
    const picked = e.target.files?.[0]
    e.target.value = ''
    if (!picked) return
    setBusy(true)
    try {
      await saveOwnWallpaper(picked)
    } catch (err) {
      toast.error(err)
    }
    setBusy(false)
  }
  return (
    <>
      <div className="wp-bar">
        <button className="btn" disabled={busy} onClick={() => file.current.click()}>
          <Upload /> {w.kind === 'own' ? 'Choose another…' : 'Choose an image…'}
        </button>
        {w.kind === 'own' && (
          <button className="btn btn-ghost" onClick={() => setWallpaper({ kind: 'none' })}>
            Remove
          </button>
        )}
        <input ref={file} type="file" accept="image/*" hidden onChange={choose} />
      </div>
      <div className="wp-notice">
        {w.kind === 'own' && !getOwnImage()
          ? "This device doesn't have your picture yet. Choose it again here."
          : "The picture stays in this browser. It isn't synced to your other devices, and it is never written into your notes or repository."}
      </div>
    </>
  )
}

function Controls({ w }) {
  const [busy, setBusy] = useState(false)
  const photo = isPhoto(w)
  const range = (key, min, max, to = (v) => v, from = (v) => v) => (
    <input type="range" className="range" min={min} max={max} value={from(w[key])} onChange={(e) => setWallpaper({ [key]: to(Number(e.target.value)) })} />
  )
  async function next() {
    setBusy(true)
    try {
      await shuffleWallpaper()
    } catch (e) {
      toast.error(e)
    }
    setBusy(false)
  }
  return (
    <>
      <Row name="Dim" desc={`${w.dim}%. Darkens a dark theme and lightens a light one, so text stays easy to read.`}>
        {range('dim', 0, 80)}
      </Row>
      {photo && (
        <Row name="Blur" desc={`${w.blur}px`}>
          {range('blur', 0, 40)}
        </Row>
      )}
      <Row name="Panel transparency" desc={`${100 - w.panelOpacity}%. Sidebars, bars and notes. Notes never go clearer than reading them comfortably allows.`}>
        {range('panelOpacity', 0, 100 - PANEL_MIN, (v) => 100 - v, (v) => 100 - v)}
      </Row>
      {photo && (
        <Row name="Fit">
          <Segmented
            value={w.fit}
            onChange={(fit) => setWallpaper({ fit })}
            options={[
              { value: 'cover', label: 'Fill' },
              { value: 'contain', label: 'Fit' },
              { value: 'tile', label: 'Tile' },
            ]}
          />
        </Row>
      )}
      {photo && w.fit === 'cover' && (
        <Row name="Show" desc="The part of a cropped picture that stays in view.">
          <Segmented
            value={w.position}
            onChange={(position) => setWallpaper({ position })}
            options={[
              { value: 'top', label: 'Top' },
              { value: 'center', label: 'Middle' },
              { value: 'bottom', label: 'Bottom' },
            ]}
          />
        </Row>
      )}
      {w.kind === 'image' && (
        <>
          <Row name="Change automatically" desc="Picks another from the same source. Skipped while offline or when your device asks to save data.">
            <Segmented
              value={w.rotate}
              onChange={(rotate) => setWallpaper({ rotate })}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'launch', label: 'Each launch' },
                { value: 'daily', label: 'Daily' },
              ]}
            />
          </Row>
          <Row name="Another picture" desc="Also in the command palette as “Shuffle background”.">
            <button className="btn" disabled={busy} onClick={next}>
              {busy ? <Spinner size="sm" /> : <Shuffle />} Next one
            </button>
          </Row>
        </>
      )}
      <Row name="Reset" desc="Back to no background, with every setting here at its default.">
        <button className="btn" onClick={() => setWallpaper(DEFAULT_WALLPAPER)}>
          <RotateCcw /> Reset
        </button>
      </Row>
    </>
  )
}
