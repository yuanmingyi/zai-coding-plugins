"use strict";
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }
    : function (o, v) {
        o["default"] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== "default") __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileFilter = void 0;
exports.filterDirectoryFiles = filterDirectoryFiles;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
class FileFilter {
  ignoreRules = [];
  basePath;
  constructor(basePath) {
    this.basePath = path.resolve(basePath);
  }
  /**
   * load ignore rules from .ignore
   */
  async loadIgnoreFile(ignoreFilePath = ".ignore") {
    try {
      const content = await fs.readFile(ignoreFilePath, "utf-8");
      this.parseIgnoreRules(content);
    } catch (error) {
      console.warn(
        `Warning: Could not read ignore file at ${ignoreFilePath}: ${error}`,
      );
    }
  }
  addIgnoreFolders(ignoreFolders) {
    for (const folder of ignoreFolders) {
      const pattern = folder.trim();
      this.ignoreRules.push({
        pattern: pattern,
        isNegated: false,
        isDirectory: true,
        regex: this.patternToRegex(pattern),
      });
    }
  }
  /**
   * parse ignore rules
   */
  parseIgnoreRules(content) {
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmedLine = line.trim();
      // ignore blank lines and commented lines
      if (!trimmedLine || trimmedLine.startsWith("#")) {
        continue;
      }
      // parse the rules
      const isNegated = trimmedLine.startsWith("!");
      const pattern = isNegated ? trimmedLine.slice(1) : trimmedLine;
      const isDirectory = pattern.endsWith("/");
      const cleanPattern = isDirectory ? pattern.slice(0, -1) : pattern;
      this.ignoreRules.push({
        pattern: cleanPattern,
        isNegated,
        isDirectory,
        regex: this.patternToRegex(cleanPattern),
      });
    }
  }
  /**
   * transfer the pattern to regex
   */
  patternToRegex(pattern) {
    // Escape regex special characters, but preserve wildcards
    let regexPattern = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\*/g, ".*")
      .replace(/\\\?/g, ".");
    // handle the position of start and end of the path
    if (!pattern.includes("/")) {
      // if the pattern doesn't include a slash, it could match filenames in any position
      regexPattern = `(?:^|/)${regexPattern}(?:$|/)`;
    } else if (!pattern.startsWith("/")) {
      // if the pattern doesn't start with a slash, it can match any sub path
      regexPattern = `(?:^|.*/)${regexPattern}`;
    } else {
      // if the pattern starts with a slash, it can only match the root path
      regexPattern = `^${regexPattern.slice(1)}`;
    }
    return new RegExp(regexPattern);
  }
  /**
   * Check if the path is ignored
   */
  isIgnored(relativePath, isDirectory) {
    let isIgnored = false;
    for (const rule of this.ignoreRules) {
      // Check the folder matching rule
      if (rule.isDirectory && !isDirectory) {
        continue;
      }
      // use the regex to match
      if (rule.regex && rule.regex.test(relativePath)) {
        isIgnored = !rule.isNegated;
      }
      // or do simple string match
      else if (this.simplePatternMatch(rule.pattern, relativePath)) {
        isIgnored = !rule.isNegated;
      }
    }
    return isIgnored;
  }
  /**
   * Simple pattern matching (as a fallback for regex)
   */
  simplePatternMatch(pattern, path) {
    if (pattern === path) return true;
    if (pattern.endsWith("/")) {
      return path.startsWith(pattern) || path === pattern.slice(0, -1);
    }
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(path);
    }
    return path.includes(pattern);
  }
  /**
   * Recursively scan directories and filter files
   */
  async filterDirectory(dirPath = this.basePath) {
    const results = [];
    const relativeDirPath = path.relative(this.basePath, dirPath);
    // Check if current directory is ignored
    if (relativeDirPath && this.isIgnored(relativeDirPath, true)) {
      console.log(`Ignoring directory: ${relativeDirPath}/`);
      return results;
    }
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(this.basePath, fullPath);
        // Check if it is ignored
        if (this.isIgnored(relativePath, entry.isDirectory())) {
          console.log(
            `Ignoring ${entry.isDirectory() ? "directory" : "file"}: ${relativePath}`,
          );
          continue;
        }
        if (entry.isDirectory()) {
          // Recursively process subdirectories
          const subResults = await this.filterDirectory(fullPath);
          results.push(...subResults);
        } else {
          // Add file path
          results.push(relativePath);
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not read directory ${dirPath}: ${error}`);
    }
    return results;
  }
  /**
   * Get the list of all filtered files (relative paths)
   */
  async getFilteredFiles() {
    return await this.filterDirectory();
  }
  /**
   * Manually add ignore rules
   */
  addRule(pattern, isNegated = false) {
    const isDirectory = pattern.endsWith("/");
    const cleanPattern = isDirectory ? pattern.slice(0, -1) : pattern;
    this.ignoreRules.push({
      pattern: cleanPattern,
      isNegated,
      isDirectory,
      regex: this.patternToRegex(cleanPattern),
    });
  }
  /**
   * Clear all rules
   */
  clearRules() {
    this.ignoreRules = [];
  }
}
exports.FileFilter = FileFilter;
/**
 * Convenience function: Filter directory files based on .ignore file
 * @param directoryPath Directory path to filter
 * @param ignoreFile Ignore file path (default is '.ignore')
 * @param extraIgnoreFolders List of additional directory paths to exclude
 * @returns List of filtered file relative paths
 */
async function filterDirectoryFiles(
  directoryPath,
  ignoreFile = ".ignore",
  extraIgnoreFolders = [],
) {
  const filter = new FileFilter(directoryPath);
  await filter.loadIgnoreFile(ignoreFile);
  filter.addIgnoreFolders(extraIgnoreFolders);
  return await filter.getFilteredFiles();
}
//# sourceMappingURL=filterFiles.js.map
