#!/usr/bin/env python3
"""Fill explicitly selected plain HWPX paragraphs/cells; preserve protected XML.

python fill_form.py --spec /absolute/request.json
Paths are zero-based inspector /sec/... paths; edits may specify sectionIndex.
textColor explicitly permits an appended copy of an existing character style.
"""

import argparse
import copy
import hashlib
import io
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.parsers import expat
from xml.sax.saxutils import escape

from inspect_template import Inspector, LIMITS, name


PARAGRAPH_NS = "http://www.hancom.co.kr/hwpml/2011/paragraph"
TEXT_TAGS = {"p", "run", "t", "linesegarray", "lineseg"}
MAX_EDITS = 256
MAX_NEW_TEXT = 4 * 1024 * 1024


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def hash_file(filename):
    with filename.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def end_of_tag(raw, start):
    quote = None
    for index in range(start, len(raw)):
        value = raw[index]
        if quote:
            if value == quote:
                quote = None
        elif value in (34, 39):
            quote = value
        elif value == 62:
            return index + 1
    raise ValueError("Unterminated XML tag")


class XmlDocument:
    """ET validates semantics; Expat byte ranges permit surgical UTF-8 changes."""

    def __init__(self, raw, inspector, archive, entry):
        self.raw = raw
        try:
            raw.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise ValueError("Only UTF-8 HWPX XML can be surgically edited") from error
        declaration = re.match(br"\xef\xbb\xbf?<\?xml[^>]*|<\?xml[^>]*", raw)
        if declaration and re.search(br"encoding\s*=\s*['\"](?!utf-?8['\"])[^'\"]+", declaration.group(), re.I):
            raise ValueError("Only UTF-8 XML declarations are supported")
        self.root = inspector.xml(archive, entry)
        self.nodes, self.paths = {}, {}

        def index_nodes(element, location):
            self.nodes[location] = element
            self.paths[id(element)] = location
            counts = Counter()
            for child in element:
                tag = name(child)
                index_nodes(child, f"{location}/{tag}[{counts[tag]}]")
                counts[tag] += 1
        index_nodes(self.root, "/" + name(self.root))
        self.spans, stack = {}, []
        parser = expat.ParserCreate()

        def start(qname, attrs):
            local = qname.rsplit(":", 1)[-1]
            if stack:
                sibling = stack[-1]["counts"][local]
                stack[-1]["counts"][local] += 1
                location = f"{stack[-1]['path']}/{local}[{sibling}]"
            else:
                location = "/" + local
            offset = parser.CurrentByteIndex
            opening_end = end_of_tag(raw, offset)
            record = {"path": location, "start": offset, "openingEnd": opening_end,
                      "qname": qname, "selfClosing": raw[offset:opening_end].rstrip().endswith(b"/>"), "counts": Counter()}
            stack.append(record)

        def end(qname):
            record = stack.pop()
            record["closingStart"] = record["openingEnd"] if record["selfClosing"] else parser.CurrentByteIndex
            record["end"] = record["openingEnd"] if record["selfClosing"] else end_of_tag(raw, parser.CurrentByteIndex)
            self.spans[record["path"]] = record
        parser.StartElementHandler, parser.EndElementHandler = start, end
        parser.Parse(raw, True)
        if self.nodes.keys() != self.spans.keys():
            raise ValueError("XML byte paths and parsed element paths do not agree")

    def span(self, element):
        return self.spans[self.paths[id(element)]]

    def opening(self, element):
        span = self.span(element)
        return re.sub(r"/\s*>$", ">", self.raw[span["start"]:span["openingEnd"]].decode("utf-8"))

    def whole(self, element):
        span = self.span(element)
        return self.raw[span["start"]:span["end"]]


def set_attribute(opening, key, value):
    pattern = re.compile(r"(\s" + re.escape(key) + r"\s*=\s*)(['\"])(.*?)\2", re.S)
    def replace(match):
        quoted = escape(str(value), {'"': "&quot;", "'": "&apos;"})
        return match.group(1) + match.group(2) + quoted + match.group(2)
    if pattern.search(opening):
        return pattern.sub(replace, opening, count=1)
    ending = re.search(r"\s*/?>$", opening)
    if not ending:
        raise ValueError("Invalid XML opening tag")
    return opening[:ending.start()] + f' {key}="{escape(str(value), {chr(34): "&quot;"})}"' + opening[ending.start():]


def normalize_path(location):
    if not isinstance(location, str) or len(location) > 4096:
        raise ValueError("xmlPath must be a bounded inspector XML path")
    result = []
    for position, part in enumerate(location.strip("/").split("/")):
        match = re.fullmatch(r"(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)(?:\[(\d+)\])?", part)
        if not match or (position > 0 and match.group(2) is None):
            raise ValueError("xmlPath must use zero-based /sec/p[n]/... inspector indexes")
        tag, index = match.groups()
        if position == 0:
            if tag != "sec" or index not in (None, "0"):
                raise ValueError("xmlPath must start at /sec")
            result.append("sec")
        else:
            result.append(f"{tag}[{int(index)}]")
    return "/" + "/".join(result)


def plain_paragraph(element):
    if element.tag != f"{{{PARAGRAPH_NS}}}p":
        raise ValueError("The selected node must be an HWPX paragraph or table cell")
    runs = []
    for child in element:
        if child.tag == f"{{{PARAGRAPH_NS}}}linesegarray":
            if any(name(segment) != "lineseg" or len(segment) for segment in child):
                raise ValueError("Unexpected content inside saved line segments")
            continue
        if child.tag != f"{{{PARAGRAPH_NS}}}run":
            raise ValueError("Paragraph contains protected formatting/control nodes; plain-text replacement refused")
        for text in child:
            if text.tag != f"{{{PARAGRAPH_NS}}}t" or len(text):
                raise ValueError("Paragraph contains a section/control/table/field/shape or non-plain inline node")
        runs.append(child)
    return runs


def paragraph_text(element):
    return "".join(text.text or "" for run in plain_paragraph(element) for text in run)


def protected_state(root):
    records, counts = [], Counter()
    for element in root.iter():
        tag = name(element)
        if tag not in TEXT_TAGS:
            counts[tag] += 1
            records.append((element.tag, sorted(element.attrib.items())))
        elif tag == "p":
            special = {key: element.get(key) for key in ("pageBreak", "columnBreak", "merged") if element.get(key) not in (None, "0")}
            if special:
                counts["paragraphBreakAttributes"] += 1
                records.append(("paragraphBreakAttributes", sorted(special.items())))
    encoded = json.dumps(records, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return {"counts": dict(sorted(counts.items())), "sha256": sha256(encoded)}


def checked_text(value):
    if not isinstance(value, str):
        raise ValueError("Replacement paragraphs must be strings")
    if any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF or ord(char) in (0xFFFE, 0xFFFF) for char in value):
        raise ValueError("Inline tabs/newlines/control characters are unsupported; use paragraphs for separate lines")
    return value


def apply_patches(raw, patches):
    ordered = sorted(patches, key=lambda item: (item[0], item[1]))
    for previous, current in zip(ordered, ordered[1:]):
        if current[0] < previous[1] or current[:2] == previous[:2]:
            raise ValueError("Edits overlap or select the same XML node")
    for start, end, replacement in reversed(ordered):
        raw = raw[:start] + replacement + raw[end:]
    return raw


def fill_form(spec):
    if not isinstance(spec, dict):
        raise ValueError("A JSON specification object is required")
    source, output = Path(spec.get("input", "")), Path(spec.get("output", ""))
    if not source.is_absolute() or source.suffix.lower() != ".hwpx" or not output.is_absolute() or output.suffix.lower() != ".hwpx":
        raise ValueError("input/output must be absolute .hwpx paths")
    source = source.resolve(strict=True)
    if not source.is_file() or source.stat().st_size > LIMITS["archiveBytes"]:
        raise ValueError("Input must be a regular HWPX file of at most 256 MiB")
    if output.exists() or output.is_symlink():
        raise ValueError("Output already exists; original and existing files are never overwritten")
    expected_hash = spec.get("expectedSourceSha256")
    if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", expected_hash):
        raise ValueError("expectedSourceSha256 is required")
    edits = spec.get("edits")
    if not isinstance(edits, list) or not 1 <= len(edits) <= MAX_EDITS:
        raise ValueError("Provide 1..256 explicit edits")
    if not isinstance(spec.get("dropSavedLineSegments", False), bool):
        raise ValueError("dropSavedLineSegments must be boolean")
    source_bytes = source.read_bytes()
    if len(source_bytes) > LIMITS["archiveBytes"]:
        raise ValueError("Input exceeded the archive byte limit while reading")
    source_hash = sha256(source_bytes)
    if source_hash != expected_hash.lower():
        raise ValueError("Source SHA256 does not match; reread the original before editing")
    inspector = Inspector()
    replacements, reports, cloned_styles = {}, [], []
    with zipfile.ZipFile(io.BytesIO(source_bytes)) as archive:
        infos = archive.infolist()
        if len(infos) > LIMITS["entries"] or sum(info.file_size for info in infos) > LIMITS["inflatedTotalBytes"]:
            raise ValueError("ZIP entry/inflated-size limit exceeded")
        names, payloads, inflated = set(), {}, 0
        for info in infos:
            entry = info.filename
            if entry in names or entry.startswith("/") or "\\" in entry or "\x00" in entry or ":" in entry or any(part in ("", ".", "..") for part in entry.rstrip("/").split("/")):
                raise ValueError("Unsafe or duplicate ZIP entry path")
            if info.flag_bits & 1 or (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Encrypted/symlink ZIP entries are not supported")
            names.add(entry)
            with archive.open(info) as stream:
                chunks, size = [], 0
                while True:
                    chunk = stream.read(65536)
                    if not chunk:
                        break
                    size += len(chunk)
                    inflated += len(chunk)
                    if size > LIMITS["inflatedTotalBytes"] or inflated > LIMITS["inflatedTotalBytes"]:
                        raise ValueError("Actual ZIP inflated bytes exceed 128 MiB")
                    chunks.append(chunk)
                payloads[entry] = b"".join(chunks)
                if entry.lower().endswith((".xml", ".hpf")):
                    if size > LIMITS["xmlEntryBytes"]:
                        raise ValueError("An XML entry exceeds 32 MiB")
                    declarations = payloads[entry].replace(b"\x00", b"").upper()
                    if b"<!DOCTYPE" in declarations or b"<!ENTITY" in declarations:
                        raise ValueError("DTD/entity declarations are not supported")
        if "Contents/header.xml" not in names:
            raise ValueError("HWPX header is missing")
        header = XmlDocument(payloads["Contents/header.xml"], inspector, archive, "Contents/header.xml")
        properties = [element for element in header.root.iter() if name(element) == "charProperties"]
        if len(properties) != 1:
            raise ValueError("Expected one character-properties registry")
        char_properties = properties[0]
        chars = {element.get("id"): element for element in char_properties if name(element) == "charPr"}
        if len(chars) != len(char_properties) or any(key is None or not key.isdecimal() for key in chars):
            raise ValueError("Ambiguous character-style registry")
        next_char_id = max(map(int, chars), default=-1) + 1
        clone_cache = {}

        def style_for(edit, paragraph=None, first_run=None):
            nonlocal next_char_id
            if first_run is None and paragraph is not None:
                runs = plain_paragraph(paragraph)
                first_run = runs[0] if runs else None
            chosen = edit.get("charPrIDRef")
            if chosen is not None and (not isinstance(chosen, str) or chosen not in chars):
                raise ValueError("charPrIDRef must name an existing header character style")
            base_id = chosen if chosen is not None else first_run.get("charPrIDRef") if first_run is not None else None
            color = edit.get("textColor")
            if color is None:
                return chosen
            if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
                raise ValueError("textColor must be an explicit #RRGGBB value")
            color = color.upper()
            if base_id not in chars:
                raise ValueError("Color changes require an existing source character-style reference")
            if (chars[base_id].get("textColor") or "").upper() == color:
                return base_id
            if (base_id, color) not in clone_cache:
                if next_char_id > 0xFFFFFFFF:
                    raise ValueError("No unsigned character-style ID is available")
                new_id = str(next_char_id)
                next_char_id += 1
                element = chars[base_id]
                span = header.span(element)
                original = header.whole(element).decode("utf-8")
                original_opening = header.raw[span["start"]:span["openingEnd"]].decode("utf-8")
                new_opening = set_attribute(set_attribute(original_opening, "id", new_id), "textColor", color)
                clone = (new_opening + original[len(original_opening):]).encode("utf-8")
                clone_cache[(base_id, color)] = (new_id, clone)
                cloned_styles.append({"sourceId": base_id, "id": new_id, "fromTextColor": element.get("textColor"),
                                      "textColor": color, "otherStyleBytesPreserved": True})
            return clone_cache[(base_id, color)][0]

        section_names = sorted((entry for entry in names if re.fullmatch(r"Contents/section\d+\.xml", entry)),
                               key=lambda value: int(re.search(r"(\d+)\.xml$", value).group(1)))
        if "Contents/content.hpf" in names:
            package = inspector.xml(archive, "Contents/content.hpf")
            manifest = {element.get("id"): element.get("href") for element in package.iter() if name(element) == "item"}
            ordered = []
            for element in package.iter():
                if name(element) == "itemref":
                    entry = manifest.get(element.get("idref"), "")
                    entry = entry if entry in names else "Contents/" + entry
                    if entry in section_names:
                        ordered.append(entry)
            if len(ordered) == len(set(ordered)) == len(section_names):
                section_names = ordered
        if not section_names:
            raise ValueError("HWPX has no section XML")
        sections = [XmlDocument(payloads[entry], inspector, archive, entry) for entry in section_names]
        p_ids = {int(element.get("id")) for document in sections for element in document.root.iter()
                 if name(element) == "p" and (element.get("id") or "").isdecimal()}
        next_p_id = max(p_ids, default=-1) + 1

        def allocate_p_id():
            nonlocal next_p_id
            while next_p_id in p_ids or next_p_id > 0xFFFFFFFF:
                next_p_id = 0 if next_p_id > 0xFFFFFFFF else next_p_id + 1
            result = str(next_p_id)
            p_ids.add(next_p_id)
            next_p_id += 1
            return result

        def render_paragraph(document, paragraph, text, char_id, new=False):
            runs = plain_paragraph(paragraph)
            run = runs[0] if runs else None
            p_open = document.opening(paragraph)
            p_qname = document.span(paragraph)["qname"]
            prefix = p_qname.rsplit(":", 1)[0] + ":" if ":" in p_qname else ""
            if new:
                p_open = set_attribute(p_open, "id", allocate_p_id())
                for key in ("pageBreak", "columnBreak", "merged"):
                    if key in paragraph.attrib:
                        p_open = set_attribute(p_open, key, "0")
            run_qname = document.span(run)["qname"] if run is not None else prefix + "run"
            run_open = document.opening(run) if run is not None else f"<{run_qname}>"
            if char_id is not None:
                run_open = set_attribute(run_open, "charPrIDRef", char_id)
            text_node = next(iter(run), None) if run is not None else None
            t_qname = document.span(text_node)["qname"] if text_node is not None else prefix + "t"
            t_open = document.opening(text_node) if text_node is not None else f"<{t_qname}>"
            return (p_open + run_open + t_open + escape(text) + f"</{t_qname}></{run_qname}></{p_qname}>").encode("utf-8")

        grouped = {}
        changed_paragraphs = {}
        new_text_size = 0
        for edit in edits:
            if not isinstance(edit, dict):
                raise ValueError("Each edit must be an object")
            section_index = edit.get("sectionIndex", 0)
            if not isinstance(section_index, int) or isinstance(section_index, bool) or not 0 <= section_index < len(sections):
                raise ValueError("sectionIndex is out of range")
            document = sections[section_index]
            location = normalize_path(edit.get("xmlPath"))
            element = document.nodes.get(location)
            if element is None or name(element) not in ("p", "tc", "t"):
                raise ValueError("xmlPath must select an existing paragraph, table cell, or childless text leaf")
            if ("text" in edit) == ("paragraphs" in edit):
                raise ValueError("Each edit needs exactly one of text or paragraphs")
            texts = [edit["text"]] if "text" in edit else edit["paragraphs"]
            if not isinstance(texts, list) or not 1 <= len(texts) <= 256:
                raise ValueError("paragraphs must contain 1..256 plain strings")
            texts = [checked_text(text) for text in texts]
            new_text_size += sum(len(text.encode("utf-8")) for text in texts)
            if new_text_size > MAX_NEW_TEXT:
                raise ValueError("Replacement text exceeds 4 MiB")
            if name(element) == "t":
                if element.tag != f"{{{PARAGRAPH_NS}}}t" or len(element) or "text" not in edit:
                    raise ValueError("A text-leaf edit requires text and a childless hp:t")
                parent_path = location.rsplit("/", 1)[0]
                run = document.nodes.get(parent_path)
                if run is None or run.tag != f"{{{PARAGRAPH_NS}}}run":
                    raise ValueError("A text leaf must be directly inside hp:run")
                original_text = element.text or ""
                if "expectedText" in edit and edit["expectedText"] != original_text:
                    raise ValueError(f"Expected text mismatch at {location}")
                style_requested = "charPrIDRef" in edit or "textColor" in edit
                if style_requested and sum(child.tag == f"{{{PARAGRAPH_NS}}}t" for child in run) != 1:
                    raise ValueError("A run with multiple text leaves cannot receive a style override")
                char_id = style_for(edit, first_run=run)
                target_span = document.span(element)
                text_qname = target_span["qname"]
                replacement = (document.opening(element) + escape(texts[0]) + f"</{text_qname}>").encode("utf-8")
                grouped.setdefault(section_index, []).append((target_span["start"], target_span["end"], replacement))
                if char_id is not None and char_id != run.get("charPrIDRef"):
                    run_span = document.span(run)
                    updated = set_attribute(document.opening(run), "charPrIDRef", char_id).encode("utf-8")
                    grouped[section_index].append((run_span["start"], run_span["openingEnd"], updated))
                ancestor = parent_path
                while ancestor in document.nodes and name(document.nodes[ancestor]) != "p":
                    ancestor = ancestor.rsplit("/", 1)[0]
                if ancestor not in document.nodes:
                    raise ValueError("Text leaf has no containing paragraph")
                changed_paragraphs.setdefault(section_index, set()).add(ancestor)
                reports.append({"sectionIndex": section_index, "xmlPath": location, "target": "t",
                    "paragraphCountBefore": 1, "paragraphCountAfter": 1, "sourceCharacterCount": len(original_text),
                    "characterCount": len(texts[0]), "charPrIDRefOverride": char_id})
                continue
            if name(element) == "p":
                if len(texts) != 1:
                    raise ValueError("A paragraph target accepts one paragraph; select a table cell for multiple paragraphs")
                originals = [element]
                target_span = document.span(element)
            else:
                sublists = [child for child in element if child.tag == f"{{{PARAGRAPH_NS}}}subList"]
                if len(sublists) != 1 or not len(sublists[0]) or any(child.tag != f"{{{PARAGRAPH_NS}}}p" for child in sublists[0]):
                    raise ValueError("Cell must have one subList containing only plain paragraphs")
                originals = list(sublists[0])
                for paragraph in originals[1:]:
                    if any(paragraph.get(key) not in (None, "0") for key in ("pageBreak", "columnBreak", "merged")):
                        raise ValueError("Cell contains protected paragraph break/merge attributes")
                target_span = {"start": document.span(originals[0])["start"], "end": document.span(originals[-1])["end"]}
            try:
                original_text = "\n".join(paragraph_text(paragraph) for paragraph in originals)
            except ValueError as error:
                raise ValueError(f"{location}: {error}") from error
            if "expectedText" in edit and edit["expectedText"] != original_text:
                raise ValueError(f"Expected text mismatch at {location}")
            char_id = style_for(edit, originals[0])
            replacement = b"".join(render_paragraph(document, originals[0], text, char_id, index > 0) for index, text in enumerate(texts))
            grouped.setdefault(section_index, []).append((target_span["start"], target_span["end"], replacement))
            changed_paragraphs.setdefault(section_index, set()).update(document.paths[id(paragraph)] for paragraph in originals)
            reports.append({"sectionIndex": section_index, "xmlPath": location, "target": name(element),
                            "paragraphCountBefore": len(originals), "paragraphCountAfter": len(texts),
                            "sourceCharacterCount": len(original_text), "characterCount": sum(map(len, texts)),
                            "charPrIDRefOverride": char_id})

        before_counts, after_counts, before_signatures, after_signatures = Counter(), Counter(), {}, {}
        dropped_arrays = 0
        final_roots = []
        for section_index, document in enumerate(sections):
            before = protected_state(document.root)
            before_counts.update(before["counts"])
            before_signatures[section_names[section_index]] = before["sha256"]
            patches = grouped.get(section_index, [])
            selected_ranges = [(start, end) for start, end, _ in patches]
            for element in document.root.iter():
                if name(element) != "linesegarray":
                    continue
                span = document.span(element)
                inside = any(start <= span["start"] and span["end"] <= end for start, end in selected_ranges)
                parent_path = document.paths[id(element)].rsplit("/", 1)[0]
                if inside:
                    dropped_arrays += 1
                elif parent_path in changed_paragraphs.get(section_index, set()) or (patches and spec.get("dropSavedLineSegments", False)):
                    patches.append((span["start"], span["end"], b""))
                    dropped_arrays += 1
            raw = apply_patches(document.raw, patches)
            if len(raw) > LIMITS["xmlEntryBytes"]:
                raise ValueError("Edited section exceeds the XML byte limit")
            root = ET.fromstring(raw)
            after = protected_state(root)
            if before != after:
                raise ValueError("Protected control/formatting nodes changed; output refused")
            after_counts.update(after["counts"])
            after_signatures[section_names[section_index]] = after["sha256"]
            final_roots.append(root)
            if raw != document.raw:
                replacements[section_names[section_index]] = raw

        if cloned_styles:
            if int(char_properties.get("itemCnt", "-1")) != len(chars):
                raise ValueError("Character-property itemCnt does not match existing records")
            span = header.span(char_properties)
            opening = header.raw[span["start"]:span["openingEnd"]].decode("utf-8")
            updated = set_attribute(opening, "itemCnt", str(len(chars) + len(cloned_styles))).encode("utf-8")
            replacements["Contents/header.xml"] = apply_patches(header.raw, [
                (span["start"], span["openingEnd"], updated),
                (span["closingStart"], span["closingStart"], b"".join(value[1] for value in clone_cache.values())),
            ])
            new_header = ET.fromstring(replacements["Contents/header.xml"])
            old_chars = [header.whole(element) for element in chars.values()]
            for old in old_chars:
                if old not in replacements["Contents/header.xml"]:
                    raise ValueError("An existing character-style record changed unexpectedly")
            if len([element for element in new_header.iter() if name(element) == "charPr"]) != len(chars) + len(cloned_styles):
                raise ValueError("Appended character-style registry validation failed")

        preview_lines = []
        for root in final_roots:
            for paragraph in root.iter():
                if name(paragraph) == "p":
                    # Only the paragraph's own text; nested cells appear separately.
                    own = "".join("".join(text.itertext()) for run in paragraph if name(run) == "run" for text in run if name(text) == "t")
                    if own:
                        preview_lines.append(own)
        preview = ("\r\n".join(preview_lines) + "\r\n").encode("utf-8")
        if preview != payloads.get("Preview/PrvText.txt"):
            replacements["Preview/PrvText.txt"] = preview
        new_total = sum(len(replacements.get(entry, data)) for entry, data in payloads.items())
        if "Preview/PrvText.txt" not in payloads:
            new_total += len(preview)
        if new_total > LIMITS["inflatedTotalBytes"]:
            raise ValueError("Edited ZIP would exceed 128 MiB inflated")
        if hash_file(source) != source_hash:
            raise ValueError("Original changed during preparation; output refused")
        output.parent.mkdir(parents=True, exist_ok=True)
        created = False
        try:
            with output.open("xb") as target:
                created = True
                with zipfile.ZipFile(target, "w") as destination:
                    destination.comment = archive.comment
                    for info in infos:
                        destination.writestr(copy.copy(info), replacements.get(info.filename, payloads[info.filename]))
                    if "Preview/PrvText.txt" not in payloads:
                        destination.writestr("Preview/PrvText.txt", preview, compress_type=zipfile.ZIP_DEFLATED)
            if hash_file(source) != source_hash:
                raise ValueError("Original changed while saving; output refused")
        except Exception:
            if created:
                output.unlink(missing_ok=True)
            raise
    return {"ok": True, "input": str(source), "output": str(output), "sourceSha256": source_hash,
            "outputSha256": hash_file(output), "editedCount": len(edits), "edits": reports,
            "changedEntries": sorted(replacements), "headerChanged": "Contents/header.xml" in replacements,
            "clonedStyles": cloned_styles, "droppedSavedLineSegmentArrays": dropped_arrays,
            "controlCounts": {"before": dict(sorted(before_counts.items())), "after": dict(sorted(after_counts.items()))},
            "protectedControlSha256": {"before": before_signatures, "after": after_signatures},
            "untrustedContent": True,
            "limitations": ["Only explicitly selected plain text was replaced; cell geometry and protected controls were preserved.",
                            "Untouched ZIP entry payload bytes are preserved; ZIP compression/container bytes can differ.",
                            "Saved line segments were removed from changed paragraphs (or all paragraphs in changed sections when requested). Re-typeset and visually inspect the result.",
                            "Preview/PrvText.txt was refreshed; the original preview bitmap was preserved and may be stale.",
                            "Explicit textColor overrides append copied character styles; this intentional formatting change is reported separately."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", required=True, help="JSON specification file")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        spec_path = Path(args.spec)
        if spec_path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError("Specification exceeds 8 MiB")
        result = fill_form(json.loads(spec_path.read_text(encoding="utf-8-sig")))
    except (OSError, ValueError, KeyError, RuntimeError, zipfile.BadZipFile, ET.ParseError, expat.ExpatError) as error:
        print(json.dumps({"ok": False, "error": str(error), "untrustedContent": True}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
