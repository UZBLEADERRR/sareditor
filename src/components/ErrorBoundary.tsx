import React from "react";

import { describe, trace } from "../services/diagnostics";
import { CrashReport } from "./CrashReport";

type Props = { children: React.ReactNode };
type State = { error: string | null };

/**
 * Keeps a thrown render from taking the process with it.
 *
 * In a release build there is no red box: React unmounts the tree, the error
 * reaches the global handler, and the app is killed. Catching it here means the
 * user sees what happened and can send it on, which is the whole point.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: describe(error) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    trace(`FATAL render: ${describe(error)}\n${info.componentStack ?? ""}`);
  }

  render() {
    if (this.state.error) {
      return (
        <CrashReport
          report={this.state.error}
          onDismiss={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
