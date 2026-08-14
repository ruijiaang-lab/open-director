# ASSET_INVENTORY — Open Director V0 上游盘点

> 上游：`jiguang132/storyai-3d-director-desk`（MIT，2026-07-06 创建，647 stars，3 commits，无 CI）
> 审计基线：commit `89bfc6a chore: initial open source release`（clone 后未做任何修改）
> 日期：2026-08-12

## 0. 上游可运行性验证（Phase 0 硬指标）

| 命令 | 结果 | 备注 |
|---|---|---|
| `npm install` | ✅ | 依赖安装干净 |
| `npm run dev` | ✅ | 本机 5173 被其他进程占用，自动顺延 5174 |
| `npm run build` | ✅ | 3.7s；两个已知警告：主包 1.37MB（>500kB 阈值）、模型库缩略图 URL 运行时解析 |
| `npm test` | ⚠️ **304/312 通过，8 失败** | 上游 README 已自认（"当前 304/312 用例通过，剩余 8 个失败用例"），属上游自带，非本机环境引入 |

8 个失败用例分布（上游自带，不影响 V0 主路径，但需注意）：

| 文件 | 失败数 | 原因 |
|---|---|---|
| `ViewportToolbar.test.tsx` | 3 | 模型库面板按钮 / 缩略图目录断言（模型库 UI） |
| `ScenePanel.test.tsx` | 1 | XYZ 轴输入框渲染断言（变换面板细节） |
| `DirectorCanvas.test.tsx` | 1 | 非自动画幅时比例框渲染数量断言 |
| `DirectorCanvas.grid.test.ts` | 1 | 轴向命中区像素位置断言（57.5px vs 92px，纯函数输出与测试期望不同步） |
| `mannequinPosePresets.test.ts` | 1 | 手机持机姿势预设断言 |
| `cameraGeometry.test.ts` | 1 | 取景框视觉比例缩放断言 |

**风险**：上游无 CI、自认失败测试且未修。接手后建议在 Phase 1 前把 V0 主路径涉及的相关测试（cameraGeometry 等）修绿，其余（模型库/姿势预设）可延后或删除。

## 1. 组件盘点（KEEP / ADAPT / DELETE）

### 1.1 KEEP — 直接保留

| Component | Source | License | Current Capability | Reuse Decision | Required Changes | Risk |
|---|---|---|---|---|---|---|
| `App.tsx` + `DirectorDeskShell.tsx` | 上游 (32 行) | MIT | 顶栏 + 左栏 + 视口 + 右栏 + 底部 的壳布局 | KEEP | 底部加 Timeline 区域 | 低 |
| `directorStore.ts`（Zustand） | 上游 (2057 行) | MIT | 全量状态管理：场景对象/机位/视图模式/选中/撤销/剪贴板/localStorage 持久化 | KEEP | 新增 `cameraPathStore` / `timelineStore` 并列，不混入 | 中（大文件，增量改） |
| `SceneRoot.tsx` + `DirectorCanvas.tsx` | 上游 (756 行) | MIT | 3D 视口、场景物体渲染、Grid、OrbitControls、GizmoHelper/GizmoViewport 轴向、透视相机 | KEEP | 视角系统按规范 7 改造（见 ADAPT） | 中 |
| `TransformControls`（SceneRoot 内） | 上游 | MIT | XYZ 拖拽变换 gizmo | KEEP | 增加"吸附到路径节点"场景无改 | 低 |
| `ObjectTreePanel.tsx` | 上游 | MIT | 场景大纲：搜索/分组/可见性/锁定/删除 | KEEP | 无 | 低 |
| `RightPanel.tsx` + `InspectorControls.tsx` + 各属性面板 | 上游 | MIT | 按选中对象切换 scene/character/prop/camera 面板 | KEEP | camera 面板需扩展节点/段属性 | 低 |
| `directorProject.ts` schema | 上游 | MIT | DirectorObject/相机/场景数据结构 | ADAPT | 见下 | 中 |
| `screenshotExport.ts` | 上游 (39 行) | MIT | 视口截图 | KEEP | 无（规范 22.2 PNG 直接满足） | 低 |
| `exportProjectJson.ts` / `importProjectJson.ts` | 上游 | MIT | 工程 JSON 导入导出 | ADAPT | schema 扩展后同步 | 中 |
| `gltfImport.ts` / `localModelImport.ts` | 上游 | MIT | FBX/OBJ 本地导入、自定义模型库 | KEEP | 规范 21：只加载不编辑，已满足 | 低 |
| `panoramaImport.ts` / 全景背景 | 上游 | MIT | 全景图背景 | KEEP（V0 范围外不扩展） | 无 | 低 |
| 6 种几何体 primitive + 8 种角色/群演 | 上游 | MIT | 规范 4 世界模型完全覆盖（Capsule 人=角色、Cube/Box=场景物、Cylinder+Sphere=树） | KEEP | 无 | 低 |
| Undo / Clipboard | 上游 | MIT | Ctrl/Cmd+Z、C/V | KEEP | 路径编辑操作需注册 undo | 中 |
| `hostBridge.ts` / `captureBridge.ts` | 上游 | MIT | 宿主页面通信 | KEEP（不扩展） | 无 | 低 |

### 1.2 ADAPT — 改造复用

| Component | Source | License | Current Capability | Reuse Decision | Required Changes | Risk |
|---|---|---|---|---|---|---|
| 视角系统（`viewMode: "director" \| "camera"`） | 上游 | MIT | 已支持导演/机位双视角 + 顶部切换 | ADAPT | 规范 7：① God View 增加 WASD+Q/E+Shift 自由飞行；② Camera View 改 FPS 掌镜（PointerLockControls）；③ Space 快速切换；④ Camera View 用 Layers 隔离 helper（规范 8） | 中 |
| `CameraPanel.tsx` | 上游 (607 行) | MIT | 机位 FOV/transform/目标/截图/多机位管理 | ADAPT | 规范 8：每机位加独立 Path/Timeline 入口；规范 10-12：Segment 属性（duration/easing/hold/curveMode/handle）编辑 UI | 中 |
| `DirectorCameraShot` schema | 上游 | MIT | 静态机位（transform+fov+target） | ADAPT | 增加 `nodes: CameraNode[]` + `segments: CameraSegment[]`（规范 9/10 类型） | 中 |
| `directorStore` 的 camera 部分 | 上游 | MIT | 机位增删/切换/更新 | ADAPT | 增加节点/段 CRUD action（规范 14） | 中 |
| 工程 JSON schema + 持久化 | 上游 | MIT | version 1 全量保存/恢复 | ADAPT | version 升 2：+nodes/+segments/+timeline；规范 22.1 `project.opendirector.json`；验收项 11（导出-导入完整恢复） | 中 |

### 1.3 DELETE — 删除/降级

| Component | Source | License | Current Capability | Reuse Decision | Required Changes | Risk |
|---|---|---|---|---|---|---|
| 模型库缩略图 URL 运行时解析 | 上游 | MIT | 模型库面板 3 个失败测试即出于此 | DELETE（V0 范围内非核心） | 失败测试随模型库面板一起延后处理 | 低 |
| 角色姿势预设系统（mannequinPosePresets / 20 种姿势） | 上游 | MIT | 20 种姿势 + 骨骼映射 | 降级：保留不扩展 | 规范 4：人只是空间参照物，姿势系统 V0 不深化；其失败测试延后 | 低 |
| 全景投影数学 `panoramaMath.ts` / `panoramaImport.projection.test` | 上游 | MIT | 全景背景 | 保留不扩展 | 无 | 低 |

> DELETE 说明：V0 原则"任何开发任务如果不直接服务 Camera Path / Camera Timing / Real-time Preview 默认推迟"（规范 23）。上述均为"保留但不修不扩"，不做物理删除以免破坏现有场景文件兼容。

### 1.4 NEW — 需新增（规范 25.1 明确"需要我们新增"）

| Component | 规范出处 | 实现建议 | 依赖复用 |
|---|---|---|---|
| Camera FPS 掌镜控制 `CameraFPSControls.ts` | 规范 7.2 / Phase 1 | PointerLockControls + WASD/Q/E/Shift | three.js PointerLockControls |
| God View 自由飞行 `GodViewControls.ts` | 规范 7.1 / Phase 1 | 同 FPS 方案，无 pointer lock 亦可 | 上游 OrbitControls 保留为备选 |
| Space 快速切换 | 规范 7.3 / Phase 1 | 全局 keydown | — |
| K 记录 Camera Node | 规范 9 / Phase 1 | 记录 position/rotation(Euler→Quaternion)/fov/time | 上游相机快照逻辑 |
| Camera Rail + 直线路径渲染 | 规范 11-12 / Phase 2 | Line + 节点球体，默认 linear | three.js Line |
| 路径节点编辑 `CameraNode.tsx` / `CameraPathRenderer.tsx` | 规范 14 / Phase 3 | TransformControls 拖节点、多选、增删插复制 | 上游 TransformControls |
| Bezier Segment `BezierHandles.tsx` / `CameraSegment.ts` | 规范 12 / Phase 4 | CubicBezierCurve3 + H1/H2 手柄 | three.js CubicBezierCurve3（参考官方 spline editor example） |
| Timeline `DirectorTimeline.tsx` | 规范 15-16 / Phase 5 | 适配 react-timeline-editor；Timeline 只管 WHEN | xzdarcy/react-timeline-editor（MIT） |
| Playback Engine `CameraPathEvaluator.ts` / `PlaybackController.ts` | 规范 19 / Phase 5 | 时间→段→localT→easing→曲线求值→Quaternion.slerp 旋转 | three.js Quaternion.slerp |
| Hold + Easing | 规范 17-18 / Phase 6 | 4 种 easing 函数 + holdAfter | 自写（数十行） |
| 多 Camera + Layers 隔离 | 规范 8 / Phase 7 | three.js Layers：Layer 0 渲染场景 / Layer 1 editor helpers；Shot 相机只渲 Layer 0 | three.js Layers |
| MP4 导出 | 规范 22.3 / Phase 9 | WebAV（浏览器端 WebCodecs 编码），V0 前半段可后置 | WebAV |

## 2. 复用结论汇总

- **技术栈完全命中规范 24 推荐**：React 18 + Vite + TS + Three.js + R3F + drei + Zustand ✅（上游已含 camera-controls 依赖）
- **编辑器外壳零成本获得**：Outliner / Inspector / Gizmo / 多机位 / 截图 / JSON 导入导出 / 撤销 / 持久化，均为规范 25.1 期待的复用点
- **核心增量 = 4 块**：Camera Rail + Segment Curve + Timeline + Playback Engine（含 FPS 掌镜与 K 键记录）
- **世界模型直接用上游 primitive**：规范 4 的 Capsule/Cube/Box/Cylinder 全在
- **上游失败测试 8 个**：不影响 V0 主路径，但接手后应将 V0 主路径涉及的修绿

## 3. 环境备忘（本机）

- 全局代理 `socks5://127.0.0.1:7897`：curl 本机服务需 `--noproxy '*'`，否则误报 502
- 本机 5173 被其他 node 进程占用（PID 25802），dev 自动顺延端口，README 已说明
- 上游无 CI；建议本项目从 Phase 1 起配 GitHub Actions（test+build），防回归

## 4. Phase 0 结论

上游 `storyai-3d-director-desk` 作为 V0 基底**完全合格**：MIT、活跃、技术栈一致、编辑器外壳完整、缺口（运镜核心）恰好是规范定义的新增范围。

**下一步**：Phase 1 — Camera FPS Mode（Camera View + WASD + Mouse Look + Q/E + Shift + Space 切换 + K 记录）。
