import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/Button";
import { openLogDir, reportFrontendError } from "../lib/api";
import { t } from "../lib/i18n";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("MangaVault UI error", error, info);
    void reportFrontendError(error.message, info.componentStack ?? "").catch(() => undefined);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center bg-background p-8">
          <div className="max-w-lg rounded-lg border border-border bg-panel p-6">
            <h1 className="text-lg font-semibold">{t("appCrashedTitle")}</h1>
            <p className="mt-2 text-sm text-foreground/65">{t("appCrashedBody")}</p>
            <p className="mt-3 text-xs text-foreground/45">{this.state.error.message}</p>
            <div className="mt-5 flex gap-2">
              <Button onClick={() => window.location.reload()}>{t("reloadApp")}</Button>
              <Button variant="subtle" onClick={() => void openLogDir()}>
                {t("openLogs")}
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
