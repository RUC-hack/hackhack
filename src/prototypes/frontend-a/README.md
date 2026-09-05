# 前端 A 归档｜见众视觉与交互原型

> 状态：完整、可运行的历史原型，不连接当前生产后端。正式产品入口是 `/qa.html`；此目录仅用于保留和回看前端 A 的设计成果。

通过项目静态服务器访问 `/prototypes/frontend-a/index.html`，即可继续演示 A 原有的多页流程、固定路径数据、人物收藏、人物提问草稿和 ASK THE CROWD 复制草稿。页面中的匹配结果是演示数据，不是本次 DeepSeek 或知乎接口的实时输出。

依据《我们这样的人_相似人生路演方案》重构的响应式数字策展网站。内容聚焦年轻人的选择焦虑、自我认识、相似人生轨迹、人生预演与长期人生地图。

## 运行

直接双击 `index.html` 即可演示。为避免浏览器对本地资源的限制，也可以在本目录运行：

```powershell
python -m http.server 8080
```

然后访问 `http://localhost:8080`。

## 文件

- `index.html`：语义化页面结构与 SEO 信息
- `question.html`：极简人生问题输入页
- `matching.html`：问题拆解与 OpenPeeps 人群匹配动画
- `paths.html`：五条路径、人物池、人生样本与公开提问体验
- `styles.css`：视觉系统、响应式布局、动效与无障碍适配
- `app.js`：数据渲染、导航、移动菜单、视口动画、图片检索和缓存
- `journey.css`：深度体验流程的独立样式层，复用首页变量和组件
- `journey-data.js`：career、migration、generic 三类演示路径与人物数据
- `journey.js`：问题分析、页面过渡、路径/人物交互、收藏和提问逻辑

结果页当前为每条 career 路径提供 5 个人物样本、每条 migration 路径提供 4 个人物样本；人物与经历均为已标注的交互演示数据。结果首屏使用“多种道路与选择”的山湖意象，ASK THE CROWD 使用“人群并肩”的 Unsplash 影像，并在页面内保留摄影署名。

## 深度体验流程

从首页 Hero 点击“进入策展叙事”，流程为：

`index.html → question.html → matching.html → paths.html`

问题仅保存在当前标签页的 `sessionStorage`，不会拼入 URL。结果页中的收藏人物保存在 `localStorage`。匹配与人物资料均为前端概念演示数据，页面内已提供真实性说明。

当前前端匹配引擎支持：

- 毕业、读博、大厂、工作、科研与回家乡等职业选择问题
- 新西兰、移民、留学、WHV、工签与海外生活问题
- 其他问题的通用人生参照路径

未来接入真实服务时，可替换 `journey.js` 中的 `analyzeQuestion()`，并将 `journey-data.js` 替换为经过授权、带来源关系的数据接口，页面渲染结构无需重写。

## Unsplash 图片

项目开箱即用：未配置 API Key 时会加载已策展的 Unsplash CDN 回退图片。若希望启用运行时自动检索，请在 `index.html` 底部填写公开的 **Unsplash Access Key**：

```js
window.APP_CONFIG = { unsplashAccessKey: "YOUR_ACCESS_KEY" };
```

不要填写 Secret Key。生产环境建议把搜索与 download tracking 放到自己的服务端代理中。首次检索结果会写入 `localStorage`，保证刷新后的图片稳定；控制台调用 `refreshImages()` 可重新匹配。图片失败时会保留低饱和渐变背景，页面不会塌陷。

## 调整

- 主题色：修改 `styles.css` 顶部的 CSS 变量。
- 内容数据：修改 `app.js` 中的 `frameworks`、`trajectories`、`rehearsalPaths`、`timelineItems`。
- 图片意图：修改 `app.js` 中的 `imageRequirements` 查询词、方向或回退图。

## 内容说明

网站未把方案中的示意比例、虚构相似度或未经核验的人物年龄包装成真实数据；轨迹段落明确标注为产品展示结构。正式上线前，人生样本库仍需完成来源、授权、隐私与研究伦理审查。
