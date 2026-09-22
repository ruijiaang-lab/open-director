import type {
  CameraNode,
  CameraSegment,
  CharacterBodyType,
  CharacterRigType,
  DirectorAssetKind,
  DirectorAssetRef,
  DirectorCameraCapture,
  DirectorCameraShot,
  DirectorObject,
  DirectorProject,
  DirectorTransform,
  GeometryPrimitiveType,
  PanoramaProjectionMode,
  SceneSettings,
} from "../schema/directorProject";

type RecordValue = Record<string, unknown>;

const ASSET_KINDS: readonly DirectorAssetKind[] = ["character", "scene", "prop", "panorama"];
const ASSET_SOURCE_TYPES = ["model", "image"] as const;
const ASSET_SOURCES = ["local", "library"] as const;
const PROJECTION_MODES: readonly PanoramaProjectionMode[] = ["equirectangular", "backdrop"];
const OBJECT_KINDS = ["character", "scene", "prop", "camera", "panorama"] as const;
const BODY_TYPES: readonly CharacterBodyType[] = [
  "mannequin",
  "female",
  "broad",
  "muscular",
  "slim",
  "teen",
  "child",
  "chibi",
];
const RIG_TYPES: readonly CharacterRigType[] = ["mannequin", "ue4-mannequin", "mixamo", "vrm", "custom-humanoid"];
const GEOMETRY_TYPES: readonly GeometryPrimitiveType[] = ["box", "sphere", "cylinder", "torus", "cone", "pyramid"];
const CAMERA_TARGET_MODES = ["manual", "object"] as const;
const CAMERA_TARGET_OBJECT_KINDS = ["character", "scene", "prop"] as const;
const SEGMENT_CURVE_MODES = ["linear", "bezier"] as const;
const SEGMENT_EASINGS = ["linear", "ease-in", "ease-out", "ease-in-out"] as const;

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function expectRecord(value: unknown, path: string): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "必须是对象");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, "必须是普通对象");
  }

  return value as RecordValue;
}

function expectDenseArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "必须是数组");

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      fail(`${path}[${index}]`, "数组不能有空洞");
    }
  }

  return value;
}

function expectArray(value: unknown, path: string): unknown[] {
  return expectDenseArray(value, path);
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "必须是字符串");
  return value;
}

function expectId(value: unknown, path: string): string {
  const id = expectString(value, path);
  if (id.trim().length === 0) fail(path, "不能为空");
  return id;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "必须是布尔值");
  return value;
}

function expectFiniteNumber(
  value: unknown,
  path: string,
  options: { min?: number; exclusiveMin?: number; max?: number } = {}
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "必须是有限数字");
  }
  if (options.exclusiveMin !== undefined && value <= options.exclusiveMin) {
    fail(path, `必须大于 ${options.exclusiveMin}`);
  }
  if (options.min !== undefined && value < options.min) {
    fail(path, `必须大于或等于 ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    fail(path, `必须小于或等于 ${options.max}`);
  }
  return value;
}

function expectInteger(value: unknown, path: string, options: { min?: number } = {}) {
  const number = expectFiniteNumber(value, path, options);
  if (!Number.isInteger(number)) fail(path, "必须是整数");
  return number;
}

function expectEnum<T extends string>(value: unknown, path: string, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    fail(path, `必须是以下值之一：${values.join(", ")}`);
  }
  return value as T;
}

function hasOwn(value: RecordValue, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function expectOwn(value: RecordValue, key: string, path: string): unknown {
  if (!hasOwn(value, key)) fail(path, "字段缺失");
  return value[key];
}

function expectVec3(value: unknown, path: string, options?: { positive?: boolean }): [number, number, number] {
  const tuple = expectArray(value, path);
  if (tuple.length !== 3) fail(path, "必须是包含 3 个数字的向量");

  return tuple.map((component, index) =>
    expectFiniteNumber(component, `${path}[${index}]`, options?.positive ? { exclusiveMin: 0 } : undefined)
  ) as [number, number, number];
}

function expectQuat4(value: unknown, path: string): [number, number, number, number] {
  const tuple = expectArray(value, path);
  if (tuple.length !== 4) fail(path, "必须是包含 4 个数字的四元数");
  return tuple.map((component, index) => expectFiniteNumber(component, `${path}[${index}]`)) as [number, number, number, number];
}

function expectTransform(value: unknown, path: string): DirectorTransform {
  const transform = expectRecord(value, path);
  return {
    position: expectVec3(expectOwn(transform, "position", `${path}.position`), `${path}.position`),
    rotation: expectVec3(expectOwn(transform, "rotation", `${path}.rotation`), `${path}.rotation`),
    scale: expectVec3(expectOwn(transform, "scale", `${path}.scale`), `${path}.scale`, { positive: true }),
  };
}

function validateScene(value: unknown): SceneSettings {
  const scene = expectRecord(value, "scene");
  return {
    scale: expectFiniteNumber(expectOwn(scene, "scale", "scene.scale"), "scene.scale", { exclusiveMin: 0 }),
    position: expectVec3(expectOwn(scene, "position", "scene.position"), "scene.position"),
    rotation: expectVec3(expectOwn(scene, "rotation", "scene.rotation"), "scene.rotation"),
    backgroundColor: expectString(expectOwn(scene, "backgroundColor", "scene.backgroundColor"), "scene.backgroundColor"),
    panoramaYaw: expectFiniteNumber(expectOwn(scene, "panoramaYaw", "scene.panoramaYaw"), "scene.panoramaYaw"),
    panoramaRadius: expectFiniteNumber(
      expectOwn(scene, "panoramaRadius", "scene.panoramaRadius"),
      "scene.panoramaRadius",
      { exclusiveMin: 0 }
    ),
    showLabels: expectBoolean(expectOwn(scene, "showLabels", "scene.showLabels"), "scene.showLabels"),
    snapToGrid: expectBoolean(expectOwn(scene, "snapToGrid", "scene.snapToGrid"), "scene.snapToGrid"),
    showGround: expectBoolean(expectOwn(scene, "showGround", "scene.showGround"), "scene.showGround"),
    groundOpacity: expectFiniteNumber(
      expectOwn(scene, "groundOpacity", "scene.groundOpacity"),
      "scene.groundOpacity",
      { min: 0, max: 1 }
    ),
    groundHeight: expectFiniteNumber(expectOwn(scene, "groundHeight", "scene.groundHeight"), "scene.groundHeight"),
  };
}

function validateAsset(value: unknown, path: string): DirectorAssetRef {
  const asset = expectRecord(value, path);
  const kind = expectEnum(expectOwn(asset, "kind", `${path}.kind`), `${path}.kind`, ASSET_KINDS);
  const sourceType = expectEnum(
    expectOwn(asset, "sourceType", `${path}.sourceType`),
    `${path}.sourceType`,
    ASSET_SOURCE_TYPES
  );

  if (kind === "panorama" && sourceType !== "image") {
    fail(`${path}.sourceType`, "全景资源必须使用 image 来源");
  }
  if (kind !== "panorama" && sourceType !== "model") {
    fail(`${path}.sourceType`, "非全景资源必须使用 model 来源");
  }

  const result: DirectorAssetRef = {
    id: expectId(expectOwn(asset, "id", `${path}.id`), `${path}.id`),
    kind,
    sourceType,
    fileName: expectString(expectOwn(asset, "fileName", `${path}.fileName`), `${path}.fileName`),
    url: expectString(expectOwn(asset, "url", `${path}.url`), `${path}.url`),
  };

  if (hasOwn(asset, "name")) result.name = expectString(expectOwn(asset, "name", `${path}.name`), `${path}.name`);
  if (hasOwn(asset, "assetSource")) {
    result.assetSource = expectEnum(expectOwn(asset, "assetSource", `${path}.assetSource`), `${path}.assetSource`, ASSET_SOURCES);
  }
  if (hasOwn(asset, "projectionMode")) {
    result.projectionMode = expectEnum(
      expectOwn(asset, "projectionMode", `${path}.projectionMode`),
      `${path}.projectionMode`,
      PROJECTION_MODES
    );
    if (kind !== "panorama") fail(`${path}.projectionMode`, "只有全景资源可以声明投影模式");
  }

  return result;
}

function validateRig(value: unknown, path: string) {
  const rig = expectRecord(value, path);
  const controls = expectRecord(expectOwn(rig, "controls", `${path}.controls`), `${path}.controls`);
  const validatedControls: Record<string, number> = {};
  for (const key of Object.getOwnPropertyNames(controls)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      fail(`${path}.controls.${key}`, "禁止使用特殊键");
    }
    validatedControls[key] = expectFiniteNumber(controls[key], `${path}.controls.${key}`);
  }

  return {
    rigType: expectEnum(expectOwn(rig, "rigType", `${path}.rigType`), `${path}.rigType`, RIG_TYPES),
    posePresetId:
      hasOwn(rig, "posePresetId")
        ? expectOwn(rig, "posePresetId", `${path}.posePresetId`) === null
          ? null
          : expectString(expectOwn(rig, "posePresetId", `${path}.posePresetId`), `${path}.posePresetId`)
        : fail(`${path}.posePresetId`, "字段缺失"),
    controls: validatedControls,
  };
}

function validateObject(value: unknown, path: string): DirectorObject {
  const object = expectRecord(value, path);
  const kind = expectEnum(expectOwn(object, "kind", `${path}.kind`), `${path}.kind`, OBJECT_KINDS);
  const result: DirectorObject = {
    id: expectId(expectOwn(object, "id", `${path}.id`), `${path}.id`),
    name: expectString(expectOwn(object, "name", `${path}.name`), `${path}.name`),
    kind,
    visible: expectBoolean(expectOwn(object, "visible", `${path}.visible`), `${path}.visible`),
    locked: expectBoolean(expectOwn(object, "locked", `${path}.locked`), `${path}.locked`),
    transform: expectTransform(expectOwn(object, "transform", `${path}.transform`), `${path}.transform`),
  };

  if (hasOwn(object, "bodyType")) {
    result.bodyType = expectEnum(expectOwn(object, "bodyType", `${path}.bodyType`), `${path}.bodyType`, BODY_TYPES);
  }
  if (hasOwn(object, "color")) result.color = expectString(expectOwn(object, "color", `${path}.color`), `${path}.color`);
  if (hasOwn(object, "assetRefId")) {
    result.assetRefId = expectId(expectOwn(object, "assetRefId", `${path}.assetRefId`), `${path}.assetRefId`);
  }
  if (hasOwn(object, "geometryType")) {
    result.geometryType = expectEnum(
      expectOwn(object, "geometryType", `${path}.geometryType`),
      `${path}.geometryType`,
      GEOMETRY_TYPES
    );
  }
  if (hasOwn(object, "crowdId")) result.crowdId = expectId(expectOwn(object, "crowdId", `${path}.crowdId`), `${path}.crowdId`);
  if (hasOwn(object, "crowdLabel")) {
    result.crowdLabel = expectString(expectOwn(object, "crowdLabel", `${path}.crowdLabel`), `${path}.crowdLabel`);
  }
  if (hasOwn(object, "linkedCameraId")) {
    const linkedCameraId = expectOwn(object, "linkedCameraId", `${path}.linkedCameraId`);
    result.linkedCameraId = linkedCameraId === null ? null : expectId(linkedCameraId, `${path}.linkedCameraId`);
  }
  if (hasOwn(object, "characterRig")) {
    if (kind !== "character") fail(`${path}.characterRig`, "只有角色对象可以声明角色 rig");
    result.characterRig = validateRig(expectOwn(object, "characterRig", `${path}.characterRig`), `${path}.characterRig`);
  }

  return result;
}

function validateCapture(value: unknown, path: string): DirectorCameraCapture {
  const capture = expectRecord(value, path);
  return {
    id: expectId(expectOwn(capture, "id", `${path}.id`), `${path}.id`),
    index: expectInteger(expectOwn(capture, "index", `${path}.index`), `${path}.index`, { min: 0 }),
    name: expectString(expectOwn(capture, "name", `${path}.name`), `${path}.name`),
    dataUrl: expectString(expectOwn(capture, "dataUrl", `${path}.dataUrl`), `${path}.dataUrl`),
  };
}

function validateNode(value: unknown, path: string): CameraNode {
  const node = expectRecord(value, path);
  return {
    id: expectId(expectOwn(node, "id", `${path}.id`), `${path}.id`),
    position: expectVec3(expectOwn(node, "position", `${path}.position`), `${path}.position`),
    rotation: expectQuat4(expectOwn(node, "rotation", `${path}.rotation`), `${path}.rotation`),
    fov: expectFiniteNumber(expectOwn(node, "fov", `${path}.fov`), `${path}.fov`, { exclusiveMin: 0, max: 180 }),
    time: expectFiniteNumber(expectOwn(node, "time", `${path}.time`), `${path}.time`, { min: 0 }),
  };
}

function validateSegment(value: unknown, path: string): CameraSegment {
  const segment = expectRecord(value, path);
  return {
    id: expectId(expectOwn(segment, "id", `${path}.id`), `${path}.id`),
    fromNodeId: expectId(expectOwn(segment, "fromNodeId", `${path}.fromNodeId`), `${path}.fromNodeId`),
    toNodeId: expectId(expectOwn(segment, "toNodeId", `${path}.toNodeId`), `${path}.toNodeId`),
    curveMode: expectEnum(expectOwn(segment, "curveMode", `${path}.curveMode`), `${path}.curveMode`, SEGMENT_CURVE_MODES),
    duration: expectFiniteNumber(expectOwn(segment, "duration", `${path}.duration`), `${path}.duration`, { exclusiveMin: 0 }),
    holdAfter: expectFiniteNumber(expectOwn(segment, "holdAfter", `${path}.holdAfter`), `${path}.holdAfter`, { min: 0 }),
    easing: expectEnum(expectOwn(segment, "easing", `${path}.easing`), `${path}.easing`, SEGMENT_EASINGS),
    ...(hasOwn(segment, "handleOut")
      ? { handleOut: expectVec3(expectOwn(segment, "handleOut", `${path}.handleOut`), `${path}.handleOut`) }
      : {}),
    ...(hasOwn(segment, "handleIn")
      ? { handleIn: expectVec3(expectOwn(segment, "handleIn", `${path}.handleIn`), `${path}.handleIn`) }
      : {}),
  };
}

function ensureUniqueIds(values: Array<{ id: string }>, path: string) {
  const firstSeen = new Map<string, number>();
  values.forEach((value, index) => {
    const previousIndex = firstSeen.get(value.id);
    if (previousIndex !== undefined) {
      fail(`${path}[${index}].id`, `duplicate id "${value.id}"（已在 ${path}[${previousIndex}].id 使用）`);
    }
    firstSeen.set(value.id, index);
  });
}

function validateCamera(value: unknown, path: string): DirectorCameraShot {
  const camera = expectRecord(value, path);
  const result: DirectorCameraShot = {
    id: expectId(expectOwn(camera, "id", `${path}.id`), `${path}.id`),
    name: expectString(expectOwn(camera, "name", `${path}.name`), `${path}.name`),
    fov: expectFiniteNumber(expectOwn(camera, "fov", `${path}.fov`), `${path}.fov`, { exclusiveMin: 0, max: 180 }),
    transform: expectTransform(expectOwn(camera, "transform", `${path}.transform`), `${path}.transform`),
    targetMode: expectEnum(expectOwn(camera, "targetMode", `${path}.targetMode`), `${path}.targetMode`, CAMERA_TARGET_MODES),
    target: expectVec3(expectOwn(camera, "target", `${path}.target`), `${path}.target`),
  };

  if (hasOwn(camera, "transientCaptureToken")) {
    result.transientCaptureToken = expectString(
      expectOwn(camera, "transientCaptureToken", `${path}.transientCaptureToken`),
      `${path}.transientCaptureToken`
    );
  }
  if (hasOwn(camera, "targetObjectId")) {
    const targetObjectId = expectOwn(camera, "targetObjectId", `${path}.targetObjectId`);
    result.targetObjectId = targetObjectId === null ? null : expectId(targetObjectId, `${path}.targetObjectId`);
  }
  if (hasOwn(camera, "lastCaptureUrl")) {
    const lastCaptureUrl = expectOwn(camera, "lastCaptureUrl", `${path}.lastCaptureUrl`);
    result.lastCaptureUrl = lastCaptureUrl === null ? null : expectString(lastCaptureUrl, `${path}.lastCaptureUrl`);
  }
  if (hasOwn(camera, "captures")) {
    const captures = expectArray(expectOwn(camera, "captures", `${path}.captures`), `${path}.captures`).map((capture, index) =>
      validateCapture(capture, `${path}.captures[${index}]`)
    );
    ensureUniqueIds(captures, `${path}.captures`);
    result.captures = captures;
  }
  if (hasOwn(camera, "nodes")) {
    const nodes = expectArray(expectOwn(camera, "nodes", `${path}.nodes`), `${path}.nodes`).map((node, index) =>
      validateNode(node, `${path}.nodes[${index}]`)
    );
    ensureUniqueIds(nodes, `${path}.nodes`);
    result.nodes = nodes;
  }
  if (hasOwn(camera, "segments")) {
    const segments = expectArray(expectOwn(camera, "segments", `${path}.segments`), `${path}.segments`).map((segment, index) =>
      validateSegment(segment, `${path}.segments[${index}]`)
    );
    ensureUniqueIds(segments, `${path}.segments`);
    result.segments = segments;

    if (segments.length > 0 && !result.nodes) fail(`${path}.segments`, "存在运镜段时必须提供 nodes");
    const nodeIds = new Set(result.nodes?.map((node) => node.id));
    segments.forEach((segment, index) => {
      if (!nodeIds.has(segment.fromNodeId)) fail(`${path}.segments[${index}].fromNodeId`, "未引用当前机位的 node");
      if (!nodeIds.has(segment.toNodeId)) fail(`${path}.segments[${index}].toNodeId`, "未引用当前机位的 node");
      if (segment.fromNodeId === segment.toNodeId) fail(`${path}.segments[${index}]`, "禁止 node 自环");
    });
  }

  if (result.targetMode === "object" && !result.targetObjectId) {
    fail(`${path}.targetObjectId`, "targetMode 为 object 时必须引用对象");
  }

  return result;
}

function validateReferences(project: DirectorProject) {
  const assetById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const objectById = new Map(project.objects.map((object) => [object.id, object]));
  const cameraById = new Map(project.cameras.map((camera) => [camera.id, camera]));

  if (project.activeCameraId !== null && !cameraById.has(project.activeCameraId)) {
    fail("activeCameraId", `未引用存在的 camera：${project.activeCameraId}`);
  }

  if (project.panoramaAssetId !== null) {
    const panorama = assetById.get(project.panoramaAssetId);
    if (!panorama || panorama.kind !== "panorama" || panorama.sourceType !== "image") {
      fail("panoramaAssetId", "必须引用 kind=panorama 且 sourceType=image 的 asset");
    }
  }

  project.objects.forEach((object, index) => {
    const path = `objects[${index}]`;
    if (object.assetRefId !== undefined) {
      const asset = assetById.get(object.assetRefId);
      if (!asset) fail(`${path}.assetRefId`, `未引用存在的 asset：${object.assetRefId}`);
      if (asset.sourceType === "image" && object.kind !== "panorama") {
        fail(`${path}.assetRefId`, "3D 对象不能引用 image/panorama asset");
      }
      if (asset.sourceType === "model" && asset.kind !== object.kind) {
        fail(`${path}.assetRefId`, `asset kind=${asset.kind} 与 object kind=${object.kind} 不兼容`);
      }
    }

    if (object.linkedCameraId !== undefined && object.linkedCameraId !== null) {
      if (object.kind !== "camera") fail(`${path}.linkedCameraId`, "只有 camera object 可以声明 linkedCameraId");
      if (!cameraById.has(object.linkedCameraId)) {
        fail(`${path}.linkedCameraId`, `未引用存在的 camera：${object.linkedCameraId}`);
      }
    }
  });

  project.cameras.forEach((camera, index) => {
    const path = `cameras[${index}]`;
    if (camera.targetObjectId === undefined || camera.targetObjectId === null) return;

    const targetObject = objectById.get(camera.targetObjectId);
    if (!targetObject) {
      fail(`${path}.targetObjectId`, `未引用存在的 object：${camera.targetObjectId}`);
    }
    if (!CAMERA_TARGET_OBJECT_KINDS.includes(targetObject.kind as (typeof CAMERA_TARGET_OBJECT_KINDS)[number])) {
      fail(
        `${path}.targetObjectId`,
        `目标 object kind=${targetObject.kind} 不兼容，只允许 character/scene/prop`
      );
    }
  });
}

export function validateDirectorProject(value: unknown): DirectorProject {
  const project = expectRecord(value, "project");
  if (expectOwn(project, "version", "version") !== 1) fail("version", "必须是 1");

  const scene = validateScene(expectOwn(project, "scene", "scene"));
  const assets = expectArray(expectOwn(project, "assets", "assets"), "assets").map((asset, index) =>
    validateAsset(asset, `assets[${index}]`)
  );
  const objects = expectArray(expectOwn(project, "objects", "objects"), "objects").map((object, index) =>
    validateObject(object, `objects[${index}]`)
  );
  const cameras = expectArray(expectOwn(project, "cameras", "cameras"), "cameras").map((camera, index) =>
    validateCamera(camera, `cameras[${index}]`)
  );
  ensureUniqueIds(assets, "assets");
  ensureUniqueIds(objects, "objects");
  ensureUniqueIds(cameras, "cameras");

  const activeCameraIdValue = expectOwn(project, "activeCameraId", "activeCameraId");
  const panoramaAssetIdValue = expectOwn(project, "panoramaAssetId", "panoramaAssetId");
  const activeCameraId = activeCameraIdValue === null ? null : expectId(activeCameraIdValue, "activeCameraId");
  const panoramaAssetId = panoramaAssetIdValue === null ? null : expectId(panoramaAssetIdValue, "panoramaAssetId");
  const validatedProject: DirectorProject = {
    version: 1,
    scene,
    assets,
    objects,
    cameras,
    activeCameraId,
    panoramaAssetId,
  };

  validateReferences(validatedProject);
  return validatedProject;
}
