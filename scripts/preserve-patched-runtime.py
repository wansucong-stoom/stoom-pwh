#!/usr/bin/env python3
"""Preserve a reviewed patched core and inline client without changing installation or lock.

Consumes a verified immutable base runtime. New output paths must not exist.
The historical full Studio component is retained unless a separately verified
full Studio replacement is supplied. The active Pwh inline client and core are
verified against their current source and build evidence.
"""
import argparse, hashlib, json, re, zipfile
from pathlib import Path, PurePosixPath

COMPONENTS = {'rhwp', 'core', 'editor-sdk', 'studio', 'studio-inline'}
CORE_FILES = ('rhwp.js', 'rhwp.d.ts', 'rhwp_bg.wasm', 'rhwp_bg.wasm.d.ts')
CLIENT_FILES = ('editor.js', 'rhwp-studio.css', 'editor-body.html')
MAX_TOTAL = 512 * 1024 * 1024

def sha(data): return hashlib.sha256(data).hexdigest()
def js(value): return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
def regular(file):
    if file.is_symlink() or not file.is_file(): raise ValueError('Not a regular input: ' + file.name)
    return file.read_bytes()
def safe_name(name):
    p = PurePosixPath(name)
    if not name or name.startswith('/') or '\\' in name or ':' in name or '\0' in name or '..' in p.parts or str(p) != name:
        raise ValueError('Unsafe archive path')
    for part in name.split('/'):
        if not part or part in ('.','..') or re.search(r'[<>:\"|?*\x00-\x1f]',part) or part.endswith((' ','.')) or re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)',part,re.I):
            raise ValueError('Unsafe Windows archive path')
    return name

def tree(root, prefix='', exclude=frozenset()):
    result = {}
    for f in sorted(root.rglob('*')):
        rel = f.relative_to(root)
        if any(part in exclude for part in rel.parts): continue
        if f.is_symlink(): raise ValueError('Symlink build input')
        if f.is_file(): result[safe_name(prefix + rel.as_posix())] = regular(f)
    return result

def zip_new(file, entries):
    with zipfile.ZipFile(file, 'x', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(entries.items()):
            safe_name(name)
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    return {'file': file.name, 'size': file.stat().st_size, 'sha256': sha(regular(file))}

def read_runtime(archive, lock):
    raw = regular(archive)
    if sha(raw) != lock['runtime']['sha256'] or len(raw) != lock['runtime']['size']:
        raise ValueError('Base runtime checksum mismatch')
    files = {}; folded = set(); total = 0
    with zipfile.ZipFile(archive) as z:
        for entry in z.infolist():
            name = safe_name(entry.filename)
            if name.lower() in folded or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Duplicate runtime member or symlink')
            if name != 'runtime-manifest.json' and name.split('/')[0] not in COMPONENTS:
                raise ValueError('Unexpected runtime component')
            folded.add(name); total += entry.file_size
            if total > MAX_TOTAL or len(folded) > 10000: raise ValueError('Runtime expansion limit')
            files[name] = z.read(entry)
    manifest_raw = files.pop('runtime-manifest.json'); manifest = json.loads(manifest_raw)
    if manifest['schemaVersion'] != 1 or manifest['id'] != lock['id'] or manifest['upstreamCommit'] != lock['upstreamCommit']:
        raise ValueError('Base runtime identity mismatch')
    records = manifest['files']
    if len(records) != len(files) or len({r['path'] for r in records}) != len(records):
        raise ValueError('Base runtime manifest membership mismatch')
    for record in records:
        data = files.get(record['path'])
        if data is None or len(data) != record['size'] or sha(data) != record['sha256']:
            raise ValueError('Base member checksum mismatch')
    for component in COMPONENTS:
        marker = json.loads(files[component + '/.pwh-install.json'])
        for name, digest in marker['files'].items():
            if sha(files[component + '/' + safe_name(name)]) != digest:
                raise ValueError('Base component marker mismatch')
    return files, manifest, sha(manifest_raw)

def verify_core(root, project, lock):
    raw = regular(root / 'BUILD-RECORD.json'); record = json.loads(raw)
    source = next(a for a in lock['preservationAssets'] if a['file'].startswith('pwh-upstream-rhwp-'))
    if (record['schemaVersion'] != 1 or record['upstreamCommit'] != lock['upstreamCommit']
        or record['sourceArchiveSha256'] != source['sha256'] or record['target'] != 'wasm32-unknown-unknown'
        or record['features'] != 'upstream defaults' or '--release' not in record['buildArgs']
        or record['lockAudit']['addedPackages'] != 0 or record['lockAudit']['changedRetainedPackages'] != 0):
        raise ValueError('Unverified core build identity or dependency drift')
    patch_root = project / 'docs/engine-patches'
    expected = sorted(f.name for f in patch_root.glob('*.patch'))
    if sorted(p['file'] for p in record['patches']) != expected:
        raise ValueError('Core patch list differs from current source')
    patches = {}
    for patch in record['patches']:
        data = regular(patch_root / patch['file'])
        if sha(data) != patch['sha256'] or not patch['sources']: raise ValueError('Core patch digest mismatch')
        for source in patch['sources']:
            safe_name(source['path'])
            if any(not re.fullmatch('[a-f0-9]{64}', source[k]) for k in ('originalSha256', 'patchedSha256')):
                raise ValueError('Invalid source digest')
        patches[patch['file']] = data
    if sorted(record['files']) != sorted(CORE_FILES): raise ValueError('Unexpected core output files')
    files = {}
    for name in CORE_FILES:
        data = regular(root / name); item = record['files'][name]
        if len(data) != item['size'] or sha(data) != item['sha256']: raise ValueError('Core output digest mismatch')
        files[name] = data
    if sha(files['rhwp.js']) != record['unchangedGlueSha256']: raise ValueError('Core glue differs from verified ABI')
    return record, raw, files, patches

def verify_regression(file, record, record_raw):
    raw = regular(file)
    if len(raw) > 1024*1024: raise ValueError('Regression evidence exceeds limit')
    evidence = json.loads(raw); checks = evidence.get('checks')
    if (evidence.get('schemaVersion') != 1 or evidence.get('wasmSha256') != record['files']['rhwp_bg.wasm']['sha256']
        or evidence.get('buildRecordSha256') != sha(record_raw) or not isinstance(checks,list) or not checks
        or any(not isinstance(check,dict) or check.get('status') != 'passed' or not isinstance(check.get('name'),str) for check in checks)):
        raise ValueError('Regression evidence does not identify this passing core build')
    return evidence, raw

def component_marker(files, component, identity, extra=None):
    name = component + '/.pwh-install.json'
    marker = json.loads(files[name]); marker.pop('bridgeSha256', None)
    marker['pwhRevision'] = identity
    marker['files'] = {p[len(component)+1:]: sha(data) for p, data in sorted(files.items()) if p.startswith(component+'/') and p != name}
    if extra: marker.update(extra)
    files[name] = js(marker)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('base-lock', 'base-archive', 'candidate-core', 'client-root', 'client-build-root', 'regression-evidence', 'output-dir'):
        parser.add_argument('--'+name, type=Path, required=True)
    parser.add_argument('--revision', type=int, required=True)
    parser.add_argument('--release-tag', help='Product release tag containing the runtime assets, such as v0.6.34')
    parser.add_argument('--verify-only', action='store_true', help='Verify all inputs without creating output')
    parser.add_argument('--studio-replacement', type=Path, help='Verified complete Studio runtime tree; requires --studio-verification')
    parser.add_argument('--studio-verification', type=Path, help='JSON evidence for complete Studio replacement; includes treeSha256 and smokePassed=true')
    args = parser.parse_args(); project = Path(__file__).resolve().parents[1]
    if args.revision < 1: raise ValueError('Invalid revision')
    if args.release_tag and not re.fullmatch(r'v\d+\.\d+\.\d+', args.release_tag): raise ValueError('Invalid product release tag')
    if args.output_dir.exists(): raise ValueError('Output directory already exists; choose a new path')
    lock = json.loads(regular(args.base_lock))
    if lock['schemaVersion'] != 1 or lock['platform'] != 'win32-x64' or not re.fullmatch(r'rhwp-0\.8\.7-pwh-r\d+', lock['id']): raise ValueError('Invalid base lock')
    identity = f'rhwp-0.8.7-pwh-r{args.revision}'
    if args.revision <= int(lock['id'].rsplit('r',1)[1]): raise ValueError('Revision must exceed the base runtime')
    files, manifest, manifest_sha = read_runtime(args.base_archive, lock)
    record, record_raw, core, patches = verify_core(args.candidate_core, project, lock)
    regression, regression_raw = verify_regression(args.regression_evidence, record, record_raw)
    client_marker_raw = regular(args.client_root / '.pwh-install.json'); client_marker = json.loads(client_marker_raw)
    if client_marker['kind'] != 'studio-inline' or client_marker['upstreamCommit'] != lock['upstreamCommit'] or sorted(client_marker['files']) != sorted(CLIENT_FILES):
        raise ValueError('Unsupported current inline client marker')
    client = {}
    for name in CLIENT_FILES:
        data = regular(args.client_root/name)
        if sha(data) != client_marker['files'][name]: raise ValueError('Current inline client digest mismatch')
        client[name] = data
    # The inline build changes only the module's default WASM resolver. Normalize
    # that single edit to prove it embeds the exact verified core glue ABI.
    glue = regular(args.client_build_root/'pkg/rhwp.js').decode('utf-8')
    host_resolver = "(()=>{throw new Error('Host WASM bytes required')})()"
    if glue.count(host_resolver) != 1: raise ValueError('Unknown inline WASM resolver')
    normalized = glue.replace(host_resolver, "new URL('rhwp_bg.wasm', import.meta.url)").encode('utf-8')
    if sha(normalized) != record['unchangedGlueSha256']: raise ValueError('Inline build glue ABI differs from core')
    for name, data in core.items(): files['core/'+name] = data
    files['core/BUILD-RECORD.json'] = record_raw
    files['core/REGRESSION-VERIFICATION.json'] = regression_raw
    files['core/licenses/pwh-preservation/PWH-WASM-BUILD-RECORD.json'] = record_raw
    for name, data in patches.items(): files['core/licenses/pwh-preservation/'+name] = data
    files['core/licenses/pwh-preservation/CORE-PATCHES-README.md'] = regular(project/'docs/engine-patches/README.md')
    for name, data in client.items(): files['studio-inline/'+name] = data
    files['studio-inline/.pwh-install.json'] = client_marker_raw
    studio_evidence = None
    if bool(args.studio_replacement) != bool(args.studio_verification): raise ValueError('Studio replacement and verification must be supplied together')
    if args.studio_replacement:
        replacement = tree(args.studio_replacement)
        studio_evidence = json.loads(regular(args.studio_verification))
        root_digest = sha(js({name:sha(data) for name,data in sorted(replacement.items())}))
        if studio_evidence.get('smokePassed') is not True or studio_evidence.get('treeSha256') != root_digest:
            raise ValueError('Studio replacement smoke evidence mismatch')
        if not {'index.html','.pwh-install.json'} <= replacement.keys(): raise ValueError('Incomplete Studio replacement')
        files = {name:data for name,data in files.items() if not name.startswith('studio/')}
        files.update({'studio/'+name:data for name,data in replacement.items()})
    component_marker(files, 'core', identity, {'wasmCoreChanges': True})
    component_marker(files, 'studio-inline', identity)
    if studio_evidence: component_marker(files, 'studio', identity)
    # Explicit, source-only inputs. Binary fonts, samples, local configs, recovery
    # files, installed dependencies and Git history are never collected.
    build_inputs = tree(args.client_build_root/'rhwp-studio/src', 'rhwp-studio/src/')
    for name in ('package.json','index.html'):
        build_inputs['rhwp-studio/'+name] = regular(args.client_build_root/'rhwp-studio'/name)
    for name in ('icon_small_ko.svg','icon_small_ko_dark.svg'):
        build_inputs['rhwp-studio/public/images/'+name] = regular(args.client_build_root/'rhwp-studio/public/images'/name)
    for name in ('rhwp.js','rhwp.d.ts','rhwp_bg.wasm.d.ts','package.json','LICENSE'):
        build_inputs['pkg/'+name] = regular(args.client_build_root/'pkg'/name)
    for directory in ('scripts','src','tests/engine-source-ownership','docs/engine-patches'):
        build_inputs.update(tree(project/directory, 'pwh/'+directory+'/', frozenset({'__pycache__'})))
    build_inputs['pwh/package.json'] = regular(project/'package.json')
    build_inputs['LICENSE-PWH.txt'] = regular(project/'LICENSE')
    build_inputs['LICENSE-RHWP.txt'] = files['core/LICENSE']
    build_inputs['PWH-INLINE-BUILD-INSTRUCTIONS.txt'] = b'Overlay rhwp-studio/ and pkg/ on the pinned upstream source snapshot. Restore the preserved r2 Windows-x64 client dependency archive alongside rhwp-studio. Run node pwh/scripts/build-inline.mjs <source-root> and node pwh/scripts/bundle-client.mjs <source-root>. The inline build consumes host-supplied WASM; its glue normalization must match the separately rebuilt core. No binary fonts or source documents are included.\n'
    home = str(Path.home()).encode('utf-8')
    for name, data in files.items():
        if Path(name).suffix in ('.json','.md','.txt','.html','.js') and home in data: raise ValueError('Machine home path in runtime text')
    if args.verify_only:
        print(json.dumps({'verified':True,'id':identity,'coreWasmSha256':record['files']['rhwp_bg.wasm']['sha256'],'inlineClientVersion':client_marker['version'],'inlineClientFiles':client_marker['files'],'inlineGlueAbiVerified':True,'outputCreated':False},ensure_ascii=False))
        return
    args.output_dir.mkdir(parents=True)
    core_inputs = tree(project/'docs/engine-patches', 'docs/engine-patches/')
    core_inputs['scripts/build-patched-core.mjs'] = regular(project/'scripts/build-patched-core.mjs')
    core_inputs['scripts/preserve-patched-runtime.py'] = regular(project/'scripts/preserve-patched-runtime.py')
    for name in ('scripts/setup.mjs','scripts/preserved-runtime.mjs','src/nested-table-paste.mjs','src/request-state.mjs','package.json'):
        core_inputs[name] = regular(project/name)
    core_inputs.update(tree(project/'tests/engine-source-ownership', 'tests/engine-source-ownership/', frozenset({'__pycache__'})))
    core_inputs['BUILD-RECORD.json'] = record_raw
    core_inputs['REGRESSION-VERIFICATION.json'] = regression_raw
    core_inputs['LICENSE-PWH.txt'] = regular(project/'LICENSE')
    core_inputs['LICENSE-RHWP.txt'] = files['core/LICENSE']
    patch_asset = zip_new(args.output_dir/f'pwh-core-patches-{identity}.zip', core_inputs)
    client_asset = zip_new(args.output_dir/f'pwh-inline-build-inputs-{identity}.zip', build_inputs)
    provenance = {
      'upstreamVersion': '0.8.7', 'upstreamCommit': lock['upstreamCommit'],
      'baseRuntime': {'id':lock['id'], **lock['runtime'], 'manifestSha256':manifest_sha},
      'baseProvenance': manifest['provenance'], 'nativeCliChanges': False, 'wasmCoreChanges': True,
      'runtimeCoreJsGlueChanged': False, 'coreBuildRecord': {'path':'core/BUILD-RECORD.json','sha256':sha(record_raw)},
      'regressionVerification':{'path':'core/REGRESSION-VERIFICATION.json','size':len(regression_raw),'sha256':sha(regression_raw)},
      'wasmCorePatches':record['patches'], 'inlineClientVersion':client_marker['version'],
      'inlineClientGlueMatchesCore':True,'inlineBuildInputs':client_asset,'corePatchInputs':patch_asset,
      'legacyStudio': {'changed': bool(studio_evidence), 'verification':studio_evidence,
        'scope':'Separately verified complete replacement' if studio_evidence else 'Historical full Studio bytes retained. Active Pwh and Desktop inline client use the rebuilt core; full Studio is not claimed to share that core.'},
      'rebuildScope':'Pinned-source WASM core and current Pwh inline client. CLI and editor SDK preserved from the verified base runtime. Source documents and private runtime state are excluded.'}
    new_manifest = {'schemaVersion':1,'id':identity,'upstreamCommit':lock['upstreamCommit'],'provenance':provenance,
      'files':[{'path':name,'size':len(data),'sha256':sha(data)} for name,data in sorted(files.items())]}
    files['runtime-manifest.json'] = js(new_manifest)
    runtime = zip_new(args.output_dir/f'pwh-runtime-{identity}-windows-x64.zip', files)
    tag = args.release_tag or 'engine-'+identity
    base_url = f'https://github.com/wansucong-stoom/stoom-pwh/releases/download/{tag}/'
    runtime['url'] = base_url+runtime['file']
    verification = {'schemaVersion':1,'id':identity,'baseRuntimeArchiveVerified':True,'baseManifestFilesVerified':True,
      'coreBuildRecordVerified':True,'corePatchInputsVerified':True,'inlineClientFilesVerified':True,
      'inlineGlueAbiVerified':True,'runtimeFileCount':len(new_manifest['files']),'runtimeSha256':runtime['sha256'],
      'coreFiles':record['files'],'inlineClient':client_marker,'regression':regression,'legacyStudio':provenance['legacyStudio']}
    (args.output_dir/'VERIFICATION.json').write_bytes(js(verification))
    verification_asset = {'file':'VERIFICATION.json','size':(args.output_dir/'VERIFICATION.json').stat().st_size,'sha256':sha(js(verification))}
    new_assets = (patch_asset,client_asset,verification_asset)
    new_names = {a['file'] for a in new_assets}
    assets = [*[a for a in lock['preservationAssets'] if a['file'] not in new_names], *[{**a,'url':base_url+a['file']} for a in new_assets]]
    output_lock = {**lock,'id':identity,'releaseTag':tag,'runtime':runtime,'preservationAssets':assets}
    (args.output_dir/'runtime-lock.json').write_bytes(js(output_lock))
    # Independently re-read all ZIP entries and component markers before success.
    read_runtime(args.output_dir/runtime['file'], output_lock)
    print(json.dumps({'id':identity,'runtime':runtime,'files':len(new_manifest['files']),'inlineClientVersion':client_marker['version'],'installed':False,'lockChanged':False},ensure_ascii=False))

if __name__ == '__main__': main()
