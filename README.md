# 🤖 自动答题助手 (Auto Answer Helper)

> **Beta 版本** | 已在 XJTLU Moodle 答题页面测试通过

浏览器扩展（Chrome + Edge），自动检测网页上的题目，优先从本地题库命中答案，未命中则依次尝试本地 AI 或云端 AI API。

## 架构

```
网页 → Content Script (检测题目)
         → 本地题库 (IndexedDB) 命中?  → 直接显示 ✅
         → Ollama / LM Studio 本地推理
         → AI API (DeepSeek / 通义千问 / 自定义)
         → 存入题库，下次秒出
```

## 安装

### 1. 加载扩展

**Chrome：**
1. 打开 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目根目录

**Edge：**
1. 打开 `edge://extensions`
2. 开启左下角「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择本项目根目录

### 2. 配置 AI 后端（至少选一个）

**选项 A：Ollama（本地，免费）**
```bash
ollama pull qwen2.5:7b
```

**选项 B：LM Studio**
1. 加载模型 → Start Server（默认端口 1234）
2. 扩展设置：地址 `http://127.0.0.1:1234/v1`

**选项 C：DeepSeek API**
1. 注册 [platform.deepseek.com](https://platform.deepseek.com)
2. 创建 API Key，填入扩展设置

## 使用

1. 打开任意做题网站
2. 点击扩展图标 → 打开「答题模式」
3. 自动检测题目 → 题库命中 → 直接标注 ✅
4. 未命中 → 依次尝试本地 AI / 云端 API → 自动标注

## 功能

| 功能 | 说明 |
|------|------|
| 自动检测 | 扫描页面 DOM，识别选择题/填空题/简答题 |
| 本地题库 | 自动缓存 Q&A，越用越快（上限 10000 条） |
| 多 AI 后端 | 本地 AI（Ollama / LM Studio）+ 云端 API |
| 自检诊断 | 一键检测所有 AI 连接状态 |
| 题库导入 | 支持 JSON 格式批量导入已有题库 |

## 项目结构

```
auto-answer-extension/
├── manifest.json          # Chrome/Edge Manifest V3
├── docs/                  # 商店发布文档
│   ├── privacy-policy.md
│   └── store-description.md
├── src/
│   ├── background/        # Service Worker (推理调度)
│   ├── content/           # Content Script (检测+标注)
│   ├── lib/               # 工具库 (DB、AI 通信、匹配算法)
│   ├── options/           # 设置页面
│   └── popup/             # 扩展弹出菜单
├── icons/                 # 扩展图标 (16/32/48/128)
└── README.md
```

## 隐私

- 所有题目数据仅存储在本地浏览器 IndexedDB 中
- AI API 调用仅在用户配置 API Key 后进行
- 不使用第三方分析或跟踪
- 详见 [隐私政策](docs/privacy-policy.md)

## 已知限制

- Beta 版本，主要测试环境为 XJTLU Moodle Quiz 页面
- 其他做题平台可能需要调整题目检测逻辑

## 反馈与改进

如果有任何问题以及改进请加 QQ：3923636786
