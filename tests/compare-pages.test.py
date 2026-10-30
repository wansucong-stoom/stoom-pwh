import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'compare-pages.py'
spec = importlib.util.spec_from_file_location('pwh_compare_pages', SCRIPT)
compare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compare)


class ComparePagesTest(unittest.TestCase):
    def test_exact_and_shifted_images_expose_colour_and_metrics(self):
        original = Image.new('RGB', (80, 100), 'white')
        ImageDraw.Draw(original).rectangle((10, 10, 30, 20), fill='black')
        overlay, metrics = compare.compare(original, original, 245, 2)
        self.assertEqual(metrics['contentIoU'], 1)
        self.assertEqual(metrics['differentPixels'], 0)
        self.assertEqual(metrics['tolerantInkF1'], 1)
        self.assertEqual(overlay.getpixel((12, 12)), (125, 125, 125))
        shifted = Image.new('RGB', (80, 100), 'white')
        ImageDraw.Draw(shifted).rectangle((11, 10, 31, 20), fill='black')
        overlay, metrics = compare.compare(original, shifted, 245, 2)
        self.assertGreater(metrics['differentPixels'], 0)
        self.assertGreater(metrics['nearbyDifferencePixels'], 0)
        self.assertEqual(metrics['tolerantInkF1'], 1)
        self.assertEqual(overlay.getpixel((10, 15)), (231, 142, 37))
        with self.assertRaisesRegex(ValueError, '크기/비율'):
            compare.compare(original, Image.new('RGB', (60, 100), 'white'), 245, 2)

    def test_blank_paper_does_not_hide_missing_content(self):
        original = Image.new('RGB', (800, 1000), 'white')
        ImageDraw.Draw(original).rectangle((100, 100, 110, 200), fill='black')
        blank = Image.new('RGB', original.size, 'white')
        _, metrics = compare.compare(original, blank, 245, 2)
        self.assertLess(metrics['pagePixelDifferenceFraction'], 0.01)
        self.assertEqual(metrics['tolerantInkF1'], 0)
        self.assertEqual(metrics['tolerantInkRecall'], 0)

    def test_cli_preserves_inputs_and_does_not_overwrite_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'original.hwpx'
            source.write_bytes(b'PK synthetic source')
            one, two = root / 'hancom.png', root / 'pwh.png'
            Image.new('RGB', (80, 100), 'white').save(one)
            Image.new('RGB', (80, 100), 'white').save(two)
            out = root / 'comparison'
            command = [sys.executable, str(SCRIPT), '--source', str(source), '--hancom', str(one), '--pwh', str(two), '--out', str(out)]
            result = subprocess.run(command, capture_output=True, text=True, check=True, encoding='utf-8')
            self.assertEqual(json.loads(result.stdout)['compared'], 1)
            report = json.loads((out / 'report.json').read_text(encoding='utf-8'))
            self.assertEqual(report['pages'][0]['contentIoU'], 1)
            self.assertIn('작업자가 확인', report['provenance'])
            self.assertTrue((out / 'page-0001-overlay.png').exists())
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(source.read_bytes(), b'PK synthetic source')

    def test_page_range_validation(self):
        self.assertEqual(compare.selected_pages('1,3-5,3', 7), [1, 3, 4, 5])
        for value in ('0', '2-1', '1,,2', '8', 'abc'):
            with self.assertRaises(ValueError):
                compare.selected_pages(value, 7)

    def test_page_directory_is_contiguous_and_hashes_only_pages(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            Image.new('RGB', (80, 100), 'white').save(root / 'page-0001.png')
            first_hash = compare.sha256(root)
            (root / 'metadata.json').write_text('unrelated', encoding='utf-8')
            self.assertEqual(compare.sha256(root), first_hash)
            count, render, close = compare.open_pages(root)
            self.assertEqual(count, 1)
            self.assertEqual(render(0)[0].size, (80, 100))
            close()
            Image.new('RGB', (80, 100), 'white').save(root / 'page-0003.png')
            with self.assertRaisesRegex(ValueError, '빠진 번호'):
                compare.open_pages(root)

    def test_extra_ink_on_extra_page_penalizes_aggregate(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'source.hwpx'
            source.write_bytes(b'PK synthetic')
            ref, cand = root / 'reference', root / 'candidate'
            ref.mkdir()
            cand.mkdir()
            page = Image.new('RGB', (80, 100), 'white')
            ImageDraw.Draw(page).rectangle((10, 10, 20, 20), fill='black')
            page.save(ref / 'page-0001.png')
            page.save(cand / 'page-0001.png')
            page.save(cand / 'page-0002.png')
            out = root / 'comparison'
            subprocess.run([sys.executable, str(SCRIPT), '--source', str(source),
                            '--hancom', str(ref), '--pwh', str(cand), '--out', str(out)],
                           check=True, capture_output=True)
            report = json.loads((out / 'report.json').read_text(encoding='utf-8'))
            self.assertEqual(report['pages'][1]['status'], 'extra-pwh-page')
            self.assertEqual(report['aggregate']['tolerantInkPrecision'], .5)
            self.assertEqual(report['aggregate']['tolerantInkRecall'], 1)
            self.assertAlmostEqual(report['aggregate']['tolerantInkF1'], 2 / 3, places=6)
            self.assertTrue(report['aggregate']['complete'])

    def test_pdf_inputs_keep_physical_scale_and_reject_different_paper(self):
        try:
            import pypdfium2 as pdfium
        except ImportError:
            self.skipTest('PDF renderer is not installed')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name, width in [('reference.pdf', 100), ('candidate.pdf', 110)]:
                pdf = pdfium.PdfDocument.new()
                try:
                    page = pdf.new_page(width, 200)
                    page.close()
                    pdf.save(root / name)
                finally:
                    pdf.close()
            count, render, close = compare.open_pages(root / 'reference.pdf', 144)
            try:
                image, points = render(0)
                self.assertEqual(count, 1)
                self.assertEqual(points, (100, 200))
                self.assertEqual(image.size, (200, 400))
            finally:
                close()
            source = root / 'source.hwpx'
            source.write_bytes(b'PK synthetic')
            out = root / 'comparison'
            subprocess.run([sys.executable, str(SCRIPT), '--source', str(source),
                            '--hancom', str(root / 'reference.pdf'), '--pwh', str(root / 'candidate.pdf'),
                            '--dpi', '144', '--out', str(out)], check=True, capture_output=True)
            report = json.loads((out / 'report.json').read_text(encoding='utf-8'))
            self.assertEqual(report['pages'][0]['status'], 'paper-size-mismatch')
            self.assertFalse(report['aggregate']['complete'])


if __name__ == '__main__':
    unittest.main()
