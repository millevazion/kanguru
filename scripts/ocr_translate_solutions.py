import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, Tuple

# Usage:
# python3 scripts/ocr_translate_solutions.py /Users/sebi/Downloads/Broschuere-2025B.pdf 2025
# Requires: pdftoppm, tesseract, OPENAI_API_KEY


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def ocr_pdf(pdf_path: Path, work_dir: Path) -> str:
    work_dir.mkdir(parents=True, exist_ok=True)
    prefix = work_dir / 'page'
    run([
        'pdftoppm', '-r', '200', '-png', str(pdf_path), str(prefix)
    ])

    texts = []
    for img in sorted(work_dir.glob('page-*.png')):
        result = subprocess.run(
            ['tesseract', str(img), 'stdout', '-l', 'deu', '--psm', '6'],
            check=True,
            capture_output=True
        )
        texts.append(result.stdout.decode('utf-8', errors='ignore'))

    return '\n'.join(texts)


def spaced_pattern(raw: str) -> str:
    return r'\s*'.join(map(re.escape, raw))


def find_section(text: str) -> str:
    section_start = re.compile(
        spaced_pattern('Klassenstufen') + r'\s*' + spaced_pattern('7') + r'\s*' +
        r'(?:' + spaced_pattern('und') + r'|' + spaced_pattern('bis') + r')\s*' + spaced_pattern('8'),
        re.IGNORECASE
    )

    section_end = re.compile(
        spaced_pattern('Klassenstufen') + r'\s*' + spaced_pattern('9') + r'\s*' +
        r'(?:' + spaced_pattern('und') + r'|' + spaced_pattern('bis') + r')\s*' + spaced_pattern('10'),
        re.IGNORECASE
    )

    start_match = section_start.search(text)
    if not start_match:
        raise ValueError('Could not find section for Klassenstufen 7 und 8')

    end_match = section_end.search(text, start_match.end())
    if not end_match:
        raise ValueError('Could not find end section for Klassenstufen 9 und 10')

    return text[start_match.end():end_match.start()]


def extract_solutions(section: str) -> Dict[str, str]:
    losung = r'l\s*o\s*(?:e\s*)?s\s*u\s*n\s*g'
    pattern = re.compile(
        r'(\d+)\s*' + losung + r'\s*[:\.]\s*(.*?)(?=\d+\s*' + losung + r'\s*[:\.]|$)',
        re.IGNORECASE | re.DOTALL
    )

    matches = pattern.findall(section)
    if not matches:
        raise ValueError('No solutions found in section')

    explanations = {}
    for num_str, solution in matches:
        num = int(num_str)
        if not (1 <= num <= 30):
            continue
        if num <= 10:
            qid = f'A{num}'
        elif num <= 20:
            qid = f'B{num - 10}'
        else:
            qid = f'C{num - 20}'
        solution = re.sub(r'\s+', ' ', solution).strip()
        explanations[qid] = solution

    return explanations


def openai_translate(batch: Dict[str, str]) -> Dict[str, str]:
    import urllib.request

    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise RuntimeError('OPENAI_API_KEY not set')

    prompt = (
        'Translate these German Kangaroo math solution explanations into English. '
        'Rewrite them as short, friendly “story explanations” for a 10-year-old. '
        'Keep each explanation to 2-4 sentences. Return only JSON with the same keys.\n\n'
        f'{json.dumps(batch, ensure_ascii=False)}'
    )

    payload = {
        'model': 'gpt-4o-mini',
        'input': prompt,
        'temperature': 0.2
    }

    req = urllib.request.Request(
        'https://api.openai.com/v1/responses',
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
    )

    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))

    # Extract output_text
    output_text = ''
    for item in data.get('output', []):
        if item.get('type') == 'output_text':
            output_text += item.get('text', '')

    output_text = output_text.strip()
    return json.loads(output_text)


def translate_all(explanations: Dict[str, str]) -> Dict[str, str]:
    items = list(explanations.items())
    translated: Dict[str, str] = {}
    batch_size = 8
    for i in range(0, len(items), batch_size):
        batch = dict(items[i:i + batch_size])
        translated.update(openai_translate(batch))
    return translated


def main():
    if len(sys.argv) < 3:
        print('Usage: python3 scripts/ocr_translate_solutions.py /path/to/Broschuere-YYYYB.pdf YYYY')
        sys.exit(1)

    pdf_path = Path(sys.argv[1])
    year = sys.argv[2]
    if not pdf_path.exists():
        print(f'File not found: {pdf_path}')
        sys.exit(1)

    work_dir = Path(__file__).resolve().parents[1] / '.tmp' / f'kangaroo_{year}_ocr'
    text = ocr_pdf(pdf_path, work_dir)
    section = find_section(text)
    explanations_de = extract_solutions(section)
    explanations_en = translate_all(explanations_de)

    out_path = Path(__file__).resolve().parents[1] / 'src' / 'data' / f'explanations_{year}.json'
    out_path.write_text(json.dumps(explanations_en, ensure_ascii=False, indent=2))
    print(f'Wrote {len(explanations_en)} explanations to {out_path}')


if __name__ == '__main__':
    main()
