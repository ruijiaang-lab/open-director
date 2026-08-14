import { create } from "zustand";

export interface PlaybackNodeSelection {
  cameraId: string;
  nodeId: string;
}

export interface PlaybackSegmentSelection {
  cameraId: string;
  segmentId: string;
}

export interface PlaybackHandleSelection {
  cameraId: string;
  segmentId: string;
  handle: "out" | "in";
}

interface CameraPlaybackState {
  /** 播放头时间（秒），未播放时拖拽 scrub 也写这里 */
  playheadTime: number;
  isPlaying: boolean;
  selectedNode: PlaybackNodeSelection | null;
  selectedSegment: PlaybackSegmentSelection | null;
  selectedHandle: PlaybackHandleSelection | null;
  /** 时间轴缩放：每秒像素数 */
  timelineZoom: number;
  setPlayheadTime: (time: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  selectNode: (selection: PlaybackNodeSelection | null) => void;
  selectSegment: (selection: PlaybackSegmentSelection | null) => void;
  selectHandle: (selection: PlaybackHandleSelection | null) => void;
  setTimelineZoom: (zoom: number) => void;
  clearSelection: () => void;
}

export const MIN_TIMELINE_ZOOM = 20;
export const MAX_TIMELINE_ZOOM = 320;

/**
 * 运镜播放/时间轴 UI 状态。刻意不进 directorStore：
 * 播放头每帧都在变，走 undo/持久化主 store 会产生海量快照和 localStorage 写入。
 */
export const useCameraPlaybackStore = create<CameraPlaybackState>((set) => ({
  playheadTime: 0,
  isPlaying: false,
  selectedNode: null,
  selectedSegment: null,
  selectedHandle: null,
  timelineZoom: 80,
  setPlayheadTime: (time) => set({ playheadTime: Math.max(0, time) }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  stop: () => set({ isPlaying: false, playheadTime: 0 }),
  selectNode: (selection) => set({ selectedNode: selection, selectedSegment: null, selectedHandle: null }),
  selectSegment: (selection) => set({ selectedSegment: selection, selectedNode: null, selectedHandle: null }),
  selectHandle: (selection) => set({ selectedHandle: selection, selectedNode: null, selectedSegment: null }),
  setTimelineZoom: (zoom) =>
    set({ timelineZoom: Math.min(Math.max(zoom, MIN_TIMELINE_ZOOM), MAX_TIMELINE_ZOOM) }),
  clearSelection: () => set({ selectedNode: null, selectedSegment: null, selectedHandle: null }),
}));
