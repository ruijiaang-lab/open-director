import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import type { CameraNode, CameraSegment } from "../schema/directorProject";
import * as cameraPath from "../camera/cameraPath";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import { useCameraPlaybackStore } from "../store/cameraPlaybackStore";
import { CameraPlaybackController } from "./CameraPlaybackController";

const frameCapture = vi.hoisted(() => ({
  callback: null as ((state: unknown, delta: number) => void) | null,
}));

vi.mock("@react-three/fiber", () => ({
  useFrame: (callback: (state: unknown, delta: number) => void) => {
    frameCapture.callback = callback;
  },
}));

const NODE_A: CameraNode = {
  id: "node_a",
  position: [0, 1, 5],
  rotation: [0, 0, 0, 1],
  fov: 40,
  time: 0,
};
const NODE_B: CameraNode = {
  id: "node_b",
  position: [1, 1, 4],
  rotation: [0, 0, 0, 1],
  fov: 60,
  time: 2,
};

function makeSegment(duration = 2): CameraSegment {
  return {
    id: "node_a:node_b",
    fromNodeId: NODE_A.id,
    toNodeId: NODE_B.id,
    curveMode: "linear",
    duration,
    holdAfter: 0,
    easing: "linear",
  };
}

function installCameraFixture({
  nodes = [NODE_A, NODE_B],
  segments = [makeSegment()],
}: {
  nodes?: CameraNode[];
  segments?: CameraSegment[];
} = {}) {
  const initial = createInitialDirectorState();
  const template = initial.project.cameras[0]!;
  const camera = {
    ...template,
    id: "cam_1",
    nodes,
    segments,
  };

  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...initial,
    project: {
      ...initial.project,
      cameras: [camera],
      activeCameraId: camera.id,
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

function renderController() {
  render(<CameraPlaybackController />);
  expect(frameCapture.callback).not.toBeNull();
}

function advanceFrame(delta: number) {
  act(() => {
    frameCapture.callback?.({}, delta);
  });
}

beforeEach(() => {
  frameCapture.callback = null;
  installCameraFixture();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("pauses on the next frame when the active camera is missing", () => {
  useDirectorStore.setState((state) => ({
    ...state,
    project: { ...state.project, activeCameraId: "missing-camera" },
  }));
  useCameraPlaybackStore.getState().setPlayheadTime(0.75);
  useCameraPlaybackStore.getState().play();
  renderController();

  advanceFrame(0.25);

  expect(useCameraPlaybackStore.getState()).toMatchObject({ isPlaying: false, playheadTime: 0.75 });
});

it("pauses on the next frame when the active camera has no nodes", () => {
  installCameraFixture({ nodes: [], segments: [] });
  useCameraPlaybackStore.getState().setPlayheadTime(0.75);
  useCameraPlaybackStore.getState().play();
  renderController();

  advanceFrame(0.25);

  expect(useCameraPlaybackStore.getState()).toMatchObject({ isPlaying: false, playheadTime: 0.75 });
});

it("pauses on the next frame when the active camera has only one node", () => {
  installCameraFixture({ nodes: [NODE_A], segments: [] });
  useCameraPlaybackStore.getState().setPlayheadTime(0.75);
  useCameraPlaybackStore.getState().play();
  renderController();

  advanceFrame(0.25);

  expect(useCameraPlaybackStore.getState()).toMatchObject({ isPlaying: false, playheadTime: 0.75 });
});

it.each([
  { label: "zero", duration: 0 },
  { label: "negative", duration: -1 },
  { label: "nonfinite", duration: Number.NaN },
])("pauses on the next frame when the total duration is $label", ({ duration }) => {
  installCameraFixture({ segments: [makeSegment(duration)] });
  useCameraPlaybackStore.getState().setPlayheadTime(0.75);
  useCameraPlaybackStore.getState().play();
  renderController();

  advanceFrame(0.25);

  expect(useCameraPlaybackStore.getState()).toMatchObject({ isPlaying: false, playheadTime: 0.75 });
});

it("pauses when total duration calculation throws", () => {
  const throwingDuration = {
    valueOf: () => {
      throw new Error("duration calculation failed");
    },
  } as unknown as number;
  installCameraFixture({ segments: [makeSegment(throwingDuration)] });
  useCameraPlaybackStore.getState().setPlayheadTime(0.75);
  useCameraPlaybackStore.getState().play();
  renderController();

  advanceFrame(0.25);

  expect(useCameraPlaybackStore.getState()).toMatchObject({ isPlaying: false, playheadTime: 0.75 });
});

it("pauses when path evaluation throws or returns no pose", () => {
  installCameraFixture({ segments: [] });
  useCameraPlaybackStore.getState().setPlayheadTime(0.75);
  useCameraPlaybackStore.getState().play();
  renderController();

  advanceFrame(0.25);

  expect(useCameraPlaybackStore.getState()).toMatchObject({ isPlaying: false, playheadTime: 0.75 });

  installCameraFixture();
  const evaluateSpy = vi.spyOn(cameraPath, "evaluateCameraPath").mockReturnValue(null);
  useCameraPlaybackStore.getState().setPlayheadTime(0.75);
  useCameraPlaybackStore.getState().play();
  renderController();

  advanceFrame(0.25);

  expect(evaluateSpy).toHaveBeenCalled();
  expect(useCameraPlaybackStore.getState()).toMatchObject({ isPlaying: false, playheadTime: 0.75 });
});

it("stops after a valid path is removed during playback without resetting the playhead", () => {
  renderController();
  act(() => {
    useCameraPlaybackStore.getState().setPlayheadTime(0.75);
    useCameraPlaybackStore.getState().play();
  });
  advanceFrame(0.5);
  expect(useCameraPlaybackStore.getState()).toMatchObject({ isPlaying: true, playheadTime: 1.25 });

  useDirectorStore.setState((state) => ({
    ...state,
    project: {
      ...state.project,
      cameras: state.project.cameras.map((camera) =>
        camera.id === "cam_1" ? { ...camera, nodes: [], segments: [] } : camera
      ),
    },
  }));
  advanceFrame(0.5);

  expect(useCameraPlaybackStore.getState()).toMatchObject({ isPlaying: false, playheadTime: 1.25 });
});

it("preserves valid playback advancement and paused scrub evaluation", () => {
  renderController();

  act(() => {
    useCameraPlaybackStore.getState().setPlayheadTime(1);
  });
  expect(useDirectorStore.getState().project.cameras[0]?.fov).toBe(50);
  expect(useCameraPlaybackStore.getState().isPlaying).toBe(false);

  act(() => {
    useCameraPlaybackStore.getState().play();
  });
  advanceFrame(0.25);

  expect(useCameraPlaybackStore.getState()).toMatchObject({ isPlaying: true, playheadTime: 1.25 });
  expect(useDirectorStore.getState().project.cameras[0]?.fov).toBe(52.5);

  advanceFrame(1);

  expect(useCameraPlaybackStore.getState()).toMatchObject({ isPlaying: false, playheadTime: 2 });
  expect(useDirectorStore.getState().project.cameras[0]?.fov).toBe(60);
});
