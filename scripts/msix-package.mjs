import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const unsignedOid = 'OID.2.25.311729368913984317654407730594956997722=1';
const xml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function msixIdentity({channel, version, identity} = {}) {
  if (!['preview', 'store'].includes(channel)) throw Error('MSIX channel must be preview or store');
  if (!/^\d+\.\d+\.\d+$/.test(version || '') || version.split('.').some(n => Number(n) > 65535)) throw Error('Invalid MSIX version');
  if (channel === 'preview') {
    if (identity) throw Error('Preview uses an isolated unsigned identity, not a Store identity');
    return {name:'STOOM.PwhDesktop.Preview', publisher:'CN=STOOM Pwh Preview, ' + unsignedOid,
      publisherDisplayName:'STOOM', displayName:'Pwh Desktop 시험판', version:version+'.0', channel};
  }
  if (!identity || !/^[A-Za-z0-9][A-Za-z0-9.-]{2,49}$/.test(identity.name || '')
    || !/^CN=[^\r\n<>]{1,200}$/.test(identity.publisher || '') || /OID\.|PREVIEW|EXAMPLE|PLACEHOLDER/i.test(identity.publisher)
    || typeof identity.publisherDisplayName !== 'string' || !identity.publisherDisplayName.trim()
    || identity.publisherDisplayName.length > 256 || /[\x00-\x1f]/.test(identity.publisherDisplayName)) {
    throw Error('Provide the exact Name, Publisher and PublisherDisplayName from Partner Center');
  }
  return {...identity, displayName:'Pwh Desktop', version:version+'.0', channel};
}

export function msixManifest(identity) {
  const {name, publisher, publisherDisplayName, displayName, version} = identity;
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
 xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
 xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
 xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
 IgnorableNamespaces="uap uap3 rescap">
 <Identity Name="${xml(name)}" Publisher="${xml(publisher)}" Version="${xml(version)}" ProcessorArchitecture="x64"/>
 <Properties><DisplayName>${xml(displayName)}</DisplayName><PublisherDisplayName>${xml(publisherDisplayName)}</PublisherDisplayName><Logo>Assets\\StoreLogo.png</Logo></Properties>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0"/></Dependencies>
 <Resources><Resource Language="ko-KR"/><Resource Language="en-US"/></Resources>
 <Applications><Application Id="Pwh" Executable="PwhDesktop.exe" EntryPoint="Windows.FullTrustApplication">
  <uap:VisualElements DisplayName="${xml(displayName)}" Description="한글 문서 편집과 AI 대화" BackgroundColor="#071019" Square150x150Logo="Assets\\Square150x150Logo.png" Square44x44Logo="Assets\\Square44x44Logo.png"/>
  <Extensions><uap3:Extension Category="windows.fileTypeAssociation"><uap3:FileTypeAssociation Name="pwhdocuments" Parameters="&quot;%1&quot;">
   <uap:DisplayName>Pwh 한글 문서</uap:DisplayName><uap:Logo>Assets\\Square44x44Logo.png</uap:Logo>
   <uap:SupportedFileTypes><uap:FileType>.hwp</uap:FileType><uap:FileType>.hwpx</uap:FileType></uap:SupportedFileTypes>
  </uap3:FileTypeAssociation></uap3:Extension></Extensions>
 </Application></Applications>
 <Capabilities><rescap:Capability Name="runFullTrust"/></Capabilities>
</Package>
`;
}

export async function runMsixTool(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {windowsHide:true, stdio:['ignore','pipe','pipe']});
    let diagnostic = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { diagnostic = (diagnostic + b).slice(-16000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(diagnostic) : reject(Error(path.basename(executable)+' ('+code+'): '+diagnostic)));
  });
}

export async function packageMsix({payload, output, sdkDirectory, channel, version, identityFile, assetRoot}) {
  if (process.platform !== 'win32' || ![payload,output,sdkDirectory,assetRoot].every(x => typeof x === 'string' && path.isAbsolute(x))
    || !output.toLowerCase().endsWith('.msix')) throw Error('MSIX requires Windows and absolute payload, output, SDK and asset paths');
  const relativeOutput = path.relative(payload, output);
  if (!relativeOutput.startsWith('..'+path.sep) && relativeOutput !== '..' && !path.isAbsolute(relativeOutput)) throw Error('MSIX output must be outside its payload');
  const identity = msixIdentity({channel,version,identity:identityFile ? JSON.parse(await fs.readFile(identityFile,'utf8')) : undefined});
  const makeappx = path.join(sdkDirectory,'makeappx.exe'); await fs.access(makeappx);
  const canonical = path.join(assetRoot,'pwh-icon-256.png');
  const icon = await fs.readFile(canonical);
  if (createHash('sha256').update(icon).digest('hex') !== 'a1b8eea130ebe2f67e01b29cee9911ff1bfb6662851291111a786edc8a34e9cd') throw Error('Approved Pwh product icon differs');
  await runMsixTool(path.join(process.env.WINDIR || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./msix-assets.ps1',import.meta.url)),canonical,path.join(payload,'Assets')]);
  await fs.writeFile(path.join(payload,'AppxManifest.xml'),msixManifest(identity),{flag:'wx'});
  const distribution = {schema:1,channel:channel === 'preview' ? 'msix-preview' : 'microsoft-store',name:identity.name};
  await fs.writeFile(path.join(payload,'standalone-pwh/distribution.json'),JSON.stringify(distribution,null,2)+'\n',{flag:'wx'});
  const packageLog = await runMsixTool(makeappx,['pack','/d',payload,'/p',output,'/h','SHA256','/o']);
  const bytes = await fs.readFile(output);
  return {format:'msix',channel,identity,output,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),
    signing:channel === 'preview' ? 'unsigned-test-only' : 'unsigned-store-submission',
    packageToolResult:packageLog.trim().split(/\r?\n/).filter(Boolean).at(-1)};
}
