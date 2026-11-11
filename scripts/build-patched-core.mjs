#!/usr/bin/env node
// Build a separate candidate. This script never installs or overwrites a runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

const pinned = {
  upstreamCommit: '1a76570e833917d15817415a53c09ad61ab3203f',
  sourceArchiveSha256: '067feefc25d36921ee41fea5df6fead00255ffa86441891fbaa202f96de202a2',
  blankTemplateSha256: '43f472751fafefb8c66b0f831660ebed51e443a46bebe44c75bba918154ce4c9',
  expectedGlueSha256: 'd3eaf8f102d632c5d07707296ea379400aef65b4c09d15d6aa2d7e7cb5cb7b8b',
};
const patches = [
  {
    "file": "rhwp-0.8.7-nols-row-content-floor.patch",
    "sha256": "5a2427c162ee3928b7edecbaabad10936700c7db02f25a5436fb0a74a92bd221",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "1dcbd3254a0f68b7de40c922f10e15cb62f2ef85e2c59fb24050bb143fa5f5f9",
        "patchedSha256": "c3df908c978e4aef7876b555c4a4c7b85749587194b4755d43e4c5ae9c67c238"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-inline-table-affect-line-spacing.patch",
    "sha256": "a9f6a533debe686f6e89ec06870e47ccb0357635f8303775467ceb6cfca9da7a",
    "sources": [
      {
        "path": "src/renderer/mod.rs",
        "originalSha256": "b27c1148d0496fe02dfef5ee3375511c3f2cd110925ebbfe90398a67b018f15d",
        "patchedSha256": "c9191193db4a0b14a936887fac5ffd99f47d77311f60dc58b961574048c3271a"
      },
      {
        "path": "src/renderer/composer/line_breaking.rs",
        "originalSha256": "42a685bc83d81e01356a5576fcc03d0c92117d5054d018c84f77ddbad297921e",
        "patchedSha256": "6ced0b75cf4b46090801dd05adabe6e715d9ff06e22468ead3dbd5e6fbc9b940"
      },
      {
        "path": "src/renderer/layout.rs",
        "originalSha256": "eb561f70fed2217db8e17efc8b33a5639de4dd5c8087797cd2cf876be4bc4ca5",
        "patchedSha256": "81fef37b2cd464f007d721edcdaf938d6ba47439dc9418c8745bc7da927d7a61"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-nested-source-ownership.patch",
    "sha256": "346e2885cb5720574515167db94448f256e5d210d729ee63e2c0ac732e5b2a96",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "c3df908c978e4aef7876b555c4a4c7b85749587194b4755d43e4c5ae9c67c238",
        "patchedSha256": "7f294df11f7dc48611cdcfbf8a7fa813763778dd9c4573cd619c06bc4c26990a"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "9e0a4d66d00906d4c949481088dba04d81d1f04ac1091b09188d65a9140ddeab",
        "patchedSha256": "cebac7b673a9c051bf31e64bcc6d2310f669b74a97bfd6351d663a9cc5b452d6"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-stored-grown-table-pagination.patch",
    "sha256": "596bf711aaf4494438c76e0b77aa29741c93f2cdb9b75c5b49e3e4c3364eade3",
    "sources": [
      {
        "path": "src/renderer/height_measurer.rs",
        "originalSha256": "c71e4166c3d701bf702d6ebd2efbb9a7e53fa6046f45beb9ec2469c1c18e1ddd",
        "patchedSha256": "15b9761d3a5273238c533af3f6a1ddc95bffa365a03eb0e456c989914c41e3a6"
      },
      {
        "path": "src/renderer/typeset.rs",
        "originalSha256": "62b9c40af3cc06a63d0ab63b25d02f7740942d016dba198619883d091687cf14",
        "patchedSha256": "1a46e4655e19c95083dd7e5501224e5ca73d9d3dd54d0ecc1341b4fa51bfdac7"
      },
      {
        "path": "src/renderer/typeset/controls/tac_fit.rs",
        "originalSha256": "31a9dfe9482ca8798b25b2c42ad2bf2ef02ce73b309959234a851276855be6d3",
        "patchedSha256": "0168df5eacacf3b7c31fb6b13e1d18a6c7011e5415cce86dfefeecdc3f8d3b6f"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-unsegmented-float-flow.patch",
    "sha256": "174b98deb82291af3238e56b08b807c177e0478898091c652664ead2737c3f11",
    "sources": [
      {
        "path": "src/renderer/float_placement.rs",
        "originalSha256": "82759ab163aa6fe8f57aee13fefd68bcddbde11c57e468cbc34a2e2320b4044a",
        "patchedSha256": "505a0bd578cc15d33a8bc84a2057250d5cbdf6227c0683e609aece799e6db013"
      },
      {
        "path": "src/renderer/layout.rs",
        "originalSha256": "81fef37b2cd464f007d721edcdaf938d6ba47439dc9418c8745bc7da927d7a61",
        "patchedSha256": "9a331572f891129fb1674d29a1db72e209285f1c6e6904498fda6e81f19c223d"
      },
      {
        "path": "src/renderer/typeset/table/host_spacing.rs",
        "originalSha256": "cd6908b0f9c258db1898418124c17d23e8e9ad3124176e4b1afa5663047ad4ef",
        "patchedSha256": "e355cff05386365f4637dee606251d4edbdd4ca6921410b24d70a44fe2ab195c"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-interior-float-anchor.patch",
    "sha256": "1d3499dc7a5154c5b04467b4197a3a793e47d56f702dc6853a7bbae090bc8a4b",
    "sources": [
      {
        "path": "src/renderer/float_placement.rs",
        "originalSha256": "505a0bd578cc15d33a8bc84a2057250d5cbdf6227c0683e609aece799e6db013",
        "patchedSha256": "fcfab96c017a160429fa9873371ea59dd6564480daaaa08ec90d87aea7e6bad3"
      },
      {
        "path": "src/renderer/typeset/table/block/entry.rs",
        "originalSha256": "90389834b32c48190b4ebab7b1261385dc56953823f5616ced89aecbdd3e4cbc",
        "patchedSha256": "2a2be46cfc35b58ff08664a47598ee0b51997afe51cb51232654ff0c92432a3a"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-note-cursor-source-offsets.patch",
    "sha256": "909e7741914ed83f695b904cccb5400c5501c19271f6eb77641d7a761f988d50",
    "sources": [
      {
        "path": "src/document_core/queries/cursor_rect.rs",
        "originalSha256": "b8f9b7913e68f1e72919c6487d6c0cedfe1175338ba644e1a49428fd521cb069",
        "patchedSha256": "c7dd6bedf24033a2e221bc7f64f7ac69592307c48821128021353696cdb80906"
      },
      {
        "path": "src/document_core/commands/footnote_ops.rs",
        "originalSha256": "cb3ddbd3977d106072695e2223ab0206a9816cc156cc742c2983d4c9b9a0009a",
        "patchedSha256": "32f00884b41a1e7dc8455a0c7bb299cab688abceb869419b8314bce5576f21af"
      },
      {
        "path": "src/renderer/layout/paragraph_layout.rs",
        "originalSha256": "cb2deb845baa718284658576a44ae2db3cfb20f3eea4f83ee5714bce9295d91f",
        "patchedSha256": "d792ae300068a718003ab67ab12dde113ed34a7fb1e0f9546d570ba710565186"
      },
      {
        "path": "src/renderer/render_tree.rs",
        "originalSha256": "7b0a9e3920ebaa24f9a645b3a1a3f5aecf2a82bcc85bf6c2aaf3e2f0971b5d60",
        "patchedSha256": "c5c70b4de04ac0a4a1d9993963293bb14b818a0dda79a71e97871cd2c3b9445c"
      },
      {
        "path": "src/paint/json.rs",
        "originalSha256": "c40bf373d6b1fd102b100b20f3721413672150a7506162ba011bbe09753ca089",
        "patchedSha256": "b48086acd0590d6bc3d81cc9e182bcb5440eadf3102cdbacc003d039a9ce7ff8"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-closed-float-successor-frame.patch",
    "sha256": "dd454d191de066be2fbbb659f9e63681b011ec2067f9280355743a05f50294cf",
    "sources": [
      {
        "path": "src/renderer/typeset/controls/empty_float.rs",
        "originalSha256": "ee4305f04e2869e2bb2ac16b7d85b91264c80ae929ae54516f2a721debfbb645",
        "patchedSha256": "60f45e29d40a79386f6811c5cfcd85084a210227a4f56b8360e350c508a202e3"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-implicit-bullet-marker.patch",
    "sha256": "466a63e2d72191e209c8992d6263a612bc0bccc45a6228b381510ab4ae6924d8",
    "sources": [
      {
        "path": "src/renderer/layout/paragraph_layout.rs",
        "originalSha256": "d792ae300068a718003ab67ab12dde113ed34a7fb1e0f9546d570ba710565186",
        "patchedSha256": "2aa9dca69eb9805a4484a088f611b6efc9037295b24224e317cea6d977bb250b"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-shape-fill-transparency.patch",
    "sha256": "0844a2a531175115f41cd9590f1c3337cf6ea10971c90cdfa88ba4d9275edfbb",
    "sources": [
      {
        "path": "src/model/style.rs",
        "originalSha256": "470787a168f4c2c7c69ece3d155bc4b3fe25a26b02c43dbc16b0f839c6a2844e",
        "patchedSha256": "1bddd1429e47a67557d32cacc3cfa71def112e56935e159435661cd18b6c3e0d"
      },
      {
        "path": "src/parser/hwpx/header.rs",
        "originalSha256": "4f6cd8163f9c4664ba0360e52a1b2027a59bcebd0d5f4291a16586c5d55e838b",
        "patchedSha256": "2bff680af2a0cad5d4cd279007046e7854d683a19e0d6765ab5abaae87f0b369"
      },
      {
        "path": "src/parser/hwpx/section.rs",
        "originalSha256": "7d5d38bb8060bbbd454029f7bbab3cf90af589262ab432b7e95a03034be056b7",
        "patchedSha256": "fbb0c39bb12d2cde98ac2c4ce1e26c824a5a4d6fd6769f5e9b0cd811cf9a1839"
      },
      {
        "path": "src/serializer/hwpx/shape.rs",
        "originalSha256": "dacb18a59d24230ecb7ac23a51e7b6876d9482b8d1fbc68a3589818669950ff2",
        "patchedSha256": "09118dcceb27c20076a816a4cd88520bbc8a92b428e9047f231c26f0e1e5c2e4"
      },
      {
        "path": "src/renderer/mod.rs",
        "originalSha256": "c9191193db4a0b14a936887fac5ffd99f47d77311f60dc58b961574048c3271a",
        "patchedSha256": "cd792f72450f912486acc319ad0c78fa0a36a465562246a653a1fb26f4f8d063"
      },
      {
        "path": "src/renderer/layout/utils.rs",
        "originalSha256": "e760b4117b7846d8b697891434c1cc9b2e04fde2d4f3e7ba6db84cd56e0e9564",
        "patchedSha256": "029011793cf3b968db2f4bc15ba789ffe21c7621259553a6d80a6e2594ffa66e"
      },
      {
        "path": "src/renderer/layout/shape_layout.rs",
        "originalSha256": "90d78f9bfd3b2f4765b71d9cd1bb8b35c5c4a5a8c5faf6e02361d4ec4998476c",
        "patchedSha256": "e2867b5ad92b002b83c30f2fc0ae7b34bcaaf86aa44935900be54b43ab986f4c"
      },
      {
        "path": "src/renderer/layout/picture_footnote.rs",
        "originalSha256": "1fc5b0eeed40194b052f6d2b617f56153a38834674931139e66173dcde3d8307",
        "patchedSha256": "17a454e04115e73dc8fb8fa3deca9acfd5f25db36d3ac4cb43dc0b4d13b95b55"
      },
      {
        "path": "src/renderer/svg.rs",
        "originalSha256": "a5f10616101d31582185eaba2283aa5d44a8529d23a681096d512a1341244829",
        "patchedSha256": "bb938cb2547addd9550ed716ea2c2b682c0cda4e3817222f4390bc202cb9cabd"
      },
      {
        "path": "src/renderer/web_canvas.rs",
        "originalSha256": "f5b7188590116134e35fd6a6a3c6e615485ed6bc6615d243d7b26becce28d015",
        "patchedSha256": "17427634c6f27fc02cf4f0c3472a49f431ac421f3e5b5ea3fa3420e3a512043e"
      },
      {
        "path": "src/renderer/skia/renderer.rs",
        "originalSha256": "7966150a7905d81089bbff77a9129bce2afe490ebb7fda1628f27a91da547d66",
        "patchedSha256": "229251985833374a9c400031765b528e3a593b5ea4430343fb1cd1c2123373a0"
      },
      {
        "path": "src/renderer/pdf.rs",
        "originalSha256": "6ec2b549e020e9d3e582076beba9e571a94672635c2fc0cc1c428efa751c5ebb",
        "patchedSha256": "d676ab27503e4630644aea7365ff20532a8a1d82522da484c00a8e9c3db62504"
      },
      {
        "path": "src/paint/json.rs",
        "originalSha256": "b48086acd0590d6bc3d81cc9e182bcb5440eadf3102cdbacc003d039a9ce7ff8",
        "patchedSha256": "f98509439b6bbfc0fe8ff2dff1e0b6cd3288e774f68a864d074fd54f3385bc2b"
      },
      {
        "path": "src/paint/replay_order.rs",
        "originalSha256": "039c08946c0988302e3d8765db96f0e984207ba767eb540d28594524a9c83b01",
        "patchedSha256": "571b72bc5dd43651dfbb5207c057dcb61cc1ddf04670191949363a8d02bcf473"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-stored-page-leading-margin.patch",
    "sha256": "d077eb9b187b73ca022a24de81628df4f7af4b342869e2889cd8f68de482ba11",
    "sources": [
      {
        "path": "src/renderer/layout.rs",
        "originalSha256": "9a331572f891129fb1674d29a1db72e209285f1c6e6904498fda6e81f19c223d",
        "patchedSha256": "26c03eecc263e6194b342cfa56578933764575e4e250d37a7fa4e2c15d056cec"
      },
      {
        "path": "src/renderer/typeset/table/host_spacing.rs",
        "originalSha256": "e355cff05386365f4637dee606251d4edbdd4ca6921410b24d70a44fe2ab195c",
        "patchedSha256": "40db128cb06b48419302a10aa81637d2b0b5604e62dc6f1bd4fc6836f2e1e728"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-stored-nested-block-host.patch",
    "sha256": "2a0979c9a3859d478ae3c3b63c9e4525d0179d5676eeb3f29d4d0352f44ef8d7",
    "sources": [
      {
        "path": "src/renderer/float_placement.rs",
        "originalSha256": "fcfab96c017a160429fa9873371ea59dd6564480daaaa08ec90d87aea7e6bad3",
        "patchedSha256": "4c4fcf3bda4c32659fc701abfb1de15366ac55b789d4212adc71a871cbf28a91"
      },
      {
        "path": "src/renderer/height_measurer.rs",
        "originalSha256": "15b9761d3a5273238c533af3f6a1ddc95bffa365a03eb0e456c989914c41e3a6",
        "patchedSha256": "a44687b8bf6f8345eaa10609dfafc49417a24a0e6c9e561b39d30216f8c35f85"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-nested-declared-frame-cuts.patch",
    "sha256": "54d274f77865dc18586d6726558394a47b28bbb304d075318d61ea9ea9037d87",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "7f294df11f7dc48611cdcfbf8a7fa813763778dd9c4573cd619c06bc4c26990a",
        "patchedSha256": "d2c51ac55b1b560f7ab6c965ba0837332c7e72012e42fcaad88eaa0f99128dbf"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-mixed-block-flow-ledger.patch",
    "sha256": "fcc108afde80a59fa60b71ca4e8ed34a79f6d29f8b5a9974ec7b018d3ce03fb3",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "d2c51ac55b1b560f7ab6c965ba0837332c7e72012e42fcaad88eaa0f99128dbf",
        "patchedSha256": "7273df67a4a6a7d29d57abbeae6741ae580d30d1f5a332d8e3e1996c1cedd56a"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "cebac7b673a9c051bf31e64bcc6d2310f669b74a97bfd6351d663a9cc5b452d6",
        "patchedSha256": "3281736fc957df28d786772131ab979f2d8e2cb170f29cb7d1ee111f0c7296c0"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-stored-parallel-frame-minimum.patch",
    "sha256": "b0394a1179da73c3149587c81fd8a861b26cf8e02a0131662c6926ae5b3586a8",
    "sources": [
      {
        "path": "src/document_core/queries/cursor_rect.rs",
        "originalSha256": "c7dd6bedf24033a2e221bc7f64f7ac69592307c48821128021353696cdb80906",
        "patchedSha256": "f06dfa3e5b8047ac081d388016f1c132ab8dac8f91022d020b62313d7c556100"
      },
      {
        "path": "src/renderer/float_placement.rs",
        "originalSha256": "4c4fcf3bda4c32659fc701abfb1de15366ac55b789d4212adc71a871cbf28a91",
        "patchedSha256": "6497388714cc9d6dd5120201bd98d78e25e3d7f4221a97ac324848d16275e7f6"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "3281736fc957df28d786772131ab979f2d8e2cb170f29cb7d1ee111f0c7296c0",
        "patchedSha256": "15100f30c58776a312aaeec3502dbf708f6be0673ea9471dad315d0c7fd15dd6"
      },
      {
        "path": "src/renderer/layout.rs",
        "originalSha256": "26c03eecc263e6194b342cfa56578933764575e4e250d37a7fa4e2c15d056cec",
        "patchedSha256": "0f1196586d011502245c146900c2f56b250adc3cddeea41c371e068ee8017bfb"
      },
      {
        "path": "src/renderer/page_number.rs",
        "originalSha256": "8a68e8c4ea7188b88621a507c8850314cf029a6963e98e48e83ccc612a76f622",
        "patchedSha256": "e634c07130f6150dfd5e040e77dfa51382dc37ae61f9798c9d9268697c3ac736"
      },
      {
        "path": "src/renderer/pagination/engine.rs",
        "originalSha256": "648bb6b1f456c432267729629abb0ab6d8aadb0c06af54a680697209a9914798",
        "patchedSha256": "8eb38aa73f6a03fd85c66e78a21dee9f7d42fe4c04a460ef1150a8f947586c6c"
      },
      {
        "path": "src/renderer/pagination.rs",
        "originalSha256": "5cb310985eff61c1e25ec44bfe8ba1aec64aee2fab040b6b68e4e387f9be9efc",
        "patchedSha256": "aad3565c2fd753ba4b85d05945c1ebf56950452a221b84483c7cafa63991b58a"
      },
      {
        "path": "src/renderer/typeset/notes/endnotes/measure.rs",
        "originalSha256": "013aac8efed71fca6e9d98472b3f583d836091fb981d19e002969ba67cca8f72",
        "patchedSha256": "81772e430c9b601e543826548ecd34e8031f479125c8021290a14ffd632f64b7"
      },
      {
        "path": "src/renderer/typeset/table/continuation/fragment/emit.rs",
        "originalSha256": "e5f43e605cfde6bd92a2e4f6ed1b9df9383b16b3f24332a55277ac4325958798",
        "patchedSha256": "f6ed29c256c3d3c03862fa7507d75ede620a56a6dc0c09d27aaa31a6bea71caa"
      },
      {
        "path": "src/renderer/typeset.rs",
        "originalSha256": "1a46e4655e19c95083dd7e5501224e5ca73d9d3dd54d0ecc1341b4fa51bfdac7",
        "patchedSha256": "667f6f0c7dc48153110dff0936a266cdeb396084267b9dad22b0430cf5eba563"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-page-number-source-activation.patch",
    "sha256": "e5e48d8cbaf5e282a68fa99d046e15ca30051bf635e3c71b0fdfc13bb82c4258",
    "sources": [
      {
        "path": "src/document_core/queries/rendering.rs",
        "originalSha256": "402701bb1510cd62607a91e49b6a2ed4aed389a911a388eda68bddebc9d358a5",
        "patchedSha256": "4ef70108d1d4e6d78ae48c4fe4cb390828ee031d8faabf68ba7e8089e0fda9c9"
      },
      {
        "path": "src/renderer/page_number.rs",
        "originalSha256": "e634c07130f6150dfd5e040e77dfa51382dc37ae61f9798c9d9268697c3ac736",
        "patchedSha256": "44d72c36fd4706785975ccf38e165f52ae56ce9bbc6fc31a3f0bb990b294757f"
      },
      {
        "path": "src/renderer/pagination/engine.rs",
        "originalSha256": "8eb38aa73f6a03fd85c66e78a21dee9f7d42fe4c04a460ef1150a8f947586c6c",
        "patchedSha256": "76488e910b67f26eb8ce2db739d2fb4ada1a38aac601fa0ef058ffa1c0515287"
      },
      {
        "path": "src/renderer/typeset/state/finalize.rs",
        "originalSha256": "0d67cb7130bfa14a7ada13ead38650c4044fce1c2831c4c23605925b183015c5",
        "patchedSha256": "de76f5d9b7828d0be9890f5e3db8e3b923ad357963ea70c059dec5d2219351ad"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-stored-nested-float-frames.patch",
    "sha256": "14fc7771b6a7ffd862d3853ce44b5d427019cc445d87eb6c175077f90a4ffb9e",
    "sources": [
      {
        "path": "src/renderer/float_placement.rs",
        "originalSha256": "6497388714cc9d6dd5120201bd98d78e25e3d7f4221a97ac324848d16275e7f6",
        "patchedSha256": "557e4097cf3fcfda6ba7c83b0c396f68e4a7ec7c7c9a6ad40e1a323113a7f37e"
      },
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "7273df67a4a6a7d29d57abbeae6741ae580d30d1f5a332d8e3e1996c1cedd56a",
        "patchedSha256": "00479e71cdcf77616cb0093ced9e12e0970877024fcd0f127e079607b77bfa0f"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "15100f30c58776a312aaeec3502dbf708f6be0673ea9471dad315d0c7fd15dd6",
        "patchedSha256": "899e431e7d658764c93f906c0518e8f9e4b3fa38429808893c1b7478b9dfea8a"
      },
      {
        "path": "src/renderer/typeset/table/continuation/fragment/budget.rs",
        "originalSha256": "6ce6b23311868330901388a1c70d8828ea7af563b5516b72db43ac16fba1b878",
        "patchedSha256": "5df5675ab7aca00bdb85e08f32f16745115f70c2a2ab6fdd1c49cae1677bba82"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-stored-nested-tail-owner.patch",
    "sha256": "18d2ca25031520b2740f66c9cbac8eb571c2eabd3b91c8f42e72d953630900d4",
    "sources": [
      {
        "path": "src/document_core/commands/object_ops/picture.rs",
        "originalSha256": "d5d3f7ea45606c98ab2f0a4325aacac6a3ed9b8d3d2cb09532d1c2c04063150f",
        "patchedSha256": "659722459d2bceefd2331d9fe4fe9d8acff0e2b738d59c5178f8c238a9551b2a"
      },
      {
        "path": "src/document_core/commands/object_ops/table.rs",
        "originalSha256": "8629dbb139574d96bdd6287c7781f9d01cf3ff962c1fc42656e75aa2550dfc12",
        "patchedSha256": "a51bcb772d1d33afad1cbed097c2024094e763017c9b1bfd99e37708d7892772"
      },
      {
        "path": "src/document_core/queries/rendering.rs",
        "originalSha256": "4ef70108d1d4e6d78ae48c4fe4cb390828ee031d8faabf68ba7e8089e0fda9c9",
        "patchedSha256": "e0b3ae18e8a30e6650f791c5c42b7bfb2d42666f0b8372431e9150e27a15b645"
      },
      {
        "path": "src/renderer/layout.rs",
        "originalSha256": "0f1196586d011502245c146900c2f56b250adc3cddeea41c371e068ee8017bfb",
        "patchedSha256": "d730cfbd7b5e0c45f65c76b1652dad477e767d104e7c382952377ffd7b5202e2"
      },
      {
        "path": "src/renderer/render_normalization.rs",
        "originalSha256": "50f636d7949631898cdbe33b894acdd1090edf85fddfb3665bc450b90b9a5e9f",
        "patchedSha256": "f60b849cb6d6c9b95a84dbec5b36eab2c29581b964fb3f442eda17b72499a4aa"
      },
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "00479e71cdcf77616cb0093ced9e12e0970877024fcd0f127e079607b77bfa0f",
        "patchedSha256": "58b077be613178a52be82f384a5d164bdf5a2c10636592fb25e141ef456995cc"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "899e431e7d658764c93f906c0518e8f9e4b3fa38429808893c1b7478b9dfea8a",
        "patchedSha256": "1947802fa680e582f1d8c3306d08d8876926faa4ca3859d83b609bd701f0bd5b"
      },
      {
        "path": "src/renderer/typeset/table/scan/source_frame.rs",
        "originalSha256": "7dd183ea3b131f1be5e6c5bbc78688c51f92eb79821efc2c1ba026df15ef5ed3",
        "patchedSha256": "88a2b0afe7527179ca4b65bcbbe39ad77085c9e1bbb86e8f8bd55ee9de2e612e"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-nested-forward-frame-ownership.patch",
    "sha256": "3ddfc7823422697f17643d92be9c53dd852d4c63db4d7d9aef1bdcec4896a60d",
    "sources": [
      {
        "path": "src/diagnostics/ir_field_sweep.rs",
        "originalSha256": "91e4a10a4260d7b8b41927da31037094beb62e9dd5ca4ad60f4720e3cbc25769",
        "patchedSha256": "1aa743f35d8c76ca2ffb765f3ace294e2e62d654ee1337e6c2c7a65f9205f04c"
      },
      {
        "path": "src/model/mod.rs",
        "originalSha256": "e67c61ebf2d9805879960bf104684b1e0da656b889b48168bb9ee5c657eb5127",
        "patchedSha256": "95ac7d56ba61cce397905257cc9c624a43654be29837858c1bf3a4eb9fb253c0"
      },
      {
        "path": "src/model/paragraph.rs",
        "originalSha256": "81597b84b0bb5420c8fdd17a4f075a70ecdaec59b4e7cb9392338a0abcb0aa18",
        "patchedSha256": "9f2d4cf4558922bb259815cd3b14a2ee6271ed153283336190f685571a130ec4"
      },
      {
        "path": "src/model/source_layout_history.rs",
        "originalSha256": null,
        "patchedSha256": "08dc313d8e1cf65e1c9a6937e3b611cf4ebc83f787e99c1b5c60c88edf50053d"
      },
      {
        "path": "src/parser/hwpx/mod.rs",
        "originalSha256": "25933d7891a1ad8103df385e91c37e78d5de042d167fddb8d1d57a88edcf4d81",
        "patchedSha256": "2cae589e622d9af2d3eecdfa06b35511a90a340887ca6512ff2e5e0ed7e71935"
      },
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "58b077be613178a52be82f384a5d164bdf5a2c10636592fb25e141ef456995cc",
        "patchedSha256": "6f0f869cb242025adddaf649841fe41451b6fe1f5ab30d7b7e73fd1d2dbe0b1e"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "1947802fa680e582f1d8c3306d08d8876926faa4ca3859d83b609bd701f0bd5b",
        "patchedSha256": "adec882ae2033aa0db5f0b374d6a7d51a4ce9acdbd1b894aab971a7dad15cfc2"
      },
      {
        "path": "src/renderer/typeset/table/continuation/fragment/emit.rs",
        "originalSha256": "f6ed29c256c3d3c03862fa7507d75ede620a56a6dc0c09d27aaa31a6bea71caa",
        "patchedSha256": "05c5d864ddae3bbd7a8d3043ad41355ee900afee6b031f5030158e2742cb5766"
      },
      {
        "path": "src/renderer/typeset/table/continuation/fragment/scan.rs",
        "originalSha256": "29392e51e08f3bac33f8eb97df5729a974d21a31d3b54b0f1247865bcd07cd6d",
        "patchedSha256": "ff8815ec77b1cc74f7a04cbb140a8f663d9df5d8bc00be014b5a99b086d64547"
      },
      {
        "path": "src/renderer/typeset/table/scan/runner/block_step.rs",
        "originalSha256": "608ab1b48b1c35846d827d3ce49a35d1af69c7a87076532ce74acf05f03a7160",
        "patchedSha256": "d6a7b744f2af3c12dabc78e60b4b3b595c84202b462702f2bfb555beab5d52ed"
      },
      {
        "path": "src/renderer/typeset/table/scan/runner/row_step.rs",
        "originalSha256": "f6ba47d29ff094655bfd2e214dbcd4c90f2e941b436f2345876755bef7ba8636",
        "patchedSha256": "63cf121e427a4f8a5a76395a6366fe21d95f6e4c1f31345c6a7952bb190f2693"
      },
      {
        "path": "src/renderer/typeset/table/scan/types.rs",
        "originalSha256": "5175948a57d37fab2fc99ba83de3b1fd08134eda0ff5e2f1f208a912c02c346c",
        "patchedSha256": "4a82fd31b6b057f21a2448967a518dee5d185ed3554c9c458f0d2006dffda861"
      },
      {
        "path": "src/serializer/hwpx/mod.rs",
        "originalSha256": "02672436020f06200e1cf99b7775dea00d5fc796ab65db4728c5bdb2c17afee0",
        "patchedSha256": "a229497d2ff10f2adaca6b72faa7a413e4ab4bbdb681eb39ba53bafe8172a0c4"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-authenticated-float-projection.patch",
    "sha256": "ed1ddf6ccc1fc28a0990773179d799a378f72ed9432851bc7c185b6cc0695dab",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "6f0f869cb242025adddaf649841fe41451b6fe1f5ab30d7b7e73fd1d2dbe0b1e",
        "patchedSha256": "ac249c0b3d003e3b9b420a951ebd3c0c435febe0924bcd8db9940ae62e873c43"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-cell-caret-fragment-geometry.patch",
    "sha256": "92f24dc1d995c9f833c5ddaefa3b1b52f5afb0e215dda65e4dfeb0caa02bfdae",
    "sources": [
      {
        "path": "src/document_core/queries/cursor_rect.rs",
        "originalSha256": "f06dfa3e5b8047ac081d388016f1c132ab8dac8f91022d020b62313d7c556100",
        "patchedSha256": "6660adb8b23dc5fd0941e211cd150e6b3912fd96ace55c5a35b276e8455ce27f"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-scoped-table-height-and-bbox-query.patch",
    "sha256": "a9e0ab37b35672f2c0c5ce2b126b47ea7e44c870924c3c91e4f77756a09bd313",
    "sources": [
      {
        "path": "src/document_core/queries/cursor_rect.rs",
        "originalSha256": "6660adb8b23dc5fd0941e211cd150e6b3912fd96ace55c5a35b276e8455ce27f",
        "patchedSha256": "9b27bebb475069f6eba68babc6b5b28d547d22d35079077f2789c059d156e661"
      },
      {
        "path": "src/document_core/commands/object_ops/table.rs",
        "originalSha256": "a51bcb772d1d33afad1cbed097c2024094e763017c9b1bfd99e37708d7892772",
        "patchedSha256": "42aab9a7ff095507e23f3329017fced03c060497a68860ca5277ccce83d846cc"
      },
      {
        "path": "src/document_core/commands/table_ops.rs",
        "originalSha256": "200390b3e6245a7216bc47eca1c3f64f7ef9b06b0d3110fc77dc62800cca53c7",
        "patchedSha256": "efea4ac784307f3d33d8ddcc252e2da91996001fad378a7da5cec8894de8d2c4"
      },
      {
        "path": "src/document_core/queries/rendering.rs",
        "originalSha256": "e0b3ae18e8a30e6650f791c5c42b7bfb2d42666f0b8372431e9150e27a15b645",
        "patchedSha256": "1ac9314f99b2b735a9fe0c7f81e7ca0c69baef99abf844fe98f9209844f955a9"
      },
      {
        "path": "src/renderer/height_measurer.rs",
        "originalSha256": "a44687b8bf6f8345eaa10609dfafc49417a24a0e6c9e561b39d30216f8c35f85",
        "patchedSha256": "5211e582a59efe1d87384a1a44711851d40226e60785bb73ab10c7e8f1762eb7"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-glyph-caret-metrics.patch",
    "sha256": "b58a6e2a78e9a4d19ef9ba5ab2c90c6fbea4d5000735fec79c1906ca31051655",
    "sources": [
      {
        "path": "src/document_core/queries/cursor_rect.rs",
        "originalSha256": "9b27bebb475069f6eba68babc6b5b28d547d22d35079077f2789c059d156e661",
        "patchedSha256": "f352654d9627509e4d01d0266ae9c74dcae42628b7cd244ef4e8accc2ea3f58a"
      },
      {
        "path": "src/document_core/queries/cursor_nav.rs",
        "originalSha256": "e13fa4105788aefa8a0f85f3bfd041ed8648517d7207bca128637dbadb71f46f",
        "patchedSha256": "ee5523fc4bb6faea89f50a0fd17c7a791747a481d5f21d548a39d9dc651bfdc8"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-stored-inline-frame-projection.patch",
    "sha256": "1abf21092c32d790eed46d7c9995203646bf75b7735818ce3364e24d75cc1ba8",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "ac249c0b3d003e3b9b420a951ebd3c0c435febe0924bcd8db9940ae62e873c43",
        "patchedSha256": "94f932122b935f14f91f24c91b0c2466667539e84652f82b988d4527d8af35c7"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-nested-repeated-header-reservation.patch",
    "sha256": "fb2d28bbf748a56fd744813e9110bfe45a63304a199806d89dbc313151779625",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "94f932122b935f14f91f24c91b0c2466667539e84652f82b988d4527d8af35c7",
        "patchedSha256": "1ba23fed53ee4fecf5f19e31d580e2c711646283e0288f3852fbf6518776f1f7"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-anchored-block-source-order.patch",
    "sha256": "df71650567c8ca764fcf243ce4f6031b306d6ef160543f70da38f910b88e112a",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "1ba23fed53ee4fecf5f19e31d580e2c711646283e0288f3852fbf6518776f1f7",
        "patchedSha256": "418dbde796b3129bf1c8a90b4c76c1435d8ac7f1ea096446862ad441907baa1c"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-scoped-cell-text-history.patch",
    "sha256": "866b9aa2cf2dcf434ee2ad5185fae94fe2d6343b00cc2dfd770f2f59b825e42f",
    "sources": [
      {
        "path": "src/document_core/commands/delete_fragment.rs",
        "originalSha256": "c9012e5fab887ca7684f77710e4c58f71fe9814488da2b26fa62fe7dfb0e1555",
        "patchedSha256": "9f40899a8fd8ccae0eba03853ab682c7c0361935267d5e4691173efeec3da35a"
      },
      {
        "path": "src/wasm_api.rs",
        "originalSha256": "850357a5a4557b51ddaeac8f3ba59fbca561bcd9293ad7110daf31b5f471b23b",
        "patchedSha256": "67ba646b399ada1585b380ae62dc28eac75df7458aca6f405989add654693244"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-parallel-row-page-edge.patch",
    "sha256": "9ddc2d5c813603703b3f3252da71bb00b8c380c545cdfce0683439e456b58f5f",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "418dbde796b3129bf1c8a90b4c76c1435d8ac7f1ea096446862ad441907baa1c",
        "patchedSha256": "5ee6e1eb68117b654e7f4d50660c09372bca7087f9c114bc1b84b1d82cd305cc"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-parallel-row-continuations.patch",
    "sha256": "928eac0fd0b1d1743dd07365bb17d5644c58d55ab3cbe646e843c0ae7cc2f835",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "5ee6e1eb68117b654e7f4d50660c09372bca7087f9c114bc1b84b1d82cd305cc",
        "patchedSha256": "7d627cf017fe74d0326b8657d9ae930c6be1726ceb8e3c891788dd0657f661e2"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-row-frame-finished-cells.patch",
    "sha256": "646e47d209bd5f734ebbff07170643d148f83c8be059ad5c733e14b3398f40ad",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "7d627cf017fe74d0326b8657d9ae930c6be1726ceb8e3c891788dd0657f661e2",
        "patchedSha256": "3e1c5a02bce8f704e781114b16997425fdaad93451bb2759feb6f99eb6108e66"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-nested-inline-projected-opening-owner.patch",
    "sha256": "e4cb85e2e8b8796b84d5ccd9109f7f7ed1e4fbee82cc798a076b26ff2e3164c9",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "3e1c5a02bce8f704e781114b16997425fdaad93451bb2759feb6f99eb6108e66",
        "patchedSha256": "769c3821a95fd52e9c89f25fac434c52c7e8eb6f9ecac9a7ca24390d8cc6a3e1"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-displaced-nested-table-line.patch",
    "sha256": "b2a273a07dc1fc693fc5b49b40d3e5a66ee0805bde3cfabe36b7fa833b0bdf87",
    "sources": [
      {
        "path": "src/renderer/float_placement.rs",
        "originalSha256": "557e4097cf3fcfda6ba7c83b0c396f68e4a7ec7c7c9a6ad40e1a323113a7f37e",
        "patchedSha256": "d6a1822347ebc9a905bae2bc0bb090f86eb9f35f0c336a7a70ebce7bad7fde51"
      },
      {
        "path": "src/renderer/height_measurer.rs",
        "originalSha256": "5211e582a59efe1d87384a1a44711851d40226e60785bb73ab10c7e8f1762eb7",
        "patchedSha256": "3c737e13d8e0a5283d2fa2fe131ccdc6e4cfe8828f9f62339e4aa6f9269cc2af"
      },
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "769c3821a95fd52e9c89f25fac434c52c7e8eb6f9ecac9a7ca24390d8cc6a3e1",
        "patchedSha256": "5a8a386c8596dcef6d3a655806694e288dfadf80efbd8e8406c5962e1615b1fa"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-parallel-picture-band.patch",
    "sha256": "d642d650b0742841cbbf95bb8392d50ce35c9d64c8da9a3543c2036769d44551",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "5a8a386c8596dcef6d3a655806694e288dfadf80efbd8e8406c5962e1615b1fa",
        "patchedSha256": "603f3cfe1cf045f796b14af4ff55d1907bb37f7e43ef4328198cc0b1e2780331"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "adec882ae2033aa0db5f0b374d6a7d51a4ce9acdbd1b894aab971a7dad15cfc2",
        "patchedSha256": "9d2f71a30645cdc2ec33dd0b1ffcd98fbc35f48245c66b6db42f2a0a366dd4a0"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-stored-picture-opening-frame.patch",
    "sha256": "985abf211b2ad135aae1467aaaef18f316b6744adb5f18915036e1fbcdeafeda",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "603f3cfe1cf045f796b14af4ff55d1907bb37f7e43ef4328198cc0b1e2780331",
        "patchedSha256": "eec2b65ed837d095f6c0d2748b7fe2ab4316bf9c4141109b621f737b9e1104b7"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "9d2f71a30645cdc2ec33dd0b1ffcd98fbc35f48245c66b6db42f2a0a366dd4a0",
        "patchedSha256": "772278faa53c45a2ce6c4cb2244c7783b31cee91794f205e4a40f70a7347b062"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-stored-plain-tail-frame.patch",
    "sha256": "a66131b78baf873a51b6e347583b775b7c4bc45a2c71b08becddcf72c8e3b304",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "eec2b65ed837d095f6c0d2748b7fe2ab4316bf9c4141109b621f737b9e1104b7",
        "patchedSha256": "9eaf76fa16133b9df7a6601917e3b505e9ccec179b66581b40863f0550ef3dec"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-resumed-nested-successor.patch",
    "sha256": "11aa896bc66d870604b318733bf5126353cf9a73ff4a16ca961341d33bd3c714",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "9eaf76fa16133b9df7a6601917e3b505e9ccec179b66581b40863f0550ef3dec",
        "patchedSha256": "f5c35d3ce4d2ba53ec7fbf05bfd1adaedc1840604cb8c8a05d937ec41b588dce"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "772278faa53c45a2ce6c4cb2244c7783b31cee91794f205e4a40f70a7347b062",
        "patchedSha256": "9cc5d41ff68019280d29e0c7d7d18cb014d66b2da8d94ab1308c384242827e61"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-resumed-nested-left-anchor.patch",
    "sha256": "b48bc19f9f845a76b86ba2635324d92e13484f8df9d514abf44f0760ae7e7025",
    "sources": [
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "9cc5d41ff68019280d29e0c7d7d18cb014d66b2da8d94ab1308c384242827e61",
        "patchedSha256": "98fd0b94cd8eb2284bae24f79175dd6e4b957ff0c3c350614ead9553307f4883"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-confirmed-row-frame-reservation.patch",
    "sha256": "a70f12a766f2319aab520d5a2492e78d88a3750d7185fb52fb4700d6b0d24ebf",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "f5c35d3ce4d2ba53ec7fbf05bfd1adaedc1840604cb8c8a05d937ec41b588dce",
        "patchedSha256": "a9729e046eed15e3596a0eb146aca64729a76633cb9fe907f3dc3d7ae63f5445"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "98fd0b94cd8eb2284bae24f79175dd6e4b957ff0c3c350614ead9553307f4883",
        "patchedSha256": "da4fcebbf1de878cc8e05cfcbf12f50009c6fc2a608519c503af40cda3e35302"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-stored-nested-row-geometry.patch",
    "sha256": "59ca59ba63927dd3d0ddb4054c6fee66d1aa8961fc83b5ff96134f6822f85a41",
    "sources": [
      {
        "path": "src/renderer/float_placement.rs",
        "originalSha256": "d6a1822347ebc9a905bae2bc0bb090f86eb9f35f0c336a7a70ebce7bad7fde51",
        "patchedSha256": "abc36feaae8f5b235518a2df2781c8d18b4fb44a3cfff1fff9d17d9700b52471"
      },
      {
        "path": "src/renderer/height_measurer.rs",
        "originalSha256": "3c737e13d8e0a5283d2fa2fe131ccdc6e4cfe8828f9f62339e4aa6f9269cc2af",
        "patchedSha256": "a35d2c1d41d98622a2d7e0a0007722885191116481b8e7e6e7f1382b6da8238f"
      },
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "a9729e046eed15e3596a0eb146aca64729a76633cb9fe907f3dc3d7ae63f5445",
        "patchedSha256": "59e749330f41241970322aad23932f792206d69f3fefb0692f21ff2b8f6866a8"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-nested-rowspan-opening.patch",
    "sha256": "1498f7be2e8dae79fa362af8e8d0c4b494c9284f020b7e1137eeafbec41ad06f",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "59e749330f41241970322aad23932f792206d69f3fefb0692f21ff2b8f6866a8",
        "patchedSha256": "0bacd5d4fdd3f3c256493db5ac557536b35e1f88dfd7e52a388b81edb970ab29"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "da4fcebbf1de878cc8e05cfcbf12f50009c6fc2a608519c503af40cda3e35302",
        "patchedSha256": "0d26ee5559de7cadbe2a36114357cf6677028bc9b2b8ce50b52f516c42f88375"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-nested-table-frame-ledger.patch",
    "sha256": "70548b65711346a5b7673c80cc58d23cf185c06aef2db4fa5ab2127cf88895b6",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "0bacd5d4fdd3f3c256493db5ac557536b35e1f88dfd7e52a388b81edb970ab29",
        "patchedSha256": "d0daf4bea74bcf88ebf4279e96c7f44211662e935002fe0221cff73d7465c159"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "0d26ee5559de7cadbe2a36114357cf6677028bc9b2b8ce50b52f516c42f88375",
        "patchedSha256": "d3011655cc7f70aede96e945e112582d0dac3b0f25638e5a060976c9bb84d6c3"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-nested-terminal-frame-continuation.patch",
    "sha256": "8240004182b8cee4b6e2ef2f8963f99036ba03401c3f780b90bf0b41e648ade7",
    "sources": [
      {
        "path": "src/document_core/queries/cursor_rect.rs",
        "originalSha256": "f352654d9627509e4d01d0266ae9c74dcae42628b7cd244ef4e8accc2ea3f58a",
        "patchedSha256": "e7597fd66bc4190b5bdeb3f8bc3cd1430819cb0a3790c55a1794d1969e283ce0"
      },
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "d0daf4bea74bcf88ebf4279e96c7f44211662e935002fe0221cff73d7465c159",
        "patchedSha256": "40f86518e8046884de2465a5a71c5880d57ea10303c339452f8e82cca57c79e3"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "d3011655cc7f70aede96e945e112582d0dac3b0f25638e5a060976c9bb84d6c3",
        "patchedSha256": "035631be2bf75329fd9bec03aea75307925615073aff3e4b6df3e11e7c83f4f8"
      },
      {
        "path": "src/renderer/layout.rs",
        "originalSha256": "d730cfbd7b5e0c45f65c76b1652dad477e767d104e7c382952377ffd7b5202e2",
        "patchedSha256": "c6bcf99a357b88d08108aa9f2abdf96ae4a95ae42afb8bbf9b8ab874aca7e1b5"
      },
      {
        "path": "src/renderer/page_number.rs",
        "originalSha256": "44d72c36fd4706785975ccf38e165f52ae56ce9bbc6fc31a3f0bb990b294757f",
        "patchedSha256": "e5270fd8da9a932b4a5f529b1a5d5bc5ca4002756754890e1f983b2775efc55a"
      },
      {
        "path": "src/renderer/pagination/engine.rs",
        "originalSha256": "76488e910b67f26eb8ce2db739d2fb4ada1a38aac601fa0ef058ffa1c0515287",
        "patchedSha256": "9c5b1048292b69da991965ee1d7953c80eab671ab7421fa4cc0bfbc4dcd6fb10"
      },
      {
        "path": "src/renderer/pagination.rs",
        "originalSha256": "aad3565c2fd753ba4b85d05945c1ebf56950452a221b84483c7cafa63991b58a",
        "patchedSha256": "80d2b036e8cda5a433960ddef1a918a45256e6b77da80221d7badbe6f8cbfe33"
      },
      {
        "path": "src/renderer/typeset/notes/endnotes/measure.rs",
        "originalSha256": "81772e430c9b601e543826548ecd34e8031f479125c8021290a14ffd632f64b7",
        "patchedSha256": "e896b0cecf88894e622a786796d620ecc418446f92a69e499aaad4c613f6ed38"
      },
      {
        "path": "src/renderer/typeset/table/continuation/fragment/emit.rs",
        "originalSha256": "05c5d864ddae3bbd7a8d3043ad41355ee900afee6b031f5030158e2742cb5766",
        "patchedSha256": "72f2657946bd04286e1f0b037c1f0067e5d0093de54caeb2e5142aa7bb826f6e"
      },
      {
        "path": "src/renderer/typeset/table/continuation/fragment.rs",
        "originalSha256": "bb1323c57e20b738cce22974c3c065fe52fca8ee168ae01c93aa671aa03824d5",
        "patchedSha256": "5d7b4dca9d556970bf836b539bba9844361f83af777c95abfbebbf80b149df2d"
      },
      {
        "path": "src/renderer/typeset/table/continuation.rs",
        "originalSha256": "a1079a3446f1297fcbbd0184cfea6f6446feab30fd6d40830ddcf094b3e7e295",
        "patchedSha256": "ac0e00a837feced472c1571d5ac28c199dfaed3b3d0f281a871965303e7e1c4f"
      },
      {
        "path": "src/renderer/typeset.rs",
        "originalSha256": "667f6f0c7dc48153110dff0936a266cdeb396084267b9dad22b0430cf5eba563",
        "patchedSha256": "d1ff98808886a577789458d136fe0ee33447d494bd2639a0c1a5b0b6e9809333"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-original-inline-object-line.patch",
    "sha256": "5eb887b46ce204b6a87f95a40a58a7338aa44d7b66759a1451fd3cc349b26c4f",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "40f86518e8046884de2465a5a71c5880d57ea10303c339452f8e82cca57c79e3",
        "patchedSha256": "942b1c2536a7e56c1335222469cd551db0691b220ac0f0ecdb5748d90f594b9a"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "035631be2bf75329fd9bec03aea75307925615073aff3e4b6df3e11e7c83f4f8",
        "patchedSha256": "31476624966840e71a50de3619fbe9a5a9be54ba92849e9898cc6dc71db0b7c8"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-nested-original-text-restart.patch",
    "sha256": "ec5155b257b66a222ae6ed650763a4ba55f6f1988d3d70686fb070ce5e5e393b",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "942b1c2536a7e56c1335222469cd551db0691b220ac0f0ecdb5748d90f594b9a",
        "patchedSha256": "744d4929bc4cbc510cc04339b73051acd0eab0216916d4e9926b683579a21398"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "31476624966840e71a50de3619fbe9a5a9be54ba92849e9898cc6dc71db0b7c8",
        "patchedSha256": "4bce69280526e118e40c4a97b7f06c8d89afd7bc3a665aef039dc1973cc2bd24"
      },
      {
        "path": "src/renderer/pagination.rs",
        "originalSha256": "80d2b036e8cda5a433960ddef1a918a45256e6b77da80221d7badbe6f8cbfe33",
        "patchedSha256": "2416e94193e330d26d64668ae0100df62793b8d0a097bde3626a2211e2bc345e"
      },
      {
        "path": "src/renderer/typeset/table/continuation/fragment/emit.rs",
        "originalSha256": "72f2657946bd04286e1f0b037c1f0067e5d0093de54caeb2e5142aa7bb826f6e",
        "patchedSha256": "a467c103c6a9d255c5f27bdb26cc5482d8ff96a72e4987d3ec6609697195f6ec"
      },
      {
        "path": "src/renderer/typeset/table/continuation/fragment.rs",
        "originalSha256": "5d7b4dca9d556970bf836b539bba9844361f83af777c95abfbebbf80b149df2d",
        "patchedSha256": "e09d8a471ef635b5a7336ff2d27feb2cb8792c60bd19fb7b4bc7aa052aef2416"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-nested-restart-frame-ownership.patch",
    "sha256": "14cf35511f44b09f75d2d5d00b7c61f4291dbdfc86349ae8ceae25329478fc24",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "744d4929bc4cbc510cc04339b73051acd0eab0216916d4e9926b683579a21398",
        "patchedSha256": "011c47e076bae1c01a9ad1715fd6cec3856f8b2b6e2e97ecfb8df5bdb85a11a5"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "4bce69280526e118e40c4a97b7f06c8d89afd7bc3a665aef039dc1973cc2bd24",
        "patchedSha256": "514e8440f47b39363282d636dcd7774134571ad79753637e7c54d95615f9b07b"
      },
      {
        "path": "src/renderer/typeset/table/continuation/fragment/emit.rs",
        "originalSha256": "a467c103c6a9d255c5f27bdb26cc5482d8ff96a72e4987d3ec6609697195f6ec",
        "patchedSha256": "49209ea9fa00f80d22dffc06227d139ed90d62b7e8650439791fa701b9e4b669"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-closed-inline-row-ownership.patch",
    "sha256": "094fc7b181f69715d9bc39df3461e566083f71a595bfdc879e28da1487cf6c11",
    "sources": [
      {
        "path": "src/renderer/float_placement.rs",
        "originalSha256": "abc36feaae8f5b235518a2df2781c8d18b4fb44a3cfff1fff9d17d9700b52471",
        "patchedSha256": "9e7989a1ef39834038ffc88c5aea733d9e20ce9e736cb1d86935f98aad672ac7"
      },
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "011c47e076bae1c01a9ad1715fd6cec3856f8b2b6e2e97ecfb8df5bdb85a11a5",
        "patchedSha256": "45a628028dbfb71ffa878c9a1bbd89cb0988a5444f932570953a518f8c947048"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "514e8440f47b39363282d636dcd7774134571ad79753637e7c54d95615f9b07b",
        "patchedSha256": "f62c28fac5b274e99995398d3e7fd44584a8355ac88599832a4a33541f90d669"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-anchored-float-restart-frame.patch",
    "sha256": "cd039b8c239a97ad4f1098b750b727ae734935f91a6e465537722255291178b3",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "45a628028dbfb71ffa878c9a1bbd89cb0988a5444f932570953a518f8c947048",
        "patchedSha256": "7971b51f648161c3b3bdfcb93d09d5c3d2effcbd3396fcedbcc1c839a315d08d"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "f62c28fac5b274e99995398d3e7fd44584a8355ac88599832a4a33541f90d669",
        "patchedSha256": "b20694f6d7b48113891711463caf4b8944dfbeff8590065ebffdcee8aedc73f7"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-plain-leaf-source-frame.patch",
    "sha256": "a7ceecde3897be5720c95782a4cd298c85636500b52d780a34d4dad903a0dfec",
    "sources": [
      {
        "path": "src/renderer/float_placement.rs",
        "originalSha256": "9e7989a1ef39834038ffc88c5aea733d9e20ce9e736cb1d86935f98aad672ac7",
        "patchedSha256": "9baca63ba3fe6c6b06a9a7221047a0bfff3b422c4d32732ec91a0a2c3989f494"
      },
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "7971b51f648161c3b3bdfcb93d09d5c3d2effcbd3396fcedbcc1c839a315d08d",
        "patchedSha256": "2018cc0923ae9ee519b5d2334bcff5b53e23b4abc969e89f5dca643d78abdd08"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "b20694f6d7b48113891711463caf4b8944dfbeff8590065ebffdcee8aedc73f7",
        "patchedSha256": "0e110d968e90cb303f9db5d1f43d2f6f104ac82e7d45943eef45e05ac06c3f13"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-parallel-plain-source-restart.patch",
    "sha256": "12a29d8187f241f0965bbe1551c7066385aff7e7a051f90823dde7427c7afd5c",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "2018cc0923ae9ee519b5d2334bcff5b53e23b4abc969e89f5dca643d78abdd08",
        "patchedSha256": "d744482617120562a2b0506ac39de9ecf633adef283b7ed74bdcc1517396e986"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "0e110d968e90cb303f9db5d1f43d2f6f104ac82e7d45943eef45e05ac06c3f13",
        "patchedSha256": "7704f6adeecdde001bb9f290e481bda1bd89fedb4c8c2ed8576e353f8aff91a9"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-closed-object-row-frame.patch",
    "sha256": "7c735c848a142192dccb0a03d6af9534406e019d164a6a414139ab2e3c71acdc",
    "sources": [
      {
        "path": "src/renderer/float_placement.rs",
        "originalSha256": "9baca63ba3fe6c6b06a9a7221047a0bfff3b422c4d32732ec91a0a2c3989f494",
        "patchedSha256": "5a190794d8bb6ce6059acb2804f9afac0db358d78c9977fbd3d44f105600ecaa"
      },
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "d744482617120562a2b0506ac39de9ecf633adef283b7ed74bdcc1517396e986",
        "patchedSha256": "ed2ffd832daaa5d3ce759ca16a86c08531698effcfcdd4aef3460dbd763bff47"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-terminal-nested-row-prefix.patch",
    "sha256": "fef5619b422b29e9a0026417d07158902a85ceaaf202a528df8cd0d9040cfff9",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "ed2ffd832daaa5d3ce759ca16a86c08531698effcfcdd4aef3460dbd763bff47",
        "patchedSha256": "f399700d47d04bdf9af06bd763cd10496a8f23128309898a8096263e03a2f040"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "7704f6adeecdde001bb9f290e481bda1bd89fedb4c8c2ed8576e353f8aff91a9",
        "patchedSha256": "c38eea074eefa33d166669bd54d9a2ba61137a8ceab6dc296506e2971158a3c3"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-anchored-opening-zone-visibility.patch",
    "sha256": "0f528a25fdb425654304f590f64ae05373f34713ff3a2c7a3f8f63ee669b19ae",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "f399700d47d04bdf9af06bd763cd10496a8f23128309898a8096263e03a2f040",
        "patchedSha256": "ea9a5b240094d5c91c4ab2451833d48b056aa82ada5cc9e0cea696ebf93d8095"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "c38eea074eefa33d166669bd54d9a2ba61137a8ceab6dc296506e2971158a3c3",
        "patchedSha256": "d393bf4e82cb9ad92151960241ffdb53c6e8c113eb9af0d9f7dff025e8d5fc14"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-declared-row-fragment-balance.patch",
    "sha256": "187f58f75dc988395786170eb98d7f1f1db6ffc6c5fec085ce643aa45c4f0261",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "ea9a5b240094d5c91c4ab2451833d48b056aa82ada5cc9e0cea696ebf93d8095",
        "patchedSha256": "d729b10c39acfbcf4fe3f10f7ed91c6ad3e0f9aeeadc23c1aed36add96a5d450"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "d393bf4e82cb9ad92151960241ffdb53c6e8c113eb9af0d9f7dff025e8d5fc14",
        "patchedSha256": "6ecd5db334dbf2abebf5f2b5cd5b17a8e30646cd5f07415f1c4bad88e5b0cf0b"
      },
      {
        "path": "src/renderer/pagination.rs",
        "originalSha256": "2416e94193e330d26d64668ae0100df62793b8d0a097bde3626a2211e2bc345e",
        "patchedSha256": "8ba278b11560401c31bbbca3acba31957a6ebb99b914c5e4586ac8f37573cf14"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-inline-declared-row-frame.patch",
    "sha256": "e138faea00d29536f7bc4a0a3d209e20ecee90aecd0638838cdeaefee23f1076",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "d729b10c39acfbcf4fe3f10f7ed91c6ad3e0f9aeeadc23c1aed36add96a5d450",
        "patchedSha256": "b360df99ce15bbcced4d74e3784ccfbfe9b58b802601f43679188faf94d0ad55"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-source-frame-height-reconciliation.patch",
    "sha256": "601af51283ccd644176da61ababa0a262c80de9857e2048a113fb06f006201c9",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "b360df99ce15bbcced4d74e3784ccfbfe9b58b802601f43679188faf94d0ad55",
        "patchedSha256": "d71d1044d32a574c3bda36c507a77dba12bf1360b1fa92c9825267b77f27374d"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "6ecd5db334dbf2abebf5f2b5cd5b17a8e30646cd5f07415f1c4bad88e5b0cf0b",
        "patchedSha256": "eba2d8a3bf99f93c118fc4665b8815a9e0c761a64f44bd84165d590349a2d2f8"
      },
      {
        "path": "src/renderer/pagination.rs",
        "originalSha256": "8ba278b11560401c31bbbca3acba31957a6ebb99b914c5e4586ac8f37573cf14",
        "patchedSha256": "65f55a7816627a01efdb806e8351fe8996aa9692fcfdc0e0e34a596f2375afd2"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-complete-float-row-frame.patch",
    "sha256": "261d215c1db6cdac372be7852753a728c66a2abe5c3becf99e1782b5386f9718",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "d71d1044d32a574c3bda36c507a77dba12bf1360b1fa92c9825267b77f27374d",
        "patchedSha256": "28bce3f591a5e35c10428c0cc1279c6bfae2372084c037d638acfc50d304074f"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-parallel-declared-source-frames.patch",
    "sha256": "840c02b4a65eed6210da1d78749827dfcd1bcd6fa6aa7a592a5a2dc2804154a9",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "28bce3f591a5e35c10428c0cc1279c6bfae2372084c037d638acfc50d304074f",
        "patchedSha256": "40089705a6ff0eecd661f3167d5c05cb9ef22734eced934f955d7d477e82a31e"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-terminal-peer-leaf-frame.patch",
    "sha256": "3ad22727cf7615b744d5d95f24abc5d173b9935a5299ef3ed4ccaaa8e03d183e",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "40089705a6ff0eecd661f3167d5c05cb9ef22734eced934f955d7d477e82a31e",
        "patchedSha256": "ff83bc7d0d123e28d45f085774f36417df6d4eb3da9dadb194c61f95c4dc98f0"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "eba2d8a3bf99f93c118fc4665b8815a9e0c761a64f44bd84165d590349a2d2f8",
        "patchedSha256": "a7dd5d28b857fc93cd058fd438c19d014b2c7bbdc94fd95b323733a93b73a248"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-resumed-peer-frame-margins.patch",
    "sha256": "fd034013bdd507206651e4ba16b95cf105d275c9c0f41ae11e63f52db2ed262d",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "ff83bc7d0d123e28d45f085774f36417df6d4eb3da9dadb194c61f95c4dc98f0",
        "patchedSha256": "60047882946fbf851385d6fac326fb65eca5a8d9bcd33efb88d63887bb762cbf"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "a7dd5d28b857fc93cd058fd438c19d014b2c7bbdc94fd95b323733a93b73a248",
        "patchedSha256": "60194de1d884bcaa7acb6baf6da10454b004b1ed11614fdde34a4c6c241e8d28"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-source-inline-tab-and-float-anchors.patch",
    "sha256": "0f8968eb35ef763c6a3faeae8b38f77a44b958afca5687b761dff44808a42261",
    "sources": [
      {
        "path": "src/renderer/layout/paragraph_layout.rs",
        "originalSha256": "2aa9dca69eb9805a4484a088f611b6efc9037295b24224e317cea6d977bb250b",
        "patchedSha256": "31581437036e6281f9ea8b58702ed539745a0f5001a7bc5fe92e63b05ed68d3b"
      },
      {
        "path": "src/renderer/layout.rs",
        "originalSha256": "c6bcf99a357b88d08108aa9f2abdf96ae4a95ae42afb8bbf9b8ab874aca7e1b5",
        "patchedSha256": "23b6ae78d6562e9b4635c211df169da2f2cbfd245b1ab50226adae8a841ead55"
      },
      {
        "path": "src/renderer/page_number.rs",
        "originalSha256": "e5270fd8da9a932b4a5f529b1a5d5bc5ca4002756754890e1f983b2775efc55a",
        "patchedSha256": "8253178571b9c0dda5476d0faf98df96af655588c108b4d310db8acb88113573"
      },
      {
        "path": "src/renderer/pagination/engine.rs",
        "originalSha256": "9c5b1048292b69da991965ee1d7953c80eab671ab7421fa4cc0bfbc4dcd6fb10",
        "patchedSha256": "f380ac2273f245567df66e86f5715649df556bf3824068538b9a6621c7debd8b"
      },
      {
        "path": "src/renderer/typeset/state/finalize.rs",
        "originalSha256": "de76f5d9b7828d0be9890f5e3db8e3b923ad357963ea70c059dec5d2219351ad",
        "patchedSha256": "5472d90878b5cb33a805f35395ee108a8c19fa51a274f238f86199707d96ff26"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-terminal-inline-frame.patch",
    "sha256": "9527b2fe50dd8b63826fd208adb02283c4d98deae98d4aad97107aa1db9c3d68",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "60047882946fbf851385d6fac326fb65eca5a8d9bcd33efb88d63887bb762cbf",
        "patchedSha256": "c14f756e6ab7b2f8e090742069a443ba8ed6a60dbaa84f79798ca9c588d389bd"
      },
      {
        "path": "src/renderer/layout.rs",
        "originalSha256": "23b6ae78d6562e9b4635c211df169da2f2cbfd245b1ab50226adae8a841ead55",
        "patchedSha256": "0d17e833c6fb352c1c846ad4e5b307af62f2f9d678ac702a4722b166c4bb6181"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-print-faux-bold-text.patch",
    "sha256": "bca1872751f432bd3d78d98f120300c52624b4e756eafafe4fc698070054ae7d",
    "sources": [
      {
        "path": "src/renderer/svg.rs",
        "originalSha256": "bb938cb2547addd9550ed716ea2c2b682c0cda4e3817222f4390bc202cb9cabd",
        "patchedSha256": "a4671ff603bc5b733930d64d1f08ce1d2d4c7eb53c0e291c15e8c7dc316a996c"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-paragraph-right-float-frame.patch",
    "sha256": "c07d85ecc20fb3f5e0d5bcff5a7c7b04ef8824eec4fc762a8d21b9c9afbb96fe",
    "sources": [
      {
        "path": "src/renderer/float_placement.rs",
        "originalSha256": "5a190794d8bb6ce6059acb2804f9afac0db358d78c9977fbd3d44f105600ecaa",
        "patchedSha256": "3447b7482a5fcfef6c23c02cd9bb7b60d2fc784b470b909876d99ede9246419e"
      },
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "c14f756e6ab7b2f8e090742069a443ba8ed6a60dbaa84f79798ca9c588d389bd",
        "patchedSha256": "818239da8bc783de6db02a2112ae239b3dc499e49e53da148211dd8b4523a653"
      },
      {
        "path": "src/renderer/layout.rs",
        "originalSha256": "0d17e833c6fb352c1c846ad4e5b307af62f2f9d678ac702a4722b166c4bb6181",
        "patchedSha256": "145966fc346afb5d3e0b2389468cb70889746b0a8bb2d68c2042eb11a3775da7"
      },
      {
        "path": "src/renderer/typeset/controls/empty_float.rs",
        "originalSha256": "60f45e29d40a79386f6811c5cfcd85084a210227a4f56b8360e350c508a202e3",
        "patchedSha256": "75cb6cea26aa495c55f0f783d6cc5dfecfc3c3c3978ee7c28df34ad077050bff"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-paired-rowbreak-opening-frame.patch",
    "sha256": "57c59bd90c11529ce816cd5817db10387bc402c72fe6bf8e6ca8ec4562931572",
    "sources": [
      {
        "path": "src/renderer/float_placement.rs",
        "originalSha256": "3447b7482a5fcfef6c23c02cd9bb7b60d2fc784b470b909876d99ede9246419e",
        "patchedSha256": "5be7cfd022d5c0028c43a67975b87ff2ef8db80a63548142975003461a5498fb"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "60194de1d884bcaa7acb6baf6da10454b004b1ed11614fdde34a4c6c241e8d28",
        "patchedSha256": "85c38e35247a74f2d3c8966b273ef8d7aba302a0fb84dd1f1e483690b0e2439f"
      },
      {
        "path": "src/renderer/typeset/table/continuation/fragment/emit.rs",
        "originalSha256": "49209ea9fa00f80d22dffc06227d139ed90d62b7e8650439791fa701b9e4b669",
        "patchedSha256": "a6e26ccbfd0d62a86c57c355711f48d995500b46b532d0a35e09d73ca1ef8cdd"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-nested-column-left-anchor.patch",
    "sha256": "3c1b29473dadb3687db166686e062404b5f47921b53c9777bbd28e0d475fa78c",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "818239da8bc783de6db02a2112ae239b3dc499e49e53da148211dd8b4523a653",
        "patchedSha256": "390e165ea2e9f61f04f91a0da20fcbf8e8b2b4289748d15ea7eb54733764d131"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-print-font-snapshot.patch",
    "sha256": "0716253e9ec971f7d826edc43c7285afe7e3c952c3e2a328c338595cae5b8f2e",
    "sources": [
      {
        "path": "src/document_core/font_environment.rs",
        "originalSha256": "6a4ad7997804081f55169ed2442af489a12e5fd7c9d92218e89fa42b039c30ef",
        "patchedSha256": "150b3165edcfced165b9f941a9b6d4bc091ba13a2756b736543a1e92a48095b1"
      },
      {
        "path": "src/wasm_api.rs",
        "originalSha256": "67ba646b399ada1585b380ae62dc28eac75df7458aca6f405989add654693244",
        "patchedSha256": "e14aeda012f929bdad22d81b370a324a7ca3e2f7d93ce98ad8b530028a5dc650"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-terminal-object-only-float-origin.patch",
    "sha256": "cdc6704a510cf958a020e52444e79fc57855816d5998f786dc479c1c52e67b9c",
    "sources": [
      {
        "path": "src/renderer/layout.rs",
        "originalSha256": "145966fc346afb5d3e0b2389468cb70889746b0a8bb2d68c2042eb11a3775da7",
        "patchedSha256": "9e5fbf2b8fe73d161d3524c15e972a7a6e1c5db3d8c973e5080655404e40a0fc"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-adjacent-source-table-anchors.patch",
    "sha256": "f8d3b964e379f22874f522dae504fe4f77a7afca5594b06ebcd3902945f3f7c2",
    "sources": [
      {
        "path": "src/renderer/layout.rs",
        "originalSha256": "9e5fbf2b8fe73d161d3524c15e972a7a6e1c5db3d8c973e5080655404e40a0fc",
        "patchedSha256": "5f0abd6dd78e3774929f0fc6f2599234d4407aeff1f959d4062e11ebbd754a16"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-terminal-cut-merged-frame.patch",
    "sha256": "90ef6edd39338176331f851366951c6fc0fd1b0472aea18f00d7d7c54e14e65d",
    "sources": [
      {
        "path": "src/renderer/typeset/table/continuation/fragment/emit.rs",
        "originalSha256": "a6e26ccbfd0d62a86c57c355711f48d995500b46b532d0a35e09d73ca1ef8cdd",
        "patchedSha256": "ccf603b6b01ce03bd80021cfa350ec06572c60232f884cc0b3b74dc63e27f28e"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-hwpx-owned-table-insets-and-reset-suffix.patch",
    "sha256": "30508889e2cf90c10dcb8c944611e4ce46a106a68cb428b1f32f6bd93e867988",
    "sources": [
      {
        "path": "src/renderer/composer.rs",
        "originalSha256": "22b2bfe0e80332d1696babd6ae413aab42ad778bbb83250ae83dce9902912d7b",
        "patchedSha256": "c4522b8fc150b55c5e57aa04b4ae9b946e63fd1c214be0fde60315539b1e1666"
      },
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "390e165ea2e9f61f04f91a0da20fcbf8e8b2b4289748d15ea7eb54733764d131",
        "patchedSha256": "b75a854d7962c76b6aa4aa4cd30110ce125a38d0895b0efae2592a4b8373f691"
      },
      {
        "path": "src/renderer/layout.rs",
        "originalSha256": "5f0abd6dd78e3774929f0fc6f2599234d4407aeff1f959d4062e11ebbd754a16",
        "patchedSha256": "9f9fcae00d8dc0a9bb73a98449f1854b288c64129d2a68799e12ea188453aec3"
      },
      {
        "path": "src/renderer/typeset.rs",
        "originalSha256": "d1ff98808886a577789458d136fe0ee33447d494bd2639a0c1a5b0b6e9809333",
        "patchedSha256": "d022ae8e04fa9fb00d71689e87bcd6d9766b008d202ad5208b9734dd9a800297"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-viewport-table-cell-selection.patch",
    "sha256": "85b5ab8c5356a894cadb0cbf659e22881e09f7fa64a1ed11de207878f16ce420",
    "sources": [
      {
        "path": "src/document_core/commands/object_ops/table.rs",
        "originalSha256": "42aab9a7ff095507e23f3329017fced03c060497a68860ca5277ccce83d846cc",
        "patchedSha256": "75ed6240c3d4d9e0e40eaab2bb43a72a17be7bccc6ce146be62e290c2ac05c09"
      },
      {
        "path": "src/document_core/queries/cursor_rect.rs",
        "originalSha256": "e7597fd66bc4190b5bdeb3f8bc3cd1430819cb0a3790c55a1794d1969e283ce0",
        "patchedSha256": "a1bb27fa8f9fe5143d8e78ad4e3c19d49bc0b2ed9dfdb85e907e124597103e02"
      },
      {
        "path": "src/wasm_api.rs",
        "originalSha256": "e14aeda012f929bdad22d81b370a324a7ca3e2f7d93ce98ad8b530028a5dc650",
        "patchedSha256": "e876c2106ba99a72917b54d5262bc5accc22da724bec0aa917d090a3fd54aa29"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-prepare-font-measurement-per-run.patch",
    "sha256": "c5a5de89e30176234b02ed5cf3cd801fc2d7045043201eb8ccba6a8b1dc2ea35",
    "sources": [
      {
        "path": "src/renderer/layout/text_measurement.rs",
        "originalSha256": "d8d40c5aec1868f6198f0f7fdd37f237ee151fe2bfdf7bbdb7424734ab5b27ff",
        "patchedSha256": "b6cc37207b26700265a3341a4e601832523c6fd9334e9f9fd11fff6297a8b128"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-rebuild-cell-flow-after-width-change.patch",
    "sha256": "559d9d6a8edcdf840ba6ced51abe6415efbd8cca8abb41770481aa7bef0c8a75",
    "sources": [
      {
        "path": "src/document_core/commands/table_ops.rs",
        "originalSha256": "efea4ac784307f3d33d8ddcc252e2da91996001fad378a7da5cec8894de8d2c4",
        "patchedSha256": "ef36eb72e016aa75fcf83ed17b77999e076c924d9841d74d446b704b7f095f41"
      },
      {
        "path": "src/document_core/commands/text_editing.rs",
        "originalSha256": "12341f00051996a9f163cdd506a5111c3993eb9f107314272b3c0230f10df62c",
        "patchedSha256": "4b54374e018904c9a899781b843fa2e2f25fcbd9524344d0d56325aca01a6fc2"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-reuse-font-metric-decisions-per-run.patch",
    "sha256": "d2b34968a412dbd04cf0104d80035301fccd992b215ef1f26c583844409c7109",
    "sources": [
      {
        "path": "src/renderer/layout/text_measurement.rs",
        "originalSha256": "b6cc37207b26700265a3341a4e601832523c6fd9334e9f9fd11fff6297a8b128",
        "patchedSha256": "0082802eb13710117cb8f05fcaf18df1a864764dbf76c086e87cbadc870f7084"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-use-capacity-after-nested-text-frame-displacement.patch",
    "sha256": "bd3da10095f32a6f757ccd01f49e483df4dc6fcd8579a81dae4635e48c819705",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "b75a854d7962c76b6aa4aa4cd30110ce125a38d0895b0efae2592a4b8373f691",
        "patchedSha256": "6945b6241bdf85b6a740df6ded667b8a03654d65a582922953c440e97864aaf6"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-inline-picture-frame-trailing-spacing.patch",
    "sha256": "eccb5db99dac205e3fd2bd7b22b5b19d0d4cb1dcbbf027b3b499b53e2613cd43",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "6945b6241bdf85b6a740df6ded667b8a03654d65a582922953c440e97864aaf6",
        "patchedSha256": "a000749d4470c075568650b813a538b67a01609d3eb4837e3e4917ac2fd67197"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-incremental-table-edit-measurements.patch",
    "sha256": "be2f5a2501651925c9478bca04ba0d5470fc81ff7159e84318c229ab773c420c",
    "sources": [
      {
        "path": "src/document_core/commands/document.rs",
        "originalSha256": "9dc140269a9e3f55173c5b6e4f18550177d19a8abba5dad43e329e32440e9119",
        "patchedSha256": "73c1445699fd23c03cca867975c66626a67a36c1bf6acfb369a4ae6f49537ab9"
      },
      {
        "path": "src/document_core/commands/table_ops.rs",
        "originalSha256": "ef36eb72e016aa75fcf83ed17b77999e076c924d9841d74d446b704b7f095f41",
        "patchedSha256": "801613bfedaf0bd9b3ca732b52e5e5372abdad7a73d8635200b5ff2448cd9545"
      },
      {
        "path": "src/document_core/commands/text_editing.rs",
        "originalSha256": "4b54374e018904c9a899781b843fa2e2f25fcbd9524344d0d56325aca01a6fc2",
        "patchedSha256": "7b1d758c473c5ea507a88d02f44cacaa169f92e73b2446b2d29e68152d9da980"
      },
      {
        "path": "src/document_core/mod.rs",
        "originalSha256": "5d21aabc86799fc1514c90b561fe915d30219c1a7d6678ffda9efee555b752ae",
        "patchedSha256": "35db3bee5435e5ab1834d218675328c3690482c8a67bf667f25c17b68a1d6b9c"
      },
      {
        "path": "src/document_core/queries/rendering.rs",
        "originalSha256": "1ac9314f99b2b735a9fe0c7f81e7ca0c69baef99abf844fe98f9209844f955a9",
        "patchedSha256": "88ebe0a85eece10708faafa387fcb8052c005e16348fa9c1397fc33b6e73d3ce"
      },
      {
        "path": "src/model/control.rs",
        "originalSha256": "100af2e27419b932e59d0555a32617123c681917d0df968ede26ba98ef613933",
        "patchedSha256": "a91def21d077610d687f355e3c8de11665f6b972ba133b128b1b764501b84c24"
      },
      {
        "path": "src/renderer/composer.rs",
        "originalSha256": "c4522b8fc150b55c5e57aa04b4ae9b946e63fd1c214be0fde60315539b1e1666",
        "patchedSha256": "b9d85eec579e233cf386a72240c3ff1cff2e1a962db526d3ca234c818f4270a5"
      },
      {
        "path": "src/renderer/height_measurer.rs",
        "originalSha256": "a35d2c1d41d98622a2d7e0a0007722885191116481b8e7e6e7f1382b6da8238f",
        "patchedSha256": "ce508da1df6ed134b5283f56509cd5a19d5817224d2a71326d15a1c1b9a05914"
      },
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "a000749d4470c075568650b813a538b67a01609d3eb4837e3e4917ac2fd67197",
        "patchedSha256": "947c33f60bb6cd45d22e101afb0eb605cd34a254af513d185417baa83b6ace77"
      },
      {
        "path": "src/renderer/layout.rs",
        "originalSha256": "9f9fcae00d8dc0a9bb73a98449f1854b288c64129d2a68799e12ea188453aec3",
        "patchedSha256": "32139b89d860f81ba76abab47a8d7c6debed8688357df49dbf3c77ca0637fcd4"
      },
      {
        "path": "src/renderer/page_layout.rs",
        "originalSha256": "a144a173647800ac2a0693be747af5ad19704a0a8470ca23b91dc14f762eadd8",
        "patchedSha256": "d26ba4e18ee85f8347f499af2c63e2275f12ad963dd7c76f56947bc910d2a416"
      },
      {
        "path": "src/renderer/pagination.rs",
        "originalSha256": "65f55a7816627a01efdb806e8351fe8996aa9692fcfdc0e0e34a596f2375afd2",
        "patchedSha256": "5265a234fffa2dd2a8768da6c4e7e52e83b7f1ed64c6ead76e56f100e27f8b72"
      },
      {
        "path": "src/renderer/typeset/table/block/prepare.rs",
        "originalSha256": "ee47e8d52fc0211b066da95e86fe18b769146715bbf8923e2dccdf67daaed27b",
        "patchedSha256": "c079d66b305fb795147ef98832e1dcbc60e8050d2e973b2950183f453e508ef7"
      },
      {
        "path": "src/renderer/typeset.rs",
        "originalSha256": "d022ae8e04fa9fb00d71689e87bcd6d9766b008d202ad5208b9734dd9a800297",
        "patchedSha256": "2b6c3446c04f6ec16fb3f2ac2487da94539b23914edbbe0c0b53c3f8c8162e43"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-source-owned-render-measurement-reuse.patch",
    "sha256": "746b84b8f2f6fd273b3b6ba66a5ac83e2b59e8863473bd967fe59194567e656e",
    "sources": [
      {
        "path": "src/renderer/height_measurer.rs",
        "originalSha256": "ce508da1df6ed134b5283f56509cd5a19d5817224d2a71326d15a1c1b9a05914",
        "patchedSha256": "824049450b9febd76d4d1a396f53363b07084f51017dda5ec28c57a793630dcc"
      },
      {
        "path": "src/renderer/layout.rs",
        "originalSha256": "32139b89d860f81ba76abab47a8d7c6debed8688357df49dbf3c77ca0637fcd4",
        "patchedSha256": "ff00e43b986e48648eb08e1328344dee29bc4d6f4d2775c4953218db97949864"
      },
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "947c33f60bb6cd45d22e101afb0eb605cd34a254af513d185417baa83b6ace77",
        "patchedSha256": "f073bd0a9d2a51eda56d3147520a46c27bcf9cf88b54130f1ddc53dbd24714db"
      },
      {
        "path": "src/document_core/queries/rendering.rs",
        "originalSha256": "88ebe0a85eece10708faafa387fcb8052c005e16348fa9c1397fc33b6e73d3ce",
        "patchedSha256": "2dc554ebc12b36413470c4112fab31ad76db47b5eb10f5e8f23595fcfcf4d9f2"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-continued-flow-picture-anchor.patch",
    "sha256": "6cacac963bc207e946bfc01746185b88760896e9d82f215916c30185ca706372",
    "sources": [
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "85c38e35247a74f2d3c8966b273ef8d7aba302a0fb84dd1f1e483690b0e2439f",
        "patchedSha256": "18de5a3856041cd2cf2b6f53576d89a21336b8948f9ddf17ec604258ced38464"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-nested-table-properties.patch",
    "sha256": "1e60aa26cf16fc73574bab2daace3e725440d4767e231823ee5bc06d9f3bb909",
    "sources": [
      {
        "path": "src/document_core/commands/table_ops.rs",
        "originalSha256": "801613bfedaf0bd9b3ca732b52e5e5372abdad7a73d8635200b5ff2448cd9545",
        "patchedSha256": "02fcb1aa425e2bc3e7964231480e34956e38289648779c553d4dc135851749c5"
      },
      {
        "path": "src/wasm_api.rs",
        "originalSha256": "e876c2106ba99a72917b54d5262bc5accc22da724bec0aa917d090a3fd54aa29",
        "patchedSha256": "e0923c7b6e2b9eb523c33492a0d4ccc56f0304994f059adf4f324893f775168f"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-table-control-path-ownership.patch",
    "sha256": "6b3de1c9a3d7345849e775ef2976efab7096392b6246d698df2121698f65c12a",
    "sources": [
      {
        "path": "src/document_core/queries/rendering.rs",
        "originalSha256": "2dc554ebc12b36413470c4112fab31ad76db47b5eb10f5e8f23595fcfcf4d9f2",
        "patchedSha256": "c29cb2f146cbeadbb8854fb1095ff6f39250bd9593e5eecfc7f35d05a1e82c08"
      },
      {
        "path": "src/document_core/queries/cursor_rect.rs",
        "originalSha256": "a1bb27fa8f9fe5143d8e78ad4e3c19d49bc0b2ed9dfdb85e907e124597103e02",
        "patchedSha256": "e90de808a212ae8ada8cbffc962fe4bbdd3327d41e03ce3a9e07ff6e4dfc952a"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-partial-format-border-preservation.patch",
    "sha256": "8d598bdea8c86dfedea457fc34bb9be16573bf7eb4305834717acd59c825596d",
    "sources": [
      {
        "path": "src/document_core/html_table_import.rs",
        "originalSha256": "76dab1f2053bcde8e66be350765073a78354f837d2d76e7ec465a158ff93f7e9",
        "patchedSha256": "30248b492eab96a06ab1f9786b3eee36311f5c39f4e2effa6c79dc561e4870ca"
      },
      {
        "path": "src/document_core/commands/formatting.rs",
        "originalSha256": "4e16385c6082fded14e6eea6f4e2d22beef30f107794bd019492595cab708369",
        "patchedSha256": "199dc58ab773f6d61f4366d452b16b2c02f2229a0e07ffff7a440bdf75d5a1d2"
      },
      {
        "path": "src/document_core/commands/header_footer_ops.rs",
        "originalSha256": "04183dbf3cb842a50a73c21869b542d2ed616206b7a88c2c5ae9cfc510e4136e",
        "patchedSha256": "642ab580dbdde75694a6c459a09bb4c05e8149ca96192d6786ffbf294f89cd15"
      },
      {
        "path": "src/document_core/commands/footnote_ops.rs",
        "originalSha256": "32f00884b41a1e7dc8455a0c7bb299cab688abceb869419b8314bce5576f21af",
        "patchedSha256": "5c55c1a91144328e1be8c9a71eee6b291ae40b6164af96dad41697b05f42f1fe"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-inline-shape-owned-tail-spacing.patch",
    "sha256": "56b529b3401dc9730aa4d49597015c31314cc62f3bc2f85497f1df157920a96d",
    "sources": [
      {
        "path": "src/renderer/layout.rs",
        "originalSha256": "ff00e43b986e48648eb08e1328344dee29bc4d6f4d2775c4953218db97949864",
        "patchedSha256": "c7ebbc8e3e312f50449b9347665d8df678fab2d7bc5b0f68cbe0bcdcf17a2624"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-legacy-symbol-metric-projection.patch",
    "sha256": "b6061c67e906619945b0a82a7f485fe5de3e0144f90e6ac3eec618ff56e04fac",
    "sources": [
      {
        "path": "src/renderer/composer.rs",
        "originalSha256": "b9d85eec579e233cf386a72240c3ff1cff2e1a962db526d3ca234c818f4270a5",
        "patchedSha256": "57287aa02f68ca9ddff7cbd799ab12b545c6352ba0bd7f703564cd006958320c"
      }
    ]
  },
  {
    "file": "rhwp-0.8.7-stored-frame-content-budget.patch",
    "sha256": "929a69dd2ad5165d4548fd28e83e085d8474ff7a6484a4316d1c8d89dc1a4900",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "f073bd0a9d2a51eda56d3147520a46c27bcf9cf88b54130f1ddc53dbd24714db",
        "patchedSha256": "04ed73436850ca9bf03047eff7ed31bbdaed8477988ccedfb85ab51afc9dac6c"
      },
      {
        "path": "src/renderer/typeset/table/scan/source_frame.rs",
        "originalSha256": "88a2b0afe7527179ca4b65bcbbe39ad77085c9e1bbb86e8f8bd55ee9de2e612e",
        "patchedSha256": "32f7acced04b8f30581d29f3a4604b41b5c5fbe30ee6d3a99548205a3c82632e"
      },
      {
        "path": "src/renderer/typeset/table/continuation/fragment/emit.rs",
        "originalSha256": "ccf603b6b01ce03bd80021cfa350ec06572c60232f884cc0b3b74dc63e27f28e",
        "patchedSha256": "ac4728ae2806ea36a5ae58d119a72a5f35ffa79b41623fd48a49259fd6b50b10"
      }
    ]
  }
,
{
  "file": "rhwp-0.8.7-cell-command-paths.patch",
  "sha256": "05acd790a2d0e41a53e1bfbcb84c13c5030f12b166d54ae6e873a91dd9bcc9c6",
  "sources": [
    {
      "path": "src/document_core/commands/object_ops/table.rs",
      "originalSha256": "75ed6240c3d4d9e0e40eaab2bb43a72a17be7bccc6ce146be62e290c2ac05c09",
      "patchedSha256": "348fb353d71c7b96e58e7567a09726c7b37cd6c8b9b1ba617917ba8f29c138f0"
    },
    {
      "path": "src/document_core/commands/table_ops.rs",
      "originalSha256": "02fcb1aa425e2bc3e7964231480e34956e38289648779c553d4dc135851749c5",
      "patchedSha256": "8e83c31f98c45d3382ec5887d45d3073108ba9a5bcc5609283fd2dbd86a40acb"
    },
    {
      "path": "src/wasm_api.rs",
      "originalSha256": "e0923c7b6e2b9eb523c33492a0d4ccc56f0304994f059adf4f324893f775168f",
      "patchedSha256": "5b7a2542ec69847a2a1c05c7805ec4598ce3f79f510541bb3a4470dd6213c76b"
    }
  ]
}
];
const help = `Usage: node scripts/build-patched-core.mjs
  --source-archive <fixed upstream source ZIP>
  --source-root <new directory to extract and patch>
  --output-root <new candidate core directory>
  --blank-template <fixed-commit saved/blank2010.hwp>
  [--cargo <executable>] [--rustc <executable>] [--python <executable>]
  [--wasm-bindgen <0.2.127 executable>] [--target-dir <build cache directory>]
  [--offline] [--prepare-only]

Requires Rust/Cargo 1.93.1 with wasm32-unknown-unknown, wasm-bindgen 0.2.127,
Git, Python 3.11+, and Node.js 22.12+. RUSTUP_HOME, CARGO_HOME and PATH are
inherited. Set RUSTUP_TOOLCHAIN to an installed 1.93.1 toolchain if needed.
Inputs are hash-pinned. Source/output roots must not already exist.
--prepare-only verifies and applies the patch without compiling.
No downloads or runtime installation are performed by this script. Cargo may
fetch missing dependencies unless --offline is supplied.
`;
const allowed = new Set(['source-archive','source-root','output-root','blank-template',
  'cargo','rustc','python','wasm-bindgen','target-dir','offline','prepare-only','help']);
const flags = new Set(['offline','prepare-only','help']);
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const name = process.argv[i].replace(/^--/, '');
  if (!process.argv[i].startsWith('--') || !allowed.has(name) || name in args) throw Error('Invalid or repeated argument: ' + process.argv[i]);
  if (flags.has(name)) args[name] = true;
  else {
    const value = process.argv[++i];
    if (!value || value.startsWith('--')) throw Error('Missing value for --' + name);
    args[name] = value;
  }
}
if (args.help) { process.stdout.write(help); process.exit(0); }
for (const name of ['source-archive','source-root','output-root','blank-template']) {
  if (!args[name]) throw Error('Required: --' + name + '\n' + help);
}
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const archive = path.resolve(args['source-archive']);
const sourceRoot = path.resolve(args['source-root']);
const outputRoot = path.resolve(args['output-root']);
const blank = path.resolve(args['blank-template']);
const targetDir = path.resolve(args['target-dir'] || path.join(sourceRoot, 'target'));
const python = args.python || 'python';
const cargo = args.cargo || 'cargo';
const rustc = args.rustc || 'rustc';
const bindgen = args['wasm-bindgen'] || 'wasm-bindgen';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function assertHash(file, expected) {
  const actual = hash(await fs.readFile(file));
  if (actual !== expected) throw Error('SHA256 mismatch: ' + path.basename(file));
  return actual;
}
async function assertNewRoot(root) {
  if (root === path.parse(root).root) throw Error('A filesystem root cannot be a build directory');
  try { await fs.lstat(root); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  throw Error('Build directory already exists; choose a new directory: ' + root);
}
function contains(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
if (contains(sourceRoot, outputRoot) || contains(outputRoot, sourceRoot)) throw Error('Source and output roots must be separate');
for (const root of [sourceRoot, outputRoot]) await assertNewRoot(root);
await assertHash(archive, pinned.sourceArchiveSha256);
await assertHash(blank, pinned.blankTemplateSha256);
for (const patch of patches) {
  await assertHash(path.join(repoRoot, 'docs/engine-patches', patch.file), patch.sha256);
}

async function run(command, commandArgs, {cwd, capture = false, env = {}} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd, env: {...process.env, ...env}, windowsHide: true,
      stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
    });
    let output = '';
    child.stdout?.on('data', data => { output += data; if (output.length > 8 * 1024 * 1024) child.kill(); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(Error(command + ' failed: exit ' + code)));
  });
}
const extract = String.raw`
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
import sys
archive, destination = Path(sys.argv[1]), Path(sys.argv[2])
destination.mkdir(parents=True, exist_ok=False)
with ZipFile(archive) as z:
    for entry in z.infolist():
        p = PurePosixPath(entry.filename)
        if p.is_absolute() or '..' in p.parts or '\\' in entry.filename or ':' in entry.filename:
            raise SystemExit('Unsafe archive member')
        if (entry.external_attr >> 16) & 0o170000 == 0o120000:
            raise SystemExit('Archive symlinks are not supported')
    z.extractall(destination)
`;
await run(python, ['-c', extract, archive, sourceRoot]);
// A source snapshot may sit below another Git worktree. Make its working tree
// explicit so Git cannot silently skip diff paths outside the parent's prefix.
const applyArgs = ['--work-tree=.', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'apply'];
for (const patch of patches) {
  const patchFile = path.join(repoRoot, 'docs/engine-patches', patch.file);
  for (const source of patch.sources) {
    const sourcePath = path.join(sourceRoot, source.path);
    if (source.originalSha256 === null) {
      // A pinned added file must be absent before its patch. Never accept an
      // existing file merely because the patch describes it as a new source.
      const existing = await fs.lstat(sourcePath).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (existing) throw Error(`Added patch source already exists: ${source.path}`);
    } else {
      await assertHash(sourcePath, source.originalSha256);
    }
  }
  await run('git', [...applyArgs, '--check', patchFile], {cwd: sourceRoot});
  await run('git', [...applyArgs, patchFile], {cwd: sourceRoot});
  for (const source of patch.sources) {
    await assertHash(path.join(sourceRoot, source.path), source.patchedSha256);
  }
}

// The preserved source snapshot intentionally omits these standalone tools.
// Prune only their workspace membership; package/dependency declarations stay intact.
const originalManifest = await fs.readFile(path.join(sourceRoot, 'Cargo.toml'), 'utf8');
const originalMembers = 'members = [".", "crates/*", "tools/rhwp-subsecond", "bindings/Native", "tools/batch-convert", "tools/llm_verifier/verdict_protocol", "tools/llm_verifier/claim_bind", "tools/llm_verifier/criteria_decomp"]';
if (originalManifest.split(originalMembers).length !== 2) throw Error('Unexpected upstream workspace declaration');
await fs.writeFile(path.join(sourceRoot, 'Cargo.toml'), originalManifest.replace(originalMembers, 'members = [".", "crates/*"]'));
await fs.mkdir(path.join(sourceRoot, 'saved'), {recursive: true});
await fs.copyFile(blank, path.join(sourceRoot, 'saved/blank2010.hwp'));
await fs.mkdir(outputRoot);
if (args['prepare-only']) {
  process.stdout.write('Pinned source, patch, workspace preparation and blank template verified. Compilation not requested.\n');
  process.exit(0);
}

const versions = {
  rustc: await run(rustc, ['--version'], {capture: true}),
  cargo: await run(cargo, ['--version'], {capture: true}),
  wasmBindgen: await run(bindgen, ['--version'], {capture: true}),
};
if (!/^rustc 1\.93\.1\b/.test(versions.rustc) || !/^cargo 1\.93\.1\b/.test(versions.cargo)
    || !/^wasm-bindgen 0\.2\.127\b/.test(versions.wasmBindgen)) throw Error('Required tool versions do not match: ' + JSON.stringify(versions));
const buildArgs = ['build', '--lib', '--target', 'wasm32-unknown-unknown', '--release'];
if (args.offline) buildArgs.push('--offline');
const sysroot = await run(rustc, ['--print', 'sysroot'], {capture: true});
if (!path.isAbsolute(sysroot)) throw Error('Rust sysroot must be an absolute path');
const remapRoots = [
  [sourceRoot, '/pwh/source'],
  [targetDir, '/pwh/target'],
  [path.resolve(process.env.CARGO_HOME || path.join(os.homedir(), '.cargo')), '/cargo'],
  [path.resolve(process.env.RUSTUP_HOME || path.join(os.homedir(), '.rustup')), '/rustup'],
  [path.resolve(sysroot), '/rustup/toolchain'],
];
const remapFlags = remapRoots.map(([local, portable]) => '--remap-path-prefix=' + local + '=' + portable);
await run(cargo, buildArgs, {cwd: sourceRoot, env: {
  CARGO_TARGET_DIR: targetDir,
  CARGO_ENCODED_RUSTFLAGS: remapFlags.join('\x1f'),
}});

const auditLock = String.raw`
from pathlib import Path
from zipfile import ZipFile
import tomllib, sys, json, hashlib
archive, source = Path(sys.argv[1]), Path(sys.argv[2])
with ZipFile(archive) as z:
    original = tomllib.loads(z.read('Cargo.lock').decode())
current_bytes = (source / 'Cargo.lock').read_bytes()
current = tomllib.loads(current_bytes.decode())
key = lambda p: (p['name'], p['version'], p.get('source'))
before = {key(p):p for p in original['package']}
after = {key(p):p for p in current['package']}
added = [k for k in after if k not in before]
changed = [k for k in after if k in before and after[k] != before[k]]
if added or changed:
    raise SystemExit('Cargo.lock dependency drift; candidate rejected: ' + json.dumps({'added':added,'changed':changed}))
print(json.dumps({'originalPackageCount':len(before),'retainedPackageCount':len(after),
 'removedPackageCount':len(before)-len(after),'addedPackages':0,'changedRetainedPackages':0,
 'cargoLockSha256':hashlib.sha256(current_bytes).hexdigest()}))
`;
const lockAudit = JSON.parse(await run(python, ['-c', auditLock, archive, sourceRoot], {capture: true}));
await run(bindgen, ['--target', 'web', '--out-name', 'rhwp', '--out-dir', outputRoot,
  path.join(targetDir, 'wasm32-unknown-unknown/release/rhwp.wasm')]);
await assertHash(path.join(outputRoot, 'rhwp.js'), pinned.expectedGlueSha256);
const files = {};
for (const name of ['rhwp.js','rhwp.d.ts','rhwp_bg.wasm','rhwp_bg.wasm.d.ts']) {
  const bytes = await fs.readFile(path.join(outputRoot, name));
  files[name] = {size: bytes.length, sha256: hash(bytes)};
}
await fs.copyFile(path.join(sourceRoot, 'LICENSE'), path.join(outputRoot, 'LICENSE'));
await fs.writeFile(path.join(outputRoot, 'BUILD-RECORD.json'), JSON.stringify({
  schemaVersion: 1, id: 'rhwp-0.8.7-table-layout-fixes-candidate',
  ...pinned, patches, versions, target: 'wasm32-unknown-unknown', features: 'upstream defaults',
  buildArgs, remappedSourcePaths: true, lockAudit, files,
  installation: 'Not installed. Candidate requires regression checks and a new immutable engine release.',
}, null, 2) + '\n');
process.stdout.write('Separate candidate built and dependency drift checks passed. Run synthetic geometry/export/undo checks before packaging.\n');
