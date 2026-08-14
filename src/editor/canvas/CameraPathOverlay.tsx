import { Html, Line, TransformControls } from "@react-three/drei";
import { useLayoutEffect, useEffect, useMemo, useRef } from "react";
import { Group, type Object3D } from "three";
import type { TransformControls as TransformControlsImpl } from "three-stdlib";
import type { CameraNode, CameraSegment, DirectorCameraShot } from "../schema/directorProject";
import { buildCameraSegments, getDefaultBezierHandles, getNodeStartTimes, getSegmentRenderPoints } from "../camera/cameraPath";
import { useDirectorStore } from "../store/directorStore";
import { useCameraPlaybackStore } from "../store/cameraPlaybackStore";

const ACTIVE_PATH_COLOR = "#FFA94D";
const INACTIVE_PATH_COLOR = "#4A6FA5";
const NODE_COLOR = "#FFD8A8";
const NODE_SELECTED_COLOR = "#FFA94D";
const HANDLE_COLOR = "#C3F2A4";
const NODE_RADIUS = 0.11;
const HANDLE_RADIUS = 0.07;
const NODE_LABEL_DISTANCE_FACTOR = 3;
const HIDE_FROM_VIEWPORT_CAPTURE_KEY = "hideFromViewportCapture";

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function getNodeLabel(index: number) {
  return String.fromCharCode(65 + (index % 26));
}

/**
 * God View 中的运镜路径层：渲染所有机位的路径线、节点、贝塞尔手柄，
 * 并支持 3D 点选/拖动编辑。仅在导演视角渲染（机位视角不可见）。
 */
export function CameraPathOverlay() {
  const viewMode = useDirectorStore((state) => state.viewMode);
  const cameras = useDirectorStore((state) => state.project.cameras);
  const activeCameraId = useDirectorStore((state) => state.project.activeCameraId);
  const selectObject = useDirectorStore((state) => state.selectObject);
  const setActiveCamera = useDirectorStore((state) => state.setActiveCamera);
  const selectNode = useCameraPlaybackStore((state) => state.selectNode);
  const selectSegment = useCameraPlaybackStore((state) => state.selectSegment);
  const selectHandle = useCameraPlaybackStore((state) => state.selectHandle);
  const clearSelection = useCameraPlaybackStore((state) => state.clearSelection);
  const deleteCameraNode = useDirectorStore((state) => state.deleteCameraNode);
  const updateCameraSegment = useDirectorStore((state) => state.updateCameraSegment);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isEditableKeyboardTarget(event.target)) return;

      const playback = useCameraPlaybackStore.getState();
      const { selectedHandle, selectedNode } = playback;
      if (selectedHandle) {
        // 删除手柄 = 恢复直线三等分默认位置（贝塞尔曲线拉直）
        const { cameraId, segmentId } = selectedHandle;
        const camera = useDirectorStore.getState().project.cameras.find((item) => item.id === cameraId);
        const segment = camera?.segments?.find((item) => item.id === segmentId);
        if (camera && segment) {
          const fromNode = camera.nodes?.find((node) => node.id === segment.fromNodeId);
          const toNode = camera.nodes?.find((node) => node.id === segment.toNodeId);
          if (fromNode && toNode) {
            const handles = getDefaultBezierHandles(fromNode.position, toNode.position);
            updateCameraSegment(cameraId, segmentId, { handleOut: handles.handleOut, handleIn: handles.handleIn });
          }
        }
        event.preventDefault();
        clearSelection();
        return;
      }
      if (selectedNode) {
        event.preventDefault();
        deleteCameraNode(selectedNode.cameraId, selectedNode.nodeId);
        clearSelection();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [clearSelection, deleteCameraNode, updateCameraSegment]);

  if (viewMode !== "director") return null;

  return (
    <>
      {cameras.map((camera) => (
        <CameraPathLayer
          key={camera.id}
          camera={camera}
          active={camera.id === activeCameraId}
          onActivate={() => {
            setActiveCamera(camera.id);
            selectObject(null);
          }}
          onNodeSelect={(nodeId) => {
            setActiveCamera(camera.id);
            selectObject(null);
            selectNode({ cameraId: camera.id, nodeId });
            // 与时间轴点节点一致：播放头跳到该节点，进机位视角后镜头直接切到它的视角
            const nodes = camera.nodes ?? [];
            const index = nodes.findIndex((node) => node.id === nodeId);
            if (index >= 0) {
              const startTimes = getNodeStartTimes(nodes, camera.segments ?? []);
              useCameraPlaybackStore.getState().setPlayheadTime(startTimes[index] ?? 0);
            }
          }}
          onSegmentSelect={(segmentId) => {
            setActiveCamera(camera.id);
            selectObject(null);
            selectSegment({ cameraId: camera.id, segmentId });
          }}
          onHandleSelect={(segmentId, handle) => {
            setActiveCamera(camera.id);
            selectObject(null);
            selectHandle({ cameraId: camera.id, segmentId, handle });
          }}
        />
      ))}
    </>
  );
}

function CameraPathLayer({
  camera,
  active,
  onActivate,
  onNodeSelect,
  onSegmentSelect,
  onHandleSelect,
}: {
  camera: DirectorCameraShot;
  active: boolean;
  onActivate: () => void;
  onNodeSelect: (nodeId: string) => void;
  onSegmentSelect: (segmentId: string) => void;
  onHandleSelect: (segmentId: string, handle: "out" | "in") => void;
}) {
  const nodes = camera.nodes ?? [];
  const segments = useMemo(() => buildCameraSegments(nodes, camera.segments), [camera.segments, nodes]);
  const selectedNode = useCameraPlaybackStore((state) => state.selectedNode);
  const selectedSegment = useCameraPlaybackStore((state) => state.selectedSegment);
  const selectedHandle = useCameraPlaybackStore((state) => state.selectedHandle);
  const pathColor = active ? ACTIVE_PATH_COLOR : INACTIVE_PATH_COLOR;
  const isSelectedNode = (nodeId: string) => selectedNode?.cameraId === camera.id && selectedNode.nodeId === nodeId;
  const isSelectedSegment = (segmentId: string) =>
    selectedSegment?.cameraId === camera.id && selectedSegment.segmentId === segmentId;

  if (nodes.length === 0) return null;

  return (
    <group
      userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
      onPointerMissed={(event) => {
        // 路径区域的空白点击不冒泡成"取消选中场景"；点空白场景由 DirectorCanvas 统一处理
        event.stopPropagation();
      }}
    >
      {segments.map((segment, index) => (
        <SegmentLine
          key={segment.id}
          camera={camera}
          segment={segment}
          fromNode={nodes[index]}
          toNode={nodes[index + 1]}
          color={isSelectedSegment(segment.id) ? ACTIVE_PATH_COLOR : pathColor}
          selected={isSelectedSegment(segment.id)}
          onSelect={() => onSegmentSelect(segment.id)}
          onActivate={onActivate}
        />
      ))}
      {nodes.map((node, index) => (
        <NodeMarker
          key={node.id}
          camera={camera}
          node={node}
          index={index}
          selected={isSelectedNode(node.id)}
          onSelect={() => onNodeSelect(node.id)}
        />
      ))}
      {segments.map((segment, index) => {
        const isSegmentSelected = isSelectedSegment(segment.id);
        if (!isSegmentSelected || segment.curveMode !== "bezier" || !segment.handleOut || !segment.handleIn) {
          return null;
        }

        return (
          <HandlePair
            key={`${segment.id}-handles`}
            camera={camera}
            segment={segment}
            fromNode={nodes[index]}
            toNode={nodes[index + 1]}
            selectedHandle={selectedHandle?.cameraId === camera.id && selectedHandle.segmentId === segment.id ? selectedHandle.handle : null}
            onSelect={onHandleSelect}
          />
        );
      })}
    </group>
  );
}

function SegmentLine({
  camera,
  segment,
  fromNode,
  toNode,
  color,
  selected,
  onSelect,
  onActivate,
}: {
  camera: DirectorCameraShot;
  segment: CameraSegment;
  fromNode: CameraNode;
  toNode: CameraNode;
  color: string;
  selected: boolean;
  onSelect: () => void;
  onActivate: () => void;
}) {
  const points = useMemo(
    () => getSegmentRenderPoints(fromNode, toNode, segment),
    [fromNode, segment, toNode]
  );

  return (
    <Line
      color={color}
      lineWidth={selected ? 2.5 : 1.5}
      name={`${camera.id}-path-${segment.id}`}
      opacity={selected ? 1 : 0.85}
      points={points}
      transparent
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
        onSelect();
      }}
    />
  );
}

function NodeMarker({
  camera,
  node,
  index,
  selected,
  onSelect,
}: {
  camera: DirectorCameraShot;
  node: CameraNode;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const groupRef = useRef<Group>(null!);
  const updateCameraNode = useDirectorStore((state) => state.updateCameraNode);
  const beginUndoBatch = useDirectorStore((state) => state.beginUndoBatch);
  const endUndoBatch = useDirectorStore((state) => state.endUndoBatch);

  useLayoutEffect(() => {
    groupRef.current?.position.set(...node.position);
  }, [node.position]);

  const markerNode = (
    <group
      ref={groupRef}
      position={node.position}
      userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <mesh name={`${camera.id}-node-${node.id}`} position={[0, 0, 0]}>
        <sphereGeometry args={[selected ? NODE_RADIUS * 1.35 : NODE_RADIUS, 20, 20]} />
        <meshBasicMaterial color={selected ? NODE_SELECTED_COLOR : NODE_COLOR} />
      </mesh>
      <Html center distanceFactor={NODE_LABEL_DISTANCE_FACTOR} pointerEvents="none" position={[0, NODE_RADIUS + 0.14, 0]} sprite>
        <div className="role-label path-node-label">{getNodeLabel(index)}</div>
      </Html>
    </group>
  );

  if (!selected) return markerNode;

  return (
    <>
      {markerNode}
      <TransformControls
        mode="translate"
        object={groupRef}
        onMouseDown={beginUndoBatch}
        onMouseUp={endUndoBatch}
        onObjectChange={() => {
          const group = groupRef.current as Object3D;
          if (!group) return;
          updateCameraNode(camera.id, node.id, {
            position: [group.position.x, group.position.y, group.position.z],
          });
        }}
      />
    </>
  );
}

function HandlePair({
  camera,
  segment,
  fromNode,
  toNode,
  selectedHandle,
  onSelect,
}: {
  camera: DirectorCameraShot;
  segment: CameraSegment;
  fromNode: CameraNode;
  toNode: CameraNode;
  selectedHandle: "out" | "in" | null;
  onSelect: (segmentId: string, handle: "out" | "in") => void;
}) {
  return (
    <>
      <HandleMarker
        camera={camera}
        segment={segment}
        handle="out"
        anchor={fromNode.position}
        position={segment.handleOut ?? fromNode.position}
        selected={selectedHandle === "out"}
        onSelect={() => onSelect(segment.id, "out")}
      />
      <HandleMarker
        camera={camera}
        segment={segment}
        handle="in"
        anchor={toNode.position}
        position={segment.handleIn ?? toNode.position}
        selected={selectedHandle === "in"}
        onSelect={() => onSelect(segment.id, "in")}
      />
    </>
  );
}

function HandleMarker({
  camera,
  segment,
  handle,
  anchor,
  position,
  selected,
  onSelect,
}: {
  camera: DirectorCameraShot;
  segment: CameraSegment;
  handle: "out" | "in";
  anchor: [number, number, number];
  position: [number, number, number];
  selected: boolean;
  onSelect: () => void;
}) {
  const groupRef = useRef<Group>(null!);
  const updateCameraSegment = useDirectorStore((state) => state.updateCameraSegment);
  const beginUndoBatch = useDirectorStore((state) => state.beginUndoBatch);
  const endUndoBatch = useDirectorStore((state) => state.endUndoBatch);

  useLayoutEffect(() => {
    groupRef.current?.position.set(...position);
  }, [position]);

  const marker = (
    <group
      ref={groupRef}
      position={position}
      userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <Line
        color={HANDLE_COLOR}
        lineWidth={1}
        opacity={0.8}
        points={[anchor, position]}
        transparent
      />
      <mesh name={`${camera.id}-handle-${segment.id}-${handle}`}>
        <octahedronGeometry args={[selected ? HANDLE_RADIUS * 1.35 : HANDLE_RADIUS, 0]} />
        <meshBasicMaterial color={HANDLE_COLOR} />
      </mesh>
    </group>
  );

  if (!selected) return marker;

  return (
    <>
      {marker}
      <TransformControls
        mode="translate"
        object={groupRef}
        onMouseDown={beginUndoBatch}
        onMouseUp={endUndoBatch}
        onObjectChange={() => {
          const group = groupRef.current as Object3D;
          if (!group) return;
          updateCameraSegment(camera.id, segment.id, {
            [handle === "out" ? "handleOut" : "handleIn"]: [group.position.x, group.position.y, group.position.z] as [
              number,
              number,
              number,
            ],
          });
        }}
      />
    </>
  );
}
