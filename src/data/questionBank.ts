export type Choice = 'A' | 'B' | 'C' | 'D' | 'E';

export type Question = {
  id: string;
  index: number;
  section: 'A' | 'B' | 'C';
  points: 3 | 4 | 5;
  page: number;
  correct: Choice;
};

export type QuestionSet = {
  id: string;
  label: string;
  pdfUrl: string;
  questions: Question[];
};

const buildQuestions = (answerKey: Choice[], pdfUrl: string, label: string, id: string): QuestionSet => {
  const questionIds = [
    ...Array.from({ length: 10 }, (_, i) => `A${i + 1}`),
    ...Array.from({ length: 10 }, (_, i) => `B${i + 1}`),
    ...Array.from({ length: 10 }, (_, i) => `C${i + 1}`)
  ];

  const questions = questionIds.map((qid, idx) => {
    const section = qid[0] as Question['section'];
    const points = section === 'A' ? 3 : section === 'B' ? 4 : 5;
    const number = parseInt(qid.slice(1), 10);
    const page = section === 'A'
      ? (number <= 7 ? 1 : 2)
      : section === 'B'
        ? (number <= 5 ? 2 : 3)
        : (number <= 3 ? 3 : 4);
    return {
      id: qid,
      index: idx + 1,
      section,
      points,
      page,
      correct: answerKey[idx]
    };
  });

  return { id, label, pdfUrl, questions };
};

// Official answer keys from Math Kangaroo USA (grades 7-8).
const answers2025: Choice[] = [
  'D', 'E', 'B', 'A', 'B', 'E', 'B', 'C', 'A', 'E',
  'A', 'C', 'B', 'D', 'D', 'D', 'A', 'B', 'E', 'B',
  'D', 'A', 'C', 'B', 'C', 'D', 'B', 'E', 'A', 'D'
];

const answers2024: Choice[] = [
  'D', 'E', 'D', 'C', 'B', 'C', 'A', 'B', 'D', 'E',
  'A', 'D', 'E', 'B', 'D', 'D', 'C', 'C', 'B', 'D',
  'A', 'C', 'A', 'E', 'E', 'B', 'D', 'B', 'A', 'E'
];

const answers2023: Choice[] = [
  'D', 'E', 'A', 'B', 'D', 'C', 'D', 'A', 'B', 'A',
  'B', 'E', 'E', 'C', 'B', 'D', 'A', 'D', 'B', 'D',
  'D', 'E', 'B', 'C', 'E', 'A', 'C', 'C', 'B', 'D'
];

export const questionSets: QuestionSet[] = [
  buildQuestions(answers2025, '/kangaroo-2025/kangaroo-2025.pdf', '2025 (Official)', '2025'),
  buildQuestions(answers2024, '/kangaroo-2024/kangaroo-2024.pdf', '2024 (Official)', '2024'),
  buildQuestions(answers2023, '/kangaroo-2023/kangaroo-2023.pdf', '2023 (Official)', '2023')
];

export const baseScore = 30;
