# Tasks

> 实施约定：
> - 设计源文件位于 `.uploads/extracted/pages/登录.html` 与 `.uploads/extracted/pages/控制台.html`。
> - 为保留设计稿可对照，输出文件直接覆写到这两个路径（或等价副本），不创建额外骨架项目。
> - 所有视觉令牌必须复用设计稿 `#theme-vars` / `#component-vars` 中既有的 CSS 变量，禁止引入新调色板。
> - 后端逻辑全部以 mock 形式实现（setTimeout 模拟延迟，固定或随机返回），仅演示交互。

- [ ] Task 1: 准备工作目录与共享样式 / 脚本骨架
  - [ ] SubTask 1.1: 在 `.uploads/extracted/pages/` 下保留 `登录.html` 与 `控制台.html`，原地编辑而非新建文件
  - [ ] SubTask 1.2: 抽取两个页面共用的「设计令牌 + Tailwind 配置 + Lucide 初始化」到可复用的 `<style>` / `<script>` 片段（仍内联在两个 HTML 文件头部，避免外部资源依赖），确保视觉一致
  - [ ] SubTask 1.3: 在每个页面 `<body>` 末尾追加 `assets/js/app.js`（或内联 `<script>`）与 `assets/css/app.css`（或内联 `<style>`）作为本次交互代码入口
- [ ] Task 2: 通用交互组件 — Toast / Modal / Loading 按钮
  - [ ] SubTask 2.1: 实现 Toast 组件（`success/error/info`、堆叠、3s 自动消失、手动关闭、右上角贴边、移动端贴顶居中）
  - [ ] SubTask 2.2: 实现 Modal 组件（标题 + 正文 + 取消/确认、遮罩点击关闭、Esc 关闭、Tab 不离开 Modal）
  - [ ] SubTask 2.3: 实现按钮 loading 态（spinner + 禁用，复用 `--shadow-sm` / `--brand-500`）
- [ ] Task 3: 登录页交互（`pages/登录.html`）
  - [ ] SubTask 3.1: 实现「初始化模式 ↔ 登录模式」切换：默认初始化态；登录态下隐藏「确认密码」、改标题为「登录」、按钮文案为「登录」、显示「忘记密码？」
  - [ ] SubTask 3.2: 密码显示 / 隐藏切换（`eye` ↔ `eye-off`，同步 `aria-label`）
  - [ ] SubTask 3.3: 表单校验（密码 ≥ 8 位、两次一致；登录模式仅非空），错误以 inline 红色文案展示，使用 `--state-error`
  - [ ] SubTask 3.4: 提交 loading + Toast 反馈，初始化 / 登录成功后跳转至 `控制台.html`
  - [ ] SubTask 3.5: Enter 键提交，自动聚焦首个输入框
- [ ] Task 4: 控制台导航与布局
  - [ ] SubTask 4.1: 侧边栏导航项点击平滑滚动至对应 `#section-*`
  - [ ] SubTask 4.2: IntersectionObserver 监听当前 section，自动高亮对应导航项（`color: var(--brand-500); background: var(--brand-50)`）
  - [ ] SubTask 4.3: 移动端 `< 1024px` 默认隐藏侧边栏、汉堡按钮切换；点击导航项或遮罩后自动收起
  - [ ] SubTask 4.4: 「退出登录」Modal 二次确认，确认后跳转 `登录.html`
- [ ] Task 5: 账号凭证区块交互（Section 1）
  - [ ] SubTask 5.1: 每个凭证旁「测试」按钮：loading → Toast（绿色「✓ 测试成功」或红色「✕ 测试失败」），mock 1s 延迟
  - [ ] SubTask 5.2: 任一字段修改后「保存」按钮由置灰变为可点击；保存 loading + Toast
  - [ ] SubTask 5.3: 敏感字段（密码 / Cookie）默认 `readonly` + 脱敏值，点击「编辑」按钮（新增图标按钮）才解锁编辑；本任务可在不破坏视觉前提下仅做基础解锁，复杂加密回显略
- [ ] Task 6: AI 服务接口区块交互（Section 2）
  - [ ] SubTask 6.1: 「测试」按钮 loading + Toast，与 Task 5 复用同一逻辑
  - [ ] SubTask 6.2: 「保存」按钮脏值检测 + loading + Toast
- [ ] Task 7: 频道管理区块交互（Section 3）
  - [ ] SubTask 7.1: 搜索框输入 + 「搜索频道」按钮 loading + 1s 后渲染 mock 频道卡片列表（覆盖设计稿中已有的 2 张静态卡片，改为 JS 动态注入）
  - [ ] SubTask 7.2: 卡片「关注」按钮切换：未关注 / 已关注（次要样式 + 文案「已关注 ✓」）
  - [ ] SubTask 7.3: 频道配置「启用」开关点击切换（背景色 + 圆点位置）
  - [ ] SubTask 7.4: 「保存频道配置」loading + Toast
- [ ] Task 8: 运行状态区块交互（Section 4）
  - [ ] SubTask 8.1: 「立即执行」按钮 loading + Toast「已触发，请稍后刷新查看结果」
  - [ ] SubTask 8.2: 处理记录表格保持设计稿样式，移动端 `overflow-x-auto` + `min-width` 保证横向滚动
- [ ] Task 9: 手动添加视频区块交互（Section 5）
  - [ ] SubTask 9.1: textarea 多行 URL 解析，按行拆分为队列项；「添加到队列」loading + 追加到列表 + Toast
  - [ ] SubTask 9.2: 队列项状态徽章渲染（pending / processing / retry，颜色与设计稿一致）
  - [ ] SubTask 9.3: 队列项「删除」按钮：Modal 二次确认 → 移除 → Toast
- [ ] Task 10: 主题（明 / 暗）切换
  - [ ] SubTask 10.1: 在控制台顶部或侧边栏底部新增主题切换按钮（图标 `sun` / `moon`）
  - [ ] SubTask 10.2: 切换 `<html>` 的 `class="dark"` 与 `data-theme`，写入 `localStorage`；首次访问跟随 `prefers-color-scheme`
- [ ] Task 11: 多端断点与触控适配
  - [ ] SubTask 11.1: 三档断点栅格：Mobile `< 640px` 单列；Tablet `640–1023px` 双列（统计卡片 2 列）；Desktop `≥ 1024px` 统计卡片 3 列
  - [ ] SubTask 11.2: 移动端字号 / 间距收缩 1 档（通过 Tailwind 响应式类或 `@media` 覆盖）
  - [ ] SubTask 11.3: 表格 `overflow-x-auto` + 首列不丢失；底部安全区 `env(safe-area-inset-bottom)`
  - [ ] SubTask 11.4: 所有图标按钮最小触控热区 44×44px（padding 扩展，不改视觉尺寸）；补 `aria-label`
- [ ] Task 12: 视觉一致性核验与回归
  - [ ] SubTask 12.1: 与设计稿对照截图（暗色主题）逐 section 核对颜色、圆角、阴影、字体、间距，确保无新增调色板
  - [ ] SubTask 12.2: 明 / 暗双主题下各 section 视觉与对比度核验
  - [ ] SubTask 12.3: 移动端 375px / 平板 768px / 桌面 1280px 三档手动巡检无溢出 / 重叠 / 错位

# Task Dependencies
- [Task 2] 依赖 [Task 1]（共享样式 / 脚本骨架先行）
- [Task 3]、[Task 4]、[Task 10]、[Task 11] 可在 [Task 2] 完成后并行
- [Task 5]、[Task 6]、[Task 7]、[Task 8]、[Task 9] 依赖 [Task 2] 与 [Task 4]（导航与 Toast/Modal 就绪后各 section 才能挂交互）；这些 section 任务可并行
- [Task 12] 依赖所有交互任务完成（[Task 3]–[Task 11]）
