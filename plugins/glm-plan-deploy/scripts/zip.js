"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zip = zip;
const filterFiles_1 = require("./src/filterFiles");
const utils_1 = require("./src/utils");
async function zip(targetPath, ignoreFilePath, outDir) {
  try {
    const excludeOutMsg = !!outDir
      ? `, and ignore the output dir "${outDir}"`
      : "";
    console.info(
      `zip files in current folder to target ${targetPath}${excludeOutMsg} and patterns in ${ignoreFilePath}`,
    );
    const zip = await (0, utils_1.zipFiles)(
      targetPath,
      await (0, filterFiles_1.filterDirectoryFiles)(
        process.cwd(),
        ignoreFilePath,
        !!outDir ? [outDir] : [],
      ),
    );
    return {
      success: true,
      status: "zipped size:" + zip.size,
      message: "zip executed successfully",
    };
  } catch (error) {
    return (0, utils_1.handleUncaughtError)(error);
  }
}
//# sourceMappingURL=zip.js.map
