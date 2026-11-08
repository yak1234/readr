import { contextBridge, ipcRenderer } from "electron";
import type { ReadrApi, VideoKey, VideoState } from "../shared/types";

const call = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
const fire = (channel: string) => (...args: unknown[]) => ipcRenderer.send(channel, ...args);

function listen<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_e: unknown, value: T) => cb(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: ReadrApi = {
  sites: call("sites"),
  login: call("login"),
  openOriginal: call("openOriginal"),
  feeds: call("feeds"),
  fetchFeed: call("fetchFeed"),
  extract: call("extract"),
  library: call("library"),
  getArticle: call("getArticle"),
  updateArticle: call("updateArticle"),
  deleteArticle: call("deleteArticle"),
  translate: call("translate"),
  lookup: call("lookup"),
  sidecarStatus: call("sidecarStatus"),
  vocab: call("vocab"),
  addVocab: call("addVocab"),
  updateVocab: call("updateVocab"),
  removeVocab: call("removeVocab"),
  exportVocab: call("exportVocab"),
  importBrowserLogins: call("importBrowserLogins"),

  videoShow: call("videoShow"),
  videoBounds: fire("videoBounds"),
  videoHide: fire("videoHide"),
  videoSeek: fire("videoSeek"),
  videoPlayRange: fire("videoPlayRange"),
  videoToggle: fire("videoToggle"),
  videoRate: fire("videoRate"),
  videoOverlay: fire("videoOverlay"),
  videoCapture: call("videoCapture"),
  onVideoState: (cb) => listen<VideoState>("video:state", cb),
  onVideoKey: (cb) => listen<VideoKey>("video:key", cb),
} as ReadrApi;

contextBridge.exposeInMainWorld("readr", api);
