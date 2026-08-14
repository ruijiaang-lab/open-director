export interface AISettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const SETTINGS_STORAGE_KEY = "open-director-ai-settings";

export const DEFAULT_AI_SETTINGS: AISettings = {
  baseUrl: "https://api.xiaomimimo.com",
  apiKey: "",
  model: "mimo-v2.5-pro",
};

export function loadAISettings(): AISettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // 忽略损坏的本地设置
  }
  return { ...DEFAULT_AI_SETTINGS };
}

export function saveAISettings(settings: AISettings) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** 调 Anthropic Messages API（兼容 xiaomimimo 等中转），返回助手回复文本 */
export async function sendChat(messages: ChatMessage[], system: string): Promise<string> {
  const settings = loadAISettings();
  if (!settings.apiKey) {
    throw new Error("还没有配置 API Key，请先点右上角设置");
  }

  const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 2048,
      system,
      messages,
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const err = await response.json();
      detail = err?.error?.message || err?.message || JSON.stringify(err);
    } catch {
      detail = await response.text();
    }
    throw new Error(`AI 服务返回错误（${response.status}）：${detail.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = (data.content || [])
    .filter((block: { type?: string }) => block.type === "text")
    .map((block: { text?: string }) => block.text ?? "")
    .join("");

  return text.trim();
}

/** 从模型回复里提取 JSON 指令数组（容忍 ```json 代码块包裹） */
export function extractCommands(text: string): { action: string; args?: Record<string, unknown> }[] {
  let jsonText = text.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonText = fenceMatch[1].trim();
  const firstBracket = jsonText.indexOf("[");
  const lastBracket = jsonText.lastIndexOf("]");
  if (firstBracket === -1 || lastBracket === -1) {
    throw new Error("AI 没有返回指令格式，回复原文见下方");
  }
  const parsed = JSON.parse(jsonText.slice(firstBracket, lastBracket + 1));
  if (!Array.isArray(parsed)) {
    throw new Error("AI 返回的不是指令数组");
  }
  return parsed;
}
