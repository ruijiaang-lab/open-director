import { getCameraPathDuration } from "../camera/cameraPath";
import { useCameraPlaybackStore } from "../store/cameraPlaybackStore";
import { useDirectorStore } from "../store/directorStore";
import type { CameraNode, CameraSegment, DirectorCameraShot } from "../schema/directorProject";

export interface VideoExportResult {
  ok: boolean;
  message: string;
}

const RECORDER_MIME_CANDIDATES = [
  "video/mp4;codecs=h264",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

type IsTypeSupported = (mimeType: string) => boolean;

type RecorderTerminal =
  | { kind: "stopped" }
  | { kind: "error"; error: unknown };

type PlaybackWaitResult =
  | { kind: "completed" }
  | { kind: "recorder"; terminal: RecorderTerminal }
  | { kind: "inactive" }
  | { kind: "aborted" }
  | { kind: "timeout" }
  | { kind: "cancelled" };

const PLAYBACK_POLL_INTERVAL_MS = 50;
const PLAYBACK_GRACE_SECONDS = 5;
const MIN_PLAYBACK_WAIT_MS = 10_000;
const WARMUP_FRAME_COUNT = 4;
const WARMUP_TIMEOUT_MS = 5_000;
const RECORDER_STOP_TIMEOUT_MS = 5_000;
const PLAYHEAD_COMPLETION_EPSILON_SECONDS = 0.05;

function getSupportedRecorderMimeTypes(isTypeSupported?: IsTypeSupported): string[] {
  const supports =
    isTypeSupported ??
    ((mimeType: string) =>
      typeof MediaRecorder !== "undefined" &&
      typeof MediaRecorder.isTypeSupported === "function" &&
      MediaRecorder.isTypeSupported(mimeType));

  return RECORDER_MIME_CANDIDATES.filter((mimeType) => {
    try {
      return supports(mimeType);
    } catch {
      return false;
    }
  });
}

/** 以浏览器实际能力为准，优先选择 MP4，再回退到 WebM。 */
export function selectRecorderMimeType(isTypeSupported?: IsTypeSupported): string | undefined {
  const supports =
    isTypeSupported ??
    ((mimeType: string) =>
      typeof MediaRecorder !== "undefined" &&
      typeof MediaRecorder.isTypeSupported === "function" &&
      MediaRecorder.isTypeSupported(mimeType));

  for (const mimeType of RECORDER_MIME_CANDIDATES) {
    try {
      if (supports(mimeType)) return mimeType;
    } catch {
      // 某些浏览器对单个 MIME 探测会抛错，继续尝试下一个候选。
    }
  }

  return undefined;
}

function normalizeVideoMimeType(mimeType: unknown): string | undefined {
  if (typeof mimeType !== "string") return undefined;

  const parts = mimeType
    .trim()
    .toLowerCase()
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const baseType = parts[0];
  if (baseType !== "video/mp4" && baseType !== "video/webm") return undefined;

  return [baseType, ...parts.slice(1)].join(";");
}

/** 根据实际视频 MIME 选择稳定扩展名；未知值统一回退 WebM。 */
export function getVideoExtension(mimeType?: string | null): "mp4" | "webm" {
  return normalizeVideoMimeType(mimeType)?.startsWith("video/mp4") ? "mp4" : "webm";
}

function isNotSupportedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "NotSupportedError"
  );
}

function getRecorderTypeSupport(): IsTypeSupported | undefined {
  try {
    const support = MediaRecorder.isTypeSupported;
    if (typeof support !== "function") return undefined;
    return (mimeType) => support.call(MediaRecorder, mimeType);
  } catch {
    return undefined;
  }
}

function getRecorderWithNegotiation(
  stream: MediaStream,
  isTypeSupported?: IsTypeSupported
): { recorder: MediaRecorder; negotiatedMimeType?: string } {
  const supportedMimeTypes = getSupportedRecorderMimeTypes(isTypeSupported);

  // MediaRecorder 构造必须串行进行：部分浏览器会在 isTypeSupported 返回 true 后仍拒绝具体 MIME。
  for (const mimeType of supportedMimeTypes) {
    try {
      return {
        recorder: new MediaRecorder(stream, { mimeType }),
        negotiatedMimeType: mimeType,
      };
    } catch (error) {
      if (!isNotSupportedError(error)) throw error;
    }
  }

  return { recorder: new MediaRecorder(stream) };
}

function getFinalVideoMimeType(
  recorderMimeType: string,
  chunks: Blob[],
  negotiatedMimeType?: string
): string {
  const actualRecorderMimeType = normalizeVideoMimeType(recorderMimeType);
  if (actualRecorderMimeType) return actualRecorderMimeType;

  for (const chunk of chunks) {
    const actualChunkMimeType = normalizeVideoMimeType(chunk.type);
    if (actualChunkMimeType) return actualChunkMimeType;
  }

  return normalizeVideoMimeType(negotiatedMimeType) ?? "video/webm";
}

function getPlaybackWaitTimeoutMs(total: number): number {
  const duration = Number.isFinite(total) && total > 0 ? total : 0;
  return Math.max(MIN_PLAYBACK_WAIT_MS, Math.ceil((duration + PLAYBACK_GRACE_SECONDS) * 1000));
}

function hasReachedPlaybackEnd(playheadTime: number, total: number): boolean {
  if (!Number.isFinite(playheadTime) || !Number.isFinite(total)) return false;
  const epsilon = Math.min(PLAYHEAD_COMPLETION_EPSILON_SECONDS, Math.max(0.01, total * 0.01));
  return playheadTime >= total - epsilon;
}

function attachRecorderHandlers(recorder: MediaRecorder, chunks: Blob[]) {
  let terminal: RecorderTerminal | undefined;
  let settled = false;
  let resolveTerminal!: (value: RecorderTerminal) => void;
  const terminalPromise = new Promise<RecorderTerminal>((resolve) => {
    resolveTerminal = resolve;
  });

  const settle = (next: RecorderTerminal) => {
    if (settled) return;
    settled = true;
    terminal = next;
    resolveTerminal(next);
  };
  const ondataavailable = (event: BlobEvent) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  const onstop = () => settle({ kind: "stopped" });
  const onerror = (event: Event) => {
    const error = "error" in event ? (event as ErrorEvent).error : event;
    settle({ kind: "error", error });
  };

  // These must be assigned before start(): browsers may terminate immediately.
  recorder.ondataavailable = ondataavailable;
  recorder.onstop = onstop;
  recorder.onerror = onerror;

  return {
    terminal: terminalPromise,
    getTerminal: () => terminal,
    cleanup: () => {
      if (recorder.ondataavailable === ondataavailable) recorder.ondataavailable = null;
      if (recorder.onstop === onstop) recorder.onstop = null;
      if (recorder.onerror === onerror) recorder.onerror = null;
    },
  };
}

function isCameraPathStillValid(
  state: ReturnType<typeof useDirectorStore.getState>,
  camera: DirectorCameraShot,
  nodes: CameraNode[],
  segments: CameraSegment[] | undefined
): boolean {
  if (state.project.activeCameraId !== camera.id) return false;

  const currentCamera = state.project.cameras.find((item) => item.id === camera.id);
  if (!currentCamera) return false;
  if (currentCamera.nodes !== nodes || currentCamera.segments !== segments) return false;

  const currentNodes = currentCamera.nodes ?? [];
  if (currentNodes.length < 2) return false;

  try {
    const duration = getCameraPathDuration(currentNodes, currentCamera.segments ?? []);
    return Number.isFinite(duration) && duration >= 0.1;
  } catch {
    return false;
  }
}

function createPlaybackWait(
  total: number,
  camera: DirectorCameraShot,
  nodes: CameraNode[],
  segments: CameraSegment[] | undefined,
  recorder: MediaRecorder,
  recorderLifecycle: ReturnType<typeof attachRecorderHandlers>
): { promise: Promise<PlaybackWaitResult>; cancel: () => void } {
  let settled = false;
  let resolveWait!: (value: PlaybackWaitResult) => void;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let pollId: ReturnType<typeof setInterval> | undefined;
  let unsubscribePlayback: (() => void) | undefined;
  let unsubscribeDirector: (() => void) | undefined;
  const promise = new Promise<PlaybackWaitResult>((resolve) => {
    resolveWait = resolve;
  });

  const cleanup = () => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (pollId !== undefined) clearInterval(pollId);
    unsubscribePlayback?.();
    unsubscribeDirector?.();
    timeoutId = undefined;
    pollId = undefined;
    unsubscribePlayback = undefined;
    unsubscribeDirector = undefined;
  };
  const settle = (result: PlaybackWaitResult) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveWait(result);
  };
  const checkExternalState = () => {
    try {
      if (!isCameraPathStillValid(useDirectorStore.getState(), camera, nodes, segments)) {
        settle({ kind: "aborted" });
        return;
      }
      const terminal = recorderLifecycle.getTerminal();
      if (terminal) {
        settle({ kind: "recorder", terminal });
        return;
      }
      if (recorder.state === "inactive") settle({ kind: "inactive" });
    } catch {
      settle({ kind: "aborted" });
    }
  };

  try {
    unsubscribePlayback = useCameraPlaybackStore.subscribe((state) => {
      if (!state.isPlaying) {
        settle(
          hasReachedPlaybackEnd(state.playheadTime, total) ? { kind: "completed" } : { kind: "aborted" }
        );
      }
    });
    unsubscribeDirector = useDirectorStore.subscribe(() => checkExternalState());
    recorderLifecycle.terminal.then((terminal) => settle({ kind: "recorder", terminal }));
    pollId = setInterval(checkExternalState, PLAYBACK_POLL_INTERVAL_MS);
    timeoutId = setTimeout(() => settle({ kind: "timeout" }), getPlaybackWaitTimeoutMs(total));
    checkExternalState();
    const initialPlaybackState = useCameraPlaybackStore.getState();
    if (!settled && !initialPlaybackState.isPlaying) {
      settle(
        hasReachedPlaybackEnd(initialPlaybackState.playheadTime, total) ? { kind: "completed" } : { kind: "aborted" }
      );
    }
  } catch {
    settle({ kind: "aborted" });
  }

  return {
    promise,
    cancel: () => settle({ kind: "cancelled" }),
  };
}

function createWarmupWait(
  count: number,
  camera: DirectorCameraShot,
  nodes: CameraNode[],
  segments: CameraSegment[] | undefined
): { promise: Promise<void>; cancel: () => void } {
  let settled = false;
  let resolveWait!: () => void;
  let rejectWait!: (error: unknown) => void;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let animationFrameId: number | undefined;
  let unsubscribeDirector: (() => void) | undefined;
  let completedFrames = 0;
  const promise = new Promise<void>((resolve, reject) => {
    resolveWait = resolve;
    rejectWait = reject;
  });

  const cleanup = () => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (animationFrameId !== undefined && typeof cancelAnimationFrame === "function") {
      try {
        cancelAnimationFrame(animationFrameId);
      } catch {
        // Cleanup must still settle if a host provides a throwing cancellation API.
      }
    }
    try {
      unsubscribeDirector?.();
    } catch {
      // A stale store subscription must not keep the export promise pending.
    }
    timeoutId = undefined;
    animationFrameId = undefined;
    unsubscribeDirector = undefined;
  };
  const settle = (error?: unknown) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (error === undefined) resolveWait();
    else rejectWait(error);
  };
  const fail = (message: string) => settle(new Error(message));
  const checkPath = () => {
    try {
      return isCameraPathStillValid(useDirectorStore.getState(), camera, nodes, segments);
    } catch {
      return false;
    }
  };
  const onDirectorChange = () => {
    if (!checkPath()) fail("导出期间机位路径已失效");
  };
  const scheduleFrame = () => {
    if (settled) return;

    let requestedFrameId: number | undefined;
    try {
      if (typeof requestAnimationFrame !== "function") {
        fail("当前页面无法渲染导出预热帧");
        return;
      }
      requestedFrameId = requestAnimationFrame(() => {
        if (requestedFrameId !== undefined && animationFrameId === requestedFrameId) {
          animationFrameId = undefined;
        }
        try {
          if (!checkPath()) {
            fail("导出期间机位路径已失效");
            return;
          }
          completedFrames += 1;
          if (completedFrames >= count) {
            settle();
            return;
          }
          scheduleFrame();
        } catch {
          fail("导出预热失败");
        }
      });
      if (!settled) animationFrameId = requestedFrameId;
    } catch {
      fail("当前页面无法渲染导出预热帧");
    }
  };

  try {
    unsubscribeDirector = useDirectorStore.subscribe(onDirectorChange);
    timeoutId = setTimeout(() => fail("导出预热超时"), WARMUP_TIMEOUT_MS);
    if (count <= 0) settle();
    else if (!checkPath()) fail("导出期间机位路径已失效");
    else scheduleFrame();
  } catch {
    fail("导出预热失败");
  }

  return {
    promise,
    cancel: () => fail("导出预热已取消"),
  };
}

function waitForRecorderTerminal(
  recorderLifecycle: ReturnType<typeof attachRecorderHandlers>
): Promise<RecorderTerminal | "timeout"> {
  const existing = recorderLifecycle.getTerminal();
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve("timeout");
    }, RECORDER_STOP_TIMEOUT_MS);
    recorderLifecycle.terminal.then((terminal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(terminal);
    });
  });
}

function scheduleObjectUrlRevoke(url: string) {
  try {
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // URL cleanup must not create an unhandled asynchronous error.
      }
    }, 1000);
  } catch {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Best-effort cleanup when timer scheduling is unavailable.
    }
  }
}

/**
 * 运镜参考视频导出：真实时间播放一遍机位路径，用 canvas.captureStream + MediaRecorder 录制。
 * 原生浏览器 API 零依赖；Chrome 产出 webm，Safari 产出 mp4，均可在本地播放。
 */
export async function exportCameraPathVideo(): Promise<VideoExportResult> {
  const { project, viewMode } = useDirectorStore.getState();
  const camera = project.cameras.find((item) => item.id === project.activeCameraId);
  const nodes = camera?.nodes ?? [];
  const segments = camera?.segments;
  if (!camera || nodes.length < 2) {
    return { ok: false, message: "当前机位至少需要 2 个运镜节点" };
  }

  let total: number;
  try {
    total = getCameraPathDuration(nodes, camera.segments ?? []);
  } catch {
    return { ok: false, message: "运镜总时长过短，无法导出" };
  }
  if (!Number.isFinite(total) || total < 0.1) {
    return { ok: false, message: "运镜总时长过短，无法导出" };
  }

  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="director-canvas"] canvas');
  if (!canvas || typeof canvas.captureStream !== "function" || typeof MediaRecorder === "undefined") {
    return { ok: false, message: "当前浏览器不支持视频导出（需要 Canvas 录制能力）" };
  }

  const playback = useCameraPlaybackStore.getState();
  const originalPlayheadTime = playback.playheadTime;
  const originalIsPlaying = playback.isPlaying;
  const chunks: Blob[] = [];
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let negotiatedMimeType: string | undefined;
  let recorderLifecycle: ReturnType<typeof attachRecorderHandlers> | undefined;
  let cancelPlaybackWait = () => {};
  let cancelWarmupWait = () => {};
  let stopRequested = false;

  try {
    stream = canvas.captureStream(30);
    const isTypeSupported = getRecorderTypeSupport() ?? (() => false);
    const createdRecorder = getRecorderWithNegotiation(stream, isTypeSupported);
    recorder = createdRecorder.recorder;
    negotiatedMimeType = createdRecorder.negotiatedMimeType;
    const activeRecorder = createdRecorder.recorder;
    recorderLifecycle = attachRecorderHandlers(activeRecorder, chunks);

    // 固定取景：导出期间切到机位视角，播放头回零后先渲染两帧再开录
    useDirectorStore.getState().setViewMode("camera");
    playback.pause();
    playback.setPlayheadTime(0);
    const warmupWait = createWarmupWait(WARMUP_FRAME_COUNT, camera, nodes, segments);
    cancelWarmupWait = warmupWait.cancel;
    await warmupWait.promise;
    cancelWarmupWait = () => {};

    activeRecorder.start();
    if ((activeRecorder.state as RecordingState) === "inactive") throw new Error("录制器启动后已停止");
    playback.play();

    const playbackWait = createPlaybackWait(total, camera, nodes, segments, activeRecorder, recorderLifecycle);
    cancelPlaybackWait = playbackWait.cancel;
    const playbackResult = await playbackWait.promise;
    if (playbackResult.kind !== "completed") throw new Error("运镜录制未正常完成");

    if (recorderLifecycle.getTerminal()) throw new Error("录制器已提前结束");
    if (activeRecorder.state === "inactive") throw new Error("录制器已提前停止");

    stopRequested = true;
    activeRecorder.stop();
    const terminal = await waitForRecorderTerminal(recorderLifecycle);
    if (terminal === "timeout" || terminal.kind !== "stopped") throw new Error("录制器停止超时");

    const finalMimeType = getFinalVideoMimeType(activeRecorder.mimeType, chunks, negotiatedMimeType);
    const blob = new Blob(chunks, { type: finalMimeType });
    if (blob.size === 0) throw new Error("导出视频为空");
    const extension = getVideoExtension(
      normalizeVideoMimeType(blob.type) ??
        normalizeVideoMimeType(activeRecorder.mimeType) ??
        normalizeVideoMimeType(negotiatedMimeType)
    );
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${camera.name}-运镜参考.${extension}`;
      anchor.click();
    } finally {
      scheduleObjectUrlRevoke(url);
    }

    return { ok: true, message: `已导出 ${total.toFixed(1)} 秒运镜参考` };
  } catch {
    return { ok: false, message: "视频导出失败，请重试" };
  } finally {
    cancelWarmupWait();
    cancelPlaybackWait();
    if (recorder && !stopRequested && recorder.state !== "inactive") {
      stopRequested = true;
      try {
        recorder.stop();
      } catch {
        // 录制器可能已停止
      }
    }
    recorderLifecycle?.cleanup();
    try {
      stream?.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Continue stopping the remaining tracks.
        }
      });
    } catch {
      // Keep restoring editor state even if a platform track throws on stop.
    }
    try {
      if (useDirectorStore.getState().viewMode !== viewMode) {
        useDirectorStore.getState().setViewMode(viewMode);
      }
    } catch {
      // State restoration is best effort and must not mask the export result.
    }
    try {
      playback.setPlayheadTime(originalPlayheadTime);
    } catch {
      // State restoration is best effort and must not mask the export result.
    }
    try {
      if (originalIsPlaying) playback.play();
      else playback.pause();
    } catch {
      // State restoration is best effort and must not mask the export result.
    }
  }
}
