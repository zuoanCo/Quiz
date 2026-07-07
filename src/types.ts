export type QuestionType = "single" | "multiple" | "true_false" | "fill_blank" | "short" | "essay";
export type Difficulty = "easy" | "normal" | "hard";
export type RemoteStatus = "idle" | "connected" | "failed";

export interface Subject {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Chapter {
  id: string;
  subjectId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionOption {
  id: string;
  label: string;
  content: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  subjectId: string;
  chapterId?: string;
  stem: string;
  options: QuestionOption[];
  answer: string[];
  analysis: string;
  aiAnalysis?: AiAnalysis;
  difficulty: Difficulty;
  tags: string[];
  source?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteBankConfig {
  endpoint: string;
  token: string;
  enabled: boolean;
  lastCheckedAt?: string;
  status: RemoteStatus;
  message?: string;
}

export interface StudySnapshot {
  version: 1;
  subjects: Subject[];
  chapters: Chapter[];
  questions: Question[];
  remoteConfig: RemoteBankConfig;
  updatedAt: string;
}

export interface ParsedQuestionDraft {
  type: QuestionType;
  subjectId?: string;
  chapterId?: string;
  stem: string;
  options: QuestionOption[];
  answer: string[];
  analysis: string;
  aiAnalysis?: AiAnalysis;
  warnings: string[];
}

export interface ParseResult {
  drafts: ParsedQuestionDraft[];
  rawText: string;
  warnings: string[];
}

export interface QuestionInput {
  id?: string;
  type: QuestionType;
  subjectId: string;
  chapterId?: string;
  stem: string;
  options: QuestionOption[];
  answer: string[];
  analysis: string;
  aiAnalysis?: AiAnalysis;
  difficulty: Difficulty;
  tags: string[];
  source?: string;
}

export interface AiAnalysis {
  suggestedAnswer: string;
  explanation: string;
  solveSteps: string[];
  knowledgePoints: string[];
  commonMistakes: string[];
  difficultyReason: string;
  confidence: number;
  generatedAt: string;
  mode: "local" | "remote";
}
