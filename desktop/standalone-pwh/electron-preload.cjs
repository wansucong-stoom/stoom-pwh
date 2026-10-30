'use strict';
// Only the app-owned top-level window and its print preview receive this
// narrow bridge. Rendered document frames have no Node integration.
const {contextBridge,ipcRenderer}=require('electron');
if(process.isMainFrame){
 contextBridge.exposeInMainWorld('pwhNative',Object.freeze({
  getPrinters:()=>ipcRenderer.invoke('pwh:printers'),
  showPrintWindow:()=>ipcRenderer.invoke('pwh:show-print'),
  printDocument:options=>ipcRenderer.invoke('pwh:print-document',options),
 }));
}
