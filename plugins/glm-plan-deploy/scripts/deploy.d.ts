/**
 * Deploy current folder as a nodejs project to cloud
 * Initiates deployment and polls for completion status.
 *
 * @param ignoreFilePath - Path to the .ignore file
 * @returns Promise containing deployment result with final status and URL
 *
 * @example
 * ```typescript
 * const result = await deploy('/path/to/.ignore', { node: '18', outdir: 'dist' });
 * if (result.success) {
 *   console.log(`Deployment ${result.status}: ${result.deployId}`);
 *   if (result.url) {
 *     console.log(`Preview URL: ${result.url}`);
 *   }
 * } else {
 *   console.error('Deployment failed:', result.message);
 * }
 * ```
 */
interface ExtraParams {
  node: string;
  outdir: string;
}
export declare function deploy(
  ignoreFilePath: string,
  extraParam: ExtraParams,
): Promise<{
  success: boolean;
  status?: string;
  projectId?: string;
  deployId?: string;
  url?: string;
  message: string;
  log?: string;
  audit?: string;
}>;
export {};
//# sourceMappingURL=deploy.d.ts.map
