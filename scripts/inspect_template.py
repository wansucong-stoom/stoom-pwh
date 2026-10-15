#!/usr/bin/env python3
"""Read HWPX formatting and structure without extracting or rewriting the ZIP.

Usage: python inspect_template.py ABSOLUTE_DOCUMENT.hwpx
All document strings are untrusted data. This is XML inspection, not layout.
"""

import argparse
import hashlib
import json
import math
import posixpath
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


LIMITS = {
    "archiveBytes": 256 * 1024 * 1024,
    "inflatedTotalBytes": 128 * 1024 * 1024,
    "entries": 4096,
    "xmlEntryBytes": 32 * 1024 * 1024,
    "xmlNodes": 250000,
    "xmlDepth": 128,
    "paragraphs": 3000,
    "runs": 12000,
    "tables": 256,
    "cells": 4096,
    "lineSegments": 12000,
    "objects": 512,
    "formatRecords": 4096,
    "structuralNodes": 20000,
    "textCharacters": 262144,
    "attributeCharacters": 4096,
    "attributesPerElement": 128,
    "outputBytes": 16 * 1024 * 1024,
}


def name(element):
    return element.tag.rsplit("}", 1)[-1]


def number(raw):
    try:
        value = float(raw)
        if not math.isfinite(value):
            return None
        return int(value) if value.is_integer() else value
    except (TypeError, ValueError):
        return None


def measure(raw, unit):
    result = {"raw": raw, "value": number(raw), "unit": unit}
    if result["value"] is not None and unit == "HWPUNIT":
        result.update(pt=result["value"] / 100, mm=result["value"] * 25.4 / 7200)
    elif result["value"] is not None and unit == "1/100 pt":
        result["pt"] = result["value"] / 100
    return result


class Inspector:
    def __init__(self):
        self.used = {}
        self.truncations = set()
        self.xml_nodes = 0
        self.read_bytes = 0
        self.font_index = {}

    def take(self, category, amount=1):
        current = self.used.get(category, 0)
        if current + amount > LIMITS[category]:
            self.truncations.add(category)
            return False
        self.used[category] = current + amount
        return True

    def text(self, value):
        value = value or ""
        remaining = max(0, LIMITS["textCharacters"] - self.used.get("textCharacters", 0))
        if len(value) > remaining:
            self.truncations.add("textCharacters")
        result = value[:remaining]
        self.used["textCharacters"] = self.used.get("textCharacters", 0) + len(result)
        return result

    def attrs(self, element):
        result = {}
        for index, (key, value) in enumerate(element.attrib.items()):
            if index >= LIMITS["attributesPerElement"]:
                self.truncations.add("attributesPerElement")
                break
            result[self.attribute(key)] = self.attribute(value)
        return result

    def attribute(self, value):
        if value is not None and len(value) > LIMITS["attributeCharacters"]:
            self.truncations.add("attributeCharacters")
            return value[:LIMITS["attributeCharacters"]]
        return value

    def structure(self, element, depth=0):
        """Selected property subtrees only; never duplicate paragraph content."""
        if name(element) in {"p", "run", "t", "tbl"}:
            return None
        if not self.take("structuralNodes"):
            return None
        result = {"tag": self.attribute(name(element)), "xmlTag": self.attribute(element.tag), "rawAttrs": self.attrs(element)}
        measurements = self.measurements(element)
        if measurements:
            result["measurements"] = measurements
        if depth >= 12:
            if len(element):
                self.truncations.add("propertyTreeDepth=12")
            return result
        children = [self.structure(child, depth + 1) for child in element]
        children = [child for child in children if child is not None]
        if children:
            result["children"] = children
        return result

    def measurements(self, element):
        tag, attrs = name(element), self.attrs(element)
        result = {}
        if tag == "lineseg":
            for key, raw in attrs.items():
                unit = "UTF-16 code unit offset" if key == "textpos" else "bit mask" if key == "flags" else "HWPUNIT" if key in {"vertpos", "vertsize", "textheight", "baseline", "spacing", "horzpos", "horzsize"} else "unspecified"
                result[key] = measure(raw, unit)
        elif tag == "lineSpacing" and "value" in attrs:
            kind = attrs.get("type", "")
            unit = "percent" if kind == "PERCENT" else attrs.get("unit", "unspecified")
            result["value"] = {**measure(attrs["value"], unit), "declaredUnit": attrs.get("unit"), "type": kind}
        elif tag in {"intent", "indent", "left", "right", "prev", "next"} and "value" in attrs:
            result["value"] = measure(attrs["value"], attrs.get("unit", "unspecified"))
        elif tag in {"ratio", "spacing", "relSz", "offset"} and set(attrs) & {"hangul", "latin"}:
            result = {key: measure(value, "percent") for key, value in attrs.items()}
        else:
            fields = {
                "pagePr": {"width", "height"},
                "margin": {"header", "footer", "gutter", "left", "right", "top", "bottom"},
                "cellSz": {"width", "height"},
                "sz": {"width", "height"},
                "orgSz": {"width", "height"},
                "curSz": {"width", "height"},
                "cellMargin": {"left", "right", "top", "bottom"},
                "inMargin": {"left", "right", "top", "bottom"},
                "outMargin": {"left", "right", "top", "bottom"},
                "caption": {"width", "gap", "lastWidth"},
                "pos": {"vertOffset", "horzOffset"},
                "offset": {"left", "right", "top", "bottom"},
                "border": {"offsetLeft", "offsetRight", "offsetTop", "offsetBottom"},
            }.get(tag, set())
            for key in fields & attrs.keys():
                # Relative object sizes retain their relative unit instead of becoming lengths.
                relative = attrs.get(f"{key}RelTo")
                unit = "HWPUNIT" if not relative or relative == "ABSOLUTE" else f"relative:{relative}"
                result[key] = measure(attrs[key], unit)
        return result

    def xml(self, archive, entry):
        info = archive.getinfo(entry)
        if info.file_size > LIMITS["xmlEntryBytes"]:
            raise ValueError(f"XML entry exceeds {LIMITS['xmlEntryBytes']} bytes: {entry}")
        data = bytearray()
        with archive.open(info) as stream:
            while True:
                chunk = stream.read(65536)
                if not chunk:
                    break
                data.extend(chunk)
                self.read_bytes += len(chunk)
                if len(data) > LIMITS["xmlEntryBytes"] or self.read_bytes > LIMITS["inflatedTotalBytes"]:
                    raise ValueError("Actual inflated XML bytes exceed the configured limit")
        # Removing NUL also detects declarations in UTF-16/32 XML. No DTD/entity expansion.
        declarations = bytes(data).replace(b"\x00", b"").upper()
        if b"<!DOCTYPE" in declarations or b"<!ENTITY" in declarations:
            raise ValueError(f"DTD/entity declarations are not supported: {entry}")
        parser = ET.XMLPullParser(events=("start", "end"))
        root, depth = None, 0
        for offset in range(0, len(data), 4096):
            parser.feed(data[offset:offset + 4096])
            for event, element in parser.read_events():
                if event == "start":
                    root = element if root is None else root
                    depth += 1
                    self.xml_nodes += 1
                    if depth > LIMITS["xmlDepth"] or self.xml_nodes > LIMITS["xmlNodes"]:
                        raise ValueError("XML depth/node count exceeds the configured limit")
                else:
                    depth -= 1
        parser.close()
        if root is None:
            raise ValueError(f"Empty XML entry: {entry}")
        return root

    def header(self, root):
        result = {"fontFaces": [], "charPr": [], "paraPr": [], "styles": [], "borderFills": []}
        for face in root.iter():
            if name(face) != "fontface" or not self.take("formatRecords"):
                continue
            fonts = []
            for font in face:
                if name(font) != "font" or not self.take("formatRecords"):
                    continue
                fonts.append(self.structure(font))
                self.font_index[(face.get("lang", "").upper(), self.attribute(font.get("id")))] = self.attribute(font.get("face"))
            result["fontFaces"].append({"rawAttrs": self.attrs(face), "fonts": fonts})
        for element in root.iter():
            tag = name(element)
            if tag not in {"charPr", "paraPr", "style", "borderFill"} or not self.take("formatRecords"):
                continue
            record = {"id": self.attribute(element.get("id")), "rawAttrs": self.attrs(element)}
            properties = [self.structure(child) for child in element]
            record["properties"] = [child for child in properties if child is not None]
            if tag == "charPr":
                record["height"] = measure(record["rawAttrs"].get("height"), "1/100 pt")
                record["bold"] = any(name(child) == "bold" for child in element)
                record["italic"] = any(name(child) == "italic" for child in element)
                record["textColor"] = record["rawAttrs"].get("textColor")
                refs = next((child for child in element if name(child) == "fontRef"), None)
                record["resolvedFonts"] = {} if refs is None else {
                    language: {"fontIDRef": font_id, "face": self.font_index.get((language.upper(), font_id))}
                    for language, font_id in self.attrs(refs).items()
                }
                result["charPr"].append(record)
            else:
                result[{"paraPr": "paraPr", "style": "styles", "borderFill": "borderFills"}[tag]].append(record)
        return result

    def run_text(self, element):
        # A parent run must not absorb nested table/header/caption paragraph text.
        if name(element) in {"p", "tbl"}:
            return ""
        if name(element) == "t":
            def inline(node):
                pieces = [node.text or ""]
                for child in node:
                    kind = name(child)
                    pieces.append({"tab": "\t", "lineBreak": "\n", "nbSpace": "\u00a0", "fwSpace": "\u3000"}.get(kind, inline(child)))
                    pieces.append(child.tail or "")
                return "".join(pieces)
            return inline(element)
        return "".join(self.run_text(child) for child in element)

    def section(self, root, entry, section_index):
        result = {"sectionIndex": section_index, "entry": entry, "rawAttrs": self.attrs(root),
                  "sectionProperties": [], "headersFooters": [], "paragraphs": [], "tables": [], "objects": []}
        top_table_count = 0
        table_ordinal = 0

        def walk(element, xml_path, top_index, context, table_path, paragraph_index=None):
            nonlocal top_table_count, table_ordinal
            tag = name(element)
            local_context = context
            local_tables = table_path
            location = {"sectionIndex": section_index, "topParagraphIndex": top_index, "xmlPath": self.attribute(xml_path)}
            if tag in {"header", "footer", "caption", "drawText", "footNote", "endNote"}:
                local_context = tag
                if tag in {"header", "footer"}:
                    result["headersFooters"].append({**location, "kind": tag,
                        "rawAttrs": self.attrs(element), "property": self.structure(element)})
            if tag in {"secPr", "colPr"}:
                result["sectionProperties"].append({**location, "property": self.structure(element)})
            if tag in {"pic", "rect", "ellipse", "arc", "polygon", "curve", "connectLine", "line", "container", "textart", "equation", "ole", "chart", "video"} and self.take("objects"):
                result["objects"].append({**location, "kind": tag, "tablePath": table_path,
                    "rawAttrs": self.attrs(element), "property": self.structure(element)})
            if tag == "p" and self.take("paragraphs"):
                runs = []
                for run_index, run in enumerate(child for child in element if name(child) == "run"):
                    if not self.take("runs"):
                        break
                    runs.append({"runIndex": run_index, "charPrIDRef": self.attribute(run.get("charPrIDRef")),
                                 "rawAttrs": self.attrs(run), "text": self.text(self.run_text(run)),
                                 "controlTags": [self.attribute(name(child)) for child in run if name(child) != "t"]})
                saved_lines = []
                for array in element:
                    if name(array) == "linesegarray":
                        for segment in array:
                            if name(segment) == "lineseg" and self.take("lineSegments"):
                                saved_lines.append({"rawAttrs": self.attrs(segment), "measurements": self.measurements(segment)})
                result["paragraphs"].append({**location, "location": local_context,
                    "paragraphInContainerIndex": paragraph_index, "xmlParagraphId": self.attribute(element.get("id")),
                    "styleIDRef": self.attribute(element.get("styleIDRef")), "paraPrIDRef": self.attribute(element.get("paraPrIDRef")),
                    "rawAttrs": self.attrs(element), "tablePath": table_path, "runs": runs, "savedLineSegments": saved_lines})
            if tag == "tbl":
                table_step = {"tableOrdinal": table_ordinal, "xmlPath": self.attribute(xml_path)}
                table_ordinal += 1
                if not table_path:
                    table_step["topLevelTableIndex"] = top_table_count
                    top_table_count += 1
                local_tables = table_path + [table_step]
                if self.take("tables"):
                    cells = []
                    for row_index, row in enumerate(child for child in element if name(child) == "tr"):
                        for cell_index, cell in enumerate(child for child in row if name(child) == "tc"):
                            if not self.take("cells"):
                                continue
                            cell_properties = {name(child): self.structure(child) for child in cell if name(child) != "subList"}
                            address = next((child for child in cell if name(child) == "cellAddr"), None)
                            span = next((child for child in cell if name(child) == "cellSpan"), None)
                            cells.append({"physicalRowIndex": row_index, "physicalCellIndex": cell_index,
                                "rawAttrs": self.attrs(cell), "properties": cell_properties,
                                "cellAddr": {} if address is None else self.attrs(address),
                                "cellSpan": {} if span is None else self.attrs(span),
                                "subLists": [self.attrs(child) for child in cell if name(child) == "subList"]})
                    result["tables"].append({**location, "tablePath": local_tables, "rawAttrs": self.attrs(element),
                        "properties": [item for item in (self.structure(child) for child in element if name(child) != "tr") if item],
                        "cells": cells})
            if tag == "tc" and table_path:
                address = next((child for child in element if name(child) == "cellAddr"), None)
                span = next((child for child in element if name(child) == "cellSpan"), None)
                local_tables = table_path[:-1] + [{**table_path[-1],
                    "cellAddr": {} if address is None else self.attrs(address),
                    "cellSpan": {} if span is None else self.attrs(span), "cellXmlPath": self.attribute(xml_path)}]
                local_context = "tableCell"
            counts = {}
            paragraph_sibling_index = 0
            for child in element:
                child_tag = name(child)
                child_index = counts.get(child_tag, 0)
                counts[child_tag] = child_index + 1
                p_index = paragraph_sibling_index if child_tag == "p" else None
                if child_tag == "p":
                    paragraph_sibling_index += 1
                nested_context = local_context
                if child_tag == "p" and local_context == "body":
                    nested_context = "nestedParagraph"
                walk(child, f"{xml_path}/{child_tag}[{child_index}]", top_index, nested_context, local_tables, p_index)

        top_index = 0
        for child_index, child in enumerate(root):
            if name(child) == "p":
                walk(child, f"/sec/p[{top_index}]", top_index, "body", [], top_index)
                top_index += 1
            else:
                walk(child, f"/sec/{name(child)}[{child_index}]", None, "section", [])
        result["topParagraphCount"] = top_index
        return result


def inspect_document(input_path):
    source = Path(input_path)
    if not source.is_absolute() or source.suffix.lower() != ".hwpx":
        raise ValueError("An absolute .hwpx path is required")
    source = source.resolve(strict=True)
    if not source.is_file() or source.stat().st_size > LIMITS["archiveBytes"]:
        raise ValueError("Input must be a regular HWPX file of at most 256 MiB")
    inspector = Inspector()
    with source.open("rb") as file:
        digest = hashlib.file_digest(file, "sha256").hexdigest()
        file.seek(0)
        with zipfile.ZipFile(file) as archive:
            infos = archive.infolist()
            if len(infos) > LIMITS["entries"]:
                raise ValueError("ZIP has more than 4096 entries")
            if any(info.flag_bits & 1 for info in infos):
                raise ValueError("Encrypted ZIP entries are not supported")
            declared_total = sum(info.file_size for info in infos)
            if declared_total > LIMITS["inflatedTotalBytes"]:
                raise ValueError("ZIP declared inflated total exceeds 128 MiB")
            names = [info.filename for info in infos]
            if len(names) != len(set(names)):
                raise ValueError("Duplicate ZIP entry names are ambiguous")
            section_names = sorted((entry for entry in names if re.fullmatch(r"Contents/section\d+\.xml", entry)),
                                   key=lambda entry: int(re.search(r"(\d+)\.xml$", entry).group(1)))
            order_source = "numeric section filename order"
            if "Contents/content.hpf" in names:
                package = inspector.xml(archive, "Contents/content.hpf")
                manifest = {}
                for element in package.iter():
                    if name(element) == "item":
                        href = posixpath.normpath(element.get("href", ""))
                        # HWPX commonly uses archive-root-relative Contents/ paths;
                        # accept package-relative paths as well when present in the ZIP.
                        manifest[element.get("id")] = href if href in names else posixpath.normpath(posixpath.join("Contents", href))
                spine = [manifest.get(element.get("idref")) for element in package.iter() if name(element) == "itemref"]
                ordered = [entry for entry in spine if entry in section_names]
                if ordered and len(ordered) == len(set(ordered)) == len(section_names):
                    section_names, order_source = ordered, "Contents/content.hpf spine"
            if "Contents/header.xml" not in names or not section_names:
                raise ValueError("Missing HWPX header or section XML")
            header = inspector.header(inspector.xml(archive, "Contents/header.xml"))
            sections = [inspector.section(inspector.xml(archive, entry), entry, index)
                        for index, entry in enumerate(section_names)]
    return {
        "schemaVersion": "1.0", "source": str(source), "sourceSha256": digest,
        "untrustedContent": True, "untrustedFields": ["header", "sections"],
        "units": {"HWPUNIT": "1/7200 inch = 1/100 point; mm = value * 25.4 / 7200",
                  "charPr.height": "1/100 point", "charPr.ratio/spacing/relSz/offset": "percent",
                  "lineSpacing": "type=PERCENT means percent regardless of the raw unit attribute; other types preserve declared units",
                  "savedLineSegments": "Saved XML layout hints, not recomputed screen positions; textpos is a UTF-16 offset, flags a bit mask, other recognized metrics HWPUNIT",
                  "objectGeometry": "Raw local coordinates, anchoring modes and affine matrices are retained; unsigned/signed encoding and transforms are not resolved into screen pixels",
                  "borderWidth": "Raw width string (for example '0.12 mm'); no inferred conversion"},
        "archive": {"entryCount": len(infos), "declaredInflatedBytes": declared_total,
                    "xmlBytesRead": inspector.read_bytes, "xmlNodesRead": inspector.xml_nodes},
        "sectionOrderSource": order_source, "header": header, "sections": sections,
        "indexing": "sectionIndex, topParagraphIndex, paragraphInContainerIndex and physical cell indexes are zero-based; cellAddr/cellSpan retain the XML grid coordinates",
        "limits": LIMITS, "truncated": bool(inspector.truncations),
        "truncatedCategories": sorted(inspector.truncations), "emittedCounts": inspector.used,
        "limitations": [
            "XML declarations and references are reported; font availability, fallback, glyph metrics and rendered pagination are not evaluated.",
            "switch/case/default branches are all preserved, without selecting a renderer-specific branch.",
            "XML paragraph IDs are not editing addresses; use sectionIndex/topParagraphIndex, xmlPath and tablePath to locate content.",
            "Table ordinals describe XML traversal order; they are not asserted native editor table indexes.",
            "Only selected formatting/property subtrees are included. Missing properties are not inferred, and this is not a lossless XML dump.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Absolute path to an HWPX file")
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        result = inspect_document(args.input)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, RuntimeError, ET.ParseError) as error:
        print(json.dumps({"ok": False, "error": str(error), "untrustedContent": True, "limits": LIMITS}, ensure_ascii=False))
        return 1
    # Encode incrementally so a pathological summary cannot allocate an unbounded
    # stdout buffer. Limit errors are JSON too, with no partial report emitted.
    chunks, output_bytes = [], 0
    for chunk in json.JSONEncoder(ensure_ascii=False, separators=(",", ":")).iterencode(result):
        output_bytes += len(chunk.encode("utf-8"))
        if output_bytes > LIMITS["outputBytes"]:
            print(json.dumps({"ok": False, "error": "Inspection JSON exceeds the 16 MiB output limit", "limits": LIMITS}))
            return 1
        chunks.append(chunk)
    print("".join(chunks))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
