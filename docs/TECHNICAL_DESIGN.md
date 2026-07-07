# 刷题助手技术设计 v0.1

## 1. 工程目标

本项目交付一个 Electron 桌面端刷题系统，首版以离线本地题库为核心，同时通过接口分层预留远程题库能力。工程目标不是一次性做复杂平台，而是先形成稳定、可验收、可扩展的桌面应用骨架。

## 2. 技术栈

| 层级 | 方案 | 说明 |
| --- | --- | --- |
| 桌面容器 | Electron | 提供 Windows/macOS 桌面应用能力 |
| 前端框架 | React + TypeScript | 便于组件化和类型约束 |
| 构建工具 | Vite | 开发启动快，适合 Electron 前端 |
| 图标 | lucide-react | 保持克制、现代的工具型图标 |
| 本地存储 | Repository + localStorage MVP | 快速交付，后续可替换 SQLite |
| 远程接口 | Remote repository adapter | 预留 API 对接能力 |

首版推荐先用 `localStorage` 完成功能闭环，原因是本机使用和验收更快，且题库数据量在 MVP 阶段可控。数据访问必须通过 Repository 抽象，后续切换 SQLite 或远程同步时不改 UI 业务流程。

## 3. 目录结构

```text
.
├── docs/
│   ├── PRODUCT_REQUIREMENTS.md
│   ├── TECHNICAL_DESIGN.md
│   └── DELIVERY_CHECKLIST.md
├── electron/
│   ├── main.ts
│   └── preload.ts
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   └── routes.ts
│   ├── components/
│   │   ├── AppShell.tsx
│   │   ├── Button.tsx
│   │   ├── EmptyState.tsx
│   │   ├── Field.tsx
│   │   └── Modal.tsx
│   ├── features/
│   │   ├── dashboard/
│   │   ├── practice/
│   │   ├── questions/
│   │   ├── remote-bank/
│   │   └── subjects/
│   ├── lib/
│   │   ├── data/
│   │   ├── parser/
│   │   ├── initialSnapshot.ts
│   │   └── utils.ts
│   ├── styles/
│   │   └── app.css
│   ├── main.tsx
│   └── types.ts
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 4. 数据类型

```ts
export type QuestionType = "single" | "multiple" | "short";

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
  difficulty?: "easy" | "normal" | "hard";
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
  status: "idle" | "connected" | "failed";
}

export interface ParsedQuestionDraft {
  type: QuestionType;
  subjectId?: string;
  chapterId?: string;
  stem: string;
  options: QuestionOption[];
  answer: string[];
  analysis: string;
  warnings: string[];
}

export interface ParseResult {
  drafts: ParsedQuestionDraft[];
  rawText: string;
  warnings: string[];
}
```

## 5. Repository 设计

UI 不直接读写存储。所有数据操作通过仓库接口完成。

```ts
export interface StudyRepository {
  getSnapshot(): StudySnapshot;
  saveSubject(input: SubjectInput): Subject;
  deleteSubject(id: string): void;
  saveChapter(input: ChapterInput): Chapter;
  deleteChapter(id: string): void;
  saveQuestion(input: QuestionInput): Question;
  deleteQuestion(id: string): void;
  updateRemoteConfig(input: RemoteBankConfig): RemoteBankConfig;
  testRemoteConnection(input: RemoteBankConfig): Promise<RemoteTestResult>;
}
```

### 5.1 本地仓库

- 使用一个版本化 storage key，例如 `study-assistant:v1`。
- 每次写入前校验基础字段。
- 删除科目时同步删除该科目下章节和题目。
- 删除章节时保留题目，但清空题目的 `chapterId`，降低误删风险。

### 5.2 远程仓库预留

远程题库首版不强行接真实服务端，但要提供独立适配器。

```ts
export interface RemoteQuestionBank {
  testConnection(config: RemoteBankConfig): Promise<RemoteTestResult>;
  pullQuestions(config: RemoteBankConfig): Promise<Question[]>;
  pushQuestions(config: RemoteBankConfig, questions: Question[]): Promise<void>;
}
```

UI 展示：

- API 地址。
- 访问令牌。
- 连接测试。
- 上次连接时间。
- 当前状态。

## 6. 功能模块

### 6.1 AppShell

- 左侧 macOS 风格侧边栏。
- 主区域顶部显示当前模块标题和关键操作。
- 页面切换不使用重型路由，MVP 可用本地状态控制。

### 6.2 Dashboard

- 显示科目数、章节数、题目数。
- 显示单选、多选、判断、填空、简答、论述/分析数量。
- 提供开始随机练习、上传题目、管理科目的快捷入口。

### 6.3 Subjects

- 科目列表。
- 当前科目下章节管理。
- 支持新增、编辑、删除。
- 删除操作需要二次确认。

### 6.4 Questions

- 题目筛选：科目、章节、题型、关键词。
- 题目列表：题干摘要、题型、归属、更新时间。
- 自动解析入口：
  - 用户粘贴原始题目文本。
  - 系统解析题干、选项、正确答案、解析。
  - 解析结果以草稿表单展示。
  - 用户校对后保存。
- 题目表单：
  - 题型切换。
  - 题干输入。
  - 选项编辑。
  - 答案选择。
  - 解析输入。
  - 所属科目和章节。

### 6.5 QuestionParser

自动解析器先采用规则解析，保证离线可用、可解释、成本可控。

```ts
export interface QuestionParser {
  parse(rawText: string): ParseResult;
}
```

首版识别规则：

- 根据 `答案：`、`正确答案：`、`参考答案：` 识别答案区。
- 根据 `解析：`、`答案解析：` 识别解析区。
- 根据 `A.`、`A、`、`A．`、`（A）` 等格式识别选项。
- 有选项且答案为单个选项时识别为单选。
- 有选项且答案为多个选项时识别为多选。
- 没有选项时识别为简答。
- 字段缺失时生成 warning，由 UI 提醒用户补齐。

### 6.6 Practice

- 随机练习：
  - 可选全部题库或指定科目。
  - 随机抽题。
- 章节练习：
  - 必选科目。
  - 可选章节。
  - 从匹配题目中随机抽题。
- 提交流程：
  - 不强制判分。
  - 提交后展示正确答案和解析。
  - 支持下一题。

### 6.7 RemoteBank

- 配置 endpoint 和 token。
- 测试连接。
- 展示远程题库能力说明。
- 为后续同步按钮保留位置。

## 7. 状态流

### 7.1 新增题目

```text
用户填写表单
-> 前端校验
-> repository.saveQuestion
-> 写入本地 snapshot
-> UI 刷新题目列表和统计
```

### 7.2 自动解析题目

```text
用户粘贴原始题目文本
-> QuestionParser.parse
-> 生成 ParsedQuestionDraft
-> UI 展示草稿和 warning
-> 用户修正科目、章节、答案等字段
-> repository.saveQuestion
-> 写入本地题库
```

### 7.3 随机抽题

```text
选择范围
-> 根据 subjectId/chapterId/type 过滤
-> 随机取一题
-> 展示题目
-> 用户作答
-> 提交后展示 answer + analysis
```

### 7.4 删除章节

```text
用户确认删除章节
-> 删除 Chapter
-> 将关联 Question.chapterId 置空
-> 保留题目数据
-> UI 展示题目归属为未分章节
```

## 8. UI 实现约束

1. 不做营销首页，第一屏就是可用的工作台。
2. 不堆叠大卡片，优先使用列表、分栏、紧凑统计。
3. 按钮和工具操作使用图标 + 必要文字。
4. 所有表单字段要有清晰标签、错误提示和空状态。
5. 练习区保持阅读优先，解析区在提交后出现。
6. 字体使用系统字体栈，避免花哨字体。
7. 配色避免单一蓝紫渐变，采用浅灰、白、系统蓝、少量绿色/橙色状态色。

## 9. 验证策略

### 9.1 静态验证

- `npm run build`
- TypeScript 编译。
- 检查未使用变量和类型错误。

### 9.2 手动验证

- 启动 Electron。
- 新增科目。
- 新增章节。
- 新增单选、多选、判断、填空、简答、论述/分析题。
- 粘贴原始题目文本，自动解析出题型、题干、选项、答案和解析。
- 刷新或重启后数据仍存在。
- 随机练习能抽题并展示解析。
- 章节练习只抽取目标章节题。
- 远程题库页能保存配置并测试状态。

### 9.3 UI 验证

- 检查主界面是否杂乱。
- 检查题目表单是否易用。
- 检查 1280x800 窗口下文字不重叠、不溢出。
- 按 web interface guidelines 做最终审查。

## 10. 风险与处理

| 风险 | 处理 |
| --- | --- |
| 远程题库接口未定 | 先做配置和 adapter，避免 UI 绑定具体后端 |
| 题库数据结构后续变化 | 本地 snapshot 增加 version 字段 |
| 批量导入格式复杂 | MVP 先手动录入，导入导出作为 V1 |
| 自动判分争议 | MVP 不判分，只展示答案和解析 |
| UI 信息过载 | 用分区和渐进展示，练习页提交后再显示解析 |

## 11. 交付物

- 产品文档。
- 技术设计文档。
- Electron 应用源码。
- 可运行开发命令。
- 构建命令和验证结果。
- 交付说明。
