package com.videoshare.video;

import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * 从 MP4 容器里读出视频轨的显示尺寸。
 *
 * <p>用于把「清晰度档位」标注成这个视频真实能达到的分辨率，而不是一律写 1080P。
 * 解析路径：{@code moov → trak → tkhd}，按 tkhd 的版本跳过固定字段后读末尾的
 * width/height（16.16 定点数），返回其中较大的那一组非零值（视频轨优先）。
 *
 * <p>只做最小实现：不解析 stsd/avcC，因此不判断编码格式，也不做深度校验。
 * 解析失败一律返回 null，由调用方退回「未知分辨率」而不是让播放失败。
 */
final class Mp4VideoInfo {

    private Mp4VideoInfo() { }

    /** 支持的最大文件读取范围：只扫 moov，通常在前部或尾部若干 MB 内。 */
    private static final int SCAN_LIMIT = 8 * 1024 * 1024;

    static Integer width(Path file) {
        int[] size = trackSize(file);
        return size == null ? null : size[0];
    }

    static Integer height(Path file) {
        int[] size = trackSize(file);
        return size == null ? null : size[1];
    }

    private static int[] trackSize(Path file) {
        if (file == null || !Files.isReadable(file)) return null;
        try (RandomAccessFile raf = new RandomAccessFile(file.toFile(), "r")) {
            long length = raf.length();
            // moov 可能在文件尾部，头部扫描不到时再扫尾部
            int[] head = scan(raf, 0, (int) Math.min(SCAN_LIMIT, length));
            if (head != null) return head;
            if (length > SCAN_LIMIT) {
                long start = Math.max(0, length - SCAN_LIMIT);
                return scan(raf, start, (int) (length - start));
            }
            return null;
        } catch (IOException ex) {
            return null;
        }
    }

    private static int[] scan(RandomAccessFile raf, long offset, int size) throws IOException {
        if (size < 8) return null;
        byte[] buffer = new byte[size];
        raf.seek(offset);
        raf.readFully(buffer);
        int[] best = null;
        for (int i = 4; i + 4 <= buffer.length; i++) {
            // 'tkhd'
            if (buffer[i] != 't' || buffer[i + 1] != 'k' || buffer[i + 2] != 'h' || buffer[i + 3] != 'd') continue;
            int boxStart = i - 4;
            long boxSize = readUInt32(buffer, boxStart);
            if (boxSize < 84 || boxStart + boxSize > buffer.length) continue;
            int end = (int) (boxStart + boxSize);
            // tkhd 末尾 8 字节固定为 width/height（16.16）
            long w = readUInt32(buffer, end - 8);
            long h = readUInt32(buffer, end - 4);
            int px = (int) (w / 65536);
            int py = (int) (h / 65536);
            if (px > 0 && py > 0 && px < 20000 && py < 20000) {
                // 多轨时取面积最大的（通常是视频轨）
                if (best == null || (long) px * py > (long) best[0] * best[1]) best = new int[]{px, py};
            }
        }
        return best;
    }

    private static long readUInt32(byte[] buffer, int index) {
        if (index < 0 || index + 4 > buffer.length) return 0;
        return ((long) (buffer[index] & 0xFF) << 24)
                | ((buffer[index + 1] & 0xFF) << 16)
                | ((buffer[index + 2] & 0xFF) << 8)
                | (buffer[index + 3] & 0xFF);
    }

    static Path requireReadable(Path file) {
        if (file == null || !Files.isReadable(file)) {
            throw new ApiException(ErrorCode.NOT_FOUND, "视频源文件不可用");
        }
        return file;
    }
}
