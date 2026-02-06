import json
import re
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PDFS = {
    '2025': ROOT / 'public' / 'kangaroo-2025' / 'kangaroo-2025.pdf',
    '2024': ROOT / 'public' / 'kangaroo-2024' / 'kangaroo-2024.pdf',
    '2023': ROOT / 'public' / 'kangaroo-2023' / 'kangaroo-2023.pdf'
}

LABEL_PATTERN = re.compile(r'^[ABC](10|[1-9])$')

VALID_IDS = {f'A{i}' for i in range(1, 11)}
VALID_IDS |= {f'B{i}' for i in range(1, 11)}
VALID_IDS |= {f'C{i}' for i in range(1, 11)}


def page_count(pdf_path: Path) -> int:
    result = subprocess.run(['pdfinfo', str(pdf_path)], capture_output=True, text=True, check=True)
    for line in result.stdout.splitlines():
        if line.startswith('Pages:'):
            return int(line.split(':', 1)[1].strip())
    raise RuntimeError('Pages count not found.')


def extract_for_pdf(pdf_path: Path) -> dict:
    pages = page_count(pdf_path)
    label_positions: dict[str, dict[str, dict[str, float]]] = {}
    page_sizes: dict[str, dict[str, float]] = {}

    for page in range(1, pages + 1):
        with tempfile.NamedTemporaryFile(suffix='.html', delete=False) as tmp:
            tmp_path = Path(tmp.name)
        subprocess.run([
            'pdftotext',
            '-bbox',
            '-f',
            str(page),
            '-l',
            str(page),
            str(pdf_path),
            str(tmp_path)
        ], check=True)
        html = tmp_path.read_text(errors='ignore')
        tmp_path.unlink(missing_ok=True)

        size_match = re.search(r'<page[^>]*width=\"([0-9.]+)\"[^>]*height=\"([0-9.]+)\"', html)
        if size_match:
            page_sizes[str(page)] = {
                'width': float(size_match.group(1)),
                'height': float(size_match.group(2))
            }

        words = re.findall(
            r'<word[^>]*xMin=\"([0-9.]+)\" yMin=\"([0-9.]+)\" xMax=\"([0-9.]+)\" yMax=\"([0-9.]+)\">([^<]+)</word>',
            html
        )
        occurrences: dict[str, list[tuple[float, float]]] = {}
        for x1, y1, _x2, _y2, text in words:
            cleaned = re.sub(r'[^A-Za-z0-9]', '', text)
            if not LABEL_PATTERN.fullmatch(cleaned):
                continue
            if cleaned not in VALID_IDS:
                continue
            occurrences.setdefault(cleaned, []).append((float(x1), float(y1)))

        labels: dict[str, dict[str, float]] = {}
        for label, coords in occurrences.items():
            coords.sort(key=lambda value: (value[0], value[1]))
            labels[label] = {'x': coords[0][0], 'y': coords[0][1]}
        if labels:
            label_positions[str(page)] = labels

    return {'pageSizes': page_sizes, 'labels': label_positions}


def main():
    for year, pdf_path in PDFS.items():
        if not pdf_path.exists():
            print(f'Skipping missing file: {pdf_path}')
            continue
        data = extract_for_pdf(pdf_path)
        out_path = ROOT / 'src' / 'data' / f'label_positions_{year}.json'
        out_path.write_text(json.dumps(data, indent=2))
        print(f'Wrote {out_path}')


if __name__ == '__main__':
    main()
