import { getEnv } from '../config/env';

type Level = 'error' | 'warn' | 'info' | 'debug' | 'trace';

const order: Record<Level, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

function currentLevel(): Level {
  return getEnv().LOG_LEVEL;
}

function enabled(level: Level) {
  return order[level] <= order[currentLevel()];
}

export const log = {
  error: (...args: unknown[]) => enabled('error') && console.error(...args),
  warn: (...args: unknown[]) => enabled('warn') && console.warn(...args),
  info: (...args: unknown[]) => enabled('info') && console.log(...args),
  debug: (...args: unknown[]) => enabled('debug') && console.log(...args),
  trace: (...args: unknown[]) => enabled('trace') && console.log(...args),
};

