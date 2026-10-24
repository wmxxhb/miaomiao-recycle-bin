# 开发与验证

运行环境：Windows 10/11、Node.js 22.12+。安装依赖使用 `npm ci`，实际运行还需按 [素材准备](assets.md) 完成本机导入。

## 模块

- `app/main.cjs`：窗口、托盘、IPC 权限检查、回收队列与本机动作室生命周期。
- `app/core.cjs`：成长状态、投喂去重、目录保护、系统回收结果核对。
- `app/actions.js` / `app/viewer.js`：动作池、计时、睡眠序列、骨骼与表情渲染。
- `app/ai-providers.cjs`：Chat Completions、Responses、Claude Messages；HTTPS、SSE、流式边界和错误遮盖。
- `app/ai-service.cjs`：Windows 凭据加密、对话、上下文、持久化与停止生成。
- `app/desktop-chat.cjs` / `app/dialogue-layout.cjs`：独立气泡、输入框与多屏布局。
- `app/asset-files.cjs`：素材清单和本机文件边界。
- `action-studio/`：项目自带的预览界面，只读取当前项目清单，不寻找其他工程。
- `native/PetMove.cs`：物理像素窗口移动，使用保留尺寸的 Windows 标志。
- `native/ShellRefresh.cs`：通知资源管理器已完成的回收操作，不执行删除。

## 自动检查

`npm test` 使用人工生成的夹具，覆盖成长与回收、动作计时、对白布局、AI 协议、密钥隔离、重定向阻止、上下文与持久化错误、素材边界、动作室的 Host / Origin 和并发写入。它不读取用户密钥、回收用户文件或请求真实厂商。

`npm run test:assets` 使用已导入的本机模型，核对三个形态的 81 段实际动画和独立嘴部曲线。CI 只运行无素材检查，不把人工模型夹具当作真实角色渲染验证。

导入素材并编译原生组件后，可使用 Electron 运行集成入口：

```powershell
npx electron . --smoke-test
npx electron . --drag-test
npx electron . --action-test
npx electron . --ai-test
npx electron scripts/studio-smoke.cjs
```

这些入口使用 `artifacts/` 下的独立配置，避免改写日常使用的数据。回收检查只创建并回收自己的临时测试文件；AI 检查使用本机 HTTP 模拟服务和固定假密钥。窗口测试会短暂显示测试精灵。结果及截图保存在 `artifacts/`，不提交到 GitHub。

`--drag-live-test` 用于人工拖动诊断，需手动操作。窗口位置、缩放和普通设置仅在用户主动更改时写入。对真实 API 的可用性与额度以用户配置服务的实际返回为准。

## 动作室

`npm run studio` 单独启动默认端口 4280，可设置 `STUDIO_PORT` 改端口，`STUDIO_NO_OPEN=1` 可仅启动服务。默认用途清单保存在 `artifacts/studio/`；桌面托盘启动动作室时使用当前用户的数据目录和系统分配的空闲端口，退出桌面程序会关闭这个子服务。

动作室的收藏、用途和备注用于挑选动作。桌面触发规则由 `app/actions.js` 控制，不会因为改了预览清单就自动变化。

## 构建与发布源码

`npm run build:native` 用 Windows 自带 C# 编译器构建辅助程序；源码提交到 Git，EXE 在本机生成。`npm run package` 按运行清单复制必要资源，拒绝覆盖已存在的版本输出目录，不复制原始导出日志、整份源素材、用户数据或签名私钥。

提交前运行 `npm test`、`npm audit` 和 `npm run check:publish`。后者扫描 Git 已跟踪/已暂存文件，阻止常见凭据、个人记录、构建目录、游戏素材及高可信度密钥格式；它不能替代人工审查。新增文档或代码前也应检查是否包含真实账户信息。

CI 固定依赖版本和 Actions 提交版本，默认令牌仅有源码读取权限。提交检查和默认测试可在没有任何游戏美术的干净克隆中运行。
