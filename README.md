# 自动答题助手 (Auto Answer Helper)

Chrome / Edge 浏览器扩展，用于在网页题目页面中识别题干和选项，比较已启用来源的候选答案并优先展示置信度最高的结果。当前主要在 XJTLU Moodle Quiz 页面测试通过。

当前版本：1.2.0

## 工作链路

```text
网页题目
  -> 读取手动导入的本地题库 (IndexedDB)
  -> 检索用户启用的资料文件夹 / 文件，为 AI 提供参考上下文
  -> 收集免费搜题接口（可选）、本地 AI 和 AI API 的候选答案
  -> 按选项匹配度与置信度排序并展示来源
```

## 1.2.0 本地资料库

资料库按用户创建的文件夹组织，例如：

```text
微积分
  - lecture-week1.md
  - homework-notes.txt

线性代数
  - matrix-review.md
  - assignment.csv
```

用户可以：

- 创建资料文件夹。
- 上传文件到指定文件夹。
- 启用或禁用整个文件夹。
- 单独启用或禁用文件夹里的某个文件。
- 答题时只检索已启用的文件夹和文件。

1.2.0 支持纯文本类文件，包括 `.txt`、`.md`、`.json`、`.csv`、`.html`、`.xml`、常见代码文件等。PDF / Word 解析计划放到后续版本。

## 数据来源

| 来源 | 默认状态 | 数据位置 | 说明 |
| --- | --- | --- | --- |
| 本地题库 | 手动导入 | 浏览器 IndexedDB | 仅保存用户在设置页主动导入的题目和答案 |
| 本地资料库 | 用户配置 | 浏览器 IndexedDB | 用户上传资料只保存在本地，用于检索辅助 AI 判断 |
| 免费搜题接口 | 关闭 | 第三方公开接口 | 开启后会把题目文本发送到配置的公开接口查询 |
| 本地 AI | 按配置启用 | 本机或用户配置地址 | 可用于 Ollama / LM Studio 等本地模型 |
| AI API | 按配置启用 | 用户填写的 API 服务 | 仅在用户填写 API Key 后调用 |

默认免费搜题接口：

```text
https://study.jszkk.com/api/open/seek
```

公开题库来源由第三方提供，答案可能不完整或不准确，请把结果作为辅助参考。

## 题目识别

Moodle / XJTLU Quiz 页面会优先使用专用解析逻辑：

- 以 Moodle 的 `.que` 作为题目容器。
- 题干从 `.qtext` 提取。
- 选项从 `.answer` 下的选项行提取。
- 过滤 Quiz navigation、Time left、聊天弹窗等非题目内容。
- 答案标记贴到匹配的具体选项行后面。

发送给本地题库、资料库、免费搜题或 AI 的选择题格式类似：

```text
What is the capital of France?
A. London
B. Paris
C. Berlin
D. Madrid
```

## 安装

### Chrome

1. 打开 `chrome://extensions`
2. 开启右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本项目根目录

### Edge

1. 打开 `edge://extensions`
2. 开启左下角“开发人员模式”
3. 点击“加载解压缩的扩展”
4. 选择本项目根目录

## 配置

### 本地资料库

在设置页创建文件夹并上传资料。启用的资料会在答题时被检索，命中的片段会作为上下文交给本地 AI 或 AI API。

### 本地 AI

可使用 Ollama、LM Studio 或其他 OpenAI 兼容本地服务。

LM Studio 示例地址：

```text
http://127.0.0.1:1234/v1
```

### AI API

支持 DeepSeek、通义千问、SiliconFlow、Kimi 等 OpenAI 兼容 API。API Key 只保存在浏览器扩展存储中。

## 隐私

- 本地题库和本地资料库仅存储在浏览器 IndexedDB 中。
- 免费搜题接口默认关闭，开启后题目文本会发送到配置的公开接口。
- AI API 仅在用户配置 API Key 后调用。
- 如果使用云端 AI API，题目文本和命中的资料片段会发送到用户配置的 API。
- 不使用第三方分析或跟踪服务。
- 详见 [隐私政策](docs/privacy-policy.md)。

## 已知限制

- 当前主要测试环境为 XJTLU Moodle Quiz 页面。
- PDF / Word 文件暂未在 1.2.0 中解析。
- 免费搜题接口、AI 模型和资料库检索都可能返回错误答案，请自行核对。
- 其他做题平台可能需要调整题目检测逻辑。

## 反馈与改进

如果有任何问题以及改进建议，请加 QQ：3923636786。
