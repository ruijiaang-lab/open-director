# 参与贡献

欢迎任何形式的参与——报 bug、提建议、改代码、分享作品，都算贡献。

## 我发现了 bug / 有功能建议

直接提 [Issue](https://github.com/ruijiaang-lab/open-director/issues/new/choose)，选对应的模板填写即可。

- 报 bug 时尽量写清楚：用的什么浏览器、怎么操作触发的、期望是什么样
- 有截图或录屏最好，直接拖进 issue 里

## 我会改代码，想提交修改

### 1. 跑起来

```bash
git clone https://github.com/ruijiaang-lab/open-director.git
cd open-director
npm install
npm run dev
```

### 2. 改代码

- 建议先建分支再改：`git checkout -b fix/xxx`
- 改动尽量小、范围单一，一次只解决一个问题
- 提交信息用中文或英文都行，把改动说清楚即可

### 3. 提交 PR

1. 把分支推到你的 fork：`git push origin fix/xxx`
2. 到 GitHub 页面发起 Pull Request，目标分支选 `main`
3. PR 描述里写清楚：**改了什么**、**为什么改**、**怎么验证的**
4. 如果 PR 能附带测试或截图说明效果，合并速度会快很多

### 4. 合并后

我会 review 并合并。如果需求不明确或有冲突，我会在 PR 里留言沟通。

## 开发约定

- 技术栈：React 18 + Vite 6 + TypeScript + Three.js（React Three Fiber）+ Zustand
- 代码结构见 README 的「项目结构」一节
- 提交前跑一下 `npm run build`，确认能构建通过
- 有疑问可以先提 issue 讨论，避免改完方向不对白忙一场

## 一句心里话

这个项目还在早期阶段，一定有不少 bug，感谢每一个愿意帮忙的人。没有想改的代码也没关系，去 [Issues](https://github.com/ruijiaang-lab/open-director/issues) 看看有没有能复现的 bug，帮我们确认一下也是很大的贡献。
