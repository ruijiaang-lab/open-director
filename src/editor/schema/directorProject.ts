export type ViewMode = "director" | "camera";
export type RightPanelKind = "scene" | "character" | "prop" | "camera";
export type DirectorObjectKind = "character" | "scene" | "prop" | "camera" | "panorama";
export const GEOMETRY_PRIMITIVE_OPTIONS = [
  { type: "box", label: "立方体" },
  { type: "sphere", label: "球体" },
  { type: "cylinder", label: "圆柱体" },
  { type: "torus", label: "环状体" },
  { type: "cone", label: "圆锥" },
  { type: "pyramid", label: "棱锥" },
] as const;
export type GeometryPrimitiveType = (typeof GEOMETRY_PRIMITIVE_OPTIONS)[number]["type"];
export type CharacterRigType = "mannequin" | "ue4-mannequin" | "mixamo" | "vrm" | "custom-humanoid";
export type CharacterBodyType =
  | "mannequin"
  | "female"
  | "broad"
  | "muscular"
  | "slim"
  | "teen"
  | "child"
  | "chibi";
export type DirectorAssetKind = "character" | "scene" | "prop" | "panorama";
export type DirectorAssetSource = "local" | "library";
export type PanoramaProjectionMode = "equirectangular" | "backdrop";

export interface DirectorTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface SceneSettings {
  scale: number;
  position: [number, number, number];
  rotation: [number, number, number];
  backgroundColor: string;
  panoramaYaw: number;
  panoramaRadius: number;
  showLabels: boolean;
  snapToGrid: boolean;
  showGround: boolean;
  groundOpacity: number;
  groundHeight: number;
}

export interface CharacterRigState {
  rigType: CharacterRigType;
  posePresetId: string | null;
  controls: Record<string, number>;
}

export interface DirectorAssetRef {
  id: string;
  kind: DirectorAssetKind;
  sourceType: "model" | "image";
  fileName: string;
  name?: string;
  url: string;
  assetSource?: DirectorAssetSource;
  projectionMode?: PanoramaProjectionMode;
}

export interface DirectorObject {
  id: string;
  name: string;
  kind: DirectorObjectKind;
  visible: boolean;
  locked: boolean;
  transform: DirectorTransform;
  bodyType?: CharacterBodyType;
  color?: string;
  assetRefId?: string;
  geometryType?: GeometryPrimitiveType;
  crowdId?: string;
  crowdLabel?: string;
  linkedCameraId?: string | null;
  characterRig?: CharacterRigState;
}

export interface DirectorCameraCapture {
  id: string;
  index: number;
  name: string;
  dataUrl: string;
}

/**
 * 运镜节点：K 键掌镜时记录的相机姿态。
 * rotation 为四元数 [x, y, z, w]（避免欧拉插值歧义）。
 */
export interface CameraNode {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  fov: number;
  /** 时间轴位置（秒），即该节点出段（outgoing segment）的起始时间。由 Timeline 拖拽维护。 */
  time: number;
}

export type CameraSegmentCurveMode = "linear" | "bezier";
export type CameraSegmentEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out";

/**
 * 相邻两个运镜节点之间的一段运动。
 * duration = 运动时长；holdAfter = 运动结束后停在终点的停顿时长。
 * 节点时间满足：node[i+1].time = node[i].time + duration + holdAfter。
 */
export interface CameraSegment {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  curveMode: CameraSegmentCurveMode;
  duration: number;
  holdAfter: number;
  easing: CameraSegmentEasing;
  handleOut?: [number, number, number];
  handleIn?: [number, number, number];
}

export interface DirectorCameraShot {
  id: string;
  name: string;
  fov: number;
  transform: DirectorTransform;
  targetMode: "manual" | "object";
  targetObjectId?: string | null;
  target: [number, number, number];
  lastCaptureUrl?: string | null;
  captures?: DirectorCameraCapture[];
  /** 运镜路径节点（可空 = 该机位尚无运镜记录） */
  nodes?: CameraNode[];
  /** 相邻节点之间的运动段（与 nodes 保持同步，缺失时按节点时间派生） */
  segments?: CameraSegment[];
}

export interface DirectorProject {
  version: 1;
  scene: SceneSettings;
  assets: DirectorAssetRef[];
  objects: DirectorObject[];
  cameras: DirectorCameraShot[];
  activeCameraId: string | null;
  panoramaAssetId: string | null;
}
