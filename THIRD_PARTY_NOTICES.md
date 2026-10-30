# Third-party notices

pwh's own source is covered by the repository's [LICENSE](LICENSE). That license
does not replace the licenses of the engines, SDKs, font files or other upstream
components described below. The public repository contains no institution
document, institution logo or filled institution report as a test fixture.

## rhwp, rhwp Studio and @rhwp/editor

- Project: <https://github.com/edwardkim/rhwp>
- Runtime and SDK target: **v0.8.7**.
- Source pin: `1a76570e833917d15817415a53c09ad61ab3203f`.
- Pinned license: <https://github.com/edwardkim/rhwp/blob/1a76570e833917d15817415a53c09ad61ab3203f/LICENSE>.
- License: MIT, copyright (c) 2025-2026 Edward Kim.

The Studio build script checks this source pin before applying pwh's additive
selection bridge. Downloaded native executables, Studio builds and SDK files are
runtime assets, rather than source files committed to this repository. Versioned
copies, source-input snapshots, modification patches and corresponding-source
assets are retained in this repository's engine preservation Releases, referenced
by `runtime-lock.json`. Normal setup installs that preserved prebuilt runtime.
Preserve the upstream license and bundled dependency/font notices when copying
or redistributing those assets. The MIT notice for upstream code is reproduced
below; it does not relicense upstream font assets or other dependencies.

Each preserved runtime component contains
`licenses/pwh-preservation/THIRD-PARTY-NOTICES.txt`, with the collected upstream,
npm and Rust dependency notices. Companion inventories and original Cargo
archives are release assets. The inventory is not an exact binary link map.
See [the dated review](docs/license-review-2026-10-16.md) for limitations and
remaining rights/provenance questions.

## Lightning CSS and Studio build dependencies

The minimal Windows Studio rebuild bundle contains 22 installed packages, whose
individual terms are retained. Lightning CSS 1.33.0 and its Windows binding are
MPL-2.0. Its corresponding source at commit
`1d680fa14e9a089c92dc0929f869d6757ae91c30` is provided as
`lightningcss-1.33.0-source.zip` in the engine preservation Release, alongside
the full MPL text and source-availability notice. This does not apply MPL to
unrelated pwh-authored files. Packages used only by upstream browser tests/PWA
tooling are not part of that minimal rebuild bundle.

The preserved source-input snapshot excludes binary fonts, screenshots and
sample documents. Do not infer their redistribution terms from the project's
MIT license. No proprietary system font or institution document is added to
the runtime mirror.

## OpenAI Codex app-server (Pwh Desktop)

Pwh Desktop은 ChatGPT 연결에 OpenAI가 공개한 Codex app-server `rust-v0.165.0`의 Windows x64 배포본을 사용합니다. Codex는 Apache License 2.0이며, 원본 [LICENSE](https://github.com/wansucong-stoom/stoom-pwh/blob/main/desktop/standalone-pwh/CODEX-APACHE-LICENSE.txt)와 [NOTICE](https://github.com/wansucong-stoom/stoom-pwh/blob/main/desktop/standalone-pwh/CODEX-NOTICE.txt)를 설치 파일에 포함합니다. 이 배포본에 포함된 ripgrep 15.2.0 및 PCRE2 10.45, 원본 NOTICE에 명시된 Ratatui의 라이선스도 `desktop/standalone-pwh/CODEX-*.txt`에 보존합니다. 바이너리는 공개 저장소에 커밋하지 않습니다.

## Inter (STOOM product mark)

Pwh Desktop의 제품 표시에 Inter 가변 글꼴을 사용합니다. 원본 글꼴의 출처와 SHA256은 `desktop/standalone-pwh/font-provenance.json`에, SIL Open Font License 1.1 전문은 `desktop/standalone-pwh/OFL-Inter.txt`에 포함합니다. 글꼴 파일은 수정하지 않았습니다.

## Electron and Chromium (Pwh Desktop)

Pwh Desktop 0.1.15는 [Electron 45.1.0](https://github.com/electron/electron/releases/tag/v45.1.0)의 공식 Windows x64 실행 환경을 포함합니다. Electron은 MIT 라이선스이며 원본 `electron/LICENSE`를 설치기에 보존합니다. Chromium과 포함된 구성요소의 고지는 같은 폴더의 `LICENSES.chromium.html`에 있습니다. 실행 파일에는 Pwh 제품명과 승인된 아이콘을 적용하며, 런타임 바이너리를 공개 소스 저장소에 커밋하지 않습니다. Electron의 [rcedit 2.0.0](https://github.com/electron/rcedit/releases/tag/v2.0.0)은 빌드에만 사용하며 사용자 설치기에는 포함하지 않습니다.

## HOP

- Project: <https://github.com/golbin/hop>.
- Reference source snapshot: <https://github.com/golbin/hop/commit/608d54bbc75af4142bc69c2c2b50c0c217b45731>
  (upstream's HOP v0.4.1 preparation commit).
- Official license: <https://github.com/golbin/hop/blob/main/LICENSE>, checked
  2026-10-16: MIT, copyright (c) 2025-2026 Edward Kim.

HOP is a separate, optional desktop application. pwh does not bundle HOP and does
not claim that this reference snapshot identifies a user's installed HOP build.
The required local editor/runtime integration uses the pinned rhwp components
listed above.

## Upstream MIT notice

The following notice applies to the rhwp and HOP upstream code described above:

```text
MIT License

Copyright (c) 2025-2026 Edward Kim

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Optional NAVER Nanum fonts

The optional original NanumBarunGothic and NanumGothic TTF files are licensed
under **SIL Open Font License 1.1**, as stated by NAVER's official licensing
page. The copyright notice, reserved font names, complete English license,
official source URLs and hashes of the four verified original files are in
[licenses/naver-nanum-OFL-1.1.txt](licenses/naver-nanum-OFL-1.1.txt).

The font binaries are optional downloads and are not committed to this
repository. Keep that notice with copies of the font files. Their OFL license
does not apply to documents merely created using these fonts.

Official sources: <https://hangeul.naver.com/font> and the full license linked
there, <https://help.naver.com/service/30016/contents/18088?osType=PC&lang=ko>.

## Locally installed Windows and Hancom fonts

Windows and Hancom font files, including Malgun Gothic, Gulim, HY HeadLine and
Human Myeongjo, are not included in the public repository or redistributed by
pwh's setup. Optional private font mappings refer to files already installed on
the user's computer. Those files retain their respective vendor licenses; this
repository's MIT license and the NAVER OFL notice grant no rights to them.
