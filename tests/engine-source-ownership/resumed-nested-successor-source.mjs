import fs from 'node:fs/promises';
import {loadEngineSource, runRustTests, sourceBlock} from './harness.mjs';

const {source, sourceSha256} = await loadEngineSource();
const existing = await fs.readFile(new URL('./stored-nested-forward-tail-source.mjs', import.meta.url), 'utf8');
const model = existing.slice(existing.indexOf('mod model {'), existing.indexOf('\nmod engine {'));
const code = model + String.raw`
mod renderer {
    pub const HWPUNIT_PER_INCH: f64 = 7200.0;
}
mod engine {
use std::cell::{Cell as State, RefCell};
use crate::model::{control::Control, paragraph::{ColumnBreakType, LineSeg, Paragraph}, shape::*,
    table::{Cell, Common, Padding, Table, TablePageBreak}};

#[derive(Clone, Copy)]
struct Profile { stored: bool, edited: bool }
impl Profile {
    fn hwpx_stored_layout(self) -> bool { self.stored }
    fn session_edited(self) -> bool { self.edited }
}
struct Normalization(bool);
impl Normalization {
    fn table_text_reflowed(&self, _: &Table) -> bool { self.0 }
}
struct LayoutEngine {
    dpi: f64,
    profile: State<Profile>,
    render_normalization: RefCell<Normalization>,
    measured_height: f64,
}
struct ParaStyle { spacing_before: f64 }
struct ResolvedStyleSet { para_styles: Vec<ParaStyle> }

#[derive(Clone, Default)]
struct CellUnit {
    para_idx: usize, vis_start: usize, vis_end: usize,
    mixed_nested_fragment: bool, mixed_nested_trailing: bool, mixed_nested_recursive: bool,
    nested_row: Option<usize>, nested_table_fragment: Option<()>,
}

AUTHENTIC_OWNER
impl LayoutEngine {
    fn calc_nested_table_height(&self, _: &Table, _: &ResolvedStyleSet) -> f64 {
        self.measured_height
    }
    PLAIN_PARAGRAPH
    RESUMED_SUCCESSOR
}

const SOURCE_HEIGHT: i32 = 5620;
fn line(top: i32) -> LineSeg {
    LineSeg {vertical_pos: top, line_height: 1000, line_spacing: 600, segment_width: 18000, tag: 0}
}
fn paragraph(text: &str, top: i32) -> Paragraph {
    Paragraph {text: text.into(), dirty: false, cell_format_vpos_dirty: false, source_frame_reflowed: false,
        layout_space_metrics: vec![], line_segs: vec![line(top)], controls: vec![],
        column_type: ColumnBreakType::None, para_shape_id: 0, raw_break_type: 0}
}

struct Fixture { engine: LayoutEngine, cell: Cell, units: Vec<CellUnit>, styles: ResolvedStyleSet }
impl Fixture {
    fn result(&self, start: usize, end: usize) -> Option<(usize, i32)> {
        self.engine.saved_resumed_nested_successor(&self.cell, &self.units, start, end, &self.styles)
            .map(|(index, line)| (index, line.vertical_pos))
    }

    fn child_mut(&mut self) -> &mut Table {
        let Control::Table(table) = &mut self.cell.paragraphs[0].controls[0] else {
            panic!("fixture must contain a child table")
        };
        table
    }
}

fn fixture() -> Fixture {
    let padding = Padding {top: 0, bottom: 0};
    let mut host = paragraph("heading", 3200);
    host.controls.push(Control::Table(Box::new(Table {
        common: Common {treat_as_char: false, flow_with_text: true, allow_overlap: false,
            text_wrap: TextWrap::Square, vert_rel_to: VertRelTo::Para, vert_align: VertAlign::Top,
            vertical_offset: 0, height: 5000},
        caption: None, row_count: 2, col_count: 1, padding, page_break: TablePageBreak::RowBreak,
        cell_spacing: 0, outer_margin_top: 200, outer_margin_bottom: 420,
        cells: vec![], raw: vec![], headers: vec![],
    })));
    let cell = Cell {dirty_flag: false, row: 0, col: 0, col_span: 1, text_direction: 0, height: 6000,
        padding, apply_inner_margin: false, row_span: 1,
        paragraphs: vec![host, paragraph("following line", SOURCE_HEIGHT)]};
    let child_unit = CellUnit {vis_start: 1, vis_end: 1, mixed_nested_fragment: true, ..Default::default()};
    Fixture {
        engine: LayoutEngine {dpi: 96.0, profile: State::new(Profile {stored: true, edited: false}),
            render_normalization: RefCell::new(Normalization(false)),
            measured_height: f64::from(SOURCE_HEIGHT) * 96.0 / 7200.0 - f64::EPSILON * 100.0},
        cell,
        units: vec![CellUnit {vis_end: 1, ..Default::default()}, child_unit.clone(), child_unit,
            CellUnit {para_idx: 1, vis_end: 1, ..Default::default()}],
        styles: ResolvedStyleSet {para_styles: vec![ParaStyle {spacing_before: 0.0}]},
    }
}
fn rejects(change: impl FnOnce(&mut Fixture)) {
    let mut f = fixture();
    change(&mut f);
    assert!(f.result(1, 4).is_none());
}

#[test]
fn complete_child_after_consumed_heading_owns_successor() {
    assert_eq!(fixture().result(1, 4), Some((1, SOURCE_HEIGHT)));
    assert_eq!(fixture().result(1, usize::MAX), Some((1, SOURCE_HEIGHT)));
}
#[test]
fn a_child_that_already_started_or_continues_next_page_cannot_claim_successor() {
    let f = fixture();
    for (start, end) in [(0, 4), (1, 3), (2, 4), (3, 4), (1, 5)] {
        assert!(f.result(start, end).is_none());
    }
}
#[test]
fn recursive_and_non_content_fragments_cannot_claim_successor() {
    rejects(|f| f.units[2].mixed_nested_recursive = true);
    rejects(|f| f.units[2].mixed_nested_trailing = true);
    rejects(|f| f.units[2].nested_table_fragment = Some(()));
}
#[test]
fn source_coordinate_and_measurement_must_each_close() {
    rejects(|f| f.cell.paragraphs[1].line_segs[0].vertical_pos += 1);
    rejects(|f| f.engine.measured_height += 96.0 / 7200.0);
    rejects(|f| f.child_mut().outer_margin_bottom += 1);
}
#[test]
fn edited_or_reflowed_content_does_not_reuse_saved_origin() {
    rejects(|f| f.cell.dirty_flag = true);
    rejects(|f| f.cell.paragraphs[0].source_frame_reflowed = true);
    rejects(|f| f.cell.paragraphs[1].line_segs[0].tag = LineSeg::TAG_IMPLEMENTATION_PROPERTY);
    rejects(|f| f.engine.profile.set(Profile {stored: true, edited: true}));
    rejects(|f| f.engine.render_normalization.borrow_mut().0 = true);
}
#[test]
fn an_independent_placement_or_new_paragraph_spacing_prevents_closure() {
    rejects(|f| f.child_mut().common.allow_overlap = true);
    rejects(|f| f.child_mut().common.vert_rel_to = VertRelTo::Page);
    rejects(|f| f.child_mut().common.text_wrap = TextWrap::TopAndBottom);
    rejects(|f| f.styles.para_styles[0].spacing_before = 1.0);
}
}
`;
await runRustTests({
  name: 'resumed-nested-successor',
  sourceSha256,
  code: code
    .replace('AUTHENTIC_OWNER', sourceBlock(source, 'fn stored_float_frame_owner_is_original('))
    .replace('PLAIN_PARAGRAPH', sourceBlock(source, 'fn stored_plain_cell_paragraph('))
    .replace('RESUMED_SUCCESSOR', sourceBlock(source, 'pub(super) fn saved_resumed_nested_successor')),
});
