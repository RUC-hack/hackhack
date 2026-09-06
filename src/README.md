# 见众｜我们这样的人

依据《我们这样的人_相似人生路演方案》重构的响应式数字策展网站。内容聚焦年轻人的选择焦虑、自我认识、相似人生轨迹、人生预演与长期人生地图。

## 运行

推荐在项目根目录使用 Node.js 启动前后端：

```powershell
npm start
```

启动后访问 `http://localhost:8080`，问答起始页为 `http://localhost:8080/qa.html`，后端健康检查为 `http://localhost:3000/api/health`。也可以分别运行 `npm run start:backend` 和 `npm run start:frontend`。

问答流程拆成三个页面：`qa.html` 负责写下问题，`qa-session.html` 负责多轮对话，`qa-results.html` 负责展示路径、完整 AI 回答与知乎公开来源。所有问题统一进入实时后端链路，页面之间通过同一标签页的 `sessionStorage` 和 URL 中的 `session_id` 交接，因此刷新结果页仍可回到当前会话。旧的 `mode=curated` 参数不会再启用本地演示流程。

如果只看静态策展页，直接双击 `index.html` 也可以演示；为避免浏览器对本地资源的限制，也可以在本目录运行：

```powershell
python -m http.server 8080
```

然后访问 `http://localhost:8080`。

## 文件

- `index.html`：语义化页面结构与 SEO 信息
- `styles.css`：视觉系统、响应式布局、动效与无障碍适配
- `app.js`：数据渲染、导航、移动菜单、视口动画、本地图片优先和网络回退
- `qa.html` / `qa-session.html` / `qa-results.html`：问答起始页、独立多轮对话页与独立结果页
- `qa.js` / `qa.css`：问答状态交接、后端 API 调用、路径/回答渲染与页面过渡
- `journey.css`：正式使用的路径、人物与来源组件样式
- `demo/curated-data.js`：历史精选演示数据归档，不参与生产页面运行
- `assets/images/`：本地策展图片；文件缺失或加载失败时自动回退到远程图片
- `prototypes/frontend-a/`：前端 A 的完整可运行归档，不连接当前生产后端

## Unsplash 图片

项目默认优先加载 `assets/images/` 中的本地策展图片；本地文件不存在或加载失败时，会自动回退到对应的 Unsplash CDN 图片。若后续为没有本地图片的素材启用运行时自动检索，可以在 `index.html` 底部填写公开的 **Unsplash Access Key**：

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
