import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import type { CameraNode, CameraSegment } from "../schema/directorProject";
import {
  applyEasing,
  buildCameraSegments,
  clampNodeTime,
  evaluateCameraPath,
  getCameraPathDuration,
  getDefaultBezierHandles,
  getNodeStartTimes,
  getSegmentRenderPoints,
} from "./cameraPath";

function makeNode(id: string, time: number, position: [number, number, number], fov = 50): CameraNode {
  return { id, position, rotation: [0, 0, 0, 1], fov, time };
}

const nodeA = makeNode("a", 0, [0, 0, 0]);
const nodeB = makeNode("b", 2, [0, 0, 10]);
const nodeC = makeNode("c", 4, [10, 0, 10]);

describe("buildCameraSegments", () => {
  it("按节点时间差派生默认段", () => {
    const segments = buildCameraSegments([nodeA, nodeB, nodeC]);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ fromNodeId: "a", toNodeId: "b", duration: 2, curveMode: "linear", easing: "linear" });
    expect(segments[1]).toMatchObject({ fromNodeId: "b", toNodeId: "c", duration: 2 });
  });

  it("同 id 段保留旧设置", () => {
    const previous: CameraSegment[] = [
      {
        id: "a:b",
        fromNodeId: "a",
        toNodeId: "b",
        curveMode: "bezier",
        duration: 1.5,
        holdAfter: 0.5,
        easing: "ease-in-out",
      },
    ];
    const segments = buildCameraSegments([nodeA, nodeB], previous);

    expect(segments[0]).toMatchObject({ curveMode: "bezier", duration: 1.5, holdAfter: 0.5, easing: "ease-in-out" });
  });
});

describe("evaluateCameraPath", () => {
  it("直线段中间时刻取中点，两端钳制", () => {
    const segments = buildCameraSegments([nodeA, nodeB]);
    const mid = evaluateCameraPath([nodeA, nodeB], segments, 1);
    const start = evaluateCameraPath([nodeA, nodeB], segments, -5);
    const end = evaluateCameraPath([nodeA, nodeB], segments, 99);

    expect(mid?.position.distanceTo(new Vector3(0, 0, 5))).toBeLessThan(1e-6);
    expect(start?.position.distanceTo(new Vector3(0, 0, 0))).toBeLessThan(1e-6);
    expect(end?.position.distanceTo(new Vector3(0, 0, 10))).toBeLessThan(1e-6);
  });

  it("holdAfter 期间停在终点姿态", () => {
    const segments = buildCameraSegments([nodeA, nodeB]).map((segment) => ({ ...segment, holdAfter: 1 }));
    // A 0s → 运动 2s → hold 1s（停在 B）→ 总长 3s
    const duringHold = evaluateCameraPath([nodeA, nodeB], segments, 2.5);
    const after = evaluateCameraPath([nodeA, nodeB], segments, 10);

    expect(duringHold?.position.distanceTo(new Vector3(0, 0, 10))).toBeLessThan(1e-6);
    expect(after?.position.distanceTo(new Vector3(0, 0, 10))).toBeLessThan(1e-6);
    expect(getCameraPathDuration([nodeA, nodeB], segments)).toBeCloseTo(3);
  });

  it("ease-in 起点附近移动比匀速更慢", () => {
    const linear = buildCameraSegments([nodeA, nodeB]);
    const eased = linear.map((segment) => ({ ...segment, easing: "ease-in" as const }));
    const t = 0.25;

    expect(evaluateCameraPath([nodeA, nodeB], eased, t)!.position.z).toBeLessThan(
      evaluateCameraPath([nodeA, nodeB], linear, t)!.position.z
    );
  });

  it("贝塞尔段按控制柄弯曲", () => {
    const handles = getDefaultBezierHandles(nodeA.position, nodeB.position);
    const segment: CameraSegment = {
      id: "a:b",
      fromNodeId: "a",
      toNodeId: "b",
      curveMode: "bezier",
      duration: 2,
      holdAfter: 0,
      easing: "linear",
      handleOut: [0, 5, 3],
      handleIn: [0, 5, 7],
    };
    void handles;
    const mid = evaluateCameraPath([nodeA, nodeB], [segment], 1);

    expect(mid!.position.y).toBeGreaterThan(2); // 手柄把路径顶出直线平面
  });

  it("旋转用 SLERP：中点为四元数中点", () => {
    const from: CameraNode = { ...nodeA, rotation: [0, 0, 0, 1] };
    const to: CameraNode = {
      ...nodeB,
      rotation: [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)], // 绕 Y 转 90°
    };
    const segments = buildCameraSegments([from, to]);
    const mid = evaluateCameraPath([from, to], segments, 1);

    const expected = new Quaternion(0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4))
      .normalize()
      .slerp(new Quaternion(0, 0, 0, 1), 0.5)
      .normalize();
    expect(mid!.rotation.angleTo(expected)).toBeLessThan(1e-5);
  });

  it("单节点路径返回静态姿态，空路径返回 null", () => {
    expect(evaluateCameraPath([nodeA], [], 3)?.position.z).toBe(0);
    expect(evaluateCameraPath([], [], 3)).toBeNull();
  });
});

describe("clampNodeTime", () => {
  it("夹在相邻节点 hold 边界之间", () => {
    const segments = buildCameraSegments([nodeA, nodeB, nodeC]).map((segment, index) => ({
      ...segment,
      holdAfter: index === 0 ? 1 : 0.5,
    }));
    // B 的范围：[A.time + hold + MIN, C.time - ownHold - MIN] = [1.1, 3.4]
    expect(clampNodeTime([nodeA, nodeB, nodeC], segments, 1, 0)).toBeCloseTo(1.1);
    expect(clampNodeTime([nodeA, nodeB, nodeC], segments, 1, 99)).toBeCloseTo(3.4);
    expect(clampNodeTime([nodeA, nodeB, nodeC], segments, 1, 2)).toBeCloseTo(2);
  });

  it("首节点最小时间为 0，末节点无上限", () => {
    const segments = buildCameraSegments([nodeA, nodeB]);
    expect(clampNodeTime([nodeA, nodeB], segments, 0, -3)).toBe(0);
    expect(clampNodeTime([nodeA, nodeB], segments, 1, 1000)).toBe(1000);
  });
});

describe("getNodeStartTimes", () => {
  it("累计 duration + holdAfter", () => {
    const segments = buildCameraSegments([nodeA, nodeB, nodeC]).map((segment, index) => ({
      ...segment,
      holdAfter: index === 0 ? 1 : 0,
    }));

    expect(getNodeStartTimes([nodeA, nodeB, nodeC], segments)).toEqual([0, 3, 5]);
  });
});

describe("applyEasing", () => {
  it("端点与中点值正确", () => {
    expect(applyEasing(0, "ease-in-out")).toBe(0);
    expect(applyEasing(1, "ease-in-out")).toBe(1);
    expect(applyEasing(0.5, "linear")).toBeCloseTo(0.5);
    expect(applyEasing(0.5, "ease-in")).toBeCloseTo(0.25);
    expect(applyEasing(0.5, "ease-out")).toBeCloseTo(0.75);
  });
});

describe("getSegmentRenderPoints", () => {
  it("直线段返回两端点，贝塞尔段返回采样点", () => {
    const linear: CameraSegment = {
      id: "a:b",
      fromNodeId: "a",
      toNodeId: "b",
      curveMode: "linear",
      duration: 1,
      holdAfter: 0,
      easing: "linear",
    };
    expect(getSegmentRenderPoints(nodeA, nodeB, linear)).toEqual([nodeA.position, nodeB.position]);

    const bezier: CameraSegment = {
      ...linear,
      curveMode: "bezier",
      handleOut: [0, 3, 3],
      handleIn: [0, 3, 7],
    };
    const points = getSegmentRenderPoints(nodeA, nodeB, bezier);
    expect(points).toHaveLength(32);
    expect(points[0]).toEqual(nodeA.position);
    expect(points[points.length - 1]).toEqual(nodeB.position);
  });
});
