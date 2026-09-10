type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const minLevel = LEVEL_PRIORITY[(process.env.LOG_LEVEL as LogLevel) ?? 'info'] ?? 1

const format = (level: LogLevel, scope: string, message: string, extra?: unknown) => {
  const ts = new Date().toISOString()
  const base = `${ts} [${level.toUpperCase()}] [${scope}] ${message}`
  if (extra !== undefined && extra !== null) {
    return `${base} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`
  }
  return base
}

export const createLogger = (scope: string) => ({
  debug: (message: string, extra?: unknown) => {
    if (LEVEL_PRIORITY.debug >= minLevel) console.debug(format('debug', scope, message, extra))
  },
  info: (message: string, extra?: unknown) => {
    if (LEVEL_PRIORITY.info >= minLevel) console.log(format('info', scope, message, extra))
  },
  warn: (message: string, extra?: unknown) => {
    if (LEVEL_PRIORITY.warn >= minLevel) console.warn(format('warn', scope, message, extra))
  },
  error: (message: string, extra?: unknown) => {
    if (LEVEL_PRIORITY.error >= minLevel) console.error(format('error', scope, message, extra))
  }
})

export type Logger = ReturnType<typeof createLogger>
