export interface KeyValuePair {
  key: string;
  value: string;
}
export interface UploadParams {
  presignedUploadUrl: string;
  path: string;
  area: string;
}
export interface CreateDeploymentArg {
  projectId?: string;
  path: string;
  env: KeyValuePair[];
  extraParams: {
    nodejs?: string;
    framework?: string;
    outputDir?: string;
    buildCmd?: string;
    installCmd?: string;
  };
}
export interface CreateDeploymentResult {
  projectId: string;
  deployId: string;
}
export interface GetDeploymentStatusResult {
  id: string;
  status: string;
  startTime?: number;
  endTime?: number;
  result?: {
    message?: string;
    previewUrl?: string;
    deployLog?: string;
    auditDetail?: string;
  };
}
export declare const api_base_url: string;
export declare const putObjectForDeploy: (
  url: string,
  file: File,
) => Promise<any>;
export declare const getUploadParamsForDeploy: (
  projectId?: string,
) => Promise<UploadParams>;
export declare const getAvailableNodejsVersions: () => Promise<string[]>;
export declare const deployProject: (
  arg: CreateDeploymentArg,
) => Promise<CreateDeploymentResult>;
export declare const getDeployStatus: (
  projectId: string,
  deployId: string,
) => Promise<GetDeploymentStatusResult>;
export declare const getDeployLog: (
  projectId: string,
  deployId: string,
) => Promise<string>;
//# sourceMappingURL=service.d.ts.map
