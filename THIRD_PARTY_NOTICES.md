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
local runtime assets, rather than source files committed to this repository.
Preserve the upstream license and bundled dependency/font notices when copying
or redistributing those assets. The MIT notice for upstream code is reproduced
below; it does not relicense upstream font assets or other dependencies.

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
