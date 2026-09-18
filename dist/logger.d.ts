/**
 * logger.ts — where the SDK's internal logs go.
 *
 * The SDK had 16 `console.*` sites, four of them ungated, and no way for a host to route or silence
 * them. A `logger` threads one sink through the driver, players, pipeline and state machine.
 *
 * `debug` is developer detail (what `dev: true` used to gate); `warn` is something worth surfacing
 * even in production. `detail` is a small structured bag — never a person, a URL, or free-form
 * message text beyond the fixed `message`. Absent a logger, the SDK behaves exactly as before:
 * `debug` prints only under `dev`, `warn` always.
 */
export type LogLevel = 'debug' | 'warn';
export type Logger = (level: LogLevel, message: string, detail?: Record<string, unknown>) => void;
/** The default sink when a host passes none: dev-gated `console`, matching pre-logger behavior. */
export declare function consoleLogger(dev: boolean): Logger;
