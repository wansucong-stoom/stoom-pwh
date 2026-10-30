"""Compare user-provided Hancom and Pwh renderings of the same source document.

Inputs are read-only.  A new output directory receives colour overlays and a
provenance report.  This utility does not launch Hancom or claim that either
rendering was generated from the supplied source: that provenance is supplied
by the operator and should be recorded at export time.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def page_files(path: Path) -> list[Path]:
    files = sorted(path.glob('page-*.png'))
    if not files or any(p.is_symlink() or not p.is_file() for p in files):
        raise ValueError('쪽 이미지 폴더에는 page-0001.png부터 시작하는 일반 PNG 파일이 필요합니다.')
    if any(not re.fullmatch(r'page-\d{4,}\.png', p.name) for p in files):
        raise ValueError('쪽 이미지 이름은 page-0001.png 형식이어야 합니다.')
    files.sort(key=lambda p: int(p.stem[5:]))
    if [int(p.stem[5:]) for p in files] != list(range(1, len(files) + 1)):
        raise ValueError('쪽 이미지 번호에는 중복이나 빠진 번호가 없어야 합니다.')
    return files


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    if path.is_dir():
        # Only the ordered page inventory participates; profiles, fonts and
        # unrelated diagnostic files are never read by this comparator.
        for page in page_files(path):
            h.update(page.name.encode('utf-8') + b'\0')
            h.update(bytes.fromhex(sha256(page)))
        return h.hexdigest()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def open_pages(path: Path, dpi: int = 150):
    if path.is_dir():
        files = page_files(path)
        def render(index):
            with Image.open(files[index]) as image:
                return image.convert('RGB'), None
        return len(files), render, lambda: None
    if path.suffix.lower() == '.pdf':
        try:
            import pypdfium2 as pdfium
        except ImportError as exc:
            raise RuntimeError('PDF 비교에는 pypdfium2가 필요합니다.') from exc
        pdf = pdfium.PdfDocument(str(path))
        def render(index):
            page = pdf[index]
            try:
                width, height = page.get_size()
                scale = dpi / 72.0
                bitmap = page.render(scale=scale, rotation=0)
                try:
                    return bitmap.to_pil().convert('RGB'), (width, height)
                finally:
                    bitmap.close()
            finally:
                page.close()
        return len(pdf), render, pdf.close
    image = Image.open(path)
    count = getattr(image, 'n_frames', 1)
    def render(index):
        image.seek(index)
        rendered = image.convert('RGB')
        return rendered, None
    return count, render, image.close


def selected_pages(value: str, maximum: int) -> list[int]:
    if value == 'all':
        return list(range(1, maximum + 1))
    selected = set()
    for part in value.split(','):
        part = part.strip()
        if not part:
            raise ValueError('쪽 범위를 확인해 주세요.')
        bounds = part.split('-')
        if len(bounds) > 2 or not all(x.isdecimal() for x in bounds):
            raise ValueError('쪽 범위는 1,3,5-7 형식으로 입력해 주세요.')
        start, end = int(bounds[0]), int(bounds[-1])
        if start < 1 or end < start or end > maximum:
            raise ValueError(f'쪽 범위는 1~{maximum}이어야 합니다.')
        selected.update(range(start, end + 1))
    return sorted(selected)


def compare(reference: Image.Image, candidate: Image.Image, threshold: int, tolerance: int, rounding_pixels: int = 2):
    # Rasterization rounding is padded at the edge, never scaled or translated.
    if abs(reference.width - candidate.width) > rounding_pixels or abs(reference.height - candidate.height) > rounding_pixels:
        raise ValueError(f'쪽 크기/비율이 다릅니다: 기준 {reference.size}, Pwh {candidate.size}')
    size = (max(reference.width, candidate.width), max(reference.height, candidate.height))
    def pad(im):
        canvas = Image.new('RGB', size, 'white')
        canvas.paste(im, (0, 0))
        return canvas
    reference, candidate = pad(reference), pad(candidate)
    ref = np.asarray(reference.convert('L')) < threshold
    actual = np.asarray(candidate.convert('L')) < threshold
    shared = ref & actual
    ref_only, actual_only = ref & ~actual, actual & ~ref
    if tolerance:
        kernel = 2 * tolerance + 1
        near_ref = np.asarray(Image.fromarray(ref.astype('uint8') * 255).filter(ImageFilter.MaxFilter(kernel))) > 0
        near_actual = np.asarray(Image.fromarray(actual.astype('uint8') * 255).filter(ImageFilter.MaxFilter(kernel))) > 0
        near = (ref_only & near_actual) | (actual_only & near_ref)
    else:
        near = np.zeros_like(ref)
        near_ref, near_actual = ref, actual
    rgba = np.full((*ref.shape, 3), 255, dtype=np.uint8)
    rgba[shared] = (125, 125, 125)
    rgba[ref_only] = (211, 65, 65)
    rgba[actual_only] = (42, 100, 202)
    rgba[near] = (231, 142, 37)
    union = int((ref | actual).sum())
    diff = int((ref ^ actual).sum())
    ref_ink, actual_ink = int(ref.sum()), int(actual.sum())
    matched_ref, matched_actual = int((ref & near_actual).sum()), int((actual & near_ref).sum())
    precision = matched_actual / actual_ink if actual_ink else float(ref_ink == 0)
    recall = matched_ref / ref_ink if ref_ink else float(actual_ink == 0)
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return Image.fromarray(rgba), {
        'width': size[0], 'height': size[1], 'referenceInkPixels': ref_ink,
        'pwhInkPixels': actual_ink, 'exactCommonPixels': int(shared.sum()),
        'referenceInkWithinTolerance': matched_ref, 'pwhInkWithinTolerance': matched_actual,
        'tolerantInkPrecision': round(precision, 6), 'tolerantInkRecall': round(recall, 6),
        'tolerantInkF1': round(f1, 6),
        'differentPixels': diff, 'nearbyDifferencePixels': int(near.sum()),
        'contentIoU': round(int(shared.sum()) / union, 6) if union else 1.0,
        'pagePixelDifferenceFraction': round(diff / (size[0] * size[1]), 6),
    }


def main():
    parser = argparse.ArgumentParser(description='같은 원본의 한글/Pwh 출력 쪽을 겹쳐 비교합니다.')
    parser.add_argument('--source', required=True, type=Path, help='비교에 사용한 원본 HWP/HWPX')
    parser.add_argument('--hancom', required=True, type=Path, help='한글의 기준 PDF·이미지 또는 page-0001.png 순서의 폴더')
    parser.add_argument('--pwh', required=True, type=Path, help='Pwh 출력 PDF·이미지 또는 같은 해상도의 쪽 이미지 폴더')
    parser.add_argument('--out', required=True, type=Path, help='아직 없는 결과 폴더')
    parser.add_argument('--pages', default='all', help='비교할 쪽: all 또는 1,3,5-7')
    parser.add_argument('--threshold', type=int, default=245)
    parser.add_argument('--tolerance', type=int, default=2)
    parser.add_argument('--dpi', type=int, default=150, help='두 PDF에 공통 적용할 래스터 해상도. 이미지는 크기를 변경하지 않습니다.')
    args = parser.parse_args()
    if not 1 <= args.threshold <= 255 or not 0 <= args.tolerance <= 5 or not 72 <= args.dpi <= 600:
        parser.error('threshold는 1~255, tolerance는 0~5, dpi는 72~600이어야 합니다.')
    source, reference, candidate, out = (p.resolve() for p in (args.source, args.hancom, args.pwh, args.out))
    if source.suffix.lower() not in ('.hwp', '.hwpx') or not source.is_file() or not all(p.is_file() or p.is_dir() for p in (reference, candidate)):
        parser.error('원본 HWP/HWPX와 두 출력 파일 또는 쪽 이미지 폴더를 지정해 주세요.')
    if out.exists():
        parser.error('기존 파일을 보존하기 위해 아직 없는 결과 폴더를 지정해 주세요.')
    try:
        hashes = {key: sha256(value) for key, value in [('source', source), ('hancom', reference), ('pwh', candidate)]}
    except ValueError as error:
        parser.error(str(error))
    ref_count, get_ref, close_ref = open_pages(reference, args.dpi)
    try:
        cand_count, get_cand, close_cand = open_pages(candidate, args.dpi)
        try:
            pages = selected_pages(args.pages, max(ref_count, cand_count))
            out.mkdir(parents=False, exist_ok=False)
            records = []
            for number in pages:
                if number > ref_count or number > cand_count:
                    render = get_ref if number <= ref_count else get_cand
                    im, _ = render(number - 1)
                    ink = int((np.asarray(im.convert('L')) < args.threshold).sum())
                    records.append({'page': number, 'status': 'missing-pwh-page' if number > cand_count else 'extra-pwh-page',
                        'referenceInkPixels': ink if number <= ref_count else 0,
                        'pwhInkPixels': ink if number <= cand_count else 0,
                        'referenceInkWithinTolerance': 0, 'pwhInkWithinTolerance': 0})
                    continue
                image, candidate_size = get_cand(number - 1)
                ref, reference_size = get_ref(number - 1)
                # Hancom PDF can round its MediaBox to whole points while the
                # source retains 1/100 pt. Preserve physical scale and pad the
                # resulting edge strip; never stretch the page to fit.
                rounding_points = max((abs(a-b) for a,b in zip(candidate_size, reference_size)), default=0) if candidate_size and reference_size else 0
                if rounding_points > 1.0:
                    records.append({'page': number, 'status': 'paper-size-mismatch', 'hancomPoints': reference_size, 'pwhPoints': candidate_size})
                    continue
                try:
                    overlay, metrics = compare(ref, image, args.threshold, args.tolerance, max(2, int(np.ceil(args.dpi / 72))) if rounding_points else 2)
                except ValueError as error:
                    records.append({'page': number, 'status': 'size-mismatch', 'message': str(error)})
                    continue
                name = f'page-{number:04d}-overlay.png'
                overlay.save(out / name)
                records.append({'page': number, 'status': 'compared', 'overlay': name, 'paperRoundingPoints': rounding_points, **metrics})
            if any(sha256(value) != hashes[key] for key, value in [('source', source), ('hancom', reference), ('pwh', candidate)]):
                raise RuntimeError('비교 중 입력 파일이 변경되어 결과를 확정할 수 없습니다.')
            total_ref = sum(r.get('referenceInkPixels', 0) for r in records)
            total_actual = sum(r.get('pwhInkPixels', 0) for r in records)
            precision = sum(r.get('pwhInkWithinTolerance', 0) for r in records) / total_actual if total_actual else float(total_ref == 0)
            recall = sum(r.get('referenceInkWithinTolerance', 0) for r in records) / total_ref if total_ref else float(total_actual == 0)
            complete = all(r['status'] in ('compared', 'missing-pwh-page', 'extra-pwh-page') for r in records)
            exact = sum(r.get('exactCommonPixels', 0) for r in records)
            result = {'source': str(source), 'hancom': str(reference), 'pwh': str(candidate), 'sha256': hashes,
                'provenance': '두 출력물이 이 원본에서 만들어졌는지는 작업자가 확인해야 합니다.',
                'pageCounts': {'hancom': ref_count, 'pwh': cand_count}, 'threshold': args.threshold,
                'dpi': args.dpi, 'alignment': 'Same page origin and physical scale; no fitting, translation or page remapping.',
                'aggregate': {'complete': complete, 'tolerantInkPrecision': round(precision, 6),
                    'tolerantInkRecall': round(recall, 6), 'tolerantInkF1': round(2 * precision * recall / (precision + recall), 6) if precision + recall else 0.0,
                    'exactInkF1': round(2 * exact / (total_ref + total_actual), 6) if total_ref + total_actual else 1.0,
                    'referenceInkPixels': total_ref, 'pwhInkPixels': total_actual},
                'tolerancePixels': args.tolerance, 'legend': {'hancomOnly': 'red', 'pwhOnly': 'blue', 'nearbyDifference': 'orange', 'exactMatch': 'gray'},
                'pages': records}
            (out / 'report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            print(json.dumps({'output': str(out), 'compared': sum(r['status'] == 'compared' for r in records), 'requested': len(records), 'pageCountsMatch': ref_count == cand_count}, ensure_ascii=False))
        finally:
            close_cand()
    finally:
        close_ref()


if __name__ == '__main__':
    main()
