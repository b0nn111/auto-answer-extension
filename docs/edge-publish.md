# Edge Add-ons API 发布流程

本项目使用 Microsoft Edge Add-ons Update REST API 发布已存在扩展的新版本。

## 凭据

不要把 API Key 写入仓库。发布前在 PowerShell 里设置环境变量：

```powershell
$env:EDGE_CLIENT_ID = "你的 Client ID"
$env:EDGE_API_KEY = "你的 API Key"
$env:EDGE_PRODUCT_ID = "你的 Product ID"
```

如果当前网络需要走本地代理，可以临时加：

```powershell
$env:EDGE_PROXY = "http://127.0.0.1:9910"
```

`Product ID` 来自 Edge Partner Center 里这个扩展的产品详情页。Edge Add-ons API 只能更新已经在 Partner Center 创建过的产品，不能创建一个全新的扩展产品。

## 上传并提交发布

在项目根目录运行：

```powershell
.\scripts\publish-edge.ps1
```

脚本会执行：

1. 读取 `manifest.json` 的版本号。
2. 重新生成 `releases/auto-answer-extension-v<version>.zip`。
3. 上传 zip 到 Edge Add-ons draft package。
4. 轮询上传校验状态。
5. 提交 draft submission 发布。
6. 轮询发布状态。

只上传包、不提交发布：

```powershell
.\scripts\publish-edge.ps1 -UploadOnly
```

只重新打包、不调用 Edge API：

```powershell
.\scripts\publish-edge.ps1 -PackageOnly
```

使用已经存在的 zip，不重新打包：

```powershell
.\scripts\publish-edge.ps1 -SkipPackage -PackagePath ".\releases\auto-answer-extension-v1.2.0.zip"
```

自定义认证说明：

```powershell
.\scripts\publish-edge.ps1 -PublishNotes "Version 1.2.0 adds local material folders and file-level enablement."
```

## 失败处理

- `401`：检查 `EDGE_CLIENT_ID` 和 `EDGE_API_KEY`，API Key 可能过期。
- `404`：检查 `EDGE_PRODUCT_ID` 是否属于当前 Partner Center 账号。
- `400`：通常是 zip 包或 `Content-Type` 不对，先重新运行脚本打包。
- `InProgressSubmission`：已有提交正在审核，等审核结束后再发布。
- 网络失败：先连接迷雾通，确认连接成功后设置 `EDGE_PROXY`，再运行脚本。

## 官方文档

- https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api
- https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/addons-api-reference
