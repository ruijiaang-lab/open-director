# 🎬 Open Director

> 浏览器里的 3D 分镜导演台 — 搭场景、摆机位、录运镜、导出视频，全程不装软件。

## 🚀 在线试玩

**不用下载，点开就能用：** [open-director.pages.dev](https://open-director.pages.dev)

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![React](https://img.shields.io/badge/React-18-blue)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-6-purple)](https://vitejs.dev)
[![Three.js](https://img.shields.io/badge/Three.js-black)](https://threejs.org)

Open Director 是一个运行在浏览器里的 3D 分镜导演台：给角色摆姿势、架机位、画运镜路径，把镜头录成视频。适合做视频预演（Previs）、分镜规划、拍摄前走位练习——**不需要装任何 3D 软件，打开网页就能用**。

## ✨ 功能一览

| 能力 | 说明 |
| --- | --- |
| 🤖 **AI 导演助手** | 右下角对话面板，用大白话指挥场景：加角色、摆位置、架机位、录运镜，AI 自动执行 |
| 🎭 角色与姿势 | 内置 8 种人物、20 种姿势，可导入自己的 FBX / OBJ 模型 |
| 🎥 多机位 | 任意架机位，机位视角"掌镜"边走边拍 |
| 🛤️ 运镜路径 | 按 `K` 记录镜头节点，拖拽节点 / 手柄编辑空间路径 |
| 🎛️ 时间轴 | 播放 / 暂停 / 拖动预览，调时长、缓动（匀速 / 缓入 / 缓出）、段末停顿 |
| 📐 贝塞尔曲线 | 直线转曲线、3D 手柄塑形，运镜更顺滑 |
| 📷 视频导出 | 浏览器原生录制，Chrome 出 webm，Safari 出 mp4 |
| 🌄 全景背景 | 导入全景图当环境，摆角色更真实 |
| 💾 本地保存 | 场景自动存浏览器，可导出 / 导入工程 JSON |

## 🚀 快速开始

### 方式一：本地运行（推荐）

需要 [Node.js](https://nodejs.org)（18 以上）。

```bash
# 1. 下载代码
git clone https://github.com/ruijiaang-lab/open-director.git
cd open-director

# 2. 安装依赖（只需一次）
npm install

# 3. 启动
npm run dev
```

浏览器打开 `http://127.0.0.1:5173/` 即可开始使用。

## 📖 使用教程

### 零步（可选）：用 AI 导戏

点击右下角 🤖 按钮，打开 **AI 导演助手**，用大白话下指令：

> 「加一个女性角色放在右边，再架一台机位对准她」

> 「让主角走到反派旁边，摆出打架姿势，让机位从左往右录一段运镜」

AI 会自动完成：加角色、摆位置、切机位、录制运镜路径。首次使用点面板右上角 ⚙️ 填入你自己的 API 地址和 Key（支持任何 Anthropic 协议兼容服务，Key 只存在自己浏览器）。

### 第一步：搭一个场景

1. 点击视口上方工具栏的 **添加** 按钮，加入角色、群演、几何体或机位
2. 选中对象后，用左侧工具栏的 **移动 / 旋转 / 缩放** 调整位置
3. 右侧属性面板可以改姿势、颜色、大小等参数
4. 想加背景？把全景图拖进来就行

### 第二步：架机位

1. 添加一个**机位**，放到想拍的位置
2. 顶部切换到 **机位视角**（或按 `Space`），看这个机位实际拍到什么
3. 点击画面进入 **掌镜模式**，用 `WASD / Q / E` 走动，`Shift` 加速，`Esc` 释放鼠标

### 第三步：录一条运镜路径

1. 在机位视角掌镜时按 **`K`** 保存当前视角——这就是运镜路径的一个节点
2. 多走几个位置，多按几次 `K`，一条路径就出来了
3. 回 **导演视角**，能看到路径上的节点，拖拽节点或手柄调整轨迹
4. 在底部时间轴上选中某一段，可以改**时长、缓动**，或把直线段**转为贝塞尔曲线**拖得更顺滑

### 第四步：播放 & 导出视频

1. 点时间轴的 **播放** 预览运镜效果
2. 确认满意后，点击 **导出参考视频**，浏览器会录制整条运镜
3. 录制完自动下载：Chrome 得到 webm，Safari 得到 mp4，直接可用

## ⌨️ 快捷键

| 按键 | 功能 |
| --- | --- |
| `Space` | 导演视角 ↔ 机位视角 |
| `K` | 机位视角下保存当前镜头（路径节点） |
| `WASD` / `Q` / `E` | 掌镜移动（`Shift` 加速） |
| `Esc` | 释放鼠标指针 |
| `Ctrl/Cmd + C / V` | 复制 / 粘贴选中对象 |
| `Ctrl/Cmd + Z` | 撤销 |
| `Delete / Backspace` | 删除选中对象 |

## 🖼️ 界面截图

![界面截图](./images/01.png)
![界面截图](./images/02.png)
![界面截图](./images/03.png)
![界面截图](./images/04.png)
![界面截图](./images/05.png)
![界面截图](./images/06.png)
![界面截图](./images/07.jpeg)

## 🧱 技术栈

- React 18 · Vite 6 · TypeScript
- Three.js · @react-three/fiber · @react-three/drei
- Zustand（状态管理）· Vitest（测试）

## 📂 项目结构

```text
src
├─ app/layout          # 顶层壳布局，组织画布与左右侧栏
├─ editor/canvas       # Three.js 视口、画幅框、工具条、截图视图
├─ editor/panels       # 左侧对象树与右侧属性面板
├─ editor/store        # Zustand 状态管理、撤销与剪贴板逻辑
├─ editor/io           # 截图导出、工程导入导出、宿主通信
├─ editor/loaders      # 本地模型与全景图导入
├─ editor/runtime      # 角色渲染、骨骼和姿势应用
├─ editor/schema       # 数据结构、机位和视口相关定义
└─ styles              # 全局样式
```

## 🛠️ 开发相关

```bash
npm run build     # 构建生产包
npm run preview   # 预览生产包（默认 http://127.0.0.1:4173/）
npm test          # 运行测试
```

> 已知情况：构建时有少量 Vite 警告（模型库缩略图运行时解析、主包体积阈值），不影响使用；测试当前 304 / 312 用例通过，剩余 8 个失败集中在模型库面板、视口画幅命中区和个别姿势预设。

## 💡 常见问题

**问：视频导出后文件很大 / 很卡？** 运镜录制时长越短、分辨率越低越流畅，建议先录短片段试效果。

**问：换电脑了，场景还在吗？** 场景保存在浏览器 `localStorage` 里，不同浏览器 / 电脑不互通。换设备前用"导出工程"存成 JSON，到新环境"导入工程"即可。

**问：角色不够用？** 支持导入本地 FBX / OBJ 模型，导入后会自动进模型库。

## 🤝 一起共建

这个项目还在早期，一定有不少 bug，**欢迎所有人参与**——不一定非要会写代码：

| 你想做的事 | 怎么做 |
| --- | --- |
| 🐛 发现 bug | 提 [Issue](https://github.com/ruijiaang-lab/open-director/issues/new/choose)，选「Bug 报告」模板，照表格填就行（最好带上截图） |
| 💡 有功能想法 | 提 [Issue](https://github.com/ruijiaang-lab/open-director/issues/new/choose)，选「功能建议」模板 |
| 🧑‍💻 想改代码 | 看 [CONTRIBUTING.md](./CONTRIBUTING.md)，从 clone 到提 PR 全流程都有 |
| 🎬 用它做了作品 | 在 Issue 里分享（选「功能建议」模板写使用反馈），你的用法就是最好的需求调研 |

如果基于本项目继续发布，请确认新增模型、贴图和素材的分发许可。

## 📄 License

[MIT](./LICENSE)
