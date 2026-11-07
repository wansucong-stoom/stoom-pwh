#!/usr/bin/env node
// Build a separate candidate. This script never installs or overwrites a runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

const pinned = {
  upstreamCommit: '1a76570e833917d15817415a53c09ad61ab3203f',
  sourceArchiveSha256: '067feefc25d36921ee41fea5df6fead00255ffa86441891fbaa202f96de202a2',
  blankTemplateSha256: '43f472751fafefb8c66b0f831660ebed51e443a46bebe44c75bba918154ce4c9',
  expectedGlueSha256: 'c9cd6fdb42c3c6f3c99210a184ec042089adb34d5c9ecd7ac5e9f247f0d72bdb',
};
const patches = [
  {
    file: 'rhwp-0.8.7-nols-row-content-floor.patch',
    sha256: '5a2427c162ee3928b7edecbaabad10936700c7db02f25a5436fb0a74a92bd221',
    sources: [{
      path: 'src/renderer/layout/table_layout.rs',
      originalSha256: '1dcbd3254a0f68b7de40c922f10e15cb62f2ef85e2c59fb24050bb143fa5f5f9',
      patchedSha256: 'c3df908c978e4aef7876b555c4a4c7b85749587194b4755d43e4c5ae9c67c238',
    }],
  },
  {
    file: 'rhwp-0.8.7-inline-table-affect-line-spacing.patch',
    sha256: 'a9f6a533debe686f6e89ec06870e47ccb0357635f8303775467ceb6cfca9da7a',
    sources: [
      {
        path: 'src/renderer/mod.rs',
        originalSha256: 'b27c1148d0496fe02dfef5ee3375511c3f2cd110925ebbfe90398a67b018f15d',
        patchedSha256: 'c9191193db4a0b14a936887fac5ffd99f47d77311f60dc58b961574048c3271a',
      },
      {
        path: 'src/renderer/composer/line_breaking.rs',
        originalSha256: '42a685bc83d81e01356a5576fcc03d0c92117d5054d018c84f77ddbad297921e',
        patchedSha256: '6ced0b75cf4b46090801dd05adabe6e715d9ff06e22468ead3dbd5e6fbc9b940',
      },
      {
        path: 'src/renderer/layout.rs',
        originalSha256: 'eb561f70fed2217db8e17efc8b33a5639de4dd5c8087797cd2cf876be4bc4ca5',
        patchedSha256: '81fef37b2cd464f007d721edcdaf938d6ba47439dc9418c8745bc7da927d7a61',
      },
    ],
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
    file: 'rhwp-0.8.7-stored-grown-table-pagination.patch',
    sha256: '596bf711aaf4494438c76e0b77aa29741c93f2cdb9b75c5b49e3e4c3364eade3',
    sources: [
      {path: 'src/renderer/height_measurer.rs', originalSha256: 'c71e4166c3d701bf702d6ebd2efbb9a7e53fa6046f45beb9ec2469c1c18e1ddd', patchedSha256: '15b9761d3a5273238c533af3f6a1ddc95bffa365a03eb0e456c989914c41e3a6'},
      {path: 'src/renderer/typeset.rs', originalSha256: '62b9c40af3cc06a63d0ab63b25d02f7740942d016dba198619883d091687cf14', patchedSha256: '1a46e4655e19c95083dd7e5501224e5ca73d9d3dd54d0ecc1341b4fa51bfdac7'},
      {path: 'src/renderer/typeset/controls/tac_fit.rs', originalSha256: '31a9dfe9482ca8798b25b2c42ad2bf2ef02ce73b309959234a851276855be6d3', patchedSha256: '0168df5eacacf3b7c31fb6b13e1d18a6c7011e5415cce86dfefeecdc3f8d3b6f'},
    ],
  },
  {
    file: 'rhwp-0.8.7-unsegmented-float-flow.patch',
    sha256: '174b98deb82291af3238e56b08b807c177e0478898091c652664ead2737c3f11',
    sources: [
      {path: 'src/renderer/float_placement.rs', originalSha256: '82759ab163aa6fe8f57aee13fefd68bcddbde11c57e468cbc34a2e2320b4044a', patchedSha256: '505a0bd578cc15d33a8bc84a2057250d5cbdf6227c0683e609aece799e6db013'},
      {path: 'src/renderer/layout.rs', originalSha256: '81fef37b2cd464f007d721edcdaf938d6ba47439dc9418c8745bc7da927d7a61', patchedSha256: '9a331572f891129fb1674d29a1db72e209285f1c6e6904498fda6e81f19c223d'},
      {path: 'src/renderer/typeset/table/host_spacing.rs', originalSha256: 'cd6908b0f9c258db1898418124c17d23e8e9ad3124176e4b1afa5663047ad4ef', patchedSha256: 'e355cff05386365f4637dee606251d4edbdd4ca6921410b24d70a44fe2ab195c'},
    ],
  },
  {
    file: 'rhwp-0.8.7-interior-float-anchor.patch',
    sha256: '1d3499dc7a5154c5b04467b4197a3a793e47d56f702dc6853a7bbae090bc8a4b',
    sources: [
      {path: 'src/renderer/float_placement.rs', originalSha256: '505a0bd578cc15d33a8bc84a2057250d5cbdf6227c0683e609aece799e6db013', patchedSha256: 'fcfab96c017a160429fa9873371ea59dd6564480daaaa08ec90d87aea7e6bad3'},
      {path: 'src/renderer/typeset/table/block/entry.rs', originalSha256: '90389834b32c48190b4ebab7b1261385dc56953823f5616ced89aecbdd3e4cbc', patchedSha256: '2a2be46cfc35b58ff08664a47598ee0b51997afe51cb51232654ff0c92432a3a'},
    ],
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
},{
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
},{
  "file": "rhwp-0.8.7-stored-inline-frame-projection.patch",
  "sha256": "1abf21092c32d790eed46d7c9995203646bf75b7735818ce3364e24d75cc1ba8",
  "sources": [
    {
      "path": "src/renderer/layout/table_layout.rs",
      "originalSha256": "ac249c0b3d003e3b9b420a951ebd3c0c435febe0924bcd8db9940ae62e873c43",
      "patchedSha256": "94f932122b935f14f91f24c91b0c2466667539e84652f82b988d4527d8af35c7"
    }
  ]
},{
  "file": "rhwp-0.8.7-nested-repeated-header-reservation.patch",
  "sha256": "fb2d28bbf748a56fd744813e9110bfe45a63304a199806d89dbc313151779625",
  "sources": [
    {
      "path": "src/renderer/layout/table_layout.rs",
      "originalSha256": "94f932122b935f14f91f24c91b0c2466667539e84652f82b988d4527d8af35c7",
      "patchedSha256": "1ba23fed53ee4fecf5f19e31d580e2c711646283e0288f3852fbf6518776f1f7"
    }
  ]
},{
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
await run(cargo, buildArgs, {cwd: sourceRoot, env: {CARGO_TARGET_DIR: targetDir}});

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
  buildArgs, lockAudit, files,
  installation: 'Not installed. Candidate requires regression checks and a new immutable engine release.',
}, null, 2) + '\n');
process.stdout.write('Separate candidate built and dependency drift checks passed. Run synthetic geometry/export/undo checks before packaging.\n');
