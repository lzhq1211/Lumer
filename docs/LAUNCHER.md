# 双击启动器

`Lumer Assistant.app` 是 macOS 双击入口。双击后它会：

1. 检查 `http://127.0.0.1:3000` 是否已有 Lumer 服务；
2. 服务未运行时，在首次启动或不存在 production build 时执行 `app/npm run build`；
3. 在后台执行 `app/npm run start`，写入 `.lumer-launcher/server.log`；
4. 自动在默认浏览器打开 Lumer。

启动器启动的服务会由页面心跳维持：关闭所有 Lumer 浏览器页面后，服务在约 17 秒内自动退出。刷新页面或同时打开多个 Lumer 页面不会误停服务。手动在终端执行 `npm run start` 时不会启用此行为。

它不显示终端窗口。首次构建会稍慢；后续启动只要 production build 仍存在，通常直接打开。若启动失败，启动器会显示错误并打开日志。

应用包使用 `Contents/Resources/AppIcon.icns` 作为 Finder 图标。

更新源码后，如需立即使用新版本，可删除 `app/.next` 后双击启动器，或在 `app` 中重新执行 `npm run build`。
