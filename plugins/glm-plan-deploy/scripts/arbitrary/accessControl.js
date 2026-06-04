"use strict";

const NGINX_ACCESS_CONTROL_CAPABILITY =
  "runtime-nginx-x-envoy-external-address-v1";

function buildRuntimeCapabilities() {
  return {
    nginxAccessControl: NGINX_ACCESS_CONTROL_CAPABILITY,
  };
}

function normalizeAccessControl(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const enabled = value.enabled === true;
  const mode = normalizeString(value.mode);
  const expectedDeniedStatus = normalizePositiveInteger(
    value.expectedDeniedStatus,
  );

  return {
    enabled,
    mode,
    source: normalizeString(value.source),
    enforcement: normalizeString(value.enforcement),
    policyVersion: normalizeString(value.policyVersion),
    status: normalizeString(value.status),
    expectedDeniedStatus: expectedDeniedStatus || null,
  };
}

function isRestrictedAccessControl(accessControl) {
  return Boolean(
    accessControl &&
    accessControl.enabled === true &&
    accessControl.mode === "restricted",
  );
}

function isExpectedAccessDeniedStatus(accessControl, status) {
  if (!isRestrictedAccessControl(accessControl)) {
    return false;
  }

  const expectedStatus =
    normalizePositiveInteger(accessControl.expectedDeniedStatus) || 403;
  return Number(status) === expectedStatus;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }
  return number;
}

module.exports = {
  NGINX_ACCESS_CONTROL_CAPABILITY,
  buildRuntimeCapabilities,
  isExpectedAccessDeniedStatus,
  normalizeAccessControl,
};
