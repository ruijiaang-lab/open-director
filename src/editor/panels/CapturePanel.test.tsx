import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearViewportCaptureHandler, setViewportCaptureHandler } from "../io/captureBridge";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import { CapturePanel } from "./CapturePanel";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function screenshotResult() {
  return [
    {
      label: "当前视角",
      dataUrl: "data:image/png;base64,current",
      meta: {
        mode: "director" as const,
        cameraId: null,
        fov: 50,
        position: [0, 2.2, 9] as [number, number, number],
        target: [0, 1.2, 0] as [number, number, number],
      },
    },
  ];
}

beforeEach(() => {
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...createInitialDirectorState(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  clearViewportCaptureHandler();
  vi.restoreAllMocks();
});

it("runs four-angle capture from the left screenshot panel", async () => {
  const user = userEvent.setup();
  const handler = vi.fn(async () => [
    {
      label: "四方位-1",
      dataUrl: "data:image/png;base64,a",
      meta: {
        mode: "director" as const,
        cameraId: null,
        fov: 50,
        position: [0, 2.2, 9] as [number, number, number],
        target: [0, 1.2, 0] as [number, number, number],
      },
    },
  ]);

  setViewportCaptureHandler(handler);
  render(<CapturePanel />);

  await user.click(screen.getByRole("button", { name: "四方位截图" }));

  expect(handler).toHaveBeenCalledWith({
    preset: "four",
    source: "capture-panel",
  });
  expect(await screen.findByText("已导出 1 张截图")).toBeInTheDocument();
});

it("shows import errors, keeps the current project, and clears the file input", async () => {
  const user = userEvent.setup();
  const initialProject = useDirectorStore.getState().project;
  const replaceProject = vi.fn();
  useDirectorStore.setState({ ...useDirectorStore.getState(), replaceProject });
  render(<CapturePanel />);

  const input = screen.getByLabelText("导入工程 JSON");
  await user.upload(input, new File(["{broken"], "broken.json", { type: "application/json" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("工程 JSON 格式错误");
  expect(replaceProject).not.toHaveBeenCalled();
  expect(useDirectorStore.getState().project).toBe(initialProject);
  expect(input).toHaveValue("");
});

it("replaces the project after a valid import and reports success", async () => {
  const user = userEvent.setup();
  const importedProject = createInitialDirectorState().project;
  const replaceProject = vi.fn();
  useDirectorStore.setState({ ...useDirectorStore.getState(), replaceProject });
  render(<CapturePanel />);

  const input = screen.getByLabelText("导入工程 JSON");
  await user.upload(
    input,
    new File([JSON.stringify(importedProject)], "project.json", { type: "application/json" })
  );

  await waitFor(() => expect(replaceProject).toHaveBeenCalledWith(importedProject));
  expect(await screen.findByRole("status")).toHaveTextContent("工程导入成功");
  expect(input).toHaveValue("");
});

it("downloads a named project JSON file and revokes its object URL after click", async () => {
  const user = userEvent.setup();
  const createObjectURL = vi.fn(() => "blob:project-export");
  const revokeObjectURL = vi.fn();
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe("open-director-project.json");
    expect(this.href).toBe("blob:project-export");
  });

  try {
    render(<CapturePanel />);
    await user.click(screen.getByRole("button", { name: "导出工程 JSON" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:project-export");
    expect(revokeObjectURL.mock.invocationCallOrder[0]).toBeGreaterThan(click.mock.invocationCallOrder[0]!);
  } finally {
    if (originalCreateObjectURL) {
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
    } else {
      delete (URL as Partial<typeof URL>).createObjectURL;
    }
    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
    } else {
      delete (URL as Partial<typeof URL>).revokeObjectURL;
    }
  }
});

it("keeps only the latest import error when an older valid file resolves later", async () => {
  const oldRead = deferred<string>();
  const oldFile = new File(["old"], "old.json", { type: "application/json" });
  vi.spyOn(oldFile, "text").mockReturnValue(oldRead.promise);
  const latestFile = new File(["broken"], "latest.json", { type: "application/json" });
  vi.spyOn(latestFile, "text").mockResolvedValue("{broken");
  const replaceProject = vi.fn();
  useDirectorStore.setState({ ...useDirectorStore.getState(), replaceProject });
  render(<CapturePanel />);

  const input = screen.getByLabelText("导入工程 JSON");
  fireEvent.change(input, { target: { files: [oldFile] } });
  fireEvent.change(input, { target: { files: [latestFile] } });

  expect(await screen.findByRole("alert")).toHaveTextContent("工程 JSON 格式错误");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(replaceProject).not.toHaveBeenCalled();

  await act(async () => {
    oldRead.resolve(JSON.stringify(createInitialDirectorState().project));
    await oldRead.promise;
  });

  expect(replaceProject).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("工程 JSON 格式错误");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("lets the latest successful import win over an older failure and clears stale status", async () => {
  const replaceProject = vi.fn();
  useDirectorStore.setState({ ...useDirectorStore.getState(), replaceProject });
  render(<CapturePanel />);
  const input = screen.getByLabelText("导入工程 JSON");
  const firstFile = new File(["first"], "first.json", { type: "application/json" });
  vi.spyOn(firstFile, "text").mockResolvedValue(JSON.stringify(createInitialDirectorState().project));

  fireEvent.change(input, { target: { files: [firstFile] } });
  await screen.findByRole("status");
  replaceProject.mockClear();

  const oldRead = deferred<string>();
  const oldFile = new File(["old"], "old.json", { type: "application/json" });
  vi.spyOn(oldFile, "text").mockReturnValue(oldRead.promise);
  const latestFile = new File(["latest"], "latest.json", { type: "application/json" });
  vi.spyOn(latestFile, "text").mockResolvedValue(JSON.stringify(createInitialDirectorState().project));

  fireEvent.change(input, { target: { files: [oldFile] } });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.change(input, { target: { files: [latestFile] } });

  await waitFor(() => expect(replaceProject).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("status")).toHaveTextContent("工程导入成功");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  await act(async () => {
    oldRead.resolve("{broken");
    await oldRead.promise;
  });

  expect(replaceProject).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent("工程导入成功");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("allows only one overlapping screenshot request and restores controls after success", async () => {
  const captureRead = deferred<ReturnType<typeof screenshotResult>>();
  const handler = vi.fn(() => captureRead.promise);
  setViewportCaptureHandler(handler);
  const { container } = render(<CapturePanel />);
  const currentButton = screen.getByRole("button", { name: "当前视角截图" });

  fireEvent.click(currentButton);
  fireEvent.click(currentButton);

  expect(handler).toHaveBeenCalledTimes(1);
  expect(currentButton).toBeDisabled();
  expect(container.querySelector("[aria-busy='true']")).toBeInTheDocument();
  expect(screen.getByText("处理中")).toBeInTheDocument();

  await act(async () => {
    captureRead.resolve(screenshotResult());
    await captureRead.promise;
  });

  await waitFor(() => expect(currentButton).not.toBeDisabled());
  expect(handler).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent("已导出 1 张截图");
  expect(container.querySelector("[aria-busy='true']")).not.toBeInTheDocument();
});

it("restores screenshot controls and reports failure after a rejected request", async () => {
  const captureRead = deferred<ReturnType<typeof screenshotResult>>();
  setViewportCaptureHandler(vi.fn(() => captureRead.promise));
  const { container } = render(<CapturePanel />);
  const currentButton = screen.getByRole("button", { name: "当前视角截图" });

  fireEvent.click(currentButton);
  expect(currentButton).toBeDisabled();

  await act(async () => {
    captureRead.reject(new Error("截图失败"));
    await captureRead.promise.catch(() => undefined);
  });

  await waitFor(() => expect(currentButton).not.toBeDisabled());
  expect(screen.getByRole("status")).toHaveTextContent("截图失败");
  expect(container.querySelector("[aria-busy='true']")).not.toBeInTheDocument();
});

it("does not download a completed capture after the panel unmounts", async () => {
  const captureRead = deferred<ReturnType<typeof screenshotResult>>();
  setViewportCaptureHandler(vi.fn(() => captureRead.promise));
  const { unmount } = render(<CapturePanel />);

  fireEvent.click(screen.getByRole("button", { name: "当前视角截图" }));
  unmount();

  await act(async () => {
    captureRead.resolve(screenshotResult());
    await captureRead.promise;
  });

  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});
