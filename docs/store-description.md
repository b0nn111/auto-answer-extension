# Store Listing Information

## Short Description (100 chars max)

自动检测网页题目并辅助答题，支持本地题库、可选免费搜题接口、本地 AI 和用户自配 AI API。

## Long Description

**自动答题助手 (Auto Answer Helper)** 是一款浏览器扩展，用于自动识别网页上的题目，并按用户配置的数据来源辅助给出答案。当前已在 XJTLU 学习管理系统 (Moodle) 的 Quiz 答题页面测试通过。

### 核心功能

- **自动检测题目**：打开做题页面后，扩展可识别选择题、填空题和简答题。
- **Moodle 专用解析**：在 Moodle / XJTLU Quiz 页面中，优先从 `.qtext` 提取题干，从 `.answer` 选项行提取选项，减少题干和选项错位。
- **本地题库优先**：题目与答案缓存到浏览器本地 IndexedDB，重复题目可直接命中。
- **免费搜题接口（可选）**：用户开启后，可调用公开搜题接口查询题目，默认关闭。
- **多种 AI 后端**：支持本地 AI（Ollama、LM Studio、OpenAI 兼容本地服务）和用户自配 AI API。
- **公开透明的数据来源**：设置页展示每类数据来源，以及是否会联网。

### 答题来源顺序

本地题库 -> 免费搜题接口（默认关闭）-> 本地 AI -> AI API

### 隐私说明

- 本地题库保存在用户浏览器本地。
- 免费搜题接口默认关闭，开启后题目文本会发送到配置的公开接口。
- AI API 仅在用户主动配置 API Key 后调用。
- 不使用第三方分析或跟踪服务。

### 技术支持

- 支持 Chrome 和 Edge 浏览器。
- 当前版本：1.1.1
- 测试环境：XJTLU Moodle Quiz 页面。
- 如果有任何问题以及改进建议，请加 QQ：3923636786。

## Category

Productivity / Education

## Screenshot Suggestions

1. Extension popup with diagnostic panel
2. Settings page showing free search source and AI configuration
3. Question detection on a quiz page with auto-annotated answers
4. Floating panel on a quiz page
5. Local question bank statistics

## Supported Locales

zh-CN (中文), en (English)
