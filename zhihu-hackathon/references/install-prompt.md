# 对外一段式安装 Prompt

项目创建成功页把 `{{...}}` 替换为该项目的真实值。`{{ZHIHU_HACKATHON_SKILL_URL}}` 必须是平台实际托管的 ZIP 地址。

```text
请安装并使用知乎官方提供的 zhihu-hackathon Skill，自动初始化我的黑客松项目。

Skill 下载地址：{{ZHIHU_HACKATHON_SKILL_URL}}

项目配置：
- 项目名称：{{PROJECT_NAME}}
- 可选 OAuth App ID：{{APP_ID}}
- 可选 OAuth App Key：{{APP_KEY}}
- 可选 OAuth Redirect URI：{{REDIRECT_URI}}

请按以下要求直接执行：

1. 将 Skill ZIP 下载到临时目录，确认 ZIP 内只有 `zhihu-hackathon/` 根目录，没有绝对路径或 `..` 路径。
2. 把完整 `zhihu-hackathon` 目录安装到当前 Agent 支持的项目级 Skill 目录；优先使用当前项目的 `.codex/skills/zhihu-hackathon`。不要只复制 `SKILL.md`。
3. 完整阅读 `zhihu-hackathon/SKILL.md`，然后使用 `$zhihu-hackathon` 初始化项目。
4. 安装完成后，先用 Skill 内面向学生用户的简短文案，介绍知乎账号登录能做什么，并明确说明：本地地址只能预览页面，必须部署到 Cloudflare、Sealos 等平台后才能完成登录。然后询问我是否接入，并等待明确选择。
5. 如果我选择不接入，生成基础版 Hello World；不要读取或配置下面的 OAuth 凭证，项目中不要加入 OAuth 页面、路由、Token 逻辑或用户接口。
6. 如果我选择接入，再使用上面的可选 OAuth 配置。App Key 是临时测试密钥，不要在回复、日志、截图、命令参数、源码、`.env`、URL、Git 或前端响应中复述或保存它；按照 Skill 指引通过标准输入写入本地安全凭证库。
7. 允许 Skill 安装随包附带的官方 zhihu-cli Skill、安装兼容版本 CLI、创建独立项目、运行测试并启动本地 Hello World Demo。
8. OAuth 分支如果还需要开放平台 Access Secret，按照官方 zhihu Skill 引导我申请并通过安全输入配置，不要把 App Key 当成 Access Secret 或 X-OAuth-Token。
9. OAuth 分支先生成可本地预览的页面，再协助我部署。取得公网 HTTPS 地址后，把 `https://<公网域名>/auth/callback` 同时写入项目和知乎开放平台；不能使用 localhost 或 127.0.0.1，也不要伪造 OAuth 已打通。
10. 在部署后的页面进入知乎最终授权确认页时停下来让我本人操作。授权完成后，验证账号信息，并读取该登录账号的创作内容、关注用户、收藏夹等信息；每项最多展示一条。
11. 项目和两个 Skill 都是临时测试内容。生成清理说明；只有我明确要求后才能删除。

现在请先安装 Skill。安装后展示它提供的简短介绍，并询问我是否接入知乎账号登录。
```

## 产品安全提示

明文 `app_key` 会进入用户选择的 Agent 对话记录。黑客松测试可以按当前需求注入，但页面必须提示用户测试结束后轮换密钥。正式产品应改成安装后由 Agent 在本地安全输入阶段索取，而不是把密钥写进 Prompt。
