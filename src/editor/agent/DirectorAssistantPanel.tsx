import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Send, Settings, X } from "lucide-react";
import { sendChat, loadAISettings, saveAISettings, extractCommands, type ChatMessage, type AISettings } from "./agentChat";
import { COMMAND_DOCS, buildSceneSummary, execDirectives } from "./directorCommands";

interface PanelMessage {
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
}

export function DirectorAssistantPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<PanelMessage[]>([
    {
      role: "assistant",
      content: "我是你的 AI 导演助手。试着对我说：「加一个角色放到右边，再架一台机位对准他」",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AISettings>(() => loadAISettings());
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, open]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setBusy(true);

    try {
      const history: ChatMessage[] = messages
        .filter((m) => !m.isError)
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));
      const system = `${COMMAND_DOCS}\n\n${buildSceneSummary()}`;
      const reply = await sendChat([...history, { role: "user", content: text }], system);

      let commands;
      try {
        commands = extractCommands(reply);
      } catch {
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
        return;
      }

      if (commands.length === 0) {
        setMessages((prev) => [...prev, { role: "assistant", content: "没有可执行的动作" }]);
        return;
      }

      const result = execDirectives(commands);
      const summary = reply.length > 600 ? `${reply.slice(0, 600)}…` : reply;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `${summary}\n\n⚙️ 执行结果：\n${result}` },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `出错了：${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, messages]);

  return (
    <>
      <button
        type="button"
        className="ai-assistant-fab"
        aria-label="AI 导演助手"
        title="AI 导演助手"
        onClick={() => setOpen((v) => !v)}
      >
        <Bot aria-hidden="true" size={20} strokeWidth={1.8} />
      </button>

      {open && (
        <div className="ai-assistant-panel" role="dialog" aria-label="AI 导演助手">
          <div className="ai-assistant-header">
            <span className="ai-assistant-title">
              <Bot aria-hidden="true" size={15} strokeWidth={1.8} /> AI 导演助手
            </span>
            <div className="ai-assistant-header-actions">
              <button type="button" className="ai-assistant-icon-button" aria-label="设置" title="设置" onClick={() => setShowSettings((v) => !v)}>
                <Settings aria-hidden="true" size={15} strokeWidth={1.8} />
              </button>
              <button type="button" className="ai-assistant-icon-button" aria-label="关闭" title="关闭" onClick={() => setOpen(false)}>
                <X aria-hidden="true" size={15} strokeWidth={1.8} />
              </button>
            </div>
          </div>

          {showSettings && (
            <div className="ai-assistant-settings">
              <label>
                API 地址
                <input
                  value={settings.baseUrl}
                  onChange={(e) => setSettings((s) => ({ ...s, baseUrl: e.target.value }))}
                  placeholder="https://api.xiaomimimo.com"
                />
              </label>
              <label>
                模型
                <input
                  value={settings.model}
                  onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
                  placeholder="mimo-v2.5-pro"
                />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))}
                  placeholder="sk-..."
                />
              </label>
              <button
                type="button"
                className="ai-assistant-save-button"
                onClick={() => {
                  saveAISettings(settings);
                  setShowSettings(false);
                }}
              >
                保存设置
              </button>
              <p className="ai-assistant-settings-hint">Key 只保存在你自己的浏览器里，不会上传。支持任何 Anthropic 协议兼容服务。</p>
            </div>
          )}

          <div className="ai-assistant-messages" ref={listRef}>
            {messages.map((m, i) => (
              <div key={i} className={`ai-message ai-message-${m.role}${m.isError ? " ai-message-error" : ""}`}>
                {m.content.split("\n").map((line, j) => (
                  <div key={j}>{line || " "}</div>
                ))}
              </div>
            ))}
            {busy && <div className="ai-message ai-message-assistant ai-message-thinking">AI 正在想…</div>}
          </div>

          <div className="ai-assistant-input-row">
            <input
              className="ai-assistant-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="用大白话说你的导演需求…"
              disabled={busy}
            />
            <button type="button" className="ai-assistant-send-button" aria-label="发送" onClick={handleSend} disabled={busy || !input.trim()}>
              <Send aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
