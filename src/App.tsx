import {
  BookOpen,
  BookMarked,
  Bookmark,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Cloud,
  Database,
  FileText,
  Layers,
  ListChecks,
  NotebookTabs,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shuffle,
  Trash2,
  WandSparkles,
  Wifi,
  WifiOff
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  deleteChapter,
  deleteQuestion,
  deleteSubject,
  loadSnapshot,
  persistSnapshot,
  updateRemoteConfig,
  upsertChapter,
  upsertQuestion,
  upsertSubject
} from "./lib/data/storage";
import { createId, nowIso } from "./lib/id";
import { buildAiAnalysis } from "./lib/aiAssistant";
import { parseQuestionText } from "./lib/parser/questionParser";
import {
  displayAnswerByType,
  isChoiceType,
  isWrittenType,
  normalizeTrueFalseAnswer,
  questionTypeMeta,
  questionTypeOrder,
  requiresOptions
} from "./lib/questionTypes";
import type {
  Chapter,
  Difficulty,
  ParsedQuestionDraft,
  Question,
  QuestionInput,
  QuestionOption,
  QuestionType,
  RemoteBankConfig,
  StudySnapshot,
  Subject
} from "./types";

type ViewKey = "dashboard" | "random" | "chapter" | "questions" | "subjects" | "remote";
type FilterValue = "all";
type ChapterPracticeScope = string | FilterValue;

const UNASSIGNED_CHAPTER_ID = "__unassigned__";

interface QuestionFormState extends QuestionInput {
  tagText: string;
}

const questionTypeLabel: Record<QuestionType, string> = {
  single: "单选题",
  multiple: "多选题",
  true_false: "判断题",
  fill_blank: "填空题",
  short: "简答题",
  essay: "论述/分析题"
};

const difficultyLabel: Record<Difficulty, string> = {
  easy: "基础",
  normal: "标准",
  hard: "进阶"
};

const navItems = [
  { key: "dashboard", label: "今日概览", icon: BookOpen },
  { key: "random", label: "随机练习", icon: Shuffle },
  { key: "chapter", label: "章节练习", icon: ListChecks },
  { key: "questions", label: "题库管理", icon: Database },
  { key: "subjects", label: "科目章节", icon: Layers },
  { key: "remote", label: "远程题库", icon: Cloud }
] as const;

function createDefaultOptions(): QuestionOption[] {
  return ["A", "B", "C", "D"].map((label) => ({
    id: label,
    label,
    content: ""
  }));
}

function createQuestionForm(subjectId: string, chapterId?: string): QuestionFormState {
  return {
    type: "single",
    subjectId,
    chapterId,
    stem: "",
    options: createDefaultOptions(),
    answer: [],
    analysis: "",
    difficulty: "normal",
    tags: [],
    tagText: "",
    source: "local"
  };
}

function normalizeQuestionTypeChange(form: QuestionFormState, nextType: QuestionType): QuestionFormState {
  if (!requiresOptions(nextType)) {
    return {
      ...form,
      type: nextType,
      options: [],
      answer: form.type === nextType ? form.answer : []
    };
  }

  return {
    ...form,
    type: nextType,
    options: form.options.length > 0 ? form.options : createDefaultOptions(),
    answer: nextType === "single" && form.answer.length > 1 ? [form.answer[0]] : form.answer
  };
}

function formFromQuestion(question: Question): QuestionFormState {
  return {
    ...question,
    tagText: question.tags.join("，")
  };
}

function uniqueOptions(options: QuestionOption[]) {
  return options.map((option, index) => ({
    ...option,
    id: option.label || String.fromCharCode(65 + index),
    label: option.label || String.fromCharCode(65 + index)
  }));
}

function answerText(question: Pick<Question, "type" | "answer">) {
  return displayAnswerByType(question.type, question.answer);
}

function formatDate(value?: string) {
  if (!value) {
    return "尚未连接";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function pickRandom<T extends { id: string }>(items: T[], currentId?: string | null) {
  if (items.length === 0) {
    return null;
  }
  const pool = items.length > 1 ? items.filter((item) => item.id !== currentId) : items;
  return pool[Math.floor(Math.random() * pool.length)] || items[0];
}

function sortPracticeQuestions(questions: Question[]) {
  return [...questions].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function getChapterPracticeQuestions(questions: Question[], subjectId: string, scope: ChapterPracticeScope) {
  if (!subjectId || scope === "all") {
    return [];
  }

  return sortPracticeQuestions(
    questions.filter((question) => {
      if (question.subjectId !== subjectId) {
        return false;
      }
      if (scope === UNASSIGNED_CHAPTER_ID) {
        return !question.chapterId;
      }
      return question.chapterId === scope;
    })
  );
}

function summarizeQuestionTypes(questions: Question[]) {
  const counts = questions.reduce(
    (acc, question) => {
      acc[question.type] += 1;
      return acc;
    },
    { single: 0, multiple: 0, true_false: 0, fill_blank: 0, short: 0, essay: 0 }
  );

  const labels = questionTypeOrder
    .filter((type) => counts[type] > 0)
    .map((type) => `${questionTypeMeta[type].shortLabel} ${counts[type]}`);

  return labels.length > 0 ? labels.join(" · ") : "暂无题目";
}

function usePersistentSnapshot() {
  const [snapshot, setSnapshot] = useState<StudySnapshot>(() => loadSnapshot());

  const commit = (updater: (snapshot: StudySnapshot) => StudySnapshot) => {
    setSnapshot((current) => {
      const next = updater(current);
      persistSnapshot(next);
      return next;
    });
  };

  return [snapshot, commit] as const;
}

export function App() {
  const [snapshot, commitSnapshot] = usePersistentSnapshot();
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [subjectScope, setSubjectScope] = useState<string | FilterValue>("all");
  const [chapterSubjectId, setChapterSubjectId] = useState(snapshot.subjects[0]?.id || "");
  const [chapterScope, setChapterScope] = useState<ChapterPracticeScope>("all");
  const [chapterSessionIds, setChapterSessionIds] = useState<string[]>([]);
  const [chapterSessionIndex, setChapterSessionIndex] = useState(0);
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(snapshot.questions[0]?.id || null);
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([]);
  const [shortAnswer, setShortAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [questionFilterSubject, setQuestionFilterSubject] = useState<string | FilterValue>("all");
  const [questionFilterType, setQuestionFilterType] = useState<QuestionType | FilterValue>("all");
  const [questionQuery, setQuestionQuery] = useState("");
  const [rawQuestionText, setRawQuestionText] = useState("");
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<ParsedQuestionDraft[]>([]);
  const [selectedDraftIndex, setSelectedDraftIndex] = useState(0);
  const [questionForm, setQuestionForm] = useState<QuestionFormState>(() =>
    createQuestionForm(snapshot.subjects[0]?.id || "")
  );
  const [subjectEditor, setSubjectEditor] = useState({ id: "", name: "", description: "" });
  const [chapterEditor, setChapterEditor] = useState({ id: "", subjectId: snapshot.subjects[0]?.id || "", name: "" });
  const [remoteForm, setRemoteForm] = useState<RemoteBankConfig>(snapshot.remoteConfig);
  const [remoteTesting, setRemoteTesting] = useState(false);

  const subjectsById = useMemo(() => {
    return new Map(snapshot.subjects.map((subject) => [subject.id, subject]));
  }, [snapshot.subjects]);

  const questionsById = useMemo(() => {
    return new Map(snapshot.questions.map((question) => [question.id, question]));
  }, [snapshot.questions]);

  const chaptersById = useMemo(() => {
    return new Map(snapshot.chapters.map((chapter) => [chapter.id, chapter]));
  }, [snapshot.chapters]);

  const chaptersForFormSubject = useMemo(() => {
    return snapshot.chapters
      .filter((chapter) => chapter.subjectId === questionForm.subjectId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [questionForm.subjectId, snapshot.chapters]);

  const dashboardStats = useMemo(() => {
    const byType = snapshot.questions.reduce(
      (acc, question) => {
        acc[question.type] += 1;
        return acc;
      },
      { single: 0, multiple: 0, true_false: 0, fill_blank: 0, short: 0, essay: 0 }
    );

    return {
      subjects: snapshot.subjects.length,
      chapters: snapshot.chapters.length,
      questions: snapshot.questions.length,
      ...byType
    };
  }, [snapshot]);

  const dashboardTypeCoverage = questionTypeOrder.map((type) => ({
    type,
    label: questionTypeMeta[type].shortLabel,
    count: dashboardStats[type]
  }));
  const hasQuestions = dashboardStats.questions > 0;
  const hasSubjects = dashboardStats.subjects > 0;
  const hasChapters = dashboardStats.chapters > 0;
  const dashboardReadiness = [
    {
      label: "建立科目",
      description: hasSubjects ? `${dashboardStats.subjects} 个科目可用` : "先创建语文、数学、英语等科目",
      done: hasSubjects,
      action: () => setActiveView("subjects")
    },
    {
      label: "整理章节",
      description: hasChapters ? `${dashboardStats.chapters} 个章节可用于章节训练` : "章节可选，但会显著提升训练体验",
      done: hasChapters,
      action: () => setActiveView("subjects")
    },
    {
      label: "导入题目",
      description: hasQuestions ? `${dashboardStats.questions} 道题已入库` : "手动新建或粘贴文本自动解析",
      done: hasQuestions,
      action: () => setActiveView("questions")
    }
  ];
  const recentQuestions = snapshot.questions.slice(0, 4);

  const randomCandidates = useMemo(() => {
    return snapshot.questions.filter((question) => subjectScope === "all" || question.subjectId === subjectScope);
  }, [snapshot.questions, subjectScope]);

  const chapterPracticeChoices = useMemo(() => {
    const subjectChapters = snapshot.chapters
      .filter((chapter) => chapter.subjectId === chapterSubjectId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const choices = subjectChapters.map((chapter) => {
      const questions = getChapterPracticeQuestions(snapshot.questions, chapterSubjectId, chapter.id);
      return {
        id: chapter.id,
        name: chapter.name,
        questionCount: questions.length,
        typeSummary: summarizeQuestionTypes(questions)
      };
    });

    const unassignedQuestions = getChapterPracticeQuestions(snapshot.questions, chapterSubjectId, UNASSIGNED_CHAPTER_ID);
    if (unassignedQuestions.length > 0) {
      choices.push({
        id: UNASSIGNED_CHAPTER_ID,
        name: "未分章节",
        questionCount: unassignedQuestions.length,
        typeSummary: summarizeQuestionTypes(unassignedQuestions)
      });
    }

    return choices;
  }, [chapterSubjectId, snapshot.chapters, snapshot.questions]);

  const chapterCandidates = useMemo(() => {
    return getChapterPracticeQuestions(snapshot.questions, chapterSubjectId, chapterScope);
  }, [chapterScope, chapterSubjectId, snapshot.questions]);

  const practiceCandidates = activeView === "chapter" ? chapterCandidates : randomCandidates;
  const chapterSessionQuestions = useMemo(() => {
    return chapterSessionIds.map((id) => questionsById.get(id)).filter((question): question is Question => Boolean(question));
  }, [chapterSessionIds, questionsById]);
  const selectedChapterChoice = chapterPracticeChoices.find((choice) => choice.id === chapterScope);
  const selectedChapterName = selectedChapterChoice?.name || "未选择章节";
  const chapterProgressTotal = chapterSessionQuestions.length || chapterCandidates.length;
  const chapterProgressCurrent = chapterProgressTotal > 0 ? Math.min(chapterSessionIndex + 1, chapterProgressTotal) : 0;
  const chapterProgressPercent = chapterProgressTotal > 0 ? Math.round((chapterProgressCurrent / chapterProgressTotal) * 100) : 0;
  const currentQuestion =
    activeView === "chapter"
      ? chapterSessionQuestions[chapterSessionIndex] || chapterCandidates[0]
      : randomCandidates.find((question) => question.id === currentQuestionId) || randomCandidates[0];
  const currentSubject = currentQuestion ? subjectsById.get(currentQuestion.subjectId) : undefined;
  const currentChapter = currentQuestion?.chapterId ? chaptersById.get(currentQuestion.chapterId) : undefined;

  const filteredQuestions = useMemo(() => {
    const keyword = questionQuery.trim().toLowerCase();
    return snapshot.questions.filter((question) => {
      const subjectMatch = questionFilterSubject === "all" || question.subjectId === questionFilterSubject;
      const typeMatch = questionFilterType === "all" || question.type === questionFilterType;
      const keywordMatch =
        !keyword ||
        question.stem.toLowerCase().includes(keyword) ||
        question.analysis.toLowerCase().includes(keyword) ||
        answerText(question).toLowerCase().includes(keyword);
      return subjectMatch && typeMatch && keywordMatch;
    });
  }, [questionFilterSubject, questionFilterType, questionQuery, snapshot.questions]);

  useEffect(() => {
    if (!questionForm.subjectId && snapshot.subjects[0]) {
      setQuestionForm((form) => ({ ...form, subjectId: snapshot.subjects[0].id }));
    }
  }, [questionForm.subjectId, snapshot.subjects]);

  useEffect(() => {
    if (activeView !== "chapter") {
      return;
    }

    if (!chapterSubjectId && snapshot.subjects[0]) {
      setChapterSubjectId(snapshot.subjects[0].id);
      return;
    }

    if (chapterPracticeChoices.length === 0) {
      setChapterScope("all");
      setChapterSessionIds([]);
      setChapterSessionIndex(0);
      resetPractice(null);
      return;
    }

    const validScope = chapterPracticeChoices.some((choice) => choice.id === chapterScope);
    if (chapterScope === "all" || !validScope) {
      loadChapterSession(chapterSubjectId, chapterPracticeChoices[0].id);
      return;
    }

    if (chapterSessionIds.length === 0 && chapterCandidates.length > 0) {
      loadChapterSession(chapterSubjectId, chapterScope);
    }
  }, [
    activeView,
    chapterCandidates.length,
    chapterPracticeChoices,
    chapterScope,
    chapterSessionIds.length,
    chapterSubjectId,
    snapshot.subjects
  ]);

  function resetPractice(nextQuestion?: Question | null) {
    setCurrentQuestionId(nextQuestion?.id || null);
    setSelectedAnswers([]);
    setShortAnswer("");
    setSubmitted(false);
  }

  function getFirstChapterScopeForSubject(subjectId: string): ChapterPracticeScope {
    const subjectChapters = snapshot.chapters
      .filter((chapter) => chapter.subjectId === subjectId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const chapterWithQuestions = subjectChapters.find(
      (chapter) => getChapterPracticeQuestions(snapshot.questions, subjectId, chapter.id).length > 0
    );
    if (chapterWithQuestions) {
      return chapterWithQuestions.id;
    }
    if (getChapterPracticeQuestions(snapshot.questions, subjectId, UNASSIGNED_CHAPTER_ID).length > 0) {
      return UNASSIGNED_CHAPTER_ID;
    }
    return subjectChapters[0]?.id || "all";
  }

  function loadChapterSession(subjectId: string, scope: ChapterPracticeScope) {
    const nextQuestions = getChapterPracticeQuestions(snapshot.questions, subjectId, scope);
    setChapterScope(scope);
    setChapterSessionIds(nextQuestions.map((question) => question.id));
    setChapterSessionIndex(0);
    resetPractice(nextQuestions[0] || null);
  }

  function selectChapterSubject(subjectId: string) {
    setChapterSubjectId(subjectId);
    loadChapterSession(subjectId, getFirstChapterScopeForSubject(subjectId));
  }

  function advanceChapterPractice() {
    const ids = (chapterSessionIds.length > 0 ? chapterSessionIds : chapterCandidates.map((question) => question.id)).filter((id) =>
      questionsById.has(id)
    );
    if (ids.length === 0) {
      resetPractice(null);
      return;
    }

    const nextIndex = chapterSessionIndex + 1 < ids.length ? chapterSessionIndex + 1 : 0;
    setChapterSessionIds(ids);
    setChapterSessionIndex(nextIndex);
    resetPractice(questionsById.get(ids[nextIndex]) || null);
  }

  function previousChapterPractice() {
    const ids = (chapterSessionIds.length > 0 ? chapterSessionIds : chapterCandidates.map((question) => question.id)).filter((id) =>
      questionsById.has(id)
    );
    if (ids.length === 0) {
      resetPractice(null);
      return;
    }

    const nextIndex = Math.max(0, chapterSessionIndex - 1);
    setChapterSessionIds(ids);
    setChapterSessionIndex(nextIndex);
    resetPractice(questionsById.get(ids[nextIndex]) || null);
  }

  function jumpChapterPractice(index: number) {
    const ids = (chapterSessionIds.length > 0 ? chapterSessionIds : chapterCandidates.map((question) => question.id)).filter((id) =>
      questionsById.has(id)
    );
    if (!ids[index]) {
      return;
    }

    setChapterSessionIds(ids);
    setChapterSessionIndex(index);
    resetPractice(questionsById.get(ids[index]) || null);
  }

  function startPractice() {
    if (activeView === "chapter") {
      advanceChapterPractice();
      return;
    }
    resetPractice(pickRandom(randomCandidates, currentQuestionId));
  }

  function submitPractice() {
    if (!currentQuestion) {
      return;
    }
    setSubmitted(true);
  }

  function togglePracticeAnswer(optionId: string) {
    if (!currentQuestion || submitted) {
      return;
    }

    if (currentQuestion.type === "single" || currentQuestion.type === "true_false") {
      setSelectedAnswers([optionId]);
      return;
    }

    setSelectedAnswers((answers) =>
      answers.includes(optionId) ? answers.filter((answer) => answer !== optionId) : [...answers, optionId]
    );
  }

  function updateQuestionForm<K extends keyof QuestionFormState>(key: K, value: QuestionFormState[K]) {
    setQuestionForm((form) => ({ ...form, [key]: value }));
  }

  function updateOptionContent(optionId: string, content: string) {
    setQuestionForm((form) => ({
      ...form,
      options: form.options.map((option) => (option.id === optionId ? { ...option, content } : option))
    }));
  }

  function addOption() {
    setQuestionForm((form) => {
      const label = String.fromCharCode(65 + form.options.length);
      return {
        ...form,
        options: [...form.options, { id: label, label, content: "" }]
      };
    });
  }

  function removeOption(optionId: string) {
    setQuestionForm((form) => ({
      ...form,
      options: form.options.filter((option) => option.id !== optionId),
      answer: form.answer.filter((answer) => answer !== optionId)
    }));
  }

  function changeQuestionType(nextType: QuestionType) {
    setQuestionForm((form) => normalizeQuestionTypeChange(form, nextType));
  }

  function saveQuestion(event: FormEvent) {
    event.preventDefault();
    if (!questionForm.subjectId || !questionForm.stem.trim() || questionForm.answer.length === 0) {
      window.alert("请至少填写科目、题干和正确答案。");
      return;
    }

    const options =
      requiresOptions(questionForm.type)
        ? uniqueOptions(questionForm.options)
            .map((option) => ({ ...option, content: option.content.trim() }))
            .filter((option) => option.content)
        : [];

    if (requiresOptions(questionForm.type) && options.length < 2) {
      window.alert("选择题至少需要两个有效选项。");
      return;
    }

    const input: QuestionInput = {
      ...questionForm,
      options,
      chapterId: questionForm.chapterId || undefined,
      answer:
        questionForm.type === "true_false"
          ? questionForm.answer.map(normalizeTrueFalseAnswer)
          : questionForm.answer.map((answer) => answer.trim()).filter(Boolean),
      tags: questionForm.tagText
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    };

    commitSnapshot((snapshotValue) =>
      upsertQuestion(snapshotValue, {
        ...input,
        aiAnalysis: questionForm.aiAnalysis || buildAiAnalysis(input)
      })
    );
    setQuestionForm(createQuestionForm(questionForm.subjectId, questionForm.chapterId));
    setDrafts([]);
    setParseWarnings([]);
  }

  function editQuestion(question: Question) {
    setQuestionForm(formFromQuestion(question));
    setActiveView("questions");
  }

  function removeQuestion(questionId: string) {
    if (!window.confirm("确认删除这道题目？")) {
      return;
    }
    commitSnapshot((snapshotValue) => deleteQuestion(snapshotValue, questionId));
  }

  function parseRawQuestion() {
    const result = parseQuestionText(rawQuestionText);
    setDrafts(result.drafts);
    setParseWarnings(result.warnings);
    setSelectedDraftIndex(0);
    if (result.drafts[0]) {
      applyDraft(result.drafts[0]);
    }
  }

  function applyDraft(draft: ParsedQuestionDraft) {
    const nextSubjectId = questionForm.subjectId || snapshot.subjects[0]?.id || "";
    setQuestionForm((form) => ({
      ...form,
      id: undefined,
      type: draft.type,
      subjectId: nextSubjectId,
      chapterId: form.chapterId,
      stem: draft.stem,
      options: draft.options.length > 0 ? draft.options : createDefaultOptions(),
      answer: draft.answer,
      analysis: draft.analysis,
      aiAnalysis: draft.aiAnalysis,
      source: "parsed",
      tagText: "自动解析"
    }));
  }

  function runAiAssistForQuestion() {
    const input: QuestionInput = {
      ...questionForm,
      options: requiresOptions(questionForm.type) ? questionForm.options : [],
      answer: questionForm.type === "true_false" ? questionForm.answer.map(normalizeTrueFalseAnswer) : questionForm.answer,
      tags: questionForm.tagText
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    };
    const aiAnalysis = buildAiAnalysis(input);
    setQuestionForm((form) => ({
      ...form,
      aiAnalysis,
      analysis: form.analysis.trim() ? form.analysis : aiAnalysis.explanation,
      tagText: form.tagText.trim() ? form.tagText : aiAnalysis.knowledgePoints.join("，")
    }));
  }

  function saveSubject(event: FormEvent) {
    event.preventDefault();
    if (!subjectEditor.name.trim()) {
      window.alert("请输入科目名称。");
      return;
    }
    commitSnapshot((snapshotValue) =>
      upsertSubject(snapshotValue, {
        id: subjectEditor.id,
        name: subjectEditor.name,
        description: subjectEditor.description
      })
    );
    setSubjectEditor({ id: "", name: "", description: "" });
  }

  function selectSubjectForEdit(subject: Subject) {
    setSubjectEditor({
      id: subject.id,
      name: subject.name,
      description: subject.description || ""
    });
    setChapterEditor((editor) => ({ ...editor, subjectId: subject.id }));
  }

  function removeSubject(subjectId: string) {
    if (!window.confirm("删除科目会同步删除该科目下的章节和题目，确认继续？")) {
      return;
    }
    commitSnapshot((snapshotValue) => deleteSubject(snapshotValue, subjectId));
  }

  function saveChapter(event: FormEvent) {
    event.preventDefault();
    if (!chapterEditor.subjectId || !chapterEditor.name.trim()) {
      window.alert("请选择科目并填写章节名称。");
      return;
    }

    const maxSort = Math.max(
      0,
      ...snapshot.chapters.filter((chapter) => chapter.subjectId === chapterEditor.subjectId).map((chapter) => chapter.sortOrder)
    );

    commitSnapshot((snapshotValue) =>
      upsertChapter(snapshotValue, {
        id: chapterEditor.id,
        subjectId: chapterEditor.subjectId,
        name: chapterEditor.name,
        sortOrder: chapterEditor.id
          ? snapshot.chapters.find((chapter) => chapter.id === chapterEditor.id)?.sortOrder || maxSort
          : maxSort + 1
      })
    );
    setChapterEditor({ id: "", subjectId: chapterEditor.subjectId, name: "" });
  }

  function editChapter(chapter: Chapter) {
    setChapterEditor({
      id: chapter.id,
      subjectId: chapter.subjectId,
      name: chapter.name
    });
  }

  function removeChapter(chapterId: string) {
    if (!window.confirm("删除章节后，相关题目会保留并转为未分章节。确认继续？")) {
      return;
    }
    commitSnapshot((snapshotValue) => deleteChapter(snapshotValue, chapterId));
  }

  async function testRemoteConnection() {
    if (!remoteForm.endpoint.trim()) {
      setRemoteForm((form) => ({
        ...form,
        status: "failed",
        message: "请先填写远程题库 API 地址"
      }));
      return;
    }

    setRemoteTesting(true);
    const checkedAt = nowIso();
    try {
      const url = new URL(remoteForm.endpoint);
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 4500);
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: remoteForm.token ? { Authorization: `Bearer ${remoteForm.token}` } : undefined,
        signal: controller.signal
      });
      window.clearTimeout(timeoutId);
      setRemoteForm((form) => ({
        ...form,
        enabled: true,
        status: response.ok ? "connected" : "failed",
        lastCheckedAt: checkedAt,
        message: response.ok ? "连接成功，远程题库接口可用" : `接口返回 ${response.status}`
      }));
    } catch {
      setRemoteForm((form) => ({
        ...form,
        enabled: false,
        status: "failed",
        lastCheckedAt: checkedAt,
        message: "连接失败，已保留配置，可稍后重试"
      }));
    } finally {
      setRemoteTesting(false);
    }
  }

  function saveRemoteConfig() {
    commitSnapshot((snapshotValue) => updateRemoteConfig(snapshotValue, remoteForm));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="window-controls" aria-hidden="true">
          <span className="dot dot-red" />
          <span className="dot dot-yellow" />
          <span className="dot dot-green" />
        </div>
        <div className="brand">
          <div className="brand-mark">
            <NotebookTabs size={22} />
          </div>
          <div>
            <strong>刷题助手</strong>
            <span>本地题库 · 远程预留</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${activeView === item.key ? "is-active" : ""}`}
                key={item.key}
                onClick={() => setActiveView(item.key)}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button className="storage-status-card" type="button" onClick={() => setActiveView("remote")}>
            <div className={`storage-status-icon ${remoteForm.status}`}>
              {remoteForm.status === "connected" ? <Wifi size={17} /> : <WifiOff size={17} />}
            </div>
            <div>
              <strong>{remoteForm.status === "connected" ? "远程题库已连接" : "本机题库模式"}</strong>
              <span>
                {remoteForm.status === "connected"
                  ? "可使用远程题库配置"
                  : remoteForm.status === "failed"
                    ? "远程连接失败，点击检查"
                    : "无需登录 · 数据保存在本机"}
              </span>
            </div>
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{navItems.find((item) => item.key === activeView)?.label || "刷题助手"}</h1>
            <p>
              {activeView === "dashboard"
                ? "题库状态、建库进度和训练入口集中在这里。"
                : activeView === "random"
                  ? "跨章节随机抽题，适合热身和混合复习。"
                  : activeView === "chapter"
                    ? "按章节推进题单，集中补齐一个知识块。"
                    : "题库维护、自动解析和远程配置集中在一个本地工具里。"}
            </p>
          </div>
          <div className="topbar-actions">
            <div className="status-pill">
              <Database size={16} />
              <span>{dashboardStats.questions} 题</span>
            </div>
            <div className={`status-pill ${remoteForm.status === "connected" ? "success" : ""}`}>
              {remoteForm.status === "connected" ? <Wifi size={16} /> : <WifiOff size={16} />}
              <span>{remoteForm.status === "connected" ? "远程已连接" : "本机存储"}</span>
            </div>
          </div>
        </header>

        {activeView === "dashboard" && (
          <section className="dashboard-workspace">
            <div className="dashboard-main">
              <section className="panel dashboard-command-panel">
                <div className="dashboard-command-copy">
                  <span className="eyebrow">{hasQuestions ? "题库工作台" : "初始化题库"}</span>
                  <h2>{hasQuestions ? "选择一种训练方式，开始刷题。" : "先把你的真实题库建起来。"}</h2>
                  <p>
                    {hasQuestions
                      ? `当前共有 ${dashboardStats.questions} 道题，覆盖 ${dashboardStats.subjects} 个科目和 ${dashboardStats.chapters} 个章节。`
                      : "系统不预置任何题目。先建科目，再通过手动新建或自动解析导入题目。"}
                  </p>
                </div>

                <div className="dashboard-kpis">
                  <div>
                    <span>题目</span>
                    <strong>{dashboardStats.questions}</strong>
                  </div>
                  <div>
                    <span>科目</span>
                    <strong>{dashboardStats.subjects}</strong>
                  </div>
                  <div>
                    <span>章节</span>
                    <strong>{dashboardStats.chapters}</strong>
                  </div>
                </div>

                <div className="dashboard-actions">
                  <button className="primary-button" type="button" onClick={() => setActiveView(hasQuestions ? "random" : "subjects")}>
                    {hasQuestions ? <Shuffle size={18} /> : <Plus size={18} />}
                    {hasQuestions ? "开始随机练习" : "创建科目"}
                  </button>
                  <button className="secondary-button" type="button" onClick={() => setActiveView("questions")}>
                    <WandSparkles size={18} />
                    导入题目
                  </button>
                  <button className="secondary-button" type="button" onClick={() => setActiveView("chapter")} disabled={!hasQuestions}>
                    <ListChecks size={18} />
                    章节训练
                  </button>
                </div>
              </section>

              <section className="panel dashboard-readiness">
                <div className="section-header">
                  <div>
                    <span className="eyebrow">建库进度</span>
                    <h2>下一步该做什么</h2>
                  </div>
                </div>
                <div className="readiness-list">
                  {dashboardReadiness.map((item, index) => (
                    <button className={`readiness-item ${item.done ? "is-done" : ""}`} key={item.label} type="button" onClick={item.action}>
                      <strong>{index + 1}</strong>
                      <span>
                        <b>{item.label}</b>
                        <small>{item.description}</small>
                      </span>
                      {item.done ? <CheckCircle2 size={18} /> : <ChevronRight size={18} />}
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <aside className="dashboard-side">
              <section className="panel type-coverage-panel">
                <div className="section-header">
                  <div>
                    <span className="eyebrow">题型覆盖</span>
                    <h2>题库结构</h2>
                  </div>
                </div>
                <div className="type-coverage-list">
                  {dashboardTypeCoverage.map((item) => (
                    <div className="type-coverage-item" key={item.type}>
                      <span>{item.label}</span>
                      <strong>{item.count}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel dashboard-next-panel">
                <div className="section-header">
                  <div>
                    <span className="eyebrow">{hasQuestions ? "最近题目" : "空题库"}</span>
                    <h2>{hasQuestions ? "最近入库" : "还没有内容"}</h2>
                  </div>
                </div>
                {hasQuestions ? (
                  <div className="recent-question-list">
                    {recentQuestions.map((question) => (
                      <button type="button" key={question.id} onClick={() => editQuestion(question)}>
                        <strong>{question.stem}</strong>
                        <span>{questionTypeMeta[question.type].shortLabel}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="dashboard-empty-guide">
                    <p>从左侧“科目章节”建立结构，或直接到“题库管理”粘贴题目文本自动解析。</p>
                    <button className="secondary-button" type="button" onClick={() => setActiveView("subjects")}>
                      <Layers size={17} />
                      管理科目章节
                    </button>
                  </div>
                )}
              </section>
            </aside>
          </section>
        )}

        {activeView === "random" && (
          <section className="practice-layout">
            <div className="practice-main panel">
              <div className="practice-toolbar">
                <button className="square-button" type="button" aria-label="上一题" disabled>
                  <ChevronLeft size={18} />
                </button>
                <span className="question-counter">{randomCandidates.length} 题</span>
                <button className="square-button" type="button" onClick={startPractice} aria-label="下一题">
                  <ChevronRight size={18} />
                </button>
                <span className="divider" />
                <button className="ghost-action" type="button">
                  <Bookmark size={17} />
                  收藏
                </button>
                <button className="ghost-action" type="button">
                  <FileText size={17} />
                  笔记
                </button>
              </div>

              <div className="practice-filter">
                <label>
                  <BookMarked size={16} />
                  <select value={subjectScope} onChange={(event) => setSubjectScope(event.target.value)}>
                    <option value="all">全部科目</option>
                    {snapshot.subjects.map((subject) => (
                      <option value={subject.id} key={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="type-chip">{currentQuestion ? questionTypeLabel[currentQuestion.type] : "暂无题目"}</span>
              </div>

              {currentQuestion ? (
                <QuestionPractice
                  question={currentQuestion}
                  subjectName={currentSubject?.name || "未分科目"}
                  chapterName={currentChapter?.name || "未分章节"}
                  selectedAnswers={selectedAnswers}
                  shortAnswer={shortAnswer}
                  submitted={submitted}
                  onSelect={togglePracticeAnswer}
                  onShortAnswer={setShortAnswer}
                />
              ) : (
                <EmptyState
                  icon={<ClipboardList size={28} />}
                  title="当前范围没有题目"
                  description="先到题库管理新增题目，或使用自动解析把原始题目文本转成题库。"
                />
              )}

              <div className="practice-actions">
                <button className="ghost-action" type="button">
                  <Bookmark size={17} />
                  标记本题
                </button>
                <button className="ghost-action" type="button">
                  <CircleHelp size={17} />
                  纠错
                </button>
                <div className="spacer" />
                <button className="secondary-button" type="button" onClick={submitPractice} disabled={!currentQuestion || submitted}>
                  提交答案
                </button>
                <button className="primary-button" type="button" onClick={startPractice} disabled={practiceCandidates.length === 0}>
                  下一题
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            <aside className="answer-panel panel">
              {submitted && currentQuestion ? (
                <AnswerReview
                  question={currentQuestion}
                  userAnswer={isWrittenType(currentQuestion.type) ? shortAnswer : displayAnswerByType(currentQuestion.type, selectedAnswers)}
                />
              ) : (
                <div className="answer-empty">
                  <span className="eyebrow">答题结果</span>
                  <h3>提交后展示答案和解析</h3>
                  <p>首版不强制判定对错，方便选择题和非选择题统一复盘。</p>
                </div>
              )}
            </aside>
          </section>
        )}

        {activeView === "chapter" && (
          <section className="chapter-studio">
            <div className="chapter-studio-hero panel">
              <div>
                <span className="eyebrow">章节训练</span>
                <h2>{selectedChapterName}</h2>
                <p>
                  {chapterProgressTotal > 0
                    ? `${subjectsById.get(chapterSubjectId)?.name || "未分科目"} · ${selectedChapterChoice?.typeSummary || "暂无题目"}`
                    : "选择一个有题目的章节，开始集中补齐这个知识块。"}
                </p>
              </div>
              <div className="chapter-hero-metrics">
                <div>
                  <span>本章题量</span>
                  <strong>{chapterProgressTotal}</strong>
                </div>
                <div>
                  <span>训练进度</span>
                  <strong>{chapterProgressPercent}%</strong>
                </div>
                <div>
                  <span>当前位置</span>
                  <strong>
                    {chapterProgressCurrent || 0}/{chapterProgressTotal || 0}
                  </strong>
                </div>
              </div>
            </div>

            <div className="chapter-studio-grid">
              <aside className="chapter-map panel">
                <div className="section-header">
                  <div>
                    <span className="eyebrow">章节地图</span>
                    <h2>选择训练章节</h2>
                  </div>
                </div>
                <label className="chapter-subject-picker">
                  科目
                  <select value={chapterSubjectId} onChange={(event) => selectChapterSubject(event.target.value)}>
                    {snapshot.subjects.map((subject) => (
                      <option value={subject.id} key={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="chapter-path-list" aria-label="章节题单">
                  {chapterPracticeChoices.length > 0 ? (
                    chapterPracticeChoices.map((choice) => (
                      <button
                        className={`chapter-path-item ${chapterScope === choice.id ? "is-selected" : ""}`}
                        key={choice.id}
                        type="button"
                        onClick={() => loadChapterSession(chapterSubjectId, choice.id)}
                      >
                        <div className="chapter-path-head">
                          <span className="chapter-path-title">{choice.name}</span>
                          <strong className="chapter-path-count">{choice.questionCount} 题</strong>
                        </div>
                        <small>{choice.typeSummary}</small>
                      </button>
                    ))
                  ) : (
                    <div className="chapter-card-empty">
                      <strong>暂无可训练章节</strong>
                      <span>先在科目章节中创建章节，或给题目补充所属章节。</span>
                    </div>
                  )}
                </div>
              </aside>

              <section className="chapter-workbench panel">
                <div className="chapter-workbench-top">
                  <div>
                    <span className="eyebrow">当前训练</span>
                    <h2>
                      第 {chapterProgressCurrent || 0} 题 / 共 {chapterProgressTotal || 0} 题
                    </h2>
                  </div>
                  <div className="chapter-progress wide">
                    <span>{chapterProgressPercent}% 完成</span>
                    <div className="progress-track" aria-hidden="true">
                      <span style={{ width: `${chapterProgressPercent}%` }} />
                    </div>
                  </div>
                </div>

                {currentQuestion ? (
                  <QuestionPractice
                    question={currentQuestion}
                    subjectName={currentSubject?.name || "未分科目"}
                    chapterName={currentChapter?.name || "未分章节"}
                    selectedAnswers={selectedAnswers}
                    shortAnswer={shortAnswer}
                    submitted={submitted}
                    onSelect={togglePracticeAnswer}
                    onShortAnswer={setShortAnswer}
                  />
                ) : (
                  <EmptyState
                    icon={<ClipboardList size={28} />}
                    title="当前章节没有题目"
                    description="先给题目设置所属章节，或选择左侧其他章节题单。"
                  />
                )}

                <div className="practice-actions chapter-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={previousChapterPractice}
                    disabled={chapterProgressTotal <= 1 || chapterProgressCurrent <= 1}
                  >
                    <ChevronLeft size={17} />
                    上一题
                  </button>
                  <button className="secondary-button" type="button" onClick={submitPractice} disabled={!currentQuestion || submitted}>
                    提交答案
                  </button>
                  <button className="primary-button" type="button" onClick={startPractice} disabled={practiceCandidates.length === 0}>
                    {chapterProgressTotal > 0 && chapterProgressCurrent === chapterProgressTotal ? "重来本章" : "下一题"}
                    <ChevronRight size={18} />
                  </button>
                </div>
              </section>

              <aside className="chapter-side-panel panel">
                {submitted && currentQuestion ? (
                  <AnswerReview
                    question={currentQuestion}
                    userAnswer={isWrittenType(currentQuestion.type) ? shortAnswer : displayAnswerByType(currentQuestion.type, selectedAnswers)}
                  />
                ) : (
                  <div className="chapter-plan">
                    <span className="eyebrow">本章目标</span>
                    <h3>先做完本章，再看解析复盘。</h3>
                    <p>章节训练会保持题单上下文，适合集中处理一个知识块，而不是混合刷题。</p>
                    <div className="chapter-plan-list">
                      <span>1. 选择章节题单</span>
                      <span>2. 顺序完成本章题目</span>
                      <span>3. 提交后查看解析和 AI 分析</span>
                    </div>
                  </div>
                )}

                <div className="chapter-question-rail">
                  <div className="inline-header">
                    <strong>题单导航</strong>
                    <span>{chapterProgressTotal} 题</span>
                  </div>
                  <div className="chapter-step-list">
                    {(chapterSessionQuestions.length > 0 ? chapterSessionQuestions : chapterCandidates).map((question, index) => (
                      <button
                        className={index === chapterSessionIndex ? "is-current" : ""}
                        key={question.id}
                        type="button"
                        onClick={() => jumpChapterPractice(index)}
                      >
                        <strong>{index + 1}</strong>
                        <span>{questionTypeMeta[question.type].shortLabel}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </aside>
            </div>
          </section>
        )}

        {activeView === "questions" && (
          <section className="question-manager">
            <div className="panel question-list-panel">
              <div className="section-header">
                <div>
                  <span className="eyebrow">题库管理</span>
                  <h2>题目列表</h2>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setQuestionForm(createQuestionForm(snapshot.subjects[0]?.id || ""))}
                >
                  <Plus size={17} />
                  新题
                </button>
              </div>
              <div className="filter-row">
                <label>
                  科目
                  <select value={questionFilterSubject} onChange={(event) => setQuestionFilterSubject(event.target.value)}>
                    <option value="all">全部</option>
                    {snapshot.subjects.map((subject) => (
                      <option value={subject.id} key={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  题型
                  <select
                    value={questionFilterType}
                    onChange={(event) => setQuestionFilterType(event.target.value as QuestionType | FilterValue)}
                  >
                    <option value="all">全部</option>
                    {questionTypeOrder.map((type) => (
                      <option value={type} key={type}>
                        {questionTypeMeta[type].shortLabel}
                      </option>
                    ))}
                  </select>
                </label>
              <label className="search-field">
                <Search size={15} />
                  <input
                    aria-label="搜索题干、答案、解析"
                    autoComplete="off"
                    name="question-search"
                    value={questionQuery}
                    onChange={(event) => setQuestionQuery(event.target.value)}
                    placeholder="搜索题干、答案、解析"
                  />
                </label>
              </div>
              <div className="question-list">
                {filteredQuestions.map((question) => (
                  <button className="question-row" key={question.id} type="button" onClick={() => editQuestion(question)}>
                    <div>
                      <strong>{question.stem}</strong>
                      <span>
                        {subjectsById.get(question.subjectId)?.name || "未分科目"}
                        {question.chapterId ? ` · ${chaptersById.get(question.chapterId)?.name || "未分章节"}` : ""}
                      </span>
                    </div>
                    <span className="type-chip">{questionTypeLabel[question.type]}</span>
                  </button>
                ))}
                {filteredQuestions.length === 0 && (
                  <EmptyState
                    icon={<Search size={28} />}
                    title="没有匹配题目"
                    description="调整筛选条件，或在右侧通过自动解析新增题目。"
                  />
                )}
              </div>
            </div>

            <div className="panel editor-panel">
              <div className="section-header">
                <div>
                  <span className="eyebrow">自动解析</span>
                  <h2>粘贴题目并校对入库</h2>
                </div>
                <button className="primary-button" type="button" onClick={parseRawQuestion} disabled={!rawQuestionText.trim()}>
                  <WandSparkles size={17} />
                  自动解析
                </button>
              </div>
              <textarea
                aria-label="粘贴原始题目文本"
                className="raw-textarea"
                name="raw-question-text"
                value={rawQuestionText}
                onChange={(event) => setRawQuestionText(event.target.value)}
                placeholder={"示例：\n在计算机中，数据的存储、处理和传输都主要使用（ ）。\nA. 十进制\nB. 二进制\nC. 八进制\nD. 十六进制\n答案：B\n解析：计算机内部采用二进制进行数据表示。"}
              />
              {drafts.length > 0 && (
                <div className="draft-strip">
                  {drafts.map((draft, index) => (
                    <button
                      className={selectedDraftIndex === index ? "is-selected" : ""}
                      key={`${draft.stem}-${index}`}
                      type="button"
                      onClick={() => {
                        setSelectedDraftIndex(index);
                        applyDraft(draft);
                      }}
                    >
                      草稿 {index + 1}
                    </button>
                  ))}
                </div>
              )}
              {parseWarnings.length > 0 && (
                <div className="warning-list">
                  {parseWarnings.slice(0, 3).map((warning) => (
                    <span key={warning}>{warning}</span>
                  ))}
                </div>
              )}

              <QuestionEditor
                chapters={chaptersForFormSubject}
                form={questionForm}
                subjects={snapshot.subjects}
                onAddOption={addOption}
                onChange={updateQuestionForm}
                onTypeChange={changeQuestionType}
                onOptionChange={updateOptionContent}
                onRemoveOption={removeOption}
                onDelete={questionForm.id ? () => removeQuestion(questionForm.id!) : undefined}
                onSubmit={saveQuestion}
                onAiAssist={runAiAssistForQuestion}
              />
            </div>
          </section>
        )}

        {activeView === "subjects" && (
          <section className="subjects-layout">
            <div className="panel">
              <div className="section-header">
                <div>
                  <span className="eyebrow">科目设置</span>
                  <h2>科目</h2>
                </div>
              </div>
              <form className="compact-form" onSubmit={saveSubject}>
                <label>
                  科目名称
                  <input
                    autoComplete="off"
                    name="subject-name"
                    value={subjectEditor.name}
                    onChange={(event) => setSubjectEditor({ ...subjectEditor, name: event.target.value })}
                  />
                </label>
                <label>
                  说明
                  <input
                    autoComplete="off"
                    name="subject-description"
                    value={subjectEditor.description}
                    onChange={(event) => setSubjectEditor({ ...subjectEditor, description: event.target.value })}
                  />
                </label>
                <button className="primary-button" type="submit">
                  <Save size={17} />
                  保存科目
                </button>
              </form>
              <div className="subject-list">
                {snapshot.subjects.map((subject) => (
                  <div className="entity-row" key={subject.id}>
                    <button type="button" onClick={() => selectSubjectForEdit(subject)}>
                      <strong>{subject.name}</strong>
                      <span>
                        {snapshot.chapters.filter((chapter) => chapter.subjectId === subject.id).length} 章 ·{" "}
                        {snapshot.questions.filter((question) => question.subjectId === subject.id).length} 题
                      </span>
                    </button>
                    <button className="icon-button danger" type="button" onClick={() => removeSubject(subject.id)} aria-label="删除科目">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="section-header">
                <div>
                  <span className="eyebrow">章节设置</span>
                  <h2>章节</h2>
                </div>
              </div>
              <form className="compact-form" onSubmit={saveChapter}>
                <label>
                  所属科目
                  <select
                    value={chapterEditor.subjectId}
                    onChange={(event) => setChapterEditor({ ...chapterEditor, subjectId: event.target.value })}
                  >
                    {snapshot.subjects.map((subject) => (
                      <option value={subject.id} key={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  章节名称
                  <input
                    autoComplete="off"
                    name="chapter-name"
                    value={chapterEditor.name}
                    onChange={(event) => setChapterEditor({ ...chapterEditor, name: event.target.value })}
                  />
                </label>
                <button className="primary-button" type="submit">
                  <Save size={17} />
                  保存章节
                </button>
              </form>
              <div className="subject-list">
                {snapshot.chapters
                  .filter((chapter) => !chapterEditor.subjectId || chapter.subjectId === chapterEditor.subjectId)
                  .map((chapter) => (
                    <div className="entity-row" key={chapter.id}>
                      <button type="button" onClick={() => editChapter(chapter)}>
                        <strong>{chapter.name}</strong>
                        <span>{subjectsById.get(chapter.subjectId)?.name || "未分科目"}</span>
                      </button>
                      <button className="icon-button danger" type="button" onClick={() => removeChapter(chapter.id)} aria-label="删除章节">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          </section>
        )}

        {activeView === "remote" && (
          <section className="remote-layout">
            <div className="panel remote-panel">
              <div className="section-header">
                <div>
                  <span className="eyebrow">远程题库</span>
                  <h2>连接配置</h2>
                </div>
                <div className={`remote-state ${remoteForm.status}`}>
                  {remoteForm.status === "connected" ? <Wifi size={17} /> : <WifiOff size={17} />}
                  {remoteForm.status === "connected" ? "已连接" : remoteForm.status === "failed" ? "连接失败" : "未连接"}
                </div>
              </div>
              <div className="remote-copy">
                <p>首版以本地题库为主，远程题库通过独立配置和接口适配器预留。后续服务端确定后，可对接拉取、上传和同步。</p>
              </div>
              <form className="remote-form" onSubmit={(event) => event.preventDefault()}>
                <label>
                  API 地址
                  <input
                    autoComplete="off"
                    name="remote-endpoint"
                    value={remoteForm.endpoint}
                    onChange={(event) => setRemoteForm({ ...remoteForm, endpoint: event.target.value })}
                    placeholder="https://api.example.com/question-bank"
                  />
                </label>
                <label>
                  访问令牌
                  <input
                    autoComplete="off"
                    name="remote-token"
                    value={remoteForm.token}
                    onChange={(event) => setRemoteForm({ ...remoteForm, token: event.target.value })}
                    placeholder="Bearer token"
                    type="password"
                  />
                </label>
                <div className="button-row">
                  <button className="secondary-button" type="button" onClick={testRemoteConnection} disabled={remoteTesting}>
                    <RefreshCw size={17} />
                    {remoteTesting ? "测试中" : "测试连接"}
                  </button>
                  <button className="primary-button" type="button" onClick={saveRemoteConfig}>
                    <Save size={17} />
                    保存配置
                  </button>
                </div>
              </form>
              <div className="remote-note">
                <strong>{remoteForm.message || "远程题库接口待配置"}</strong>
                <span>上次检测：{formatDate(remoteForm.lastCheckedAt)}</span>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function QuestionPractice({
  question,
  subjectName,
  chapterName,
  selectedAnswers,
  shortAnswer,
  submitted,
  onSelect,
  onShortAnswer
}: {
  question: Question;
  subjectName: string;
  chapterName: string;
  selectedAnswers: string[];
  shortAnswer: string;
  submitted: boolean;
  onSelect: (optionId: string) => void;
  onShortAnswer: (value: string) => void;
}) {
  return (
    <div className="question-practice">
      <div className="question-meta">
        <span>{subjectName}</span>
        <span>{chapterName}</span>
        <span>{difficultyLabel[question.difficulty]}</span>
      </div>
      <h2>{question.stem}</h2>
      {isWrittenType(question.type) ? (
        <textarea
          className="short-answer"
          value={shortAnswer}
          onChange={(event) => onShortAnswer(event.target.value)}
          disabled={submitted}
          placeholder={
            question.type === "fill_blank"
              ? "在这里填写空缺答案"
              : question.type === "essay"
                ? "在这里输入论述、分析或答题要点"
                : "在这里输入你的简答内容"
          }
        />
      ) : question.type === "true_false" ? (
        <div className="option-list compact-options">
          {[
            { id: "true", label: "正确" },
            { id: "false", label: "错误" }
          ].map((option) => (
            <button
              className={`option-item ${selectedAnswers.includes(option.id) ? "is-selected" : ""}`}
              disabled={submitted}
              key={option.id}
              onClick={() => onSelect(option.id)}
              type="button"
            >
              <span className="option-control" />
              <strong>{option.label}</strong>
              <span>{option.id === "true" ? "题干表述成立" : "题干表述不成立"}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="option-list">
          {question.options.map((option) => (
            <button
              className={`option-item ${selectedAnswers.includes(option.id) ? "is-selected" : ""}`}
              disabled={submitted}
              key={option.id}
              onClick={() => onSelect(option.id)}
              type="button"
            >
              <span className="option-control">{question.type === "single" ? "" : selectedAnswers.includes(option.id) ? "✓" : ""}</span>
              <strong>{option.label}.</strong>
              <span>{option.content}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AnswerReview({ question, userAnswer }: { question: Question; userAnswer: string }) {
  const aiAnalysis = question.aiAnalysis || buildAiAnalysis(question);

  return (
    <div className="answer-review">
      <div className="result-badge">
        <CheckCircle2 size={18} />
        答案已展开
      </div>
      <section>
        <h3>正确答案</h3>
        <p className="answer-text">{answerText(question)}</p>
      </section>
      <section>
        <h3>你的答案</h3>
        <p className="answer-text muted">{userAnswer || "未填写"}</p>
      </section>
      <section>
        <h3>解析</h3>
        <p>{question.analysis || "暂无解析"}</p>
      </section>
      <section>
        <h3>AI 解题步骤</h3>
        <ol className="analysis-list">
          {aiAnalysis.solveSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
      <section>
        <h3>相关知识点</h3>
        <div className="tag-row">
          {(aiAnalysis.knowledgePoints.length > 0 ? aiAnalysis.knowledgePoints : question.tags.length > 0 ? question.tags : ["基础复盘"]).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </section>
      <section>
        <h3>易错分析</h3>
        <ul className="analysis-list">
          {aiAnalysis.commonMistakes.map((mistake) => (
            <li key={mistake}>{mistake}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function QuestionEditor({
  chapters,
  form,
  subjects,
  onAddOption,
  onChange,
  onDelete,
  onOptionChange,
  onRemoveOption,
  onSubmit,
  onTypeChange,
  onAiAssist
}: {
  chapters: Chapter[];
  form: QuestionFormState;
  subjects: Subject[];
  onAddOption: () => void;
  onChange: <K extends keyof QuestionFormState>(key: K, value: QuestionFormState[K]) => void;
  onDelete?: () => void;
  onOptionChange: (optionId: string, content: string) => void;
  onRemoveOption: (optionId: string) => void;
  onSubmit: (event: FormEvent) => void;
  onTypeChange: (type: QuestionType) => void;
  onAiAssist: () => void;
}) {
  return (
    <form className="question-editor" onSubmit={onSubmit}>
      <div className="type-segment" aria-label="选择题型">
        {questionTypeOrder.map((type) => (
          <button
            className={form.type === type ? "is-selected" : ""}
            key={type}
            type="button"
            onClick={() => onTypeChange(type)}
          >
            <strong>{questionTypeMeta[type].label}</strong>
            <span>{questionTypeMeta[type].hint}</span>
          </button>
        ))}
      </div>
      <div className="form-grid">
        <label>
          科目
          <select value={form.subjectId} onChange={(event) => onChange("subjectId", event.target.value)}>
            {subjects.map((subject) => (
              <option value={subject.id} key={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          章节
          <select value={form.chapterId || ""} onChange={(event) => onChange("chapterId", event.target.value || undefined)}>
            <option value="">未分章节</option>
            {chapters.map((chapter) => (
              <option value={chapter.id} key={chapter.id}>
                {chapter.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        题干
        <textarea
          autoComplete="off"
          name="question-stem"
          value={form.stem}
          onChange={(event) => onChange("stem", event.target.value)}
          placeholder="请输入题干"
        />
      </label>

      {requiresOptions(form.type) && (
        <div className="option-editor">
          <div className="inline-header">
            <strong>选项</strong>
            <button className="small-button" type="button" onClick={onAddOption}>
              <Plus size={15} />
              添加选项
            </button>
          </div>
          {form.options.map((option) => (
            <div className="option-edit-row" key={option.id}>
              <span>{option.label}</span>
              <input
                aria-label={`选项 ${option.label}`}
                autoComplete="off"
                name={`option-${option.label}`}
                value={option.content}
                onChange={(event) => onOptionChange(option.id, event.target.value)}
              />
              <button className="icon-button" type="button" onClick={() => onRemoveOption(option.id)} aria-label="删除选项">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <label>
        {questionTypeMeta[form.type].answerLabel}
        {isWrittenType(form.type) ? (
          <textarea
            value={form.answer.join(form.type === "fill_blank" ? "；" : "\n")}
            name="short-answer-reference"
            onChange={(event) =>
              onChange(
                "answer",
                form.type === "fill_blank"
                  ? event.target.value
                      .split(/\n|;|；/)
                      .map((item) => item.trim())
                      .filter(Boolean)
                  : event.target.value
                    ? [event.target.value]
                    : []
              )
            }
            placeholder={questionTypeMeta[form.type].answerPlaceholder}
          />
        ) : form.type === "true_false" ? (
          <div className="answer-picker">
            {[
              { value: "true", label: "正确" },
              { value: "false", label: "错误" }
            ].map((item) => (
              <button
                className={form.answer[0] === item.value ? "is-selected" : ""}
                key={item.value}
                type="button"
                onClick={() => onChange("answer", [item.value])}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="answer-picker">
            {form.options.map((option) => (
              <button
                className={form.answer.includes(option.id) ? "is-selected" : ""}
                key={option.id}
                type="button"
                onClick={() => {
                  if (form.type === "single") {
                    onChange("answer", [option.id]);
                    return;
                  }
                  onChange(
                    "answer",
                    form.answer.includes(option.id)
                      ? form.answer.filter((answer) => answer !== option.id)
                      : [...form.answer, option.id]
                  );
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </label>

      <div className="ai-assist-panel">
        <div>
          <span className="eyebrow">AI 辅助解题</span>
          <h3>生成解析、步骤、知识点和易错项</h3>
          <p>先基于当前题干和答案生成本地 AI 分析草稿，后续可替换为远程模型接口。</p>
        </div>
        <button className="secondary-button" type="button" onClick={onAiAssist}>
          <WandSparkles size={17} />
          AI 分析
        </button>
        {form.aiAnalysis && (
          <div className="ai-insight-grid">
            <section>
              <strong>建议答案</strong>
              <p>{form.aiAnalysis.suggestedAnswer}</p>
            </section>
            <section>
              <strong>解题步骤</strong>
              <ul>
                {form.aiAnalysis.solveSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </section>
            <section>
              <strong>知识点</strong>
              <div className="tag-row">
                {form.aiAnalysis.knowledgePoints.map((point) => (
                  <span key={point}>{point}</span>
                ))}
              </div>
            </section>
            <section>
              <strong>易错分析</strong>
              <ul>
                {form.aiAnalysis.commonMistakes.map((mistake) => (
                  <li key={mistake}>{mistake}</li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>

      <label>
        解析
        <textarea
          autoComplete="off"
          name="question-analysis"
          value={form.analysis}
          onChange={(event) => onChange("analysis", event.target.value)}
          placeholder="请输入答案解析"
        />
      </label>

      <div className="form-grid">
        <label>
          难度
          <select value={form.difficulty} onChange={(event) => onChange("difficulty", event.target.value as Difficulty)}>
            <option value="easy">基础</option>
            <option value="normal">标准</option>
            <option value="hard">进阶</option>
          </select>
        </label>
        <label>
          标签
          <input
            autoComplete="off"
            name="question-tags"
            value={form.tagText}
            onChange={(event) => onChange("tagText", event.target.value)}
            placeholder="多个标签用逗号分隔"
          />
        </label>
      </div>

      <div className="button-row">
        {onDelete && (
          <button className="danger-button" type="button" onClick={onDelete}>
            <Trash2 size={17} />
            删除题目
          </button>
        )}
        <div className="spacer" />
        <button className="primary-button" type="submit">
          <Save size={17} />
          保存入库
        </button>
      </div>
    </form>
  );
}
