export declare const getPackageVersion: () => any;
export declare const updateDeploySettings: (newSettings: any) => void;
export declare const isInvalidProjectIdError: (error: any) => boolean;
export declare const resetDeploySettings: (deploySettings: any) => void;
export declare const switchEndpoint: (
  deploySettings: any,
  currentEndpoint: string,
) => any;
export declare const loadDeploySettings: () => any;
export declare function zipFiles(
  targetFile: string,
  files: string[],
): Promise<File>;
/**
 * Error handling wrapper for consistent error responses
 */
export declare function handleUncaughtError(error: any): {
  success: false;
  status: string;
  message: string;
};
//# sourceMappingURL=utils.d.ts.map
