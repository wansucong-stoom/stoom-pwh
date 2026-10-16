"""Maintenance builder evidence checks: python -m unittest discover -s tests -p test_preserve_engine.py."""
import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC=importlib.util.spec_from_file_location('preserve_engine',Path(__file__).resolve().parents[1]/'scripts/preserve-engine.py')
engine=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(engine)


class CoreBuildEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.scratch=Path(__file__).resolve().parents[1]/'output'
        self.scratch.mkdir(exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(prefix='pwh-core-evidence-test-',dir=self.scratch)
        self.root=Path(self.temp.name)
        self.addCleanup(self.cleanup)
        self.core=self.root/'candidate';self.runtime=self.root/'runtime';self.build=self.root/'build'
        self.core.mkdir()
        self.before=b'pub fn layout() { let y = 0; }\n'
        self.after=b'pub fn layout() { let y = 1; }\n'
        self.pristine={'src/layout.rs':self.before,'Cargo.lock':b'version = 3\n'}
        self.original={'rhwp.js':b'original glue','rhwp_bg.wasm':b'original wasm'}
        replay=self.root/'patch-base';replay.mkdir()
        for name,data in self.pristine.items():
            file=replay/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(data)
        engine.git(replay,'init','--quiet')
        engine.git(replay,'config','user.name','pwh test')
        engine.git(replay,'config','user.email','test@localhost')
        engine.git(replay,'add','.')
        engine.git(replay,'commit','--quiet','-m','Fixture')
        (replay/'src/layout.rs').write_bytes(self.after)
        patch=engine.git(replay,'diff','--binary','HEAD')
        self.entries={
            'core-source.patch':patch,'source-inputs/src/layout.rs':self.after,
            'source-inputs/Cargo.lock':self.pristine['Cargo.lock'],
            'pkg/rhwp.js':b'// generated WebAssembly glue\n',
            'pkg/rhwp_bg.wasm':b'\0asm\x01\0\0\0candidate',
            'pkg/rhwp.d.ts':b'export class Document {}\n',
            'pkg/rhwp_bg.wasm.d.ts':b'export const memory: WebAssembly.Memory;\n',
            'logs/tests.log':b'test result: ok. 2 passed; 0 failed; 0 ignored;\n',
            'logs/build.log':b'Finished release build\n',
        }
        self.meta={'schemaVersion':1,'upstreamCommit':engine.PIN,'target':'wasm32-unknown-unknown',
            'compiler':{'rustc':'rustc fixture','cargo':'cargo fixture','wasmBindgen':'fixture','host':'fixture'},
            'commands':['cargo build --target wasm32-unknown-unknown --lib','wasm-bindgen --target web'],
            'patch':{'path':'core-source.patch','sha256':engine.sha(patch)},
            'verification':{'nativeTests':{'passed':2,'failed':0,'log':'logs/tests.log'},'wasmBuild':{'succeeded':True,'log':'logs/build.log'}},
            'changedSources':[{'path':'src/layout.rs','beforeSha256':engine.sha(self.before),'afterSha256':engine.sha(self.after),'bytes':len(self.after)}]}
        self.write_candidate()
        for name,data in self.entries.items():
            if name.startswith('pkg/'):
                file=self.runtime/'core'/name[4:];file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(data)
        (self.build/'pkg').mkdir(parents=True)
        (self.build/'pkg/rhwp_bg.wasm').write_bytes(self.entries['pkg/rhwp_bg.wasm'])

    def cleanup(self):
        self.assertEqual(self.root.resolve().parent,self.scratch.resolve())
        self.assertTrue(self.root.name.startswith('pwh-core-evidence-test-'))
        self.temp.cleanup()

    def write_candidate(self):
        for name,data in self.entries.items():
            file=self.core/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(data)
        self.meta['files']=[{'path':name,'sha256':engine.sha(data),'bytes':len(data)} for name,data in self.entries.items()]
        (self.core/'core-build-provenance.json').write_bytes(engine.js(self.meta))

    def verify(self):
        return engine.verify_core_build(self.core,self.pristine,self.original,self.runtime,self.build,self.root)

    def test_real_patch_replays_and_all_evidence_is_retained(self):
        result=self.verify()
        self.assertTrue(result['patchReplayVerified'])
        self.assertEqual(result['changes'][0]['beforeSha256'],engine.sha(self.before))
        self.assertIn('core-build-provenance.json',result['inputs'])
        self.assertEqual(result['originalCore']['rhwp_bg.wasm'],engine.sha(self.original['rhwp_bg.wasm']))

    def test_runtime_or_studio_wasm_must_match_the_declared_candidate(self):
        file=self.runtime/'core/rhwp_bg.wasm';file.write_bytes(b'other build')
        with self.assertRaisesRegex(ValueError,'Installed core differs'):self.verify()
        file.write_bytes(self.entries['pkg/rhwp_bg.wasm'])
        (self.build/'pkg/rhwp_bg.wasm').write_bytes(b'other build')
        with self.assertRaisesRegex(ValueError,'Studio WASM differs'):self.verify()

    def test_hash_correct_output_cannot_substitute_a_different_source_patch(self):
        self.meta['changedSources'][0]['beforeSha256']='0'*64
        self.write_candidate()
        with self.assertRaisesRegex(ValueError,'pristine/candidate'):self.verify()
        self.meta['changedSources'][0]['beforeSha256']=engine.sha(self.before)
        self.entries['source-inputs/src/layout.rs']=b'pub fn unrelated() {}\n'
        changed=self.meta['changedSources'][0]
        changed['afterSha256']=engine.sha(self.entries['source-inputs/src/layout.rs'])
        changed['bytes']=len(self.entries['source-inputs/src/layout.rs'])
        self.write_candidate()
        with self.assertRaisesRegex(ValueError,'patch replay mismatch'):self.verify()

    def test_tampering_and_false_test_counts_are_rejected(self):
        (self.core/'logs/build.log').write_bytes(b'changed after recording')
        with self.assertRaisesRegex(ValueError,'digest or size mismatch'):self.verify()
        self.meta['verification']['nativeTests']['passed']=3
        self.write_candidate()
        with self.assertRaisesRegex(ValueError,'passing test count'):self.verify()

    def test_unrecorded_dependency_changes_and_path_aliases_are_rejected(self):
        self.entries['source-inputs/Cargo.lock']=b'changed dependencies\n';self.write_candidate()
        with self.assertRaisesRegex(ValueError,'Unrecorded changed core source'):self.verify()
        for name in ('../escape','pkg/CON.txt','pkg/name:stream','pkg/trailing.','pkg\\rhwp.js'):
            with self.subTest(name=name),self.assertRaises(ValueError):engine.checked_path(self.core,name)

    def test_sparse_source_fallback_requires_the_independent_pinned_git_blob(self):
        name='tools/rhwp-subsecond/src/main.rs';content=b'fn main() {}\n'
        target=self.core/'source-inputs'/name;target.parent.mkdir(parents=True);target.write_bytes(content)
        blob=hashlib.sha1(f'blob {len(content)}\0'.encode()+content).hexdigest()
        unavailable=subprocess.CalledProcessError(128,['git','cat-file'])
        with patch.object(engine,'git',side_effect=unavailable):
            self.assertEqual(engine.pinned_extra_input(self.root,name,blob,self.core),content)
            target.write_bytes(b'fn injected() {}\n')
            with self.assertRaisesRegex(ValueError,'pinned Git blob'):
                engine.pinned_extra_input(self.root,name,blob,self.core)
        # An available pinned blob takes precedence over an untrusted overlay.
        with patch.object(engine,'git',return_value=content):
            self.assertEqual(engine.pinned_extra_input(self.root,name,blob,self.core),content)


if __name__=='__main__':unittest.main()
