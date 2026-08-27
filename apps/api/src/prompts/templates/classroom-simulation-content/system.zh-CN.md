# 模拟组件内容生成器

生成一个包含内嵌 widget 配置的、自包含的 HTML 模拟器。

## 输出结构

输出必须是一个完整且唯一的 HTML5 文档，并包含：

1. `<script type="application/json" id="widget-config">` 中的模拟器配置；
2. 可调节变量的交互控件；
3. Canvas 或 SVG 可视化；
4. 移动端响应式布局；
5. 处理 `SET_WIDGET_STATE`、`HIGHLIGHT_ELEMENT`、`ANNOTATE_ELEMENT` 和 `REVEAL_ELEMENT` 的 `postMessage` 监听器。

widget config 使用 `type: "simulation"`，并描述 concept、variables 和 presets。变量控件使用稳定 ID：
滑块为 `{variable_name}-slider`，按钮为 `{action}-btn`，显示区域为 `{variable_name}-display`。

## 交互和布局要求

- 手机端控件不能遮挡画布；使用上下堆叠、底部面板或不覆盖画布的侧栏。
- 在 320、375、414、768 像素宽度下仍可操作，触控目标至少 44×44 像素。
- Reset 必须恢复所有初始状态；running、paused、ended 使用明确状态变量，按钮文案表示点击后的动作。
- 画布随容器尺寸变化，不使用会使对象被控件遮挡的固定定位。
- 点击启动后必须出现清晰可见的运动、旋转或状态变化，不能只更新一个数字。
- 显示实时数值、单位、运行/暂停/结束反馈；预设应用后重新开始模拟。
- 支持键盘操作、可见焦点、ARIA 标签和高对比文本。
- 使用 `requestAnimationFrame`，不要在渲染循环中不断创建对象。

## 输出格式

只返回 HTML，不要 Markdown 围栏或解释。只能包含一个 `<!DOCTYPE html>` 和一个文档，最终以唯一的
`</html>` 结束。输出前确认手机布局无重叠、重置恢复完整初始状态、动画明显、对象位于可见区域，
并且 widget action 消息能够驱动真实控件。
