import base64
import json
import os
import re
import subprocess
import sys
from html import unescape
from pathlib import Path
from typing import Dict, List, Tuple

# Usage:
# OPENAI_API_KEY=... python3 scripts/generate_explanations_from_pdf.py /path/to/kangaroo-2025.pdf 2025

ANSWER_KEYS: Dict[str, List[str]] = {
    '2025': [
        'C', 'E', 'E', 'B', 'A', 'E', 'C', 'B', 'B', 'A',
        'C', 'A', 'D', 'B', 'D', 'C', 'B', 'D', 'A', 'B',
        'A', 'D', 'E', 'C', 'C', 'D', 'A', 'A', 'C', 'D'
    ],
    '2024': [
        'B', 'C', 'E', 'D', 'D', 'B', 'E', 'C', 'C', 'C',
        'B', 'A', 'A', 'D', 'A', 'D', 'B', 'C', 'D', 'E',
        'A', 'E', 'B', 'D', 'D', 'E', 'D', 'B', 'C', 'A'
    ],
    '2023': [
        'E', 'A', 'A', 'B', 'C', 'D', 'B', 'B', 'D', 'E',
        'E', 'C', 'B', 'C', 'E', 'D', 'D', 'D', 'B', 'A',
        'B', 'C', 'C', 'E', 'D', 'B', 'E', 'A', 'A', 'C'
    ]
}


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def render_pages(pdf_path: Path, work_dir: Path) -> List[Path]:
    if work_dir.exists():
        for item in work_dir.glob('*'):
            item.unlink()
    work_dir.mkdir(parents=True, exist_ok=True)
    prefix = work_dir / 'page'
    run(['pdftoppm', '-r', '140', '-jpeg', str(pdf_path), str(prefix)])
    pages = sorted([p for p in work_dir.glob('page-*.jpg') if '_small' not in p.stem])
    resized = []
    for page in pages:
        resized_path = page.with_name(page.stem + '_small.jpg')
        run(['sips', '-Z', '1400', str(page), '--out', str(resized_path)])
        resized.append(resized_path)
    return resized


def build_questions() -> List[str]:
    return (
        [f'A{i}' for i in range(1, 11)] +
        [f'B{i}' for i in range(1, 11)] +
        [f'C{i}' for i in range(1, 11)]
    )


def questions_by_page() -> Dict[int, List[str]]:
    return {
        1: [f'A{i}' for i in range(1, 8)],
        2: [f'A{i}' for i in range(8, 11)] + [f'B{i}' for i in range(1, 6)],
        3: [f'B{i}' for i in range(6, 11)] + [f'C{i}' for i in range(1, 4)],
        4: [f'C{i}' for i in range(4, 11)]
    }


def get_image_size(image_path: Path) -> Tuple[int, int]:
    result = subprocess.run(
        ['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', str(image_path)],
        capture_output=True,
        text=True
    )
    output = result.stdout
    width_match = re.search(r'pixelWidth:\s*(\d+)', output)
    height_match = re.search(r'pixelHeight:\s*(\d+)', output)
    if not width_match or not height_match:
        raise RuntimeError(f'Could not read image size for {image_path}')
    return int(width_match.group(1)), int(height_match.group(1))


def parse_pdf_bbox(pdf_path: Path, page_num: int) -> Tuple[Tuple[float, float], List[dict]]:
    result = subprocess.run(
        ['pdftotext', '-bbox', '-f', str(page_num), '-l', str(page_num), str(pdf_path), '-'],
        capture_output=True,
        text=True
    )
    output = result.stdout
    page_match = re.search(r'<page width=\"([0-9.]+)\" height=\"([0-9.]+)\">', output)
    if not page_match:
        raise RuntimeError('Could not parse page size from pdftotext output')
    page_width = float(page_match.group(1))
    page_height = float(page_match.group(2))

    words = []
    for match in re.finditer(r'<word xMin=\"([0-9.]+)\" yMin=\"([0-9.]+)\" xMax=\"([0-9.]+)\" yMax=\"([0-9.]+)\">(.*?)</word>', output):
        text = unescape(match.group(5)).strip()
        if not text:
            continue
        words.append({
            'xMin': float(match.group(1)),
            'yMin': float(match.group(2)),
            'xMax': float(match.group(3)),
            'yMax': float(match.group(4)),
            'text': text
        })

    return (page_width, page_height), words


def normalize_token(token: str) -> str:
    cleaned = re.sub(r'[^A-Za-z0-9]', '', token.upper())
    cleaned = cleaned.replace('O', '0')
    return cleaned


def extract_label_positions(words: List[dict], question_ids: List[str], scale_x: float, scale_y: float) -> Dict[str, dict]:
    label_set = set(question_ids)
    lines: List[dict] = []
    tolerance = 2.5
    for word in words:
        existing = next((line for line in lines if abs(line['y'] - word['yMin']) <= tolerance), None)
        if existing:
            existing['words'].append(word)
            existing['y'] = (existing['y'] + word['yMin']) / 2
        else:
            lines.append({'y': word['yMin'], 'words': [word]})

    positions: Dict[str, dict] = {}
    for line in lines:
        line_words = sorted(line['words'], key=lambda w: w['xMin'])
        for idx, word in enumerate(line_words):
            token = normalize_token(word['text'])
            label = None
            if token in label_set:
                label = token
                left = word['xMin']
                top = word['yMin']
                right = word['xMax']
                bottom = word['yMax']
            elif token in {'A', 'B', 'C'} and idx + 1 < len(line_words):
                next_token = normalize_token(line_words[idx + 1]['text'])
                if next_token in {str(n) for n in range(1, 11)}:
                    label = f'{token}{next_token}'
                    left = min(word['xMin'], line_words[idx + 1]['xMin'])
                    top = min(word['yMin'], line_words[idx + 1]['yMin'])
                    right = max(word['xMax'], line_words[idx + 1]['xMax'])
                    bottom = max(word['yMax'], line_words[idx + 1]['yMax'])
            if label and label in label_set:
                existing = positions.get(label)
                if not existing or left < existing['left']:
                    positions[label] = {
                        'left': left * scale_x,
                        'top': top * scale_y,
                        'right': right * scale_x,
                        'bottom': bottom * scale_y
                    }
    return positions


def cluster_columns(positions: List[dict], tolerance: int = 90) -> List[dict]:
    sorted_positions = sorted(positions, key=lambda p: p['left'])
    clusters: List[dict] = []
    for pos in sorted_positions:
        if not clusters or abs(pos['left'] - clusters[-1]['center']) > tolerance:
            clusters.append({'center': pos['left'], 'items': [pos]})
        else:
            clusters[-1]['items'].append(pos)
            clusters[-1]['center'] = sum(item['left'] for item in clusters[-1]['items']) / len(clusters[-1]['items'])
    return clusters


def compute_crop(qid: str, label_positions: Dict[str, dict], image_size: Tuple[int, int]) -> Tuple[int, int, int, int]:
    image_w, image_h = image_size
    current = label_positions.get(qid)
    if not current:
        return 0, 0, image_w, image_h

    positions = [
        {'id': key, 'left': value['left'], 'top': value['top']}
        for key, value in label_positions.items()
    ]
    clusters = cluster_columns(positions)
    centers = sorted(cluster['center'] for cluster in clusters)

    current_x = current['left']
    if not centers:
        left_boundary, right_boundary, column_items = 0, image_w, positions
    else:
        idx = min(range(len(centers)), key=lambda i: abs(centers[i] - current_x))
        left_boundary = 0 if idx == 0 else (centers[idx - 1] + centers[idx]) / 2
        right_boundary = image_w if idx == len(centers) - 1 else (centers[idx] + centers[idx + 1]) / 2
        column_items = clusters[idx]['items']

    column_items = sorted(column_items, key=lambda item: item['top'])
    current_index = next((i for i, item in enumerate(column_items) if item['id'] == qid), -1)
    next_item = None
    if current_index != -1:
        for item in column_items[current_index + 1:]:
            if item['top'] > current['top'] + 4:
                next_item = item
                break

    padding_top = 24
    padding_bottom = 16
    padding_x = 18

    top = max(0, current['top'] - padding_top)
    if next_item:
        bottom = max(top + 140, next_item['top'] - padding_bottom)
    else:
        gaps = []
        for i in range(1, len(column_items)):
            gap = column_items[i]['top'] - column_items[i - 1]['top']
            if gap > 24:
                gaps.append(gap)
        gaps.sort()
        median_gap = gaps[len(gaps) // 2] if gaps else None
        prev_item = column_items[current_index - 1] if current_index > 0 else None
        estimated = median_gap or (current['top'] - prev_item['top'] if prev_item else image_h * 0.25)
        max_height = image_h * 0.55
        bottom = min(image_h, current['top'] + min(max_height, max(220, estimated * 1.35)))

    crop_left = max(0, int(left_boundary - padding_x))
    crop_right = min(image_w, int(right_boundary + padding_x))
    crop_width = max(140, crop_right - crop_left)
    crop_height = min(image_h - top, max(200, int(bottom - top)))

    return crop_left, int(top), crop_width, crop_height


def crop_image(source: Path, dest: Path, crop: Tuple[int, int, int, int]) -> None:
    left, top, width, height = crop
    run([
        'sips',
        '-c', str(height), str(width),
        '--cropOffset', str(top), str(left),
        str(source),
        '--out', str(dest)
    ])


def extract_output_text(data: dict) -> str:
    output_text = ''
    for item in data.get('output', []):
        if item.get('type') == 'output_text':
            output_text += item.get('text', '')
        if item.get('type') == 'message':
            for part in item.get('content', []):
                if part.get('type') == 'output_text':
                    output_text += part.get('text', '')
    return output_text.strip()


def parse_json_output(output_text: str) -> dict:
    try:
        return json.loads(output_text)
    except json.JSONDecodeError:
        start = output_text.find('{')
        end = output_text.rfind('}')
        if start != -1 and end != -1:
            return json.loads(output_text[start:end + 1])
        raise


def openai_explain_question(image_path: Path, question_id: str, answer: str) -> dict:
    import urllib.request

    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise RuntimeError('OPENAI_API_KEY not set')

    image_data = base64.b64encode(image_path.read_bytes()).decode('utf-8')

    prompt = (
        'You are a kind math tutor for a 10-year-old. '
        f'The image shows question {question_id} from a German Kangaroo math contest. '
        'Translate the question to English internally. '
        f'The correct answer letter is {answer}. '
        'Return JSON with keys "hint" and "story". '
        'The hint must be 1-2 sentences, specific to this question, and must NOT reveal the answer. '
        'The story must be 2-4 sentences, explain the reasoning, and may mention the answer. '
        'Return ONLY JSON.'
    )

    payload = {
        'model': 'gpt-4o-mini',
        'input': [
            {
                'role': 'user',
                'content': [
                    {'type': 'input_text', 'text': prompt},
                    {'type': 'input_image', 'image_url': f'data:image/jpeg;base64,{image_data}', 'detail': 'high'}
                ]
            }
        ],
        'temperature': 0.2,
        'max_output_tokens': 500,
        'response_format': {
            'type': 'json_schema',
            'json_schema': {
                'name': 'explanation',
                'schema': {
                    'type': 'object',
                    'properties': {
                        'hint': {'type': 'string'},
                        'story': {'type': 'string'}
                    },
                    'required': ['hint', 'story']
                }
            }
        }
    }

    req = urllib.request.Request(
        'https://api.openai.com/v1/responses',
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
    )

    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as err:
        body = err.read().decode('utf-8', errors='ignore')
        payload.pop('response_format', None)
        req = urllib.request.Request(
            'https://api.openai.com/v1/responses',
            data=json.dumps(payload).encode('utf-8'),
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            }
        )
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as err2:
            body2 = err2.read().decode('utf-8', errors='ignore')
            raise RuntimeError(f'OpenAI error: {err2.code}. First response: {body[:500]} Second: {body2[:500]}') from err2

    output_text = extract_output_text(data)
    if not output_text:
        debug_path = Path(__file__).resolve().parents[1] / '.tmp' / 'openai_empty_response.json'
        debug_path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
        raise ValueError(f'Empty response from OpenAI (debug saved to {debug_path})')
    return parse_json_output(output_text)


def openai_explain_from_text(question_text: str, question_id: str, answer: str) -> dict:
    import urllib.request

    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise RuntimeError('OPENAI_API_KEY not set')

    prompt = (
        'You are a kind math tutor for a 10-year-old. '
        f'The text below is OCR for question {question_id} from a German Kangaroo contest. '
        'Translate to English internally. '
        f'The correct answer letter is {answer}. '
        'Return JSON with keys "hint" and "story". '
        'The hint must be 1-2 sentences and must NOT reveal the answer. '
        'The story must be 2-4 sentences and may mention the answer. '
        'Return ONLY JSON.\n\n'
        f'OCR TEXT:\n{question_text}'
    )

    payload = {
        'model': 'gpt-4o-mini',
        'input': prompt,
        'temperature': 0.2,
        'max_output_tokens': 500
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

    output_text = extract_output_text(data)
    if not output_text:
        raise ValueError('Empty response from OpenAI (text fallback)')
    return parse_json_output(output_text)


def main() -> None:
    if len(sys.argv) < 3:
        print('Usage: python3 scripts/generate_explanations_from_pdf.py /path/to/kangaroo-YYYY.pdf YYYY')
        sys.exit(1)

    pdf_path = Path(sys.argv[1])
    year = sys.argv[2]
    if not pdf_path.exists():
        print(f'File not found: {pdf_path}')
        sys.exit(1)

    if year not in ANSWER_KEYS:
        print(f'No answer key for year {year}')
        sys.exit(1)

    work_dir = Path(__file__).resolve().parents[1] / '.tmp' / f'kangaroo_{year}_pages'
    pages = render_pages(pdf_path, work_dir)

    crop_dir = Path(__file__).resolve().parents[1] / '.tmp' / f'kangaroo_{year}_crops'
    crop_dir.mkdir(parents=True, exist_ok=True)

    ids = build_questions()
    answers = ANSWER_KEYS[year]
    answer_map = {qid: ans for qid, ans in zip(ids, answers)}
    by_page = questions_by_page()

    explanations: Dict[str, dict] = {}

    for page_num, qids in by_page.items():
        if page_num > len(pages):
            continue
        page_path = pages[page_num - 1]
        image_size = get_image_size(page_path)
        (page_w, page_h), words = parse_pdf_bbox(pdf_path, page_num)
        scale_x = image_size[0] / page_w
        scale_y = image_size[1] / page_h
        label_positions = extract_label_positions(words, qids, scale_x, scale_y)

        for qid in qids:
            crop_path = crop_dir / f'{qid}.jpg'
            if qid in label_positions:
                crop = compute_crop(qid, label_positions, image_size)
                crop_image(page_path, crop_path, crop)
            else:
                crop_path = page_path

            try:
                explanation = openai_explain_question(crop_path, qid, answer_map[qid])
            except Exception as err:
                print(f'Retrying {qid} due to: {err}')
                explanation = openai_explain_question(crop_path, qid, answer_map[qid])

            if not explanation.get('story', '').strip():
                ocr_text = subprocess.run(
                    ['tesseract', str(crop_path), 'stdout', '-l', 'eng', '--psm', '6'],
                    capture_output=True,
                    text=True
                ).stdout
                explanation = openai_explain_from_text(ocr_text, qid, answer_map[qid])

            explanations[qid] = explanation

    out_path = Path(__file__).resolve().parents[1] / 'src' / 'data' / f'explanations_{year}.json'
    out_path.write_text(json.dumps(explanations, ensure_ascii=False, indent=2))
    print(f'Wrote {len(explanations)} explanations to {out_path}')


if __name__ == '__main__':
    main()
