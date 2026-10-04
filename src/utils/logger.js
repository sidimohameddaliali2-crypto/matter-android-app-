// Dev-only console wrapper. Info/debug logs are stripped from release builds;
// errors still surface since they're useful for support/crash triage.
export const logger = {
  log: (...args) => {
    if (__DEV__) console.log(...args);
  },
  warn: (...args) => {
    if (__DEV__) console.warn(...args);
  },
  error: (...args) => {
    console.error(...args);
  },
};

export default logger;
