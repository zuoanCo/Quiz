import type { Chapter, Question, QuestionInput, RemoteBankConfig, StudySnapshot, Subject } from "../../types";
import { createId, nowIso } from "../id";
import { requiresOptions } from "../questionTypes";
import { createEmptySnapshot, defaultRemoteConfig } from "../initialSnapshot";

const STORAGE_KEY = "study-assistant:v2";
const LEGACY_SEED_SUBJECT_IDS = new Set(["subject_computer", "subject_math", "subject_english"]);
const LEGACY_SEED_CHAPTER_IDS = new Set(["chapter_data", "chapter_network", "chapter_algebra"]);
const LEGACY_SEED_QUESTION_IDS = new Set([
  "question_binary",
  "question_network",
  "question_short",
  "question_true_false",
  "question_fill_blank",
  "question_essay"
]);

function removeLegacySeedData(snapshot: StudySnapshot): StudySnapshot {
  const questions = snapshot.questions.filter(
    (question) => question.source !== "seed" && !LEGACY_SEED_QUESTION_IDS.has(question.id)
  );
  const subjectIdsWithRealQuestions = new Set(questions.map((question) => question.subjectId));
  const chapterIdsWithRealQuestions = new Set(questions.map((question) => question.chapterId).filter(Boolean));
  const chapters = snapshot.chapters.filter(
    (chapter) =>
      !LEGACY_SEED_CHAPTER_IDS.has(chapter.id) || chapterIdsWithRealQuestions.has(chapter.id) || !LEGACY_SEED_SUBJECT_IDS.has(chapter.subjectId)
  );
  const subjects = snapshot.subjects.filter(
    (subject) => !LEGACY_SEED_SUBJECT_IDS.has(subject.id) || subjectIdsWithRealQuestions.has(subject.id)
  );

  return {
    ...snapshot,
    subjects,
    chapters,
    questions
  };
}

function normalizeSnapshot(value: unknown): StudySnapshot {
  const fallback = createEmptySnapshot();
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const raw = value as Partial<StudySnapshot>;
  return removeLegacySeedData({
    version: 1,
    subjects: Array.isArray(raw.subjects) ? raw.subjects : fallback.subjects,
    chapters: Array.isArray(raw.chapters) ? raw.chapters : fallback.chapters,
    questions: Array.isArray(raw.questions) ? raw.questions : fallback.questions,
    remoteConfig: raw.remoteConfig || defaultRemoteConfig,
    updatedAt: raw.updatedAt || nowIso()
  });
}

export function loadSnapshot(): StudySnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const empty = createEmptySnapshot();
      persistSnapshot(empty);
      return empty;
    }
    const snapshot = normalizeSnapshot(JSON.parse(raw));
    persistSnapshot(snapshot);
    return snapshot;
  } catch {
    return createEmptySnapshot();
  }
}

export function persistSnapshot(snapshot: StudySnapshot) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...snapshot, updatedAt: nowIso() }));
}

export function upsertSubject(snapshot: StudySnapshot, input: Pick<Subject, "id" | "name" | "description">): StudySnapshot {
  const timestamp = nowIso();
  const existing = snapshot.subjects.find((subject) => subject.id === input.id);
  const nextSubject: Subject = existing
    ? { ...existing, name: input.name.trim(), description: input.description?.trim(), updatedAt: timestamp }
    : {
        id: input.id || createId("subject"),
        name: input.name.trim(),
        description: input.description?.trim(),
        createdAt: timestamp,
        updatedAt: timestamp
      };

  return {
    ...snapshot,
    subjects: existing
      ? snapshot.subjects.map((subject) => (subject.id === nextSubject.id ? nextSubject : subject))
      : [...snapshot.subjects, nextSubject],
    updatedAt: timestamp
  };
}

export function deleteSubject(snapshot: StudySnapshot, subjectId: string): StudySnapshot {
  const chapterIds = new Set(snapshot.chapters.filter((chapter) => chapter.subjectId === subjectId).map((chapter) => chapter.id));
  return {
    ...snapshot,
    subjects: snapshot.subjects.filter((subject) => subject.id !== subjectId),
    chapters: snapshot.chapters.filter((chapter) => chapter.subjectId !== subjectId),
    questions: snapshot.questions.filter((question) => question.subjectId !== subjectId && !chapterIds.has(question.chapterId || "")),
    updatedAt: nowIso()
  };
}

export function upsertChapter(
  snapshot: StudySnapshot,
  input: Pick<Chapter, "id" | "subjectId" | "name" | "sortOrder">
): StudySnapshot {
  const timestamp = nowIso();
  const existing = snapshot.chapters.find((chapter) => chapter.id === input.id);
  const nextChapter: Chapter = existing
    ? {
        ...existing,
        subjectId: input.subjectId,
        name: input.name.trim(),
        sortOrder: input.sortOrder,
        updatedAt: timestamp
      }
    : {
        id: input.id || createId("chapter"),
        subjectId: input.subjectId,
        name: input.name.trim(),
        sortOrder: input.sortOrder,
        createdAt: timestamp,
        updatedAt: timestamp
      };

  return {
    ...snapshot,
    chapters: existing
      ? snapshot.chapters.map((chapter) => (chapter.id === nextChapter.id ? nextChapter : chapter))
      : [...snapshot.chapters, nextChapter],
    updatedAt: timestamp
  };
}

export function deleteChapter(snapshot: StudySnapshot, chapterId: string): StudySnapshot {
  return {
    ...snapshot,
    chapters: snapshot.chapters.filter((chapter) => chapter.id !== chapterId),
    questions: snapshot.questions.map((question) =>
      question.chapterId === chapterId ? { ...question, chapterId: undefined, updatedAt: nowIso() } : question
    ),
    updatedAt: nowIso()
  };
}

export function upsertQuestion(snapshot: StudySnapshot, input: QuestionInput): StudySnapshot {
  const timestamp = nowIso();
  const existing = snapshot.questions.find((question) => question.id === input.id);
  const nextQuestion: Question = {
    id: input.id || createId("question"),
    type: input.type,
    subjectId: input.subjectId,
    chapterId: input.chapterId || undefined,
    stem: input.stem.trim(),
    options: requiresOptions(input.type) ? input.options : [],
    answer: input.answer.map((answer) => answer.trim()).filter(Boolean),
    analysis: input.analysis.trim(),
    aiAnalysis: input.aiAnalysis,
    difficulty: input.difficulty,
    tags: input.tags,
    source: input.source,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };

  return {
    ...snapshot,
    questions: existing
      ? snapshot.questions.map((question) => (question.id === nextQuestion.id ? nextQuestion : question))
      : [nextQuestion, ...snapshot.questions],
    updatedAt: timestamp
  };
}

export function deleteQuestion(snapshot: StudySnapshot, questionId: string): StudySnapshot {
  return {
    ...snapshot,
    questions: snapshot.questions.filter((question) => question.id !== questionId),
    updatedAt: nowIso()
  };
}

export function updateRemoteConfig(snapshot: StudySnapshot, remoteConfig: RemoteBankConfig): StudySnapshot {
  return {
    ...snapshot,
    remoteConfig,
    updatedAt: nowIso()
  };
}

export function resetSnapshot() {
  const empty = createEmptySnapshot();
  persistSnapshot(empty);
  return empty;
}
