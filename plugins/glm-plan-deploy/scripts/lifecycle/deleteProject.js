"use strict";

const path = require("path");

const {
  AuthConfigurationError,
  assertDeployToken,
  resolveDeployContext,
} = require("../common/auth");
const { formatDeleteProjectResult } = require("../common/format");
const {
  loadArbitrarySettings,
  removeFileIfExists,
} = require("../common/settings");
const { isProjectNotFoundError, requestJson } = require("../common/http");

const NO_PROJECT_MESSAGE = [
  "❌ **No project found**",
  "- No arbitrary deployment project is configured in this directory.",
  "- Deploy a project first with `/glm-plan-deploy:deploy-arbitrary`.",
].join("\n");

const NO_REMOTE_PROJECTS_MESSAGE = [
  "ℹ️ **No projects to delete**",
  "- The deploy account has no projects on the server.",
  "- Nothing to do.",
].join("\n");

async function runDeleteProject(options = {}) {
  let context;
  try {
    context = resolveDeployContext(options);
    assertDeployToken(context.token);
  } catch (error) {
    return mapAuthError(error);
  }

  try {
    const settings = loadArbitrarySettings(context.projectSettingsPath, {
      cwd: context.cwd,
      projectName: path.basename(context.cwd),
      endpoint: context.baseUrl,
    });

    const explicitProjectId = options.projectId
      ? String(options.projectId)
      : null;
    const targetProjectId = explicitProjectId || settings.projectId;

    if (!targetProjectId) {
      return failure(NO_PROJECT_MESSAGE);
    }

    const matchesLocalSettings =
      Boolean(settings.projectId) && settings.projectId === targetProjectId;
    const projectName =
      options.projectName ||
      (matchesLocalSettings ? settings.projectName : null) ||
      targetProjectId;

    try {
      await requestJson({
        url: `${context.baseUrl}/client/tcb/deleteProject`,
        method: "POST",
        token: context.token,
        body: { projectId: targetProjectId },
        fetchImpl: options.fetchImpl,
      });
    } catch (error) {
      if (isProjectNotFoundError(error)) {
        if (matchesLocalSettings) {
          removeFileIfExists(context.projectSettingsPath);
        }
        return failure(
          [
            "❌ **Project not found on server**",
            `- The remote service reported that project "${projectName}" no longer exists.`,
            "- Local deployment settings have been cleaned up if they pointed at the deleted project.",
          ].join("\n"),
        );
      }
      throw error;
    }

    let cleanupWarning = null;
    if (matchesLocalSettings) {
      try {
        removeFileIfExists(context.projectSettingsPath);
      } catch (error) {
        cleanupWarning = `Delete API succeeded, but local settings cleanup failed: ${error.message}`;
      }
    }

    const result = {
      success: true,
      cleanupWarning,
      projectId: targetProjectId,
      projectName,
      localCleanupApplied: matchesLocalSettings,
    };
    result.summary = formatDeleteProjectResult(result);
    return result;
  } catch (error) {
    return mapAuthError(error);
  }
}

async function previewDeleteProject(options = {}) {
  let context;
  try {
    context = resolveDeployContext(options);
    assertDeployToken(context.token);
  } catch (error) {
    return { ...mapAuthError(error), stage: "preview" };
  }

  try {
    const settings = loadArbitrarySettings(context.projectSettingsPath, {
      cwd: context.cwd,
      projectName: path.basename(context.cwd),
      endpoint: context.baseUrl,
    });

    const explicitProjectId = options.projectId
      ? String(options.projectId)
      : null;

    if (explicitProjectId) {
      return await previewExplicitRemoteProject(
        context,
        explicitProjectId,
        options,
      );
    }

    if (!settings.projectId) {
      return await previewRemoteProjectList(context, options);
    }

    const projectName = settings.projectName || path.basename(context.cwd);
    return {
      success: true,
      stage: "preview",
      projectId: settings.projectId,
      projectName,
      confirmationPrompt: buildConfirmationPrompt(projectName),
      summary: `Preview ready for "${projectName}".`,
    };
  } catch (error) {
    return { ...mapAuthError(error), stage: "preview" };
  }
}

async function previewExplicitRemoteProject(context, projectId, options) {
  const projects = await listRemoteProjects(context, options);
  const project = projects.find((item) => item.projectId === projectId);
  if (!project) {
    const message = [
      "❌ **Project not found**",
      `- The projectId "${projectId}" was not found in the remote project list.`,
      "- Run the delete command again to refresh the list.",
    ].join("\n");
    return {
      success: false,
      stage: "preview",
      message,
      summary: message,
    };
  }

  return {
    success: true,
    stage: "preview",
    projectId: project.projectId,
    projectName: project.projectName,
    confirmationPrompt: buildConfirmationPrompt(project.projectName),
    summary: `Preview ready for "${project.projectName}".`,
  };
}

async function previewRemoteProjectList(context, options) {
  const projects = await listRemoteProjects(context, options);
  if (projects.length === 0) {
    return {
      success: false,
      stage: "preview",
      message: NO_REMOTE_PROJECTS_MESSAGE,
      summary: NO_REMOTE_PROJECTS_MESSAGE,
    };
  }

  const projectListPrompt = buildProjectListPrompt(projects);
  return {
    success: true,
    stage: "preview",
    projects,
    projectListPrompt,
    summary: `Found ${projects.length} remote project${
      projects.length === 1 ? "" : "s"
    }; user must choose which one to delete.`,
  };
}

async function listRemoteProjects(context, options = {}) {
  const response = await requestJson({
    url: `${context.baseUrl}/client/tcb/projects`,
    token: context.token,
    fetchImpl: options.fetchImpl,
  });

  const items = Array.isArray(response.data) ? response.data : [];
  return items
    .filter((item) => item && item.projectId)
    .map((item, index) => {
      const project = {
        index: index + 1,
        projectId: String(item.projectId),
        projectName: String(item.projectName || item.projectId),
      };
      if (item.url) project.url = String(item.url);
      if (item.area) project.area = String(item.area);
      return project;
    });
}

function buildProjectListPrompt(projects) {
  const lines = ["Which project do you want to delete?", ""];
  for (const project of projects) {
    lines.push(`${project.index}. ${project.projectId}`);
    if (project.projectName && project.projectName !== project.projectId) {
      lines.push(`   - name: ${project.projectName}`);
    }
    if (project.url) {
      lines.push(`   - URL: ${project.url}`);
    }
  }
  lines.push("");
  lines.push(
    `Please reply with a number (1-${projects.length}) or the projectId.`,
  );
  return lines.join("\n");
}

function buildConfirmationPrompt(projectName) {
  return [
    `⚠️ **This will permanently delete project "${projectName}" and all of its deployments.**`,
    "This action is NOT recoverable. Continue? (yes/no)",
  ].join("\n");
}

function failure(message) {
  return {
    success: false,
    message,
    summary: message,
  };
}

function mapAuthError(error) {
  const message =
    error instanceof AuthConfigurationError && error.userMessage
      ? error.userMessage
      : error.message;
  return failure(message);
}

module.exports = {
  NO_PROJECT_MESSAGE,
  NO_REMOTE_PROJECTS_MESSAGE,
  buildConfirmationPrompt,
  buildProjectListPrompt,
  previewDeleteProject,
  runDeleteProject,
};
