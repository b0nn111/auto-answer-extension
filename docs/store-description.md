# Store Listing Information

## Short Description (100 chars max)
自动检测网页题目并自动答题，支持本地AI和云端API。Beta版本，目前XJTLU答题页面测试通过。

## Long Description

**自动答题助手 (Auto Answer Helper)** 是一款浏览器扩展，能够自动识别网页上的题目并给出答案。当前为 **Beta 版本**，已在 XJTLU 学习管理系统 (Moodle) 的答题页面上测试通过。

### 核心功能

- **自动检测题目**：打开做题页面后，扩展自动扫描并识别选择题、填空题、简答题
- **多种 AI 后端**：支持本地 AI（Ollama、LM Studio）和云端 API（DeepSeek 等 OpenAI 兼容 API）
- **智能题库**：每次答题结果自动缓存到本地，重复题目秒出答案
- **本地优先**：题库 > 本地 AI > 云端 API 的回退链，速度优先、隐私兼顾

### 使用方式

1. 安装扩展后，点击工具栏图标
2. 在弹出菜单中开启「答题模式」
3. 打开任意做题页面，扩展自动检测并标注答案
4. 在设置页配置 AI 后端（选填，不配则仅使用本地题库缓存）

### 隐私说明

- 题目数据仅存储在本地浏览器中
- 云端 AI 调用仅在用户主动配置 API Key 后进行
- 不使用第三方分析或跟踪服务

### 技术支持

- 支持 Chrome 和 Edge 浏览器
- 当前版本：1.0.1 (Beta)
- 测试环境：XJTLU Moodle Quiz 页面
- 如果有任何问题以及改进请加 QQ：3923636786

## Category
Productivity / Education

## Screenshot Suggestions

1. Extension popup with diagnostic panel
2. Question detection on a quiz page with auto-annotated answers
3. Settings page showing AI configuration
4. Floating panel on a quiz page
5. Local question bank statistics

## Supported Locales
zh-CN (中文), en (English)
