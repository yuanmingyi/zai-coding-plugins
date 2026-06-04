import { describe, expect, it } from "vitest";

import {
  formatArbitraryAnalyzeResult,
  formatArbitraryBuildValidationResult,
  formatArbitraryPreflightResult,
  formatArbitraryStatusResult,
  formatDeleteProjectResult,
  formatDestroyResult,
  formatInitResult,
  formatStandardDetectionResult,
} from "../common/format.js";

describe("common/format", () => {
  it("formats init success results", () => {
    expect(formatInitResult({ success: true })).toContain(
      "Deployment environment initialized",
    );
  });

  it("formats destroy success results", () => {
    expect(formatDestroyResult({ success: true })).toContain(
      "Deployment environment destroyed",
    );
  });

  it("formats delete project success results", () => {
    const text = formatDeleteProjectResult({
      success: true,
      projectName: "demo",
      localCleanupApplied: true,
    });
    expect(text).toContain("Project deleted");
    expect(text).toContain("Project: demo");
    expect(text).toContain("Local settings have been cleaned up");
    expect(text).not.toContain("Remaining environments");
    expect(text).not.toContain("Deleted: ");
  });

  it("surfaces a cleanup warning if local settings could not be removed", () => {
    const text = formatDeleteProjectResult({
      success: true,
      projectName: "demo",
      cleanupWarning: "Permission denied on tcb-settings.json",
    });
    expect(text).toContain("Permission denied");
    expect(text).not.toContain("Local settings have been cleaned up");
  });

  it("formats arbitrary status results", () => {
    expect(
      formatArbitraryStatusResult({
        success: true,
        status: "Processing",
        currentStep: "UPLOAD",
      }),
    ).toContain("Status: Processing");
  });

  it("formats arbitrary preflight results", () => {
    const text = formatArbitraryPreflightResult({
      success: true,
      projectId: "project-1",
      envStatus: "normal",
      envReady: true,
      firstDeployNotice: null,
      timeoutSeconds: 300,
      maxRetries: 3,
      uploadSizeLimit: 104857600,
    });
    expect(text).toContain("Project ID: project-1");
    expect(text).toContain("Env status: normal");
    expect(text).toContain("Retry budget: 3");
    expect(text).not.toContain("envType");
    expect(text).not.toContain("Benefit");
  });

  it("surfaces a first-deploy notice in the preflight summary when present", () => {
    const text = formatArbitraryPreflightResult({
      success: true,
      projectId: null,
      envStatus: "not_initialized",
      envReady: false,
      firstDeployNotice: "Heads up: provisioning may take several minutes.",
      timeoutSeconds: 300,
      maxRetries: 3,
      uploadSizeLimit: 104857600,
    });
    expect(text).toContain("provisioning may take several minutes");
  });

  it("formats arbitrary analysis results", () => {
    expect(
      formatArbitraryAnalyzeResult({
        success: true,
        needsUserInput: false,
        detectedConfig: {
          language: "Node.js",
          version: "20",
          buildCommand: "npm ci && npm run build",
          output: "dist",
          startCommand: "npm start",
        },
      }),
    ).toContain("Proceeding with detected settings");
  });

  it("formats static arbitrary analysis without a process start command", () => {
    expect(
      formatArbitraryAnalyzeResult({
        success: true,
        needsUserInput: false,
        detectedConfig: {
          language: "Node.js",
          version: "22",
          runtimeKind: "static",
          buildCommand: "npm ci && npm run build",
          output: "dist",
          startCommand: null,
        },
      }),
    ).toContain("Runtime: static nginx");
  });

  it("formats arbitrary build validation success results", () => {
    expect(
      formatArbitraryBuildValidationResult({
        success: true,
        buildSucceeded: true,
        buildCommand: "npm ci && npm run build",
      }),
    ).toContain("Local build validation passed");
  });

  it("formats standard detection results", () => {
    expect(
      formatStandardDetectionResult({
        success: true,
        projectType: "nodejs",
        nodeVersion: "20.18.0",
        outdir: "dist",
        buildCommand: "npm ci && npm run build",
      }),
    ).toContain("Node.js: 20.18.0");
  });
});
