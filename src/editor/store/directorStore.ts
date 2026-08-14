import { create } from "zustand";
import { Euler, Quaternion, Vector3 } from "three";
import { MANNEQUIN_POSE_PRESETS } from "../presets/mannequinPosePresets";
import { GEOMETRY_PRIMITIVE_OPTIONS } from "../schema/directorProject";
import type {
  DirectorAssetRef,
  DirectorAssetSource,
  CharacterBodyType,
  DirectorAssetKind,
  CameraNode,
  CameraSegment,
  DirectorCameraCapture,
  DirectorCameraShot,
  DirectorObject,
  DirectorProject,
  DirectorTransform,
  GeometryPrimitiveType,
  PanoramaProjectionMode,
  SceneSettings,
  ViewMode,
} from "../schema/directorProject";
import type { PosePresetId } from "../schema/poseSchema";
import { getDirectorObjectFocusTarget } from "../schema/cameraTarget";
import { VIEWPORT_CAMERA_FRUSTUM_DEPTH } from "../schema/cameraGeometry";
import {
  buildCameraSegments,
  clampNodeTime,
  getDefaultBezierHandles,
  getLookAtQuaternion,
  getNodeStartTimes,
  MIN_SEGMENT_DURATION,
} from "../camera/cameraPath";
import { DEFAULT_CHARACTER_BODY_TYPE, normalizeBodyType } from "../runtime/mannequin/bodyTypes";
import {
  DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT,
  getCameraRigPositionFromViewSnapshot,
  getCameraViewSnapshotFromShot,
} from "../schema/cameraGeometry";
import type { ViewportAspectRatio } from "../schema/viewportAspectRatio";

export type TransformMode = "translate" | "rotate" | "scale";

export interface ImportedAssetInput {
  kind: DirectorAssetKind;
  name: string;
  fileName: string;
  url: string;
  addToScene?: boolean;
  assetSource?: DirectorAssetSource;
  projectionMode?: PanoramaProjectionMode;
}

export interface CameraShotSnapshot {
  fov: number;
  position: [number, number, number];
  target: [number, number, number];
}

export interface CrowdCharactersInput {
  bodyType?: CharacterBodyType;
  rows: number;
  columns: number;
  spacing: number;
}

export interface DirectorStateOptions {
  includePersistedLocalAssets?: boolean;
  includePersistedScene?: boolean;
  persistenceScopeId?: string | null;
}

export interface DirectorUiState {
  viewMode: ViewMode;
  selectedObjectId: string | null;
  selectedObjectIds: string[];
  selectedCrowdId: string | null;
  directorInspectorMode: "auto" | "scene";
  transformMode: TransformMode;
  viewportAspectRatio: ViewportAspectRatio;
  viewportRuleOfThirdsEnabled: boolean;
  viewportPanelsCollapsed: boolean;
}

export interface DirectorState extends DirectorUiState {
  project: DirectorProject;
}

export interface DirectorClipboardEntry {
  object: DirectorObject;
  camera?: DirectorCameraShot;
}

interface DirectorInternalState {
  clipboard: DirectorClipboardEntry[];
  clipboardPasteCount: number;
  undoStack: DirectorState[];
  undoBatchDepth: number;
  undoBatchSnapshot: DirectorState | null;
  undoBatchHasTrackedChanges: boolean;
}

export interface DirectorActions {
  setViewMode: (mode: ViewMode) => void;
  setTransformMode: (mode: TransformMode) => void;
  setViewportAspectRatio: (ratio: ViewportAspectRatio) => void;
  setViewportRuleOfThirdsEnabled: (enabled: boolean) => void;
  toggleViewportPanelsCollapsed: () => void;
  setViewportPanelsCollapsed: (collapsed: boolean) => void;
  selectObject: (id: string | null) => void;
  selectCrowd: (crowdId: string | null) => void;
  toggleObjectSelection: (id: string) => void;
  openSceneInspector: () => void;
  updateScene: (patch: Partial<SceneSettings>) => void;
  removePanoramaAsset: () => void;
  removeImportedAsset: (assetId: string) => void;
  updateObjectTransform: (id: string, patch: Partial<DirectorTransform>) => void;
  updateCrowdTransform: (crowdId: string, patch: Partial<DirectorTransform>) => void;
  updateObjectName: (id: string, name: string) => void;
  updateCrowdLabel: (crowdId: string, label: string) => void;
  updateObjectColor: (id: string, color: string) => void;
  updateCrowdColor: (crowdId: string, color: string) => void;
  updateCharacterBodyType: (id: string, bodyType: CharacterBodyType) => void;
  updateUniformScale: (id: string, scale: number) => void;
  updateCrowdUniformScale: (crowdId: string, scale: number) => void;
  addImportedAsset: (input: ImportedAssetInput) => void;
  addObjectFromAsset: (assetId: string) => string | null;
  addPresetCharacter: (bodyType?: CharacterBodyType) => void;
  addCrowdCharacters: (input: CrowdCharactersInput) => string[];
  addGeometryPrimitive: (geometryType: GeometryPrimitiveType) => void;
  addCameraShot: (snapshot?: CameraShotSnapshot) => string;
  deleteSelectedObject: () => void;
  toggleObjectVisible: (id: string) => void;
  toggleObjectLocked: (id: string) => void;
  applyPosePreset: (id: string, presetId: PosePresetId) => void;
  applyCrowdPosePreset: (crowdId: string, presetId: PosePresetId) => void;
  updatePoseControl: (id: string, key: string, value: number) => void;
  updateCrowdPoseControl: (crowdId: string, key: string, value: number) => void;
  setActiveCamera: (cameraId: string) => void;
  addCameraCaptures: (cameraId: string | null | undefined, dataUrls: string[]) => void;
  /**
   * 记录一个运镜节点到指定机位，并把机位 transform 同步为当前姿态。
   * rotation 为四元数 [x, y, z, w]。
   */
  recordCameraNode: (
    cameraId: string,
    input: {
      position: [number, number, number];
      rotation: [number, number, number, number];
      fov: number;
    }
  ) => void;
  /** 只同步机位姿态（不记录节点）：离开机位视角时保留最后掌镜位置 */
  syncCameraPose: (
    cameraId: string,
    input: {
      position: [number, number, number];
      rotation: [number, number, number, number];
      fov: number;
    }
  ) => void;
  /**
   * 播放/scrub 时把求值出的姿态写回机位（视点位置 + 四元数）。
   * 每帧调用：不进 undo 栈、不写 localStorage。
   */
  applyPlaybackPose: (
    cameraId: string,
    input: {
      position: [number, number, number];
      rotation: [number, number, number, number];
      fov: number;
    }
  ) => void;
  updateCameraNode: (
    cameraId: string,
    nodeId: string,
    patch: Partial<Pick<CameraNode, "position" | "rotation" | "fov">>
  ) => void;
  updateCameraNodeTime: (cameraId: string, nodeId: string, time: number) => void;
  addCameraNode: (cameraId: string, afterNodeId?: string) => void;
  deleteCameraNode: (cameraId: string, nodeId: string) => void;
  updateCameraSegment: (
    cameraId: string,
    segmentId: string,
    patch: Partial<Pick<CameraSegment, "duration" | "holdAfter" | "easing" | "handleOut" | "handleIn">>
  ) => void;
  setSegmentCurveMode: (cameraId: string, segmentId: string, mode: CameraSegment["curveMode"]) => void;
  updateCamera: (
    cameraId: string,
    patch: Partial<DirectorCameraShot> & {
      transform?: DirectorTransform;
      target?: [number, number, number];
    }
  ) => void;
  beginUndoBatch: () => void;
  endUndoBatch: () => void;
  copySelectedObjects: () => void;
  pasteClipboardObjects: () => void;
  undo: () => void;
  openScopedScene: (scopeId: string | null | undefined) => void;
  replaceProject: (project: DirectorProject) => void;
  saveLatestSnapshot: () => void;
  restoreLatestSnapshot: () => void;
}

type DirectorRuntimeState = DirectorState & DirectorInternalState;

export type DirectorStore = DirectorRuntimeState & DirectorActions;

const DEFAULT_SCENE: SceneSettings = {
  scale: 1,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  backgroundColor: "#000000",
  panoramaYaw: 0,
  panoramaRadius: 60,
  showLabels: true,
  snapToGrid: false,
  showGround: true,
  groundOpacity: 0.4,
  groundHeight: 0,
};

const CHARACTER_COLOR_PALETTE = [
  "#4F8EF7",
  "#E0524D",
  "#E91E63",
  "#F2A900",
  "#9C4DCC",
  "#12B886",
  "#00B8D9",
  "#FF7A45",
];
const GEOMETRY_PRIMITIVE_COLOR = "#d7e7ff";
const ADDED_MODEL_WORLD_SPACING = 1.25;
const COPY_PASTE_POSITION_OFFSET = 0.6;
const UNDO_STACK_LIMIT = 80;
const LOCAL_MODEL_LIBRARY_STORAGE_KEY = "storyai-3d-director-local-model-library";
const DIRECTOR_SCENE_STORAGE_KEY = "storyai-3d-director-desk-demo";
const DIRECTOR_SCENE_STORAGE_KEY_PREFIX = `${DIRECTOR_SCENE_STORAGE_KEY}:`;
const DEFAULT_UI_STATE: DirectorUiState = {
  viewMode: "director",
  selectedObjectId: null,
  selectedObjectIds: [],
  selectedCrowdId: null,
  directorInspectorMode: "auto",
  transformMode: "translate",
  viewportAspectRatio: "auto",
  viewportRuleOfThirdsEnabled: false,
  viewportPanelsCollapsed: false,
};

function normalizeDirectorScenePersistenceScopeId(scopeId: string | null | undefined) {
  return typeof scopeId === "string" ? scopeId.trim() : "";
}

function getInitialDirectorScenePersistenceScopeId() {
  if (typeof window === "undefined") return null;

  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeDirectorScenePersistenceScopeId(params.get("instanceId")) || null;
  } catch {
    return null;
  }
}

let directorScenePersistenceScopeId: string | null = getInitialDirectorScenePersistenceScopeId();

function getDirectorSceneStorageKey(scopeId: string | null | undefined = directorScenePersistenceScopeId) {
  const normalizedScopeId = normalizeDirectorScenePersistenceScopeId(scopeId);
  return normalizedScopeId ? `${DIRECTOR_SCENE_STORAGE_KEY_PREFIX}${normalizedScopeId}` : DIRECTOR_SCENE_STORAGE_KEY;
}

function setDirectorScenePersistenceScopeId(scopeId: string | null | undefined) {
  const normalizedScopeId = normalizeDirectorScenePersistenceScopeId(scopeId);
  directorScenePersistenceScopeId = normalizedScopeId || null;
}

function createTransform(
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1]
): DirectorTransform {
  return { position, rotation, scale };
}

function eulerFromQuaternion(quaternion: [number, number, number, number]): [number, number, number] {
  const euler = new Euler().setFromQuaternion(new Quaternion(...quaternion));
  return roundTransformTuple([euler.x, euler.y, euler.z]);
}

/**
 * 把相机姿态（视点位置 + 四元数）应用到机位：
 * transform 存 rig 位置（视点沿朝向后退一个视锥深度），
 * target 更新为"当前注视点"，保证重进 Camera View 时朝向一致。
 * 同步机位配套的 gizmo 对象。
 */
function applyCameraPose(
  state: DirectorRuntimeState,
  cameraId: string,
  input: { position: [number, number, number]; rotation: [number, number, number, number]; fov: number },
  nodes: CameraNode[] | undefined
): DirectorRuntimeState {
  const camera = state.project.cameras.find((item) => item.id === cameraId);
  if (!camera) return state;

  const trackedTargetObject =
    camera.targetMode === "object" && camera.targetObjectId
      ? state.project.objects.find((item) => item.id === camera.targetObjectId)
      : null;
  const forward = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...input.rotation));
  const viewPosition = new Vector3(...input.position);
  const radius = Math.max(viewPosition.distanceTo(new Vector3(...camera.target)), 0.001);
  const nextTarget = viewPosition.clone().add(forward.clone().multiplyScalar(radius));
  const resolvedTarget = trackedTargetObject
    ? getDirectorObjectFocusTarget(trackedTargetObject)
    : roundTransformTuple([nextTarget.x, nextTarget.y, nextTarget.z]);
  const rigPosition = viewPosition.clone().sub(forward.clone().multiplyScalar(VIEWPORT_CAMERA_FRUSTUM_DEPTH));
  const transform: DirectorTransform = {
    position: roundTransformTuple([rigPosition.x, rigPosition.y, rigPosition.z]),
    rotation: eulerFromQuaternion(input.rotation),
    scale: [1, 1, 1],
  };

  return {
    ...state,
    project: {
      ...state.project,
      cameras: state.project.cameras.map((item) =>
        item.id === cameraId
          ? {
              ...item,
              nodes,
              fov: input.fov,
              transform,
              target: resolvedTarget,
            }
          : item
      ),
      objects: state.project.objects.map((item) =>
        item.kind === "camera" && item.linkedCameraId === cameraId ? { ...item, transform } : item
      ),
    },
  };
}

/** 用段表（duration/holdAfter 为准）反推各节点时间，保持 node.time 与段表一致。 */
function syncNodeTimes(nodes: CameraNode[], segments: CameraSegment[]): CameraNode[] {
  const startTimes = getNodeStartTimes(nodes, segments);

  return nodes.map((node, index) => (node.time === startTimes[index] ? node : { ...node, time: startTimes[index] }));
}

/** 节点变化后重建段表（同 id 段保留设置），并同步节点时间。 */
function rebuildCameraTiming(camera: DirectorCameraShot): DirectorCameraShot {
  if (!camera.nodes || camera.nodes.length < 2) {
    return camera.segments ? { ...camera, segments: [] } : camera;
  }

  const segments = buildCameraSegments(camera.nodes, camera.segments);
  return { ...camera, segments, nodes: syncNodeTimes(camera.nodes, segments) };
}

function getCameraViewQuaternion(camera: DirectorCameraShot): [number, number, number, number] {
  const snapshot = getCameraViewSnapshotFromShot(camera);
  const quaternion = getLookAtQuaternion(snapshot.position, snapshot.target);

  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function roundTransformValue(value: number) {
  return Number(value.toFixed(6));
}

function roundTransformTuple(values: [number, number, number]): [number, number, number] {
  return values.map((value) => roundTransformValue(value)) as [number, number, number];
}

function formatSceneItemName(prefix: "角色" | "机位", index: number) {
  return `${prefix}${String(index).padStart(2, "0")}`;
}

function getNextSequentialId(existingIds: string[], prefix: string, minimumIndex = 1) {
  let maxIndex = minimumIndex - 1;

  for (const id of existingIds) {
    if (!id.startsWith(prefix)) continue;

    const suffix = id.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;

    maxIndex = Math.max(maxIndex, Number.parseInt(suffix, 10));
  }

  return `${prefix}${maxIndex + 1}`;
}

function isLocalModelLibraryAsset(asset: DirectorAssetRef) {
  return asset.sourceType === "model" && asset.kind !== "panorama" && asset.assetSource === "local";
}

function getLocalStorageSafe() {
  if (typeof localStorage === "undefined") return null;

  return localStorage;
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readPersistedLocalModelAssets() {
  const storage = getLocalStorageSafe();
  if (!storage) return [];

  try {
    const snapshot = storage.getItem(LOCAL_MODEL_LIBRARY_STORAGE_KEY);
    if (!snapshot) return [];

    const parsed = JSON.parse(snapshot);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (asset): asset is DirectorAssetRef =>
        asset &&
        typeof asset.id === "string" &&
        typeof asset.fileName === "string" &&
        typeof asset.url === "string" &&
        isLocalModelLibraryAsset(asset)
    );
  } catch {
    return [];
  }
}

function writePersistedLocalModelAssets(assets: DirectorAssetRef[]) {
  const storage = getLocalStorageSafe();
  if (!storage) return;

  try {
    storage.setItem(LOCAL_MODEL_LIBRARY_STORAGE_KEY, JSON.stringify(assets.filter(isLocalModelLibraryAsset)));
  } catch {
    // Local model files can exceed browser storage limits; keep the current scene usable if persistence fails.
  }
}

function persistLocalModelAsset(asset: DirectorAssetRef) {
  if (!isLocalModelLibraryAsset(asset)) return;

  const persistedAssets = readPersistedLocalModelAssets().filter((item) => item.id !== asset.id);
  writePersistedLocalModelAssets([...persistedAssets, asset]);
}

function removePersistedLocalModelAsset(assetId: string) {
  writePersistedLocalModelAssets(readPersistedLocalModelAssets().filter((asset) => asset.id !== assetId));
}

function isDirectorProjectShape(value: unknown): value is DirectorProject {
  if (!value || typeof value !== "object") return false;

  const project = value as Partial<DirectorProject>;
  return (
    project.version === 1 &&
    Array.isArray(project.assets) &&
    Array.isArray(project.objects) &&
    Array.isArray(project.cameras) &&
    Boolean(project.scene) &&
    typeof project.scene?.backgroundColor === "string"
  );
}

function withPersistedLocalAssets(project: DirectorProject, includePersistedLocalAssets = false): DirectorProject {
  if (!includePersistedLocalAssets) return project;

  const persistedAssets = readPersistedLocalModelAssets();
  if (!persistedAssets.length) return project;

  const existingAssetIds = new Set(project.assets.map((asset) => asset.id));

  return {
    ...project,
    assets: [...project.assets, ...persistedAssets.filter((asset) => !existingAssetIds.has(asset.id))],
  };
}

function migrateDirectorProject(project: DirectorProject): DirectorProject {
  return {
    ...project,
    objects: project.objects.map((object) => {
      if (object.kind !== "character") return object;

      const rig = object.characterRig;
      if (rig?.rigType === "ue4-mannequin") return object;

      return {
        ...object,
        characterRig: {
          rigType: "ue4-mannequin",
          posePresetId: rig?.posePresetId ?? "stand",
          controls: rig?.controls ?? {},
        },
      };
    }),
    cameras: project.cameras.map((camera) =>
      camera.nodes && camera.nodes.length >= 2 ? rebuildCameraTiming(camera) : camera
    ),
  };
}

function extractPersistedDirectorState(state: DirectorRuntimeState): DirectorState {
  return cloneJsonValue({
    viewMode: state.viewMode,
    selectedObjectId: state.selectedObjectId,
    selectedObjectIds: state.selectedObjectIds,
    selectedCrowdId: state.selectedCrowdId,
    directorInspectorMode: state.directorInspectorMode,
    transformMode: state.transformMode,
    viewportAspectRatio: state.viewportAspectRatio,
    viewportRuleOfThirdsEnabled: state.viewportRuleOfThirdsEnabled,
    viewportPanelsCollapsed: state.viewportPanelsCollapsed,
    project: state.project,
  });
}

function writePersistedDirectorState(state: DirectorState) {
  const storage = getLocalStorageSafe();
  if (!storage) return;

  try {
    storage.setItem(getDirectorSceneStorageKey(), JSON.stringify(state));
  } catch {
    // Keep the editor usable if the browser storage quota is exceeded.
  }
}

function createStateFromPersistedProject(project: DirectorProject, options: DirectorStateOptions = {}): DirectorState {
  return {
    ...DEFAULT_UI_STATE,
    project: withPersistedLocalAssets(migrateDirectorProject(cloneJsonValue(project)), options.includePersistedLocalAssets),
  };
}

function readPersistedDirectorState(options: DirectorStateOptions = {}): DirectorState | null {
  const storage = getLocalStorageSafe();
  if (!storage) return null;

  try {
    const snapshot = storage.getItem(getDirectorSceneStorageKey(options.persistenceScopeId));
    if (!snapshot) return null;

    const parsed = JSON.parse(snapshot) as unknown;

    if (isDirectorProjectShape(parsed)) {
      return createStateFromPersistedProject(parsed, options);
    }

    if (!parsed || typeof parsed !== "object") return null;

    const state = parsed as Partial<DirectorState>;
    if (!isDirectorProjectShape(state.project)) return null;

    return {
      viewMode: state.viewMode === "camera" ? "camera" : "director",
      selectedObjectId: typeof state.selectedObjectId === "string" ? state.selectedObjectId : null,
      selectedObjectIds: Array.isArray(state.selectedObjectIds)
        ? state.selectedObjectIds.filter((item): item is string => typeof item === "string")
        : [],
      selectedCrowdId: typeof state.selectedCrowdId === "string" ? state.selectedCrowdId : null,
      directorInspectorMode: state.directorInspectorMode === "scene" ? "scene" : "auto",
      transformMode:
        state.transformMode === "rotate" || state.transformMode === "scale" ? state.transformMode : "translate",
      viewportAspectRatio: state.viewportAspectRatio ?? "auto",
      viewportRuleOfThirdsEnabled: Boolean(state.viewportRuleOfThirdsEnabled),
      viewportPanelsCollapsed: Boolean(state.viewportPanelsCollapsed),
      project: withPersistedLocalAssets(
        migrateDirectorProject(cloneJsonValue(state.project)),
        options.includePersistedLocalAssets
      ),
    };
  } catch {
    return null;
  }
}

function createRuntimeStateFromPersistedState(state: DirectorState): DirectorRuntimeState {
  const snapshot = cloneJsonValue(state);

  return {
    ...snapshot,
    clipboard: [],
    clipboardPasteCount: 0,
    undoStack: [],
    undoBatchDepth: 0,
    undoBatchSnapshot: null,
    undoBatchHasTrackedChanges: false,
  };
}

function createUndoStackEntry(state: DirectorRuntimeState) {
  return extractPersistedDirectorState(state);
}

export function createDefaultDirectorProject({
  includePersistedLocalAssets = false,
}: {
  includePersistedLocalAssets?: boolean;
} = {}): DirectorProject {
  const camera: DirectorCameraShot = {
    id: "cam_1",
    name: formatSceneItemName("机位", 1),
    fov: DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT.fov,
    transform: createTransform(getCameraRigPositionFromViewSnapshot(DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT)),
    targetMode: "manual",
    target: DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT.target,
    lastCaptureUrl: null,
    captures: [],
  };

  const role: DirectorObject = {
    id: "char_default_a",
    name: formatSceneItemName("角色", 1),
    kind: "character",
    visible: true,
    locked: false,
    bodyType: DEFAULT_CHARACTER_BODY_TYPE,
    color: "#4F8EF7",
    transform: createTransform([0, 0, 0]),
    characterRig: {
      rigType: "ue4-mannequin",
      posePresetId: "stand",
      controls: {},
    },
  };

  const cameraObject: DirectorObject = {
    id: "cam_object_1",
    name: camera.name,
    kind: "camera",
    visible: true,
    locked: false,
    linkedCameraId: camera.id,
    transform: camera.transform,
  };

  return {
    version: 1,
    scene: DEFAULT_SCENE,
    assets: includePersistedLocalAssets ? readPersistedLocalModelAssets() : [],
    objects: [role, cameraObject],
    cameras: [camera],
    activeCameraId: camera.id,
    panoramaAssetId: null,
  };
}

export function createInitialDirectorState(options: DirectorStateOptions = {}): DirectorState {
  const persistedState = options.includePersistedScene ? readPersistedDirectorState(options) : null;

  if (persistedState) {
    return persistedState;
  }

  return {
    ...DEFAULT_UI_STATE,
    project: createDefaultDirectorProject({ includePersistedLocalAssets: options.includePersistedLocalAssets }),
  };
}

function updateObjectById(
  objects: DirectorObject[],
  id: string,
  updater: (item: DirectorObject) => DirectorObject
) {
  return objects.map((item) => (item.id === id ? updater(item) : item));
}

function getNextCharacterColor(objects: DirectorObject[]) {
  const usedColors = new Set(objects.filter((item) => item.kind === "character").map((item) => item.color));
  const unusedColor = CHARACTER_COLOR_PALETTE.find((color) => !usedColors.has(color));

  if (unusedColor) return unusedColor;

  const characterCount = objects.filter((item) => item.kind === "character").length;
  return CHARACTER_COLOR_PALETTE[characterCount % CHARACTER_COLOR_PALETTE.length];
}

function getGeometryPrimitiveLabel(geometryType: GeometryPrimitiveType) {
  return GEOMETRY_PRIMITIVE_OPTIONS.find((option) => option.type === geometryType)?.label ?? "几何模型";
}

function getAddedModelColumnOffset(index: number) {
  const side = index % 2 === 1 ? -1 : 1;
  const step = Math.ceil(index / 2);

  return side * step * ADDED_MODEL_WORLD_SPACING;
}

function getCrowdCharacterPositions(rows: number, columns: number, spacing: number) {
  const safeRows = Math.max(1, rows);
  const safeColumns = Math.max(1, columns);
  const safeSpacing = Math.max(0.1, spacing);
  const xOffset = ((safeColumns - 1) * safeSpacing) / 2;
  const zOffset = ((safeRows - 1) * safeSpacing) / 2;
  const positions: Array<[number, number, number]> = [];

  for (let rowIndex = 0; rowIndex < safeRows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < safeColumns; columnIndex += 1) {
      positions.push([
        Number((columnIndex * safeSpacing - xOffset).toFixed(4)),
        0,
        Number((rowIndex * safeSpacing - zOffset).toFixed(4)),
      ]);
    }
  }

  return positions;
}

function getCrowdCharacterOffset(objects: DirectorObject[], spacing: number): [number, number, number] {
  const safeSpacing = Math.max(0.1, spacing);
  const characterPositions = objects
    .filter((item) => item.kind === "character")
    .map((item) => item.transform.position);
  const maxZ = characterPositions.length ? Math.max(...characterPositions.map((position) => position[2])) : 0;

  return [0, 0, Number((maxZ + safeSpacing * 2).toFixed(4))];
}

function formatCrowdLabel(rows: number, columns: number) {
  return `群众（${rows}x${columns}）`;
}

function buildPresetCharacterObject(
  state: DirectorRuntimeState,
  bodyType: CharacterBodyType,
  position: [number, number, number],
  crowdMetadata?: {
    crowdId: string;
    crowdLabel: string;
  }
) {
  const characterCount = state.project.objects.filter((item) => item.kind === "character").length;
  const characterIndex = characterCount + 1;
  const objectId = getNextSequentialId(
    state.project.objects.map((item) => item.id),
    "char_preset_",
    characterIndex
  );
  const normalizedBodyType = normalizeBodyType(bodyType);

  return {
    id: objectId,
    name: formatSceneItemName("角色", characterIndex),
    kind: "character" as const,
    visible: true,
    locked: false,
    bodyType: normalizedBodyType,
    color: getNextCharacterColor(state.project.objects),
    crowdId: crowdMetadata?.crowdId,
    crowdLabel: crowdMetadata?.crowdLabel,
    transform: createTransform(position),
    characterRig: {
      rigType: "ue4-mannequin" as const,
      posePresetId: "stand",
      controls: {},
    },
  } satisfies DirectorObject;
}

function formatCameraCaptureName(cameraName: string, captureIndex: number) {
  return `${cameraName}-截图${String(captureIndex).padStart(2, "0")}`;
}

function buildCameraCaptures(camera: DirectorCameraShot, dataUrls: string[]) {
  const existingCaptures = camera.captures ?? [];

  return dataUrls.map((dataUrl, indexOffset): DirectorCameraCapture => {
    const captureIndex = existingCaptures.length + indexOffset + 1;

    return {
      id: `${camera.id}-capture-${String(captureIndex).padStart(2, "0")}`,
      index: captureIndex,
      name: formatCameraCaptureName(camera.name, captureIndex),
      dataUrl,
    };
  });
}

function createDisplayNameFromFileName(fileName: string) {
  return fileName.replace(/\.(fbx|obj|jpe?g|png|webp)$/i, "");
}

function createSceneObjectFromAsset(asset: DirectorAssetRef, existingObjects: DirectorObject[]) {
  const nextObjectId = getNextSequentialId(
    existingObjects.map((item) => item.id),
    "obj_",
    existingObjects.length + 1
  );

  return {
    id: nextObjectId,
    name: asset.name ?? createDisplayNameFromFileName(asset.fileName),
    kind: asset.kind,
    visible: true,
    locked: false,
    assetRefId: asset.id,
    transform: createTransform([0, 0, 0]),
  } satisfies DirectorObject;
}

function refreshCamerasFocusedOnObject(cameras: DirectorCameraShot[], object: DirectorObject) {
  return cameras.map((camera) =>
    camera.targetMode === "object" && camera.targetObjectId === object.id
      ? {
          ...camera,
          target: getDirectorObjectFocusTarget(object),
        }
      : camera
  );
}

function refreshCamerasFocusedOnObjects(
  cameras: DirectorCameraShot[],
  objects: DirectorObject[],
  focusedObjectIds: Iterable<string>
) {
  const focusedIdSet = new Set(focusedObjectIds);
  if (focusedIdSet.size === 0) return cameras;

  const objectsById = new Map(objects.map((item) => [item.id, item]));

  return cameras.map((camera) => {
    if (camera.targetMode !== "object" || !camera.targetObjectId || !focusedIdSet.has(camera.targetObjectId)) {
      return camera;
    }

    const targetObject = objectsById.get(camera.targetObjectId);
    if (!targetObject) {
      return {
        ...camera,
        targetMode: "manual" as const,
        targetObjectId: null,
      };
    }

    return {
      ...camera,
      target: getDirectorObjectFocusTarget(targetObject),
    };
  });
}

function getCrowdMemberObjects(objects: DirectorObject[], crowdId: string) {
  return objects.filter((item) => item.kind === "character" && item.crowdId === crowdId);
}

function getCrowdMemberIds(objects: DirectorObject[], crowdId: string) {
  return getCrowdMemberObjects(objects, crowdId).map((item) => item.id);
}

export function getCrowdAnchorTransform(objects: DirectorObject[], crowdId: string): DirectorTransform | null {
  const crowdMembers = getCrowdMemberObjects(objects, crowdId);
  if (!crowdMembers.length) return null;

  const position = crowdMembers.reduce(
    (accumulator, item) => {
      accumulator[0] += item.transform.position[0];
      accumulator[1] += item.transform.position[1];
      accumulator[2] += item.transform.position[2];
      return accumulator;
    },
    [0, 0, 0] as [number, number, number]
  );
  const memberCount = crowdMembers.length;
  const anchorPosition = roundTransformTuple([
    position[0] / memberCount,
    position[1] / memberCount,
    position[2] / memberCount,
  ]);
  const referenceMember = crowdMembers[0];

  return createTransform(
    anchorPosition,
    [...referenceMember.transform.rotation] as [number, number, number],
    [...referenceMember.transform.scale] as [number, number, number]
  );
}

function getNextCrowdId(objects: DirectorObject[]) {
  return getNextSequentialId(
    objects.map((item) => item.crowdId).filter((item): item is string => typeof item === "string"),
    "crowd_",
    1
  );
}

function applyCrowdTransformPatch(
  objects: DirectorObject[],
  crowdId: string,
  patch: Partial<DirectorTransform>
) {
  const anchor = getCrowdAnchorTransform(objects, crowdId);
  if (!anchor) {
    return {
      objects,
      changedObjectIds: [],
    };
  }

  const nextPosition = patch.position ?? anchor.position;
  const nextRotation = patch.rotation ?? anchor.rotation;
  const nextScale = patch.scale ?? anchor.scale;
  const deltaRotation: [number, number, number] = [
    nextRotation[0] - anchor.rotation[0],
    nextRotation[1] - anchor.rotation[1],
    nextRotation[2] - anchor.rotation[2],
  ];
  const scaleRatio: [number, number, number] = [
    anchor.scale[0] === 0 ? 1 : nextScale[0] / anchor.scale[0],
    anchor.scale[1] === 0 ? 1 : nextScale[1] / anchor.scale[1],
    anchor.scale[2] === 0 ? 1 : nextScale[2] / anchor.scale[2],
  ];
  const anchorPosition = anchor.position;
  const changedObjectIds = getCrowdMemberIds(objects, crowdId);
  const changedIdSet = new Set(changedObjectIds);

  return {
    changedObjectIds,
    objects: objects.map((item) => {
      if (!changedIdSet.has(item.id)) return item;

      const offsetX = (item.transform.position[0] - anchorPosition[0]) * scaleRatio[0];
      const offsetY = (item.transform.position[1] - anchorPosition[1]) * scaleRatio[1];
      const offsetZ = (item.transform.position[2] - anchorPosition[2]) * scaleRatio[2];
      const cosX = Math.cos(deltaRotation[0]);
      const sinX = Math.sin(deltaRotation[0]);
      const cosY = Math.cos(deltaRotation[1]);
      const sinY = Math.sin(deltaRotation[1]);
      const cosZ = Math.cos(deltaRotation[2]);
      const sinZ = Math.sin(deltaRotation[2]);

      const x1 = offsetX;
      const y1 = offsetY * cosX - offsetZ * sinX;
      const z1 = offsetY * sinX + offsetZ * cosX;

      const x2 = x1 * cosY + z1 * sinY;
      const y2 = y1;
      const z2 = -x1 * sinY + z1 * cosY;

      const x3 = x2 * cosZ - y2 * sinZ;
      const y3 = x2 * sinZ + y2 * cosZ;
      const z3 = z2;

      return {
        ...item,
        transform: {
          position: roundTransformTuple([
            nextPosition[0] + x3,
            nextPosition[1] + y3,
            nextPosition[2] + z3,
          ]),
          rotation: roundTransformTuple([
            item.transform.rotation[0] + deltaRotation[0],
            item.transform.rotation[1] + deltaRotation[1],
            item.transform.rotation[2] + deltaRotation[2],
          ]),
          scale: roundTransformTuple([
            item.transform.scale[0] * scaleRatio[0],
            item.transform.scale[1] * scaleRatio[1],
            item.transform.scale[2] * scaleRatio[2],
          ]),
        },
      };
    }),
  };
}

function getOrderedSelectedObjectIds(state: DirectorState) {
  if (state.selectedObjectIds.length) return state.selectedObjectIds;
  return state.selectedObjectId ? [state.selectedObjectId] : [];
}

function createObjectIdForDuplicate(existingObjects: DirectorObject[], source: DirectorObject) {
  if (source.kind === "camera") {
    return getNextSequentialId(
      existingObjects.map((item) => item.id),
      "cam_object_",
      existingObjects.filter((item) => item.kind === "camera").length + 1
    );
  }

  if (source.kind === "character") {
    return getNextSequentialId(
      existingObjects.map((item) => item.id),
      "char_paste_",
      existingObjects.filter((item) => item.kind === "character").length + 1
    );
  }

  if (source.geometryType) {
    return getNextSequentialId(
      existingObjects.map((item) => item.id),
      `geo_${source.geometryType}_copy_`,
      existingObjects.length + 1
    );
  }

  return getNextSequentialId(existingObjects.map((item) => item.id), "obj_", existingObjects.length + 1);
}

function applyPositionOffset(position: [number, number, number], offset: number): [number, number, number] {
  return [position[0] + offset, position[1], position[2] + offset];
}

function applyOffsetToTransform(transform: DirectorTransform, offset: number): DirectorTransform {
  return {
    ...transform,
    position: applyPositionOffset(transform.position, offset),
  };
}

function buildClipboardEntries(state: DirectorState): DirectorClipboardEntry[] {
  const selectedObjectIds = getOrderedSelectedObjectIds(state);
  if (!selectedObjectIds.length) return [];

  return selectedObjectIds.flatMap((objectId) => {
    const object = state.project.objects.find((item) => item.id === objectId);
    if (!object) return [];

    const camera =
      object.kind === "camera" && object.linkedCameraId
        ? state.project.cameras.find((item) => item.id === object.linkedCameraId)
        : undefined;

    return [
      {
        object: cloneJsonValue(object),
        camera: camera ? cloneJsonValue(camera) : undefined,
      },
    ];
  });
}

function pasteClipboardEntries(state: DirectorRuntimeState): DirectorRuntimeState {
  if (state.clipboard.length === 0) return state;

  const pasteIteration = state.clipboardPasteCount + 1;
  const offset = COPY_PASTE_POSITION_OFFSET * pasteIteration;
  const nextObjects = [...state.project.objects];
  const nextCameras = [...state.project.cameras];
  const idMap = new Map<string, string>();
  const crowdIdMap = new Map<string, string>();
  const pastedObjectIds: string[] = [];

  function getPastedCrowdId(sourceCrowdId: string) {
    const existing = crowdIdMap.get(sourceCrowdId);
    if (existing) return existing;

    const nextCrowdId = getNextCrowdId(nextObjects);
    crowdIdMap.set(sourceCrowdId, nextCrowdId);
    return nextCrowdId;
  }

  state.clipboard.forEach((entry) => {
    if (entry.object.kind === "camera" && entry.camera) {
      const cameraIndex = nextCameras.length + 1;
      const nextCameraId = getNextSequentialId(
        nextCameras.map((item) => item.id),
        "cam_",
        cameraIndex
      );
      const nextObjectId = createObjectIdForDuplicate(nextObjects, entry.object);
      idMap.set(entry.object.id, nextObjectId);
      if (entry.object.linkedCameraId) {
        idMap.set(entry.object.linkedCameraId, nextCameraId);
      }

      const targetObjectId = entry.camera.targetObjectId ? idMap.get(entry.camera.targetObjectId) : null;
      const nextCamera: DirectorCameraShot = {
        ...entry.camera,
        id: nextCameraId,
        name: formatSceneItemName("机位", cameraIndex),
        transform: applyOffsetToTransform(entry.camera.transform, offset),
        target:
          entry.camera.targetMode === "manual" ? applyPositionOffset(entry.camera.target, offset) : entry.camera.target,
        targetObjectId: targetObjectId ?? entry.camera.targetObjectId ?? null,
        captures: [],
        lastCaptureUrl: null,
      };
      const nextCameraObject: DirectorObject = {
        ...entry.object,
        id: nextObjectId,
        name: nextCamera.name,
        linkedCameraId: nextCamera.id,
        transform: nextCamera.transform,
      };

      nextCameras.push(nextCamera);
      nextObjects.push(nextCameraObject);
      pastedObjectIds.push(nextObjectId);
      return;
    }

    const nextObjectId = createObjectIdForDuplicate(nextObjects, entry.object);
    idMap.set(entry.object.id, nextObjectId);
    const nextCharacterCount =
      entry.object.kind === "character" ? nextObjects.filter((item) => item.kind === "character").length + 1 : null;
    const duplicatedObject: DirectorObject = {
      ...entry.object,
      id: nextObjectId,
      name:
        entry.object.kind === "character" && nextCharacterCount
          ? formatSceneItemName("角色", nextCharacterCount)
          : entry.object.name,
      crowdId: entry.object.crowdId ? getPastedCrowdId(entry.object.crowdId) : entry.object.crowdId,
      transform: applyOffsetToTransform(entry.object.transform, offset),
    };

    nextObjects.push(duplicatedObject);
    pastedObjectIds.push(nextObjectId);
  });

  const nextObjectsById = new Map(nextObjects.map((item) => [item.id, item]));
  const normalizedCameras = nextCameras.map((camera) => {
    if (camera.targetMode !== "object" || !camera.targetObjectId) return camera;

    const mappedTargetObjectId = idMap.get(camera.targetObjectId) ?? camera.targetObjectId;
    const targetObject = nextObjectsById.get(mappedTargetObjectId);
    if (!targetObject) {
      return {
        ...camera,
        targetMode: "manual" as const,
        targetObjectId: null,
      };
    }

    return {
      ...camera,
      targetObjectId: mappedTargetObjectId,
      target: getDirectorObjectFocusTarget(targetObject),
    };
  });
  const lastPastedObject = pastedObjectIds.length
    ? nextObjects.find((item) => item.id === pastedObjectIds[pastedObjectIds.length - 1])
    : null;
  const pastedCrowdIds = Array.from(
    new Set(
      pastedObjectIds
        .map((objectId) => nextObjects.find((item) => item.id === objectId)?.crowdId)
        .filter((crowdId): crowdId is string => typeof crowdId === "string")
    )
  );

  return {
    ...state,
    selectedObjectId: pastedObjectIds[pastedObjectIds.length - 1] ?? null,
    selectedObjectIds: pastedObjectIds,
    selectedCrowdId: pastedCrowdIds.length === 1 ? pastedCrowdIds[0] : null,
    directorInspectorMode: "auto",
    clipboardPasteCount: pasteIteration,
    project: {
      ...state.project,
      objects: nextObjects,
      cameras: normalizedCameras,
      activeCameraId:
        lastPastedObject?.kind === "camera"
          ? lastPastedObject.linkedCameraId ?? state.project.activeCameraId
          : state.project.activeCameraId,
    },
  };
}

function isSameDirectorState(a: DirectorState, b: DirectorState) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function trimUndoStack(stack: DirectorState[]) {
  return stack.length > UNDO_STACK_LIMIT ? stack.slice(stack.length - UNDO_STACK_LIMIT) : stack;
}

export const useDirectorStore = create<DirectorStore>((set, get) => {
  const initialRuntimeState = createRuntimeStateFromPersistedState(
    createInitialDirectorState({ includePersistedLocalAssets: true, includePersistedScene: true })
  );

  function commitMutation(
    updater: (state: DirectorRuntimeState) => DirectorRuntimeState,
    options: { trackUndo?: boolean; persist?: boolean } = {}
  ) {
    const { trackUndo = true, persist = true } = options;

    set((state) => {
      const currentState = state as DirectorRuntimeState;
      const previousSnapshot = createUndoStackEntry(currentState);
      const nextState = updater(currentState);
      const nextSnapshot = extractPersistedDirectorState(nextState);
      const didChange = !isSameDirectorState(previousSnapshot, nextSnapshot);

      if (!didChange) {
        return {
          ...nextState,
          undoStack: trackUndo ? currentState.undoStack : nextState.undoStack,
          undoBatchDepth: nextState.undoBatchDepth,
          undoBatchSnapshot: nextState.undoBatchSnapshot,
          undoBatchHasTrackedChanges: nextState.undoBatchHasTrackedChanges,
        };
      }

      const shouldCaptureUndoBatchSnapshot =
        trackUndo && currentState.undoBatchDepth > 0 && currentState.undoBatchSnapshot === null;
      const nextUndoStack =
        trackUndo && currentState.undoBatchDepth === 0
          ? trimUndoStack([...currentState.undoStack, previousSnapshot])
          : nextState.undoStack;
      const runtimeState: DirectorRuntimeState = {
        ...nextState,
        undoStack: nextUndoStack,
        undoBatchSnapshot: shouldCaptureUndoBatchSnapshot ? previousSnapshot : nextState.undoBatchSnapshot,
        undoBatchHasTrackedChanges:
          trackUndo && currentState.undoBatchDepth > 0 ? true : nextState.undoBatchHasTrackedChanges,
      };

      if (persist) {
        writePersistedDirectorState(extractPersistedDirectorState(runtimeState));
      }

      return runtimeState;
    });
  }

  function commitUiMutation(updater: (state: DirectorRuntimeState) => DirectorRuntimeState) {
    commitMutation(updater, { trackUndo: false, persist: true });
  }

  return {
    ...initialRuntimeState,
    beginUndoBatch: () => {
      set((state) => {
        const currentState = state as DirectorRuntimeState;

        return {
          ...currentState,
          undoBatchDepth: currentState.undoBatchDepth + 1,
          undoBatchSnapshot: currentState.undoBatchDepth === 0 ? createUndoStackEntry(currentState) : currentState.undoBatchSnapshot,
          undoBatchHasTrackedChanges: currentState.undoBatchDepth === 0 ? false : currentState.undoBatchHasTrackedChanges,
        };
      });
    },
    endUndoBatch: () => {
      set((state) => {
        const currentState = state as DirectorRuntimeState;
        if (currentState.undoBatchDepth === 0) return currentState;

        const nextUndoBatchDepth = currentState.undoBatchDepth - 1;
        if (nextUndoBatchDepth > 0) {
          return {
            ...currentState,
            undoBatchDepth: nextUndoBatchDepth,
          };
        }

        const currentSnapshot = extractPersistedDirectorState(currentState);
        const shouldPushUndoEntry =
          currentState.undoBatchHasTrackedChanges &&
          currentState.undoBatchSnapshot !== null &&
          !isSameDirectorState(currentState.undoBatchSnapshot, currentSnapshot);

        return {
          ...currentState,
          undoStack: shouldPushUndoEntry
            ? trimUndoStack([...currentState.undoStack, currentState.undoBatchSnapshot!])
            : currentState.undoStack,
          undoBatchDepth: 0,
          undoBatchSnapshot: null,
          undoBatchHasTrackedChanges: false,
        };
      });
    },
    setTransformMode: (mode) =>
      commitUiMutation((state) => ({
        ...state,
        transformMode: mode,
      })),
    setViewportAspectRatio: (ratio) =>
      commitUiMutation((state) => ({
        ...state,
        viewportAspectRatio: ratio,
      })),
    setViewportRuleOfThirdsEnabled: (enabled) =>
      commitUiMutation((state) => ({
        ...state,
        viewportRuleOfThirdsEnabled: enabled,
      })),
    toggleViewportPanelsCollapsed: () =>
      commitUiMutation((state) => ({
        ...state,
        viewportPanelsCollapsed: !state.viewportPanelsCollapsed,
      })),
    setViewportPanelsCollapsed: (collapsed) =>
      commitUiMutation((state) => ({
        ...state,
        viewportPanelsCollapsed: collapsed,
      })),
    setViewMode: (mode) =>
      commitUiMutation((state) => ({
        ...state,
        viewMode: mode,
        project: {
          ...state.project,
          activeCameraId:
            mode === "camera"
              ? state.project.activeCameraId ?? state.project.cameras[0]?.id ?? null
              : state.project.activeCameraId,
        },
      })),
    selectObject: (id) =>
      commitUiMutation((state) => {
        const selectedObject = state.project.objects.find((item) => item.id === id);

        return {
          ...state,
          selectedObjectId: id,
          selectedObjectIds: id ? [id] : [],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            activeCameraId:
              selectedObject?.kind === "camera" && selectedObject.linkedCameraId
                ? selectedObject.linkedCameraId
                : state.project.activeCameraId,
          },
        };
      }),
    selectCrowd: (crowdId) =>
      commitUiMutation((state) => {
        if (!crowdId) {
          return {
            ...state,
            selectedCrowdId: null,
            selectedObjectId: null,
            selectedObjectIds: [],
          };
        }

        const crowdMemberIds = getCrowdMemberIds(state.project.objects, crowdId);
        if (!crowdMemberIds.length) return state;

        return {
          ...state,
          selectedCrowdId: crowdId,
          selectedObjectId: crowdMemberIds[crowdMemberIds.length - 1] ?? null,
          selectedObjectIds: crowdMemberIds,
          directorInspectorMode: "auto",
        };
      }),
    toggleObjectSelection: (id) =>
      commitUiMutation((state) => {
        const selectedObject = state.project.objects.find((item) => item.id === id);
        if (!selectedObject) return state;

        const selectedObjectIds = getOrderedSelectedObjectIds(state);
        const nextSelectedObjectIds = selectedObjectIds.includes(id)
          ? selectedObjectIds.filter((itemId) => itemId !== id)
          : [...selectedObjectIds, id];
        const nextSelectedObjectId = nextSelectedObjectIds[nextSelectedObjectIds.length - 1] ?? null;

        return {
          ...state,
          selectedObjectId: nextSelectedObjectId,
          selectedObjectIds: nextSelectedObjectIds,
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            activeCameraId:
              selectedObject.kind === "camera" && selectedObject.linkedCameraId
                ? selectedObject.linkedCameraId
                : state.project.activeCameraId,
          },
        };
      }),
    openSceneInspector: () =>
      commitUiMutation((state) => ({
        ...state,
        directorInspectorMode: "scene",
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCrowdId: null,
      })),
    updateScene: (patch) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            ...patch,
          },
        },
      })),
    removePanoramaAsset: () =>
      commitMutation((state) => {
        const panoramaAssetId = state.project.panoramaAssetId;
        if (!panoramaAssetId) return state;

        return {
          ...state,
          project: {
            ...state.project,
            assets: state.project.assets.filter((item) => item.id !== panoramaAssetId),
            panoramaAssetId: null,
          },
        };
      }),
    removeImportedAsset: (assetId) =>
      commitMutation((state) => {
        const targetAsset = state.project.assets.find((item) => item.id === assetId);
        if (!targetAsset || targetAsset.sourceType !== "model") return state;

        removePersistedLocalModelAsset(assetId);

        const removedObjectIds = new Set(
          state.project.objects.filter((item) => item.assetRefId === assetId).map((item) => item.id)
        );
        const nextObjects = state.project.objects.filter((item) => item.assetRefId !== assetId);
        const nextCameras = state.project.cameras.map((camera) =>
          camera.targetObjectId && removedObjectIds.has(camera.targetObjectId)
            ? {
                ...camera,
                targetMode: "manual" as const,
                targetObjectId: null,
              }
            : camera
        );
        const selectedObjectIds = state.selectedObjectIds.filter((id) => !removedObjectIds.has(id));
        const selectedObjectId =
          state.selectedObjectId && removedObjectIds.has(state.selectedObjectId)
            ? selectedObjectIds[selectedObjectIds.length - 1] ?? null
            : state.selectedObjectId;

        return {
          ...state,
          selectedObjectId,
          selectedObjectIds,
          selectedCrowdId: null,
          project: {
            ...state.project,
            assets: state.project.assets.filter((item) => item.id !== assetId),
            objects: nextObjects,
            cameras: nextCameras,
          },
        };
      }),
    updateObjectTransform: (id, patch) =>
      commitMutation((state) => {
        const currentObject = state.project.objects.find((item) => item.id === id);
        const nextTransform = currentObject
          ? {
              position: patch.position ?? currentObject.transform.position,
              rotation: patch.rotation ?? currentObject.transform.rotation,
              scale: patch.scale ?? currentObject.transform.scale,
            }
          : null;
        const nextObject = currentObject && nextTransform ? { ...currentObject, transform: nextTransform } : null;

        return {
          ...state,
          project: {
            ...state.project,
            objects: updateObjectById(state.project.objects, id, (item) => ({
              ...item,
              transform: {
                position: patch.position ?? item.transform.position,
                rotation: patch.rotation ?? item.transform.rotation,
                scale: patch.scale ?? item.transform.scale,
              },
            })),
            cameras:
              currentObject?.kind === "camera" && currentObject.linkedCameraId && nextTransform
                ? state.project.cameras.map((camera) =>
                    camera.id === currentObject.linkedCameraId
                      ? {
                          ...camera,
                          transform: nextTransform,
                        }
                      : camera
                  )
                : nextObject
                  ? refreshCamerasFocusedOnObject(state.project.cameras, nextObject)
                  : state.project.cameras,
          },
        };
      }),
    updateCrowdTransform: (crowdId, patch) =>
      commitMutation((state) => {
        const nextTransformState = applyCrowdTransformPatch(state.project.objects, crowdId, patch);
        if (nextTransformState.changedObjectIds.length === 0) return state;

        return {
          ...state,
          project: {
            ...state.project,
            objects: nextTransformState.objects,
            cameras: refreshCamerasFocusedOnObjects(
              state.project.cameras,
              nextTransformState.objects,
              nextTransformState.changedObjectIds
            ),
          },
        };
      }),
    updateObjectName: (id, name) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            name,
          })),
        },
      })),
    updateCrowdLabel: (crowdId, label) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: state.project.objects.map((item) =>
            item.kind === "character" && item.crowdId === crowdId
              ? {
                  ...item,
                  crowdLabel: label,
                }
              : item
          ),
        },
      })),
    updateObjectColor: (id, color) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            color,
          })),
        },
      })),
    updateCrowdColor: (crowdId, color) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: state.project.objects.map((item) =>
            item.kind === "character" && item.crowdId === crowdId
              ? {
                  ...item,
                  color,
                }
              : item
          ),
        },
      })),
    updateCharacterBodyType: (id, bodyType) =>
      commitMutation((state) => {
        const normalizedBodyType = normalizeBodyType(bodyType);
        const currentObject = state.project.objects.find((item) => item.id === id);
        const nextObject =
          currentObject?.kind === "character"
            ? {
                ...currentObject,
                bodyType: normalizedBodyType,
              }
            : null;

        return {
          ...state,
          project: {
            ...state.project,
            objects: updateObjectById(state.project.objects, id, (item) =>
              item.kind === "character"
                ? {
                    ...item,
                    bodyType: normalizedBodyType,
                  }
                : item
            ),
            cameras: nextObject ? refreshCamerasFocusedOnObject(state.project.cameras, nextObject) : state.project.cameras,
          },
        };
      }),
    updateUniformScale: (id, scale) =>
      commitMutation((state) => {
        const currentObject = state.project.objects.find((item) => item.id === id);
        const nextObject = currentObject
          ? {
              ...currentObject,
              transform: {
                ...currentObject.transform,
                scale: [scale, scale, scale] as [number, number, number],
              },
            }
          : null;

        return {
          ...state,
          project: {
            ...state.project,
            objects: updateObjectById(state.project.objects, id, (item) => ({
              ...item,
              transform: {
                ...item.transform,
                scale: [scale, scale, scale],
              },
            })),
            cameras: nextObject ? refreshCamerasFocusedOnObject(state.project.cameras, nextObject) : state.project.cameras,
          },
        };
      }),
    updateCrowdUniformScale: (crowdId, scale) =>
      commitMutation((state) => {
        const nextTransformState = applyCrowdTransformPatch(state.project.objects, crowdId, {
          scale: [scale, scale, scale],
        });
        if (nextTransformState.changedObjectIds.length === 0) return state;

        return {
          ...state,
          project: {
            ...state.project,
            objects: nextTransformState.objects,
            cameras: refreshCamerasFocusedOnObjects(
              state.project.cameras,
              nextTransformState.objects,
              nextTransformState.changedObjectIds
            ),
          },
        };
      }),
    addImportedAsset: (input) =>
      commitMutation((state) => {
        const assetId = getNextSequentialId(
          state.project.assets.map((item) => item.id),
          "asset_",
          state.project.assets.length + 1
        );
        const nextAsset = {
          id: assetId,
          kind: input.kind,
          sourceType: input.kind === "panorama" ? "image" : "model",
          fileName: input.fileName,
          name: input.name,
          url: input.url,
          assetSource: input.kind === "panorama" ? undefined : (input.assetSource ?? "local"),
          projectionMode: input.projectionMode,
        } satisfies DirectorAssetRef;

        if (input.kind === "panorama") {
          return {
            ...state,
            directorInspectorMode: "scene",
            selectedObjectId: null,
            selectedObjectIds: [],
            selectedCrowdId: null,
            project: {
              ...state.project,
              assets: [...state.project.assets, nextAsset],
              panoramaAssetId: assetId,
            },
          };
        }

        if (input.addToScene === false) {
          persistLocalModelAsset(nextAsset);

          return {
            ...state,
            project: {
              ...state.project,
              assets: [...state.project.assets, nextAsset],
            },
          };
        }

        const nextObject = createSceneObjectFromAsset(nextAsset, state.project.objects);

        return {
          ...state,
          selectedObjectId: nextObject.id,
          selectedObjectIds: [nextObject.id],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            assets: [...state.project.assets, nextAsset],
            objects: [...state.project.objects, nextObject],
          },
        };
      }),
    addObjectFromAsset: (assetId) => {
      let nextObjectId: string | null = null;

      commitMutation((state) => {
        const asset = state.project.assets.find((item) => item.id === assetId);
        if (!asset || asset.sourceType !== "model" || asset.kind === "panorama") return state;

        const nextObject = createSceneObjectFromAsset(asset, state.project.objects);
        nextObjectId = nextObject.id;

        return {
          ...state,
          selectedObjectId: nextObject.id,
          selectedObjectIds: [nextObject.id],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            objects: [...state.project.objects, nextObject],
          },
        };
      });

      return nextObjectId;
    },
    addPresetCharacter: (bodyType = DEFAULT_CHARACTER_BODY_TYPE) =>
      commitMutation((state) => {
        const presetCharacterCount = state.project.objects.filter(
          (item) => item.kind === "character" && item.id.startsWith("char_preset_")
        ).length;
        const presetCharacterIndex = presetCharacterCount + 1;
        const row = Math.floor((presetCharacterIndex - 1) / 4);
        const x = getAddedModelColumnOffset(presetCharacterIndex - row * 4);
        const z = row * 0.8;
        const nextObject = buildPresetCharacterObject(state, bodyType, [x, 0, z]);

        return {
          ...state,
          selectedObjectId: nextObject.id,
          selectedObjectIds: [nextObject.id],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            objects: [...state.project.objects, nextObject],
          },
        };
      }),
    addCrowdCharacters: ({ bodyType = DEFAULT_CHARACTER_BODY_TYPE, rows, columns, spacing }) => {
      const createdIds: string[] = [];

      commitMutation((state) => {
        const positions = getCrowdCharacterPositions(rows, columns, spacing);
        const offset = getCrowdCharacterOffset(state.project.objects, spacing);
        const nextObjects = [...state.project.objects];
        const crowdLabel = formatCrowdLabel(rows, columns);
        const crowdId = getNextCrowdId(state.project.objects);

        positions.forEach((position) => {
          const nextState = {
            ...state,
            project: {
              ...state.project,
              objects: nextObjects,
            },
          } as DirectorRuntimeState;
          const nextObject = buildPresetCharacterObject(nextState, bodyType, [
            Number((position[0] + offset[0]).toFixed(4)),
            Number((position[1] + offset[1]).toFixed(4)),
            Number((position[2] + offset[2]).toFixed(4)),
          ], {
            crowdId,
            crowdLabel,
          });
          nextObjects.push(nextObject);
          createdIds.push(nextObject.id);
        });

        if (!createdIds.length) return state;

        return {
          ...state,
          selectedObjectId: createdIds[createdIds.length - 1] ?? null,
          selectedObjectIds: createdIds,
          selectedCrowdId: crowdId,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            objects: nextObjects,
          },
        };
      });

      return createdIds;
    },
    addGeometryPrimitive: (geometryType) =>
      commitMutation((state) => {
        const geometryObjects = state.project.objects.filter((item) => item.kind === "prop" && item.geometryType);
        const geometryIndex = geometryObjects.length + 1;
        const sameTypeCount = geometryObjects.filter((item) => item.geometryType === geometryType).length;
        const row = Math.floor((geometryIndex - 1) / 4);
        const column = (geometryIndex - 1) % 4;
        const x = column * 1.15 - 1.725;
        const z = row * 0.75 + 1.15;
        const label = getGeometryPrimitiveLabel(geometryType);
        const objectId = getNextSequentialId(
          state.project.objects.map((item) => item.id),
          `geo_${geometryType}_`,
          geometryIndex
        );
        const nextObject: DirectorObject = {
          id: objectId,
          name: sameTypeCount === 0 ? label : `${label}${String(sameTypeCount + 1).padStart(2, "0")}`,
          kind: "prop",
          visible: true,
          locked: false,
          geometryType,
          color: GEOMETRY_PRIMITIVE_COLOR,
          transform: createTransform([x, 0, z]),
        };

        return {
          ...state,
          selectedObjectId: objectId,
          selectedObjectIds: [objectId],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            objects: [...state.project.objects, nextObject],
          },
        };
      }),
    addCameraShot: (snapshot) => {
      let nextCameraId = "";

      commitMutation((state) => {
        const cameraIndex = state.project.cameras.length + 1;
        const cameraId = getNextSequentialId(
          state.project.cameras.map((item) => item.id),
          "cam_",
          cameraIndex
        );
        const objectId = getNextSequentialId(
          state.project.objects.map((item) => item.id),
          "cam_object_",
          cameraIndex
        );
        nextCameraId = cameraId;
        const transform = createTransform(
          snapshot ? getCameraRigPositionFromViewSnapshot(snapshot) : [cameraIndex * 1.2, 2.2, 9]
        );
        const nextCamera: DirectorCameraShot = {
          id: cameraId,
          name: formatSceneItemName("机位", cameraIndex),
          fov: snapshot?.fov ?? 50,
          transform,
          targetMode: "manual",
          target: snapshot?.target ?? [0, 1.2, 0],
          lastCaptureUrl: null,
          captures: [],
        };
        const nextCameraObject: DirectorObject = {
          id: objectId,
          name: nextCamera.name,
          kind: "camera",
          visible: true,
          locked: false,
          linkedCameraId: cameraId,
          transform,
        };

        return {
          ...state,
          selectedObjectId: objectId,
          selectedObjectIds: [objectId],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            cameras: [...state.project.cameras, nextCamera],
            activeCameraId: cameraId,
            objects: [...state.project.objects, nextCameraObject],
          },
        };
      });

      return nextCameraId;
    },
    deleteSelectedObject: () =>
      commitMutation((state) => {
        const selectedObjectIds = getOrderedSelectedObjectIds(state);
        if (!selectedObjectIds.length) return state;

        const selectedObjects = state.project.objects.filter((item) => selectedObjectIds.includes(item.id));
        if (!selectedObjects.length) {
          return {
            ...state,
            selectedObjectId: null,
            selectedObjectIds: [],
          };
        }

        const linkedCameraIds = new Set(
          selectedObjects
            .filter((item) => item.kind === "camera" && item.linkedCameraId)
            .map((item) => item.linkedCameraId)
        );
        const nextCameras = linkedCameraIds.size
          ? state.project.cameras.filter((camera) => !linkedCameraIds.has(camera.id))
          : state.project.cameras;
        const selectedObjectIdSet = new Set(selectedObjectIds);
        const nextFocusedCameras = nextCameras.map((camera) =>
          camera.targetObjectId && selectedObjectIdSet.has(camera.targetObjectId)
            ? {
                ...camera,
                targetMode: "manual" as const,
                targetObjectId: null,
              }
            : camera
        );
        const nextActiveCameraId =
          state.project.activeCameraId && linkedCameraIds.has(state.project.activeCameraId)
            ? nextFocusedCameras[0]?.id ?? null
            : state.project.activeCameraId;
        const nextObjects = state.project.objects.filter((item) => !selectedObjectIds.includes(item.id));
        const assetsById = new Map(state.project.assets.map((item) => [item.id, item]));
        const remainingAssetRefIds = new Set(
          nextObjects.map((item) => item.assetRefId).filter((assetRefId): assetRefId is string => Boolean(assetRefId))
        );
        const removedAssetRefIds = new Set(
          selectedObjects
            .map((item) => item.assetRefId)
            .filter(
              (assetRefId): assetRefId is string => {
                if (typeof assetRefId !== "string" || remainingAssetRefIds.has(assetRefId)) return false;
                return assetsById.get(assetRefId)?.assetSource !== "local";
              }
            )
        );

        return {
          ...state,
          selectedObjectId: null,
          selectedObjectIds: [],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            assets: state.project.assets.filter((item) => !removedAssetRefIds.has(item.id)),
            objects: nextObjects,
            cameras: nextFocusedCameras,
            activeCameraId: nextActiveCameraId,
          },
        };
      }),
    toggleObjectVisible: (id) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            visible: !item.visible,
          })),
        },
      })),
    toggleObjectLocked: (id) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            locked: !item.locked,
          })),
        },
      })),
    applyPosePreset: (id, presetId) =>
      commitMutation((state) => {
        const preset = MANNEQUIN_POSE_PRESETS.find((item) => item.id === presetId);

        return {
          ...state,
          project: {
            ...state.project,
            objects: updateObjectById(state.project.objects, id, (item) => ({
              ...item,
              characterRig: item.characterRig
                ? {
                    ...item.characterRig,
                    posePresetId: presetId,
                    controls: preset ? { ...preset.controls } : item.characterRig.controls,
                  }
                : item.characterRig,
            })),
          },
        };
      }),
    applyCrowdPosePreset: (crowdId, presetId) =>
      commitMutation((state) => {
        const preset = MANNEQUIN_POSE_PRESETS.find((item) => item.id === presetId);

        return {
          ...state,
          project: {
            ...state.project,
            objects: state.project.objects.map((item) =>
              item.kind === "character" && item.crowdId === crowdId
                ? {
                    ...item,
                    characterRig: item.characterRig
                      ? {
                          ...item.characterRig,
                          posePresetId: presetId,
                          controls: preset ? { ...preset.controls } : item.characterRig.controls,
                        }
                      : item.characterRig,
                  }
                : item
            ),
          },
        };
      }),
    updatePoseControl: (id, key, value) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            characterRig: item.characterRig
              ? {
                  ...item.characterRig,
                  controls: {
                    ...item.characterRig.controls,
                    [key]: value,
                  },
                }
              : item.characterRig,
            })),
        },
      })),
    updateCrowdPoseControl: (crowdId, key, value) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: state.project.objects.map((item) =>
            item.kind === "character" && item.crowdId === crowdId
              ? {
                  ...item,
                  characterRig: item.characterRig
                    ? {
                        ...item.characterRig,
                        controls: {
                          ...item.characterRig.controls,
                          [key]: value,
                        },
                      }
                    : item.characterRig,
                }
              : item
          ),
        },
      })),
    setActiveCamera: (cameraId) =>
      commitUiMutation((state) => {
        const selectedObjectId =
          state.project.objects.find((item) => item.kind === "camera" && item.linkedCameraId === cameraId)?.id ??
          null;

        return {
          ...state,
          project: {
            ...state.project,
            activeCameraId: cameraId,
          },
          selectedObjectId,
          selectedObjectIds: selectedObjectId ? [selectedObjectId] : [],
          selectedCrowdId: null,
        };
      }),
    addCameraCaptures: (cameraId, dataUrls) =>
      commitMutation((state) => {
        if (dataUrls.length === 0) return state;

        const targetCameraId = cameraId ?? state.project.activeCameraId ?? state.project.cameras[0]?.id ?? null;
        if (!targetCameraId) return state;

        let updated = false;
        const cameras = state.project.cameras.map((camera) => {
          if (camera.id !== targetCameraId) return camera;

          updated = true;
          const nextCaptures = buildCameraCaptures(camera, dataUrls);

          return {
            ...camera,
            lastCaptureUrl: nextCaptures[nextCaptures.length - 1]?.dataUrl ?? camera.lastCaptureUrl ?? null,
            captures: [...(camera.captures ?? []), ...nextCaptures],
          };
        });

        if (!updated) return state;

        return {
          ...state,
          project: {
            ...state.project,
            cameras,
          },
        };
      }),
    updateCamera: (cameraId, patch) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          cameras: state.project.cameras.map((item) =>
            item.id === cameraId
              ? {
                  ...item,
                  ...patch,
                  transform: patch.transform ?? item.transform,
                  target: patch.target ?? item.target,
                }
              : item
          ),
          objects: state.project.objects.map((item) =>
            item.kind === "camera" && item.linkedCameraId === cameraId && patch.transform
              ? { ...item, transform: patch.transform }
              : item
          ),
        },
      })),
    recordCameraNode: (cameraId, input) =>
      commitMutation((state) => {
        const camera = state.project.cameras.find((item) => item.id === cameraId);
        if (!camera) return state;

        const existingNodes = camera.nodes ?? [];
        const nodeId = getNextSequentialId(
          existingNodes.map((item) => item.id),
          "node_",
          existingNodes.length + 1
        );
        const lastNode = existingNodes[existingNodes.length - 1];
        const lastSegment = camera.segments?.[camera.segments.length - 1];
        const nextTime = lastNode
          ? lastNode.time + (lastSegment?.duration ?? 1) + (lastSegment?.holdAfter ?? 0)
          : 0;
        const nextNodes: CameraNode[] = [
          ...existingNodes,
          {
            id: nodeId,
            position: input.position,
            rotation: input.rotation,
            fov: input.fov,
            time: Number(nextTime.toFixed(6)),
          },
        ];
        const nextCamera = rebuildCameraTiming({ ...camera, nodes: nextNodes });

        return applyCameraPose(
          {
            ...state,
            project: { ...state.project, cameras: state.project.cameras.map((item) => (item.id === cameraId ? nextCamera : item)) },
          },
          cameraId,
          input,
          nextCamera.nodes
        );
      }),
    syncCameraPose: (cameraId, input) =>
      commitMutation((state) => {
        const camera = state.project.cameras.find((item) => item.id === cameraId);
        if (!camera) return state;
        return applyCameraPose(state, cameraId, input, camera.nodes);
      }),
    applyPlaybackPose: (cameraId, input) =>
      commitMutation(
        (state) => {
          const camera = state.project.cameras.find((item) => item.id === cameraId);
          if (!camera) return state;
          return applyCameraPose(state, cameraId, input, camera.nodes);
        },
        { trackUndo: false, persist: false }
      ),
    updateCameraNode: (cameraId, nodeId, patch) =>
      commitMutation((state) => {
        const camera = state.project.cameras.find((item) => item.id === cameraId);
        if (!camera?.nodes) return state;

        const nodes = camera.nodes.map((node) =>
          node.id === nodeId ? { ...node, ...patch, id: node.id, time: node.time } : node
        );

        return {
          ...state,
          project: {
            ...state.project,
            cameras: state.project.cameras.map((item) => (item.id === cameraId ? rebuildCameraTiming({ ...camera, nodes }) : item)),
          },
        };
      }),
    updateCameraNodeTime: (cameraId, nodeId, time) =>
      commitMutation((state) => {
        const camera = state.project.cameras.find((item) => item.id === cameraId);
        if (!camera?.nodes) return state;

        const index = camera.nodes.findIndex((node) => node.id === nodeId);
        if (index < 0) return state;

        const segments = buildCameraSegments(camera.nodes, camera.segments);
        const clampedTime = clampNodeTime(camera.nodes, segments, index, time);
        if (clampedTime === camera.nodes[index].time) return state;

        const nodes = camera.nodes.map((node, nodeIndex) => (nodeIndex === index ? { ...node, time: clampedTime } : node));
        const nextSegments = segments.map((segment, segmentIndex) => {
          if (segmentIndex !== index - 1) return segment;
          // 拖拽节点 = 改变前一段的运动时长，holdAfter 不动
          const previousNode = nodes[index - 1];
          return {
            ...segment,
            duration: Number(Math.max(clampedTime - previousNode.time - segment.holdAfter, MIN_SEGMENT_DURATION).toFixed(6)),
          };
        });
        const syncedNodes = syncNodeTimes(nodes, nextSegments);

        return {
          ...state,
          project: {
            ...state.project,
            cameras: state.project.cameras.map((item) =>
              item.id === cameraId ? { ...camera, nodes: syncedNodes, segments: nextSegments } : item
            ),
          },
        };
      }),
    addCameraNode: (cameraId, afterNodeId) =>
      commitMutation((state) => {
        const camera = state.project.cameras.find((item) => item.id === cameraId);
        if (!camera) return state;

        const nodes = camera.nodes ?? [];
        const insertIndex = afterNodeId
          ? nodes.findIndex((node) => node.id === afterNodeId) + 1
          : nodes.length;
        if (insertIndex < 0 || insertIndex > nodes.length) return state;

        const nodeId = getNextSequentialId(
          nodes.map((item) => item.id),
          "node_",
          nodes.length + 1
        );
        const previousNode = nodes[insertIndex - 1] ?? null;
        const nextNode = nodes[insertIndex] ?? null;
        const segments = buildCameraSegments(nodes, camera.segments);

        let nextCameraNode: CameraNode;
        if (previousNode && nextNode) {
          // 插在中间：取两端中点姿态，时间居中，旧段缓动/停顿继承到两段
          const oldSegment = segments[insertIndex - 1];
          const midpoint: [number, number, number] = [
            (previousNode.position[0] + nextNode.position[0]) / 2,
            (previousNode.position[1] + nextNode.position[1]) / 2,
            (previousNode.position[2] + nextNode.position[2]) / 2,
          ];
          const previousRotation = new Quaternion(...previousNode.rotation).normalize();
          const nextRotation = new Quaternion(...nextNode.rotation).normalize();
          const midpointRotation = previousRotation.clone().slerp(nextRotation, 0.5);
          const midpointTime = clampNodeTime(nodes, segments, insertIndex, (previousNode.time + nextNode.time) / 2);

          nextCameraNode = {
            id: nodeId,
            position: midpoint,
            rotation: [midpointRotation.x, midpointRotation.y, midpointRotation.z, midpointRotation.w],
            fov: (previousNode.fov + nextNode.fov) / 2,
            time: midpointTime,
          };
          const nextNodes = [...nodes.slice(0, insertIndex), nextCameraNode, ...nodes.slice(insertIndex)];
          const mergedSegments = buildCameraSegments(nextNodes, segments).map((segment, segmentIndex) => {
            if (segmentIndex === insertIndex - 1) {
              return { ...segment, easing: oldSegment?.easing ?? "linear", holdAfter: 0 };
            }
            if (segmentIndex === insertIndex) {
              // 旧段 hold 归属终点节点：继承到新节点→旧终点段，duration 扣除 hold 部分
              const inheritedHold = oldSegment?.holdAfter ?? 0;
              return {
                ...segment,
                easing: oldSegment?.easing ?? "linear",
                holdAfter: inheritedHold,
                duration: Number(Math.max(segment.duration - inheritedHold, MIN_SEGMENT_DURATION).toFixed(6)),
              };
            }
            return segment;
          });

          return {
            ...state,
            project: {
              ...state.project,
              cameras: state.project.cameras.map((item) =>
                item.id === cameraId
                  ? { ...camera, nodes: syncNodeTimes(nextNodes, mergedSegments), segments: mergedSegments }
                  : item
              ),
            },
          };
        }

        // 追加（或无节点时创建第一个）：取当前机位取景姿态
        const snapshot = getCameraViewSnapshotFromShot(camera);
        const rotation = getLookAtQuaternion(snapshot.position, snapshot.target);
        nextCameraNode = {
          id: nodeId,
          position: snapshot.position,
          rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
          fov: camera.fov,
          time: previousNode
            ? previousNode.time + (segments[segments.length - 1]?.duration ?? 1) + (segments[segments.length - 1]?.holdAfter ?? 0)
            : 0,
        };
        const nextNodes = [...nodes, nextCameraNode];

        return {
          ...state,
          project: {
            ...state.project,
            cameras: state.project.cameras.map((item) =>
              item.id === cameraId ? rebuildCameraTiming({ ...camera, nodes: nextNodes }) : item
            ),
          },
        };
      }),
    deleteCameraNode: (cameraId, nodeId) =>
      commitMutation((state) => {
        const camera = state.project.cameras.find((item) => item.id === cameraId);
        if (!camera?.nodes) return state;

        const nextNodes = camera.nodes.filter((node) => node.id !== nodeId);
        if (nextNodes.length === camera.nodes.length) return state;

        return {
          ...state,
          project: {
            ...state.project,
            cameras: state.project.cameras.map((item) =>
              item.id === cameraId ? rebuildCameraTiming({ ...camera, nodes: nextNodes }) : item
            ),
          },
        };
      }),
    updateCameraSegment: (cameraId, segmentId, patch) =>
      commitMutation((state) => {
        const camera = state.project.cameras.find((item) => item.id === cameraId);
        if (!camera?.nodes) return state;

        const segments = buildCameraSegments(camera.nodes, camera.segments);
        const nextSegments = segments.map((segment) =>
          segment.id === segmentId
            ? {
                ...segment,
                ...patch,
                duration: patch.duration
                  ? Number(Math.max(patch.duration, MIN_SEGMENT_DURATION).toFixed(6))
                  : segment.duration,
                holdAfter: patch.holdAfter ? Number(Math.max(patch.holdAfter, 0).toFixed(6)) : segment.holdAfter,
              }
            : segment
        );

        const cameraNodes = camera.nodes;
        return {
          ...state,
          project: {
            ...state.project,
            cameras: state.project.cameras.map((item) =>
              item.id === cameraId
                ? { ...camera, segments: nextSegments, nodes: syncNodeTimes(cameraNodes, nextSegments) }
                : item
            ),
          },
        };
      }),
    setSegmentCurveMode: (cameraId, segmentId, mode) =>
      commitMutation((state) => {
        const camera = state.project.cameras.find((item) => item.id === cameraId);
        if (!camera?.nodes) return state;

        const segments = buildCameraSegments(camera.nodes, camera.segments);
        const nextSegments = segments.map((segment) => {
          if (segment.id !== segmentId) return segment;

          if (mode === "bezier") {
            const fromNode = camera.nodes?.find((node) => node.id === segment.fromNodeId);
            const toNode = camera.nodes?.find((node) => node.id === segment.toNodeId);
            if (!fromNode || !toNode) return segment;

            const handles = getDefaultBezierHandles(fromNode.position, toNode.position);
            return {
              ...segment,
              curveMode: mode,
              handleOut: segment.handleOut ?? handles.handleOut,
              handleIn: segment.handleIn ?? handles.handleIn,
            };
          }

          return { ...segment, curveMode: mode };
        });

        return {
          ...state,
          project: {
            ...state.project,
            cameras: state.project.cameras.map((item) =>
              item.id === cameraId ? { ...camera, segments: nextSegments } : item
            ),
          },
        };
      }),
    copySelectedObjects: () => {
      const currentState = get() as DirectorRuntimeState;
      const clipboard = buildClipboardEntries(currentState);
      set({
        ...currentState,
        clipboard,
        clipboardPasteCount: 0,
      });
    },
    pasteClipboardObjects: () => commitMutation((state) => pasteClipboardEntries(state)),
    undo: () => {
      const currentState = get() as DirectorRuntimeState;
      const previousState = currentState.undoStack[currentState.undoStack.length - 1];
      if (!previousState) return;

      const runtimeState = createRuntimeStateFromPersistedState(previousState);
      set({
        ...runtimeState,
        clipboard: currentState.clipboard,
        clipboardPasteCount: currentState.clipboardPasteCount,
        undoStack: currentState.undoStack.slice(0, -1),
      });
      writePersistedDirectorState(previousState);
    },
    openScopedScene: (scopeId) => {
      const currentState = get() as DirectorRuntimeState;
      setDirectorScenePersistenceScopeId(scopeId);
      const snapshot = createInitialDirectorState({
        includePersistedLocalAssets: true,
        includePersistedScene: true,
        persistenceScopeId: directorScenePersistenceScopeId,
      });
      const runtimeState = createRuntimeStateFromPersistedState(snapshot);

      set({
        ...runtimeState,
        clipboard: currentState.clipboard,
        clipboardPasteCount: currentState.clipboardPasteCount,
        undoStack: [],
      });
      writePersistedDirectorState(snapshot);
    },
    replaceProject: (project) =>
      commitMutation((state) => ({
        ...state,
        project: cloneJsonValue(project),
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCrowdId: null,
        directorInspectorMode: "auto",
      })),
    saveLatestSnapshot: () => {
      writePersistedDirectorState(extractPersistedDirectorState(get() as DirectorRuntimeState));
    },
    restoreLatestSnapshot: () => {
      const snapshot = readPersistedDirectorState({ includePersistedLocalAssets: true, includePersistedScene: true });
      if (!snapshot) return;

      set({
        ...createRuntimeStateFromPersistedState(snapshot),
        clipboard: (get() as DirectorRuntimeState).clipboard,
        clipboardPasteCount: (get() as DirectorRuntimeState).clipboardPasteCount,
        undoStack: [],
      });
      writePersistedDirectorState(snapshot);
    },
  };
});
