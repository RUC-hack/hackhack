# OAuth 接入边界

## 凭证角色

| 凭证 | 用途 | 存储 |
| --- | --- | --- |
| `app_id` | 标识第三方应用 | 项目公开配置 |
| `app_key` | 后端交换 OAuth Token | macOS 钥匙串 |
| `authorization_code` | 一次性换取 Token | 后端回调内存 |
| OAuth `access_token` | 代表已授权用户 | Node 进程内存会话 |
| 开放平台 Access Secret | 鉴权开放平台调用方 | 官方 zhihu-cli 凭证存储 |

`app_id`、`app_key`、Access Secret 是三个不同凭证。`app_id` 不能写入 `ZHIHU_OAUTH_APP_KEY`；OAuth `app_key` 不能写入 `ZHIHU_ACCESS_SECRET`。

本地 `localhost`、`127.0.0.1` 等地址只能预览页面，不能完成本项目的知乎账号登录。真实联调必须部署到 Cloudflare、Sealos 等平台，使用公网 HTTPS 回调地址。部署端通过平台 Secret 注入 `ZHIHU_OAUTH_APP_KEY` 和 `ZHIHU_ACCESS_SECRET`。

换取 OAuth Token 时发送表单：

```text
app_id=<App ID>
app_key=<OAuth App Key>
grant_type=authorization_code
redirect_uri=<公网 HTTPS callback>
code=<回调得到的 authorization_code>
```

`grant_type=authorization_code` 是 token 接口固定枚举值，不从回调读取。`code` 字段承载回调中的 `authorization_code`。

调用用户 API 时同时发送：

```http
Authorization: Bearer <开放平台 Access Secret>
X-OAuth-Token: <OAuth access_token>
```

`app_key` 不是 `X-OAuth-Token`。

## 已知协议缺口

- 当前官方 Skill 记录的真实回调参数是 `authorization_code`；后端兼容 `code`。
- Token 接口表单仍使用字段 `code`，并固定发送 `grant_type=authorization_code`。
- 实测回调可能不返回 `state`，不能宣称通过标准 OAuth CSRF 校验。
- 当前没有 PKCE、scope、refresh token、撤销、解绑和拒绝授权协议。
- `/user` 只有实测提示，没有正式响应 schema；不应将猜测字段作为平台契约。

因此该模板是黑客松联调基线，不是无需安全评审即可上线的生产登录方案。
