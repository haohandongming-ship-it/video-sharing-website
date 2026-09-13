package com.videoshare.media;
import java.io.InputStream;import java.util.List;
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
        String lower=fileName.toLowerCase(java.util.Locale.ROOT);
        boolean iso=header.length>=8&&header[4]=='f'&&header[5]=='t'&&header[6]=='y'&&header[7]=='p';
        boolean ebml=header.length>=4&&(header[0]&255)==0x1a&&(header[1]&255)==0x45&&(header[2]&255)==0xdf&&(header[3]&255)==0xa3;
        if((lower.endsWith(".mp4")||lower.endsWith(".mov")||lower.endsWith(".m4v"))&&!iso)throw new com.videoshare.common.ApiException(com.videoshare.common.ErrorCode.VALIDATION,"文件内容与视频扩展名不一致");
        if(lower.endsWith(".webm")&&!ebml)throw new com.videoshare.common.ApiException(com.videoshare.common.ErrorCode.VALIDATION,"文件内容与视频扩展名不一致");
    }
}
