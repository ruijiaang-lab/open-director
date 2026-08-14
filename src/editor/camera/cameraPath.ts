import { CubicBezierCurve3, Matrix4, Quaternion, Vector3 } from "three";
import type { CameraNode, CameraSegment, CameraSegmentEasing } from "../schema/directorProject";

export const MIN_SEGMENT_DURATION = 0.1;
const HANDLE_T = 1 / 3;

/** 段 id 由两端节点 id 派生，节点增删后重建时按此保留旧设置。 */
export function getSegmentId(fromNodeId: string, toNodeId: string) {
  return `${fromNodeId}:${toNodeId}`;
}

/**
 * 按节点顺序重建段列表：已有同 id 的段保留设置，新段用默认值。
 * duration 由节点时间差扣除 holdAfter 派生；兜底最小时长。
 */
export function buildCameraSegments(nodes: CameraNode[], existing: CameraSegment[] = []): CameraSegment[] {
  const existingById = new Map(existing.map((segment) => [segment.id, segment]));
  const segments: CameraSegment[] = [];

  for (let index = 0; index < nodes.length - 1; index += 1) {
    const fromNode = nodes[index];
    const toNode = nodes[index + 1];
    const id = getSegmentId(fromNode.id, toNode.id);
    const previous = existingById.get(id);

    if (previous) {
      segments.push({ ...previous, id, fromNodeId: fromNode.id, toNodeId: toNode.id });
      continue;
    }

    const rawDuration = toNode.time - fromNode.time;
    segments.push({
      id,
      fromNodeId: fromNode.id,
      toNodeId: toNode.id,
      curveMode: "linear",
      duration: Number(Math.max(rawDuration, MIN_SEGMENT_DURATION).toFixed(6)),
      holdAfter: 0,
      easing: "linear",
    });
  }

  return segments;
}

/** 各节点在时间轴上的起始时间（节点数组顺序 = 路径顺序）。 */
export function getNodeStartTimes(nodes: CameraNode[], segments: CameraSegment[]): number[] {
  const times: number[] = [nodes[0]?.time ?? 0];

  for (let index = 1; index < nodes.length; index += 1) {
    const previous = segments[index - 1];
    const previousTime = times[index - 1];
    times.push(Number((previousTime + (previous?.duration ?? 1) + (previous?.holdAfter ?? 0)).toFixed(6)));
  }

  return times;
}

export function getCameraPathDuration(nodes: CameraNode[], segments: CameraSegment[]): number {
  if (nodes.length === 0) return 0;
  // 末节点起始时间即总长：它已累计了之前所有段的 duration + holdAfter
  const startTimes = getNodeStartTimes(nodes, segments);
  return startTimes[startTimes.length - 1];
}

export function applyEasing(t: number, easing: CameraSegmentEasing): number {
  if (easing === "ease-in") return t * t;
  if (easing === "ease-out") return 1 - (1 - t) * (1 - t);
  if (easing === "ease-in-out") return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  return t;
}

export function lerpFov(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

function nodePose(node: CameraNode) {
  return {
    position: new Vector3(...node.position),
    rotation: new Quaternion(...node.rotation).normalize(),
    fov: node.fov,
  };
}

function evaluateSegment(
  fromNode: CameraNode,
  toNode: CameraNode,
  segment: CameraSegment,
  localTime: number
): { position: Vector3; rotation: Quaternion; fov: number } {
  const from = nodePose(fromNode);
  const to = nodePose(toNode);
  const rawT = Math.min(Math.max(localTime / segment.duration, 0), 1);
  const t = applyEasing(rawT, segment.easing);

  let position: Vector3;
  if (segment.curveMode === "bezier" && segment.handleOut && segment.handleIn) {
    const curve = new CubicBezierCurve3(
      from.position,
      new Vector3(...segment.handleOut),
      new Vector3(...segment.handleIn),
      to.position
    );
    position = curve.getPoint(t);
  } else {
    position = from.position.clone().lerp(to.position, t);
  }

  const rotation = from.rotation.clone().slerp(to.rotation, t);
  const fov = lerpFov(from.fov, to.fov, t);

  return { position, rotation, fov };
}

export interface CameraPathPose {
  position: Vector3;
  rotation: Quaternion;
  fov: number;
}

/**
 * 求时间轴上任意时刻的相机姿态：
 * 段内按 easing 插值（贝塞尔段用 CubicBezierCurve3），holdAfter 期间停在终点姿态。
 * 时间越界时钳制到路径两端。nodes 为空返回 null。
 */
export function evaluateCameraPath(
  nodes: CameraNode[],
  segments: CameraSegment[],
  time: number
): CameraPathPose | null {
  if (nodes.length === 0) return null;
  if (nodes.length === 1) return nodePose(nodes[0]);

  const startTimes = getNodeStartTimes(nodes, segments);
  const total = getCameraPathDuration(nodes, segments);
  const clampedTime = Math.min(Math.max(time, 0), total);

  let segmentIndex = segments.length - 1;
  for (let index = 0; index < segments.length; index += 1) {
    if (clampedTime < startTimes[index + 1]) {
      segmentIndex = index;
      break;
    }
  }

  const segment = segments[segmentIndex];
  const fromNode = nodes[segmentIndex];
  const toNode = nodes[segmentIndex + 1];
  const localTime = clampedTime - startTimes[segmentIndex];
  const pose = evaluateSegment(fromNode, toNode, segment, Math.min(localTime, segment.duration));

  // hold 阶段（或钳制在段末）使用终点姿态
  if (localTime >= segment.duration) {
    pose.position.set(...toNode.position);
    pose.rotation.copy(new Quaternion(...toNode.rotation).normalize());
    pose.fov = toNode.fov;
  }

  return pose;
}

/** 拖拽时间轴节点时钳制其时间：不越过相邻节点的 hold 边界，保持最小段长。 */
export function clampNodeTime(
  nodes: CameraNode[],
  segments: CameraSegment[],
  index: number,
  time: number
): number {
  const previous = index > 0 ? segments[index - 1] : null;
  const next = index < segments.length ? segments[index] : null;
  const minTime = index === 0 ? 0 : nodes[index - 1].time + (previous?.holdAfter ?? 0) + MIN_SEGMENT_DURATION;
  const maxTime =
    index === nodes.length - 1
      ? Number.POSITIVE_INFINITY
      : nodes[index + 1].time - (next?.holdAfter ?? 0) - MIN_SEGMENT_DURATION;

  return Number(Math.min(Math.max(time, minTime), maxTime).toFixed(6));
}

/** 贝塞尔段转为曲线时的默认控制柄（直线三等分点，视觉上等于直线，拖拽后变弯）。 */
export function getDefaultBezierHandles(
  from: [number, number, number],
  to: [number, number, number]
): { handleOut: [number, number, number]; handleIn: [number, number, number] } {
  const start = new Vector3(...from);
  const end = new Vector3(...to);
  const delta = end.clone().sub(start);

  return {
    handleOut: [start.x + delta.x * HANDLE_T, start.y + delta.y * HANDLE_T, start.z + delta.z * HANDLE_T],
    handleIn: [end.x - delta.x * HANDLE_T, end.y - delta.y * HANDLE_T, end.z - delta.z * HANDLE_T],
  };
}

/** 由视点/注视点构造相机朝向四元数（新增节点默认姿态用）。 */
export function getLookAtQuaternion(
  position: [number, number, number],
  target: [number, number, number]
): Quaternion {
  const origin = new Vector3(...position);
  const direction = new Vector3(...target).sub(origin);
  if (direction.lengthSq() === 0) return new Quaternion();

  const forward = direction.normalize();
  const up = Math.abs(forward.y) > 0.999 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const matrix = new Matrix4().lookAt(origin, origin.clone().sub(forward), up);

  return new Quaternion().setFromRotationMatrix(matrix);
}

/** 段的可视化采样点（God View 渲染路径线用）。 */
export function getSegmentRenderPoints(
  fromNode: CameraNode,
  toNode: CameraNode,
  segment: CameraSegment,
  samples = 32
): Array<[number, number, number]> {
  if (segment.curveMode !== "bezier" || !segment.handleOut || !segment.handleIn) {
    return [fromNode.position, toNode.position];
  }

  const curve = new CubicBezierCurve3(
    new Vector3(...fromNode.position),
    new Vector3(...segment.handleOut),
    new Vector3(...segment.handleIn),
    new Vector3(...toNode.position)
  );
  const points = curve.getPoints(samples - 1);

  return points.map((point) => [point.x, point.y, point.z] as [number, number, number]);
}
