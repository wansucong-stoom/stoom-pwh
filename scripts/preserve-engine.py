#!/usr/bin/env python3
"""Maintenance only: preserve a reviewed Windows runtime and its build evidence.

No documents, user fonts, credentials, runtime configuration or Git history are
collected. Installation uses Node and the prebuilt ZIP, not this Python script.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, tempfile, zipfile, tarfile
from pathlib import Path

PIN = '1a76570e833917d15817415a53c09ad61ab3203f'
COMPONENTS = ('rhwp', 'core', 'editor-sdk', 'studio', 'studio-inline')
ROOTS = ('src', 'crates', 'bindings', 'npm', 'rhwp-studio', 'rhwp-shared',
         'scripts', 'vendor', 'typescript', 'template', 'assets')
ROOT_FILES = ('Cargo.toml', 'Cargo.lock', 'build.rs', 'LICENSE', 'THIRD_PARTY_LICENSES.md',
              'rust-toolchain.toml', 'rustfmt.toml', 'README.md', 'README_EN.md')
CORE_WORKSPACE_ROOTS = ('tools/rhwp-subsecond', 'tools/batch-convert',
    'tools/llm_verifier/verdict_protocol', 'tools/llm_verifier/claim_bind',
    'tools/llm_verifier/criteria_decomp')

def sha(data): return hashlib.sha256(data).hexdigest()
def js(value): return (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode()
def git(root, *args):
    env = {**os.environ, 'GIT_NO_LAZY_FETCH': '1', 'GIT_TERMINAL_PROMPT': '0'}
    return subprocess.check_output(['git', '-c', 'core.autocrlf=false', '-C', str(root), *args], env=env)
def regular(file):
    if file.is_symlink() or not file.is_file(): raise ValueError(f'Not a regular input: {file.name}')
    return file.read_bytes()

def checked_path(root, name):
    """Resolve an artifact member without following links or Windows aliases."""
    if not isinstance(name,str) or not name or '\\' in name or name.startswith('/'):
        raise ValueError('Unsafe core build path')
    parts=name.split('/')
    if any(part in ('','.','..') or ':' in part or part.endswith((' ','.')) for part in parts):
        raise ValueError('Unsafe core build path: '+name)
    if any(part.split('.')[0].upper() in ('CON','PRN','AUX','NUL',*[f'COM{i}' for i in range(1,10)],*[f'LPT{i}' for i in range(1,10)]) for part in parts):
        raise ValueError('Unsafe core build path: '+name)
    target=root.joinpath(*parts)
    for parent in (target,*target.parents):
        if parent==root.parent:break
        if parent.is_symlink():raise ValueError('Symlink core build input: '+name)
    if not target.resolve().is_relative_to(root.resolve()):raise ValueError('Core build path escapes its directory')
    return target

def pinned_extra_input(upstream_root, name, blob, core_build_dir):
    """Read a sparse-checkout omission without fetching or trusting an overlay.

    A partial clone may have the pinned tree/index metadata but not this blob.
    In that case the candidate's preserved source is acceptable only if its Git
    object identity matches that independent pinned metadata byte for byte.
    """
    try:
        data=git(upstream_root,'cat-file','blob',blob)
    except subprocess.CalledProcessError:
        data=regular(checked_path(core_build_dir,'source-inputs/'+name))
    if hashlib.sha1(f'blob {len(data)}\0'.encode()+data).hexdigest()!=blob:
        raise ValueError('Additional workspace input differs from pinned Git blob: '+name)
    return data

def verify_core_build(core_root, pristine, original_core, runtime_root, build_root, scratch_root):
    """Accept an explicit WASM build only with hashed artifacts and replayable source.

    This verifies recorded build evidence and exact output identity. It does not
    rerun Rust, vendor the compiler, or claim that the unchanged native CLI was
    rebuilt. Dependencies may not change without a separately reviewed bundle.
    """
    manifest_bytes=regular(checked_path(core_root,'core-build-provenance.json'))
    if len(manifest_bytes)>1024*1024:raise ValueError('Core build provenance is too large')
    meta=json.loads(manifest_bytes)
    if not isinstance(meta,dict) or meta.get('schemaVersion')!=1 or meta.get('upstreamCommit')!=PIN or meta.get('target')!='wasm32-unknown-unknown':
        raise ValueError('Unexpected core build identity or target')
    compiler=meta.get('compiler',{})
    if any(not isinstance(compiler.get(key),str) or not compiler[key].strip() for key in ('rustc','cargo','wasmBindgen','host')):
        raise ValueError('Core build compiler versions are required')
    commands=meta.get('commands')
    if not isinstance(commands,list) or not commands or any(not isinstance(command,str) or not command.strip() for command in commands):
        raise ValueError('Core build commands are required')
    entries={};seen=set()
    if not isinstance(meta.get('files'),list):raise ValueError('Core build file records are required')
    for record in meta['files']:
        if not isinstance(record,dict):raise ValueError('Invalid core build file record')
        name=record.get('path');file=checked_path(core_root,name)
        if name.casefold() in seen:raise ValueError('Duplicate core build file: '+name)
        seen.add(name.casefold())
        if name not in ('core-source.patch','SHA256SUMS','Cargo.lock','LICENSE','THIRD_PARTY_LICENSES.md') and not name.startswith(('pkg/','source-inputs/','logs/')):
            raise ValueError('Unexpected core build evidence file: '+name)
        data=regular(file)
        if type(record.get('bytes')) is not int or record['bytes']!=len(data) or record.get('sha256')!=sha(data):
            raise ValueError('Core build file digest or size mismatch: '+name)
        if str(Path.home()).encode() in data:raise ValueError('Machine home path in core build evidence: '+name)
        if name in ('Cargo.lock','LICENSE','THIRD_PARTY_LICENSES.md') and pristine.get(name)!=data:
            raise ValueError('Core build dependency/license input differs from the pinned upstream: '+name)
        entries[name]=data
    required_pkg=('rhwp.js','rhwp_bg.wasm','rhwp.d.ts','rhwp_bg.wasm.d.ts')
    if {name[4:] for name in entries if name.startswith('pkg/')}!=set(required_pkg):
        raise ValueError('Core build must record exactly the four generated pkg artifacts')
    wasm=entries['pkg/rhwp_bg.wasm']
    if not wasm.startswith(b'\0asm\x01\0\0\0') or wasm==original_core['rhwp_bg.wasm']:
        raise ValueError('Core build must contain a changed WebAssembly module')
    if not entries['pkg/rhwp.js'] or b'WebAssembly' not in entries['pkg/rhwp.js']:
        raise ValueError('Core build JavaScript glue is missing')
    for name in required_pkg:
        if regular(runtime_root/'core'/name)!=entries['pkg/'+name]:
            raise ValueError('Installed core differs from the explicit build artifact: '+name)
    if regular(build_root/'pkg/rhwp_bg.wasm')!=wasm:
        raise ValueError('Studio WASM differs from the explicit core build artifact')
    patch_meta=meta.get('patch',{})
    if patch_meta.get('path')!='core-source.patch' or patch_meta.get('sha256')!=sha(entries.get('core-source.patch',b'')) or not entries.get('core-source.patch'):
        raise ValueError('Core source patch digest is missing or inconsistent')
    verification=meta.get('verification',{});native=verification.get('nativeTests',{});wasm_build=verification.get('wasmBuild',{})
    if type(native.get('passed')) is not int or native['passed']<1 or native.get('failed')!=0 or wasm_build.get('succeeded') is not True:
        raise ValueError('A successful core build and nonempty native test run are required')
    for evidence in (native,wasm_build):
        log=evidence.get('log')
        if not isinstance(log,str) or not log.startswith('logs/') or log not in entries:
            raise ValueError('Hashed core build/test logs are required')
    result=re.findall(rb'test result: ok\. (\d+) passed; 0 failed;',entries[native['log']])
    if not result or sum(int(count) for count in result)!=native['passed']:
        raise ValueError('Core test log does not support the declared passing test count')
    sources=meta.get('changedSources');source_names=set();changes=[]
    if not isinstance(sources,list) or not sources:raise ValueError('Changed core source records are required')
    for record in sources:
        if not isinstance(record,dict):raise ValueError('Invalid changed core source record')
        name=record.get('path');checked_path(core_root,name)
        if name in source_names:raise ValueError('Duplicate changed core source')
        source_names.add(name)
        if not name.startswith(('src/','crates/','bindings/','vendor/')) or not name.endswith('.rs'):
            raise ValueError('Core source changes require Rust files and unchanged dependency manifests: '+name)
        after=entries.get('source-inputs/'+name);before=pristine.get(name)
        if after is None or record.get('beforeSha256')!=(sha(before) if before is not None else None) or record.get('afterSha256')!=sha(after) or type(record.get('bytes')) is not int or record.get('bytes')!=len(after):
            raise ValueError('Core source record does not match pristine/candidate bytes: '+name)
        if before==after:raise ValueError('Unchanged file declared as a core source change: '+name)
        changes.append({'path':name,'beforeSha256':record['beforeSha256'],'afterSha256':sha(after),'change':'modified' if before is not None else 'added'})
    for name,data in entries.items():
        if name.startswith('source-inputs/'):
            relative=name[len('source-inputs/'):]
            if relative not in source_names and (relative not in pristine or pristine[relative]!=data):
                raise ValueError('Unrecorded changed core source input: '+relative)
    with tempfile.TemporaryDirectory(prefix='pwh-core-replay-',dir=scratch_root) as temp:
        temp=Path(temp)
        if temp.resolve().parent!=scratch_root.resolve():raise ValueError('Unsafe core patch replay workspace')
        for name,data in pristine.items():
            file=checked_path(temp,name);file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(data)
        git(temp,'init','--quiet');git(temp,'config','user.name','pwh preservation');git(temp,'config','user.email','preservation@localhost')
        git(temp,'add','-f','.');git(temp,'commit','--quiet','-m','Exact upstream core inputs')
        patch_file=temp/'pwh-core-candidate.patch';patch_file.write_bytes(entries['core-source.patch'])
        git(temp,'apply','--check','--index',str(patch_file));git(temp,'apply','--index',str(patch_file))
        changed=set(filter(None,git(temp,'diff','--cached','--name-only','-z','HEAD').decode().split('\0')))
        if changed!=source_names:raise ValueError('Core source patch paths differ from the changed source records')
        for name in source_names:
            if regular(checked_path(temp,name))!=entries['source-inputs/'+name]:
                raise ValueError('Core source patch replay mismatch: '+name)
    entries['core-build-provenance.json']=manifest_bytes
    return {'inputs':entries,'changes':changes,'evidence':meta,'patchReplayVerified':True,
        'originalCore':{name:sha(data) for name,data in original_core.items()}}
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
    p.add_argument('--core-build-dir',type=Path,help='Explicit WASM build artifacts, source patch and hashed build/test provenance')
    p.add_argument('--revision',type=int,default=1);p.add_argument('--write-lock',action='store_true')
    a=p.parse_args();project=Path(__file__).resolve().parents[1]
    if git(a.upstream_root,'rev-parse','HEAD').decode().strip()!=PIN: raise ValueError('Unexpected upstream commit')
    if git(a.upstream_root,'status','--porcelain','--untracked-files=no'): raise ValueError('Upstream checkout is modified')
    a.output_dir.mkdir(parents=True,exist_ok=True)
    identity=f'rhwp-0.8.7-pwh-r{a.revision}'; tag=f'engine-{identity}'
    base=f'https://github.com/wansucong-stoom/stoom-pwh/releases/download/{tag}/'
    pwh_commit=git(project,'rev-parse','HEAD').decode().strip()
    # Only tracked, reviewed build inputs from the exact upstream tree.
    source_roots=(*ROOTS,*CORE_WORKSPACE_ROOTS) if a.core_build_dir else ROOTS
    tracked=git(a.upstream_root,'ls-files','-s','-z','--',*source_roots,*ROOT_FILES).decode().split('\0')
    pristine={};blob_records={}
    for item in filter(None,tracked):
        meta,name=item.split('\t',1);mode,blob,_=meta.split()
        # Reference documents and binary fonts are not needed for pwh's Studio
        # build; their separate redistribution terms are not inferred from MIT.
        if name=='rhwp-studio/public/fonts' or name.startswith(('assets/screenshots/','rhwp-studio/public/samples/')):continue
        if name.startswith('assets/fonts/') and Path(name).suffix.lower() not in ('.md','.txt'):continue
        extra_root=next((root for root in CORE_WORKSPACE_ROOTS if name.startswith(root+'/')),None)
        if extra_root is not None and not (name==extra_root+'/Cargo.toml' or name==extra_root+'/build.rs' or name.startswith(extra_root+'/src/')):continue
        if mode!='100644' and mode!='100755': raise ValueError('Unsupported tracked input mode')
        # Sparse pristine checkouts may omit these workspace members. Read the
        # pinned Git blob without changing or populating the pristine checkout.
        data=pinned_extra_input(a.upstream_root,name,blob,a.core_build_dir) if extra_root is not None else regular(a.upstream_root/name)
        if hashlib.sha1(f'blob {len(data)}\0'.encode()+data).hexdigest()!=blob: raise ValueError('Upstream input differs from Git blob: '+name)
        pristine[name]=data;blob_records[name]=blob
    pristine['PWH-SOURCE-PROVENANCE.json']=js({'commit':PIN,'includedRoots':source_roots,'excluded':'reference documents, samples, binary fonts, screenshots, large tools/fixtures and Git history; extra Cargo workspace members include only manifests, build scripts and src; this is a build-input snapshot, not the whole Git repository','gitBlobs':blob_records})
    original_core={}
    with tarfile.open(a.runtime_root/'downloads/core-0.8.7.tgz','r:gz') as t:
        for name in ('rhwp.js','rhwp_bg.wasm','rhwp.d.ts','rhwp_bg.wasm.d.ts'):
            member=t.extractfile('package/'+name)
            if member is None:raise ValueError('Original core package member is absent: '+name)
            original_core[name]=member.read()
    core_build=None
    if a.core_build_dir:
        core_build=verify_core_build(a.core_build_dir,pristine,original_core,a.runtime_root,a.build_root,a.output_dir)
    else:
        for name,data in original_core.items():
            if data!=regular(a.runtime_root/'core'/name):raise ValueError('Installed core differs from upstream package; an explicit --core-build-dir is required')
    upstream=zip_new(a.output_dir/f'pwh-upstream-rhwp-0.8.7-{PIN[:12]}.zip',pristine)
    core_assets=[]
    if core_build:
        core_asset=zip_new(a.output_dir/f'pwh-core-build-{identity}.zip',core_build['inputs'])
        core_inputs={name:data for name,data in pristine.items() if name!='PWH-SOURCE-PROVENANCE.json'}
        for name,data in core_build['inputs'].items():
            if name.startswith('source-inputs/'):core_inputs[name[len('source-inputs/'):]]=data
        core_inputs['PWH-CORE-SOURCE-PROVENANCE.json']=js({'upstreamCommit':PIN,
            'baselineSourceArchive':upstream,'coreBuildEvidence':core_asset,
            'changes':core_build['changes'],'patchReplayVerified':True,
            'files':{name:sha(data) for name,data in sorted(core_inputs.items())},
            'offlineWasmRebuildKitComplete':False,'buildUsedFullUpstreamCheckout':True,
            'excludedProductionInputs':['saved/blank2010.hwp'],
            'scope':'Sanitized patched library sources and Cargo workspace member manifests/build scripts/src. The recorded Rust build used the full upstream checkout; this snapshot is not a complete offline Rust build kit. Compile-time assets such as saved/blank2010.hwp, native test fixtures, sample documents, binary fonts, Rust toolchains and Skia externals are not included. Offline WASM/native CLI rebuild is not claimed.'})
        core_inputs_asset=zip_new(a.output_dir/f'pwh-core-inputs-{identity}.zip',core_inputs)
        core_assets.extend((core_asset,core_inputs_asset))
    # Rebuild inputs are complete for the Studio client. Optional WASM build
    # evidence is separate; the native CLI is always retained unchanged.
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
        for name in patched:
            if name.startswith('pkg/'):
                core_name=name[4:]
                if core_name in original_core:base_inputs[name]=original_core[core_name]
                elif (a.runtime_root/'core'/core_name).is_file():base_inputs[name]=regular(a.runtime_root/'core'/core_name)
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
        'changes':changes,'nativeCoreChanges':core_build is not None,'nativeCliChanges':False,
        'coreJsGluePatched':any(change['path']=='pkg/rhwp.js' for change in changes),
        'patch':{'file':patch_file.name,'sha256':sha(patch),'replayVerified':True},
        'buildDependencies':deps_asset,'patchedStudioInputs':patched_asset,'upstreamSource':upstream,
        'pwhBuildScripts':own_asset,'originalArchives':original_archives,
        'mplSource':lightning_meta,
        'rebuildScope':'Windows x64 Studio client; native CLI/WASM binaries retained unchanged. Cargo archives retained; Rust toolchain, Skia externals and a full native rebuild are not validated.'}
    if core_build:
        provenance['coreBuild']={'artifacts':core_asset,'patchedSourceInputs':core_inputs_asset,
            'changes':core_build['changes'],'originalCore':core_build['originalCore'],
            'patch':{**core_build['evidence']['patch'],'replayVerified':True},
            'compiler':core_build['evidence']['compiler'],'commands':core_build['evidence']['commands'],
            'verification':core_build['evidence']['verification'],'target':'wasm32-unknown-unknown',
            'offlineWasmRebuildKitComplete':False,'buildUsedFullUpstreamCheckout':True,
            'excludedProductionInputs':['saved/blank2010.hwp']}
        provenance['rebuildScope']='Windows x64 Studio client and a source-patched WASM core with recorded compiler versions, hashed build/test evidence and verified patch replay. Native CLI retained unchanged. The recorded Rust build used the full upstream checkout. Retained sanitized library/workspace inputs and crate archives are not a complete offline Rust build kit: compile-time assets such as saved/blank2010.hwp, Rust toolchains, native test fixtures and Skia externals are excluded. Offline WASM/native CLI rebuild is not claimed.'
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
    assets=[upstream,patched_asset,deps_asset,own_asset,*core_assets,*original_archives.values(),*license_assets,
        {'file':patch_file.name,'sha256':sha(patch),'size':len(patch)},
        {'file':provenance_file.name,'sha256':sha(provenance_file.read_bytes()),'size':provenance_file.stat().st_size}]
    lock={'schemaVersion':1,'id':identity,'platform':'win32-x64','upstreamVersion':'0.8.7','upstreamCommit':PIN,
        'releaseTag':tag,'runtime':runtime,'preservationAssets':[{**asset,'url':base+asset['file']} for asset in assets]}
    (a.output_dir/'runtime-lock.json').write_bytes(js(lock))
    if a.write_lock:(project/'runtime-lock.json').write_bytes(js(lock))
    print(json.dumps({'id':identity,'runtime':runtime,'assets':len(assets)+2,'modifiedFiles':len(changes),'patchReplayVerified':True},ensure_ascii=False))
if __name__=='__main__':main()
