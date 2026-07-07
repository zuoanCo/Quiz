import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("studyAssistant", {
  platform: process.platform
});
