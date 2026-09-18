import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

// A render error used to leave a blank page with the note still open behind it.
// Notes are saved continuously, so the honest thing is to say what happened and
// offer the reload rather than show nothing at all.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[obi] render error', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash">
        <div className="crash-card">
          <AlertTriangle />
          <h2>Obi hit an error</h2>
          <p>
            Your notes are safe — everything you typed was saved as you went. Reloading picks up where you left off.
          </p>
          <button className="btn btn-primary" onClick={() => location.reload()}>
            <RefreshCw /> Reload
          </button>
          <details>
            <summary>Details</summary>
            <pre>{String(this.state.error?.stack || this.state.error)}</pre>
          </details>
        </div>
      </div>
    )
  }
}
