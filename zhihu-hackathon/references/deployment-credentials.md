# OAuth 部署凭证映射与诊断

## 三类凭证必须分开

| 名称 | 示例形态 | 写入位置 | 用途 | 常见误填 |
| --- | --- | --- | --- | --- |
| App ID | `<your-app-id>` 这类短数字 | `hackathon.config.json` 的 `oauth.appId` | 授权页标识应用 | 误填到 `ZHIHU_OAUTH_APP_KEY` |
| OAuth App Key | 通常为较长字符串 | 本地 macOS Keychain；线上 `ZHIHU_OAUTH_APP_KEY` | `/access_token` 换 OAuth Token | 误填到 `ZHIHU_ACCESS_SECRET` |
| Access Secret | 开放平台调用方密钥 | 官方 `zhihu` Skill；线上 `ZHIHU_ACCESS_SECRET` | 调用户数据接口时放入 `Authorization: Bearer ...` | 误填成 OAuth App Key |

不要把 App ID 当作 App Key。不要把 OAuth App Key 当作 Access Secret。

## `/access_token` 表单

`grant_type` 不是从回调读取的字段，而是 token 接口要求的固定枚举值：

```text
app_id=<App ID>
app_key=<OAuth App Key>
grant_type=authorization_code
redirect_uri=<登记的公网 HTTPS callback>
code=<回调得到的 authorization_code>
```

其中 `code` 字段承载回调中的 `authorization_code`。不要把表单字段名改成 `authorization_code`，除非平台文档更新。

## 上线前必须核对

在部署平台配置：

```text
ZHIHU_OAUTH_APP_KEY=<OAuth App Key>
ZHIHU_ACCESS_SECRET=<开放平台 Access Secret>
```

校验信号：

- `ZHIHU_OAUTH_APP_KEY` 不应等于 App ID，也不应只有几位。
- `ZHIHU_ACCESS_SECRET` 不应等于 OAuth App Key。
- 两个 Secret 的 sha256 前缀不应相同。
- `redirect_uri` 必须和知乎开放平台登记值完全一致，包括协议、域名、路径和尾部斜杠。

## 线上错误诊断

OAuth 回调失败时，错误页或状态接口应显示脱敏诊断：

```json
{
  "stage": "token_exchange_started",
  "codeReceived": true,
  "tokenExchange": {
    "url": "https://openapi.zhihu.com/access_token",
    "method": "POST",
    "contentType": "application/x-www-form-urlencoded",
    "appId": "<your-app-id>",
    "appKeySource": "env:ZHIHU_OAUTH_APP_KEY",
    "appKeyLength": 32,
    "appKeySha256Prefix": "...",
    "grantType": "authorization_code",
    "redirectUri": "https://<public-domain>/auth/callback",
    "codeField": "code",
    "codeLength": 32
  },
  "accessSecret": {
    "source": "env:ZHIHU_ACCESS_SECRET",
    "configured": true,
    "length": 126,
    "sha256Prefix": "..."
  },
  "failedStage": "token_exchange_started"
}
```

诊断信息不得输出完整 App Key、Access Secret、authorization_code 或 access_token。
