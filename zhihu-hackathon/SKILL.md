---
name: zhihu-hackathon
description: 自动初始化知乎黑客松项目，安装官方 zhihu-cli Skill 与 CLI，向用户介绍并询问是否接入知乎账号 OAuth，再按选择生成基础版或 OAuth 版 Hello World Demo；OAuth 版会安全配置 app_key 并验证登录账号的创作、关注和收藏接口。用于用户粘贴黑客松项目初始化 Prompt、要求接入知乎开放平台或 OAuth、创建知乎 Hello World、安装 zhihu-cli Skill，或清理临时黑客松项目时。
---

# 知乎黑客松项目初始化

将当前 Skill 作为编排层；把随包附带的官方 `zhihu` Skill 安装到目标项目。不要修改官方 Skill 内容，也不要把它的 OAuth 文档误解为 CLI 已支持 OAuth Token。

## 开始前：先做 OAuth 产品引导

先读取 [references/oauth-introduction.md](references/oauth-introduction.md)，逐字展示其中的固定欢迎文案。文案需要覆盖：

- 接入后可以实现什么；
- 为什么本地只能预览、真实登录需要先部署；
- 可以使用 Cloudflare、Sealos 等在线部署平台；
- 部署与配置可以由 Agent 继续协助。

必须逐字展示该文件“对用户展示的固定文案”，不要自行增加技术说明或选项。展示后暂停初始化，等待用户明确选择是否接入。不要因为安装 Prompt 已包含 OAuth 凭证而默认选择“接入”。

- 用户选择“不接入”：生成基础版 Demo；不读取、不配置 `app_id`、`app_key`、`redirect_uri`，项目不包含 OAuth 页面、路由、Token 逻辑或用户接口调用。
- 用户选择“接入”：才读取 OAuth 配置并生成 OAuth 版 Demo。
- 用户回答含糊：只追问这一个选择，不开始写项目。

两种分支都需要提取项目名称和目标项目目录；未给出目录时，在当前工作目录下用项目名称生成安全的短横线目录名。

OAuth 分支另外提取 `app_id` 和 `app_key`。`redirect_uri` 可在初始化时提供，也可等部署后再配置；不得把 `127.0.0.1`、`localhost` 或其他本地地址当作可调通的真实回调。缺少公网回调时先生成 OAuth 版脚手架，但把真实登录标记为“等待部署”。涉及部署、Secret、换 token 或用户接口诊断时，先读取 [references/deployment-credentials.md](references/deployment-credentials.md)。

OAuth 分支使用以下安全边界：

- `app_id`、项目名称和回调地址写入项目配置。
- `app_key` 只通过标准输入写入 macOS 钥匙串，不进入命令参数、源码或日志。
- 部署时把 `app_key` 和 Access Secret 写入 Cloudflare、Sealos 等平台的 Secret 配置，不进入代码包。
- 开放平台 Access Secret 由官方 `zhihu` Skill 管理。
- OAuth Token 只存本地 Node 进程内存会话。
- 用户必须亲自点击知乎授权页的最终确认按钮。

凭证命名必须明确区分：

- App ID：短数字，只写项目配置的 `oauth.appId`，不要写入 `ZHIHU_OAUTH_APP_KEY`。
- OAuth App Key：写入本地钥匙串或线上 `ZHIHU_OAUTH_APP_KEY`，用于 `/access_token`。
- Access Secret：写入官方 `zhihu` Skill 或线上 `ZHIHU_ACCESS_SECRET`，用于用户数据接口的 `Authorization: Bearer ...`。

## 初始化

1. 运行项目生成器：

```bash
node <skill-dir>/scripts/init_project.mjs \
  --project-dir <absolute-project-dir> \
  --project-name <project-name> \
  --oauth <enabled|disabled> \
  [--port <local-port>] \
  [--app-id <app-id>] \
  [--redirect-uri <public-https-redirect-uri>]
```

生成器会：

- 按选择复制 `assets/hello-world-basic/` 或 `assets/hello-world-oauth/`；
- 校验并安装随包附带的官方 `zhihu-cli-skill.zip` 到项目级 `.codex/skills/zhihu`；
- 运行官方 Skill 的状态检查，并在需要时尝试安装官方 CLI；
- 生成不含密钥的 `hackathon.config.json`。

2. 只有 OAuth 分支才配置 `app_key`。启动交互式钥匙串命令后，通过终端输入两次相同的值；禁止放进命令参数：

```bash
node <skill-dir>/scripts/set_app_key.mjs --project-dir <absolute-project-dir>
```

启动命令后按系统提示发送并确认；不要在回复或工具输出中复述完整值。

3. 首次部署取得公网域名后，用实际公网 HTTPS 回调更新项目，然后重新部署：

```bash
node <skill-dir>/scripts/configure_callback.mjs \
  --project-dir <absolute-project-dir> \
  --redirect-uri https://<public-domain>/auth/callback
```

把同一个地址登记到知乎开放平台。未完成此步骤时，只验收本地页面，不发起真实 OAuth。

4. 运行：

```bash
node <skill-dir>/scripts/doctor.mjs --project-dir <absolute-project-dir>
```

若 `access_secret.configured=false`，完整阅读目标项目 `.codex/skills/zhihu/SKILL.md`，按其初始化流程引导用户申请并安全配置 Access Secret。用户在安装 Prompt 中已经授权 Skill/CLI 安装，但没有授权你虚构或替他申请 Access Secret。若 doctor 输出 `credentialWarnings`，必须先解释并修复；不要让用户带着 App ID / App Key / Access Secret 串位风险部署。

部署到线上前，逐项核对：

- `ZHIHU_OAUTH_APP_KEY` 是 OAuth App Key，不能是 App ID。
- `ZHIHU_ACCESS_SECRET` 是开放平台 Access Secret，不能是 OAuth App Key。
- 两个 Secret 的脱敏 sha256 前缀不同。
- `oauth.appId`、`oauth.redirectUri` 和开放平台登记值一致。

5. 在目标项目运行 `npm test`、`npm run check`、`npm start`，验证 `/api/health`。OAuth 分支还验证 `/api/oauth/status`。返回本地预览地址，并明确它不能完成真实登录。

## OAuth 验收（仅 OAuth 分支且已部署）

阅读目标项目官方 Skill 的 `references/oauth.md` 和 `references/user-api.md`，再进行真实授权。

1. 确认应用已部署、回调是公网 HTTPS 地址，且已登记到知乎开放平台。
2. 用户在部署后的 Demo 点击“授权知乎账号”。
3. 到知乎最终授权确认页时让用户本人操作；不要代点。
4. 回调后检查页面授权状态，不读取或输出 authorization code、app_key、Access Secret 或 OAuth Token。若失败，检查 `/api/oauth/status` 或错误页的脱敏诊断，确认 `codeReceived`、`grantType`、`codeField`、`appKeyLength`、`accessSecret.length` 和 `failedStage`。
5. 验证五项用户接口各请求一条：创作、关注、收藏夹、收藏夹内容、近期收藏。
6. 收藏夹内容依赖第一条收藏夹 `UrlToken`；没有收藏夹算空数据，不算失败。
7. 回调没有返回 `state` 时，必须显示“仅适合临时联调”，不得声称生产安全。
8. `/user` 没有正式响应 schema；账号资料读取失败不得伪造字段，也不阻断五项正式用户接口。

完成标准：静态检查和测试通过，浏览器无运行错误，敏感扫描无命中，五项接口的成功/空数据/失败均被如实记录。未完成用户授权时，把真实 OAuth 验收标记为待验证。

## 清理

本项目默认是临时内容。只有用户明确要求清理时才执行：

1. 停止本地服务。
2. OAuth 分支运行 `node <skill-dir>/scripts/clear_app_key.mjs --project-dir <project-dir>`。
3. 按官方 `zhihu` Skill 运行 `auth logout` 并确认钥匙串已清除。
4. 确认目标路径后再删除项目目录和本 Skill；删除前不得使用宽泛路径、环境变量或未解析通配符。

## 资源

- 对外一段式安装 Prompt：读取 [references/install-prompt.md](references/install-prompt.md)。
- 初始化时的 OAuth 介绍与询问：读取 [references/oauth-introduction.md](references/oauth-introduction.md)。
- OAuth 角色、安全边界和已知协议缺口：读取 [references/oauth-boundary.md](references/oauth-boundary.md)。
- 部署凭证映射与线上诊断：读取 [references/deployment-credentials.md](references/deployment-credentials.md)。
- 官方 Skill 快照校验信息：读取 [references/official-skill-snapshot.md](references/official-skill-snapshot.md)。
