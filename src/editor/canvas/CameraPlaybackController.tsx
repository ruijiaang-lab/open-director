import { useFrame } from "@react-three/fiber";
import { useEffect } from "react";
import type { Quaternion } from "three";
import { evaluateCameraPath, getCameraPathDuration } from "../camera/cameraPath";
import { useDirectorStore } from "../store/directorStore";
import { useCameraPlaybackStore } from "../store/cameraPlaybackStore";

/**
 * 播放引擎：isPlaying 时按真实时间推进播放头并求值写入机位；
 * 未播放时播放头变化（Timeline scrub）同样立即求值写入机位。
 * 姿态只写 store 的机位 transform/target/fov，不进 undo、不写 localStorage。
 */
export function CameraPlaybackController() {
  const isPlaying = useCameraPlaybackStore((state) => state.isPlaying);
  const playheadTime = useCameraPlaybackStore((state) => state.playheadTime);

  // 非播放状态：scrub 一次，机位立即跳到对应姿态
  useEffect(() => {
    if (isPlaying) return;
    applyPlayheadPose(playheadTime);
  }, [isPlaying, playheadTime]);

  useFrame((_, delta) => {
    // 帧循环一律读实时 store 而不是渲染闭包/ref：React 重渲染在 rAF 之后，
    // 用旧值会让「停止后不归零」「重点播放直接跳到末尾」这类竞态反复出现
    if (!useCameraPlaybackStore.getState().isPlaying) return;

    const { project } = useDirectorStore.getState();
    const camera = project.cameras.find((item) => item.id === project.activeCameraId);
    if (!camera?.nodes) return;

    const nodes = camera.nodes;
    const segments = camera.segments ?? [];
    const total = getCameraPathDuration(nodes, segments);
    const nextTime = Math.min(useCameraPlaybackStore.getState().playheadTime + delta, total);

    applyPlayheadPose(nextTime);
    useCameraPlaybackStore.getState().setPlayheadTime(nextTime);
    if (nextTime >= total) {
      useCameraPlaybackStore.getState().pause();
    }
  });

  return null;
}

function applyPlayheadPose(time: number) {
  const { project } = useDirectorStore.getState();
  const camera = project.cameras.find((item) => item.id === project.activeCameraId);
  if (!camera?.nodes?.length) return;

  const pose = evaluateCameraPath(camera.nodes, camera.segments ?? [], time);
  if (!pose) return;

  const rotation = pose.rotation as Quaternion;
  useDirectorStore.getState().applyPlaybackPose(camera.id, {
    position: [pose.position.x, pose.position.y, pose.position.z],
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
    fov: pose.fov,
  });
}
