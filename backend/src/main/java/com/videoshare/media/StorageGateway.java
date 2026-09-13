package com.videoshare.media;
import java.io.*;import java.nio.file.*;import java.util.*;
public interface StorageGateway {
    record StoredObject(InputStream stream, long length, String contentType) { }
    String partUrl(String uploadId,int partNumber);
    default void putLocalPart(String uploadId,int partNumber,InputStream input,long size){throw new UnsupportedOperationException();}
    default void authorizePart(String uploadId,int partNumber,long expires,String signature){}
    String complete(String uploadId,String sha256,List<Integer> parts,long expectedSize,String fileName);
    StoredObject open(String bucket, String objectKey, long offset, long length);
    void abort(String uploadId);
    String bucket();
    static void validateVideoHeader(byte[] header,String fileName){
        String lower=fileName.toLowerCase(Locale.ROOT);
        boolean iso=header.length>=8&&header[4]=='f'&&header[5]=='t'&&header[6]=='y'&&header[7]=='p';
        boolean ebml=header.length>=4&&(header[0]&255)==0x1a&&(header[1]&255)==0x45&&(header[2]&255)==0xdf&&(header[3]&255)==0xa3;
        if((lower.endsWith(".mp4")||lower.endsWith(".mov")||lower.endsWith(".m4v"))&&!iso)throw new com.videoshare.common.ApiException(com.videoshare.common.ErrorCode.VALIDATION,"文件内容与视频扩展名不一致");
        if(lower.endsWith(".webm")&&!ebml)throw new com.videoshare.common.ApiException(com.videoshare.common.ErrorCode.VALIDATION,"文件内容与视频扩展名不一致");
    }
    /** Cheap container validation that rejects a header-only file which the browser cannot play. */
    static void validateVideoFile(Path file,String fileName){
        String lower=fileName.toLowerCase(Locale.ROOT);
        try {
            long length=Files.size(file);
            if(length<128) throw new com.videoshare.common.ApiException(com.videoshare.common.ErrorCode.VALIDATION,"视频文件不完整");
            try(InputStream in=Files.newInputStream(file)){ validateVideoHeader(in.readNBytes(32),fileName); }
            if(lower.endsWith(".mp4")||lower.endsWith(".mov")||lower.endsWith(".m4v")) {
                boolean ftyp=false,media=false,metadata=false;
                try(RandomAccessFile raf=new RandomAccessFile(file.toFile(),"r")) {
                    long pos=0;
                    while(pos+8<=length && pos<64L*1024*1024) {
                        raf.seek(pos); long size=Integer.toUnsignedLong(raf.readInt()); byte[] type=new byte[4]; raf.readFully(type);
                        String box=new String(type,java.nio.charset.StandardCharsets.US_ASCII); long actual=size==1?raf.readLong():size;
                        if(actual<8 || pos+actual>length) break;
                        if("ftyp".equals(box)) ftyp=true; if("mdat".equals(box)) media=true; if("moov".equals(box)) metadata=true; pos+=actual;
                    }
                    if(!metadata||!media){long start=Math.max(0,length-64L*1024*1024);raf.seek(start);byte[] tail=new byte[(int)Math.min(64L*1024*1024,length-start)];raf.readFully(tail);String text=new String(tail,java.nio.charset.StandardCharsets.ISO_8859_1);metadata|=text.contains("moov");media|=text.contains("mdat");}
                }
                if(!ftyp||!metadata||!media) throw new com.videoshare.common.ApiException(com.videoshare.common.ErrorCode.VALIDATION,"MP4 容器缺少 moov 或 mdat 数据");
            } else if(lower.endsWith(".webm") && !containsBytes(file,new byte[]{0x18,0x53,(byte)0x80,0x67})) {
                throw new com.videoshare.common.ApiException(com.videoshare.common.ErrorCode.VALIDATION,"WebM 容器缺少媒体数据");
            }
        } catch(com.videoshare.common.ApiException ex){throw ex;} catch(IOException|RuntimeException ex){throw new com.videoshare.common.ApiException(com.videoshare.common.ErrorCode.VALIDATION,"视频文件无法读取或已损坏");}
    }
    private static boolean containsBytes(Path file,byte[] needle)throws IOException{try(InputStream in=Files.newInputStream(file)){byte[] buffer=new byte[1024*1024];int carry=0,n;while((n=in.read(buffer,carry,buffer.length-carry))>0){int total=carry+n;for(int i=0;i<=total-needle.length;i++){boolean ok=true;for(int j=0;j<needle.length;j++)if(buffer[i+j]!=needle[j]){ok=false;break;}if(ok)return true;}carry=Math.min(needle.length-1,total);System.arraycopy(buffer,total-carry,buffer,0,carry);}return false;}}
}
