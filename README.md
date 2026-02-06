# Kangaroo Coach

A kid-friendly practice app for the Kanguru mathematics competition (Year 7-8).

## Quick start

```bash
npm install
npm run dev
```

## Notes

- PDFs are stored in `public/`:
  - `public/kangaroo-2025/kangaroo-2025.pdf`
  - `public/kangaroo-2024/kangaroo-2024.pdf`
  - `public/kangaroo-2023/kangaroo-2023.pdf`
- Question sets and answer keys are defined in `src/data/questionBank.ts`.
- The UI renders each question as a cropped image from the PDF so diagrams are included.

## Answer key overrides (admin)

The sprint admin panel lets you update question-to-answer overrides that apply to all users.
These are stored in Vercel Edge Config and loaded at runtime.

Setup in Vercel project settings:
- `EDGE_CONFIG_ID` (Edge Config ID)
- `VERCEL_API_TOKEN` (Vercel API token with access to Edge Config)
- `ADMIN_TOKEN` (shared secret required by the admin panel)
- `VERCEL_TEAM_ID` (optional, only needed for team projects)

To open the admin panel, add `?admin=1` to the URL. Enter the `ADMIN_TOKEN` to save changes.

## Story explanations (OCR + OpenAI translation)

Requirements:
- `pdftoppm` (from poppler)
- `tesseract`
- `OPENAI_API_KEY` in your environment

Run (one per year):

```bash
OPENAI_API_KEY=YOUR_KEY python3 scripts/ocr_translate_solutions.py /Users/sebi/Downloads/Broschuere-2025B.pdf 2025
OPENAI_API_KEY=YOUR_KEY python3 scripts/ocr_translate_solutions.py /Users/sebi/Downloads/Broschuere-2024B.pdf 2024
OPENAI_API_KEY=YOUR_KEY python3 scripts/ocr_translate_solutions.py /Users/sebi/Downloads/Broschuere-2023B.pdf 2023
```

This will populate:
- `src/data/explanations_2025.json`
- `src/data/explanations_2024.json`
- `src/data/explanations_2023.json`
