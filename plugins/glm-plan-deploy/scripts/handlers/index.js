/**
 * Command Handlers Index
 *
 * This module exports all command handlers extracted from the main() function
 * in deploy.js as part of the TDD refactoring effort.
 *
 * Each handler:
 * - Uses the initCloudBase() utility for SDK initialization
 * - Returns structured results { success, data, error }
 * - Is fully tested with 80%+ coverage
 *
 * Usage:
 *   import { handleListEnvs } from './handlers/index.js';
 *   const result = await handleListEnvs({ silent: true });
 */

"use strict";

const { handleListEnvs } = require("./listEnvs.js");
const { handleShowEnv } = require("./showEnv.js");
const { handleDeleteFn } = require("./deleteFn.js");
const { handleCreateEnv } = require("./createEnv.js");
const { handleDestroyEnv } = require("./destroyEnv.js");
const { handleTagEnv } = require("./tagEnv.js");
const { handleCreateMysql } = require("./createMysql.js");
const { handleShowMysql } = require("./showMysql.js");
const { handleDeleteMysql } = require("./deleteMysql.js");
const { handleShowFn } = require("./showFn.js");
const { handleShowLog } = require("./showLog.js");
const { handleSaveFn } = require("./saveFn.js");

module.exports = {
  handleListEnvs,
  handleShowEnv,
  handleDeleteFn,
  handleCreateEnv,
  handleDestroyEnv,
  handleTagEnv,
  handleCreateMysql,
  handleShowMysql,
  handleDeleteMysql,
  handleShowFn,
  handleShowLog,
  handleSaveFn,
};
