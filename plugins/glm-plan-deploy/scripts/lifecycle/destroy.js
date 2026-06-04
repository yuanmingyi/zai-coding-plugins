"use strict";

const {
  AuthConfigurationError,
  resolveDeployContext,
} = require("../common/auth");
const { formatDestroyResult } = require("../common/format");
const { requestJson } = require("../common/http");

async function runDestroy(options = {}) {
  const context = resolveDeployContext(options);

  try {
    const response = await requestJson({
      url: `${context.baseUrl}/client/tcb/uninit`,
      method: "POST",
      token: context.token,
      body: {},
      fetchImpl: options.fetchImpl,
    });

    const result = {
      success: true,
      data: response.data,
    };
    result.summary = formatDestroyResult(result);
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
  runDestroy,
};
