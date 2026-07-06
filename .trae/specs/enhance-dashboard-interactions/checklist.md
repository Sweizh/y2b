# Verification Checklist

> 视觉一致性以 `.uploads/extracted/pages/` 下设计稿为唯一参照；交互以本 spec 中 ADDED Requirements 为准。

## 视觉一致性
- [ ] 登录页整体配色 / 圆角 / 阴影 / 字体与设计稿 `登录.html` 完全一致（暗色主题）
- [ ] 控制台页 5 个 section 的卡片样式、表单控件、按钮、徽章颜色与设计稿 `控制台.html` 一致
- [ ] 所有新增组件（Toast / Modal / 主题按钮 / 图标按钮）仅使用 `#theme-vars` / `#component-vars` 中既有 CSS 变量，未引入新调色板
- [ ] 明色主题下（`:root` 默认）所有 section 颜色与对比度合理，无纯黑文字背景与低对比度区域
- [ ] 暗色主题下（`.dark`）所有 section 颜色与设计稿一致，无亮色残留

## 登录页交互
- [ ] 首次访问默认进入「初始化模式」（标题「设置管理密码」+ 「初始化」按钮 + 双密码框 + 隐藏「忘记密码」）
- [ ] 切换至「登录模式」后变为「登录」标题 + 「登录」按钮 + 单密码框 + 显示「忘记密码？」
- [ ] 密码字段眼睛图标点击切换 `password ↔ text`，图标 `eye ↔ eye-off`，`aria-label` 同步
- [ ] 初始化模式：密码 < 8 位提示「密码至少 8 位」；两次不一致提示「两次输入的密码不一致」；错误以内联红色文案展示
- [ ] 提交时按钮进入 loading（spinner + 禁用），完成后 Toast 反馈
- [ ] 初始化 / 登录成功后跳转至 `控制台.html`
- [ ] Enter 键可触发提交；页面加载时自动聚焦首个输入框

## 控制台导航与布局
- [ ] 点击侧边栏导航项平滑滚动至对应 `#section-*`
- [ ] IntersectionObserver 在滚动时自动高亮当前 section 对应导航项（active 态：`color: var(--brand-500); background: var(--brand-50)`）
- [ ] 桌面端 `≥ 1024px` 侧边栏固定可见，主内容 `margin-left: 240px`
- [ ] 移动端 `< 1024px` 默认隐藏侧边栏，显示汉堡按钮；点击汉堡 / 遮罩切换开合
- [ ] 移动端点击导航项后侧边栏自动收起并移除遮罩
- [ ] 「退出登录」弹出 Modal 二次确认，确认后跳转 `登录.html`

## 通用组件
- [ ] Toast `success`（绿）/ `error`（红）/ `info`（蓝）三态语义正确
- [ ] 多条 Toast 自上而下堆叠不遮挡
- [ ] Toast 3 秒后自动消失，可手动关闭
- [ ] 移动端 Toast 贴顶居中
- [ ] Modal 含标题 + 正文 + 取消 / 确认按钮
- [ ] Modal 遮罩点击关闭、Esc 关闭
- [ ] Modal 打开时 Tab 焦点不离开 Modal
- [ ] 按钮 loading 态显示 spinner 且 `disabled`

## 账号凭证区块（Section 1）
- [ ] 每个凭证旁「测试」按钮：点击 → loading → Toast（绿色「✓ 测试成功」或红色「✕ 测试失败」）
- [ ] 修改任一字段后「保存」按钮由置灰变可点击
- [ ] 「保存」点击 loading + 完成后 Toast「账号凭证已保存」

## AI 服务接口区块（Section 2）
- [ ] 「测试」按钮 loading + Toast 反馈
- [ ] 「保存」按钮脏值检测 + loading + Toast

## 频道管理区块（Section 3）
- [ ] 输入关键词 + 「搜索频道」loading + 1s 后渲染 mock 频道卡片列表（含头像 / 名称 / 订阅数 / 描述 / 关注按钮）
- [ ] 「关注」按钮点击切换为「已关注 ✓」次要样式
- [ ] 「启用」开关点击切换背景色（`--brand-500` ↔ `--background-400`）与圆点位置
- [ ] 「保存频道配置」loading + Toast

## 运行状态区块（Section 4）
- [ ] 「立即执行」按钮 loading + Toast「已触发，请稍后刷新查看结果」
- [ ] 处理记录表格在移动端可横向滚动，首列（频道）不丢失

## 手动添加视频区块（Section 5）
- [ ] textarea 多行 URL 「添加到队列」后按行拆分追加到列表，每项状态徽章为「等待中」
- [ ] 队列项删除按钮弹出 Modal 二次确认，确认后移除 + Toast
- [ ] 队列项状态徽章颜色与设计稿一致（pending / processing / retry）

## 主题切换
- [ ] 控制台存在主题切换入口（按钮含 `sun` / `moon` 图标）
- [ ] 切换后 `<html>` 的 `class="dark"` 与 `data-theme` 同步更新
- [ ] 主题偏好写入 `localStorage`，刷新后保持
- [ ] 首次访问（无 `localStorage` 记录）跟随 `prefers-color-scheme`

## 多端适配
- [ ] Mobile `< 640px`：所有栅格降为单列；字号 / 间距收缩 1 档
- [ ] Tablet `640–1023px`：栅格双列；统计卡片 2 列
- [ ] Desktop `≥ 1024px`：栅格双列及以上；统计卡片 3 列
- [ ] 移动端表格 `overflow-x-auto`，列宽不被压缩
- [ ] 移动端底部留 `env(safe-area-inset-bottom)` 安全区
- [ ] 所有图标按钮触控热区 ≥ 44×44px（padding 扩展，不改视觉尺寸）
- [ ] 所有图标按钮有 `aria-label`

## 跨断点回归
- [ ] 375px 宽度（iPhone）下无横向溢出、无错位、无重叠
- [ ] 768px 宽度（平板）下侧边栏抽屉工作正常
- [ ] 1280px 宽度（桌面）下侧边栏固定，主内容居中（`max-w-[960px] mx-auto`）
