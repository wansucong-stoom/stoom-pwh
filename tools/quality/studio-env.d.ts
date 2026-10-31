// The optional HwpCtrl plugin is disabled in Pwh's build. Keep its host contract
// visible to TypeScript without installing or enabling the runtime plugin.
declare module '@rhwp/hwpctrl/studio-plugin' {
  export const hwpctrlStudioPlugin: import('@/plugin/types').StudioPlugin;
}
