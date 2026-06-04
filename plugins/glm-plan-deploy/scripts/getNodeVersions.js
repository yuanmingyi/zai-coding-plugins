"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNodeVersions = getNodeVersions;
const service_1 = require("./src/service");
const utils_1 = require("./src/utils");
async function getNodeVersions() {
  try {
    return await (0, service_1.getAvailableNodejsVersions)();
  } catch (error) {
    return (0, utils_1.handleUncaughtError)(error);
  }
}
//# sourceMappingURL=getNodeVersions.js.map
