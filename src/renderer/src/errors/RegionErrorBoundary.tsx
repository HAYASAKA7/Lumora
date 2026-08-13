import {
  Component,
  type ErrorInfo,
  type ReactNode
} from 'react';

interface RegionErrorBoundaryProps {
  children: ReactNode;
  description: string;
  resetKey?: string | number | null;
  retryLabel: string;
  heading: string;
  onError?(): void;
}

interface RegionErrorBoundaryState {
  failed: boolean;
}

export class RegionErrorBoundary extends Component<
  RegionErrorBoundaryProps,
  RegionErrorBoundaryState
> {
  state: RegionErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RegionErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    this.props.onError?.();
  }

  componentDidUpdate(previous: RegionErrorBoundaryProps): void {
    if (
      this.state.failed &&
      previous.resetKey !== this.props.resetKey
    ) {
      this.setState({ failed: false });
    }
  }

  private readonly retry = (): void => {
    this.setState({ failed: false });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <section
        aria-label={this.props.heading}
        className="region-error-boundary"
        role="alert"
      >
        <span aria-hidden="true" className="status-warning-icon">!</span>
        <div>
          <h2>{this.props.heading}</h2>
          <p>{this.props.description}</p>
          <button
            className="secondary-button"
            onClick={this.retry}
            type="button"
          >
            {this.props.retryLabel}
          </button>
        </div>
      </section>
    );
  }
}
