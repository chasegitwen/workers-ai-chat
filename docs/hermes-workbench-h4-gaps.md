# Hermes Workbench H4：工作目录与文件成果能力审计

审计日期：2026-11-05

目标版本：Hermes Agent `v0.22.5`

结论范围：本仓库通过 Worker 连接的 Hermes API Server（8642），不把本机 Dashboard（9119）视为同一公共 API。

## 结论

H4 所需的四项能力在 Hermes `v0.22.5` 的 8642 稳定 API 中均不完整：没有可用于 Run 的可信工作目录列表或工作目录参数，也没有按 Run/Session 列出并安全下载生成文件的契约。因此本阶段只展示由 `GET /v1/capabilities` 可确认的执行环境标识，并明确标记工作目录和文件成果不可用；没有实现目录选择、成果列表或下载。

| 能力 | 8642 API Server | 证据与判断 |
| --- | --- | --- |
| 1. 可信工作目录列表 | 不具备 | [API Server 的稳定能力发现只描述 `/v1/capabilities` 所广告的接口](https://github.com/NousResearch/hermes-agent/blob/v0.22.5/website/docs/user-guide/features/api-server.md#get-v1capabilities)，没有 workspace discovery。Dashboard 文档确有 [`GET /api/chat/workspaces`](https://github.com/NousResearch/hermes-agent/blob/v0.22.5/website/docs/user-guide/features/web-dashboard.md#get-apichatworkspaces)，但它属于 9119 本机管理面，不能据此推断 8642 支持。 |
| 2. 为 Run/Session 指定工作目录 | 不具备 | [`POST /v1/runs`](https://github.com/NousResearch/hermes-agent/blob/v0.22.5/website/docs/user-guide/features/api-server.md#post-v1runs) 只记录 `input` 及可选 `session_id`、`instructions`、`conversation_history`、`previous_response_id`，未定义 `cwd`/workspace。Dashboard 的 `cwd` 只与 [`/api/pty?cwd=...`](https://github.com/NousResearch/hermes-agent/blob/v0.22.5/website/docs/user-guide/features/web-dashboard.md#get-apichatworkspaces) 配对，不能用于 Runs API。 |
| 3. 列出生成文件 | 不具备 | [Runs API](https://github.com/NousResearch/hermes-agent/blob/v0.22.5/website/docs/user-guide/features/api-server.md#runs-api-streaming-friendly-alternative) 的状态输出是文本、状态、用量和事件；固定文档没有 Run/Session artifact manifest 接口。Responses 示例中的 tool output 是模型执行记录，不是可授权的文件清单。 |
| 4. 安全下载指定成果文件 | 不具备 | 固定 API Server 文档没有 artifact download endpoint；文档还明确说明[文件上传不受支持](https://github.com/NousResearch/hermes-agent/blob/v0.22.5/website/docs/user-guide/features/api-server.md#limitations)。Dashboard 的 session JSON export 是会话导出，不是生成文件下载契约。 |

## 仓库证据

- `src/hermes/client.js` 只允许固定的 8642 路径模板：capabilities、skills、toolsets、model options 和 Runs 控制/事件；没有 workspace、artifact 或任意 URL/文件路径代理。
- `test/helpers/mockHermes.js` 模拟同一组 v0.22.5 契约，也没有 `cwd`、workspace discovery、artifact manifest 或 download。
- `src/hermes/config.js` 将上游限制为代码审查过的 HTTPS origin；凭据仅由 Worker 注入。浏览器不持有 Hermes Token。
- 本次实现继续只调用 `/api/hermes/capabilities-panel`，由 Worker 读取并白名单化 `/v1/capabilities`。它不会访问或暴露 9119。

## 本阶段交付边界

已具备并实现：

- 显示可确认的实例 ID、`platform` 和 API 模型名。
- 明确显示“8642 Runs API 未提供可确认或可选择的工作目录”。
- 明确显示“8642 API 未提供可验证的成果列表或下载接口”。
- 对能力响应做字段白名单和 Worker 端凭据值脱敏；刷新失败时清空旧数据，避免把过期信息当成当前状态。

未实现：目录选择、Run `cwd`、文件枚举、文件下载。没有用 Shell/terminal HTTP 代理冒充文件 API，没有连接 9119，没有增加 Worker 管理权限。

## 最小安全后续方案

应先由 Hermes 的 8642 稳定 API 提供并在 `/v1/capabilities` 中广告以下契约，再由本仓库接入：

1. 工作目录发现：只返回服务端配置/发现并验证过的目录，最好使用不透明 `workspace_id`；不要接受浏览器提交的任意绝对路径。
2. Run 绑定：`POST /v1/runs` 接受 `workspace_id`，Hermes 在 admission 时重新解析、检查目录存在且位于允许根目录内，并把绑定写入 Run/Session 状态。Worker 还需验证当前 Web 用户、项目、会话与 workspace 的授权关系。
3. 成果清单：提供按 Run/Session 所有者隔离的 artifact manifest，至少包含不透明 artifact ID、显示文件名、媒体类型、字节数和校验值；清单必须是服务端实际产物记录，不得由模型文本或 terminal 输出推断。
4. 安全下载：通过 artifact ID 取文件；Hermes 和 Worker 都验证用户/项目/会话/Run 归属。服务端需做规范路径与允许根约束、拒绝目录穿越和符号链接逃逸、限制单文件和累计大小、设置安全的 `Content-Disposition`、`X-Content-Type-Options: nosniff` 与保守媒体类型，并避免把主动 HTML/SVG 以内联方式交付。
5. 网络边界：仍由 Worker 持有 Token 并代理窄接口；8642 保持受保护，9119 保持本机管理面且不暴露公网。

在上述上游契约出现前，H4 应保持当前只读降级状态。
