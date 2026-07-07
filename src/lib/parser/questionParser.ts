import type { ParseResult, ParsedQuestionDraft, QuestionOption, QuestionType } from "../../types";
import { buildAiAnalysis } from "../aiAssistant";
import { normalizeTrueFalseAnswer } from "../questionTypes";

const optionLinePattern = /^\s*(?:[（(]?([A-Ha-h])[）)]|([A-Ha-h])[\.\uff0e、:：])\s*(.+?)\s*$/;
const answerPattern = /(?:正确答案|参考答案|答案|答)\s*[:：]\s*([^\n\r]+)/i;
const analysisPattern = /(?:答案解析|解析|解题思路|说明)\s*[:：]\s*([\s\S]*)/i;
const explicitTypePattern = /(?:题型|类型)\s*[:：]\s*(单选|单项选择|多选|多项选择|判断|判断题|填空|填空题|简答|简答题|论述|论述题|分析|分析题|材料|材料题)/i;

function normalizeTypeLabel(value: string): QuestionType | null {
  if (/单选|单项/.test(value)) return "single";
  if (/多选|多项/.test(value)) return "multiple";
  if (/判断/.test(value)) return "true_false";
  if (/填空/.test(value)) return "fill_blank";
  if (/论述|分析|材料/.test(value)) return "essay";
  if (/简答/.test(value)) return "short";
  return null;
}

function cleanStem(value: string) {
  return value
    .replace(/^\s*(?:\d+[\.\uff0e、]|第\s*\d+\s*题[:：]?|题目[:：])\s*/i, "")
    .replace(explicitTypePattern, "")
    .replace(/(?:正确答案|参考答案|答案|答)\s*[:：].*/gi, "")
    .replace(/(?:答案解析|解析|解题思路|说明)\s*[:：][\s\S]*/gi, "")
    .trim();
}

function hasBlank(stem: string) {
  return /_{2,}|____|（\s*）|\(\s*\)|\[\s*\]|【\s*】/.test(stem);
}

function parseOptions(lines: string[]) {
  const options: QuestionOption[] = [];
  const stemLines: string[] = [];

  for (const line of lines) {
    const match = line.match(optionLinePattern);
    if (match) {
      const label = (match[1] || match[2]).toUpperCase();
      options.push({ id: label, label, content: match[3].trim() });
      continue;
    }
    stemLines.push(line);
  }

  return { options, stemLines };
}

function splitWrittenAnswer(rawAnswer: string) {
  return rawAnswer
    .split(/\n|;|；/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAnswer(rawAnswer: string, type: QuestionType) {
  const value = rawAnswer.trim();
  if (!value) return [];

  if (type === "single" || type === "multiple") {
    const matches = value.toUpperCase().match(/[A-H]/g) || [];
    return Array.from(new Set(matches));
  }

  if (type === "true_false") {
    return [normalizeTrueFalseAnswer(value)];
  }

  if (type === "fill_blank") {
    return splitWrittenAnswer(value);
  }

  return [value];
}

function inferType(rawText: string, stem: string, options: QuestionOption[], rawAnswer: string): QuestionType {
  const explicitType = rawText.match(explicitTypePattern)?.[1];
  const normalizedExplicitType = explicitType ? normalizeTypeLabel(explicitType) : null;
  if (normalizedExplicitType) return normalizedExplicitType;

  if (options.length > 0) {
    const answerLetters = rawAnswer.toUpperCase().match(/[A-H]/g) || [];
    return answerLetters.length > 1 ? "multiple" : "single";
  }

  if (/^(对|错|正确|错误|是|否|true|false|√|✓|×|x)$/i.test(rawAnswer.trim())) {
    return "true_false";
  }

  if (hasBlank(stem) || /填空/.test(rawText)) {
    return "fill_blank";
  }

  if (/论述|分析|材料|结合材料|谈谈|评价|原因|影响/.test(rawText)) {
    return "essay";
  }

  return "short";
}

function parseOne(rawText: string): ParsedQuestionDraft {
  const text = rawText.replace(/\r\n/g, "\n").trim();
  const analysisMatch = text.match(analysisPattern);
  const answerMatch = text.match(answerPattern);
  const analysis = analysisMatch?.[1]?.trim() || "";
  const rawAnswer = answerMatch?.[1]?.trim() || "";
  const withoutAnalysis = text.replace(analysisPattern, "").trim();
  const withoutAnswer = withoutAnalysis.replace(answerPattern, "").trim();
  const lines = withoutAnswer.split("\n").map((line) => line.trim()).filter(Boolean);
  const { options, stemLines } = parseOptions(lines);
  const stem = cleanStem(stemLines.join("\n"));
  const type = inferType(text, stem, options, rawAnswer);
  const answer = normalizeAnswer(rawAnswer, type);
  const warnings: string[] = [];

  if (!stem) warnings.push("未识别到题干");
  if ((type === "single" || type === "multiple") && options.length < 2) warnings.push("选择题至少需要两个选项");
  if (type !== "single" && type !== "multiple" && options.length > 0) warnings.push("已识别到选项，但题型不是选择题，请确认题型");
  if (answer.length === 0) warnings.push("未识别到答案");
  if (!analysis) warnings.push("未识别到解析，可用 AI 辅助生成后再校对");

  const draft: ParsedQuestionDraft = {
    type,
    stem,
    options: type === "single" || type === "multiple" ? options : [],
    answer,
    analysis,
    warnings
  };

  return {
    ...draft,
    aiAnalysis: buildAiAnalysis({
      ...draft,
      difficulty: "normal",
      tags: []
    })
  };
}

function splitBlocks(rawText: string) {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const blocks = normalized
    .split(/\n{2,}(?=\s*(?:\d+[\.\uff0e、]|第\s*\d+\s*题|题目[:：]|题型[:：]))/g)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.length > 0 ? blocks : [normalized];
}

export function parseQuestionText(rawText: string): ParseResult {
  const blocks = splitBlocks(rawText);
  const drafts = blocks.map(parseOne);
  const warnings = drafts.flatMap((draft, index) => draft.warnings.map((warning) => `第 ${index + 1} 题：${warning}`));

  return { drafts, rawText, warnings };
}
