/**
 * electron/preload.js
 * نظام إدارة مرور سبها
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // يمكن إضافة دوال هنا للاتصال بـ main process إذا لزم الأمر
  // مثال:
  // sendData: (data) => ipcRenderer.send('send-data', data),
  // onReceiveData: (callback) => ipcRenderer.on('receive-data', (event, ...args) => callback(...args))
});
