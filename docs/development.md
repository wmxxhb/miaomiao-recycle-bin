# 技术说明

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

## 动作室

`npm run studio` 单独启动默认端口 4280，可设置 `STUDIO_PORT` 改端口，`STUDIO_NO_OPEN=1` 可仅启动服务。默认用途清单保存在 `artifacts/studio/`；桌面托盘启动动作室时使用当前用户的数据目录和系统分配的空闲端口，退出桌面程序会关闭这个子服务。

动作室的收藏、用途和备注用于挑选动作。桌面触发规则由 `app/actions.js` 控制，不会因为改了预览清单就自动变化。
