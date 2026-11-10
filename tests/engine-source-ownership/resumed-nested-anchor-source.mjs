import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadEngineSource, runRustTests, sourceBlock} from './harness.mjs';

const {root} = await loadEngineSource();
const source = await fs.readFile(path.join(root, 'src/renderer/layout/table_partial.rs'), 'utf8');
const code = String.raw`
#[derive(Clone, Copy, PartialEq)]
enum HorzRelTo { Para, Column }
#[derive(Clone, Copy, PartialEq)]
enum HorzAlign { Left, Center, Right }

struct Common {
    horz_rel_to: HorzRelTo,
    horz_align: HorzAlign,
    horizontal_offset: u32,
}
struct Table {
    common: Common,
    outer_margin_left: i16,
    outer_margin_right: i16,
}
struct LayoutRect { x: f64, width: f64 }
fn hwpunit_to_px(hu: i32, dpi: f64) -> f64 { f64::from(hu) * dpi / 7200.0 }

ANCHOR

fn table() -> Table {
    Table {
        common: Common { horz_rel_to: HorzRelTo::Para, horz_align: HorzAlign::Left, horizontal_offset: 0 },
        outer_margin_left: 150,
        outer_margin_right: 75,
    }
}
fn anchor(table: &Table, width: f64) -> Option<f64> {
    resumed_para_left_table_anchor(table, &LayoutRect { x: 50.0, width: 103.0 }, width, 96.0)
}

#[test]
fn the_body_starts_after_the_left_outer_margin() {
    assert_eq!(anchor(&table(), 100.0), Some(52.0));
    assert_eq!(anchor(&table(), 90.0), Some(52.0));
}
#[test]
fn the_full_frame_must_fit() {
    assert_eq!(anchor(&table(), 100.1), None);
    assert_eq!(anchor(&table(), 0.0), None);
    let mut t = table();
    t.outer_margin_right = -1;
    assert_eq!(anchor(&t, 90.0), None);
}
#[test]
fn other_reference_boxes_or_alignments_keep_their_own_placement() {
    let mut t = table();
    t.common.horz_rel_to = HorzRelTo::Column;
    assert_eq!(anchor(&t, 90.0), None);
    for alignment in [HorzAlign::Center, HorzAlign::Right] {
        let mut t = table();
        t.common.horz_align = alignment;
        assert_eq!(anchor(&t, 90.0), None);
    }
    let mut t = table();
    t.common.horizontal_offset = 1;
    assert_eq!(anchor(&t, 90.0), None);
}
`;
await runRustTests({
  name: 'resumed-nested-anchor',
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  code: code.replace('ANCHOR', sourceBlock(source, 'fn resumed_para_left_table_anchor(')),
});
