import { getLookAtQuaternion } from "../camera/cameraPath";
import { useDirectorStore } from "../store/directorStore";
import { useCameraPlaybackStore } from "../store/cameraPlaybackStore";
import { createDefaultDirectorProject } from "../store/directorStore";
import { POSE_PRESET_IDS } from "../schema/poseSchema";
import type { CharacterBodyType } from "../schema/directorProject";
import type { GeometryPrimitiveType } from "../schema/directorProject";
import type { ViewMode } from "../schema/directorProject";

/** AI 输出的单条指令 */
export interface DirectorCommand {
  action: string;
  args?: Record<string, unknown>;
}

export const AVAILABLE_BODY_TYPES: CharacterBodyType[] = [
  "mannequin",
  "female",
  "broad",
  "muscular",
  "slim",
];

export const AVAILABLE_GEOMETRY_TYPES: GeometryPrimitiveType[] = [
  "box",
  "sphere",
  "cylinder",
  "torus",
  "cone",
  "pyramid",
];

/** 给 LLM 的指令说明（system prompt 用） */
export const COMMAND_DOCS = `
可用指令（每次输出一个 JSON 数组，元素为 {"action": "...", "args": {...}}）：
1. add_character：args {"body_type": "female"|"mannequin"|"broad"|"muscular"|"slim", "name": "自定义名"}
2. add_geometry：args {"geometry_type": "box"|"sphere"|"cylinder"|"torus"|"cone"|"pyramid", "name": "自定义名"}
3. add_camera：args {"name": "自定义名", "position": [x,y,z], "target": [x,y,z], "fov": 45}
4. move_object：args {"name": "对象名", "position": [x,y,z]}
5. rotate_object：args {"name": "对象名", "rotation_degrees": [x,y,z]}
6. scale_object：args {"name": "对象名", "scale": 1.5}
7. set_pose：args {"name": "角色名", "pose": "stand"|"walk"|"run"|"sit"|"crouch"|"kneel-one"|"kneel-two"|"hands-on-hips"|"lean"|"bow"|"think"|"fight"|"kick"|"throw"|"push"|"wave"|"reach"|"cross-arms"|"phone"|"t-pose"}
8. set_active_camera：args {"name": "机位名"}
9. switch_view：args {"view": "director"|"camera"}
10. look_at：args {"name": "机位名", "position": [x,y,z], "target": [x,y,z], "fov": 45}（让机位从 position 看向 target）
11. record_shot：args {"name": "机位名", "position": [x,y,z], "target": [x,y,z], "fov": 45}（给机位记录一个运镜节点，形成运镜路径）
12. play / pause / stop：args 为空
13. set_playhead：args {"time": 3.5}
14. delete_object：args {"name": "对象名"}
15. rename_object：args {"name": "对象名", "new_name": "新名字"}
16. set_color：args {"name": "对象名", "color": "#ff0000"}
17. clear_scene：args 为空（清空所有角色和机位）
18. undo：args 为空（撤销上一次操作）
19. explain：args {"message": "解释文字"}（当用户请求超出能力时使用，不做任何操作）

规则：
- 对象名称一律用中文（如「女主角」「机位A」）
- "对象名"必须是场景摘要里列出的准确名称，否则找不到
- 位置坐标 [x,y,z]，y 为垂直方向，默认地面 y=0；角色身高约 1.8，机位高度建议 1.5~1.8
- 一次可以输出多条指令按顺序执行
- 录制运镜（record_shot）时，至少输出 2 条 record_shot 且 position 必须不同（起点和终点），形成运镜路径；机位高度保持 1.5~1.8
- 如果用户的请求超出能力范围（如生成完整电影、复杂动画、需要外部资源），必须只输出单条 explain 指令说明原因，禁止用其他指令硬凑
`.trim();

/** 场景摘要：给 LLM 看当前有哪些对象 */
export function buildSceneSummary(): string {
  const { project } = useDirectorStore.getState();
  const lines: string[] = ["当前场景："];
  for (const obj of project.objects) {
    const pos = obj.transform.position.map((v) => Math.round(v * 100) / 100);
    lines.push(`- ${obj.name}（${obj.kind}${obj.bodyType ? ` ${obj.bodyType}` : ""}）位置 ${JSON.stringify(pos)}`);
  }
  for (const cam of project.cameras) {
    const pos = cam.transform.position.map((v) => Math.round(v * 100) / 100);
    const tgt = cam.target.map((v) => Math.round(v * 100) / 100);
    lines.push(`- ${cam.name}（机位）位置 ${JSON.stringify(pos)} 看向 ${JSON.stringify(tgt)}`);
  }
  if (project.objects.length === 0 && project.cameras.length === 0) {
    lines.push("（空场景）");
  }
  return lines.join("\n");
}

function findObjectByName(name: string) {
  const { project } = useDirectorStore.getState();
  return (
    project.objects.find((o) => o.name === name) ||
    project.objects.find((o) => o.name.includes(name))
  );
}

function findCameraByName(name: string) {
  const { project } = useDirectorStore.getState();
  return (
    project.cameras.find((c) => c.name === name) ||
    project.cameras.find((c) => c.name.includes(name))
  );
}

function asVec3(value: unknown): [number, number, number] {
  if (Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === "number")) {
    return [value[0], value[1], value[2]];
  }
  throw new Error("参数 position/target 必须是 [x,y,z] 数字数组");
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function lastAddedObjectId(before: string[]): string {
  const { project } = useDirectorStore.getState();
  const after = new Set(project.objects.map((o) => o.id));
  return project.objects.find((o) => !before.includes(o.id))?.id ?? "";
}

/** 执行单条指令，返回给用户看的结果文字 */
export function execDirective(cmd: DirectorCommand): string {
  const store = useDirectorStore.getState();
  const action = cmd.action;

  switch (action) {
    case "add_character": {
      const bodyType = asString(cmd.args?.body_type, "female") as CharacterBodyType;
      if (!AVAILABLE_BODY_TYPES.includes(bodyType)) {
        throw new Error(`未知身体类型: ${bodyType}`);
      }
      const before = useDirectorStore.getState().project.objects.map((o) => o.id);
      store.addPresetCharacter(bodyType);
      const id = lastAddedObjectId(before);
      const name = asString(cmd.args?.name);
      if (name && id) {
        useDirectorStore.getState().updateObjectName(id, name);
        return `已添加角色「${name}」`;
      }
      return "已添加角色";
    }
    case "add_geometry": {
      const geometryType = asString(cmd.args?.geometry_type) as GeometryPrimitiveType;
      if (!AVAILABLE_GEOMETRY_TYPES.includes(geometryType)) {
        throw new Error(`未知几何体类型: ${geometryType}`);
      }
      const before = useDirectorStore.getState().project.objects.map((o) => o.id);
      store.addGeometryPrimitive(geometryType);
      const id = lastAddedObjectId(before);
      const name = asString(cmd.args?.name);
      if (name && id) {
        useDirectorStore.getState().updateObjectName(id, name);
        return `已添加几何体「${name}」`;
      }
      return "已添加几何体";
    }
    case "add_camera": {
      const position = asVec3(cmd.args?.position ?? [3, 1.8, 5]);
      const target = asVec3(cmd.args?.target ?? [0, 1, 0]);
      const fov = asNumber(cmd.args?.fov, 45);
      const id = store.addCameraShot({ position, target, fov });
      const name = asString(cmd.args?.name);
      if (name) {
        useDirectorStore.getState().updateCamera(id, { name });
        return `已添加机位「${name}」`;
      }
      return "已添加机位";
    }
    case "move_object": {
      const name = asString(cmd.args?.name);
      const obj = findObjectByName(name);
      if (!obj) throw new Error(`找不到对象「${name}」`);
      const position = asVec3(cmd.args?.position);
      store.updateObjectTransform(obj.id, { position });
      return `已把「${obj.name}」移动到 ${JSON.stringify(position)}`;
    }
    case "rotate_object": {
      const name = asString(cmd.args?.name);
      const obj = findObjectByName(name);
      if (!obj) throw new Error(`找不到对象「${name}」`);
      const deg = asVec3(cmd.args?.rotation_degrees ?? [0, 0, 0]);
      const rotation: [number, number, number] = [
        (deg[0] * Math.PI) / 180,
        (deg[1] * Math.PI) / 180,
        (deg[2] * Math.PI) / 180,
      ];
      store.updateObjectTransform(obj.id, { rotation });
      return `已旋转「${obj.name}」`;
    }
    case "scale_object": {
      const name = asString(cmd.args?.name);
      const obj = findObjectByName(name);
      if (!obj) throw new Error(`找不到对象「${name}」`);
      const scale = asNumber(cmd.args?.scale, 1);
      store.updateUniformScale(obj.id, scale);
      return `已缩放「${obj.name}」到 ${scale} 倍`;
    }
    case "set_pose": {
      const name = asString(cmd.args?.name);
      const obj = findObjectByName(name);
      if (!obj) throw new Error(`找不到角色「${name}」`);
      const pose = asString(cmd.args?.pose);
      if (!POSE_PRESET_IDS.includes(pose as never)) {
        throw new Error(`未知姿势: ${pose}`);
      }
      store.applyPosePreset(obj.id, pose as never);
      return `「${obj.name}」已摆出姿势 ${pose}`;
    }
    case "set_active_camera": {
      const name = asString(cmd.args?.name);
      const cam = findCameraByName(name);
      if (!cam) throw new Error(`找不到机位「${name}」`);
      store.setActiveCamera(cam.id);
      return `已切换到机位「${cam.name}」`;
    }
    case "switch_view": {
      const view = asString(cmd.args?.view) as ViewMode;
      if (view !== "director" && view !== "camera") throw new Error(`未知视角: ${view}`);
      store.setViewMode(view);
      return `已切换为${view === "camera" ? "机位视角" : "导演视角"}`;
    }
    case "look_at":
    case "record_shot": {
      const name = asString(cmd.args?.name);
      const cam = findCameraByName(name);
      if (!cam) throw new Error(`找不到机位「${name}」`);
      const position = asVec3(cmd.args?.position ?? cam.transform.position);
      const target = asVec3(cmd.args?.target ?? cam.target);
      const fov = asNumber(cmd.args?.fov, cam.fov);
      const quaternion = getLookAtQuaternion(position, target);
      const rotation: [number, number, number, number] = [
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w,
      ];
      if (action === "look_at") {
        store.updateCamera(cam.id, { transform: { ...cam.transform, position }, target, fov });
        return `机位「${cam.name}」已对准目标`;
      }
      store.recordCameraNode(cam.id, { position, rotation, fov });
      return `机位「${cam.name}」已记录运镜节点`;
    }
    case "play":
      useCameraPlaybackStore.getState().play();
      return "▶ 开始播放运镜";
    case "pause":
      useCameraPlaybackStore.getState().pause();
      return "⏸ 已暂停";
    case "stop":
      useCameraPlaybackStore.getState().stop();
      return "⏹ 已停止";
    case "set_playhead": {
      useCameraPlaybackStore.getState().setPlayheadTime(asNumber(cmd.args?.time, 0));
      return `播放头移到 ${cmd.args?.time} 秒`;
    }
    case "delete_object": {
      const name = asString(cmd.args?.name);
      const obj = findObjectByName(name);
      if (!obj) throw new Error(`找不到对象「${name}」`);
      store.selectObject(obj.id);
      store.deleteSelectedObject();
      return `已删除「${obj.name}」`;
    }
    case "rename_object": {
      const name = asString(cmd.args?.name);
      const obj = findObjectByName(name);
      if (!obj) throw new Error(`找不到对象「${name}」`);
      const newName = asString(cmd.args?.new_name);
      if (!newName) throw new Error("缺少 new_name 参数");
      store.updateObjectName(obj.id, newName);
      return `已把「${obj.name}」改名为「${newName}」`;
    }
    case "set_color": {
      const name = asString(cmd.args?.name);
      const obj = findObjectByName(name);
      if (!obj) throw new Error(`找不到对象「${name}」`);
      const color = asString(cmd.args?.color, "#ffffff");
      store.updateObjectColor(obj.id, color);
      return `「${obj.name}」颜色已改为 ${color}`;
    }
    case "clear_scene": {
      store.replaceProject(createDefaultDirectorProject());
      return "场景已清空";
    }
    case "undo":
      store.undo();
      return "已撤销上一步";
    case "explain":
      return asString(cmd.args?.message, "（无说明）");
    default:
      throw new Error(`未知指令: ${action}`);
  }
}

/** 批量执行指令，整批算一次撤销；单条失败不中断后续；返回结果汇总 */
export function execDirectives(commands: DirectorCommand[]): string {
  const store = useDirectorStore.getState();
  const results: string[] = [];
  let hasExecuted = false;
  store.beginUndoBatch();
  try {
    for (const cmd of commands) {
      try {
        results.push(execDirective(cmd));
        hasExecuted = true;
      } catch (err) {
        results.push(`⚠️ ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    if (hasExecuted) store.endUndoBatch();
  }
  return results.join("\n");
}
