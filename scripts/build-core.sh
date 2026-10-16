#!/usr/bin/env bash
# Maintainer-only Linux candidate build. Never replaces an installed runtime.
# Usage: bash scripts/build-core.sh PRISTINE_UPSTREAM_CHECKOUT NEW_OUTPUT_DIR
set -euo pipefail

if [[ $# -ne 2 || "$(uname -s)" != Linux ]]; then
  printf '%s\n' 'Usage (Linux): bash scripts/build-core.sh PRISTINE_UPSTREAM_CHECKOUT NEW_OUTPUT_DIR' >&2
  exit 2
fi
readonly pin=1a76570e833917d15817415a53c09ad61ab3203f
readonly toolchain=1.93.1
readonly bindgen_version=0.2.127
readonly bindgen_archive_sha256=61d4a7dc85acfa0d2354ccc0b8361928c7e52a746d17f28ebaa795ed3dc1614a
readonly test_filter=pwh_floating_picture
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
source_root="$(cd -- "$1" && pwd -P)"
output_root="$(realpath -m -- "$2")"
patch_file="$repo_root/engine-patches/rhwp-0.8.7-floating-picture.patch"
if [[ -e "$output_root" || "$output_root" == "$source_root"/* || "$output_root" == "$repo_root" ]]; then
  printf '%s\n' 'Output must be a new directory outside the upstream checkout.' >&2
  exit 2
fi
for command in git rustup cargo curl tar python3 sha256sum; do command -v "$command" >/dev/null; done
[[ -f "$patch_file" ]]
[[ "$(git -C "$source_root" rev-parse HEAD)" == "$pin" ]]
[[ -z "$(git -C "$source_root" status --porcelain --untracked-files=normal)" ]]
mkdir -p -- "$output_root/logs" "$output_root/pkg" "$output_root/source-inputs"
trap 'result=$?; printf "exitCode=%s\n" "$result" > "$output_root/build-status.txt"' EXIT
export CARGO_INCREMENTAL=0
export RUSTFLAGS='-C debuginfo=0'
export SOURCE_DATE_EPOCH="$(git -C "$source_root" show -s --format=%ct HEAD)"

rustup toolchain install "$toolchain" --profile minimal --target wasm32-unknown-unknown 2>&1 | tee "$output_root/logs/toolchain.log"
{
  rustup --version
  rustup run "$toolchain" rustc -Vv
  rustup run "$toolchain" cargo --version
  rustup target list --installed --toolchain "$toolchain"
} 2>&1 | tee -a "$output_root/logs/toolchain.log"

# Use the CLI matching Cargo.lock; verify the official release's checksum before execution.
tools_dir="$(mktemp -d "${TMPDIR:-/tmp}/pwh-core-tools.XXXXXXXX")"
archive="wasm-bindgen-$bindgen_version-x86_64-unknown-linux-musl.tar.gz"
release="https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$bindgen_version"
curl --fail --location --retry 3 --connect-timeout 15 --max-time 180 "$release/$archive" --output "$tools_dir/$archive"
curl --fail --location --retry 3 --connect-timeout 15 --max-time 60 "$release/$archive.sha256sum" --output "$tools_dir/checksum.txt"
expected="$(python3 - "$tools_dir/checksum.txt" <<'PY'
import pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text().split()
if not text or not re.fullmatch(r'[a-fA-F0-9]{64}', text[0]):
    raise SystemExit('Invalid wasm-bindgen release checksum')
print(text[0].lower())
PY
)"
actual="$(sha256sum "$tools_dir/$archive" | cut -d ' ' -f 1)"
[[ "$actual" == "$expected" && "$actual" == "$bindgen_archive_sha256" ]]
tar -xzf "$tools_dir/$archive" -C "$tools_dir"
bindgen="$tools_dir/wasm-bindgen-$bindgen_version-x86_64-unknown-linux-musl/wasm-bindgen"
[[ "$("$bindgen" --version)" == "wasm-bindgen $bindgen_version" ]]
printf 'wasm-bindgen %s\nreleaseArchiveSha256=%s\n' "$bindgen_version" "$actual" | tee -a "$output_root/logs/toolchain.log"

cp -- "$patch_file" "$output_root/core-source.patch"
git -C "$source_root" apply --index --check "$patch_file"
git -C "$source_root" apply --index "$patch_file"
git -C "$source_root" diff HEAD --check
lock_before="$(git -C "$source_root" show HEAD:Cargo.lock | sha256sum | cut -d ' ' -f 1)"
[[ "$(sha256sum "$source_root/Cargo.lock" | cut -d ' ' -f 1)" == "$lock_before" ]]

(
  cd -- "$source_root"
  cargo +"$toolchain" test --locked -p rhwp --profile release-test --lib "$test_filter" -- --nocapture --test-threads=1
) 2>&1 | tee "$output_root/logs/native-tests.log"
# A typo in a test filter must fail rather than falsely certify a zero-test run.
python3 - "$output_root/logs/native-tests.log" <<'PY'
import pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text()
matches = re.findall(r'test result: ok\. (\d+) passed; (\d+) failed;', text)
if not matches or int(matches[-1][0]) < 1 or int(matches[-1][1]) != 0:
    raise SystemExit('At least one passing native regression test is required')
PY
(
  cd -- "$source_root"
  cargo +"$toolchain" build --locked -p rhwp --target wasm32-unknown-unknown --release --lib
) 2>&1 | tee "$output_root/logs/wasm-build.log"
"$bindgen" "$source_root/target/wasm32-unknown-unknown/release/rhwp.wasm" --target web --out-name rhwp --out-dir "$output_root/pkg" 2>&1 | tee "$output_root/logs/wasm-bindgen.log"
[[ -s "$output_root/pkg/rhwp.js" && -s "$output_root/pkg/rhwp_bg.wasm" ]]
[[ "$(sha256sum "$source_root/Cargo.lock" | cut -d ' ' -f 1)" == "$lock_before" ]]
cp -- "$source_root/Cargo.lock" "$output_root/Cargo.lock"
cp -- "$source_root/LICENSE" "$output_root/LICENSE"
cp -- "$source_root/THIRD_PARTY_LICENSES.md" "$output_root/THIRD_PARTY_LICENSES.md"

python3 - "$source_root" "$output_root" "$repo_root" "$bindgen" "$actual" <<'PY'
import datetime, hashlib, json, os, pathlib, platform, re, shutil, subprocess, sys
source, output, repo = map(pathlib.Path, sys.argv[1:4])
bindgen, bindgen_archive_sha = sys.argv[4:6]
def git(*args, check=True):
    return subprocess.run(['git', '-C', str(source), *args], check=check, capture_output=True).stdout
def sha(data): return hashlib.sha256(data).hexdigest()
changed = []
for raw in git('diff', 'HEAD', '--name-only', '--diff-filter=AMR', '-z').split(b'\0'):
    if not raw: continue
    name = raw.decode('utf-8')
    relative = pathlib.PurePosixPath(name)
    if relative.is_absolute() or '..' in relative.parts:
        raise SystemExit('Unsafe changed source path')
    item = source.joinpath(*relative.parts)
    if item.is_symlink() or not item.is_file():
        raise SystemExit('Changed source must be a regular file')
    content = item.read_bytes()
    before = subprocess.run(['git', '-C', str(source), 'show', 'HEAD:' + name], capture_output=True)
    target = output / 'source-inputs' / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    changed.append({'path': name, 'beforeSha256': sha(before.stdout) if before.returncode == 0 else None,
                    'afterSha256': sha(content), 'bytes': len(content)})
if not changed: raise SystemExit('The candidate must contain an actual source change')
# Keep the small workspace sources Cargo metadata requires, without publishing
# the large unrelated tool corpora, sample documents or binary font fixtures.
workspace_members = ['tools/rhwp-subsecond', 'tools/batch-convert',
    'tools/llm_verifier/verdict_protocol', 'tools/llm_verifier/claim_bind',
    'tools/llm_verifier/criteria_decomp']
unchanged_names = {'Cargo.lock', 'LICENSE', 'THIRD_PARTY_LICENSES.md'}
for member in workspace_members:
    for raw in git('ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', member).split(b'\0'):
        if not raw: continue
        name = raw.decode('utf-8')
        if name in {member + '/Cargo.toml', member + '/build.rs'} or name.startswith(member + '/src/'):
            unchanged_names.add(name)
unchanged = []
for name in sorted(unchanged_names):
    original = git('show', 'HEAD:' + name)
    current = source / pathlib.PurePosixPath(name)
    if current.is_symlink() or not current.is_file() or current.read_bytes() != original:
        raise SystemExit('Additional workspace input differs from the pinned upstream: ' + name)
    target = output / 'source-inputs' / pathlib.PurePosixPath(name)
    if target.exists(): raise SystemExit('Changed and unchanged input paths overlap: ' + name)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(original)
    unchanged.append({'path': name, 'sha256': sha(original), 'bytes': len(original)})
test_text = (output / 'logs/native-tests.log').read_text()
passed, failed = map(int, re.findall(r'test result: ok\. (\d+) passed; (\d+) failed;', test_text)[-1])
def version(command): return subprocess.check_output(command, text=True).strip()
files = []
for item in sorted(output.rglob('*')):
    if item.is_file() and item.name not in {'core-build-provenance.json', 'SHA256SUMS', 'build-status.txt'}:
        content = item.read_bytes()
        files.append({'path': item.relative_to(output).as_posix(), 'sha256': sha(content), 'bytes': len(content)})
provenance = {
    'schemaVersion': 1, 'upstreamRepository': 'https://github.com/edwardkim/rhwp',
    'upstreamCommit': git('rev-parse', 'HEAD').decode().strip(),
    'pwhCommit': subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip(),
    'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'target': 'wasm32-unknown-unknown',
    'patch': {'path': 'core-source.patch', 'sha256': sha((output / 'core-source.patch').read_bytes())},
    'compiler': {'rustc': version(['rustup', 'run', '1.93.1', 'rustc', '-Vv']),
                 'cargo': version(['rustup', 'run', '1.93.1', 'cargo', '--version']),
                 'wasmBindgen': version([bindgen, '--version']), 'host': platform.platform(),
                 'wasmBindgenArchiveSha256': bindgen_archive_sha},
    'environment': {'RUSTFLAGS': os.environ['RUSTFLAGS'], 'SOURCE_DATE_EPOCH': os.environ['SOURCE_DATE_EPOCH'],
                    'CARGO_INCREMENTAL': os.environ['CARGO_INCREMENTAL']},
    'commands': ['cargo +1.93.1 test --locked -p rhwp --profile release-test --lib pwh_floating_picture -- --nocapture --test-threads=1',
                 'cargo +1.93.1 build --locked -p rhwp --target wasm32-unknown-unknown --release --lib',
                 'wasm-bindgen rhwp.wasm --target web --out-name rhwp --out-dir pkg'],
    'verification': {'nativeTests': {'passed': passed, 'failed': failed, 'log': 'logs/native-tests.log'},
                     'wasmBuild': {'succeeded': True, 'log': 'logs/wasm-build.log'}, 'cargoLockUnchanged': True},
    'changedSources': changed, 'unchangedSources': unchanged, 'files': files,
}
if os.environ.get('GITHUB_RUN_ID'):
    provenance['actionsRun'] = 'https://github.com/' + os.environ['GITHUB_REPOSITORY'] + '/actions/runs/' + os.environ['GITHUB_RUN_ID']
(output / 'core-build-provenance.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n')
checksums = [f"{sha(item.read_bytes())}  {item.relative_to(output).as_posix()}" for item in sorted(output.rglob('*'))
             if item.is_file() and item.name not in {'SHA256SUMS', 'build-status.txt'}]
(output / 'SHA256SUMS').write_text('\n'.join(checksums) + '\n')
print(json.dumps({'changedSources': len(changed), 'nativeTestsPassed': passed,
                  'wasmBytes': (output / 'pkg/rhwp_bg.wasm').stat().st_size}))
PY
