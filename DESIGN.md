---
name: DSH Long Context Web
description: 继承 DSH 宿主视觉系统的长文操作面板
colors:
  label-primary: "var(--dsw-alias-label-primary)"
  label-secondary: "var(--dsw-alias-label-secondary)"
  border-l2: "var(--dsw-alias-border-l2)"
  bg-module-platform: "var(--dsw-alias-bg-module-platform)"
  bg-overlay: "var(--dsw-alias-bg-overlay)"
  state-error-primary: "var(--dsw-alias-state-error-primary)"
  bg-layer-2: "var(--dsw-alias-bg-layer-2)"
  bg-layer-3: "var(--dsw-alias-bg-layer-3)"
  border-l3: "var(--dsw-alias-border-l3)"
  interactive-bg-hover: "var(--dsw-alias-interactive-bg-hover)"
  interactive-bg-active: "var(--dsw-alias-interactive-bg-active)"
typography:
  body:
    fontFamily: "system-ui"
    fontSize: "14px"
    lineHeight: 1.6
  metadata:
    fontFamily: "system-ui"
    fontSize: "12px"
    lineHeight: 1.6
  task-title:
    fontFamily: "system-ui"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.6
  result-code:
    fontFamily: "ui-monospace, monospace"
    fontSize: "12px"
    lineHeight: 1.7
  modal-title:
    fontSize: "16px"
    fontWeight: 500
    lineHeight: "24px"
  control:
    fontSize: "14px"
    lineHeight: "22px"
  compact-control:
    fontSize: "12px"
    lineHeight: "18px"
  tab:
    fontSize: "14px"
    lineHeight: "20px"
rounded:
  field: "8px"
  native-sm: "var(--dsw-radius-sm)"
  native-md: "var(--dsw-radius-md)"
  native-lg: "var(--dsw-radius-lg)"
  native-panel: "var(--dsw-radius-panel)"
spacing:
  field-gap: "6px"
  action-gap: "8px"
  paragraph: "12px"
  form-gap: "16px"
  section-gap: "20px"
  modal-inset: "24px"
components:
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.label-primary}"
    typography: "{typography.control}"
    rounded: "{rounded.native-md}"
    padding: "0 14px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.interactive-bg-hover}"
  button-ghost-active:
    backgroundColor: "{colors.interactive-bg-active}"
  button-ghost-sm:
    backgroundColor: "transparent"
    textColor: "{colors.label-primary}"
    typography: "{typography.compact-control}"
    rounded: "{rounded.native-sm}"
    padding: "0 10px"
    height: "28px"
  field:
    backgroundColor: "{colors.bg-module-platform}"
    textColor: "{colors.label-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
    width: "100%"
  segmented-tabs:
    backgroundColor: "{colors.bg-module-platform}"
    rounded: "{rounded.native-lg}"
    padding: "4px"
  tab:
    textColor: "{colors.label-secondary}"
    typography: "{typography.tab}"
    rounded: "{rounded.native-md}"
    height: "34px"
    padding: "0 12px"
  task-row:
    textColor: "{colors.label-primary}"
    typography: "{typography.body}"
    padding: "16px 0"
  result:
    backgroundColor: "{colors.bg-module-platform}"
    typography: "{typography.result-code}"
    padding: "12px"
  modal:
    backgroundColor: "{colors.bg-layer-2}"
    rounded: "{rounded.native-panel}"
    padding: "0 0 24px"
---

# Design System: DSH Long Context Web

## Overview

**Creative North Star: "继承原生 DSH 操作面板"**

这是现有 DSH Web 的局部扩展，不是一个新视觉世界。视觉权威来自宿主主题及 `@deepseek-ai/dsh-client-ui-primitives` 的 Modal、Button、SegmentedTabs；本文件记录已实现的继承关系与局部布局，不替宿主重新定义颜色、字体或控件。

系统以紧凑、清晰的正文和操作信息为主。表单与任务按内容自然堆叠，状态、问题与操作结果保持可读；科学文档的原稿保护与实验能力说明作为操作信息呈现。

**Key Characteristics:**

- 宿主主题变量随用户主题变化。
- 原生控件承担对话框、按钮和流程导航。
- 系统正文、次级元数据与等宽结果构成局部信息层级。
- 表单单列堆叠，任务以细分隔线区分，窄屏换行并独立滚动。

记录依据为 `client/index.js`、已安装原生组件的 Button / Modal / SegmentedTabs 样式与实现、方向合约及已完成的 finish review。该记录的适用范围是 Long Context 面板；不是对整个 DSH 的设计系统重写。

## Colors

颜色以宿主语义角色而非固定色相定义。前置 token 保留原生 CSS 变量；截图中的浅色值不构成新主题，也不用于合成色阶。

### Primary

- **主要文字**：`label-primary` 用于正文、字段、任务标题、按钮文字和局部焦点轮廓；这里的 primary 是文字语义，不代表品牌强调色。
- **错误文字**：`state-error-primary` 仅用于错误反馈，与 `role="alert"` 同时出现。

### Neutral

- **次级文字**：`label-secondary` 用于版本、文件元数据、计数、限制说明和未选中流程标签。
- **模块底面**：`bg-module-platform` 用于输入、结果块和原生流程导航底面。
- **内容分隔**：`border-l2` 用于字段边框、任务分隔线与滚动条；`bg-overlay` 用于正文选择背景。
- **原生层面**：Modal 继承 `bg-layer-2`；标签选中指示器继承 `bg-layer-3` 和 `border-l3`；按钮交互继承 `interactive-bg-hover` / `interactive-bg-active`。

**The Host Theme Rule.** 保留语义变量绑定；新增局部内容继续使用宿主角色，不以截图取色覆盖用户主题。

## Typography

**Body Font:** 系统正文。**Label/Mono Font:** 元数据沿用正文；操作结果使用系统等宽字体。原生 Modal 标题、Button、SegmentedTabs 继承宿主字体，局部样式只记录其实际字号与行高，没有独立展示字体。

### Hierarchy

- **Modal title**：原生标题角色，区分工作台与其内部正文。
- **Body**：字段标签、说明、状态与任务内容的基本角色。
- **Task title**：与正文同级字号，使用中等加重区分任务目标。
- **Metadata**：版本、限制、文件属性与计数的次级角色；计数使用等宽数字。
- **Result code**：保留操作返回数据的换行和等宽对齐，不扩大为展示排版。
- **Control / Compact control / Tab**：继承原生按钮和标签角色；选中标签加重，未选中标签使用次级文字。

## Layout

面板保留原生 Modal 居中容器及其边距约束。扩展的声明宽度为 `min(880px, calc(100vw - 32px))`，并受宿主容器可用空间限制；不能将这个声明理解为实际渲染宽度保证。Modal 内容继承两侧内边距，面板正文以 `max-height:70vh; overflow:auto` 独立滚动。

表单采用单列网格：字段标签与控件靠近，字段之间留出更大间隔，表单与上方内容通过 section gap 分开。操作行使用 flex、action gap 和 `flex-wrap:wrap`；任务行上下留白，以底部分隔线组织连续内容。元数据和任务目标允许 `overflow-wrap:anywhere`，结果块保留换行并允许长字符串折行。

在 `max-width:560px` 时，声明宽度改为 `calc(100vw - 16px)`，正文高度上限为 `68vh`，操作行的直接按钮用 `flex:1` 分摊空间。宿主 Modal 边距仍参与最终布局；流程标签继续使用原生等宽网格。结果块另有 `240px` 的高度上限和内部滚动。

沿用堆叠表单、可换行操作与细线任务列表；长路径、目标和结果不以裁切隐藏。

## Elevation & Depth

扩展自身没有新增阴影。主要深度来自原生 Modal：宿主层面、遮罩、模糊与 prominent elevation；选中流程标签通过原生底面和细边框形成层次。遮罩与阴影的具体值仍由宿主主题提供，不固化为局部规则。

操作结果只在系统允许动画时采用短暂透明度进入效果；Modal 与流程标签保留其原生动画和减弱动态处理。具体 motion 引用放在 sidecar 中。

## Shapes

字段使用局部 field 圆角与细边框。Button、流程标签及 Modal 的圆角均引用原生 radius 变量；不把当前主题的具体圆角值复制为另一套尺度。任务列表保持无额外容器背景的分隔线结构，结果块以模块底面承载正文。

## Components

### Buttons

工作台入口使用原生 small ghost Button；正文操作采用原生默认 medium ghost Button，没有另造主要按钮配色。悬停和按下由宿主交互背景表示；禁用继承原生 opacity 与不可用光标。正文普通操作按钮的键盘焦点使用主要文字色轮廓；入口的焦点行为继续由宿主决定。

### Inputs / Fields

输入、选择和多行文本采用相同的全宽字段语言：模块底面、主要文字与 caret、细边框、正文排版。标签通过 `htmlFor` / `id` 关联控件。多行输入最小高度为 `110px` 并允许垂直调整；键盘焦点轮廓为 `2px`，外偏移为 `2px`。忙碌或不可操作时使用原生 disabled 语义，没有额外局部禁用主题。

### Navigation

使用原生 SegmentedTabs，五个流程等宽排列，选中项有滑动指示器并加重；未选中项为次级文字，悬停转为主要文字。原生焦点以文字下划线显示，使用 Left / Right / Home / End 切换并移动焦点。每个标签与对应 tabpanel 保持 ID 关联。Sidecar 展示静态选中状态；实际选择与键盘交互继续由原生组件实现。

### Tasks / Containers

任务目标、状态计数、问题和动作在同一分隔行内连续呈现。计数使用 `tabular-nums`；长目标自然换行。任务列表不增加卡片背景、独立阴影或无依据的状态色。

### Modal / Results / Feedback

工作台依靠原生 Modal 的焦点管理、标题、关闭标签与遮罩。加载与忙碌信息采用正文和 `role="status"`；错误使用错误 token 与 alert。结果采用可换行、可滚动的等宽块，真实返回数据由调用方填入；文档预览的示例内容不构成运行或科学质量证据。

## Do's and Don'ts

### Do:

- **Do** 继承原生语义色、圆角、Modal、Button 与 SegmentedTabs。
- **Do** 保留字段标签、状态语义、错误反馈和键盘焦点。
- **Do** 让长路径、任务目标和结果换行，并维持面板的独立滚动。
- **Do** 用次级文字呈现操作元数据，用主要文字保持正文和动作可读。

### Don't:

- **Don't** 将浅色截图的颜色或宿主变量当前值硬编码成扩展主题。
- **Don't** 用独立展示字体、装饰材质或新增阴影替换这个局部面板的原生控件语言。
- **Don't** 把局部流程或任务列表结构推广为整个 DSH 的页面布局规则。
