/**
 * An expected failure the API turns into `{ error, detail?, …extra }` with an HTTP status.
 * `message` is what the user reads (Turkish for the common cases); `detail` keeps the raw cause
 * (e.g. git's own output) for the "Ayrıntı" disclosure.
 */
export class ServiceError extends Error {
  readonly detail: string | undefined;
  readonly extra: Record<string, unknown> | undefined;

  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    options: { detail?: string; extra?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'ServiceError';
    this.detail = options.detail;
    this.extra = options.extra;
  }
}
