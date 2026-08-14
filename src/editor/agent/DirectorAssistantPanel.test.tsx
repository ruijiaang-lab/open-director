import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DirectorAssistantPanel } from "./DirectorAssistantPanel";

const memoryStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  };
})();

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage);
});

describe("AI 导演助手面板", () => {
  it("渲染悬浮按钮，点开显示对话面板", async () => {
    const user = userEvent.setup();
    render(<DirectorAssistantPanel />);

    expect(screen.getByRole("button", { name: "AI 导演助手" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "AI 导演助手" }));
    expect(screen.getByRole("dialog", { name: "AI 导演助手" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("用大白话说你的导演需求…")).toBeInTheDocument();
  });

  it("未配置 key 时发送给出明确错误提示", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    render(<DirectorAssistantPanel />);
    await user.click(screen.getByRole("button", { name: "AI 导演助手" }));

    const input = screen.getByPlaceholderText("用大白话说你的导演需求…");
    await user.type(input, "加一个角色");
    await user.click(screen.getByRole("button", { name: "发送" }));

    // fetch 会因 key 缺失立即抛错（不真正发请求），面板应显示错误消息
    const messages = await screen.findByText(/还没有配置 API Key/);
    expect(messages).toBeInTheDocument();
  });
});
