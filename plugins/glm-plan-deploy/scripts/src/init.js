"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.args = exports.programDir = void 0;
const path_1 = require("path");
const process_1 = require("process");
exports.programDir = (0, path_1.dirname)(process.argv[1]);
exports.args = process.argv.slice(2);
try {
  (0, process_1.loadEnvFile)(`${exports.programDir}/.env`);
} catch (err) {
  // load env failed, ignored
}
//# sourceMappingURL=init.js.map
