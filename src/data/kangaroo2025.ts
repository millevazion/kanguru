export type Question = {
  id: string;
  index: number;
  section: 'A' | 'B' | 'C';
  points: 3 | 4 | 5;
  page: number;
  correct: 'A' | 'B' | 'C' | 'D' | 'E';
};

const answerKey: Array<'A' | 'B' | 'C' | 'D' | 'E'> = [
  'C', 'E', 'E', 'B', 'A', 'E', 'C', 'B', 'B', 'A',
  'C', 'A', 'D', 'B', 'D', 'C', 'B', 'D', 'A', 'B',
  'A', 'D', 'E', 'C', 'D', 'B', 'C', 'B', 'D', 'A'
];

const questionIds = [
  ...Array.from({ length: 10 }, (_, i) => `A${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `B${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `C${i + 1}`)
];

export const questions: Question[] = questionIds.map((id, idx) => {
  const section = id[0] as Question['section'];
  const points = section === 'A' ? 3 : section === 'B' ? 4 : 5;
  const page = section === 'A' ? 1 : section === 'B' ? 2 : (parseInt(id.slice(1), 10) <= 5 ? 3 : 4);
  return {
    id,
    index: idx + 1,
    section,
    points,
    page,
    correct: answerKey[idx]
  };
});

export const totalQuestions = questions.length;
export const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
export const baseScore = 30;
export const maxScore = baseScore + totalPoints;
