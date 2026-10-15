#!/usr/bin/env python3
"""Replace one embedded PNG/JPEG/BMP in HWPX; keep other ZIP payloads exact.

Accept a JSON request with --stdin or --spec FILE. input/output/image must be
absolute paths; expectedSourceSha256 and one binaryItemId/manifestHref are required.
No image generation, conversion, document XML rewrite or native-engine save occurs.
"""

import argparse
import copy
import hashlib
import io
import json
import posixpath
import re
import struct
import sys
import zipfile
import zlib
from pathlib import Path
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET


MAX_ARCHIVE = 256 * 1024 * 1024
MAX_INFLATED = 256 * 1024 * 1024
MAX_IMAGE = 64 * 1024 * 1024
MAX_XML = 32 * 1024 * 1024
MAX_ENTRIES = 4096
MAX_PIXELS = 64 * 1024 * 1024
PACKAGE = "Contents/content.hpf"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(filename):
    with filename.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def local_name(value):
    return value.rsplit("}", 1)[-1]


def dimensions(width, height):
    if not 1 <= width <= 32768 or not 1 <= height <= 32768 or width * height > MAX_PIXELS:
        raise ValueError("Image dimensions exceed the supported 32768-pixel/64-Mpixel limits")
    return {"width": width, "height": height}


def png_info(data):
    offset, chunks, idat, header, palette = 8, [], [], None, False
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError("Truncated PNG chunk")
        size = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        end = offset + 12 + size
        if end > len(data) or not re.fullmatch(b"[A-Za-z]{4}", kind):
            raise ValueError("Invalid PNG chunk")
        payload = data[offset + 8:offset + 8 + size]
        crc = struct.unpack_from(">I", data, offset + 8 + size)[0]
        if zlib.crc32(kind + payload) & 0xFFFFFFFF != crc:
            raise ValueError("PNG chunk CRC does not match")
        if kind == b"IHDR":
            if chunks or size != 13:
                raise ValueError("PNG must start with one 13-byte IHDR")
            header = struct.unpack(">IIBBBBB", payload)
        elif kind == b"IDAT":
            if not header or (b"IDAT" in chunks and chunks[-1] != b"IDAT"):
                raise ValueError("Invalid PNG image-data order")
            idat.append(payload)
        elif kind == b"PLTE":
            if palette or idat or not size or size % 3 or size > 768:
                raise ValueError("Invalid PNG palette")
            palette = True
        elif kind == b"acTL":
            raise ValueError("Animated PNG is not supported; supply a static PNG")
        elif kind not in (b"IEND",) and kind[:1].isupper():
            raise ValueError("Unsupported critical PNG chunk")
        chunks.append(kind)
        offset = end
        if kind == b"IEND":
            if size or offset != len(data):
                raise ValueError("Invalid PNG end marker or trailing data")
            break
    if not header or not idat or not chunks or chunks[-1] != b"IEND":
        raise ValueError("PNG header, image data or end marker is missing")
    width, height, depth, color, compression, filtering, interlace = header
    result = dimensions(width, height)
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
    allowed = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}
    if color not in channels or depth not in allowed[color] or compression or filtering or interlace not in (0, 1):
        raise ValueError("Unsupported PNG pixel format")
    if color == 3 and not palette:
        raise ValueError("Indexed PNG has no palette")
    passes = [(0, 0, 1, 1)] if not interlace else [(0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8),
        (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)]
    rows = []
    for x, y, dx, dy in passes:
        columns, count = max(0, (width - x + dx - 1) // dx), max(0, (height - y + dy - 1) // dy)
        if columns and count:
            rows.append((((columns * channels[color] * depth + 7) // 8) + 1, count))
    expected = sum(size * count for size, count in rows)
    if expected > MAX_INFLATED:
        raise ValueError("PNG decoded scanlines exceed 256 MiB")
    decoder = zlib.decompressobj()
    pixels = decoder.decompress(b"".join(idat), expected + 1)
    if len(pixels) != expected or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError("PNG compressed scanlines are invalid or exceed declared dimensions")
    cursor = 0
    for size, count in rows:
        for _ in range(count):
            if pixels[cursor] > 4:
                raise ValueError("Invalid PNG scanline filter")
            cursor += size
    return {"format": "PNG", "mediaType": "image/png", **result}


def jpeg_info(data):
    offset, frame, scans, ended = 2, None, 0, False
    # JPEG marker parsing validates framing/dimensions, not entropy coefficients.
    while offset < len(data):
        if data[offset] != 0xFF:
            raise ValueError("Invalid JPEG marker")
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            raise ValueError("Truncated JPEG marker")
        marker = data[offset]
        offset += 1
        if marker == 0xD9:
            ended = True
            if offset != len(data):
                raise ValueError("JPEG trailing data is not supported")
            break
        if marker in (0x00, 0xD8) or 0xD0 <= marker <= 0xD7:
            raise ValueError("Unexpected standalone JPEG marker")
        if offset + 2 > len(data):
            raise ValueError("Truncated JPEG segment")
        size = struct.unpack_from(">H", data, offset)[0]
        if size < 2 or offset + size > len(data):
            raise ValueError("Invalid JPEG segment length")
        payload = data[offset + 2:offset + size]
        offset += size
        if marker in (0xC0, 0xC1, 0xC2):
            if frame or len(payload) < 6:
                raise ValueError("Invalid JPEG frame")
            precision, height, width, count = struct.unpack_from(">BHHB", payload)
            if precision != 8 or count not in (1, 3, 4) or len(payload) != 6 + count * 3:
                raise ValueError("Only 8-bit baseline/extended/progressive JPEG is supported")
            frame = dimensions(width, height)
        elif marker in (0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            raise ValueError("Unsupported JPEG frame coding")
        elif marker == 0xDA:
            if not frame or len(payload) < 6 or len(payload) != 4 + payload[0] * 2:
                raise ValueError("Invalid JPEG scan header")
            scans += 1
            start = offset
            while offset < len(data):
                if data[offset] != 0xFF:
                    offset += 1
                    continue
                next_byte = offset + 1
                while next_byte < len(data) and data[next_byte] == 0xFF:
                    next_byte += 1
                if next_byte >= len(data):
                    raise ValueError("Truncated JPEG scan")
                if data[next_byte] == 0 or 0xD0 <= data[next_byte] <= 0xD7:
                    offset = next_byte + 1
                else:
                    break
            if offset == start:
                raise ValueError("Empty JPEG scan")
    if not ended or not frame or not scans:
        raise ValueError("JPEG frame, scan or end marker is missing")
    return {"format": "JPEG", "mediaType": "image/jpeg", **frame}


def image_info(data):
    if not data or len(data) > MAX_IMAGE:
        raise ValueError("Embedded/replacement image must be at most 64 MiB")
    if data.startswith(PNG_SIGNATURE):
        return png_info(data)
    if data.startswith(b"\xff\xd8"):
        return jpeg_info(data)
    if data.startswith(b"BM"):
        return bmp_info(data)
    raise ValueError("Only static PNG, 8-bit JPEG and uncompressed Windows BMP images are supported; no format conversion is performed")


def bmp_info(data):
    if len(data) < 54:
        raise ValueError("Truncated Windows BMP header")
    file_size, reserved1, reserved2, pixel_offset, dib_size = struct.unpack_from("<IHHII", data, 2)
    if file_size != len(data) or reserved1 or reserved2 or dib_size not in (40, 52, 56, 108, 124) or 14 + dib_size > len(data):
        raise ValueError("Unsupported or inconsistent Windows BMP header")
    width, height, planes, depth, compression, image_size = struct.unpack_from("<iiHHII", data, 18)
    result = dimensions(width, abs(height))
    if planes != 1 or depth not in (1, 4, 8, 16, 24, 32) or compression not in (0, 3, 6):
        raise ValueError("Only uncompressed/bitfield Windows BMP is supported")
    if compression in (3, 6) and depth not in (16, 32):
        raise ValueError("BMP bitfields require 16/32-bit pixels")
    colors = struct.unpack_from("<I", data, 46)[0]
    if colors > 256 or (depth <= 8 and colors > 1 << depth):
        raise ValueError("BMP color-table size is invalid")
    palette = (colors or 1 << depth) * 4 if depth <= 8 else colors * 4
    masks = (16 if compression == 6 else 12) if dib_size == 40 and compression else 0
    minimum_offset = 14 + dib_size + masks + palette
    stride = ((width * depth + 31) // 32) * 4
    required = stride * abs(height)
    if pixel_offset < minimum_offset or pixel_offset > len(data) or required > len(data) - pixel_offset or image_size not in (0, required):
        raise ValueError("BMP pixel offset/scanline size is invalid")
    return {"format": "BMP", "mediaType": "image/bmp", **result}


def xml_root(data):
    if len(data) > MAX_XML:
        raise ValueError("XML payload exceeds 32 MiB")
    declarations = data.replace(b"\x00", b"").upper()
    if b"<!DOCTYPE" in declarations or b"<!ENTITY" in declarations:
        raise ValueError("DTD/entity declarations are not supported")
    root = ET.fromstring(data)
    # ElementTree is only used for bounded read-only inspection, never XML writing.
    pending = [(root, 1)]
    count = 0
    while pending:
        node, depth = pending.pop()
        count += 1
        if depth > 256 or count > 300000:
            raise ValueError("XML depth/node limit exceeded")
        pending.extend((child, depth + 1) for child in node)
    return root


def archive_payloads(archive):
    infos = archive.infolist()
    if len(infos) > MAX_ENTRIES or sum(info.file_size for info in infos) > MAX_INFLATED:
        raise ValueError("ZIP entry/inflated-size limit exceeded")
    payloads, total = {}, 0
    for info in infos:
        entry = info.filename
        if len(entry) > 4096 or entry in payloads or entry.startswith("/") or "\\" in entry or "\x00" in entry or ":" in entry or any(part in ("", ".", "..") for part in entry.rstrip("/").split("/")):
            raise ValueError("Unsafe or duplicate ZIP entry path")
        if info.flag_bits & 1 or (info.external_attr >> 16) & 0o170000 == 0o120000:
            raise ValueError("Encrypted/symlink ZIP entries are not supported")
        if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise ValueError("Only stored/deflated HWPX ZIP entries are supported")
        chunks, size = [], 0
        with archive.open(info) as stream:
            while chunk := stream.read(65536):
                size += len(chunk)
                total += len(chunk)
                if size > MAX_INFLATED or total > MAX_INFLATED:
                    raise ValueError("Actual inflated ZIP bytes exceed 256 MiB")
                chunks.append(chunk)
        payloads[entry] = b"".join(chunks)
    return infos, payloads


def manifest_entry(href, payloads):
    if not isinstance(href, str) or not href or "\\" in href or "\x00" in href:
        raise ValueError("Invalid embedded manifest href")
    parts = urlsplit(href)
    if parts.scheme or parts.netloc or parts.query or parts.fragment or parts.path.startswith("/"):
        raise ValueError("Only local embedded manifest hrefs are supported")
    decoded = unquote(parts.path, encoding="utf-8", errors="strict")
    candidates = {candidate for value in {parts.path, decoded} for candidate in
        (value, posixpath.normpath(posixpath.join("Contents", value))) if candidate in payloads}
    if len(candidates) != 1:
        raise ValueError("Manifest href has no unique ZIP payload")
    entry = candidates.pop()
    if not entry.startswith("BinData/"):
        raise ValueError("Only existing embedded BinData images can be replaced")
    return entry


def replace_image(spec):
    if not isinstance(spec, dict):
        raise ValueError("A JSON request object is required")
    allowed = {"input", "output", "image", "expectedSourceSha256", "binaryItemId", "manifestHref"}
    if set(spec) - allowed:
        raise ValueError("Unknown image replacement request property")
    paths = {}
    for key in ("input", "output", "image"):
        value = spec.get(key)
        if not isinstance(value, str) or not value or not Path(value).is_absolute():
            raise ValueError(f"{key} must be an absolute local file path")
        paths[key] = Path(value)
    source, output, image = (paths[key] for key in ("input", "output", "image"))
    if source.suffix.lower() != ".hwpx" or output.suffix.lower() != ".hwpx":
        raise ValueError("input/output must be absolute .hwpx paths")
    source, image = source.resolve(strict=True), image.resolve(strict=True)
    if not source.is_file() or source.stat().st_size > MAX_ARCHIVE or not image.is_file() or image.stat().st_size > MAX_IMAGE:
        raise ValueError("Input must be a regular HWPX <=256 MiB and replacement image <=64 MiB")
    if output.exists() or output.is_symlink():
        raise ValueError("Output already exists; source and existing files are never overwritten")
    expected = spec.get("expectedSourceSha256")
    if not isinstance(expected, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", expected):
        raise ValueError("expectedSourceSha256 is required")
    selectors = [key for key in ("binaryItemId", "manifestHref") if key in spec]
    if len(selectors) != 1 or not isinstance(spec[selectors[0]], str) or not spec[selectors[0]].strip() or len(spec[selectors[0]]) > 4096:
        raise ValueError("Specify exactly one nonempty binaryItemId or manifestHref")
    source_bytes, image_bytes = source.read_bytes(), image.read_bytes()
    if len(source_bytes) > MAX_ARCHIVE:
        raise ValueError("Source exceeds the archive byte limit")
    source_hash, image_hash = digest(source_bytes), digest(image_bytes)
    if source_hash != expected.lower():
        raise ValueError("Source SHA256 does not match; reread the document before editing")
    replacement = image_info(image_bytes)
    created = False
    with zipfile.ZipFile(io.BytesIO(source_bytes)) as archive:
        infos, payloads = archive_payloads(archive)
        if PACKAGE not in payloads or payloads.get("mimetype", b"").strip() != b"application/hwp+zip":
            raise ValueError("HWPX mimetype or Contents/content.hpf is missing")
        package = xml_root(payloads[PACKAGE])
        manifests = [node for node in package if local_name(node.tag) == "manifest"]
        if len(manifests) != 1:
            raise ValueError("Expected one content.hpf manifest")
        items = [node for node in manifests[0] if local_name(node.tag) == "item"]
        ids = [node.get("id") for node in items]
        if any(not value or len(value) > 256 for value in ids) or len(ids) != len(set(ids)):
            raise ValueError("Manifest item IDs are missing or ambiguous")
        if any(len(node.get("href", "")) > 4096 for node in items):
            raise ValueError("Manifest href exceeds 4096 characters")
        selected = [node for node in items if node.get("id" if selectors[0] == "binaryItemId" else "href") == spec[selectors[0]]]
        if not selected:
            raise ValueError("Selected binaryItemId/manifestHref does not exist")
        entries = {manifest_entry(node.get("href"), payloads) for node in selected}
        if len(entries) != 1:
            raise ValueError("Selected manifest href is ambiguous")
        target = entries.pop()
        aliases = []
        for node in items:
            try:
                entry = manifest_entry(node.get("href"), payloads)
            except ValueError:
                continue
            if entry == target:
                media_types = {replacement["mediaType"]}
                if replacement["format"] == "BMP":
                    media_types.update(("image/x-ms-bmp", "image/x-bmp"))
                if node.get("isEmbeded", "1") != "1" or node.get("media-type") not in media_types:
                    raise ValueError("Replacement must keep the existing PNG/JPEG/BMP manifest media type; conversion is refused")
                aliases.append(node.get("id"))
        original = image_info(payloads[target])
        if original["format"] != replacement["format"]:
            raise ValueError("Image format conversion is refused; keep the existing PNG/JPEG/BMP format")
        suffixes = {"PNG": (".png",), "JPEG": (".jpg", ".jpeg", ".jpe"), "BMP": (".bmp",)}
        if posixpath.splitext(target)[1].lower() not in suffixes[original["format"]]:
            raise ValueError("Embedded image extension does not match its PNG/JPEG/BMP bytes")
        xml_hashes, references, reference_count = {}, [], 0
        for entry, raw in payloads.items():
            if entry.lower().endswith((".xml", ".hpf")):
                root = package if entry == PACKAGE else xml_root(raw)
                xml_hashes[entry] = digest(raw)
                for node in root.iter():
                    matches = [value for key, value in node.attrib.items() if local_name(key).lower() == "binaryitemidref" and value in aliases]
                    if matches:
                        reference_count += 1
                        if len(references) < 64:
                            references.append({"entry": entry, "element": local_name(node.tag), "binaryItemId": matches[0]})
        if not reference_count:
            raise ValueError("Selected BinData has no image reference in document XML")
        if sum(map(len, payloads.values())) - len(payloads[target]) + len(image_bytes) > MAX_INFLATED:
            raise ValueError("Replacement would exceed the inflated ZIP byte limit")
        if file_hash(source) != source_hash or file_hash(image) != image_hash:
            raise ValueError("Source or replacement image changed during preparation")
        output.parent.mkdir(parents=True, exist_ok=True)
        try:
            with output.open("xb") as stream:
                created = True
                with zipfile.ZipFile(stream, "w") as destination:
                    destination.comment = archive.comment
                    for info in infos:
                        destination.writestr(copy.copy(info), image_bytes if info.filename == target else payloads[info.filename])
            with zipfile.ZipFile(output) as saved:
                if saved.namelist() != [info.filename for info in infos] or saved.comment != archive.comment:
                    raise ValueError("Saved ZIP order/comment verification failed")
                for entry, old in payloads.items():
                    wanted = image_bytes if entry == target else old
                    if saved.read(entry) != wanted:
                        raise ValueError(f"Saved ZIP payload verification failed: {entry}")
            if file_hash(source) != source_hash or file_hash(image) != image_hash:
                raise ValueError("Source or replacement image changed while saving")
        except Exception:
            if created:
                output.unlink(missing_ok=True)
            raise
    ratio_changed = original["width"] * replacement["height"] != replacement["width"] * original["height"]
    changed = digest(payloads[target]) != image_hash
    return {"ok": True, "input": str(source), "output": str(output), "image": str(image),
        "sourceSha256": source_hash, "outputSha256": file_hash(output), "imageSha256": image_hash,
        "target": {"entry": target, "binaryItemIds": aliases[:64], "binaryItemIdCount": len(aliases),
            "manifestHrefs": [node.get("href") for node in items if node.get("id") in aliases][:64], "aliasesTruncated": len(aliases) > 64},
        "originalImage": {**original, "sha256": digest(payloads[target])}, "replacementImage": {**replacement, "sha256": image_hash},
        "changedEntries": [target] if changed else [], "preservedEntryCount": len(infos) - int(changed),
        "verification": {"onlySelectedImagePayloadChanged": True, "allXmlPayloadsByteIdentical": True,
            "manifestByteIdentical": True, "picturePropertiesUnchanged": True,
            "xmlPayloadCount": len(xml_hashes), "xmlSha256": dict(list(xml_hashes.items())[:64]), "xmlSha256Truncated": len(xml_hashes) > 64,
            "allXmlInventorySha256": digest(json.dumps(xml_hashes, sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode())},
        "referenceCount": reference_count, "references": references, "referencesTruncated": reference_count > len(references),
        "sharedImage": reference_count > 1 or len(aliases) > 1, "aspectRatioChanged": ratio_changed,
        "requiresVisualReview": True, "untrustedContent": True,
        "limitations": ["No image generation or format conversion occurs; only the selected existing BinData payload is replaced.",
            "All references to this shared BinData payload use the replacement image.",
            "Anchor, crop, dimensions, transforms, wrapping and other XML bytes are unchanged; a different aspect ratio may distort or crop the new image.",
            "PNG scanlines, JPEG marker framing/dimensions and uncompressed BMP headers/scanline bounds are validated; full JPEG/BMP decoding and rendered fidelity require visual review.",
            "Untouched ZIP payload bytes are preserved; ZIP container/compression bytes can differ. Existing preview bitmaps may be stale. Re-render and inspect the saved HWPX."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--stdin", action="store_true")
    source.add_argument("--spec", help="JSON request file")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        if args.stdin:
            raw = sys.stdin.buffer.read(65537)
        else:
            with Path(args.spec).open("rb") as stream:
                raw = stream.read(65537)
        if len(raw) > 65536:
            raise ValueError("Request exceeds 64 KiB")
        result = replace_image(json.loads(raw.decode("utf-8-sig")))
    except (OSError, ValueError, KeyError, RuntimeError, zipfile.BadZipFile, ET.ParseError, zlib.error, struct.error) as error:
        print(json.dumps({"ok": False, "error": str(error), "untrustedContent": True}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
