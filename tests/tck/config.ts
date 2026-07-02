export interface TckConfig {
  baseUrl: string;
  repositoryId: string;
  parentRootId?: string;
  runRootId?: string;
  allowDestructive: boolean;
  allowStress: boolean;
  reportDir: string;
}

export function parseBoolean(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value.toLowerCase())) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

export function readTckConfig(env: NodeJS.ProcessEnv = process.env): TckConfig {
  return {
    baseUrl: env.BOX_CMIS_TCK_BASE_URL ?? "http://127.0.0.1:8080/cmis",
    repositoryId: env.BOX_CMIS_TCK_REPOSITORY_ID ?? "box",
    parentRootId: env.BOX_CMIS_TCK_PARENT_ROOT_ID,
    runRootId: env.BOX_CMIS_TCK_RUN_ROOT_ID,
    allowDestructive: parseBoolean(env.BOX_CMIS_TCK_ALLOW_DESTRUCTIVE),
    allowStress: parseBoolean(env.BOX_CMIS_TCK_ALLOW_STRESS),
    reportDir: env.BOX_CMIS_TCK_REPORT_DIR ?? "tests/tck/reports"
  };
}

export function requireDestructiveTckConfig(config: TckConfig): void {
  if (!config.allowDestructive) {
    throw new Error("Set BOX_CMIS_TCK_ALLOW_DESTRUCTIVE=true before running write/delete TCK tests.");
  }

  if (!config.parentRootId && !config.runRootId) {
    throw new Error("Set BOX_CMIS_TCK_PARENT_ROOT_ID or BOX_CMIS_TCK_RUN_ROOT_ID before running destructive TCK tests.");
  }
}

export function requireStressTckConfig(config: TckConfig): void {
  requireDestructiveTckConfig(config);

  if (!config.allowStress) {
    throw new Error("Set BOX_CMIS_TCK_ALLOW_STRESS=true before running stress TCK tests.");
  }
}
