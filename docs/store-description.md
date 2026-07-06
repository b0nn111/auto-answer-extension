# Store Listing Information

## Short Description

自动识别网页题目并辅助答题，支持本地题库、本地资料库、本地 AI、免费搜题和自配 AI API。

## Long Description

**自动答题助手 (Auto Answer Helper)** 是一款 Chrome / Edge 浏览器扩展，用于识别网页上的题目，并根据本地题库、用户资料库、本地 AI、免费搜题接口和用户配置的 AI API 辅助给出答案。当前主要在 XJTLU Moodle Quiz 页面测试通过。

### 核心功能

- **自动检测题目**：扫描页面 DOM，识别选择题、填空题和简答题。
- **Moodle / XJTLU 专用解析**：从 `.qtext` 提取题干，从 `.answer` 选项行提取选项，减少题干和选项错位。
- **本地题库优先**：题目与答案缓存到浏览器 IndexedDB，重复题目可直接命中。
- **本地资料库辅助**：用户可以创建课程文件夹，上传讲义、作业和笔记，并启用整个文件夹或单个文件作为 AI 判断依据。
- **免费搜题接口（可选）**：用户开启后，可调用公开搜题接口查询题目，默认关闭。
- **多种 AI 后端**：支持本地 AI（Ollama、LM Studio、OpenAI 兼容本地服务）和用户自配 AI API。
- **透明数据来源**：设置页展示每类数据来源，以及哪些情况会联网。

### 答题来源顺序

本地题库 -> 本地资料库检索 -> 免费搜题接口（默认关闭）-> 本地 AI -> AI API

### 隐私说明

- 本地题库和用户上传资料保存在浏览器本地 IndexedDB。
- 免费搜题接口默认关闭，开启后题目文本会发送到配置的公开接口。
- AI API 仅在用户主动配置 API Key 后调用。
- 如果启用云端 AI API，题目文本和命中的资料片段可能会发送到用户配置的 API。
- 不使用第三方分析或跟踪服务。

### 技术支持

- 支持 Chrome 和 Edge 浏览器。
- 当前版本：1.2.0
- 测试环境：XJTLU Moodle Quiz 页面。
- 如有问题或改进建议，请加 QQ：3923636786。

## Category

Productivity / Education

## Screenshot Suggestions

1. Extension popup with diagnostic panel
2. Settings page showing material folders and AI configuration
3. Question detection on a quiz page with auto-annotated answers
4. Floating panel on a quiz page
5. Local question bank and material library statistics

## Supported Locales

zh-CN, en
