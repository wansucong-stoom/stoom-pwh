#!/usr/bin/env python3
"""Maintenance only: preserve a reviewed Windows runtime and its build evidence.

No documents, user fonts, credentials, runtime configuration or Git history are
collected. Installation uses Node and the prebuilt ZIP, not this Python script.
"""
import argparse, hashlib, json, os, shutil, subprocess, tempfile, zipfile, tarfile
from pathlib import Path

PIN = '1a76570e833917d15817415a53c09ad61ab3203f'
COMPONENTS = ('rhwp', 'core', 'editor-sdk', 'studio', 'studio-inline')
ROOTS = ('src', 'crates', 'bindings', 'npm', 'rhwp-studio', 'rhwp-shared',
         'scripts', 'vendor', 'typescript', 'template', 'assets')
ROOT_FILES = ('Cargo.toml', 'Cargo.lock', 'build.rs', 'LICENSE', 'THIRD_PARTY_LICENSES.md',
              'rust-toolchain.toml', 'rustfmt.toml', 'README.md', 'README_EN.md')

def sha(data): return hashlib.sha256(data).hexdigest()
def js(value): return (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode()
def git(root, *args):
    env = {**os.environ, 'GIT_NO_LAZY_FETCH': '1', 'GIT_TERMINAL_PROMPT': '0'}
    return subprocess.check_output(['git', '-c', 'core.autocrlf=false', '-C', str(root), *args], env=env)
def regular(file):
    if file.is_symlink() or not file.is_file(): raise ValueError(f'Not a regular input: {file.name}')
    return file.read_bytes()
def walk(root, prefix=''):
    out = {}
    for file in sorted(root.rglob('*')):
        if file.is_symlink(): raise ValueError(f'Symlink input: {file.name}')
        if file.is_file(): out[prefix+file.relative_to(root).as_posix()] = regular(file)
    return out
def build_dependencies(studio):
    package=json.loads(regular(studio/'package.json'))
    queue=[studio/'node_modules'/name for name in (*package.get('dependencies',{}),'vite','typescript')]
    found=set()
    while queue:
        directory=queue.pop().resolve()
        if directory in found:continue
        if not (directory/'package.json').is_file():raise ValueError('Missing build dependency: '+directory.name)
        found.add(directory);meta=json.loads(regular(directory/'package.json'))
        for name in set(meta.get('dependencies',{}))|set(meta.get('optionalDependencies',{})):
            cursor=directory;resolved=None
            while cursor!=cursor.parent:
                candidate=cursor/'node_modules'/name
                if (candidate/'package.json').is_file():resolved=candidate;break
                cursor=cursor.parent
            if resolved is not None:queue.append(resolved)
            elif name not in meta.get('optionalDependencies',{}):raise ValueError('Missing transitive build dependency: '+name)
    out={}
    for directory in sorted(found):
        relative=directory.relative_to(studio.parent.resolve()).as_posix()
        out.update(walk(directory,relative+'/'))
    out['PWH-DEPENDENCIES.json']=js({'scope':'Installed dependencies needed for the Windows x64 Studio client build; upstream browser test/PWA dependencies are not included','packages':[p.relative_to(studio.parent.resolve()).as_posix() for p in sorted(found)]})
    return out
def zip_new(file, entries):
    with zipfile.ZipFile(file, 'x', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, data in sorted(entries.items()):
            if name.startswith('/') or '..' in name.split('/') or '\\' in name: raise ValueError('Unsafe ZIP input')
            info=zipfile.ZipInfo(name, (1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=(0o100644 << 16);z.writestr(info,data)
    return {'file': file.name, 'size': file.stat().st_size, 'sha256': sha(file.read_bytes())}
def main():
    p=argparse.ArgumentParser(description=__doc__)
    for arg in ('runtime-root','build-root','upstream-root','output-dir'): p.add_argument('--'+arg,required=True,type=Path)
    p.add_argument('--license-evidence',required=True,type=Path)
    p.add_argument('--revision',type=int,default=1);p.add_argument('--write-lock',action='store_true')
    a=p.parse_args();project=Path(__file__).resolve().parents[1]
    if git(a.upstream_root,'rev-parse','HEAD').decode().strip()!=PIN: raise ValueError('Unexpected upstream commit')
    if git(a.upstream_root,'status','--porcelain','--untracked-files=no'): raise ValueError('Upstream checkout is modified')
    a.output_dir.mkdir(parents=True,exist_ok=True)
    identity=f'rhwp-0.8.7-pwh-r{a.revision}'; tag=f'engine-{identity}'
    base=f'https://github.com/wansucong-stoom/stoom-pwh/releases/download/{tag}/'
    pwh_commit=git(project,'rev-parse','HEAD').decode().strip()
    # Only tracked, reviewed build inputs from the exact upstream tree.
    tracked=git(a.upstream_root,'ls-files','-s','-z','--',*ROOTS,*ROOT_FILES).decode().split('\0')
    pristine={};blob_records={}
    for item in filter(None,tracked):
        meta,name=item.split('\t',1);mode,blob,_=meta.split()
        # Reference documents and binary fonts are not needed for pwh's Studio
        # build; their separate redistribution terms are not inferred from MIT.
        if name.startswith(('assets/screenshots/','rhwp-studio/public/samples/')):continue
        if name.startswith('assets/fonts/') and Path(name).suffix.lower() not in ('.md','.txt'):continue
        if mode!='100644' and mode!='100755': raise ValueError('Unsupported tracked input mode')
        data=regular(a.upstream_root/name)
        if hashlib.sha1(f'blob {len(data)}\0'.encode()+data).hexdigest()!=blob: raise ValueError('Upstream input differs from Git blob: '+name)
        pristine[name]=data;blob_records[name]=blob
    pristine['PWH-SOURCE-PROVENANCE.json']=js({'commit':PIN,'includedRoots':ROOTS,'excluded':'reference documents, samples, binary fonts, screenshots, large tools/fixtures and Git history; this is a build-input snapshot, not the whole Git repository','gitBlobs':blob_records})
    upstream=zip_new(a.output_dir/f'pwh-upstream-rhwp-0.8.7-{PIN[:12]}.zip',pristine)
    # Rebuild inputs are complete for the Studio client; core/CLI are preserved
    # unmodified binaries. Rust dependency vendoring/toolchain is not claimed.
    patched={name:data for name,data in pristine.items() if name.startswith(('rhwp-studio/','npm/')) or name=='LICENSE'}
    for name in list(patched):
        source=a.build_root/name
        if source.is_file():patched[name]=regular(source)
    for file in sorted((a.build_root/'rhwp-studio/src').rglob('*')):
        if file.is_file():patched[file.relative_to(a.build_root).as_posix()]=regular(file)
    patched.update(walk(a.build_root/'pkg','pkg/'))
    patched= {name:data for name,data in patched.items() if '/node_modules/' not in name and '/dist/' not in name}
    patched_asset=zip_new(a.output_dir/f'pwh-studio-inputs-{identity}.zip',patched)
    # Build a real git-apply patch against pristine Studio + original npm core.
    with tempfile.TemporaryDirectory(prefix='pwh-overlay-',dir=a.output_dir) as temp:
        temp=Path(temp);base_inputs={name:data for name,data in pristine.items() if name in patched}
        if temp.resolve().parent!=a.output_dir.resolve() or not temp.name.startswith('pwh-overlay-'):raise ValueError('Unsafe patch workspace')
        original_core=a.runtime_root/'core'
        for name in patched:
            if name.startswith('pkg/') and (original_core/name[4:]).is_file():base_inputs[name]=regular(original_core/name[4:])
        for name,data in base_inputs.items(): f=temp/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(data)
        git(temp,'init','--quiet');git(temp,'config','user.name','pwh preservation');git(temp,'config','user.email','preservation@localhost')
        git(temp,'add','-f','.');git(temp,'commit','--quiet','-m','Exact upstream inputs')
        before={name:sha(data) for name,data in base_inputs.items()}
        for name,data in patched.items(): f=temp/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(data)
        git(temp,'add','-f','.');patch=git(temp,'diff','--cached','--binary','HEAD')
        patch_file=a.output_dir/f'pwh-studio-overlay-{identity}.patch';patch_file.write_bytes(patch)
        changes=[{'path':name,'beforeSha256':before.get(name),'afterSha256':sha(data),'change':'modified' if name in before else 'added'} for name,data in sorted(patched.items()) if before.get(name)!=sha(data)]
        git(temp,'reset','--hard','--quiet','HEAD');git(temp,'clean','-fdx','--quiet')
        git(temp,'apply','--check',str(patch_file.resolve()));git(temp,'apply',str(patch_file.resolve()))
        for name,data in patched.items():
            if sha(regular(temp/name))!=sha(data):raise ValueError('Patch replay mismatch: '+name)
    dependencies=build_dependencies(a.build_root/'rhwp-studio')
    deps_asset=zip_new(a.output_dir/f'pwh-studio-dependencies-{identity}-windows-x64.zip',dependencies)
    del dependencies
    source_files=git(project,'ls-files','-z').decode().split('\0')
    own={name:regular(project/name) for name in filter(None,source_files) if name!='runtime-lock.json' and (project/name).is_file()}
    own['PWH-SNAPSHOT-NOTE.txt']=b'Maintenance source snapshot. Use the separately published runtime-lock.json for installation; it is excluded here to avoid circular archive hashes.\n'
    own_asset=zip_new(a.output_dir/f'pwh-build-scripts-{identity}.zip',own)
    original_archives={}
    for name in ('rhwp-v0.8.7-windows-x86_64.zip','core-0.8.7.tgz','editor-0.8.7.tgz'):
        data=regular(a.runtime_root/'downloads'/name);dest=a.output_dir/name
        if dest.exists():raise ValueError('Output exists')
        dest.write_bytes(data);original_archives[name]={'file':name,'sha256':sha(data),'size':len(data)}
    with tarfile.open(a.runtime_root/'downloads/core-0.8.7.tgz','r:gz') as t:
        for name in ('rhwp.js','rhwp_bg.wasm'):
            if t.extractfile('package/'+name).read()!=regular(a.runtime_root/'core'/name):raise ValueError('Installed core differs from upstream package')
    with zipfile.ZipFile(a.runtime_root/'downloads/rhwp-v0.8.7-windows-x86_64.zip') as z:
        exes=[name for name in z.namelist() if name.endswith('rhwp.exe')]
        if len(exes)!=1 or z.read(exes[0])!=regular(a.runtime_root/'rhwp/rhwp.exe'):raise ValueError('Installed CLI differs from upstream executable')
    lightning_source=a.license_evidence/'lightningcss-1.33.0-source.zip'
    lightning_meta=json.loads(regular(a.license_evidence/'lightningcss-source.json'))
    shutil.copyfile(lightning_source,a.output_dir/lightning_source.name)
    license_assets=[{'file':lightning_source.name,'size':lightning_source.stat().st_size,'sha256':sha(regular(lightning_source))}]
    cargo_archive=zip_new(a.output_dir/'pwh-rhwp-0.8.7-cargo-crates.zip',walk(a.license_evidence/'crates','crates/'))
    license_assets.append(cargo_archive)
    notice=regular(a.license_evidence/'THIRD-PARTY-NOTICES.txt')
    notices_asset=a.output_dir/'THIRD-PARTY-NOTICES.txt';notices_asset.write_bytes(notice)
    license_assets.append({'file':notices_asset.name,'size':len(notice),'sha256':sha(notice)})
    for name in ('npm-licenses.json','cargo-licenses.json'):
        data=regular(a.license_evidence/name);(a.output_dir/name).write_bytes(data)
        license_assets.append({'file':name,'size':len(data),'sha256':sha(data)})
    provenance={'upstreamVersion':'0.8.7','upstreamCommit':PIN,'pwhBaseCommit':pwh_commit,
        'pwhBuildFiles':{name:sha(regular(project/name)) for name in ('scripts/setup.mjs','scripts/build-inline.mjs','scripts/preserve-engine.py','scripts/preserved-runtime.mjs','src/studio-selection.ts','src/studio-inline-adapter.ts')},
        'changes':changes,'nativeCoreChanges':False,'nativeCliChanges':False,
        'coreJsGluePatched':any(change['path']=='pkg/rhwp.js' for change in changes),
        'patch':{'file':patch_file.name,'sha256':sha(patch),'replayVerified':True},
        'buildDependencies':deps_asset,'patchedStudioInputs':patched_asset,'upstreamSource':upstream,
        'pwhBuildScripts':own_asset,'originalArchives':original_archives,
        'mplSource':lightning_meta,
        'rebuildScope':'Windows x64 Studio client; native CLI/WASM binaries retained unchanged. Cargo archives retained; Rust toolchain, Skia externals and a full native rebuild are not validated.'}
    provenance_file=a.output_dir/'PROVENANCE.json';provenance_file.write_bytes(js(provenance))
    files={}
    for component in COMPONENTS:files.update(walk(a.runtime_root/component,component+'/'))
    for component in COMPONENTS:files[component+'/licenses/pwh-preservation/THIRD-PARTY-NOTICES.txt']=notice
    # Only allow the five engine/editor components, never the runtime documents,
    # fonts, source caches, recovery drafts or machine-specific configuration.
    home=str(Path.home()).encode()
    for name,data in files.items():
        if Path(name).suffix in ('.json','.md','.txt','.html','.js') and home in data:raise ValueError('Machine home path in runtime text: '+name)
    manifest={'schemaVersion':1,'id':identity,'upstreamCommit':PIN,'provenance':provenance,
        'files':[{'path':name,'size':len(data),'sha256':sha(data)} for name,data in sorted(files.items())]}
    files['runtime-manifest.json']=js(manifest)
    runtime=zip_new(a.output_dir/f'pwh-runtime-{identity}-windows-x64.zip',files);runtime['url']=base+runtime['file']
    assets=[upstream,patched_asset,deps_asset,own_asset,*original_archives.values(),*license_assets,
        {'file':patch_file.name,'sha256':sha(patch),'size':len(patch)},
        {'file':provenance_file.name,'sha256':sha(provenance_file.read_bytes()),'size':provenance_file.stat().st_size}]
    lock={'schemaVersion':1,'id':identity,'platform':'win32-x64','upstreamVersion':'0.8.7','upstreamCommit':PIN,
        'releaseTag':tag,'runtime':runtime,'preservationAssets':[{**asset,'url':base+asset['file']} for asset in assets]}
    (a.output_dir/'runtime-lock.json').write_bytes(js(lock))
    if a.write_lock:(project/'runtime-lock.json').write_bytes(js(lock))
    print(json.dumps({'id':identity,'runtime':runtime,'assets':len(assets)+2,'modifiedFiles':len(changes),'patchReplayVerified':True},ensure_ascii=False))
if __name__=='__main__':main()
