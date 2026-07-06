# YT2BILI 管理后台：交互增强与多端适配 Spec

## Why
设计稿（`登录.html` / `控制台.html`）已经定义了 Apple 风格的 Pinguo 设计令牌（颜色、圆角、阴影、字体、间距），并搭建了登录初始化卡片和侧边栏式控制台骨架。但当前页面仅完成静态结构与最基础的移动端侧边栏开关，缺少实际可用产品所需的：

- 表单校验与提交反馈（按钮 loading、成功/失败提示）
- 登录初始化态 ↔ 登录态的切换逻辑
- 控制台各区块的导航高亮、锚点跳转、内容加载状态
- 凭证测试按钮的连通性反馈、保存按钮的脏值检测
- 频道搜索 / 手动添加视频 / 队列管理等模块的真实交互
- 主题（明 / 暗）切换
- 平板与移动端的细节适配（栅格降列、字号、间距、表格横向滚动、触控热区）

本变更在不改变设计稿视觉语言的前提下，补齐上述交互与多端适配，使后台可作为前端原型被独立评审与验收。

## What Changes
- 登录页：补齐「初始化模式 / 登录模式」切换、密码显示切换、密码强度与一致性校验、提交 loading、错误提示、Enter 提交、初始化成功后跳转控制台。
- 控制台导航：实现侧边栏锚点跳转 + 当前 section 高亮（IntersectionObserver 监听滚动）；移动端侧边栏点击后自动收起；移动端汉堡按钮态切换。
- 控制台区块：为五个区块（账号凭证 / AI 服务接口 / 频道管理 / 运行状态 / 手动添加视频）补齐交互（详见 ADDED Requirements）。
- 通用交互：Toast 提示组件、Modal 确认框、按钮 loading 态、表单脏值检测与未保存提示、退出登录二次确认。
- 主题切换：基于 `:root` / `.dark` 的双主题切换，支持记忆到 `localStorage`，跟随系统初始主题。
- 多端适配：补齐 `< 640px` / `640–1023px` / `≥ 1024px` 三档断点的栅格、字号、间距、表格横向滚动、触控热区与底部安全区。
- 视觉一致性：所有新增组件必须复用设计稿已有的设计令牌（`--brand-*` / `--background-*` / `--text-*` / `--shadow-*` / `--radius` / `--spacing`），不得引入新调色板。
- **BREAKING**：无（基于设计稿增量补齐，不修改既有 HTML 结构的关键 DOM 约定 `data-dom-id`、`id` 等选择器）。

## Impact
- Affected specs: 无（首个 spec）。
- Affected code:
  - `pages/登录.html`（或等价的新文件路径，见 tasks）
  - `pages/控制台.html`（或等价的新文件路径，见 tasks）
  - 新增 `assets/js/` 与 `assets/css/` 下的拆分文件（可选；亦允许在单文件内追加 `<script>` / `<style>`）
- 设计参考来源：`.uploads/extracted/pages/登录.html`、`.uploads/extracted/pages/控制台.html`。
- 文档参考来源：`https://blog.sweizh.top/post/y2b`（§5 Web 管理后台、§10 Worker API）。

## ADDED Requirements

### Requirement: 登录初始化模式切换
系统 SHALL 在登录页支持两种模式：初始化模式（首次使用，设置管理密码）与登录模式（已设置密码后再次访问）。模式由页面状态或后端 `/api/config` 返回决定，前端默认进入初始化模式。

#### Scenario: 首次访问进入初始化模式
- **WHEN** 用户首次访问登录页
- **THEN** 显示「设置管理密码」标题与「初始化」按钮，包含「密码」「确认密码」两个字段，且「忘记密码」入口隐藏

#### Scenario: 已初始化后进入登录模式
- **WHEN** 用户访问已初始化系统的登录页
- **THEN** 显示「登录」标题与「登录」按钮，仅含「密码」一个输入框，显示「忘记密码？」入口

### Requirement: 密码字段显示切换
系统 SHALL 为每个密码输入框提供「显示 / 隐藏」切换按钮（眼睛图标），切换 `type="password"` ↔ `type="text"`，且 `aria-label` 同步更新。

#### Scenario: 切换密码可见性
- **WHEN** 用户点击眼睛图标
- **THEN** 密码以明文显示，图标变为「eye-off」，再次点击恢复隐藏

### Requirement: 登录表单校验
系统 SHALL 在用户提交前对初始化模式进行校验：密码不少于 8 位、两次密码一致；登录模式校验密码非空。校验失败时聚焦首个错误字段并在字段下方显示红色 inline 错误文案（使用 `--state-error` 语义色）。

#### Scenario: 初始化密码不一致
- **WHEN** 用户在初始化模式下输入两次不同密码并点击「初始化」
- **THEN** 提交被阻止，「确认密码」字段下方显示「两次输入的密码不一致」错误，按钮不进入 loading

#### Scenario: 登录密码为空
- **WHEN** 用户在登录模式下未输入密码点击「登录」
- **THEN** 「密码」字段下方显示「请输入管理密码」，并聚焦该字段

### Requirement: 登录提交与跳转
系统 SHALL 在提交时把按钮切换为 loading（禁用 + 显示 spinner），并在完成后通过 Toast 反馈结果。初始化成功后跳转至 `pages/控制台.html`；登录成功后同样跳转。

#### Scenario: 初始化成功跳转
- **WHEN** 初始化提交成功
- **THEN** 显示绿色 Toast「初始化成功，正在进入控制台…」，约 800ms 后跳转至控制台页

### Requirement: 控制台导航高亮与锚点跳转
系统 SHALL 在侧边栏点击导航项时平滑滚动至对应 section，并通过 IntersectionObserver 监听当前可视 section 自动高亮对应导航项（active 态：`color: var(--brand-500); background: var(--brand-50)`）。

#### Scenario: 点击导航跳转
- **WHEN** 用户点击侧边栏「AI 服务」
- **THEN** 页面平滑滚动至 `#section-ai-services`，该项变为 active 高亮，其余项取消高亮

#### Scenario: 滚动自动高亮
- **WHEN** 用户手动滚动至「运行状态」section 进入视口中部
- **THEN** 侧边栏「运行状态」项自动变为 active

### Requirement: 移动端侧边栏交互
系统 SHALL 在 `< 1024px` 视口下：默认隐藏侧边栏、显示汉堡按钮；点击汉堡或遮罩切换侧边栏开合；点击任一导航项后自动收起侧边栏并移除遮罩。

#### Scenario: 移动端点击导航后收起
- **WHEN** 在移动端展开侧边栏后点击「频道管理」
- **THEN** 页面滚动至目标 section，侧边栏收起，遮罩消失

### Requirement: 凭证测试按钮反馈
系统 SHALL 为账号凭证与 AI 服务接口中的每个「测试」按钮提供点击反馈：按钮进入 loading，调用对应测试逻辑（前端 mock：模拟网络延迟 + 随机或固定成功结果），通过 Toast 显示绿色「✓ 测试成功」或红色「✕ 测试失败：…」。

#### Scenario: 测试 B 站 SESSDATA 成功
- **WHEN** 用户点击「B站 SESSDATA」旁的「测试」
- **THEN** 按钮变为 loading「测试中…」，约 1 秒后显示绿色 Toast「B站 SESSDATA 测试成功」

### Requirement: 配置保存与脏值检测
系统 SHALL 在账号凭证与 AI 服务接口区块启用「脏值检测」：用户修改任一字段后，「保存」按钮变为可点击高亮态；未修改时按钮置灰。保存时进入 loading，完成后显示 Toast。

#### Scenario: 未修改时保存按钮置灰
- **WHEN** 区块加载完成后用户未修改任何字段
- **THEN** 「保存」按钮 `disabled` 且 opacity 降低

#### Scenario: 修改后保存成功
- **WHEN** 用户修改 B 站 bili_jct 后点击「保存」
- **THEN** 按钮显示 loading，约 1 秒后显示绿色 Toast「账号凭证已保存」

### Requirement: 频道搜索与卡片交互
系统 SHALL 在频道管理区块支持：输入关键词后点击「搜索频道」展示 mock 频道卡片列表；卡片「关注」按钮在已关注态显示「已关注 ✓」并切换为次要样式；频道配置中的「启用」开关可点击切换。

#### Scenario: 搜索频道返回结果
- **WHEN** 用户输入「公司」并点击「搜索频道」
- **THEN** 按钮进入 loading，1 秒后在搜索栏下方渲染频道卡片（头像 + 名称 + 订阅数 + 描述 + 关注按钮）

#### Scenario: 切换频道启用开关
- **WHEN** 用户点击频道卡片底部「启用」开关
- **THEN** 开关圆点位置与背景色切换（启用：`var(--brand-500)` + 圆点靠右；停用：`var(--background-400)` + 圆点靠左）

### Requirement: 手动添加视频队列交互
系统 SHALL 在「手动添加视频」区块支持：URL 多行输入；「添加到队列」把每行解析为队列项并追加到下方列表（含状态徽章 pending）；队列项的「删除」按钮可移除该项，删除前通过 Modal 二次确认。

#### Scenario: 批量添加视频
- **WHEN** 用户在 textarea 输入 3 行 URL 并点击「添加到队列」
- **THEN** 3 条视频以「等待中」状态追加至队列列表

#### Scenario: 删除队列项二次确认
- **WHEN** 用户点击某队列项的删除按钮
- **THEN** 弹出 Modal「确认删除该视频？」「取消 / 确认」；点击「确认」后该项从列表移除并显示 Toast

### Requirement: 立即执行与运行状态
系统 SHALL 在「运行状态」区块点击「立即执行」时弹出 Toast「已触发流水线，请稍后刷新查看结果」（不实际调用后端，仅做交互演示）；统计卡片与处理记录表格保持设计稿原样展示。

#### Scenario: 点击立即执行
- **WHEN** 用户点击「立即执行」
- **THEN** 按钮短暂 loading，随后显示 Toast「已触发，请稍后刷新查看结果」

### Requirement: 退出登录二次确认
系统 SHALL 在点击侧边栏底部「退出登录」时弹出 Modal 二次确认；确认后清空前端登录态（mock）并跳转回 `pages/登录.html`。

#### Scenario: 退出登录确认
- **WHEN** 用户点击「退出登录」并在 Modal 中点击「确认」
- **THEN** 跳转至登录页

### Requirement: 主题（明 / 暗）切换
系统 SHALL 提供主题切换入口（控制台顶部或侧边栏底部），切换 `<html>` 的 `class="dark"` 与 `data-theme`，并把偏好写入 `localStorage`；首次访问跟随 `prefers-color-scheme`。切换时所有使用语义令牌的元素自动重新着色，无需重新加载。

#### Scenario: 切换至亮色主题
- **WHEN** 用户在暗色主题下点击主题切换按钮
- **THEN** `<html>` 移除 `dark` 类，页面整体切换为亮色配色，主题按钮图标更新为「月亮」

### Requirement: Toast 通用提示组件
系统 SHALL 提供统一的 Toast 组件，支持 `success` / `error` / `info` 三种语义，自动堆叠、3 秒后自动消失、可手动关闭。Toast 颜色基于 `--state-success` / `--state-error` / `--brand-500`，位置固定在视口右上角（移动端贴顶居中）。

#### Scenario: 多条 Toast 堆叠
- **WHEN** 短时间内连续触发 3 条 Toast
- **THEN** 三条 Toast 自上而下堆叠显示，互不遮挡

### Requirement: Modal 通用对话框组件
系统 SHALL 提供统一的 Modal 组件：标题 + 正文 + 取消 / 确认按钮，支持遮罩点击关闭、Esc 关闭、焦点陷阱（基础版可省略焦点陷阱，但需保证 Tab 不离开 Modal）。

#### Scenario: Esc 关闭 Modal
- **WHEN** Modal 打开时用户按下 Esc
- **THEN** Modal 关闭且不触发确认回调

### Requirement: 多端断点适配
系统 SHALL 在三档断点下保证可用与美观：

| 断点 | 范围 | 关键适配 |
| --- | --- | --- |
| Mobile | `< 640px` | 单列栅格、字号缩小 1 档、表格横向滚动、侧边栏抽屉、底部安全区 `env(safe-area-inset-bottom)` |
| Tablet | `640–1023px` | 两列栅格、统计卡片 2 列、侧边栏抽屉 |
| Desktop | `≥ 1024px` | 固定侧边栏、两列及以上栅格、统计卡片 3 列 |

#### Scenario: 移动端查看处理记录表格
- **WHEN** 在 iPhone 宽度（375px）下查看「运行状态」表格
- **THEN** 表格在卡片内出现横向滚动条，列宽不被压缩，首列（频道）不丢失

#### Scenario: 移动端频道卡片栅格降列
- **WHEN** 在移动端查看频道卡片配置栅格
- **THEN** 栅格降为单列，标签与控件垂直排列

### Requirement: 触控热区与可访问性
系统 SHALL 保证移动端所有可点击元素（按钮、图标按钮、开关、导航项）最小触控热区 `44×44px`；为图标按钮补充 `aria-label`；为表单字段补充 `label` 关联（`for` / `id` 或包裹关系）。

#### Scenario: 移动端删除按钮热区
- **WHEN** 在移动端点击队列项的删除按钮
- **THEN** 命中区域至少 44×44px（可通过 padding 扩展，不影响视觉尺寸）

## MODIFIED Requirements
（无 — 本 spec 为新增需求，不修改既有 spec 中的既有 requirement。）

## REMOVED Requirements
（无。）
