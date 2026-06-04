"use strict";

const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

function renderTemplate(template, data) {
  if (typeof template !== "string") {
    throw new Error("renderTemplate: template must be a string");
  }
  if (!data || typeof data !== "object") {
    throw new Error("renderTemplate: data must be an object");
  }

  const usedKeys = new Set();
  const output = template.replace(PLACEHOLDER_PATTERN, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      throw new Error(
        `renderTemplate: missing value for placeholder \`${key}\``,
      );
    }
    const value = data[key];
    if (value == null) {
      throw new Error(
        `renderTemplate: value for placeholder \`${key}\` must not be null or undefined`,
      );
    }
    usedKeys.add(key);
    return String(value);
  });

  for (const key of Object.keys(data)) {
    if (!usedKeys.has(key)) {
      throw new Error(
        `renderTemplate: unused data key \`${key}\` (template has no matching placeholder)`,
      );
    }
  }

  return output;
}

module.exports = {
  renderTemplate,
};
