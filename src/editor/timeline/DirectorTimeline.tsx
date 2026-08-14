import { Minus, Pause, Play, Plus, Square, Trash2, Video } from "lucide-react";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { buildCameraSegments, getCameraPathDuration, getNodeStartTimes } from "../camera/cameraPath";
import type { CameraSegmentEasing } from "../schema/directorProject";
import { useCameraPlaybackStore } from "../store/cameraPlaybackStore";
import { useDirectorStore } from "../store/directorStore";
import { exportCameraPathVideo } from "../io/videoExport";

const RULER_HEIGHT = 22;
const TRACK_TOP = RULER_HEIGHT + 8;
const TRACK_HEIGHT = 34;
const TRACK_GUTTER_WIDTH = 96;
const TICK_STEPS = [0.25, 0.5, 1, 2, 5, 10, 20];
const EASING_OPTIONS: Array<{ value: CameraSegmentEasing; label: string }> = [
  { value: "linear", label: "匀速" },
  { value: "ease-in", label: "缓入" },
  { value: "ease-out", label: "缓出" },
  { value: "ease-in-out", label: "缓入缓出" },
];

function formatTime(seconds: number) {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
}

function getRulerTickStep(zoom: number) {
  return TICK_STEPS.find((step) => step * zoom >= 70) ?? TICK_STEPS[TICK_STEPS.length - 1];
}

/**
 * 底部时间轴：只负责 WHEN（播放/scrub/节点时间/段时长/停顿/缓动/曲线切换），
 * 空间位置由 3D 视口的路径节点编辑负责。
 */
export function DirectorTimeline() {
  const activeCameraId = useDirectorStore((state) => state.project.activeCameraId);
  const cameras = useDirectorStore((state) => state.project.cameras);
  const camera = cameras.find((item) => item.id === activeCameraId) ?? cameras[0] ?? null;
  const nodes = camera?.nodes ?? [];
  const segments = useMemo(() => buildCameraSegments(nodes, camera?.segments), [camera?.segments, nodes]);
  const total = getCameraPathDuration(nodes, segments);
  const startTimes = getNodeStartTimes(nodes, segments);

  const isPlaying = useCameraPlaybackStore((state) => state.isPlaying);
  const playheadTime = useCameraPlaybackStore((state) => state.playheadTime);
  const zoom = useCameraPlaybackStore((state) => state.timelineZoom);
  const selectedNode = useCameraPlaybackStore((state) => state.selectedNode);
  const selectedSegment = useCameraPlaybackStore((state) => state.selectedSegment);
  const selectedHandle = useCameraPlaybackStore((state) => state.selectedHandle);
  const play = useCameraPlaybackStore((state) => state.play);
  const pause = useCameraPlaybackStore((state) => state.pause);
  const stop = useCameraPlaybackStore((state) => state.stop);
  const setPlayheadTime = useCameraPlaybackStore((state) => state.setPlayheadTime);
  const setTimelineZoom = useCameraPlaybackStore((state) => state.setTimelineZoom);
  const selectNode = useCameraPlaybackStore((state) => state.selectNode);
  const selectSegment = useCameraPlaybackStore((state) => state.selectSegment);
  const selectHandle = useCameraPlaybackStore((state) => state.selectHandle);
  const clearSelection = useCameraPlaybackStore((state) => state.clearSelection);
  const addCameraNode = useDirectorStore((state) => state.addCameraNode);
  const deleteCameraNode = useDirectorStore((state) => state.deleteCameraNode);
  const updateCameraNodeTime = useDirectorStore((state) => state.updateCameraNodeTime);
  const updateCameraSegment = useDirectorStore((state) => state.updateCameraSegment);
  const setSegmentCurveMode = useDirectorStore((state) => state.setSegmentCurveMode);
  const beginUndoBatch = useDirectorStore((state) => state.beginUndoBatch);
  const endUndoBatch = useDirectorStore((state) => state.endUndoBatch);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ kind: "playhead" | "node"; nodeId?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const contentWidth = Math.max(total * zoom + 320, 480);

  function timeFromPointer(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(Math.max((clientX - rect.left - TRACK_GUTTER_WIDTH) / zoom, 0), total);
  }

  function beginTrackDrag(event: ReactPointerEvent, kind: "playhead" | "node", nodeId?: string) {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = { kind, nodeId };
    if (kind === "node" && nodeId && camera) {
      beginUndoBatch();
    }
  }

  function moveTrackDrag(event: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === "playhead") {
      pause();
      setPlayheadTime(timeFromPointer(event.clientX));
      return;
    }
    if (drag.kind === "node" && drag.nodeId && camera) {
      updateCameraNodeTime(camera.id, drag.nodeId, timeFromPointer(event.clientX));
    }
  }

  function endTrackDrag() {
    if (dragRef.current?.kind === "node") {
      endUndoBatch();
    }
    dragRef.current = null;
  }

  const selectedNodeIndex = selectedNode && camera ? nodes.findIndex((node) => node.id === selectedNode.nodeId) : -1;
  const selectedSegmentData =
    selectedSegment && camera ? segments.find((segment) => segment.id === selectedSegment.segmentId) : null;

  async function handleExportVideo() {
    if (!camera) return;
    setExporting(true);
    setExportError(null);
    const result = await exportCameraPathVideo();
    setExporting(false);
    if (!result.ok) {
      setExportError(result.message);
    }
  }

  return (
    <div className="timeline-panel" aria-label="运镜时间轴">
      <div className="timeline-toolbar">
        <div className="timeline-transport">
          <button
            className="timeline-button"
            disabled={!camera || nodes.length < 2}
            title={isPlaying ? "暂停" : "播放"}
            type="button"
            onClick={() => {
              if (isPlaying) {
                pause();
                return;
              }
              // 播放即看镜头画面：自动切到机位视角，Space 随时切回导演视角
              useDirectorStore.getState().setViewMode("camera");
              // 播放头已在末尾（上一轮播完）：从头再播
              if (playheadTime >= total - 0.001) setPlayheadTime(0);
              play();
            }}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            className="timeline-button"
            disabled={!camera || nodes.length < 2}
            title="停止"
            type="button"
            onClick={stop}
          >
            <Square size={12} />
          </button>
          <span className="timeline-time">
            {formatTime(playheadTime)} / {formatTime(total)}
          </span>
        </div>
        <div className="timeline-zoom">
          <button className="timeline-button" title="缩小时间轴" type="button" onClick={() => setTimelineZoom(zoom / 1.5)}>
            <Minus size={14} />
          </button>
          <button className="timeline-button" title="放大时间轴" type="button" onClick={() => setTimelineZoom(zoom * 1.5)}>
            <Plus size={14} />
          </button>
        </div>
        <div className="timeline-camera-name">{camera ? `${camera.name} · ${nodes.length} 个节点` : "无可用机位"}</div>
        <div className="timeline-inspector">
          {selectedHandle ? (
            <span className="timeline-hint">拖拽 3D 视口中的手柄编辑曲线，Delete 恢复直线手柄</span>
          ) : selectedNode && camera ? (
            <>
              <span className="timeline-hint">
                节点 {String.fromCharCode(65 + Math.max(selectedNodeIndex, 0))} · {formatTime(startTimes[Math.max(selectedNodeIndex, 0)] ?? 0)}
              </span>
              <button
                className="timeline-button"
                title="在该节点后插入新节点"
                type="button"
                onClick={() => {
                  addCameraNode(camera.id, selectedNode.nodeId);
                  selectHandle(null);
                }}
              >
                <Plus size={14} /> 插入节点
              </button>
              <button
                className="timeline-button"
                title="删除该节点"
                type="button"
                onClick={() => {
                  deleteCameraNode(camera.id, selectedNode.nodeId);
                  clearSelection();
                }}
              >
                <Trash2 size={14} /> 删除
              </button>
            </>
          ) : selectedSegmentData ? (
            <>
              <label className="timeline-field">
                时长
                <input
                  className="timeline-number-input"
                  min={0.1}
                  step={0.1}
                  type="number"
                  value={selectedSegmentData.duration}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value) && camera) {
                      updateCameraSegment(camera.id, selectedSegmentData.id, { duration: value });
                    }
                  }}
                />
                秒
              </label>
              <label className="timeline-field">
                缓动
                <select
                  className="timeline-select"
                  value={selectedSegmentData.easing}
                  onChange={(event) => {
                    if (camera) {
                      updateCameraSegment(camera.id, selectedSegmentData.id, {
                        easing: event.target.value as CameraSegmentEasing,
                      });
                    }
                  }}
                >
                  {EASING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="timeline-field">
                停顿
                <input
                  className="timeline-number-input"
                  min={0}
                  step={0.1}
                  type="number"
                  value={selectedSegmentData.holdAfter}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value) && value >= 0 && camera) {
                      updateCameraSegment(camera.id, selectedSegmentData.id, { holdAfter: value });
                    }
                  }}
                />
                秒
              </label>
              <button
                className="timeline-button"
                type="button"
                onClick={() => {
                  if (!camera) return;
                  setSegmentCurveMode(
                    camera.id,
                    selectedSegmentData.id,
                    selectedSegmentData.curveMode === "bezier" ? "linear" : "bezier"
                  );
                  if (selectedSegmentData.curveMode === "linear") {
                    selectHandle({ cameraId: camera.id, segmentId: selectedSegmentData.id, handle: "out" });
                  }
                }}
              >
                {selectedSegmentData.curveMode === "bezier" ? "转回直线" : "转为曲线"}
              </button>
            </>
          ) : (
            <span className="timeline-hint">点击路径线段编辑段 · 点击节点调整时间</span>
          )}
        </div>
        <div className="timeline-actions">
          <button
            className="timeline-button"
            disabled={!camera || nodes.length < 1}
            title="在当前机位末尾添加运镜节点（取当前取景姿态）"
            type="button"
            onClick={() => camera && addCameraNode(camera.id)}
          >
            <Plus size={14} /> 添加节点
          </button>
          <button
            className="timeline-button"
            disabled={!camera || nodes.length < 2 || exporting}
            title="导出运镜参考视频"
            type="button"
            onClick={handleExportVideo}
          >
            <Video size={14} /> {exporting ? "导出中…" : "导出视频"}
          </button>
          {exportError ? <span className="timeline-export-error">{exportError}</span> : null}
        </div>
      </div>
      <div className="timeline-track-area">
        <div
          ref={trackRef}
          className="timeline-track"
          onPointerDown={(event) => {
            if (event.target === trackRef.current || (event.target as HTMLElement).dataset.ruler) {
              beginTrackDrag(event, "playhead");
              moveTrackDrag(event);
            }
          }}
          onPointerMove={moveTrackDrag}
          onPointerUp={endTrackDrag}
          onPointerCancel={endTrackDrag}
        >
          <div className="timeline-content" style={{ width: contentWidth }}>
            <div className="timeline-ruler" data-ruler="true" style={{ height: RULER_HEIGHT }}>
              {nodes.length ? (
                Array.from({ length: Math.ceil(total / getRulerTickStep(zoom)) + 1 }, (_, index) => {
                  const time = index * getRulerTickStep(zoom);
                  return (
                    <span
                      key={time}
                      className="timeline-ruler-tick"
                      style={{ left: TRACK_GUTTER_WIDTH + time * zoom }}
                    >
                      {time.toFixed(time < 10 && time % 1 !== 0 ? 1 : 0)}s
                    </span>
                  );
                })
              ) : (
                <span className="timeline-hint" style={{ padding: "4px 12px" }}>
                  进入机位视角掌镜，按 K 记录运镜节点
                </span>
              )}
            </div>
            {segments.map((segment, index) => {
              const start = startTimes[index] * zoom;
              const motionWidth = segment.duration * zoom;
              const holdWidth = segment.holdAfter * zoom;
              const isSelected = selectedSegment?.segmentId === segment.id;
              return (
                <button
                  key={segment.id}
                  className={`timeline-segment${isSelected ? " is-selected" : ""}${segment.curveMode === "bezier" ? " is-bezier" : ""}`}
                  style={{
                    left: TRACK_GUTTER_WIDTH + start,
                    top: TRACK_TOP,
                    height: TRACK_HEIGHT,
                    width: Math.max(motionWidth + holdWidth, 3),
                  }}
                  title={`节点${String.fromCharCode(65 + index)}→${String.fromCharCode(65 + index + 1)}：${segment.duration.toFixed(1)}s${segment.holdAfter ? ` + 停顿 ${segment.holdAfter.toFixed(1)}s` : ""}`}
                  type="button"
                  onClick={() => {
                    if (camera) selectSegment({ cameraId: camera.id, segmentId: segment.id });
                  }}
                >
                  <span className="timeline-segment-motion" style={{ width: motionWidth }} />
                  {holdWidth > 0 ? <span className="timeline-segment-hold" style={{ width: holdWidth }} /> : null}
                </button>
              );
            })}
            {nodes.map((node, index) => {
              const isSelected = selectedNode?.nodeId === node.id;
              return (
                <button
                  key={node.id}
                  className={`timeline-node${isSelected ? " is-selected" : ""}`}
                  style={{ left: TRACK_GUTTER_WIDTH + startTimes[index] * zoom, top: TRACK_TOP - 5 }}
                  title={`节点${String.fromCharCode(65 + index)} · ${formatTime(startTimes[index])}（拖拽调整时间）`}
                  type="button"
                  onClick={() => {
                    if (camera) {
                      selectNode({ cameraId: camera.id, nodeId: node.id });
                      // 播放头跳到该节点：镜头画面直接切到这个节点的视角，方便进机位视角重新调
                      setPlayheadTime(startTimes[index]);
                    }
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    if (camera) selectNode({ cameraId: camera.id, nodeId: node.id });
                    beginTrackDrag(event, "node", node.id);
                  }}
                >
                  {String.fromCharCode(65 + index)}
                </button>
              );
            })}
            <div
              className="timeline-playhead"
              style={{ left: TRACK_GUTTER_WIDTH + Math.min(playheadTime, total) * zoom }}
            >
              <span className="timeline-playhead-cap" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
