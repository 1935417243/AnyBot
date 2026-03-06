export type ChatRole = "user" | "assistant";

export type ChatTurn = {
  role: ChatRole;
  content: string;
};

export type TextMessageContent = {
  text?: string;
};

export type ImageMessageContent = {
  image_key?: string;
};

export type IncomingMessage = {
  message_id: string;
  chat_id: string;
  message_type: string;
  content: string;
};

export type ReplyPayload = {
  text: string;
  imagePaths: string[];
};

export const sandboxModes = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export type SandboxMode = (typeof sandboxModes)[number];

export type CodexJsonEvent = {
  type?: string;
  thread_id?: string;
  item?: {
    type?: string;
    text?: string;
  };
};
