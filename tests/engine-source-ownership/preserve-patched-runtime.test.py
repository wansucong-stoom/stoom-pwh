"""Input-integrity tests for immutable patched-runtime preservation."""
import importlib.util, json, tempfile, unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('preserve_patched_runtime', Path(__file__).parents[2]/'scripts/preserve-patched-runtime.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class PreservationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
    def tearDown(self): self.temp.cleanup()
    def base(self):
        files = {}
        for component in m.COMPONENTS:
            files[component+'/payload.txt'] = b'verified component'
            files[component+'/.pwh-install.json'] = m.js({'kind':component,'files':{'payload.txt':m.sha(b'verified component')}})
        manifest = {'schemaVersion':1,'id':'rhwp-0.8.7-pwh-r3','upstreamCommit':'pinned','files':[{'path':name,'size':len(data),'sha256':m.sha(data)} for name,data in files.items()]}
        files['runtime-manifest.json'] = m.js(manifest)
        return files, manifest
    def archive(self, files, name='runtime.zip'):
        output = self.root/name; record = m.zip_new(output, files)
        lock = {'schemaVersion':1,'id':'rhwp-0.8.7-pwh-r3','upstreamCommit':'pinned','runtime':record}
        return output, lock
    def core(self):
        core = self.root/'core'; core.mkdir(); project=self.root/'project'; patches=project/'docs/engine-patches'; patches.mkdir(parents=True)
        (patches/'source.patch').write_bytes(b'reviewed source patch')
        records={}
        for name in m.CORE_FILES:
            data=b'verified '+name.encode(); (core/name).write_bytes(data); records[name]={'size':len(data),'sha256':m.sha(data)}
        record={'schemaVersion':1,'upstreamCommit':'pinned','sourceArchiveSha256':'source-sha','target':'wasm32-unknown-unknown','features':'upstream defaults','buildArgs':['build','--release'],'lockAudit':{'addedPackages':0,'changedRetainedPackages':0},'files':records,'unchangedGlueSha256':records['rhwp.js']['sha256'],'patches':[{'file':'source.patch','sha256':m.sha(b'reviewed source patch'),'sources':[{'path':'src/layout.rs','originalSha256':'a'*64,'patchedSha256':'b'*64}]}]}
        (core/'BUILD-RECORD.json').write_bytes(m.js(record)); lock={'upstreamCommit':'pinned','preservationAssets':[{'file':'pwh-upstream-rhwp-pinned.zip','sha256':'source-sha'}]}
        return core, project, record, lock
    def test_complete_base_archive_is_reverified(self):
        files,_=self.base(); archive,lock=self.archive(files); loaded,manifest,_=m.read_runtime(archive,lock)
        self.assertEqual(len(loaded),len(files)-1); self.assertEqual(manifest['id'],lock['id'])
    def test_archive_digest_mismatch_is_rejected(self):
        files,_=self.base(); archive,lock=self.archive(files); lock['runtime']['sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'checksum'): m.read_runtime(archive,lock)
    def test_member_digest_mismatch_is_rejected_even_with_new_archive_hash(self):
        files,_=self.base(); files['core/payload.txt']=b'tampered'; archive,lock=self.archive(files)
        with self.assertRaisesRegex(ValueError,'checksum'): m.read_runtime(archive,lock)
    def test_component_marker_mismatch_is_rejected(self):
        files,manifest=self.base(); marker='core/.pwh-install.json'; files[marker]=m.js({'files':{'payload.txt':'0'*64}})
        for item in manifest['files']:
            if item['path']==marker:item.update(size=len(files[marker]),sha256=m.sha(files[marker]))
        files['runtime-manifest.json']=m.js(manifest); archive,lock=self.archive(files)
        with self.assertRaisesRegex(ValueError,'marker'):m.read_runtime(archive,lock)
    def test_manifest_cannot_duplicate_an_entry(self):
        files,manifest=self.base();manifest['files'][0]=manifest['files'][1];files['runtime-manifest.json']=m.js(manifest);archive,lock=self.archive(files)
        with self.assertRaisesRegex(ValueError,'membership'):m.read_runtime(archive,lock)
    def test_unknown_component_is_rejected(self):
        files,_=self.base();files['documents/private.txt']=b'not allowed';archive,lock=self.archive(files)
        with self.assertRaisesRegex(ValueError,'component'):m.read_runtime(archive,lock)
    def test_windows_unsafe_names_are_rejected(self):
        for name in ('../private','core/../private','C:/private','/absolute','core\\file','core/CON.txt','core/file.','core/file ','core/a:b'):
            with self.subTest(name=name),self.assertRaises(ValueError):m.safe_name(name)
    def test_zip_is_deterministic_and_never_overwrites(self):
        first=m.zip_new(self.root/'a.zip',{'b':b'2','a':b'1'});second=m.zip_new(self.root/'b.zip',{'a':b'1','b':b'2'})
        self.assertEqual(first['sha256'],second['sha256'])
        with self.assertRaises(FileExistsError):m.zip_new(self.root/'a.zip',{'x':b'x'})
    def test_verified_core_is_accepted(self):
        core,project,record,lock=self.core();actual,_,files,_=m.verify_core(core,project,lock)
        self.assertEqual(actual,record);self.assertEqual(set(files),set(m.CORE_FILES))
    def test_dependency_drift_is_rejected(self):
        core,project,record,lock=self.core();record['lockAudit']['changedRetainedPackages']=1;(core/'BUILD-RECORD.json').write_bytes(m.js(record))
        with self.assertRaisesRegex(ValueError,'drift'):m.verify_core(core,project,lock)
    def test_patch_digest_drift_is_rejected(self):
        core,project,_,lock=self.core();(project/'docs/engine-patches/source.patch').write_bytes(b'different')
        with self.assertRaisesRegex(ValueError,'patch digest'):m.verify_core(core,project,lock)
    def test_core_bytes_cannot_be_substituted(self):
        core,project,_,lock=self.core();(core/'rhwp_bg.wasm').write_bytes(b'different')
        with self.assertRaisesRegex(ValueError,'output digest'):m.verify_core(core,project,lock)
    def test_new_build_record_is_in_component_marker(self):
        files,_=self.base();files['core/BUILD-RECORD.json']=b'new build record';m.component_marker(files,'core','rhwp-0.8.7-pwh-r4')
        marker=json.loads(files['core/.pwh-install.json']);self.assertEqual(marker['pwhRevision'],'rhwp-0.8.7-pwh-r4');self.assertEqual(marker['files']['BUILD-RECORD.json'],m.sha(b'new build record'))

    def evidence(self):
        core,_,record,_=self.core();raw=(core/'BUILD-RECORD.json').read_bytes()
        evidence={'schemaVersion':1,'wasmSha256':record['files']['rhwp_bg.wasm']['sha256'],'buildRecordSha256':m.sha(raw),'checks':[{'name':'synthetic fixture','status':'passed'}]}
        file=self.root/'regression.json';file.write_bytes(m.js(evidence));return file,record,raw,evidence
    def test_passing_regression_is_bound_to_exact_build(self):
        file,record,raw,evidence=self.evidence();actual,_=m.verify_regression(file,record,raw);self.assertEqual(actual,evidence)
    def test_stale_regression_for_another_wasm_is_rejected(self):
        file,record,raw,evidence=self.evidence();evidence['wasmSha256']='0'*64;file.write_bytes(m.js(evidence))
        with self.assertRaisesRegex(ValueError,'passing core build'):m.verify_regression(file,record,raw)
    def test_failed_regression_is_rejected(self):
        file,record,raw,evidence=self.evidence();evidence['checks'][0]['status']='failed';file.write_bytes(m.js(evidence))
        with self.assertRaisesRegex(ValueError,'passing core build'):m.verify_regression(file,record,raw)

if __name__=='__main__':unittest.main()
