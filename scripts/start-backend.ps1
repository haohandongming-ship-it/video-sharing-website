# 本地开发启动脚本：把根目录 .env 中的密钥注入进程环境变量，再启动后端。
# Spring Boot 本身不会读取 .env 文件，所以这里显式加载（优先使用本地已有配置，缺失的密钥由
# scripts/bootstrap-env.mjs 生成）。
#
#   powershell -File scripts/start-backend.ps1                          # 默认 dev-infra
#   powershell -File scripts/start-backend.ps1 -Profile dev             # 纯 H2 + 本地目录存储
#   powershell -File scripts/start-backend.ps1 -SkipTests
#
# dev-infra 需要先起基础设施：
#   docker compose -f docker-compose.yml -f docker-compose.dev-infra.yml up -d mysql redis minio
param(
  [switch]$SkipTests,
  [int]$Port = 8080,
  [ValidateSet('dev', 'dev-infra')]
  [string]$Profile = 'dev-infra'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'

# ---- 1. JDK 21：优先使用本地已安装的 JDK，找不到时报错并给出获取方式 ----
$jdkCandidates = @(
  $env:JAVA_HOME,
  'D:\tools\jdk\jdk-21.0.12.1+1',
  'C:\Program Files\Eclipse Adoptium\jdk-21*',
  'C:\Program Files\Java\jdk-21*'
) | Where-Object { $_ }

$javaHome = $null
foreach ($candidate in $jdkCandidates) {
  $resolved = Get-Item $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($resolved -and (Test-Path (Join-Path $resolved.FullName 'bin\javac.exe'))) { $javaHome = $resolved.FullName; break }
}
if (-not $javaHome) {
  throw '未找到 JDK 21。请设置 JAVA_HOME，或从国内镜像下载：https://mirrors.tuna.tsinghua.edu.cn/Adoptium/21/jdk/x64/windows/'
}
$env:JAVA_HOME = $javaHome

# ---- 2. 把 .env 的键值注入当前进程环境 ----
if (Test-Path $envFile) {
  $loaded = 0
  foreach ($line in Get-Content $envFile) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $idx = $trimmed.IndexOf('=')
    if ($idx -lt 1) { continue }
    $name = $trimmed.Substring(0, $idx).Trim()
    $value = $trimmed.Substring($idx + 1).Trim()
    if ($value) { [Environment]::SetEnvironmentVariable($name, $value, 'Process'); $loaded++ }
  }
  Write-Host "[env] 已从 .env 载入 $loaded 个变量" -ForegroundColor DarkGray
} else {
  Write-Warning ".env 不存在，请先运行 node scripts/bootstrap-env.mjs"
}

# ---- 3. 校验 JWT 密钥（缺失时后端会拒绝启动） ----
foreach ($key in 'JWT_PRIVATE_KEY_BASE64', 'JWT_PUBLIC_KEY_BASE64') {
  if (-not [Environment]::GetEnvironmentVariable($key, 'Process')) { throw "缺少 $key，请先运行 node scripts/bootstrap-env.mjs" }
}

$env:PORT = "$Port"
$env:SPRING_PROFILES_ACTIVE = $Profile
Write-Host "[jdk] $env:JAVA_HOME" -ForegroundColor DarkGray
$profileHint = if ($Profile -eq 'dev-infra') { 'MySQL(13306) + Redis(6379) + MinIO(9000)' } else { 'H2 文件库 + 本地对象存储' }
Write-Host "[mvn] 启动 Spring Boot（profile=$Profile：$profileHint）" -ForegroundColor Cyan

Push-Location (Join-Path $root 'backend')
try {
  # 注意：PowerShell 5.1 下用 if 表达式给数组赋值会得到 $null，这里显式赋值。
  $goals = @('spring-boot:run')
  if ($SkipTests) { $goals += '-DskipTests' }
  & mvn -B -ntp @goals
} finally {
  Pop-Location
}
