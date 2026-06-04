"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restoreConsole = exports.overrideConsole = void 0;
let deploymentLogs = [];
let originalConsole;
function formatMsg(log) {
  return `${log.level}: ${log.message}`;
}
const overrideConsole = (ignoreLevels) => {
  if (!originalConsole) {
    originalConsole = { ...console };
  }
  const createLogFunction = (level, originalFn) => {
    return (...args) => {
      const timestamp = new Date().toISOString();
      const message = args
        .map((arg) =>
          typeof arg === "object" ? JSON.stringify(arg) : String(arg),
        )
        .join(" ");
      deploymentLogs.push({
        timestamp,
        level,
        message,
      });
      if (!ignoreLevels.includes(level)) {
        const formattedMsg = formatMsg({ timestamp, level, message });
        originalFn(formattedMsg);
      }
    };
  };
  console.log = createLogFunction("LOG", originalConsole.log);
  console.debug = createLogFunction("DEBUG", originalConsole.debug);
  console.error = createLogFunction("ERROR", originalConsole.error);
  console.warn = createLogFunction("WARN", originalConsole.warn);
  console.info = createLogFunction("INFO", originalConsole.info);
};
exports.overrideConsole = overrideConsole;
const restoreConsole = () => {
  if (originalConsole) {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
  }
};
exports.restoreConsole = restoreConsole;
//# sourceMappingURL=log.js.map
