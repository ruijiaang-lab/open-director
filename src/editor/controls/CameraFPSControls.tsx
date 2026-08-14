import { PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Quaternion, Vector3 } from "three";
import type { PerspectiveCamera } from "three";
import { useDirectorStore } from "../store/directorStore";
import { useCameraPlaybackStore } from "../store/cameraPlaybackStore";

/** 基础移动速度（米/秒），Shift 加速倍率 */
export const FPS_BASE_SPEED = 3.5;
export const FPS_BOOST_MULTIPLIER = 2.5;
const FPS_MAX_FRAME_DELTA = 0.05;

/** K 判据：当前掌镜位置离已有节点足够近（位置+朝向）视为在重调该镜头，更新它；否则视为新镜头。
 * 阈值刻意收紧：连续录镜头时两次机位可能只差半米，阈值太大会把「新镜头」误判成「重调旧镜头」。
 * 拿不准时先点选节点再按 K，选中后 K 无条件更新选中节点。 */
export const K_UPDATE_MAX_DISTANCE = 1;
export const K_UPDATE_MAX_ANGLE_DEG = 20;

export interface FPSMovementKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

/**
 * 按局部坐标系计算 FPS 移动：offset 先按相机局部轴构造（前=-Z，右=+X，上=+Y），
 * 再乘相机四元数转世界方向。
 */
export function computeFPSMovement(
  position: Vector3,
  quaternion: Quaternion,
  keys: FPSMovementKeys,
  deltaSeconds: number,
  boost: boolean
): Vector3 {
  const offset = new Vector3();
  if (keys.forward) offset.z -= 1;
  if (keys.back) offset.z += 1;
  if (keys.left) offset.x -= 1;
  if (keys.right) offset.x += 1;
  if (keys.up) offset.y += 1;
  if (keys.down) offset.y -= 1;

  if (offset.lengthSq() === 0) return position.clone();

  const speed = FPS_BASE_SPEED * (boost ? FPS_BOOST_MULTIPLIER : 1);
  offset.applyQuaternion(quaternion).normalize();
  return position.clone().add(offset.multiplyScalar(speed * deltaSeconds));
}

function getCameraPose(camera: PerspectiveCamera) {
  return {
    position: [camera.position.x, camera.position.y, camera.position.z] as [number, number, number],
    rotation: [
      camera.quaternion.x,
      camera.quaternion.y,
      camera.quaternion.z,
      camera.quaternion.w,
    ] as [number, number, number, number],
    fov: camera.fov,
  };
}

const MOVEMENT_KEYS: Record<string, keyof FPSMovementKeys> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyQ: "down",
  KeyE: "up",
};

const EMPTY_KEYS: FPSMovementKeys = { forward: false, back: false, left: false, right: false, up: false, down: false };

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

/**
 * 机位掌镜控制：WASD+Q/E 移动、Shift 加速；鼠标锁定负责转向，K 记录运镜节点。
 * 仅在 viewMode === "camera" 时渲染。
 */
export function CameraFPSControls({ onLockChange }: { onLockChange?: (locked: boolean) => void }) {
  const { camera } = useThree();
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const keysRef = useRef<FPSMovementKeys>({ ...EMPTY_KEYS });
  const boostRef = useRef(false);
  // 每帧更新的最后姿态快照：卸载清理不能直接读相机实时值，
  // 因为切回导演视角时 DirectorViewCameraSync 的 layout effect 会先把相机
  // 重置为导演快照，被动 effect 清理此时读到的已是覆盖后的值，移动会丢失
  const poseRef = useRef(getCameraPose(camera as PerspectiveCamera));
  // 只有用户真的移动/转动过机位才允许写回 store。React StrictMode 会在首次挂载时
  // 执行一次 setup -> cleanup -> setup；此时共享相机仍可能是导演视角，不能把它误写成机位姿态。
  const poseDirtyRef = useRef(false);
  const hasCapturedFrameRef = useRef(false);

  const activeCameraId = useDirectorStore((state) => state.project.activeCameraId);
  // 播放期间掌镜输入全部停用，姿态由播放引擎接管
  const isPlaying = useCameraPlaybackStore((state) => state.isPlaying);
  const isPlayingRef = useRef(isPlaying);

  isPlayingRef.current = isPlaying;

  useEffect(() => {
    if (isPlaying) {
      keysRef.current = { ...EMPTY_KEYS };
      boostRef.current = false;
    }
  }, [isPlaying]);
  const trackedObjectTarget = useDirectorStore((state) => {
    const activeCamera = state.project.cameras.find((item) => item.id === state.project.activeCameraId);
    return activeCamera?.targetMode === "object" ? activeCamera.target : null;
  });
  const activeCameraFov = useDirectorStore((state) =>
    state.project.cameras.find((item) => item.id === state.project.activeCameraId)?.fov
  );
  const previousCameraIdRef = useRef(activeCameraId);
  // 记录 poseRef 那一帧对应的 store FOV。若面板在最后一帧之后刚修改 FOV，
  // store 值会与它不同，此时同步姿态必须保留更新后的面板值。
  const poseStoreFovRef = useRef(activeCameraFov);

  useEffect(() => {
    // 组件挂载时以当前相机姿态（已应用机位快照）为基准
    poseRef.current = getCameraPose(camera as PerspectiveCamera);
  }, [camera]);

  useEffect(() => {
    // 切换机位（不卸载组件）时，先把旧机位最后掌镜姿态存回 store，切走再切回视角不丢
    if (
      previousCameraIdRef.current &&
      previousCameraIdRef.current !== activeCameraId &&
      poseDirtyRef.current
    ) {
      const store = useDirectorStore.getState();
      const previousCamera = store.project.cameras.find((item) => item.id === previousCameraIdRef.current);
      store.syncCameraPose(previousCameraIdRef.current, {
        ...poseRef.current,
        fov:
          previousCamera?.fov !== poseStoreFovRef.current
            ? previousCamera?.fov ?? poseRef.current.fov
            : poseRef.current.fov,
      });
    }
    previousCameraIdRef.current = activeCameraId;
    poseDirtyRef.current = false;
    hasCapturedFrameRef.current = false;
    poseStoreFovRef.current = useDirectorStore
      .getState()
      .project.cameras.find((item) => item.id === activeCameraId)?.fov;
  }, [activeCameraId]);

  useEffect(() => {
    // 组件卸载（如 Space 切回导演视角）时：
    // 1. 把最后掌镜位置同步回机位，切走再切回视角不丢
    // 2. 释放鼠标锁定，避免浏览器指针锁残留
    return () => {
      const store = useDirectorStore.getState();
      const cameraId = store.project.activeCameraId;
      if (cameraId && poseDirtyRef.current) {
        const activeCamera = store.project.cameras.find((item) => item.id === cameraId);
        store.syncCameraPose(cameraId, {
          ...poseRef.current,
          fov:
            activeCamera?.fov !== poseStoreFovRef.current
              ? activeCamera?.fov ?? poseRef.current.fov
              : poseRef.current.fov,
        });
      }
      if (document.pointerLockElement) {
        document.exitPointerLock?.();
      }
    };
  }, [camera]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;

      if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
        boostRef.current = true;
        return;
      }

      const movementKey = MOVEMENT_KEYS[event.code];
      if (movementKey) {
        keysRef.current[movementKey] = true;
        event.preventDefault();
        return;
      }

      if (event.code === "Escape" && lockedRef.current) {
        document.exitPointerLock?.();
        return;
      }

      if (event.code === "KeyK" && lockedRef.current && !isPlayingRef.current) {
        const store = useDirectorStore.getState();
        const cameraId = store.project.activeCameraId;
        if (!cameraId) return;
        const activeCamera = store.project.cameras.find((item) => item.id === cameraId);
        if (!activeCamera) return;
        const pose = getCameraPose(camera as PerspectiveCamera);
        // 显式选中了节点：K = 用当前掌镜视角更新该节点
        const selection = useCameraPlaybackStore.getState().selectedNode;
        if (selection?.cameraId === cameraId) {
          store.updateCameraNode(cameraId, selection.nodeId, pose);
          return;
        }
        // 没选中节点时按距离判断意图：掌镜位置紧挨某个已有节点（位置+朝向都近）
        // 就是在重调这个镜头 → 更新它；离所有节点都远 = 来到了新机位 → 新建节点
        const currentPosition = new Vector3(...pose.position);
        const currentQuaternion = new Quaternion(...pose.rotation);
        let best: { nodeId: string; angleDeg: number } | null = null;
        for (const node of activeCamera.nodes ?? []) {
          if (currentPosition.distanceTo(new Vector3(...node.position)) > K_UPDATE_MAX_DISTANCE) continue;
          const angleDeg = (currentQuaternion.angleTo(new Quaternion(...node.rotation)) * 180) / Math.PI;
          if (angleDeg > K_UPDATE_MAX_ANGLE_DEG) continue;
          if (!best || angleDeg < best.angleDeg) best = { nodeId: node.id, angleDeg };
        }
        if (best) {
          store.updateCameraNode(cameraId, best.nodeId, pose);
          return;
        }
        store.recordCameraNode(cameraId, pose);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
        boostRef.current = false;
        return;
      }

      const movementKey = MOVEMENT_KEYS[event.code];
      if (movementKey) {
        keysRef.current[movementKey] = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [camera]);

  useFrame((_, delta) => {
    const fpsCamera = camera as PerspectiveCamera;
    if (isPlayingRef.current) {
      poseRef.current = getCameraPose(fpsCamera);
      return;
    }
    const hasMovementInput = Object.values(keysRef.current).some(Boolean);
    const previousPose = poseRef.current;
    if (
      lockedRef.current &&
      hasCapturedFrameRef.current &&
      !fpsCamera.quaternion.equals(new Quaternion(...previousPose.rotation))
    ) {
      poseDirtyRef.current = true;
    }
    fpsCamera.position.copy(
      computeFPSMovement(
        fpsCamera.position,
        fpsCamera.quaternion,
        keysRef.current,
        Math.min(delta, FPS_MAX_FRAME_DELTA),
        boostRef.current
      )
    );
    if (hasMovementInput) {
      poseDirtyRef.current = true;
    }
    if (trackedObjectTarget) {
      fpsCamera.lookAt(...trackedObjectTarget);
    }
    // 移动之后记录，保证 poseRef 是每帧结束时的姿态
    poseRef.current = getCameraPose(fpsCamera);
    poseStoreFovRef.current = activeCameraFov;
    hasCapturedFrameRef.current = true;
  });

  return (
    <PointerLockControls
      onLock={() => {
        lockedRef.current = true;
        setLocked(true);
        onLockChange?.(true);
      }}
      onUnlock={() => {
        lockedRef.current = false;
        setLocked(false);
        onLockChange?.(false);
      }}
    />
  );
}
