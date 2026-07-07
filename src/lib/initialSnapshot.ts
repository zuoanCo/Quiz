import type { RemoteBankConfig, StudySnapshot } from "../types";
import { nowIso } from "./id";

export const defaultRemoteConfig: RemoteBankConfig = {
  endpoint: "",
  token: "",
  enabled: false,
  status: "idle",
  message: "尚未配置远程题库"
};

export function createEmptySnapshot(): StudySnapshot {
  return {
    version: 1,
    subjects: [],
    chapters: [],
    questions: [],
    remoteConfig: defaultRemoteConfig,
    updatedAt: nowIso()
  };
}
