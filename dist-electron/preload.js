"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  // 应用路径
  getAppPath: () => electron.ipcRenderer.invoke("get-app-path"),
  // 试管操作
  getTubes: () => electron.ipcRenderer.invoke("db:getTubes"),
  getTube: (id) => electron.ipcRenderer.invoke("db:getTube", id),
  addTube: (tube) => electron.ipcRenderer.invoke("db:addTube", tube),
  updateTube: (tube) => electron.ipcRenderer.invoke("db:updateTube", tube),
  deleteTube: (id) => electron.ipcRenderer.invoke("db:deleteTube", id),
  // 实验操作
  getExperiments: () => electron.ipcRenderer.invoke("db:getExperiments"),
  getExperiment: (id) => electron.ipcRenderer.invoke("db:getExperiment", id),
  saveExperiment: (exp) => electron.ipcRenderer.invoke("db:saveExperiment", exp),
  deleteExperiment: (id) => electron.ipcRenderer.invoke("db:deleteExperiment", id),
  // 试管使用记录
  getTubeUsage: (tubeId) => electron.ipcRenderer.invoke("db:getTubeUsage", tubeId),
  addTubeUsage: (record) => electron.ipcRenderer.invoke("db:addTubeUsage", record)
});
