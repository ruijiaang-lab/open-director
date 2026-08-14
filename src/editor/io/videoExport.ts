import { getCameraPathDuration } from "../camera/cameraPath";
import { useCameraPlaybackStore } from "../store/cameraPlaybackStore";
import { useDirectorStore } from "../store/directorStore";

export interface VideoExportResult {
  ok: boolean;
  message: string;
}

/**
 * 运镜参考视频导出：真实时间播放一遍机位路径，用 canvas.captureStream + MediaRecorder 录制。
 * 原生浏览器 API 零依赖；Chrome 产出 webm，Safari 产出 mp4，均可在本地播放。
 */
export async function exportCameraPathVideo(): Promise<VideoExportResult> {
  const { project, viewMode } = useDirectorStore.getState();
  const camera = project.cameras.find((item) => item.id === project.activeCameraId);
  const nodes = camera?.nodes ?? [];
  if (!camera || nodes.length < 2) {
    return { ok: false, message: "当前机位至少需要 2 个运镜节点" };
  }

  const total = getCameraPathDuration(nodes, camera.segments ?? []);
  if (total < 0.1) {
    return { ok: false, message: "运镜总时长过短，无法导出" };
  }

  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="director-canvas"] canvas');
  if (!canvas || typeof canvas.captureStream !== "function" || typeof MediaRecorder === "undefined") {
    return { ok: false, message: "当前浏览器不支持视频导出（需要 Canvas 录制能力）" };
  }

  const playback = useCameraPlaybackStore.getState();
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) =>
    MediaRecorder.isTypeSupported(type)
  );
  const extension = mimeType && mimeType.includes("mp4") ? "mp4" : "webm";
  const chunks: BlobPart[] = [];
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

  const waitFrames = (count: number) =>
    new Promise<void>((resolve) => {
      let remaining = count;
      const tick = () => {
        remaining -= 1;
        if (remaining <= 0) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  try {
    // 固定取景：导出期间切到机位视角，播放头回零后先渲染两帧再开录
    useDirectorStore.getState().setViewMode("camera");
    playback.pause();
    playback.setPlayheadTime(0);
    await waitFrames(4);

    recorder.start();
    playback.play();

    await new Promise<void>((resolve) => {
      const unsubscribe = useCameraPlaybackStore.subscribe((state) => {
        if (!state.isPlaying) {
          unsubscribe();
          resolve();
        }
      });
    });

    const blob = await new Promise<Blob>((resolve) => {
      // dataavailable 在 stop() 之后异步触发，必须在 onstop 里收尾，否则拿到 0 字节文件
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType ?? "video/webm" }));
      recorder.stop();
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${camera.name}-运镜参考.${extension}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return { ok: true, message: `已导出 ${total.toFixed(1)} 秒运镜参考` };
  } catch {
    return { ok: false, message: "视频导出失败，请重试" };
  } finally {
    if (recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // 录制器可能已停止
      }
    }
    stream.getTracks().forEach((track) => track.stop());
    if (viewMode !== "camera") {
      useDirectorStore.getState().setViewMode("director");
    }
  }
}
