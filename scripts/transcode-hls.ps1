# 用 ffmpeg 容器把视频源文件转成多码率 HLS（360p/540p/720p，不超过源分辨率）。
#
# 为什么需要它：项目没有转码能力（宿主机无 ffmpeg，UploadService 的「转码」只是模拟推进度），
# 因此除随包的演示素材外，视频都只有单一码流，播放器的清晰度菜单无档可切。
# 本脚本用 Docker 拉取 debian-slim 并安装 ffmpeg（走国内可用源），产出真正的多码率 HLS。
#
# 用法：
#   powershell -File scripts\transcode-hls.ps1                 # 转所有已发布视频
#   powershell -File scripts\transcode-hls.ps1 -VideoIds 5,7   # 只转指定视频
#   powershell -File scripts\transcode-hls.ps1 -Force          # 已转过的也重转
#
# 产物：data/hls/<videoId>/master.m3u8 及分片，由 TranscodeHlsController 对外提供。

param(
    # 逗号分隔的视频 id；用字符串接收，因为 powershell -File 不会把 "5,6,7" 拆成数组
    [string]$VideoIds = "",
    [switch]$Force,
    [string]$BackendBase = "http://localhost:8080",
    [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) { $OutputRoot = Join-Path $repoRoot "data\hls" }

# ffmpeg 镜像：debian-slim + apt 安装（daocloud 源可直连）
$baseImage = "docker.m.daocloud.io/library/debian:bookworm-slim"
$ffmpegImage = "videoshare-ffmpeg:local"

function Write-Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }

Write-Step "准备 ffmpeg 镜像"
$hasImage = (docker images -q $ffmpegImage) 2>$null
if (-not $hasImage) {
    Write-Host "构建 $ffmpegImage（首次较慢，需 apt 安装 ffmpeg）"
    $dockerfile = @"
FROM $baseImage
RUN apt-get update -qq && apt-get install -y -qq ffmpeg && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["ffmpeg"]
"@
    $tmp = Join-Path $env:TEMP "videoshare-ffmpeg"
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    Set-Content -Path (Join-Path $tmp "Dockerfile") -Value $dockerfile -Encoding ASCII
    docker build -t $ffmpegImage $tmp | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg 镜像构建失败" }
}
Write-Host "镜像就绪：$ffmpegImage"

# 取视频清单（标题/类型只需 id 与源文件可用性）
Write-Step "确定待转码视频"
$ids = @()
if ($VideoIds.Trim()) {
    $ids = @($VideoIds -split '[,\s]+' | Where-Object { $_ } | ForEach-Object { [int]$_ })
}
if ($ids.Count -eq 0) {
    $listJson = curl.exe -s "$BackendBase/api/v1/videos/recommend?page=1&pageSize=100" --max-time 30
    $list = $listJson | ConvertFrom-Json
    $ids = @($list.data.items | ForEach-Object { [int]$_.id })
    if ($ids.Count -eq 0) { throw "未取到视频列表（后端是否在运行？）" }
}
Write-Host "待处理: $($ids -join ', ')"

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$work = Join-Path $env:TEMP "videoshare-transcode"
New-Item -ItemType Directory -Force -Path $work | Out-Null

$done = @()
foreach ($id in $ids) {
    $target = Join-Path $OutputRoot "$id"
    if ((Test-Path (Join-Path $target "master.m3u8")) -and -not $Force) {
        Write-Host "  跳过 $id（已存在 master.m3u8，用 -Force 重转）" -ForegroundColor DarkGray
        continue
    }

    Write-Step "转码 video $id"
    $src = Join-Path $work "$id.mp4"
    Remove-Item $src -Force -ErrorAction SilentlyContinue
    # 通过后端 /source 取源文件，避免直接访问对象存储。
    #
    # 必须用 curl.exe：实测 Invoke-WebRequest 下载 53MB 的源文件时只写入约 17MB 却
    # 报告成功（静默截断），导致 ffmpeg 报 "moov atom not found"；curl 0.5s 即完整取回。
    # 因此这里还额外校验 Content-Length，遇到截断就显式失败而不是把坏文件喂给 ffmpeg。
    $headFile = Join-Path $work "$id.head"
    Remove-Item $headFile -Force -ErrorAction SilentlyContinue
    curl.exe -s -D $headFile -o NUL "$BackendBase/api/v1/videos/$id/source" --max-time 60 | Out-Null
    $expected = 0
    if (Test-Path $headFile) {
        foreach ($line in (Get-Content $headFile -Encoding ASCII)) {
            $text = [string]$line
            if ($text -match '^(?i)content-length:\s*(\d+)') { $expected = [int64]$Matches[1] }
        }
    }
    curl.exe -s -o $src "$BackendBase/api/v1/videos/$id/source" --max-time 900
    $curlExit = $LASTEXITCODE
    if ($curlExit -ne 0 -or -not (Test-Path $src)) {
        Write-Warning "  下载失败（curl exit $curlExit），跳过 $id"
        continue
    }
    $actual = (Get-Item $src).Length
    if ($expected -gt 0 -and $actual -ne $expected) {
        Write-Warning "  下载不完整（$actual / $expected 字节），跳过 $id"
        continue
    }
    if ($actual -lt 1024) {
        Write-Warning "  源文件过小（$actual 字节），跳过 $id"
        continue
    }
    $sizeMb = [math]::Round($actual / 1MB, 2)
    Write-Host "  源文件 $sizeMb MB"

    Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $target | Out-Null

    # 三档阶梯；-var_stream_map 生成 master.m3u8；关键帧对齐（固定 GOP）以便切换
    # 用 %v 占位，输出到容器内 /out/<name>
    $args = @(
        "run", "--rm",
        "-v", "${work}:/in:ro",
        "-v", "${target}:/out",
        $ffmpegImage,
        "-hide_banner", "-loglevel", "error",
        "-i", "/in/$id.mp4",
        "-filter_complex", "[0:v]split=3[v1][v2][v3];[v1]scale=w=-2:h=360[v1out];[v2]scale=w=-2:h=540[v2out];[v3]scale=w=-2:h=720[v3out]",
        "-map", "[v1out]", "-map", "0:a?", "-map", "[v2out]", "-map", "0:a?", "-map", "[v3out]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main",
        "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
        "-b:v:0", "800k", "-maxrate:v:0", "900k", "-bufsize:v:0", "1600k",
        "-b:v:1", "1400k", "-maxrate:v:1", "1600k", "-bufsize:v:1", "2800k",
        "-b:v:2", "2800k", "-maxrate:v:2", "3200k", "-bufsize:v:2", "5600k",
        "-c:a", "aac", "-b:a", "96k", "-ac", "2",
        "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
        "-hls_segment_type", "fmp4",
        "-hls_flags", "independent_segments",
        "-hls_segment_filename", "/out/v%v/seg_%03d.m4s",
        "-master_pl_name", "master.m3u8",
        "-var_stream_map", "v:0,a:0,name:360p v:1,a:1,name:540p v:2,a:2,name:720p",
        "/out/v%v/index.m3u8"
    )
    foreach ($variant in @("v0", "v1", "v2")) {
        New-Item -ItemType Directory -Force -Path (Join-Path $target $variant) | Out-Null
    }
    & docker @args
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "  ffmpeg 失败（exit $LASTEXITCODE），跳过 $id"
        continue
    }
    if (-not (Test-Path (Join-Path $target "master.m3u8"))) {
        Write-Warning "  未生成 master.m3u8，跳过 $id"
        continue
    }
    $files = (Get-ChildItem -Recurse -File $target | Measure-Object).Count
    Write-Host "  完成：$files 个文件" -ForegroundColor Green
    $done += $id
}

Write-Step "结果"
Write-Host "已转码: $(if ($done.Count) { $done -join ', ' } else { '(无)' })"
Write-Host "输出目录: $OutputRoot"
Write-Host "提示: 重启后端后，TranscodeHlsController 会对外提供 /api/v1/videos/<id>/hls/master.m3u8"
