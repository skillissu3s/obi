import { useRef, useState, useSyncExternalStore } from 'react'
import { Image as ImageIcon, ImagePlus, RotateCcw, Pipette, Trash2 } from 'lucide-react'
import { Segmented, Spinner } from '../ui.jsx'
import { usePrefs } from '../../store/prefs.js'
import { toast } from '../../store/ui.js'
import { COLOURS, GRADIENTS, DEFAULT_WALLPAPER, PANEL_MIN, plateFloor, isPhoto, wallpaperVars, getOwnImage, subscribeOwnImage } from '../../lib/wallpaper.js'
import { saveOwnWallpaper, setWallpaper, backToOwnPicture, removeOwnWallpaper } from '../../lib/wallpaperSource.js'

// Settings → Appearance → Background: a live preview, a colour or your own
// picture, and how it sits behind the app.

const TABS = [
  { value: 'none', label: 'None' },
  { value: 'colour', label: 'Colour' },
  { value: 'image', label: 'Image' },
]
const TAB_OF = { none: 'none', colour: 'colour', gradient: 'colour', own: 'image' }

const useOwnImage = () => useSyncExternalStore(subscribeOwnImage, getOwnImage)

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
  const own = useOwnImage()
  const [tab, setTab] = useState(TAB_OF[w.kind])
  return (
    <>
      <div className="wp-head">
        <h3 className="palette-group-title">
          <ImageIcon /> Background
        </h3>
        <div className="wp-preview" style={wallpaperVars(w, own) || undefined}>
          <div className="wp-mock-side" />
          <div className="wp-mock-page">
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>

      <div className="wp-tabs">
        <Segmented
          value={tab}
          options={TABS}
          onChange={(v) => {
            setTab(v)
            if (v === 'none') setWallpaper({ kind: 'none' })
            // your picture is still on this device: picking the tab puts it back
            if (v === 'image' && own && w.kind !== 'own') backToOwnPicture()
          }}
        />
      </div>
      {tab === 'colour' && <Colours w={w} />}
      {tab === 'image' && <OwnImage w={w} own={own} />}
      {w.kind !== 'none' && <Controls w={w} />}
    </>
  )
}

function Colours({ w }) {
  const custom = w.kind === 'colour' && !COLOURS.includes(w.value)
  return (
    <>
      <div className="wp-label">Solid</div>
      <div className="wp-swatches">
        {COLOURS.map((c) => (
          <button key={c} className={`wp-swatch ${w.kind === 'colour' && w.value === c ? 'active' : ''}`} style={{ background: c }} title={c} aria-label={`Colour ${c}`} onClick={() => setWallpaper({ kind: 'colour', value: c })} />
        ))}
        <label className={`wp-swatch wp-custom ${custom ? 'active' : ''}`} title="Any colour" style={custom ? { background: w.value } : undefined}>
          <Pipette />
          <input type="color" aria-label="Any colour" value={w.kind === 'colour' ? w.value : '#336699'} onChange={(e) => setWallpaper({ kind: 'colour', value: e.target.value })} />
        </label>
      </div>
      <div className="wp-label">Gradient</div>
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

function OwnImage({ w, own }) {
  const file = useRef(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  async function take(picked) {
    if (!picked) return
    setBusy(true)
    try {
      await saveOwnWallpaper(picked)
    } catch (err) {
      toast.error(err)
    }
    setBusy(false)
  }
  const drop = {
    onDragOver: (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return
      e.preventDefault()
      setOver(true)
    },
    onDragLeave: (e) => !e.currentTarget.contains(e.relatedTarget) && setOver(false),
    onDrop: (e) => {
      e.preventDefault()
      setOver(false)
      take(e.dataTransfer.files?.[0])
    },
  }
  const input = (
    <input
      ref={file}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const picked = e.target.files?.[0]
        e.target.value = ''
        take(picked)
      }}
    />
  )
  if (!own)
    return (
      <>
        <button type="button" className={`wp-drop ${over ? 'over' : ''}`} disabled={busy} onClick={() => file.current.click()} {...drop}>
          {busy ? <Spinner /> : <ImagePlus />}
          <span className="wp-drop-title">{busy ? 'Preparing your picture…' : 'Choose an image'}</span>
          <span className="wp-drop-hint">or drop one here · JPG, PNG, WebP</span>
        </button>
        {input}
        <p className="setting-desc wp-hint">It stays on this device. It isn't synced, and it is never written into your notes or repository.</p>
      </>
    )
  return (
    <>
      <div className={`wp-own ${over ? 'over' : ''}`} {...drop}>
        <button type="button" className={`wp-own-thumb ${w.kind === 'own' ? 'active' : ''}`} title="Use this picture" onClick={backToOwnPicture} style={{ backgroundImage: `url(${JSON.stringify(own.url)})` }} aria-label="Use your picture" />
        <div className="wp-own-actions">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => file.current.click()}>
            {busy ? <Spinner size="sm" /> : <ImagePlus />} Replace…
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={removeOwnWallpaper}>
            <Trash2 /> Remove
          </button>
          <p className="setting-desc">Kept on this device only. Drop another picture here to replace it.</p>
        </div>
      </div>
      {input}
    </>
  )
}

function Controls({ w }) {
  const photo = isPhoto(w)
  const range = (key, min, max, to = (v) => v, from = (v) => v) => (
    <input type="range" className="range" min={min} max={max} value={from(w[key])} onChange={(e) => setWallpaper({ [key]: to(Number(e.target.value)) })} />
  )
  return (
    <div className="wp-controls">
      <Row name="Dim" desc={`${w.dim}%. Darkens a dark theme and lightens a light one, so text stays easy to read.`}>
        {range('dim', 0, 80)}
      </Row>
      {photo && (
        <Row name="Blur" desc={`${w.blur}px`}>
          {range('blur', 0, 40)}
        </Row>
      )}
      <Row
        name="Panel transparency"
        desc={`${100 - Math.max(w.panelOpacity, plateFloor(w.dim))}%. Sidebars, bars, notes, tasks and calendars. None goes clearer than reading it comfortably allows${w.panelOpacity < plateFloor(w.dim) ? ', which depends on the dim' : ''}.`}
      >
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
      <Row name="Reset" desc="Back to no background, with every setting here at its default.">
        <button className="btn" onClick={() => setWallpaper(DEFAULT_WALLPAPER)}>
          <RotateCcw /> Reset
        </button>
      </Row>
    </div>
  )
}
