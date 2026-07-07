import type { QuestionType } from "../types";

export const questionTypeOrder: QuestionType[] = [
  "single",
  "multiple",
  "true_false",
  "fill_blank",
  "short",
  "essay"
];

export const questionTypeMeta: Record<
  QuestionType,
  {
    label: string;
    shortLabel: string;
    hint: string;
    answerLabel: string;
    answerPlaceholder: string;
    requiresOptions: boolean;
    usesTextAnswer: boolean;
  }
> = {
  single: {
    label: "单选题",
    shortLabel: "单选",
    hint: "一个正确选项",
    answerLabel: "正确答案",
    answerPlaceholder: "选择一个选项",
    requiresOptions: true,
    usesTextAnswer: false
  },
  multiple: {
    label: "多选题",
    shortLabel: "多选",
    hint: "多个正确选项",
    answerLabel: "正确答案",
    answerPlaceholder: "选择多个选项",
    requiresOptions: true,
    usesTextAnswer: false
  },
  true_false: {
    label: "判断题",
    shortLabel: "判断",
    hint: "正确 / 错误",
    answerLabel: "判断答案",
    answerPlaceholder: "选择正确或错误",
    requiresOptions: false,
    usesTextAnswer: false
  },
  fill_blank: {
    label: "填空题",
    shortLabel: "填空",
    hint: "一个或多个空",
    answerLabel: "填空答案",
    answerPlaceholder: "多个空用分号或换行分隔",
    requiresOptions: false,
    usesTextAnswer: true
  },
  short: {
    label: "简答题",
    shortLabel: "简答",
    hint: "参考答案",
    answerLabel: "参考答案",
    answerPlaceholder: "输入参考答案",
    requiresOptions: false,
    usesTextAnswer: true
  },
  essay: {
    label: "论述/分析题",
    shortLabel: "论述",
    hint: "长答案与评分要点",
    answerLabel: "答案要点",
    answerPlaceholder: "输入答案要点、评分点或分析框架",
    requiresOptions: false,
    usesTextAnswer: true
  }
};

export function requiresOptions(type: QuestionType) {
  return questionTypeMeta[type].requiresOptions;
}

export function isChoiceType(type: QuestionType) {
  return type === "single" || type === "multiple";
}

export function isWrittenType(type: QuestionType) {
  return questionTypeMeta[type].usesTextAnswer;
}

export function normalizeTrueFalseAnswer(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["true", "t", "yes", "y", "对", "正确", "是", "√", "✓"].includes(normalized)) {
    return "true";
  }
  if (["false", "f", "no", "n", "错", "错误", "否", "×", "x"].includes(normalized)) {
    return "false";
  }
  return normalized;
}

export function displayAnswerByType(type: QuestionType, answer: string[]) {
  if (type === "true_false") {
    return answer[0] === "true" ? "正确" : answer[0] === "false" ? "错误" : answer.join("、");
  }
  return answer.join(type === "fill_blank" ? "；" : "、");
}
