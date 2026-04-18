import * as React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * React Error Boundary for WidgetRenderer.
 * Prevents widget rendering errors from crashing the entire chat.
 */
export class WidgetErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error) {
    console.warn('[WidgetErrorBoundary]', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm my-1">
          <p className="font-medium text-destructive">Widget rendering error</p>
          {this.state.error && (
            <p className="mt-1 text-xs text-muted-foreground">{this.state.error.message}</p>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
