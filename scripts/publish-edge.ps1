param(
  [string] $ClientID = $env:EDGE_CLIENT_ID,
  [string] $ApiKey = $env:EDGE_API_KEY,
  [string] $ProductID = $env:EDGE_PRODUCT_ID,
  [string] $PackagePath = "",
  [string] $PublishNotes = "",
  [string] $ApiEndpoint = "https://api.addons.microsoftedge.microsoft.com",
  [string] $Proxy = $env:EDGE_PROXY,
  [int] $RetryLimit = 60,
  [int] $RetryAfterSeconds = 10,
  [switch] $PackageOnly,
  [switch] $UploadOnly,
  [switch] $SkipPackage
)

$ErrorActionPreference = "Stop"

function Assert-Value {
  param([string] $Name, [string] $Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "$Name is required. Set it as an environment variable or pass it as a parameter."
  }
}

function Get-RepoRoot {
  $scriptDir = Split-Path -Parent $PSCommandPath
  return (Resolve-Path (Join-Path $scriptDir "..")).Path
}

function Get-Manifest {
  param([string] $Root)
  $manifestPath = Join-Path $Root "manifest.json"
  if (!(Test-Path -LiteralPath $manifestPath)) {
    throw "manifest.json not found at $manifestPath"
  }
  return Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function New-ExtensionPackage {
  param([string] $Root, [string] $Version)

  $releaseDir = Join-Path $Root "releases"
  New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
  $zipPath = Join-Path $releaseDir "auto-answer-extension-v$Version.zip"
  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }

  $items = @("manifest.json", "src", "icons", "vendor", "README.md", "docs")
  $existing = foreach ($item in $items) {
    $path = Join-Path $Root $item
    if (Test-Path -LiteralPath $path) { $path }
  }
  if ($existing.Count -eq 0) {
    throw "No extension files found to package."
  }

  Compress-Archive -LiteralPath $existing -DestinationPath $zipPath -Force
  return $zipPath
}

function Get-OperationId {
  param($Response)
  $location = $Response.Headers["Location"]
  if ($location -is [array]) {
    $location = $location[0]
  }
  $location = [string] $location
  if ([string]::IsNullOrWhiteSpace($location)) {
    throw "Response did not include a Location header with an operation ID."
  }
  return ($location.Trim() -split "/")[-1]
}

function Invoke-EdgeRequest {
  param(
    [string] $Uri,
    [string] $Method,
    [hashtable] $Headers,
    [string] $InFile = "",
    [string] $Body = "",
    [string] $ContentType = ""
  )

  $args = @{
    Uri = $Uri
    Method = $Method
    Headers = $Headers
    UseBasicParsing = $true
  }
  if (![string]::IsNullOrWhiteSpace($Proxy)) {
    $args.Proxy = $Proxy
  }
  if (![string]::IsNullOrWhiteSpace($InFile)) {
    $args.InFile = $InFile
  }
  if (![string]::IsNullOrWhiteSpace($Body)) {
    $args.Body = $Body
  }
  if (![string]::IsNullOrWhiteSpace($ContentType)) {
    $args.ContentType = $ContentType
  }

  return Invoke-WebRequest @args
}

function Wait-EdgeOperation {
  param(
    [string] $Uri,
    [hashtable] $Headers,
    [string] $Label
  )

  for ($attempt = 1; $attempt -le $RetryLimit; $attempt++) {
    Start-Sleep -Seconds $RetryAfterSeconds
    $response = Invoke-EdgeRequest -Uri $Uri -Method "GET" -Headers $Headers
    $operation = $response.Content | ConvertFrom-Json
    $status = [string] $operation.status
    Write-Host "$Label status: $status ($attempt/$RetryLimit)"

    if ($status -eq "Succeeded") {
      if ($operation.message) {
        Write-Host $operation.message
      }
      return $operation
    }
    if ($status -eq "Failed") {
      $details = $operation | ConvertTo-Json -Depth 8
      throw "$Label failed: $details"
    }
  }

  throw "$Label did not finish within retry limit."
}

$root = Get-RepoRoot
$manifest = Get-Manifest -Root $root
$version = [string] $manifest.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "manifest.json does not include a version."
}

if ([string]::IsNullOrWhiteSpace($PackagePath)) {
  $PackagePath = Join-Path $root "releases\auto-answer-extension-v$version.zip"
}

if (!$SkipPackage) {
  $PackagePath = New-ExtensionPackage -Root $root -Version $version
}

if (!(Test-Path -LiteralPath $PackagePath)) {
  throw "Package not found: $PackagePath"
}

if ($PackageOnly) {
  Write-Host "Package generated: $PackagePath"
  exit 0
}

Assert-Value -Name "EDGE_CLIENT_ID" -Value $ClientID
Assert-Value -Name "EDGE_API_KEY" -Value $ApiKey
Assert-Value -Name "EDGE_PRODUCT_ID" -Value $ProductID

if ([string]::IsNullOrWhiteSpace($PublishNotes)) {
  $PublishNotes = "Auto Answer Helper $version update. Package generated from the project release script."
}

$headers = @{
  Authorization = "ApiKey $ApiKey"
  "X-ClientID" = $ClientID
}
$uploadHeaders = @{
  Authorization = "ApiKey $ApiKey"
  "X-ClientID" = $ClientID
}

Write-Host "Package: $PackagePath"
Write-Host "Version: $version"
Write-Host "Uploading package to Edge Add-ons..."

$uploadUri = "$ApiEndpoint/v1/products/$ProductID/submissions/draft/package"
$uploadResponse = Invoke-EdgeRequest -Uri $uploadUri -Method "POST" -Headers $uploadHeaders -InFile $PackagePath -ContentType "application/zip"
if ($uploadResponse.StatusCode -ne 202) {
  throw "Upload request returned HTTP $($uploadResponse.StatusCode)."
}
$uploadOperationId = Get-OperationId -Response $uploadResponse
Write-Host "Upload operation: $uploadOperationId"

$uploadStatusUri = "$ApiEndpoint/v1/products/$ProductID/submissions/draft/package/operations/$uploadOperationId"
Wait-EdgeOperation -Uri $uploadStatusUri -Headers $headers -Label "Upload" | Out-Null

if ($UploadOnly) {
  Write-Host "Upload completed. Publish step skipped because -UploadOnly was set."
  exit 0
}

Write-Host "Publishing draft submission..."
$publishUri = "$ApiEndpoint/v1/products/$ProductID/submissions"
$publishBody = @{ notes = $PublishNotes } | ConvertTo-Json -Compress
$publishResponse = Invoke-EdgeRequest -Uri $publishUri -Method "POST" -Headers $headers -Body $publishBody -ContentType "application/json; charset=utf-8"
if ($publishResponse.StatusCode -ne 202) {
  throw "Publish request returned HTTP $($publishResponse.StatusCode)."
}
$publishOperationId = Get-OperationId -Response $publishResponse
Write-Host "Publish operation: $publishOperationId"

$publishStatusUri = "$ApiEndpoint/v1/products/$ProductID/submissions/operations/$publishOperationId"
Wait-EdgeOperation -Uri $publishStatusUri -Headers $headers -Label "Publish" | Out-Null

Write-Host "Edge Add-ons submission published successfully."
