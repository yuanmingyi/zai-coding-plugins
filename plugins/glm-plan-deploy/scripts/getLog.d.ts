export declare function getLog(): Promise<
  | string
  | {
      success: false;
      status: string;
      message: string;
    }
  | {
      success: boolean;
      error: string;
    }
>;
//# sourceMappingURL=getLog.d.ts.map
