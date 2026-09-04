# __PROJECT_NAME__

知乎账号 OAuth Hello World。

本地地址只能预览页面，无法完成知乎登录。请先部署到 Cloudflare、Sealos 等在线平台，再将下面的公网回调地址登记到知乎开放平台：

```text
__REDIRECT_URI__
```

```bash
npm test
npm run check
npm start
```

打开 <http://127.0.0.1:__PORT__/> 预览页面。如果回调地址显示“部署后配置”，请在部署完成后运行 `zhihu-hackathon` Skill 提供的 `configure_callback.mjs`。只有部署后的公网页面可以测试授权，最终确认必须由用户本人完成。

## 安全与清理

- 本地预览时，app_key 在项目专用 macOS 钥匙串条目中。
- 部署时，app_key 和 Access Secret 使用平台的 Secret/环境变量功能配置为 `ZHIHU_OAUTH_APP_KEY` 和 `ZHIHU_ACCESS_SECRET`，不要写进代码包。
- Access Secret 由项目级官方 `.codex/skills/zhihu` 管理。
- OAuth Token 只在服务内存中，重启即清除。
- 测试结束先按 `zhihu-hackathon` Skill 清除 app_key，再按官方 Skill 清除 Access Secret，最后删除整个项目。
