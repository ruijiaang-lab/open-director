import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { getSegmentId } from "../camera/cameraPath";
import type { CameraNode, CameraSegment, DirectorCameraShot } from "../schema/directorProject";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import { useCameraPlaybackStore } from "../store/cameraPlaybackStore";
import { DirectorTimeline } from "./DirectorTimeline";

const SHARED_NODE_IDS = ["shared-node-a", "shared-node-b"] as const;
const SHARED_SEGMENT_ID = getSegmentId(...SHARED_NODE_IDS);

function makeNodes(offset: number): CameraNode[] {
  return [
    {
      id: SHARED_NODE_IDS[0],
      position: [offset, 1, 5],
      rotation: [0, 0, 0, 1],
      fov: 50,
      time: 0,
    },
    {
      id: SHARED_NODE_IDS[1],
      position: [offset + 1, 1, 4],
      rotation: [0, 0, 0, 1],
      fov: 55,
      time: 2,
    },
  ];
}

function makeSegment(duration: number, holdAfter: number): CameraSegment {
  return {
    id: SHARED_SEGMENT_ID,
    fromNodeId: SHARED_NODE_IDS[0],
    toNodeId: SHARED_NODE_IDS[1],
    curveMode: "linear",
    duration,
    holdAfter,
    easing: "linear",
  };
}

function installTwoCameraFixture() {
  const initial = createInitialDirectorState();
  const template = initial.project.cameras[0]!;
  const cameras: DirectorCameraShot[] = [
    {
      ...template,
      id: "cam_a",
      name: "机位A",
      nodes: makeNodes(0),
      segments: [makeSegment(2, 0.5)],
    },
    {
      ...template,
      id: "cam_b",
      name: "机位B",
      nodes: makeNodes(10),
      segments: [makeSegment(5, 0.25)],
    },
  ];

  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...initial,
    project: {
      ...initial.project,
      cameras,
      activeCameraId: "cam_a",
    },
  });
  useCameraPlaybackStore.setState({
    playheadTime: 0,
    isPlaying: false,
    selectedNode: null,
    selectedSegment: null,
    selectedHandle: null,
    timelineZoom: 80,
  });
}

beforeEach(() => {
  installTwoCameraFixture();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("clears playback and all camera-owned selections when the active camera id changes", () => {
  render(<DirectorTimeline />);

  act(() => {
    useCameraPlaybackStore.setState({
      isPlaying: true,
      playheadTime: 1.25,
      selectedNode: { cameraId: "cam_a", nodeId: SHARED_NODE_IDS[0] },
      selectedSegment: { cameraId: "cam_a", segmentId: SHARED_SEGMENT_ID },
      selectedHandle: { cameraId: "cam_a", segmentId: SHARED_SEGMENT_ID, handle: "out" },
    });
    useDirectorStore.getState().setActiveCamera("cam_b");
  });

  expect(useCameraPlaybackStore.getState()).toMatchObject({
    isPlaying: false,
    playheadTime: 0,
    selectedNode: null,
    selectedSegment: null,
    selectedHandle: null,
  });
  expect(screen.getByText("机位B · 2 个节点")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "插入节点" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  expect(screen.queryByText(/拖拽 3D 视口中的手柄编辑曲线/)).not.toBeInTheDocument();
});

it("does not render node, segment, or handle selections owned by another camera", () => {
  const { container } = render(<DirectorTimeline />);

  act(() => {
    useDirectorStore.getState().setActiveCamera("cam_b");
    useCameraPlaybackStore.setState({
      selectedNode: { cameraId: "cam_a", nodeId: SHARED_NODE_IDS[0] },
      selectedSegment: null,
      selectedHandle: null,
    });
  });

  expect(screen.queryByRole("button", { name: "插入节点" })).not.toBeInTheDocument();
  expect(container.querySelector(".timeline-node.is-selected")).toBeNull();

  act(() => {
    useCameraPlaybackStore.setState({
      selectedNode: null,
      selectedSegment: { cameraId: "cam_a", segmentId: SHARED_SEGMENT_ID },
      selectedHandle: null,
    });
  });

  expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  expect(container.querySelector(".timeline-segment.is-selected")).toBeNull();

  act(() => {
    useCameraPlaybackStore.setState({
      selectedNode: null,
      selectedSegment: null,
      selectedHandle: { cameraId: "cam_a", segmentId: SHARED_SEGMENT_ID, handle: "out" },
    });
  });

  expect(screen.queryByText(/拖拽 3D 视口中的手柄编辑曲线/)).not.toBeInTheDocument();
});

it("does not clear selection again when playback replaces the active camera object", () => {
  render(<DirectorTimeline />);

  act(() => {
    useCameraPlaybackStore.setState({
      isPlaying: true,
      playheadTime: 1,
      selectedSegment: { cameraId: "cam_a", segmentId: SHARED_SEGMENT_ID },
    });
    useDirectorStore.getState().applyPlaybackPose("cam_a", {
      position: [3, 2, 6],
      rotation: [0, 0, 0, 1],
      fov: 52,
    });
  });

  expect(useCameraPlaybackStore.getState()).toMatchObject({
    isPlaying: true,
    playheadTime: 1,
    selectedSegment: { cameraId: "cam_a", segmentId: SHARED_SEGMENT_ID },
  });
  expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(2);
});

it("only edits the active camera after switching cameras with reused ids", () => {
  render(<DirectorTimeline />);

  act(() => {
    useDirectorStore.getState().setActiveCamera("cam_b");
  });
  act(() => {
    useCameraPlaybackStore.getState().selectSegment({ cameraId: "cam_b", segmentId: SHARED_SEGMENT_ID });
  });

  const durationInput = screen.getAllByRole("spinbutton")[0]!;
  expect(durationInput).toHaveValue(5);

  fireEvent.change(durationInput, { target: { value: "7" } });

  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_a")?.segments?.[0]?.duration).toBe(2);
  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_b")?.segments?.[0]?.duration).toBe(7);
  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_a")?.nodes?.map((node) => node.time)).toEqual([
    0,
    2,
  ]);
  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_b")?.nodes?.map((node) => node.time)).toEqual([
    0,
    7.25,
  ]);

  act(() => {
    useCameraPlaybackStore.getState().selectNode({ cameraId: "cam_b", nodeId: SHARED_NODE_IDS[0] });
  });
  fireEvent.click(screen.getByRole("button", { name: "删除" }));

  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_a")?.nodes).toHaveLength(2);
  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_b")?.nodes).toHaveLength(1);
});

it("cancels a node drag when the active camera changes and never moves the new camera", () => {
  const endUndoBatchSpy = vi.spyOn(useDirectorStore.getState(), "endUndoBatch");
  const { container } = render(<DirectorTimeline />);
  const node = container.querySelector(".timeline-node") as HTMLElement;
  const track = container.querySelector(".timeline-track") as HTMLElement;
  const setPointerCapture = vi.fn();
  const hasPointerCapture = vi.fn().mockReturnValue(true);
  const releasePointerCapture = vi.fn();
  Object.defineProperty(node, "setPointerCapture", { value: setPointerCapture });
  Object.defineProperty(node, "hasPointerCapture", { value: hasPointerCapture });
  Object.defineProperty(node, "releasePointerCapture", { value: releasePointerCapture });
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: 1000,
    bottom: 100,
    width: 1000,
    height: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  fireEvent.pointerDown(node, { pointerId: 7, clientX: 100 });
  expect(useDirectorStore.getState().undoBatchDepth).toBe(1);
  expect(setPointerCapture).toHaveBeenCalledWith(7);

  const cameraBBefore = JSON.parse(
    JSON.stringify(useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_b")?.nodes)
  );
  act(() => {
    useDirectorStore.getState().setActiveCamera("cam_b");
  });

  expect(endUndoBatchSpy).toHaveBeenCalledTimes(1);
  expect(useDirectorStore.getState().undoBatchDepth).toBe(0);
  expect(releasePointerCapture).toHaveBeenCalledWith(7);

  fireEvent.pointerMove(track, { pointerId: 7, clientX: 320 });
  expect(
    useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_b")?.nodes
  ).toEqual(cameraBBefore);

  fireEvent.pointerCancel(track, { pointerId: 7 });
  expect(endUndoBatchSpy).toHaveBeenCalledTimes(1);
  expect(useDirectorStore.getState().undoBatchDepth).toBe(0);
});
