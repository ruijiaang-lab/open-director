import { act, create } from "@react-three/test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDefaultBezierHandles } from "../camera/cameraPath";
import type { CameraNode, CameraSegment, DirectorCameraShot } from "../schema/directorProject";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import { useCameraPlaybackStore } from "../store/cameraPlaybackStore";
import { CameraPathOverlay } from "./CameraPathOverlay";

vi.mock("@react-three/drei", () => ({
  Html: () => null,
  Line: ({
    name,
    color,
    lineWidth,
    opacity,
    onClick,
  }: {
    name?: string;
    color?: string;
    lineWidth?: number;
    opacity?: number;
    onClick?: (event: { stopPropagation: () => void }) => void;
  }) => (
    <group
      name={name}
      userData={{ mockColor: color, mockLineWidth: lineWidth, mockOpacity: opacity }}
      onClick={onClick}
    />
  ),
  TransformControls: () => <group name="mock-transform-controls" />,
}));

const SHARED_NODE_IDS = ["shared-node-a", "shared-node-b"] as const;
const SHARED_SEGMENT_ID = "shared-node-a:shared-node-b";

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

function makeSegment(): CameraSegment {
  return {
    id: SHARED_SEGMENT_ID,
    fromNodeId: SHARED_NODE_IDS[0],
    toNodeId: SHARED_NODE_IDS[1],
    curveMode: "bezier",
    duration: 2,
    holdAfter: 0,
    easing: "linear",
    handleOut: [0.25, 2, 4.75],
    handleIn: [0.75, 2, 4.25],
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
      segments: [makeSegment()],
    },
    {
      ...template,
      id: "cam_b",
      name: "机位B",
      nodes: makeNodes(10),
      segments: [makeSegment()],
    },
  ];

  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...initial,
    project: {
      ...initial.project,
      cameras,
      activeCameraId: "cam_b",
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

function findNodeMesh(renderer: Awaited<ReturnType<typeof create>>, cameraId: string, nodeId: string) {
  return renderer.scene.findAllByProps({ name: `${cameraId}-node-${nodeId}` })[0]!;
}

function findPathLine(renderer: Awaited<ReturnType<typeof create>>, cameraId: string) {
  return renderer.scene.findAllByProps({ name: `${cameraId}-path-${SHARED_SEGMENT_ID}` })[0]!;
}

beforeEach(() => {
  installTwoCameraFixture();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("does not delete a stale node selection or intercept Delete for the inactive camera", async () => {
  const renderer = await create(<CameraPathOverlay />);
  await act(async () => {
    useCameraPlaybackStore.setState({
      selectedNode: { cameraId: "cam_a", nodeId: SHARED_NODE_IDS[0] },
      selectedSegment: null,
      selectedHandle: null,
    });
  });

  const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
  document.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(false);
  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_a")?.nodes).toHaveLength(2);
  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_b")?.nodes).toHaveLength(2);
  await renderer.unmount();
});

it("does not reset a stale handle selection or intercept Backspace for the inactive camera", async () => {
  const renderer = await create(<CameraPathOverlay />);
  const cameraABefore = useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_a")!;
  const handlesBefore = cameraABefore.segments?.[0];

  await act(async () => {
    useCameraPlaybackStore.setState({
      selectedNode: null,
      selectedSegment: { cameraId: "cam_a", segmentId: SHARED_SEGMENT_ID },
      selectedHandle: { cameraId: "cam_a", segmentId: SHARED_SEGMENT_ID, handle: "out" },
    });
  });

  const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
  document.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(false);
  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_a")?.segments?.[0]).toEqual(
    handlesBefore
  );
  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_b")?.segments?.[0]).toEqual(
    handlesBefore
  );
  await renderer.unmount();
});

it("shows selection visuals only on the active camera while preserving active selection behavior", async () => {
  const renderer = await create(<CameraPathOverlay />);

  await act(async () => {
    useCameraPlaybackStore.setState({
      selectedNode: { cameraId: "cam_a", nodeId: SHARED_NODE_IDS[0] },
      selectedSegment: { cameraId: "cam_a", segmentId: SHARED_SEGMENT_ID },
      selectedHandle: { cameraId: "cam_a", segmentId: SHARED_SEGMENT_ID, handle: "out" },
    });
  });

  findNodeMesh(renderer, "cam_a", SHARED_NODE_IDS[0]);
  const stalePathLine = findPathLine(renderer, "cam_a");
  expect(renderer.scene.findAllByProps({ name: "mock-transform-controls" })).toHaveLength(0);
  expect(stalePathLine.props.userData).toMatchObject({ mockColor: "#4A6FA5", mockLineWidth: 1.5 });
  expect(renderer.scene.findAllByProps({ name: `cam_a-handle-${SHARED_SEGMENT_ID}-out` })).toHaveLength(0);

  await act(async () => {
    useCameraPlaybackStore.setState({
      selectedNode: { cameraId: "cam_b", nodeId: SHARED_NODE_IDS[0] },
      selectedSegment: null,
      selectedHandle: null,
    });
  });

  findNodeMesh(renderer, "cam_b", SHARED_NODE_IDS[0]);
  expect(renderer.scene.findAllByProps({ name: "mock-transform-controls" })).toHaveLength(1);

  await act(async () => {
    useCameraPlaybackStore.setState({
      selectedNode: null,
      selectedSegment: { cameraId: "cam_b", segmentId: SHARED_SEGMENT_ID },
      selectedHandle: { cameraId: "cam_b", segmentId: SHARED_SEGMENT_ID, handle: "out" },
    });
  });

  const activePathLine = findPathLine(renderer, "cam_b");
  expect(activePathLine.props.userData).toMatchObject({ mockLineWidth: 2.5 });
  expect(renderer.scene.findAllByProps({ name: `cam_b-handle-${SHARED_SEGMENT_ID}-out` })).toHaveLength(1);

  await renderer.unmount();
});

it("keeps Delete and Backspace operations working for the active camera", async () => {
  const renderer = await create(<CameraPathOverlay />);

  await act(async () => {
    useCameraPlaybackStore.setState({
      selectedNode: { cameraId: "cam_b", nodeId: SHARED_NODE_IDS[0] },
      selectedSegment: null,
      selectedHandle: null,
    });
  });
  const deleteEvent = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
  document.dispatchEvent(deleteEvent);
  expect(deleteEvent.defaultPrevented).toBe(true);
  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_a")?.nodes).toHaveLength(2);
  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_b")?.nodes).toHaveLength(1);

  await renderer.unmount();
  installTwoCameraFixture();
  const handleRenderer = await create(<CameraPathOverlay />);
  const cameraB = useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_b")!;
  const cameraAHandles = useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_a")?.segments?.[0];
  await act(async () => {
    useCameraPlaybackStore.setState({
      selectedNode: null,
      selectedSegment: { cameraId: "cam_b", segmentId: SHARED_SEGMENT_ID },
      selectedHandle: { cameraId: "cam_b", segmentId: SHARED_SEGMENT_ID, handle: "out" },
    });
  });

  const backspaceEvent = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
  document.dispatchEvent(backspaceEvent);
  const expectedHandles = getDefaultBezierHandles(cameraB.nodes![0]!.position, cameraB.nodes![1]!.position);
  expect(backspaceEvent.defaultPrevented).toBe(true);
  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_a")?.segments?.[0]).toEqual(
    cameraAHandles
  );
  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === "cam_b")?.segments?.[0]).toMatchObject(
    expectedHandles
  );
  await handleRenderer.unmount();
});
