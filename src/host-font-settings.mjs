// Settings must use the same host catalog as document rendering. No browser
// permission request or font byte transfer is needed to inspect this catalog.
export function hostFontSettingsState(source) {
  if (!source.active) return null;
  return {
    supported:true, method:/** @type {'host-font-provider'} */('host-font-provider'), loaded:true, stored:false,
    source:/** @type {'host-font-provider'} */('host-font-provider'), complete:false, storage:/** @type {'none'} */('none'),
    count:source.references().length, checkedFamilies:[], probedFamilies:[],
    unresolvedFamilies:[], detectedAt:null, lastError:source.lastError,
  };
}

export async function detectHostFontSettings(source, getFonts, options={}) {
  if (!source.active) return null;
  await source.ready();
  if (source.lastError) throw new Error('앱의 시스템 글꼴 목록을 확인하지 못했습니다. '+source.lastError);
  return getFonts({includeRegistered:options.includeRegistered});
}
