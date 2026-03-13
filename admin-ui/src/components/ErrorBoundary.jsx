import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Admin UI crashed', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-shell">
          <div className="error-card">
            <div className="card-title"><span className="dot dot-red" /> UI Error</div>
            <h1 className="error-title">This screen crashed.</h1>
            <p className="muted-copy">
              The UI caught a rendering error and prevented a full black screen. Reload the page or switch tabs after fixing the data issue.
            </p>
            <pre className="json-view mt-16">{this.state.error.message || 'Unknown UI error'}</pre>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload UI</button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
