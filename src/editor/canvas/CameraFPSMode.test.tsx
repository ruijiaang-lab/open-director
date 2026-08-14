import { StrictMode, useEffect } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { Group, PerspectiveCamera, Vector3 } from "three";
import { DirectorCanvas } from "./DirectorCanvas";
import { getCameraViewSnapshotFromShot } from "../schema/cameraGeometry";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import { useCameraPlaybackStore } from "../store/cameraPlaybackStore";

vi.mock("@react-three/drei", async () => {
  const { useEffect } = await import("react");
  return {
    PointerLockControls: ({ onLock, onUnlock }: { onLock?: () => void; onUnlock?: () => void }) => (
      <div
        data-testid="mock-pointer-lock"
        onClick={() => onLock?.()}
        onDoubleClick={() => onUnlock?.()}
      />
    ),
    OrbitControls: () => null,
    Grid: () => null,
    GizmoHelper: () => null,
    GizmoViewport: () => null,
    // 模拟 drei PerspectiveCamera 的真实行为：props 变化时把位置应用到共享相机并触发 onUpdate
    PerspectiveCamera: ({
      fov,
      position,
      onUpdate,
    }: {
      fov?: number;
      position?: [number, number, number];
      onUpdate?: (camera: PerspectiveCamera) => void;
    }) => {
      useEffect(() => {
        if (!mockSceneCamera.camera) return;
        const applyCameraProps = () => {
          if (fov !== undefined) mockSceneCamera.camera.fov = fov;
          if (position) mockSceneCamera.camera.position.set(...position);
          onUpdate?.(mockSceneCamera.camera);
        };
        if (mockPerspectiveCameraLifecycle.deferApply) {
          queueMicrotask(applyCameraProps);
        } else {
          applyCameraProps();
        }
      }, [fov, position, onUpdate]);
      return null;
    },
    TransformControls: () => null,
    Html: () => null,
    Line: () => null,
  };
});

const mockSceneCamera = vi.hoisted(() => ({ camera: null as unknown as PerspectiveCamera }));
const mockFrameCallbacks = vi.hoisted(() => ({ callbacks: [] as Array<(state: unknown, delta: number) => void> }));
const mockPerspectiveCameraLifecycle = vi.hoisted(() => ({ deferApply: false }));

vi.mock("@react-three/fiber", () => ({
  Canvas: ({
    children,
    className,
    onPointerMissed,
  }: {
    children: React.ReactNode;
    className?: string;
    onPointerMissed?: () => void;
  }) => {
    // 坐标轴小视图是独立 Canvas，真实环境有自己的场景；mock 下共享相机
    // 会互相覆盖位置，直接跳过渲染
    if (className === "viewport-gizmo-canvas") return null;
    return (
      <div className={className} data-testid="mock-r3f-canvas" onClick={() => onPointerMissed?.()}>
        {children}
      </div>
    );
  },
  useFrame: (callback: (state: unknown, delta: number) => void) => {
    mockFrameCallbacks.callbacks.push(callback);
  },
  useLoader: () => ({ scene: new Group() }),
  useThree: () => {
    if (!mockSceneCamera.camera) {
      mockSceneCamera.camera = new PerspectiveCamera(50, 800 / 600, 0.1, 1000);
    }
    return {
      camera: mockSceneCamera.camera,
      gl: { domElement: {}, setClearColor: () => undefined },
      scene: {
        background: null,
        backgroundBlurriness: 0,
        backgroundIntensity: 1,
        backgroundRotation: { set: () => undefined },
        traverse: () => undefined,
      },
    };
  },
}));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
  mockFrameCallbacks.callbacks.length = 0;
  mockPerspectiveCameraLifecycle.deferApply = false;
  if (mockSceneCamera.camera) {
    mockSceneCamera.camera.position.set(0, 0, 0);
    mockSceneCamera.camera.quaternion.set(0, 0, 0, 1);
  }
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...createInitialDirectorState(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function pressSpace() {
  fireEvent.keyDown(window, { code: "Space" });
}

it("switches between director and camera view with Space", () => {
  render(<DirectorCanvas />);

  expect(screen.queryByText(/进入掌镜模式/)).toBeNull();

  pressSpace();
  expect(screen.getByText(/点击画面进入掌镜模式/)).toBeTruthy();

  pressSpace();
  expect(screen.queryByText(/进入掌镜模式/)).toBeNull();
});

it("does not write a stale shared-camera pose during the StrictMode mount cleanup", () => {
  const initialCamera = useDirectorStore.getState().project.cameras[0];
  const initialTransform = structuredClone(initialCamera.transform);
  const initialTarget = [...initialCamera.target];
  mockPerspectiveCameraLifecycle.deferApply = true;
  mockSceneCamera.camera = new PerspectiveCamera(31, 800 / 600, 0.1, 1000);
  mockSceneCamera.camera.position.set(27, 14, -9);
  mockSceneCamera.camera.quaternion.set(0, 0, 0, 1);
  mockSceneCamera.camera.fov = 31;
  useDirectorStore.getState().setViewMode("camera");

  render(
    <StrictMode>
      <DirectorCanvas />
    </StrictMode>
  );

  const cameraAfterMount = useDirectorStore.getState().project.cameras[0];
  expect(cameraAfterMount.transform).toEqual(initialTransform);
  expect(cameraAfterMount.target).toEqual(initialTarget);
  expect(cameraAfterMount.fov).toBe(initialCamera.fov);
});

it("refreshes the perspective projection when the inspector FOV changes", async () => {
  render(<DirectorCanvas />);
  pressSpace();
  const updateProjectionSpy = vi.spyOn(mockSceneCamera.camera, "updateProjectionMatrix");
  updateProjectionSpy.mockClear();

  useDirectorStore.getState().updateCamera("cam_1", { fov: 67 });

  await waitFor(() => expect(mockSceneCamera.camera.fov).toBe(67));
  expect(updateProjectionSpy).toHaveBeenCalled();
});

it("shows the fps control hint and records a camera node with K while locked", () => {
  render(<DirectorCanvas />);
  pressSpace();

  // 未锁定：提示点击进入掌镜
  fireEvent.click(screen.getByTestId("mock-pointer-lock"));
  expect(screen.getByText(/WASD 移动/)).toBeTruthy();
  expect(screen.getByText(/已记录 0 个/)).toBeTruthy();

  // 机位视角下相机位于视点位置（初始快照 [0,1.55,5.4] 看向 [0,1.05,0]）
  const viewCamera = new PerspectiveCamera();
  viewCamera.position.set(0, 1.55, 5.4);
  viewCamera.lookAt(0, 1.05, 0);
  const expectedRotation = [
    viewCamera.quaternion.x,
    viewCamera.quaternion.y,
    viewCamera.quaternion.z,
    viewCamera.quaternion.w,
  ];

  // K 记录第一个节点：记录相机当前视点姿态
  fireEvent.keyDown(window, { code: "KeyK" });
  let camera = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1");
  expect(camera?.nodes).toHaveLength(1);
  expect(camera?.nodes?.[0]?.position[0]).toBeCloseTo(0, 5);
  expect(camera?.nodes?.[0]?.position[1]).toBeCloseTo(1.55, 5);
  expect(camera?.nodes?.[0]?.position[2]).toBeCloseTo(5.4, 5);
  expectedRotation.forEach((value, index) =>
    expect(camera?.nodes?.[0]?.rotation?.[index]).toBeCloseTo(value, 5)
  );
  expect(screen.getByText(/已记录 1 个/)).toBeTruthy();

  // 飞到离 node_1 足够远的新位置再按 K：新建第二个节点，time 递增
  mockSceneCamera.camera.position.set(10, 1.6, 15);
  fireEvent.keyDown(window, { code: "KeyK" });
  camera = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1");
  expect(camera?.nodes?.map((item) => item.id)).toEqual(["node_1", "node_2"]);
  expect(camera?.nodes?.map((item) => item.time)).toEqual([0, 1]);
});

it("updates the selected node with K instead of appending a new node", () => {
  render(<DirectorCanvas />);
  pressSpace();
  fireEvent.click(screen.getByTestId("mock-pointer-lock"));
  fireEvent.keyDown(window, { code: "KeyK" }); // 先记录 node_1

  useCameraPlaybackStore.getState().selectNode({ cameraId: "cam_1", nodeId: "node_1" });
  mockSceneCamera.camera.position.set(3, 2, 9);
  mockSceneCamera.camera.quaternion.identity();
  fireEvent.keyDown(window, { code: "KeyK" }); // 选中节点后按 K = 更新该节点

  const camera = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1");
  expect(camera?.nodes).toHaveLength(1);
  expect(camera?.nodes?.[0]?.position[0]).toBeCloseTo(3, 5);
  expect(camera?.nodes?.[0]?.position[1]).toBeCloseTo(2, 5);
  expect(camera?.nodes?.[0]?.position[2]).toBeCloseTo(9, 5);

  // 取消选中后飞远再按 K：恢复为追加新节点
  useCameraPlaybackStore.getState().selectNode(null);
  mockSceneCamera.camera.position.set(12, 2, 9);
  fireEvent.keyDown(window, { code: "KeyK" });
  const cameraAfterAppend = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1");
  expect(cameraAfterAppend?.nodes).toHaveLength(2);
});

it("updates the nearest node with K without selection when posing nearby, appends when far", () => {
  render(<DirectorCanvas />);
  pressSpace();
  fireEvent.click(screen.getByTestId("mock-pointer-lock"));
  fireEvent.keyDown(window, { code: "KeyK" }); // 先记录 node_1（视点姿态 [0,1.55,5.4]）

  // 不选中任何节点：掌镜位置紧挨 node_1（位置 0.7m、朝向相同）→ K 更新它
  mockSceneCamera.camera.position.set(0.5, 1.55, 4.9);
  fireEvent.keyDown(window, { code: "KeyK" });
  let camera = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1");
  expect(camera?.nodes).toHaveLength(1);
  expect(camera?.nodes?.[0]?.position[0]).toBeCloseTo(0.5, 5);
  expect(camera?.nodes?.[0]?.position[2]).toBeCloseTo(4.9, 5);

  // 飞到远处新机位 → K 新建节点
  mockSceneCamera.camera.position.set(15, 1.6, 15);
  fireEvent.keyDown(window, { code: "KeyK" });
  camera = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1");
  expect(camera?.nodes).toHaveLength(2);
});

it("moves with WASD when pointer lock is unavailable", () => {
  render(<DirectorCanvas />);
  pressSpace();

  const startPosition = mockSceneCamera.camera.position.clone();
  fireEvent.keyDown(window, { code: "KeyW" });
  mockFrameCallbacks.callbacks.forEach((callback) => callback(undefined, 1 / 60));
  fireEvent.keyUp(window, { code: "KeyW" });

  expect(mockSceneCamera.camera.position.distanceTo(startPosition)).toBeGreaterThan(0);
});

it("keeps an object target centered while WASD moves the camera", () => {
  useDirectorStore.getState().updateCamera("cam_1", {
    targetMode: "object",
    targetObjectId: "char_default_a",
    target: [0, 1, 0],
  });
  render(<DirectorCanvas />);
  pressSpace();

  fireEvent.keyDown(window, { code: "KeyA" });
  mockFrameCallbacks.callbacks.forEach((callback) => callback(undefined, 1 / 60));
  fireEvent.keyUp(window, { code: "KeyA" });

  const target = useDirectorStore.getState().project.cameras[0].target;
  const expectedCamera = new PerspectiveCamera();
  expectedCamera.position.copy(mockSceneCamera.camera.position);
  expectedCamera.lookAt(...target);

  expect(mockSceneCamera.camera.quaternion.x).toBeCloseTo(expectedCamera.quaternion.x, 5);
  expect(mockSceneCamera.camera.quaternion.y).toBeCloseTo(expectedCamera.quaternion.y, 5);
  expect(mockSceneCamera.camera.quaternion.z).toBeCloseTo(expectedCamera.quaternion.z, 5);
  expect(mockSceneCamera.camera.quaternion.w).toBeCloseTo(expectedCamera.quaternion.w, 5);
});

it("does not move with WASD while typing in an editable field", () => {
  render(<DirectorCanvas />);
  pressSpace();

  const input = document.createElement("input");
  document.body.append(input);
  const startPosition = mockSceneCamera.camera.position.clone();

  fireEvent.keyDown(input, { code: "KeyW" });
  mockFrameCallbacks.callbacks.forEach((callback) => callback(undefined, 1 / 60));
  fireEvent.keyUp(input, { code: "KeyW" });

  expect(mockSceneCamera.camera.position.distanceTo(startPosition)).toBe(0);
  input.remove();
});

it("keeps the camera pose and fov when switching between cameras", async () => {
  render(<DirectorCanvas />);
  pressSpace(); // 机位视角
  fireEvent.click(screen.getByTestId("mock-pointer-lock")); // 锁定进入掌镜

  // 机位01 掌镜移动 + 调整取景（fov）
  fireEvent.keyDown(window, { code: "KeyW" });
  mockFrameCallbacks.callbacks.forEach((callback) => callback(undefined, 1 / 60));
  fireEvent.keyUp(window, { code: "KeyW" });
  mockFrameCallbacks.callbacks.forEach((callback) => callback(undefined, 1 / 60));
  mockSceneCamera.camera.fov = 42;
  // 模拟真实帧循环：fov 调整后走一帧，让 FPS 控制器的姿态记录跟上（useFrame 每帧更新 poseRef）
  mockFrameCallbacks.callbacks.forEach((callback) => callback(undefined, 1 / 60));

  const movedPosition = mockSceneCamera.camera.position.clone();
  const movedQuaternion = mockSceneCamera.camera.quaternion.clone();

  // 新增机位02 并自动激活 → 切机位时旧机位姿态必须已保存（effect 在 act 外执行，等待 flush）
  useDirectorStore.getState().addCameraShot();
  const forward = new Vector3(0, 0, -1).applyQuaternion(movedQuaternion);
  const expectedRig = movedPosition.clone().sub(forward.multiplyScalar(1.82));
  await waitFor(() => {
    const cam1 = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1");
    expect(cam1?.transform.position?.[0]).toBeCloseTo(expectedRig.x, 4);
    expect(cam1?.transform.position?.[1]).toBeCloseTo(expectedRig.y, 4);
    expect(cam1?.transform.position?.[2]).toBeCloseTo(expectedRig.z, 4);
    expect(cam1?.fov).toBe(42);
    expect(cam1?.nodes ?? []).toHaveLength(0);
  });
});

it("re-orients the camera to the new camera target when switching while locked", async () => {
  render(<DirectorCanvas />);
  pressSpace(); // 机位视角
  fireEvent.click(screen.getByTestId("mock-pointer-lock")); // 锁定（锁定期间 lookAt 通常被跳过）

  // 切到机位02：锁定状态下也必须看向新机位的目标
  useDirectorStore.getState().addCameraShot();
  await waitFor(() => {
    const cam2 = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_2");
    expect(cam2).toBeTruthy();
    const view = getCameraViewSnapshotFromShot(cam2!);
    const refCamera = new PerspectiveCamera();
    refCamera.position.set(...view.position);
    refCamera.lookAt(...cam2!.target);
    expect(mockSceneCamera.camera.quaternion.x).toBeCloseTo(refCamera.quaternion.x, 4);
    expect(mockSceneCamera.camera.quaternion.y).toBeCloseTo(refCamera.quaternion.y, 4);
    expect(mockSceneCamera.camera.quaternion.z).toBeCloseTo(refCamera.quaternion.z, 4);
    expect(mockSceneCamera.camera.quaternion.w).toBeCloseTo(refCamera.quaternion.w, 4);
  });
});

it("does not record camera nodes outside the locked fps mode", () => {
  render(<DirectorCanvas />);

  fireEvent.keyDown(window, { code: "KeyK" });
  const camera = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1");
  expect(camera?.nodes ?? []).toHaveLength(0);
});

it("releases the pointer lock when leaving camera view with Space", () => {
  const exitSpy = vi.fn();
  Object.defineProperty(document, "exitPointerLock", { configurable: true, value: exitSpy });
  Object.defineProperty(document, "pointerLockElement", {
    configurable: true,
    get: () => ({ tagName: "CANVAS" }),
  });

  render(<DirectorCanvas />);
  pressSpace(); // 进入机位视角（此时未锁定，不触发释放）
  expect(exitSpy).not.toHaveBeenCalled();

  pressSpace(); // 切回导演视角：若仍处于锁定态则必须释放（Space handler + 控制器卸载双重保险）
  expect(exitSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

  delete (document as unknown as Record<string, unknown>).exitPointerLock;
  delete (document as unknown as Record<string, unknown>).pointerLockElement;
});

it("keeps the camera pose when leaving camera view", () => {
  render(<DirectorCanvas />);
  pressSpace(); // 进入机位视角
  fireEvent.click(screen.getByTestId("mock-pointer-lock")); // 锁定进入掌镜

  // 掌镜移动：按住 W 走一帧
  fireEvent.keyDown(window, { code: "KeyW" });
  mockFrameCallbacks.callbacks.forEach((callback) => callback(undefined, 1 / 60));
  fireEvent.keyUp(window, { code: "KeyW" });

  // 移动后、切走前记录相机姿态，作为期望的同步结果
  const sceneCamera = mockSceneCamera.camera;
  const movedPosition = sceneCamera.position.clone();
  const movedQuaternion = sceneCamera.quaternion.clone();

  pressSpace(); // 切回导演视角 → FPS 控制器卸载 → 姿态同步回机位
  const camera = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1");
  // rig 位置 = 视点沿相机朝向后退一个视锥深度（不能被导演快照覆盖）
  const forward = new Vector3(0, 0, -1).applyQuaternion(movedQuaternion);
  const expectedRig = movedPosition.clone().sub(forward.multiplyScalar(1.82));
  expect(camera?.transform.position?.[0]).toBeCloseTo(expectedRig.x, 4);
  expect(camera?.transform.position?.[1]).toBeCloseTo(expectedRig.y, 4);
  expect(camera?.transform.position?.[2]).toBeCloseTo(expectedRig.z, 4);
  expect(camera?.nodes ?? []).toHaveLength(0);
});

it("switches view mode and camera from the toolbar", async () => {
  render(<DirectorCanvas />);

  fireEvent.click(screen.getByRole("button", { name: "切换到机位视角" }));
  expect(useDirectorStore.getState().viewMode).toBe("camera");

  // 新增第二台机位后下拉可切换（addCameraShot 自动激活新机位）
  useDirectorStore.getState().addCameraShot();
  const nextCameras = useDirectorStore.getState().project.cameras;
  await waitFor(() =>
    expect((screen.getByRole("combobox", { name: "切换机位" }) as HTMLSelectElement).options).toHaveLength(2)
  );
  // 模拟真实帧循环：渲染后走一帧，让 FPS 控制器的姿态记录跟上新机位视点，
  // 否则切机位时 syncCameraPose 会用 stale 姿态覆盖新机位
  mockFrameCallbacks.callbacks.forEach((callback) => callback(undefined, 1 / 60));

  const expectCameraAtView = (view: ReturnType<typeof getCameraViewSnapshotFromShot>) => {
    expect(mockSceneCamera.camera.position.x).toBeCloseTo(view.position[0], 5);
    expect(mockSceneCamera.camera.position.y).toBeCloseTo(view.position[1], 5);
    expect(mockSceneCamera.camera.position.z).toBeCloseTo(view.position[2], 5);
  };

  // 新机位被激活：相机应停在新机位的视点位置（rig + 朝向 × 视锥深度）
  expectCameraAtView(getCameraViewSnapshotFromShot(nextCameras[1]));

  // 切回第一台机位：视角必须跟着变，不能停留在上一台机位
  const select = screen.getByRole("combobox", { name: "切换机位" }) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: nextCameras[0].id } });
  expect(useDirectorStore.getState().project.activeCameraId).toBe(nextCameras[0].id);
  await waitFor(() => expectCameraAtView(getCameraViewSnapshotFromShot(nextCameras[0])));

  // 再切到第二台：视角再次跟随
  fireEvent.change(select, { target: { value: nextCameras[1].id } });
  await waitFor(() => expectCameraAtView(getCameraViewSnapshotFromShot(nextCameras[1])));
});

it("creates a new camera from the current camera pose in camera view", () => {
  render(<DirectorCanvas />);
  pressSpace(); // 进入机位视角

  // 掌镜移动相机后，添加机位应以当前看到的视角为新机位视角
  fireEvent.click(screen.getByTestId("mock-pointer-lock"));
  fireEvent.keyDown(window, { code: "KeyW" });
  mockFrameCallbacks.callbacks.forEach((callback) => callback(undefined, 1 / 60));
  fireEvent.keyUp(window, { code: "KeyW" });
  // 桥组件每帧先于 FPS 控制器记录姿态，松开按键后再走一帧让记录跟上最终姿态
  mockFrameCallbacks.callbacks.forEach((callback) => callback(undefined, 1 / 60));

  const movedPosition = mockSceneCamera.camera.position.clone();
  fireEvent.click(screen.getByRole("button", { name: "添加机位" }));
  const nextCameras = useDirectorStore.getState().project.cameras;
  expect(nextCameras).toHaveLength(2);

  // 新机位视角应落在当前看到的视点，而不是默认导演视角位置
  const view = getCameraViewSnapshotFromShot(nextCameras[1]);
  expect(view.position[0]).toBeCloseTo(movedPosition.x, 4);
  expect(view.position[1]).toBeCloseTo(movedPosition.y, 4);
  expect(view.position[2]).toBeCloseTo(movedPosition.z, 4);
});

it("does not trigger scene deselection when clicking inside camera view", () => {
  render(<DirectorCanvas />);
  pressSpace();

  const deselectSpy = vi.spyOn(useDirectorStore.getState(), "openSceneInspector").mockImplementation(() => {});
  fireEvent.click(screen.getAllByTestId("mock-r3f-canvas")[0]);
  expect(deselectSpy).not.toHaveBeenCalled();
  deselectSpy.mockRestore();
});
