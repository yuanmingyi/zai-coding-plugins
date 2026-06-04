"use strict";

const {
  AuthConfigurationError,
  resolveDeployContext,
} = require("../common/auth");
const { formatInitResult } = require("../common/format");
const { requestJson } = require("../common/http");

async function runInit(options = {}) {
  const context = resolveDeployContext(options);

  try {
    const response = await requestJson({
      url: `${context.baseUrl}/client/tcb/init`,
      method: "POST",
      token: context.token,
      body: {},
      fetchImpl: options.fetchImpl,
    });

    const result = {
      success: true,
      data: response.data,
    };
    result.summary = formatInitResult(result);
    return result;
  } catch (error) {
    const message =
      error instanceof AuthConfigurationError && error.userMessage
        ? error.userMessage
        : error.message;

    return {
      success: false,
      message,
      summary: message,
    };
  }
}

module.exports = {
  runInit,
};
