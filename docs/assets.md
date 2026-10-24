# 本机素材准备

仓库不提供角色美术资源。程序需要喵喵、喵呜、魔力猫三个形态的 GLB、PNG 和动作清单；它们在本机导入，始终被 Git 忽略。

## 已有本项目的本机素材

如果另一份本地项目已有 `resources/miaomiao/runtime.json`，将其作为导入来源：

```powershell
npm run assets:import -- --from "另一份本地项目的 resources/miaomiao 目录"
npm run assets:check
```

只复制运行清单引用的模型和贴图，以及可选的托盘图标、炫彩素材。不复制聊天、密钥、导出日志、原始音频、原生宠物包或个人配置。目标已有清单时拒绝覆盖，明确需要更新时再加 `--replace`。

## 从本机游戏导出

本项目兼容通过 [rocom-pets 1.14.2](https://github.com/whoisnian/rocom-pets/releases/tag/1.14.2) 原版导出器生成的解包目录。导出工具、配套库和游戏由你自行准备；此仓库不会下载、分发或修改它们。

该版本原版导出器的命令格式为：

```powershell
& "原版导出器所在目录\rocom-pets-export.exe" --species 3001 --game-dir "你的游戏安装目录" --out ".local-assets\exported" --dump
npm run assets:import -- --from ".local-assets\exported"
npm run assets:check
```

`3001` 是喵喵的游戏 ID，不是图鉴号 002。导出器生成整个进化链，本项目只取前三个形态。它们按名字匹配，GLB 中的动作名称、时长和 `dump.json` 中的表情曲线一起生成运行清单。导入接受导出根目录、`002-喵喵` 目录或已有完整清单的目录。

普通 `.rkpet2` 宠物包不是本项目的直接输入。如果手头只有这个包，先按原版工具支持的导出方式取得 GLB / PNG / `dump.json`，或使用已有的本机运行素材目录。不同导出器版本可能改变字段，应先检查兼容性。

基础动作预览不要求炫彩共享资源。完整本地素材目录中的 `source/packs/glassy/` 可提供炫彩；缺少时动作室会关闭对应选项，其他功能照常使用。

## 导入后的结构

```text
resources/miaomiao/
  README.md
  runtime.json             三个形态的运行清单
  forms/...                GLB 与 PNG，或保留来源的相对目录
  renders/icon.png         可选托盘图标；缺少时使用程序绘制的叶子图标
  source/packs/glassy/     可选炫彩共享素材
```

清单仅支持目录内的相对路径。导入检查三种形态、27 段必需动作、材质贴图与表情曲线，检查 GLB 2 格式及动画名称；拒绝越界路径、外部 GLB 引用和指向目录外的链接。导入失败时不会触碰游戏安装目录。

导入脚本会先验证来源再复制；`--replace` 是显式覆盖本地素材，不是多文件事务。替换中断时请重新导入并运行检查。不要选择存放个人文档的目录作为 `--into` 目标。

模型原始关键帧约 30 Hz，桌面渲染目标 60 FPS，通过插值保持动作速度。已有素材的身体贴图为 1024×1024，眼睛图集通常为 512×512；提高渲染帧率不会增加原贴图细节。

公开 GitHub 仓库和默认 CI 不需要、也不会上传这些文件。本机 `npm run package` 生成的便携目录包含本机导入素材，分享前需自行确认相应素材的授权范围。
