import type {
  ProviderUserQuestionReply,
  ProviderUserQuestionRequest,
} from "../../providers/types.js";

/** 单个答案的最大字符数，避免异常输入撑大 Agent 上下文 */
const MAX_ANSWER_CHARS = 4000;

/** 等待 WebUI 回复的提问 */
type PendingUserQuestion = {
  /** Agent 提出的问题，用于校验回复 */
  request: ProviderUserQuestionRequest;
  /** 收到用户回复后结束等待 */
  resolve: (reply: ProviderUserQuestionReply) => void;
};

/** 前端提交的回复请求体 */
export type UserQuestionReplyBody = {
  /** answer 表示回答，skip 表示跳过全部问题 */
  action?: unknown;
  /** 「问题全文 → 答案」映射 */
  answers?: unknown;
};

/** 回复不合法或提问已结束时抛出，携带 HTTP 状态码 */
export class UserQuestionReplyError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "UserQuestionReplyError";
  }
}

/** 按「会话 ID + 提问 ID」索引的待回复提问 */
const pendingUserQuestions = new Map<string, PendingUserQuestion>();

/** 生成待回复提问的索引键 */
function getPendingKey(sessionId: string, questionId: string): string {
  return `${sessionId}:${questionId}`;
}

/** 把前端提交的答案整理为「问题全文 → 答案」映射，只保留本次提问中存在且非空的答案 */
function normalizeAnswers(
  request: ProviderUserQuestionRequest,
  rawAnswers: unknown,
): Record<string, string> {
  if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) return {};
  const source = rawAnswers as Record<string, unknown>;
  const answers: Record<string, string> = {};
  for (const item of request.questions) {
    const value = source[item.question];
    if (typeof value !== "string") continue;
    const answer = value.trim().slice(0, MAX_ANSWER_CHARS);
    if (answer) answers[item.question] = answer;
  }
  return answers;
}

/** 登记提问并等待用户回复；signal 中断（停止生成或本轮结束）时以错误结束等待 */
export function waitForUserQuestionReply(
  sessionId: string,
  request: ProviderUserQuestionRequest,
  signal: AbortSignal,
): Promise<ProviderUserQuestionReply> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("提问已取消"));
      return;
    }
    const key = getPendingKey(sessionId, request.id);
    const onAbort = () => {
      pendingUserQuestions.delete(key);
      reject(new Error("提问已取消"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    pendingUserQuestions.set(key, {
      request,
      resolve: (reply) => {
        signal.removeEventListener("abort", onAbort);
        pendingUserQuestions.delete(key);
        resolve(reply);
      },
    });
  });
}

/** 提交用户对提问的回复；回复不合法或提问已结束时抛出 UserQuestionReplyError */
export function submitUserQuestionReply(
  sessionId: string,
  questionId: string,
  body: UserQuestionReplyBody,
): ProviderUserQuestionReply {
  const pending = pendingUserQuestions.get(getPendingKey(sessionId, questionId));
  if (!pending) {
    throw new UserQuestionReplyError("这个提问已结束或不存在", 404);
  }

  let reply: ProviderUserQuestionReply;
  if (body.action === "skip") {
    reply = { action: "skip" };
  } else if (body.action === "answer") {
    const answers = normalizeAnswers(pending.request, body.answers);
    if (Object.keys(answers).length === 0) {
      throw new UserQuestionReplyError("请至少回答一个问题", 400);
    }
    reply = { action: "answer", answers };
  } else {
    throw new UserQuestionReplyError("不支持的回复类型", 400);
  }

  pending.resolve(reply);
  return reply;
}
