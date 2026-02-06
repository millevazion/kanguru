import json
import re
import sys
from pathlib import Path

# Usage: python3 scripts/extract_solutions.py /path/to/Broschuere-2025B.pdf 2025
# Produces: /Users/sebi/dev/eng_kids/src/data/explanations_2025.json


def extract_text_from_pdf(path: Path) -> str:
    data = path.read_bytes()
    streams = []
    for m in re.finditer(rb'stream\r?\n', data):
        start = m.end()
        end = data.find(b'endstream', start)
        if end == -1:
            continue
        streams.append(data[start:end])

    texts = []
    for s in streams:
        try:
            import zlib
            ds = zlib.decompress(s)
        except Exception:
            continue
        # Extract literal strings in parentheses
        i = 0
        while i < len(ds):
            if ds[i] == 40:  # (
                i += 1
                buf = []
                depth = 1
                while i < len(ds) and depth > 0:
                    b = ds[i]
                    if b == 92:  # backslash
                        if i + 1 < len(ds):
                            buf.append(ds[i + 1])
                            i += 2
                            continue
                    if b == 40:
                        depth += 1
                        buf.append(b)
                        i += 1
                        continue
                    if b == 41:
                        depth -= 1
                        if depth == 0:
                            i += 1
                            break
                        buf.append(b)
                        i += 1
                        continue
                    buf.append(b)
                    i += 1
                if buf:
                    texts.append(bytes(buf))
                continue
            i += 1

    joined = b"\n".join(texts)
    clean = re.sub(rb'[^\x09\x0A\x0D\x20-\x7E]', b'', joined)
    text = clean.decode('latin1', errors='ignore')
    text = re.sub(r'\s+', ' ', text)
    return text


def main():
    if len(sys.argv) < 3:
        print('Usage: python3 scripts/extract_solutions.py /path/to/Broschuere-YYYYB.pdf YYYY')
        sys.exit(1)

    pdf_path = Path(sys.argv[1])
    year = sys.argv[2]
    if not pdf_path.exists():
        print(f'File not found: {pdf_path}')
        sys.exit(1)

    text = extract_text_from_pdf(pdf_path)

    def spaced_pattern(raw: str) -> str:
        return r'\s*'.join(map(re.escape, raw))

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
    end_match = section_end.search(text, start_match.end() if start_match else 0)
    if not start_match:
        print('Could not find section for Klassenstufen 7 und 8')
        sys.exit(1)
    if not end_match:
        print('Could not find end section for Klassenstufen 9 und 10')
        sys.exit(1)

    section = text[start_match.end():end_match.start()]

    # Extract solutions: "1 Lösung ... 2 Lösung ..."
    loesung = spaced_pattern('Lösung')
    pattern = re.compile(
        r'(\d+)\s*' + loesung + r'\s*[:\.]\s*(.*?)(?=\d+\s*' + loesung + r'\s*[:\.]|$)',
        re.IGNORECASE
    )
    matches = pattern.findall(section)

    if not matches:
        print('No solutions found in section')
        sys.exit(1)

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
        # Clean up solution text
        solution = solution.strip()
        solution = re.sub(r'\s+', ' ', solution)
        explanations[qid] = solution

    out_path = Path(__file__).resolve().parents[1] / 'src' / 'data' / f'explanations_{year}.json'
    out_path.write_text(json.dumps(explanations, ensure_ascii=False, indent=2))
    print(f'Wrote {len(explanations)} explanations to {out_path}')


if __name__ == '__main__':
    main()
