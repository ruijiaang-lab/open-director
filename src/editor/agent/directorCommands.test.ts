import { beforeEach, describe, expect, it } from "vitest";
import { useDirectorStore } from "../store/directorStore";
import { execDirectives, execDirective, buildSceneSummary } from "./directorCommands";

beforeEach(() => {
  useDirectorStore.setState({
    project: {
      version: 1,
      scene: { ...useDirectorStore.getState().project.scene },
      assets: [],
      objects: [],
      cameras: [],
      activeCameraId: null,
      panoramaAssetId: null,
    },
  });
});

describe("AI 导演指令执行器", () => {
  it("加角色并命名", () => {
    const result = execDirectives([
      { action: "add_character", args: { body_type: "female", name: "主角" } },
    ]);
    expect(result).toContain("主角");
    const { project } = useDirectorStore.getState();
    expect(project.objects).toHaveLength(1);
    expect(project.objects[0].name).toBe("主角");
  });

  it("按名字移动对象", () => {
    execDirectives([{ action: "add_character", args: { name: "主角" } }]);
    const result = execDirectives([
      { action: "move_object", args: { name: "主角", position: [2, 0, 3] } },
    ]);
    expect(result).toContain("主角");
    const { project } = useDirectorStore.getState();
    expect(project.objects[0].transform.position).toEqual([2, 0, 3]);
  });

  it("加机位并 look_at", () => {
    execDirectives([{ action: "add_camera", args: { name: "主机位", position: [0, 1.5, 5], target: [0, 1, 0] } }]);
    const result = execDirectives([
      { action: "look_at", args: { name: "主机位", position: [2, 1.8, 4], target: [1, 1, 0] } },
    ]);
    expect(result).toContain("主机位");
    const { project } = useDirectorStore.getState();
    expect(project.cameras[0].transform.position).toEqual([2, 1.8, 4]);
    expect(project.cameras[0].nodes ?? []).toHaveLength(0);
  });

  it("record_shot 给机位记录运镜节点", () => {
    execDirectives([{ action: "add_camera", args: { name: "主机位" } }]);
    execDirectives([
      { action: "record_shot", args: { name: "主机位", position: [0, 1.5, 5], target: [0, 1, 0] } },
      { action: "record_shot", args: { name: "主机位", position: [3, 1.5, 5], target: [1, 1, 0] } },
    ]);
    const { project } = useDirectorStore.getState();
    expect(project.cameras[0].nodes).toHaveLength(2);
  });

  it("找不到对象时报错但不中断后续指令", () => {
    const result = execDirectives([
      { action: "move_object", args: { name: "不存在的人", position: [1, 0, 1] } },
      { action: "add_character", args: { name: "主角" } },
    ]);
    expect(result).toContain("找不到对象");
    expect(useDirectorStore.getState().project.objects).toHaveLength(1);
  });

  it("未知指令报错", () => {
    expect(() => execDirective({ action: "fly_to_moon" })).toThrow("未知指令");
  });

  it("场景摘要有对象名", () => {
    execDirectives([{ action: "add_character", args: { name: "路人甲" } }]);
    expect(buildSceneSummary()).toContain("路人甲");
  });
});
