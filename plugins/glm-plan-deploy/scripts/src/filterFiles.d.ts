export declare class FileFilter {
  private ignoreRules;
  private basePath;
  constructor(basePath: string);
  /**
   * load ignore rules from .ignore
   */
  loadIgnoreFile(ignoreFilePath?: string): Promise<void>;
  addIgnoreFolders(ignoreFolders: string[]): void;
  /**
   * parse ignore rules
   */
  private parseIgnoreRules;
  /**
   * transfer the pattern to regex
   */
  private patternToRegex;
  /**
   * Check if the path is ignored
   */
  private isIgnored;
  /**
   * Simple pattern matching (as a fallback for regex)
   */
  private simplePatternMatch;
  /**
   * Recursively scan directories and filter files
   */
  filterDirectory(dirPath?: string): Promise<string[]>;
  /**
   * Get the list of all filtered files (relative paths)
   */
  getFilteredFiles(): Promise<string[]>;
  /**
   * Manually add ignore rules
   */
  addRule(pattern: string, isNegated?: boolean): void;
  /**
   * Clear all rules
   */
  clearRules(): void;
}
/**
 * Convenience function: Filter directory files based on .ignore file
 * @param directoryPath Directory path to filter
 * @param ignoreFile Ignore file path (default is '.ignore')
 * @param extraIgnoreFolders List of additional directory paths to exclude
 * @returns List of filtered file relative paths
 */
export declare function filterDirectoryFiles(
  directoryPath: string,
  ignoreFile?: string,
  extraIgnoreFolders?: string[],
): Promise<string[]>;
//# sourceMappingURL=filterFiles.d.ts.map
