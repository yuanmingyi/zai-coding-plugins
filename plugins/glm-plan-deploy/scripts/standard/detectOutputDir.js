"use strict";

const fs = require("fs");
const path = require("path");

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

function detectOutputDir(projectDir, options = {}) {
  const packageJson = options.packageJson || loadPackageJson(projectDir);

  const angularPath = path.join(projectDir, "angular.json");
  if (fs.existsSync(angularPath)) {
    const angular = JSON.parse(fs.readFileSync(angularPath, "utf8"));
    const projectKey = Object.keys(angular.projects || {})[0];
    const outputPath =
      projectKey &&
      angular.projects[projectKey] &&
      angular.projects[projectKey].architect &&
      angular.projects[projectKey].architect.build &&
      angular.projects[projectKey].architect.build.options &&
      angular.projects[projectKey].architect.build.options.outputPath;

    if (outputPath) {
      return path.posix.join(outputPath.replace(/\\/g, "/"), "browser");
    }

    if (projectKey) {
      return `dist/${projectKey}/browser`;
    }
  }

  const nextConfig = findFirstFile(projectDir, [
    "next.config.js",
    "next.config.mjs",
    "next.config.cjs",
    "next.config.ts",
  ]);
  if (nextConfig) {
    const text = readText(nextConfig);
    const distDir = matchValue(text, /distDir\s*:\s*["'`]([^"'`]+)["'`]/);
    if (distDir) {
      return distDir;
    }
    if (
      (packageJson &&
        packageJson.scripts &&
        /next export/.test(packageJson.scripts.build || "")) ||
      /output\s*:\s*["'`]export["'`]/.test(text || "")
    ) {
      return "out";
    }
    return ".next";
  }

  const viteConfig = findFirstFile(projectDir, [
    "vite.config.js",
    "vite.config.mjs",
    "vite.config.cjs",
    "vite.config.ts",
  ]);
  if (viteConfig) {
    return (
      matchValue(readText(viteConfig), /outDir\s*:\s*["'`]([^"'`]+)["'`]/) ||
      "dist"
    );
  }

  const astroConfig = findFirstFile(projectDir, [
    "astro.config.js",
    "astro.config.mjs",
    "astro.config.cjs",
    "astro.config.ts",
  ]);
  if (astroConfig) {
    return (
      matchValue(readText(astroConfig), /outDir\s*:\s*["'`]([^"'`]+)["'`]/) ||
      "dist"
    );
  }

  const svelteConfig = path.join(projectDir, "svelte.config.js");
  if (fs.existsSync(svelteConfig)) {
    return (
      matchValue(readText(svelteConfig), /outDir\s*:\s*["'`]([^"'`]+)["'`]/) ||
      "build"
    );
  }

  const webpackConfig = findFirstFile(projectDir, [
    "webpack.config.js",
    "webpack.config.cjs",
    "webpack.config.mjs",
    "webpack.config.ts",
  ]);
  if (webpackConfig) {
    return (
      matchValue(readText(webpackConfig), /path\s*:\s*["'`]([^"'`]+)["'`]/) ||
      "dist"
    );
  }

  const nuxtConfig = findFirstFile(projectDir, [
    "nuxt.config.js",
    "nuxt.config.ts",
  ]);
  if (nuxtConfig) {
    const text = readText(nuxtConfig);
    return (
      matchValue(text, /dir\s*:\s*["'`]([^"'`]+)["'`]/) ||
      matchValue(text, /buildDir\s*:\s*["'`]([^"'`]+)["'`]/) ||
      ".output/public"
    );
  }

  if (hasDependency(packageJson, "gatsby")) {
    return "public";
  }

  if (hasDependency(packageJson, "vite")) {
    return "dist";
  }

  return null;
}

function findFirstFile(projectDir, fileNames) {
  return fileNames
    .map((fileName) => path.join(projectDir, fileName))
    .find((filePath) => fs.existsSync(filePath));
}

function loadPackageJson(projectDir) {
  const packageJsonPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
}

function matchValue(text, pattern) {
  const match = String(text || "").match(pattern);
  return match ? match[1] : null;
}

function hasDependency(packageJson, dependencyName) {
  if (!packageJson) return false;
  return Boolean(
    (packageJson.dependencies && packageJson.dependencies[dependencyName]) ||
    (packageJson.devDependencies &&
      packageJson.devDependencies[dependencyName]),
  );
}

module.exports = {
  detectOutputDir,
};
