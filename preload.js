// MateBook Kontrol — eser sahibi: Alican Tutu (mbk-alican-tutu)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mb', {
  env: () => ipcRenderer.invoke('env'),
  init: () => ipcRenderer.invoke('hw:init'),
  status: () => ipcRenderer.invoke('hw:status'),
  systemInfo: () => ipcRenderer.invoke('hw:systemInfo'),
  socCondition: () => ipcRenderer.invoke('hw:socCondition'),

  setMode: (m) => ipcRenderer.invoke('hw:setMode', m),
  setPerf: (m) => ipcRenderer.invoke('hw:setPerf', m),
  setTurbo: (b) => ipcRenderer.invoke('hw:setTurbo', b),
  setBoost: (v) => ipcRenderer.invoke('hw:setBoost', v),
  setThermal: (p) => ipcRenderer.invoke('hw:setThermal', p),

  setSmartChargeOn: () => ipcRenderer.invoke('hw:setSmartChargeOn'),
  setChargeLimit: (c) => ipcRenderer.invoke('hw:setChargeLimit', c),
  setChargeThreshold: (lo, hi) => ipcRenderer.invoke('hw:setChargeThreshold', lo, hi),
  setResumeCharging: (b) => ipcRenderer.invoke('hw:setResumeCharging', b),

  raw: (hex) => ipcRenderer.invoke('hw:raw', hex),
  profile: (name) => ipcRenderer.invoke('hw:profile', name),
  applyFull: (name, opts) => ipcRenderer.invoke('hw:applyFull', name, opts || {}),
  osd: (p) => ipcRenderer.invoke('osd:show', p || {}),

  relaunchAdmin: () => ipcRenderer.invoke('app:relaunchAdmin'),

  audioRun: () => ipcRenderer.invoke('audio:run'),
  audioReveal: () => ipcRenderer.invoke('audio:reveal'),

  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close'),
  },
});
