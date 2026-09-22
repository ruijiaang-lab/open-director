import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import { useCameraPlaybackStore } from "../store/cameraPlaybackStore";
import * as videoExport from "./videoExport";

type MimeSupport = (mimeType: string) => boolean;
type VideoExportModule = typeof videoExport & {
  selectRecorderMimeType?: (isTypeSupported?: MimeSupport) => string | undefined;
  getVideoExtension?: (mimeType?: string | null) => "mp4" | "webm";
};

const exportedVideo = videoExport as VideoExportModule;

const RECORDER_CANDIDATES = [
  "video/mp4;codecs=h264",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

interface RecorderConfig {
  supported: Set<string>;
  failRequests?: Set<string>;
  notSupportedRequests?: Set<string>;
  omitTypeSupport?: boolean;
  supportProbeError?: unknown;
  recorderMimeType?: string;
  recorderMimeTypeByRequest?: Record<string, string>;
  chunkMimeType?: string;
  chunkSize?: number;
  emitErrorOnStart?: unknown;
  emitStopOnStart?: boolean;
  startError?: unknown;
  startLeavesInactive?: boolean;
  stopError?: unknown;
  suppressStopEvent?: boolean;
}

let recorderConfig: RecorderConfig;
const recorderRequests: Array<string | undefined> = [];
const recorderInstances: MockMediaRecorder[] = [];
let startHandlerSnapshot: { data: boolean; stop: boolean; error: boolean } | undefined;
let autoRunAnimationFrames = true;
let nextAnimationFrameId = 1;
const pendingAnimationFrames = new Map<number, FrameRequestCallback>();

function createRecorderErrorEvent(error: unknown): Event {
  const event = new Event("error");
  Object.defineProperty(event, "error", { configurable: true, value: error });
  return event;
}

class MockMediaRecorder {
  static isTypeSupported(mimeType: string) {
    if (recorderConfig.supportProbeError) throw recorderConfig.supportProbeError;
    return recorderConfig.supported.has(mimeType);
  }

  readonly stream: MediaStream;
  readonly requestedMimeType: string | undefined;
  readonly mimeType: string;
  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private stopEventScheduled = false;
  startCalls = 0;
  stopCalls = 0;

  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    this.stream = stream;
    this.requestedMimeType = options?.mimeType;
    recorderRequests.push(this.requestedMimeType);
    if (this.requestedMimeType && recorderConfig.failRequests?.has(this.requestedMimeType)) {
      throw new Error(`unsupported constructor MIME: ${this.requestedMimeType}`);
    }
    if (this.requestedMimeType && recorderConfig.notSupportedRequests?.has(this.requestedMimeType)) {
      const error = new Error(`not supported constructor MIME: ${this.requestedMimeType}`);
      error.name = "NotSupportedError";
      throw error;
    }

    this.mimeType =
      (this.requestedMimeType && recorderConfig.recorderMimeTypeByRequest?.[this.requestedMimeType]) ??
      recorderConfig.recorderMimeType ??
      this.requestedMimeType ??
      "";
    recorderInstances.push(this);
  }

  start() {
    this.startCalls += 1;
    startHandlerSnapshot = {
      data: Boolean(this.ondataavailable),
      stop: Boolean(this.onstop),
      error: Boolean(this.onerror),
    };
    if (recorderConfig.startError) throw recorderConfig.startError;
    this.state = recorderConfig.startLeavesInactive ? "inactive" : "recording";
    if (recorderConfig.emitErrorOnStart) {
      queueMicrotask(() => this.onerror?.(createRecorderErrorEvent(recorderConfig.emitErrorOnStart)));
    }
    if (recorderConfig.emitStopOnStart) {
      this.state = "inactive";
      this.stopEventScheduled = true;
      queueMicrotask(() => this.onstop?.());
    }
  }

  stop() {
    this.stopCalls += 1;
    if (recorderConfig.stopError) throw recorderConfig.stopError;
    this.state = "inactive";
    if (this.stopEventScheduled || recorderConfig.suppressStopEvent) return;
    this.stopEventScheduled = true;
    queueMicrotask(() => {
      const data =
        recorderConfig.chunkSize === 0
          ? new Blob([], { type: recorderConfig.chunkMimeType ?? "" })
          : new Blob(["encoded video"], { type: recorderConfig.chunkMimeType ?? "" });
      this.ondataavailable?.({ data } as BlobEvent);
      this.onstop?.();
    });
  }
}

const originalPlaybackState = useCameraPlaybackStore.getState();

function createExportProject() {
  const project = createInitialDirectorState().project;
  const camera = project.cameras[0]!;
  camera.nodes = [
    {
      id: "node-start",
      position: [0, 2, 8],
      rotation: [0, 0, 0, 1],
      fov: 50,
      time: 0,
    },
    {
      id: "node-end",
      position: [0, 2, 6],
      rotation: [0, 0, 0, 1],
      fov: 50,
      time: 1,
    },
  ];
  camera.segments = [
    {
      id: "node-start:node-end",
      fromNodeId: "node-start",
      toNodeId: "node-end",
      curveMode: "linear",
      duration: 1,
      holdAfter: 0,
      easing: "linear",
    },
  ];
  return project;
}

interface PlaybackMockOptions {
  initialIsPlaying?: boolean;
  initialPlayheadTime?: number;
  autoComplete?: boolean;
  completeOnPlayCalls?: number[];
  completionPlayheadTime?: number;
}

function installPlaybackMock(options: PlaybackMockOptions = {}) {
  const pause = vi.fn(() => useCameraPlaybackStore.setState({ isPlaying: false }));
  const setPlayheadTime = vi.fn((time: number) => useCameraPlaybackStore.setState({ playheadTime: time }));
  let playCalls = 0;
  const play = vi.fn(() => {
    playCalls += 1;
    useCameraPlaybackStore.setState({ isPlaying: true });
    const completeOnPlayCalls = options.completeOnPlayCalls ?? [1];
    if (options.autoComplete !== false && completeOnPlayCalls.includes(playCalls)) {
      queueMicrotask(() => {
        setPlayheadTime(options.completionPlayheadTime ?? 1);
        pause();
      });
    }
  });

  useCameraPlaybackStore.setState({
    ...originalPlaybackState,
    isPlaying: options.initialIsPlaying ?? false,
    playheadTime: options.initialPlayheadTime ?? 0,
    pause,
    setPlayheadTime,
    play,
  });

  return { pause, setPlayheadTime, play };
}

function installCanvas() {
  const host = document.createElement("div");
  host.dataset.testid = "director-canvas";
  const canvas = document.createElement("canvas");
  const track = { stop: vi.fn() };
  const stream = {
    getTracks: () => [track],
  } as unknown as MediaStream;
  Object.defineProperty(canvas, "captureStream", {
    configurable: true,
    value: vi.fn(() => stream),
  });
  host.append(canvas);
  document.body.append(host);
  return { canvas, stream, track };
}

function installRecorder(config: RecorderConfig) {
  recorderConfig = config;
  recorderRequests.length = 0;
  recorderInstances.length = 0;
  startHandlerSnapshot = undefined;
  const recorderClass = config.omitTypeSupport ? class extends MockMediaRecorder {} : MockMediaRecorder;
  if (config.omitTypeSupport) {
    Object.defineProperty(recorderClass, "isTypeSupported", { configurable: true, value: undefined });
  }
  vi.stubGlobal("MediaRecorder", recorderClass);
}

async function flushMicrotasks(count = 8) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

function monitorStoreSubscriptions() {
  let activePlaybackSubscriptions = 0;
  let activeDirectorSubscriptions = 0;
  const originalPlaybackSubscribe = useCameraPlaybackStore.subscribe.bind(useCameraPlaybackStore);
  const originalDirectorSubscribe = useDirectorStore.subscribe.bind(useDirectorStore);

  vi.spyOn(useCameraPlaybackStore, "subscribe").mockImplementation(((listener: any) => {
    activePlaybackSubscriptions += 1;
    const unsubscribe = originalPlaybackSubscribe(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      activePlaybackSubscriptions -= 1;
      unsubscribe();
    };
  }) as typeof useCameraPlaybackStore.subscribe);
  vi.spyOn(useDirectorStore, "subscribe").mockImplementation(((listener: any) => {
    activeDirectorSubscriptions += 1;
    const unsubscribe = originalDirectorSubscribe(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      activeDirectorSubscriptions -= 1;
      unsubscribe();
    };
  }) as typeof useDirectorStore.subscribe);

  return () => ({ activePlaybackSubscriptions, activeDirectorSubscriptions });
}

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let clickedAnchor: HTMLAnchorElement | undefined;
let originalCreateObjectURL: PropertyDescriptor | undefined;
let originalRevokeObjectURL: PropertyDescriptor | undefined;

beforeEach(() => {
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...createInitialDirectorState(),
    project: createExportProject(),
    viewMode: "director",
  });
  installPlaybackMock();
  autoRunAnimationFrames = true;
  nextAnimationFrameId = 1;
  pendingAnimationFrames.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextAnimationFrameId++;
    pendingAnimationFrames.set(id, callback);
    if (autoRunAnimationFrames) {
      pendingAnimationFrames.delete(id);
      callback(0);
    }
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pendingAnimationFrames.delete(id));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });

  createObjectURL = vi.fn(() => "blob:camera-path");
  revokeObjectURL = vi.fn();
  originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
  clickedAnchor = undefined;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clickedAnchor = this;
  });
});

afterEach(() => {
  document.body.replaceChildren();
  useCameraPlaybackStore.setState(originalPlaybackState);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();

  if (originalCreateObjectURL) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL);
  } else {
    delete (URL as Partial<typeof URL>).createObjectURL;
  }
  if (originalRevokeObjectURL) {
    Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectURL);
  } else {
    delete (URL as Partial<typeof URL>).revokeObjectURL;
  }
});

describe("video recorder MIME helpers", () => {
  it("prefers MP4 candidates before WebM candidates", () => {
    expect(typeof exportedVideo.selectRecorderMimeType).toBe("function");

    const isTypeSupported = vi.fn((mimeType: string) => mimeType === RECORDER_CANDIDATES[0]);
    expect(exportedVideo.selectRecorderMimeType!(isTypeSupported)).toBe(RECORDER_CANDIDATES[0]);
    expect(isTypeSupported.mock.calls.map(([mimeType]) => mimeType)).toEqual([RECORDER_CANDIDATES[0]]);
  });

  it("falls back to the first supported WebM candidate and skips support errors", () => {
    expect(typeof exportedVideo.selectRecorderMimeType).toBe("function");

    const isTypeSupported = vi.fn((mimeType: string) => {
      if (mimeType.startsWith("video/mp4")) throw new Error("browser probe failed");
      return mimeType === "video/webm;codecs=vp8";
    });
    expect(exportedVideo.selectRecorderMimeType!(isTypeSupported)).toBe("video/webm;codecs=vp8");
  });

  it("returns undefined when no candidate is supported", () => {
    expect(typeof exportedVideo.selectRecorderMimeType).toBe("function");

    expect(exportedVideo.selectRecorderMimeType!(() => false)).toBeUndefined();
  });

  it("normalizes video MIME parameters and uses WebM as the stable fallback", () => {
    expect(typeof exportedVideo.getVideoExtension).toBe("function");

    expect(exportedVideo.getVideoExtension!(" VIDEO/MP4 ; codecs=h264 ")).toBe("mp4");
    expect(exportedVideo.getVideoExtension!("Video/WebM;codecs=vp9")).toBe("webm");
    expect(exportedVideo.getVideoExtension!("audio/mp4")).toBe("webm");
    expect(exportedVideo.getVideoExtension!("")).toBe("webm");
    expect(exportedVideo.getVideoExtension!(null)).toBe("webm");
  });
});

describe("exportCameraPathVideo browser negotiation", () => {
  it("constructs an MP4 recorder first when MP4 is supported", async () => {
    installCanvas();
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[0], RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/mp4",
    });

    const result = await videoExport.exportCameraPathVideo();

    expect(result.ok).toBe(true);
    expect(recorderRequests).toEqual([RECORDER_CANDIDATES[0]]);
  });

  it("uses WebM when no MP4 candidate is supported", async () => {
    installCanvas();
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
    });

    const result = await videoExport.exportCameraPathVideo();

    expect(result.ok).toBe(true);
    expect(recorderRequests).toEqual([RECORDER_CANDIDATES[2]]);
  });

  it("uses the default MediaRecorder constructor when no candidate is supported", async () => {
    installCanvas();
    installRecorder({ supported: new Set(), recorderMimeType: "video/webm" });

    const result = await videoExport.exportCameraPathVideo();

    expect(result.ok).toBe(true);
    expect(recorderRequests).toEqual([undefined]);
  });

  it("tries supported candidates serially after a supported constructor throws", async () => {
    installCanvas();
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[0], RECORDER_CANDIDATES[2]]),
      notSupportedRequests: new Set([RECORDER_CANDIDATES[0]]),
      recorderMimeType: "video/webm",
    });

    const result = await videoExport.exportCameraPathVideo();

    expect(result.ok).toBe(true);
    expect(recorderRequests).toEqual([RECORDER_CANDIDATES[0], RECORDER_CANDIDATES[2]]);
  });

  it("uses recorder.mimeType for the final Blob type and download extension", async () => {
    installCanvas();
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "VIDEO/MP4;codecs=h264",
      chunkMimeType: "video/webm",
    });
    let finalBlob: Blob | undefined;
    createObjectURL.mockImplementation((blob: Blob) => {
      finalBlob = blob;
      return "blob:camera-path";
    });

    const result = await videoExport.exportCameraPathVideo();
    vi.advanceTimersByTime(1000);

    expect(result.ok).toBe(true);
    expect(finalBlob?.type).toBe("video/mp4;codecs=h264");
    expect(clickedAnchor?.download).toBe("机位01-运镜参考.mp4");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:camera-path");
  });

  it("uses a non-empty chunk MIME when recorder.mimeType is empty", async () => {
    const { track } = installCanvas();
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "",
      chunkMimeType: "video/mp4;codecs=h264",
    });
    let finalBlob: Blob | undefined;
    createObjectURL.mockImplementation((blob: Blob) => {
      finalBlob = blob;
      return "blob:camera-path";
    });

    const result = await videoExport.exportCameraPathVideo();
    vi.advanceTimersByTime(1000);

    expect(result.ok).toBe(true);
    expect(finalBlob?.type).toBe("video/mp4;codecs=h264");
    expect(clickedAnchor?.download).toBe("机位01-运镜参考.mp4");
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:camera-path");
  });

  it("uses the negotiated MIME when recorder and chunks omit their types", async () => {
    const { track } = installCanvas();
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[0]]),
      recorderMimeType: "",
      chunkMimeType: "",
    });
    let finalBlob: Blob | undefined;
    createObjectURL.mockImplementation((blob: Blob) => {
      finalBlob = blob;
      return "blob:camera-path";
    });

    const result = await videoExport.exportCameraPathVideo();
    vi.advanceTimersByTime(1000);

    expect(result.ok).toBe(true);
    expect(finalBlob?.type).toBe("video/mp4;codecs=h264");
    expect(clickedAnchor?.download).toBe("机位01-运镜参考.mp4");
    expect(useDirectorStore.getState().viewMode).toBe("director");
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:camera-path");
  });
});

describe("exportCameraPathVideo lifecycle quality gates", () => {
  it("allows a pose-only camera object replacement when path references stay stable", async () => {
    installCanvas();
    installPlaybackMock({ autoComplete: false });
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
    });
    const exportPromise = videoExport.exportCameraPathVideo();

    await flushMicrotasks();
    const state = useDirectorStore.getState();
    const camera = state.project.cameras[0]!;
    const capturedNodes = camera.nodes;
    const capturedSegments = camera.segments;
    useDirectorStore.getState().applyPlaybackPose(camera.id, {
      position: [1, 2, 7],
      rotation: [0, 0, 0, 1],
      fov: camera.fov + 1,
    });
    const updatedCamera = useDirectorStore.getState().project.cameras[0]!;
    expect(updatedCamera).not.toBe(camera);
    expect(updatedCamera.nodes).toBe(capturedNodes);
    expect(updatedCamera.segments).toBe(capturedSegments);
    useCameraPlaybackStore.getState().setPlayheadTime(1);
    useCameraPlaybackStore.getState().pause();
    await flushMicrotasks();
    const result = await exportPromise;

    expect(result.ok).toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("fails on a user pause before the path reaches its total and restores state", async () => {
    const { track } = installCanvas();
    installPlaybackMock({ autoComplete: false, initialIsPlaying: false, initialPlayheadTime: 0.37 });
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
    });
    const exportPromise = videoExport.exportCameraPathVideo();

    await flushMicrotasks();
    useCameraPlaybackStore.getState().setPlayheadTime(0.25);
    useCameraPlaybackStore.getState().pause();
    await flushMicrotasks();
    const result = await exportPromise;

    expect(result.ok).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(useCameraPlaybackStore.getState().playheadTime).toBe(0.37);
    expect(useCameraPlaybackStore.getState().isPlaying).toBe(false);
  });

  it("installs data, stop, and error handlers before start and fails on async recorder error", async () => {
    const { track } = installCanvas();
    const recorderError = new Error("encoder failed");
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
      emitErrorOnStart: recorderError,
    });

    const result = await videoExport.exportCameraPathVideo();

    expect(result.ok).toBe(false);
    expect(startHandlerSnapshot).toEqual({ data: true, stop: true, error: true });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("fails when the recorder stops before playback completes without losing the early stop event", async () => {
    installCanvas();
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
      emitStopOnStart: true,
    });

    const exportPromise = videoExport.exportCameraPathVideo();
    await flushMicrotasks();
    recorderInstances[0]?.onstop?.();
    const result = await exportPromise;

    expect(result.ok).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("times out a playback that never ends and removes both store subscriptions", async () => {
    const { track } = installCanvas();
    installPlaybackMock({ autoComplete: false });
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
    });
    const getSubscriptionCounts = monitorStoreSubscriptions();
    const exportPromise = videoExport.exportCameraPathVideo();

    await flushMicrotasks();
    vi.advanceTimersByTime(20_000);
    useCameraPlaybackStore.setState({ isPlaying: false });
    await flushMicrotasks();
    const result = await exportPromise;

    expect(result.ok).toBe(false);
    expect(getSubscriptionCounts()).toEqual({ activePlaybackSubscriptions: 0, activeDirectorSubscriptions: 0 });
    expect(track.stop).toHaveBeenCalledTimes(1);
    vi.runOnlyPendingTimers();
  });

  it("aborts when the active camera changes during playback and cleans subscriptions", async () => {
    installCanvas();
    installPlaybackMock({ autoComplete: false });
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
    });
    const getSubscriptionCounts = monitorStoreSubscriptions();
    const exportPromise = videoExport.exportCameraPathVideo();

    await flushMicrotasks();
    const state = useDirectorStore.getState();
    useDirectorStore.setState({
      ...state,
      project: { ...state.project, activeCameraId: "camera-switched" },
    });
    await flushMicrotasks();
    useCameraPlaybackStore.setState({ isPlaying: false });
    await flushMicrotasks();
    const result = await exportPromise;

    expect(result.ok).toBe(false);
    expect(getSubscriptionCounts()).toEqual({ activePlaybackSubscriptions: 0, activeDirectorSubscriptions: 0 });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("aborts when the original camera path object is replaced", async () => {
    installCanvas();
    installPlaybackMock({ autoComplete: false });
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
    });
    const exportPromise = videoExport.exportCameraPathVideo();

    await flushMicrotasks();
    const state = useDirectorStore.getState();
    const camera = state.project.cameras[0]!;
    useDirectorStore.setState({
      ...state,
      project: {
        ...state.project,
        cameras: [{ ...camera, nodes: [...(camera.nodes ?? [])] }],
      },
    });
    useCameraPlaybackStore.setState({ isPlaying: false });
    await flushMicrotasks();
    const result = await exportPromise;

    expect(result.ok).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();

    useCameraPlaybackStore.setState({ isPlaying: false });
  });

  it("aborts when the original camera is deleted", async () => {
    installCanvas();
    installPlaybackMock({ autoComplete: false });
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
    });
    const exportPromise = videoExport.exportCameraPathVideo();

    await flushMicrotasks();
    const state = useDirectorStore.getState();
    useDirectorStore.setState({
      ...state,
      project: { ...state.project, cameras: [], activeCameraId: null },
    });
    useCameraPlaybackStore.setState({ isPlaying: false });
    await flushMicrotasks();
    const result = await exportPromise;

    expect(result.ok).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("fails and cleans up when warmup rAF never fires", async () => {
    const { track } = installCanvas();
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
    });
    autoRunAnimationFrames = false;
    const exportPromise = videoExport.exportCameraPathVideo();

    await flushMicrotasks();
    vi.advanceTimersByTime(20_000);
    await flushMicrotasks();
    for (let index = 0; index < 8; index += 1) {
      const callbacks = [...pendingAnimationFrames.values()];
      pendingAnimationFrames.clear();
      callbacks.forEach((callback) => callback(0));
    }
    const result = await exportPromise;

    expect(result.ok).toBe(false);
    expect(recorderInstances[0]?.startCalls).toBe(0);
    expect(pendingAnimationFrames.size).toBe(0);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(useDirectorStore.getState().viewMode).toBe("director");
  });

  it("aborts and cleans up when the path becomes invalid during warmup", async () => {
    const { track } = installCanvas();
    installPlaybackMock({ autoComplete: false });
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
    });
    autoRunAnimationFrames = false;
    const exportPromise = videoExport.exportCameraPathVideo();

    await flushMicrotasks();
    const state = useDirectorStore.getState();
    const camera = state.project.cameras[0]!;
    useDirectorStore.setState({
      ...state,
      project: {
        ...state.project,
        cameras: [{ ...camera, nodes: [...(camera.nodes ?? [])] }],
      },
    });
    await flushMicrotasks();
    for (let index = 0; index < 8; index += 1) {
      const callbacks = [...pendingAnimationFrames.values()];
      pendingAnimationFrames.clear();
      callbacks.forEach((callback) => callback(0));
    }
    const result = await exportPromise;

    expect(result.ok).toBe(false);
    expect(pendingAnimationFrames.size).toBe(0);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("aborts and cleans up when stop produces no terminal event", async () => {
    const { track } = installCanvas();
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
      suppressStopEvent: true,
    });
    const exportPromise = videoExport.exportCameraPathVideo();

    await flushMicrotasks();
    const legacyOnStop = recorderInstances[0]?.onstop;
    vi.advanceTimersByTime(20_000);
    legacyOnStop?.();
    await flushMicrotasks();
    const result = await exportPromise;

    expect(result.ok).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("uses a fixed recorder stop timeout even when the path total is long", async () => {
    const { track } = installCanvas();
    const state = useDirectorStore.getState();
    const camera = state.project.cameras[0]!;
    const longSegments = (camera.segments ?? []).map((segment) => ({ ...segment, duration: 120 }));
    useDirectorStore.setState({
      ...state,
      project: {
        ...state.project,
        cameras: [{ ...camera, segments: longSegments }],
      },
    });
    installPlaybackMock({ completionPlayheadTime: 120 });
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
      suppressStopEvent: true,
    });
    const exportPromise = videoExport.exportCameraPathVideo();

    await flushMicrotasks();
    const legacyOnData = recorderInstances[0]?.ondataavailable;
    const legacyOnStop = recorderInstances[0]?.onstop;
    vi.advanceTimersByTime(6_000);
    legacyOnData?.({ data: new Blob(["encoded video"], { type: "video/webm" }) } as BlobEvent);
    legacyOnStop?.();
    await flushMicrotasks();
    const result = await exportPromise;

    expect(result.ok).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("does not download an empty final Blob", async () => {
    const { track } = installCanvas();
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
      chunkSize: 0,
    });

    const result = await videoExport.exportCameraPathVideo();

    expect(result.ok).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clickedAnchor).toBeUndefined();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("does not fallback after a non-NotSupported constructor error", async () => {
    installCanvas();
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      failRequests: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
    });

    const result = await videoExport.exportCameraPathVideo().catch(() => null);

    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    expect(recorderRequests).toEqual([RECORDER_CANDIDATES[2]]);
  });

  it.each([
    { label: "missing", config: { omitTypeSupport: true } },
    { label: "throwing", config: { supportProbeError: new Error("probe unavailable") } },
  ])("uses default construction when isTypeSupported is $label", async ({ config }) => {
    installCanvas();
    installRecorder({
      supported: new Set(),
      recorderMimeType: "video/webm",
      ...config,
    });

    const result = await videoExport.exportCameraPathVideo().catch(() => null);

    expect(result?.ok).toBe(true);
    expect(recorderRequests).toEqual([undefined]);
  });

  it("restores the original playing playback state and playhead after export", async () => {
    installCanvas();
    installPlaybackMock({ initialIsPlaying: true, initialPlayheadTime: 0.42, completeOnPlayCalls: [1] });
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
    });

    const result = await videoExport.exportCameraPathVideo();

    expect(result.ok).toBe(true);
    expect(useCameraPlaybackStore.getState().playheadTime).toBe(0.42);
    expect(useCameraPlaybackStore.getState().isPlaying).toBe(true);
  });

  it("restores the original paused playback state and playhead after export", async () => {
    installCanvas();
    installPlaybackMock({ initialIsPlaying: false, initialPlayheadTime: 0.37 });
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
    });

    const result = await videoExport.exportCameraPathVideo();

    expect(result.ok).toBe(true);
    expect(useCameraPlaybackStore.getState().playheadTime).toBe(0.37);
    expect(useCameraPlaybackStore.getState().isPlaying).toBe(false);
  });

  it("keeps all terminal handlers installed when start throws and still cleans up", async () => {
    const { track } = installCanvas();
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
      startError: new Error("start failed"),
    });

    const result = await videoExport.exportCameraPathVideo();

    expect(result.ok).toBe(false);
    expect(startHandlerSnapshot).toEqual({ data: true, stop: true, error: true });
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("returns a friendly failure and cleans up when stop throws", async () => {
    const { track } = installCanvas();
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
      stopError: new Error("stop failed"),
    });

    const result = await videoExport.exportCameraPathVideo();

    expect(result.ok).toBe(false);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("reclaims the Blob URL when anchor.click throws", async () => {
    installCanvas();
    installRecorder({
      supported: new Set([RECORDER_CANDIDATES[2]]),
      recorderMimeType: "video/webm",
    });
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => {
      throw new Error("download click failed");
    });

    const result = await videoExport.exportCameraPathVideo();
    vi.advanceTimersByTime(1000);

    expect(result.ok).toBe(false);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:camera-path");
  });
});
