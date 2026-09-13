#!/usr/bin/env bash
# 生成演示用 HLS 多清晰度视频流（写入 public/demo/hls）
#
# 说明：Mock 数据里的视频地址统一指向 /demo/hls/master.m3u8，
# 该脚本用 FFmpeg 合成一段带时间码的测试片源并转成 360P/540P/720P 三档 fMP4 分片，
# 便于在无真实后端时验证播放器（清晰度切换、进度条、记忆播放、画中画、全屏）。
#
# 依赖：ffmpeg（带 libx264 / aac）。用法：pnpm demo:hls
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/public/demo/hls"
DURATION="${DURATION:-15}"
FPS="${FPS:-25}"

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.m3u8 "$OUT_DIR"/*.mp4 "$OUT_DIR"/*.m4s

echo "==> 生成测试片源（${DURATION}s / ${FPS}fps）"
for q in 360 540 720; do
  h=$q
  w=$(( q * 16 / 9 / 2 * 2 ))
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=#14161c:s=${w}x${h}:r=${FPS}:d=${DURATION}" \
    -f lavfi -i "sine=frequency=320:duration=${DURATION}" \
    -filter_complex "[0:v]drawbox=x=0:y=0:w=iw:h=ih:color=#2b5aed@0.10:t=fill,\
drawgrid=w=80:h=80:t=1:c=#ffffff@0.06,\
drawtext=text='%{pts\\:hms}':fontsize=${h}*0.16:fontcolor=#ff4d4f:x=(w-text_w)/2:y=(h-text_h)/2-${h}*0.08:font='DejaVu Sans Mono',\
drawtext=text='GUANGYING DEMO':fontsize=${h}*0.045:fontcolor=#ffffff@0.75:x=(w-text_w)/2:y=(h-text_h)/2+${h}*0.10:font='DejaVu Sans'[v]" \
    -map "[v]" -map 1:a \
    -c:v libx264 -preset veryfast -crf 32 -pix_fmt yuv420p \
    -g $(( FPS * 2 )) -keyint_min $(( FPS * 2 )) -sc_threshold 0 \
    -c:a aac -b:a 48k \
    -f hls -hls_time 3 -hls_playlist_type vod -hls_segment_type fmp4 \
    -hls_fmp4_init_filename "init_${q}.mp4" \
    -hls_segment_filename "$OUT_DIR/seg_${q}_%03d.m4s" \
    "$OUT_DIR/v${q}.m3u8"
  echo "    - ${q}P (${w}x${h}) 完成"
done

# 校验产物完整：若分片缺失说明 ffmpeg 参数有误，立即失败而不是留下不可播放的流
segment_count=$(find "$OUT_DIR" -name 'seg_*.m4s' | wc -l | tr -d ' ')
if [ "$segment_count" -eq 0 ]; then
  echo "!! 未生成任何分片，请检查 ffmpeg 版本与参数（segment 目录：$OUT_DIR）" >&2
  exit 1
fi

cat > "$OUT_DIR/master.m3u8" <<'EOF'
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-INDEPENDENT-SEGMENTS

#EXT-X-STREAM-INF:BANDWIDTH=420000,AVERAGE-BANDWIDTH=380000,RESOLUTION=640x360,FRAME-RATE=25.000,CODECS="avc1.64001e,mp4a.40.2",NAME="360p"
v360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=760000,AVERAGE-BANDWIDTH=680000,RESOLUTION=960x540,FRAME-RATE=25.000,CODECS="avc1.64001f,mp4a.40.2",NAME="540p"
v540.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1150000,AVERAGE-BANDWIDTH=1020000,RESOLUTION=1280x720,FRAME-RATE=25.000,CODECS="avc1.640020,mp4a.40.2",NAME="720p"
v720.m3u8
EOF

echo "==> 已生成 $OUT_DIR/master.m3u8（三档清晰度，共 ${segment_count} 个分片）"
