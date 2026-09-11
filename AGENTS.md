# AGENTS.md

无限画布扫雷：Node CJS 单文件服务端 + 无框架原生 JS 前端，无构建/lint/typecheck 步骤。

## 命令

- 启动：`npm start`（即 `node server.js`，默认端口 8420，`PORT` 环境变量可覆盖）
- 测试：先启动服务，再 `node test/ws-test.js`（无测试框架、无 `npm test`；只跑单文件）

## 关键约束

- `server.js` 中游戏状态是**进程级单例**，所有 WS 连接共享同一局；任意客户端发 `{t:"reset"}` 会清掉所有人的局面（测试脚本开头就发 reset，别在有其他客户端连着时跑）。
- 防作弊设计是刻意的：WS 线路上**从不下发未翻开格的雷位置或数字**。`{t:"preview"}` 的负载只有 `[[x,y],…]` 坐标 + `ok` 布尔；改动协议时不要把 `mine/num` 字段加回去（`test/ws-test.js` 会断言泄露）。
- 格子状态码 `s` 是服务端与 `public/app.js` 缓存的共享约定：`0` 未翻开 / `1` 已翻开 / `2` 标旗 / `3` 中和 / `4` 爆雷，两端必须同步修改。
- 无限地图来自 `server.js` 的 `hash32` + `DENSITY`，改任意一个都会改变所有地图；客户端永远不知道种子。
- 前端 `public/app.js` 无打包器，直接改源码即可生效；`cellPx`/`cam` 单位是 CSS 像素（渲染时 canvas 按 devicePixelRatio 缩放）。

## 本环境运维坑（已踩过）

- 在本机 shell 工具里重启服务**不要**用 `pkill -f "node server.js"`——模式会匹配到执行命令的 shell 自身并把自己杀掉。正确方式：用 `ss -tlnp | grep 8420` 找 PID 再 `kill`。
- 后台常驻服务用 `setsid nohup node server.js > /tmp/mine.log 2>&1 < /dev/null &`，否则进程会随 shell 工具会话退出。

## 移动端/前端坑（已踩过）

- **iOS Safari 别只绑 `onclick`**：iPad 上大概率收不到合成 click（表现为按钮可见但点了没反应，且时灵时不灵）。统一走 `public/app.js` 的 `bindTap(el, fn)`：`touchend` 直接触发 + `click` 兜底、700ms 去重窗口；HUD 按钮全部适用，新增按钮也必须用它。
- **覆盖层显隐必须用 ID 级规则**：如 `#overlay.hidden { display:none }`。通用 `.hidden` 会被 `#overlay { display:flex }` 的 ID 优先级压过，导致结算面板开局就强制显示、reset 后藏不掉。
- **静态响应必须带 `Cache-Control: no-cache`**（server.js 已设）：否则浏览器启发式缓存旧版 `app.js`/`index.html`，新旧混搭会让缺元素的绑定脚本 null 报错、后续初始化全部中断。
- **移动端样式约定**：媒体查询统一写 `(pointer: coarse), (hover: none), (max-width: 640px)`（`hover:none` 兜底 iPad“桌面网站”模式）；窄屏 HUD 固定两行（`#props` 用 `order:9 + flex-basis:100%` 独占第二行，`scrollbar-width:none` + `::-webkit-scrollbar{display:none}` 隐藏滚动条但保留滑动）。
- 画布 `touch-action:none` 只作用于 canvas；HUD 上的按钮需 `touch-action:manipulation` 消除双击候选延迟。
