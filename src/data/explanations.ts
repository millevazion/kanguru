import explanations2025 from './explanations_2025.json';
import explanations2024 from './explanations_2024.json';
import explanations2023 from './explanations_2023.json';

export type ExplanationValue = string | { hint?: string; story?: string };
type ExplanationMap = Record<string, ExplanationValue>;

type ExplanationSets = Record<string, ExplanationMap>;

export const explanations: ExplanationSets = {
  '2025': explanations2025,
  '2024': explanations2024,
  '2023': explanations2023
};

export const explanationSources: Record<string, string> = {
  '2025': 'Swiss Kangaroo solution brochure (Broschuere-2025B.pdf), grades 7–13',
  '2024': 'Swiss Kangaroo solution brochure (Broschuere-2024B.pdf), grades 7–13',
  '2023': 'Swiss Kangaroo solution brochure (Broschuere-2023B.pdf), grades 7–13'
};
