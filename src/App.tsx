import { useEffect, useMemo, useState } from 'react';
import PdfPageViewer from './components/PdfPageViewer';
import QuestionCard from './components/QuestionCard';
import { baseScore, questionSets } from './data/questionBank';
import { explanations, explanationSources } from './data/explanations';

type Choice = 'A' | 'B' | 'C' | 'D' | 'E';

type Attempt = {
  answer?: Choice;
  confidence?: 1 | 2 | 3;
  isCorrect?: boolean;
  timestamp?: number;
  hintStep?: number;
};

type ProgressState = Record<string, Attempt>;

type Mode = 'practice' | 'review' | 'sprint';

const STORAGE_KEY = 'kangaroo_progress_v2';

const choiceList: Choice[] = ['A', 'B', 'C', 'D', 'E'];

const hintSteps = [
  'Read the question again. Underline what is asked.',
  'Try the smallest or simplest case first.',
  'Check the easiest answer choice to eliminate wrong ones.'
];

function loadProgress(): ProgressState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    return JSON.parse(stored) as ProgressState;
  } catch {
    return {};
  }
}

function saveProgress(progress: ProgressState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

export default function App() {
  const [currentSetId, setCurrentSetId] = useState(questionSets[0].id);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState<ProgressState>(() => loadProgress());
  const [view, setView] = useState<Mode>('practice');
  const [pdfScale, setPdfScale] = useState(1.2);
  const [pageOverride, setPageOverride] = useState<number | null>(null);
  const [showFullPage, setShowFullPage] = useState(false);
  const [sprintSet, setSprintSet] = useState<number[]>([]);
  const [sprintRemaining, setSprintRemaining] = useState<number | null>(null);
  const [sprintPaused, setSprintPaused] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);

  const activeSet = questionSets.find((set) => set.id === currentSetId) ?? questionSets[0];
  const questions = activeSet.questions;

  const currentQuestion = questions[currentIndex];
  const attempt = progress[`${activeSet.id}-${currentQuestion.id}`] ?? {};
  const explanationEntry = explanations[activeSet.id]?.[currentQuestion.id] as
    | string
    | { story?: string; hint?: string }
    | undefined;
  const storyExplanation = typeof explanationEntry === 'string' ? explanationEntry : explanationEntry?.story ?? '';
  const contextualHint = typeof explanationEntry === 'string' ? '' : explanationEntry?.hint ?? '';
  const activePage = pageOverride ?? currentQuestion.page;
  const sprintActive = view === 'sprint' && sprintRemaining !== null;
  const sprintDone = sprintRemaining === 0;

  const totals = useMemo(() => {
    const attempts = Object.entries(progress)
      .filter(([key]) => key.startsWith(activeSet.id))
      .map(([, value]) => value);
    const answered = attempts.filter((item) => item.answer);
    const correct = attempts.filter((item) => item.isCorrect);
    return {
      answered: answered.length,
      correct: correct.length
    };
  }, [progress, activeSet.id]);

  const computedScore = useMemo(() => {
    const rawScore = questions.reduce((sum, question) => {
      const item = progress[`${activeSet.id}-${question.id}`];
      if (!item?.answer || item.isCorrect == null) return sum;
      if (item.isCorrect) return sum + question.points;
      return sum - question.points * 0.25;
    }, baseScore);
    return Math.max(0, rawScore);
  }, [progress, questions, activeSet.id]);

  const maxScore = useMemo(() => {
    return baseScore + questions.reduce((sum, question) => sum + question.points, 0);
  }, [questions]);

  const accuracy = totals.answered === 0 ? 0 : Math.round((totals.correct / totals.answered) * 100);

  const updateAttempt = (id: string, next: Attempt) => {
    const updated = { ...progress, [id]: next };
    setProgress(updated);
    saveProgress(updated);
  };

  const handleAnswer = (choice: Choice) => {
    updateAttempt(`${activeSet.id}-${currentQuestion.id}`, {
      ...attempt,
      answer: choice,
      isCorrect: choice === currentQuestion.correct,
      timestamp: Date.now()
    });
  };

  const handleConfidence = (level: 1 | 2 | 3) => {
    updateAttempt(`${activeSet.id}-${currentQuestion.id}`, {
      ...attempt,
      confidence: level
    });
  };

  const nextQuestion = () => {
    setCurrentIndex((prev) => (prev + 1) % questions.length);
    setPageOverride(null);
  };

  const prevQuestion = () => {
    setCurrentIndex((prev) => (prev - 1 + questions.length) % questions.length);
    setPageOverride(null);
  };

  const startSprint = () => {
    const available = questions
      .map((q, index) => ({ q, index }))
      .filter(({ q }) => !progress[`${activeSet.id}-${q.id}`]?.answer)
      .map(({ index }) => index);
    const picked = available.length >= 6 ? available.sort(() => 0.5 - Math.random()).slice(0, 6) : available;
    setSprintSet(picked);
    setSprintRemaining(12 * 60);
    setSprintPaused(false);
    if (picked.length > 0) {
      setCurrentIndex(picked[0]);
      setView('sprint');
    } else {
      setView('sprint');
    }
  };

  const pauseSprint = () => setSprintPaused(true);
  const resumeSprint = () => setSprintPaused(false);

  const resetSprint = () => {
    setSprintRemaining(null);
    setSprintPaused(false);
    setSprintSet([]);
  };

  const endSprint = () => {
    resetSprint();
    setView('practice');
  };

  useEffect(() => {
    if (!sprintActive || sprintPaused || sprintRemaining === null || sprintRemaining <= 0) return;
    const interval = setInterval(() => {
      setSprintRemaining((value) => (value === null ? null : Math.max(0, value - 1)));
    }, 1000);
    return () => clearInterval(interval);
  }, [sprintActive, sprintPaused, sprintRemaining]);

  const formatTime = (value: number) => {
    const minutes = Math.floor(value / 60).toString().padStart(2, '0');
    const seconds = (value % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  const resetProgress = () => {
    setProgress({});
    saveProgress({});
  };

  const jumpToQuestion = (id: string) => {
    const index = questions.findIndex((q) => q.id === id);
    if (index >= 0) {
      setCurrentIndex(index);
      setPageOverride(null);
    }
  };

  const revealHint = () => {
    const totalHints = (contextualHint ? 1 : 0) + hintSteps.length;
    const nextStep = Math.min((attempt.hintStep ?? 0) + 1, totalHints);
    updateAttempt(`${activeSet.id}-${currentQuestion.id}`, {
      ...attempt,
      hintStep: nextStep
    });
  };

  useEffect(() => {
    setShowExplanation(false);
  }, [currentQuestion.id, activeSet.id]);

  const questionIdsOnPage = useMemo(() => {
    return questions.filter((q) => q.page === activePage).map((q) => q.id);
  }, [questions, activePage]);

  const nextQuestionOnPage = useMemo(() => {
    const next = questions.slice(currentIndex + 1).find((q) => q.page === activePage);
    return next?.id;
  }, [questions, currentIndex, activePage]);

  return (
    <div className="app">
      {sprintActive && (
        <div className="sprint-bar">
          <div>
            <p className="eyebrow">Sprint mode</p>
            <strong className="sprint-time">{formatTime(sprintRemaining ?? 0)}</strong>
            <span className="sprint-meta">
              {sprintPaused ? 'Paused' : 'Running'} · {sprintSet.length} questions
            </span>
            {sprintDone && <span className="badge bad">Time's up</span>}
          </div>
          <div className="sprint-actions">
            <button className="ghost" onClick={sprintPaused ? resumeSprint : pauseSprint}>
              {sprintPaused ? 'Resume' : 'Pause'}
            </button>
            <button className="ghost" onClick={resetSprint}>Reset sprint</button>
            <button className="ghost" onClick={endSprint}>End sprint</button>
          </div>
        </div>
      )}

      <header className="hero">
        <div>
          <p className="eyebrow">Kangaroo Coach · Year 7-8</p>
          <h1>Pick a question. Answer it. Learn fast.</h1>
          <p className="subhead">
            The question is shown as a picture (so diagrams are included). Answer below.
          </p>
          <div className="hero-actions">
            <button className="primary" onClick={() => setView('practice')}>Start Practice</button>
            <button className="primary outline" onClick={startSprint}>Start Sprint (6 questions)</button>
          </div>
        </div>
        <div className="hero-card fade-in">
          <div className="stat">
            <span className="label">Answered</span>
            <strong>{totals.answered} / {questions.length}</strong>
          </div>
          <div className="stat">
            <span className="label">Accuracy</span>
            <strong>{accuracy}%</strong>
          </div>
          <div className="stat">
            <span className="label">Score</span>
            <strong>{computedScore.toFixed(2)} / {maxScore}</strong>
          </div>
          <p className="hint">Score starts at 30. Correct adds 3/4/5. Wrong subtracts 0.25×points.</p>
        </div>
      </header>

      <section className="mode-strip">
        <button className={`mode-card ${view === 'practice' ? 'active' : ''}`} onClick={() => setView('practice')}>
          <span className="mode-title">Practice</span>
          <span className="mode-desc">One question at a time with hints.</span>
        </button>
        <button className={`mode-card ${view === 'review' ? 'active' : ''}`} onClick={() => setView('review')}>
          <span className="mode-title">Review</span>
          <span className="mode-desc">Return to mistakes and fix them.</span>
        </button>
        <button className={`mode-card ${view === 'sprint' ? 'active' : ''}`} onClick={() => setView('sprint')}>
          <span className="mode-title">Sprint</span>
          <span className="mode-desc">6 questions in 12 minutes.</span>
        </button>
        <button className="mode-card ghost" onClick={resetProgress}>
          <span className="mode-title">Reset</span>
          <span className="mode-desc">Clear all saved answers.</span>
        </button>
      </section>

      <section className="toolbar">
        <div className="toolbar-group">
          <span className="label">Year</span>
          <select
            value={activeSet.id}
            onChange={(event) => {
              setCurrentSetId(event.target.value);
              setCurrentIndex(0);
              setPageOverride(null);
            }}
          >
            {questionSets.map((set) => (
              <option key={set.id} value={set.id}>{set.label}</option>
            ))}
          </select>
        </div>
        <div className="toolbar-group">
          <span className="label">Jump to</span>
          <select value={currentQuestion.id} onChange={(event) => jumpToQuestion(event.target.value)}>
            <optgroup label="3-point (A)">
              {questions.filter((q) => q.section === 'A').map((q) => (
                <option key={q.id} value={q.id}>{q.id}</option>
              ))}
            </optgroup>
            <optgroup label="4-point (B)">
              {questions.filter((q) => q.section === 'B').map((q) => (
                <option key={q.id} value={q.id}>{q.id}</option>
              ))}
            </optgroup>
            <optgroup label="5-point (C)">
              {questions.filter((q) => q.section === 'C').map((q) => (
                <option key={q.id} value={q.id}>{q.id}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="toolbar-action">
          <button className="primary" onClick={startSprint}>Sprint: 6 questions</button>
          <span className="hint">12 minutes. Pause anytime.</span>
        </div>
      </section>

      {view === 'review' && (
        <section className="panel review">
          <div className="review-head">
            <div>
              <p className="eyebrow">Review</p>
              <h3>Fix mistakes to level up.</h3>
            </div>
            <p className="hint">Tap a question to return to practice.</p>
          </div>
          <div className="review-grid">
            {questions.filter((q) => progress[`${activeSet.id}-${q.id}`]?.isCorrect === false).length === 0 ? (
              <p className="neutral">No incorrect answers yet. Keep going or start a sprint.</p>
            ) : (
              questions
                .filter((q) => progress[`${activeSet.id}-${q.id}`]?.isCorrect === false)
                .map((q) => (
                  <button
                    key={q.id}
                    className="review-card"
                    onClick={() => {
                      setCurrentIndex(questions.findIndex((item) => item.id === q.id));
                      setPageOverride(null);
                      setView('practice');
                    }}
                  >
                    <span>Question {q.id}</span>
                    <strong>Correct: {q.correct}</strong>
                  </button>
                ))
            )}
          </div>
        </section>
      )}

      <main className="grid">
        <section className="panel left">
          <div className="question-head">
            <div>
              <p className="eyebrow">Question {currentQuestion.id}</p>
              <h2>{currentQuestion.points}-point challenge</h2>
              <p className="hint">This is the exact question card (with drawings).</p>
            </div>
            <div className="nav-buttons">
              <button className="ghost" onClick={prevQuestion}>Prev</button>
              <button className="ghost" onClick={nextQuestion}>Next</button>
            </div>
          </div>

          <div className="question-preview">
            <QuestionCard
              url={activeSet.pdfUrl}
              page={activePage}
              questionId={currentQuestion.id}
              questionIdsOnPage={questionIdsOnPage}
              nextQuestionId={nextQuestionOnPage}
              scale={pdfScale}
            />
            <div className="preview-controls">
              <div className="control-group">
                <button className="ghost" onClick={() => setPdfScale((s) => Math.max(0.8, s - 0.1))}>-</button>
                <span className="scale">{Math.round(pdfScale * 100)}%</span>
                <button className="ghost" onClick={() => setPdfScale((s) => Math.min(1.8, s + 0.1))}>+</button>
                <button className="ghost" onClick={() => setPdfScale(1.2)}>Fit</button>
              </div>
              <button className="ghost" onClick={() => setShowFullPage((value) => !value)}>
                {showFullPage ? 'Hide full page' : 'Show full page'}
              </button>
            </div>
          </div>

          <p className="label">Pick an answer</p>
          <div className="choice-grid">
            {choiceList.map((choice) => {
              const isSelected = attempt.answer === choice;
              const isCorrect = attempt.isCorrect && isSelected;
              const isWrong = attempt.answer === choice && attempt.isCorrect === false;
              return (
                <button
                  key={choice}
                  className={`choice ${isSelected ? 'selected' : ''} ${isCorrect ? 'correct' : ''} ${isWrong ? 'wrong' : ''}`}
                  onClick={() => handleAnswer(choice)}
                >
                  <span className="choice-letter">{choice}</span>
                  <span className="choice-text">Answer {choice}</span>
                </button>
              );
            })}
          </div>

          <div className="feedback">
            {attempt.answer ? (
              attempt.isCorrect ? (
                <p className="good">Nice! You picked {attempt.answer}. Keep the momentum.</p>
              ) : (
                <p className="bad">Not quite. Correct answer is {currentQuestion.correct}. Try a hint.</p>
              )
            ) : (
              <p className="neutral">Pick an option when ready. Speed matters, but calm thinking wins.</p>
            )}
          </div>

          <div className="confidence">
            <div className="confidence-head">
              <p className="label">How sure were you?</p>
              <span className="hint">This helps you spot guesses vs real understanding.</span>
            </div>
            <div className="confidence-row">
              {[
                { value: 1, label: 'Guess' },
                { value: 2, label: 'Maybe' },
                { value: 3, label: 'Sure' }
              ].map((level) => (
                <button
                  key={level.value}
                  className={`pill ${attempt.confidence === level.value ? 'active' : ''}`}
                  onClick={() => handleConfidence(level.value as 1 | 2 | 3)}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>

          <div className="coach">
            <div className="coach-head">
              <p className="label">Need a hint?</p>
              <button className="ghost" onClick={revealHint}>
                {attempt.hintStep ? 'Next hint' : 'Show hint'}
              </button>
            </div>
            <div className="hint-stack">
              {contextualHint && (attempt.hintStep ?? 0) >= 1 && (
                <div className="hint-card">{contextualHint}</div>
              )}
              {hintSteps.slice(0, Math.max(0, (attempt.hintStep ?? 0) - (contextualHint ? 1 : 0))).map((hint) => (
                <div key={hint} className="hint-card">{hint}</div>
              ))}
              {(attempt.hintStep ?? 0) === 0 && <p className="neutral">Hints appear here, one at a time.</p>}
            </div>
          </div>

          <div className="explanation">
            <div className="coach-head">
              <p className="label">Story explanation</p>
              <button
                className="ghost"
                onClick={() => setShowExplanation((value) => !value)}
                disabled={!attempt.answer}
              >
                {showExplanation ? 'Hide' : 'Show'}
              </button>
            </div>
            {showExplanation ? (
              storyExplanation ? (
                <div className="hint-card">
                  <p>{storyExplanation}</p>
                  <p className="hint">Source: {explanationSources[activeSet.id]}</p>
                </div>
              ) : (
                <p className="neutral">
                  Explanation not loaded yet for this year. Add the solution brochure to generate it.
                </p>
              )
            ) : (
              <p className="neutral">
                {attempt.answer ? 'Tap “Show” to see the explanation.' : 'Answer first to unlock the story explanation.'}
              </p>
            )}
          </div>

          {showFullPage && (
            <div className="full-page">
              <div className="pdf-controls">
                <div>
                  <p className="eyebrow">Full page view</p>
                  <p className="hint">Use this if the cropped card feels too tight.</p>
                </div>
                <div className="control-group">
                  <button className="ghost" onClick={() => setPdfScale((s) => Math.max(0.8, s - 0.1))}>-</button>
                  <span className="scale">{Math.round(pdfScale * 100)}%</span>
                  <button className="ghost" onClick={() => setPdfScale((s) => Math.min(1.8, s + 0.1))}>+</button>
                </div>
              </div>
              <PdfPageViewer url={activeSet.pdfUrl} page={activePage} scale={pdfScale} />
            </div>
          )}

          {view === 'sprint' && (
            <div className="sprint">
              <p className="label">Sprint lineup</p>
              <p className="hint">Tap a chip to jump within the sprint set.</p>
              <div className="sprint-list">
                {sprintSet.length === 0 && <span className="neutral">Start a sprint to load questions.</span>}
                {sprintSet.map((index) => {
                  const q = questions[index];
                  const status = progress[`${activeSet.id}-${q.id}`]?.isCorrect;
                  return (
                    <button
                      key={q.id}
                      className={`sprint-chip ${currentIndex === index ? 'active' : ''}`}
                      onClick={() => {
                        setCurrentIndex(index);
                        setPageOverride(null);
                      }}
                    >
                      {q.id}
                      {status === true && <span className="badge good">✓</span>}
                      {status === false && <span className="badge bad">×</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <p>Tip: If a question feels hard, take a hint and try again before checking the answer.</p>
      </footer>
    </div>
  );
}
