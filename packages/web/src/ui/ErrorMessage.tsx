import { ApiError } from '../api';

/**
 * A failure in one short sentence (the server's Turkish message), with the raw cause such as
 * git's own output folded under "Ayrıntı" for whoever needs it.
 */
export function ErrorMessage({
  error,
  prefix,
  detail,
  tone = 'light',
  className = '',
}: {
  error: Error | string;
  /** e.g. "Eklenemedi:" */
  prefix?: string;
  /** Raw cause when it is not carried by an ApiError (e.g. task.gitErrorDetail). */
  detail?: string | null;
  /** `dark` inside the console panel. */
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const message = typeof error === 'string' ? error : error.message;
  const raw = detail ?? (error instanceof ApiError ? error.detail : null);
  const color = tone === 'dark' ? 'text-console-danger' : 'text-danger';
  return (
    <div role="alert" className={`flex flex-col gap-1 ${className}`}>
      <p className={`font-semibold ${color}`}>
        {prefix && `${prefix} `}
        {message}
      </p>
      {raw && raw !== message && (
        <details className={tone === 'dark' ? 'text-console-muted' : 'text-muted'}>
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">
            Ayrıntı
          </summary>
          <pre className="font-mono text-xs break-all whitespace-pre-wrap">{raw}</pre>
        </details>
      )}
    </div>
  );
}
