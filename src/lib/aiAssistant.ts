import type { AiAnalysis, Question, QuestionInput } from "../types";
import { nowIso } from "./id";
import { displayAnswerByType, questionTypeMeta } from "./questionTypes";

type AnalyzableQuestion = Pick<QuestionInput | Question, "type" | "stem" | "answer" | "analysis" | "tags" | "difficulty">;

function extractKnowledgePoints(question: AnalyzableQuestion) {
  const text = `${question.stem} ${question.analysis} ${question.tags.join(" ")}`;
  const points = new Set<string>();

  for (const tag of question.tags) {
    if (tag.trim()) points.add(tag.trim());
  }
  if (/计算机|二进制|数据|缓存|网络|协议|HTTP|TCP|IP/i.test(text)) points.add("计算机基础");
  if (/数学|函数|方程|质数|代数|几何|概率/i.test(text)) points.add("数学基础");
  if (/英语|语法|阅读|单词|完形|作文/i.test(text)) points.add("英语能力");
  if (/原因|影响|分析|论述|评价|说明/.test(text)) points.add("分析表达");
  if (/填空|____|_{2,}|（\s*）|\(\s*\)/.test(text)) points.add("关键概念记忆");

  return Array.from(points).slice(0, 5);
}

function buildDefaultExplanation(question: AnalyzableQuestion) {
  if (question.analysis.trim()) {
    return question.analysis.trim();
  }

  const typeLabel = questionTypeMeta[question.type].label;
  const answer = displayAnswerByType(question.type, question.answer);
  if (answer) {
    return `${typeLabel}的核心是先定位题干要求，再核对答案「${answer}」与关键条件是否一致。`;
  }
  return `${typeLabel}需要先补充参考答案，再由 AI 生成更完整的解析和复盘要点。`;
}

export function buildAiAnalysis(question: AnalyzableQuestion): AiAnalysis {
  const typeLabel = questionTypeMeta[question.type].label;
  const answer = displayAnswerByType(question.type, question.answer);
  const knowledgePoints = extractKnowledgePoints(question);
  const hasAnswer = answer.trim().length > 0;

  return {
    suggestedAnswer: hasAnswer ? answer : "需要人工确认答案",
    explanation: buildDefaultExplanation(question),
    solveSteps: [
      `识别题型为「${typeLabel}」，先确认题干问法和限制条件。`,
      hasAnswer ? `对照参考答案「${answer}」，检查是否覆盖题干要求。` : "先补充标准答案或评分要点。",
      question.analysis.trim() ? "将已有解析压缩成可复盘的关键步骤。" : "补充为什么是这个答案，以及其他答案为什么不合适。"
    ],
    knowledgePoints: knowledgePoints.length > 0 ? knowledgePoints : [typeLabel, "题干关键信息"],
    commonMistakes: [
      question.type === "multiple" ? "多选题容易漏选或把干扰项当成正确项。" : "只记答案，不复盘题干中的限定条件。",
      question.type === "essay" ? "论述题容易只有结论，缺少分点论证。" : "解析没有说明判断过程，后续复习成本高。"
    ],
    difficultyReason:
      question.difficulty === "hard"
        ? "题干信息量或分析链路较长，建议拆成步骤讲解。"
        : question.difficulty === "easy"
          ? "题干直接，适合作为基础概念题。"
          : "需要理解概念并完成一次判断，适合作为标准练习题。",
    confidence: hasAnswer ? 0.82 : 0.48,
    generatedAt: nowIso(),
    mode: "local"
  };
}
