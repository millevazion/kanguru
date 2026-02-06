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

type AnswerOverrides = Record<string, Record<string, Choice>>;

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
  const [sprintStarted, setSprintStarted] = useState(false);
  const [sprintSubmitted, setSprintSubmitted] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [answerOverrides, setAnswerOverrides] = useState<AnswerOverrides>({});
  const [serverOverrides, setServerOverrides] = useState<AnswerOverrides>({});
  const [overridesStatus, setOverridesStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [overridesError, setOverridesError] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [adminStatus, setAdminStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [adminMessage, setAdminMessage] = useState('');
  const [showAdmin, setShowAdmin] = useState(false);

  const adminMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).has('admin');
  }, []);

  const activeSet = questionSets.find((set) => set.id === currentSetId) ?? questionSets[0];
  const activeSetBaseQuestions = activeSet.questions;
  const questions = useMemo(() => {
    const overrides = answerOverrides[activeSet.id] ?? {};
    return activeSetBaseQuestions.map((question) => ({
      ...question,
      correct: overrides[question.id] ?? question.correct
    }));
  }, [activeSet.id, activeSetBaseQuestions, answerOverrides]);

  const currentQuestion = questions[currentIndex];
  const attempt = progress[`${activeSet.id}-${currentQuestion.id}`] ?? {};
  const currentIsCorrect = attempt.answer ? attempt.answer === currentQuestion.correct : null;
  const activePage = pageOverride ?? currentQuestion.page;
  const questionIdsByPage = useMemo(() => {
    const map = new Map<number, string[]>();
    questions.forEach((question) => {
      const list = map.get(question.page) ?? [];
      list.push(question.id);
      map.set(question.page, list);
    });
    return map;
  }, [questions]);
  const getQuestionIdsOnPage = (page: number) => questionIdsByPage.get(page) ?? [];
  const getNextQuestionIdOnPage = (question: typeof questions[number]) => {
    const ids = questionIdsByPage.get(question.page) ?? [];
    const index = ids.indexOf(question.id);
    return index >= 0 ? ids[index + 1] : undefined;
  };
  const getExplanationFor = (questionId: string) => {
    const entry = explanations[activeSet.id]?.[questionId] as
      | string
      | { story?: string; hint?: string }
      | undefined;
    if (!entry) return { story: '', hint: '' };
    if (typeof entry === 'string') return { story: entry, hint: '' };
    return { story: entry.story ?? '', hint: entry.hint ?? '' };
  };
  const { story: storyExplanation, hint: contextualHint } = getExplanationFor(currentQuestion.id);
  const sprintActive = view === 'sprint' && sprintRemaining !== null;
  const sprintQuestions = useMemo(
    () => sprintSet.flatMap((index) => (questions[index] ? [questions[index]] : [])),
    [sprintSet, questions]
  );
  const sprintAnsweredCount = useMemo(
    () => sprintQuestions.filter((question) => progress[`${activeSet.id}-${question.id}`]?.answer).length,
    [sprintQuestions, progress, activeSet.id]
  );
  const sprintCorrectCount = useMemo(
    () => sprintQuestions.filter((question) => {
      const answer = progress[`${activeSet.id}-${question.id}`]?.answer;
      return answer ? answer === question.correct : false;
    }).length,
    [sprintQuestions, progress, activeSet.id]
  );

  const totals = useMemo(() => {
    const answers = Object.entries(progress)
      .filter(([key]) => key.startsWith(activeSet.id))
      .map(([key, value]) => ({
        id: key.split('-')[1],
        answer: value.answer
      }));
    const answered = answers.filter((item) => item.answer);
    const correct = answers.filter((item) => item.answer && item.answer === questions.find((q) => q.id === item.id)?.correct);
    return {
      answered: answered.length,
      correct: correct.length
    };
  }, [progress, activeSet.id, questions]);

  const computedScore = useMemo(() => {
    const rawScore = questions.reduce((sum, question) => {
      const item = progress[`${activeSet.id}-${question.id}`];
      if (!item?.answer) return sum;
      if (item.answer === question.correct) return sum + question.points;
      return sum - question.points * 0.25;
    }, baseScore);
    return Math.max(0, rawScore);
  }, [progress, questions, activeSet.id]);

  const maxScore = useMemo(() => {
    return baseScore + questions.reduce((sum, question) => sum + question.points, 0);
  }, [questions]);

  const accuracy = totals.answered === 0 ? 0 : Math.round((totals.correct / totals.answered) * 100);

  const overridesDirty = useMemo(
    () => JSON.stringify(answerOverrides) !== JSON.stringify(serverOverrides),
    [answerOverrides, serverOverrides]
  );

  useEffect(() => {
    let cancelled = false;
    const loadOverrides = async () => {
      setOverridesStatus('loading');
      setOverridesError('');
      try {
        const response = await fetch('/api/answer-overrides');
        if (!response.ok) {
          throw new Error(`Failed to load overrides (${response.status})`);
        }
        const data = await response.json();
        if (cancelled) return;
        const overrides = (data?.overrides ?? {}) as AnswerOverrides;
        setAnswerOverrides(overrides);
        setServerOverrides(overrides);
        setOverridesStatus('idle');
      } catch (error) {
        if (cancelled) return;
        setOverridesStatus('error');
        setOverridesError(error instanceof Error ? error.message : 'Failed to load overrides.');
      }
    };
    loadOverrides();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateAttempt = (id: string, next: Attempt) => {
    const updated = { ...progress, [id]: next };
    setProgress(updated);
    saveProgress(updated);
  };

  const updateAnswerOverride = (questionId: string, value: Choice) => {
    setAnswerOverrides((prev) => {
      const original = activeSetBaseQuestions.find((q) => q.id === questionId)?.correct;
      const next = { ...prev };
      const setOverrides = { ...(next[activeSet.id] ?? {}) };
      if (original && value === original) {
        delete setOverrides[questionId];
      } else {
        setOverrides[questionId] = value;
      }
      if (Object.keys(setOverrides).length === 0) {
        delete next[activeSet.id];
      } else {
        next[activeSet.id] = setOverrides;
      }
      return next;
    });
  };

  const resetAnswerOverrides = () => {
    setAnswerOverrides((prev) => {
      const next = { ...prev };
      delete next[activeSet.id];
      return next;
    });
  };

  const refreshOverrides = async () => {
    setOverridesStatus('loading');
    setOverridesError('');
    try {
      const response = await fetch('/api/answer-overrides');
      if (!response.ok) {
        throw new Error(`Failed to load overrides (${response.status})`);
      }
      const data = await response.json();
      const overrides = (data?.overrides ?? {}) as AnswerOverrides;
      setAnswerOverrides(overrides);
      setServerOverrides(overrides);
      setOverridesStatus('idle');
      setAdminMessage('Overrides refreshed.');
      setAdminStatus('saved');
    } catch (error) {
      setOverridesStatus('error');
      setOverridesError(error instanceof Error ? error.message : 'Failed to load overrides.');
      setAdminStatus('error');
      setAdminMessage('Refresh failed.');
    }
  };

  const saveOverrides = async () => {
    if (!adminToken) {
      setAdminStatus('error');
      setAdminMessage('Admin token required.');
      return;
    }
    setAdminStatus('saving');
    setAdminMessage('');
    try {
      const response = await fetch('/api/answer-overrides', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken
        },
        body: JSON.stringify({ overrides: answerOverrides })
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Save failed (${response.status})`);
      }
      setServerOverrides(answerOverrides);
      setAdminStatus('saved');
      setAdminMessage('Overrides saved.');
    } catch (error) {
      setAdminStatus('error');
      setAdminMessage(error instanceof Error ? error.message : 'Save failed.');
    }
  };

  const recordAnswer = (question: typeof questions[number], choice: Choice) => {
    const key = `${activeSet.id}-${question.id}`;
    const existing = progress[key] ?? {};
    updateAttempt(key, {
      ...existing,
      answer: choice,
      isCorrect: choice === question.correct,
      timestamp: Date.now()
    });
  };

  const handleAnswer = (choice: Choice) => {
    recordAnswer(currentQuestion, choice);
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

  const startSprint = (setId: string = activeSet.id) => {
    const chosenSet = questionSets.find((set) => set.id === setId) ?? activeSet;
    const pool = chosenSet.questions.map((_, index) => index);
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked = pool.slice(0, Math.min(6, pool.length));
    setSprintSet(picked);
    setSprintRemaining(12 * 60);
    setSprintPaused(true);
    setSprintStarted(false);
    setSprintSubmitted(false);
    if (picked.length > 0) {
      setCurrentIndex(picked[0]);
    } else {
      setCurrentIndex(0);
    }
    setCurrentSetId(chosenSet.id);
    setPageOverride(null);
    setShowFullPage(false);
    setView('sprint');
  };

  const toggleSprint = () => {
    if (!sprintStarted) {
      setSprintStarted(true);
      setSprintPaused(false);
      return;
    }
    setSprintPaused((value) => !value);
  };

  const resetSprint = () => {
    setSprintRemaining(null);
    setSprintPaused(false);
    setSprintSet([]);
    setSprintStarted(false);
    setSprintSubmitted(false);
  };

  const endSprint = () => {
    resetSprint();
    setView('practice');
  };

  const submitSprint = () => {
    if (sprintSubmitted) return;
    setSprintSubmitted(true);
    setSprintPaused(true);
    setSprintStarted(true);
  };

  useEffect(() => {
    if (
      !sprintActive
      || sprintPaused
      || sprintRemaining === null
      || sprintRemaining <= 0
      || sprintSubmitted
      || !sprintStarted
    ) {
      return;
    }
    const interval = setInterval(() => {
      setSprintRemaining((value) => (value === null ? null : Math.max(0, value - 1)));
    }, 1000);
    return () => clearInterval(interval);
  }, [sprintActive, sprintPaused, sprintRemaining, sprintSubmitted, sprintStarted]);

  useEffect(() => {
    if (sprintRemaining === 0 && !sprintSubmitted) {
      setSprintSubmitted(true);
      setSprintPaused(true);
      setSprintStarted(true);
    }
  }, [sprintRemaining, sprintSubmitted]);

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

  const questionIdsOnPage = useMemo(() => questionIdsByPage.get(activePage) ?? [], [questionIdsByPage, activePage]);

  const nextQuestionOnPage = useMemo(() => {
    const ids = questionIdsByPage.get(activePage) ?? [];
    const index = ids.indexOf(currentQuestion.id);
    return index >= 0 ? ids[index + 1] : undefined;
  }, [questionIdsByPage, activePage, currentQuestion.id]);

  return (
    <div className="app">
      {view !== 'sprint' && (
        <>
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
            <button className={`mode-card ${view === 'sprint' ? 'active' : ''}`} onClick={startSprint}>
              <span className="mode-title">Sprint</span>
              <span className="mode-desc">6 questions, submit to reveal answers.</span>
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
              <span className="hint">12 minutes. Submit to see answers.</span>
            </div>
          </section>
        </>
      )}

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
            {questions.filter((q) => {
              const answer = progress[`${activeSet.id}-${q.id}`]?.answer;
              return answer && answer !== q.correct;
            }).length === 0 ? (
              <p className="neutral">No incorrect answers yet. Keep going or start a sprint.</p>
            ) : (
              questions
                .filter((q) => {
                  const answer = progress[`${activeSet.id}-${q.id}`]?.answer;
                  return answer && answer !== q.correct;
                })
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

      {view === 'sprint' ? (
        <main className="sprint-layout">
          <section className="sprint-dock">
            <div className="sprint-dock-block">
              <span className="label">Time</span>
              <strong className="sprint-dock-time">{formatTime(sprintRemaining ?? 0)}</strong>
              <span className="hint">
                {sprintSubmitted ? 'Submitted' : sprintStarted ? (sprintPaused ? 'Paused' : 'Running') : 'Ready'}
              </span>
            </div>
            <div className="sprint-dock-block">
              <span className="label">Answered</span>
              <strong>{sprintAnsweredCount} / {sprintQuestions.length || 6}</strong>
            </div>
            <div className="sprint-dock-block">
              <span className="label">Year</span>
              <select
                value={activeSet.id}
                onChange={(event) => {
                  startSprint(event.target.value);
                }}
              >
                {questionSets.map((set) => (
                  <option key={set.id} value={set.id}>{set.label}</option>
                ))}
              </select>
            </div>
            <div className="sprint-dock-block sprint-dock-actions">
              <button
                className="primary"
                onClick={toggleSprint}
                disabled={sprintSubmitted || sprintQuestions.length === 0}
              >
                {!sprintStarted ? 'Start sprint' : sprintPaused ? 'Resume' : 'Pause'}
              </button>
              {sprintSubmitted && <span className="badge good">Submitted</span>}
            </div>
          </section>

          <section className="panel sprint-header">
            <div className="sprint-header-top">
              <div>
                <p className="eyebrow">Sprint mode</p>
                <h2>Six questions. One run.</h2>
                <p className="hint">Answer all six, then submit at the end to reveal answers and explanations.</p>
              </div>
              <div className="sprint-header-actions">
                {adminMode && (
                  <button className="ghost" onClick={() => setShowAdmin((value) => !value)}>
                    {showAdmin ? 'Hide admin' : 'Admin'}
                  </button>
                )}
                <button className="ghost" onClick={endSprint}>Exit sprint</button>
                <button className="ghost" onClick={startSprint}>New set</button>
              </div>
            </div>
            {!sprintStarted && !sprintSubmitted && (
              <p className="hint sprint-start-note">Timer starts when you press “Start sprint”.</p>
            )}
          </section>

          <section className="sprint-stack">
            {sprintQuestions.length === 0 ? (
              <p className="neutral">Start a sprint to load questions.</p>
            ) : (
              sprintQuestions.map((question) => {
                const sprintAttempt = progress[`${activeSet.id}-${question.id}`] ?? {};
                const answer = sprintAttempt.answer;
                const isCorrect = answer ? answer === question.correct : false;
                const { story, hint } = getExplanationFor(question.id);
                const questionIds = getQuestionIdsOnPage(question.page);
                const nextId = getNextQuestionIdOnPage(question);
                return (
                  <article key={question.id} className="sprint-item">
                    <div className="sprint-question-head">
                      <div>
                        <p className="eyebrow">Question {question.id}</p>
                        <h3>{question.points}-point</h3>
                      </div>
                      {sprintSubmitted && (
                        <span className={`badge ${isCorrect ? 'good' : 'bad'}`}>
                          {isCorrect ? 'Correct' : 'Incorrect'}
                        </span>
                      )}
                    </div>

                    <QuestionCard
                      url={activeSet.pdfUrl}
                      page={question.page}
                      questionId={question.id}
                      questionIdsOnPage={questionIds}
                      nextQuestionId={nextId}
                      scale={1.05}
                    />

                    <div className="choice-grid sprint-choice-grid">
                      {choiceList.map((choice) => {
                        const isSelected = answer === choice;
                        const reveal = sprintSubmitted;
                        const showCorrect = reveal && choice === question.correct;
                        const showWrong = reveal && isSelected && choice !== question.correct;
                        return (
                          <button
                            key={choice}
                            className={`choice ${isSelected ? 'selected' : ''} ${showCorrect ? 'correct' : ''} ${showWrong ? 'wrong' : ''}`}
                            onClick={() => recordAnswer(question, choice)}
                            disabled={sprintSubmitted}
                          >
                            <span className="choice-letter">{choice}</span>
                            <span className="choice-text">Answer {choice}</span>
                          </button>
                        );
                      })}
                    </div>

                    {sprintSubmitted && (
                      <div className="sprint-result">
                        <p className={isCorrect ? 'good' : 'bad'}>
                          Your answer: {answer ?? '—'} · Correct: {question.correct}
                        </p>
                        {story ? (
                          <p>{story}</p>
                        ) : (
                          <p className="neutral">Explanation not loaded yet for this year.</p>
                        )}
                        {hint && <p className="hint">Hint: {hint}</p>}
                        {story && <p className="hint">Source: {explanationSources[activeSet.id]}</p>}
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </section>

          <section className="panel sprint-submit">
            <div className="sprint-submit-head">
              <div>
                <p className="eyebrow">Submit</p>
                <h3>{sprintSubmitted ? 'Results' : 'Ready to check?'}</h3>
                <p className="hint">Submit to reveal answers and explanations for all six questions.</p>
              </div>
              {!sprintSubmitted && (
                <button className="primary" onClick={submitSprint} disabled={sprintQuestions.length === 0}>
                  Submit sprint
                </button>
              )}
            </div>
            {sprintSubmitted && (
              <div className="sprint-score">
                <div>
                  <span className="label">Correct</span>
                  <strong>{sprintCorrectCount} / {sprintQuestions.length || 6}</strong>
                </div>
                <div>
                  <span className="label">Accuracy</span>
                  <strong>
                    {sprintQuestions.length
                      ? Math.round((sprintCorrectCount / sprintQuestions.length) * 100)
                      : 0}
                    %
                  </strong>
                </div>
                <button className="ghost" onClick={startSprint}>New sprint</button>
              </div>
            )}
          </section>

          {adminMode && showAdmin && (
            <section className="panel admin-panel">
              <div className="admin-head">
                <div>
                  <p className="eyebrow">Admin</p>
                  <h3>Answer key overrides</h3>
                  <p className="hint">Adjust answers for the current year. Changes apply globally after saving.</p>
                </div>
                <div className="admin-actions">
                  <button className="ghost" onClick={refreshOverrides} disabled={overridesStatus === 'loading'}>
                    Refresh
                  </button>
                  <button className="ghost" onClick={resetAnswerOverrides}>Reset year</button>
                  <button className="primary" onClick={saveOverrides} disabled={!overridesDirty || adminStatus === 'saving'}>
                    {adminStatus === 'saving' ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
              <div className="admin-auth">
                <label>
                  <span className="label">Admin token</span>
                  <input
                    type="password"
                    value={adminToken}
                    onChange={(event) => setAdminToken(event.target.value)}
                    placeholder="Enter admin token"
                  />
                </label>
                <div className="admin-status">
                  {overridesStatus === 'loading' && <span className="hint">Loading overrides…</span>}
                  {overridesStatus === 'error' && <span className="bad">{overridesError}</span>}
                  {adminMessage && (
                    <span className={adminStatus === 'error' ? 'bad' : 'good'}>{adminMessage}</span>
                  )}
                  {!overridesDirty && overridesStatus === 'idle' && (
                    <span className="hint">No unsaved changes.</span>
                  )}
                </div>
              </div>
              <div className="admin-grid">
                {questions.map((question) => {
                  const original = activeSetBaseQuestions.find((q) => q.id === question.id)?.correct ?? question.correct;
                  return (
                    <div key={question.id} className="admin-row">
                      <span className="admin-id">{question.id}</span>
                      <select
                        value={question.correct}
                        onChange={(event) => updateAnswerOverride(question.id, event.target.value as Choice)}
                      >
                        {choiceList.map((choice) => (
                          <option key={choice} value={choice}>{choice}</option>
                        ))}
                      </select>
                      <span className="hint">Default: {original}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </main>
      ) : (
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
                const isCorrect = currentIsCorrect === true && isSelected;
                const isWrong = currentIsCorrect === false && isSelected;
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
                currentIsCorrect ? (
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
          </section>
        </main>
      )}

      <footer className="footer">
        <p>Tip: If a question feels hard, take a hint and try again before checking the answer.</p>
      </footer>
    </div>
  );
}
