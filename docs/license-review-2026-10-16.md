# pwh source and distribution license review

Review date: 2026-10-16. Scope: the pwh repository, pinned rhwp 0.8.7 at
`1a76570e833917d15817415a53c09ad61ab3203f`, its current Windows runtime, Studio
build inputs/dependencies, fonts/assets, and the proposed preservation release.

This is a source/artifact and license-evidence review, not a court finding or a
legal opinion on every contributor's ownership, patent, trademark or contract.
The service is not certified free of infringement. Items requiring additional
rights evidence are distinguished below from concrete distribution corrections.

## Findings and treatment

| Area | Evidence and conclusion | Treatment |
|---|---|---|
| pwh-authored source | Repository LICENSE is MIT. It cannot relicense third-party code. | Retain pwh notice and distinguish upstream/third-party terms. |
| rhwp/Studio/core/editor | Exact pinned source and packages identify MIT, Edward Kim 2025–2026. Modification and redistribution are permitted subject to notice retention. | Preserve original notices, source pin, unmodified original packages and pwh modification records. |
| Directly ported Volexity code | Upstream THIRD_PARTY_LICENSES identifies a BSD-3-Clause port in `src/parser/crypto.rs`. Copying only rhwp's MIT text is insufficient to describe this component. | Include the upstream third-party notice, including Volexity copyright, conditions and disclaimer, in runtime components. |
| Rust dependency inventory | The actual Cargo.lock has 408 package entries; 397 registry archives were obtained and checksum-verified. The upstream summary's older counts/versions are not a current complete inventory. | Preserve the actual lock, archive checksums and collected license texts. Treat the inventory as an over-approximation, not an exact binary link map. |
| Permissive/alternative Rust licenses | Collected metadata includes MIT/Apache/BSD/Zlib/Unicode/CC0 and alternatives. `r-efi` offers LGPL **or** MIT/Apache, so the LGPL alternative does not by itself impose LGPL on pwh. | Retain all notices; use compatible permissive alternatives where offered. No conclusion that every optional/platform dependency is linked. |
| npm inventory | Lock contains 449 package entries; 382 are installed in the reviewed tree. Installed metadata identifies MIT, ISC, Apache, BSD, BlueOak, CC-BY and MPL alternatives/categories. The published minimal client-build closure contains 22 packages and has notice evidence for all 22. | Preserve that closure, not unrelated browser-test tooling; retain its original package notices and an inventory. |
| Lightning CSS | Two installed packages (JS wrapper/native Windows binding), version 1.33.0, identify MPL-2.0. Redistributing its executable form entails source-availability obligations for that covered software. | Bundle the corresponding source snapshot at commit `1d680fa14e9a089c92dc0929f869d6757ae91c30`, retain MPL text and provide a source-location notice. Build use alone does not make unrelated pwh files MPL. |
| Third-party notices in built JS/native binaries | A build artifact or upstream executable does not automatically carry all original package notices. | Add the collected notice bundle to each preserved runtime component and a companion release asset. This improves notice coverage; exact upstream binary feature/link provenance remains unverified. |
| Binary fonts and sample documents in upstream tree | Upstream source includes OFL and other font terms, including fonts described merely as free distribution, plus example documents/screenshots. MIT at repository root does not prove all those assets can be redistributed on identical terms. | Exclude binary fonts, screenshots and sample documents from the public source-input snapshot; none are needed by pwh's inline build. Preserve only licensing/source descriptions needed for provenance. |
| System/Hancom/Microsoft fonts | pwh enumerates user-installed fonts and supplies local font bytes to the local client. It does not grant redistribution or document-embedding rights. | Do not bundle user/system font files in Git, ZIPs or the engine mirror. Check the applicable font license before externally embedding/distributing fonts in outputs; do not silently substitute every font. |
| Institution reports/logos | User possession of a report/logo is not permission to sublicense it as plugin content. | Exclude institution documents, logos, filled reports and recovery drafts from public packages and preservation assets. |
| Codex/Hancom proprietary application code | Public pwh source uses its plugin/editor integration; no Codex executable/ASAR or Hancom executable is part of the preserved engine. | Do not copy or redistribute proprietary application code or imply endorsement. A compatibility investigation is not itself a general license to reproduce another product. |

## Remaining matters needing specific evidence

1. **Exact upstream binary attribution:** Cargo.lock and npm notices do not prove
   the full component set actually linked into a prebuilt native Skia executable
   or WASM. A compiler-generated SBOM/link feature record and all Skia third-party
   notices would provide stronger assurance. Preservation does not validate a
   complete native rebuild or the entire binary's chain of title.
2. **Upstream asset origin:** toolbars/icons and other upstream resources are
   included under the project's published terms; their individual authorship was
   not independently established. Do not claim the pwh author created the rhwp
   UI/assets. An ownership dispute would need asset-specific evidence.
3. **Extracted HWP fallback data:** upstream
   `src/parser/hwpx/contract_streams.rs` says several small metadata/script/blank
   preview fallbacks were extracted from sample HWP files. The source establishes
   origin, not a legal conclusion about protectability or third-party permission.
   Whether those functional/blank data are protected expression needs a focused
   legal assessment if this becomes a commercial distribution concern.
4. **Commercial fonts and output documents:** font EULAs, embedding restrictions,
   institution branding and user-upload rights are outside what a repository MIT
   license can resolve. The runtime mirror excludes those user font/document files.
5. **Historical artifacts:** old plugin ZIPs/releases, if copied elsewhere, are not
   retroactively corrected by the new notice bundle. This review does not assert
   that every historical distribution complied with every notice requirement.

There is evidence of attribution/notice coverage that needed correction; this
review does **not** establish that the whole service infringes copyright, nor
does it establish absence of all infringement. For commercial release, resolve
the specific remaining questions with the relevant rights holders or counsel.

## Official legal/license references

- [Korean Copyright Act, Article 46: use within permitted methods and conditions](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029423517).
- [Article 101-4: limited conditions for program-code reverse analysis](https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=04&joNo=0101&lsiSeq=283335&urlMode=lsScJoRltInfoR). This is not blanket permission to copy a compatible product.
- [MIT license, Open Source Initiative](https://opensource.org/license/mit).
- [Apache License 2.0, section 4](https://www.apache.org/licenses/LICENSE-2.0.html).
- [Mozilla Public License 2.0, sections 3.1–3.3](https://www.mozilla.org/en-US/MPL/2.0/) and [official FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).
- [SIL OFL official FAQ](https://openfontlicense.org/ofl-faq/).

The counts, versions and hashes are artifact observations; the conclusions about
how the license conditions apply are reasoned interpretations of those sources.
