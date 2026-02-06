# Kangaroo Coach

A kid-friendly practice app for the Kanguru mathematics competition (Year 7-8).

## Quick start

```bash
npm install
npm run dev
```

## Notes

- PDFs are stored in `public/`:
  - `/Users/sebi/dev/eng_kids/public/kangaroo-2025/kangaroo-2025.pdf`
  - `/Users/sebi/dev/eng_kids/public/kangaroo-2024/kangaroo-2024.pdf`
  - `/Users/sebi/dev/eng_kids/public/kangaroo-2023/kangaroo-2023.pdf`
- Question sets and answer keys are defined in `/Users/sebi/dev/eng_kids/src/data/questionBank.ts`.
- The UI renders each question as a cropped image from the PDF so diagrams are included.

## Story explanations (OCR + OpenAI translation)

Requirements:
- `pdftoppm` (from poppler)
- `tesseract`
- `OPENAI_API_KEY` in your environment

Run (one per year):

```bash
OPENAI_API_KEY=YOUR_KEY python3 /Users/sebi/dev/eng_kids/scripts/ocr_translate_solutions.py /Users/sebi/Downloads/Broschuere-2025B.pdf 2025
OPENAI_API_KEY=YOUR_KEY python3 /Users/sebi/dev/eng_kids/scripts/ocr_translate_solutions.py /Users/sebi/Downloads/Broschuere-2024B.pdf 2024
OPENAI_API_KEY=YOUR_KEY python3 /Users/sebi/dev/eng_kids/scripts/ocr_translate_solutions.py /Users/sebi/Downloads/Broschuere-2023B.pdf 2023
```

This will populate:
- `/Users/sebi/dev/eng_kids/src/data/explanations_2025.json`
- `/Users/sebi/dev/eng_kids/src/data/explanations_2024.json`
- `/Users/sebi/dev/eng_kids/src/data/explanations_2023.json`
