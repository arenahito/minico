import type { UserFacingError } from "../../core/errors/errorMapper";

interface ErrorBannerProps {
  error: UserFacingError;
  onDismiss: () => void;
}

export function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  return (
    <aside className="error-banner" role="alert" aria-live="assertive">
      <div>
        <p className="error-banner-title">{error.title}</p>
        <p className="error-banner-message">{error.message}</p>
        <p className="error-banner-recovery">{error.recovery}</p>
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss error">
        Dismiss
      </button>
    </aside>
  );
}

