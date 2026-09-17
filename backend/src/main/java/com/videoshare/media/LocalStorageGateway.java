package com.videoshare.media;

import com.videoshare.common.*;import java.io.*;import java.nio.file.*;import java.security.*;import java.util.*;import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;import org.springframework.stereotype.Component;

@Component @ConditionalOnProperty(name="app.storage.mode",havingValue="local",matchIfMissing=true)
public class LocalStorageGateway implements StorageGateway {
    private final Path root;private final String publicBase;private final byte[] signingKey;
    public LocalStorageGateway(StorageProperties p){this.root=Path.of(Objects.requireNonNullElse(p.localRoot(),"./data")).toAbsolutePath().normalize();this.publicBase=Objects.requireNonNullElse(p.publicBaseUrl(),"").trim().replaceAll("/$","");String configured=p.signingSecret();this.signingKey=(configured==null||configured.isBlank()?UUID.randomUUID().toString():configured).getBytes(java.nio.charset.StandardCharsets.UTF_8);}
    public String partUrl(String id,int part){long expires=java.time.Instant.now().plusSeconds(7200).getEpochSecond();String prefix=publicBase.isBlank()?"":publicBase;return prefix+"/api/v1/uploads/"+id+"/parts/"+part+"?expires="+expires+"&signature="+sign(id,part,expires);}
    public void authorizePart(String id,int part,long expires,String signature){if(expires<java.time.Instant.now().getEpochSecond()||signature==null||!MessageDigest.isEqual(sign(id,part,expires).getBytes(java.nio.charset.StandardCharsets.US_ASCII),signature.getBytes(java.nio.charset.StandardCharsets.US_ASCII)))throw new ApiException(ErrorCode.FORBIDDEN,"上传地址无效或已过期");}
    public void putLocalPart(String id,int part,InputStream input,long size){if(size>10L*1024*1024)throw new ApiException(ErrorCode.VALIDATION,"分片过大");Path path=safe("uploads/"+id+"/part-"+part);try{Files.createDirectories(path.getParent());Files.copy(input,path,StandardCopyOption.REPLACE_EXISTING);}catch(IOException ex){throw new ApiException(ErrorCode.INTERNAL,"分片写入失败");}}
public String complete(String id,String sha,List<Integer> parts,long expectedSize,String fileName){Path target=safe("media/source/"+sha+".bin");try{Files.createDirectories(target.getParent());try(OutputStream out=Files.newOutputStream(target,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING)){for(Integer part:parts){Path source=safe("uploads/"+id+"/part-"+part);if(!Files.exists(source))throw new ApiException(ErrorCode.VALIDATION,"缺少分片 "+part);Files.copy(source,out);}}if(Files.size(target)!=expectedSize){Files.deleteIfExists(target);throw new ApiException(ErrorCode.VALIDATION,"合并后的文件大小不一致");}String actual=hash(target);if(!actual.equalsIgnoreCase(sha)){Files.deleteIfExists(target);throw new ApiException(ErrorCode.VALIDATION,"文件 SHA-256 校验失败");}try(InputStream input=Files.newInputStream(target)){StorageGateway.validateVideoHeader(input.readNBytes(32),fileName);StorageGateway.validateVideoFile(target,fileName);}catch(ApiException ex){Files.deleteIfExists(target);throw ex;}abort(id);return root.relativize(target).toString().replace('\\','/');}catch(IOException ex){throw new ApiException(ErrorCode.INTERNAL,"文件合并失败");}}
    public StorageGateway.StoredObject open(String bucket,String objectKey,long offset,long length){Path path=safe(objectKey);try{long size=Files.size(path);if(offset<0||offset>size)throw new ApiException(ErrorCode.NOT_FOUND,"视频文件不存在");long available=Math.min(length,size-offset);InputStream input=Files.newInputStream(path);long skipped=0;while(skipped<offset){long n=input.skip(offset-skipped);if(n<=0){input.close();throw new ApiException(ErrorCode.INTERNAL,"视频文件读取失败");}skipped+=n;}return new StorageGateway.StoredObject(input,available,contentType(path));}catch(IOException ex){throw new ApiException(ErrorCode.NOT_FOUND,"视频文件不存在");}}
    public void abort(String id){Path dir=safe("uploads/"+id);if(!Files.exists(dir))return;try(var walk=Files.walk(dir)){walk.sorted(Comparator.reverseOrder()).forEach(p->{try{Files.deleteIfExists(p);}catch(IOException ignored){}});}catch(IOException ignored){}}
    public String bucket(){return "local";}
    public void putObject(String objectKey,InputStream input,long size,String contentType){
        Path path=safe(objectKey);
        try{
            Files.createDirectories(path.getParent());
            long written=Files.copy(input,path,StandardCopyOption.REPLACE_EXISTING);
            if(written!=size){Files.deleteIfExists(path);throw new ApiException(ErrorCode.VALIDATION,"文件大小与声明不一致");}
        }catch(IOException ex){throw new ApiException(ErrorCode.INTERNAL,"文件写入失败");}
    }
    public String publicUrl(String objectKey){return "/api/v1/media/"+objectKey;}
    public void deleteObject(String objectKey){try{Files.deleteIfExists(safe(objectKey));}catch(IOException ignored){}}
    public boolean manages(String objectKey){return objectKey!=null&&objectKey.startsWith("media/");}
    private Path safe(String relative){Path p=root.resolve(relative).normalize();if(!p.startsWith(root))throw new ApiException(ErrorCode.FORBIDDEN,"非法存储路径");return p;}
    /**
     * Files.probeContentType 依赖系统注册表，对 .webp 常返回 null 或 octet-stream，
     * 会让浏览器拒收封面。这里按扩展名显式给出类型，未知扩展名才回退。
     */
    private String contentType(Path path){
        String name=path.getFileName().toString().toLowerCase(java.util.Locale.ROOT);
        int dot=name.lastIndexOf('.');
        String ext=dot<0?"":name.substring(dot+1);
        return switch(ext){
            case "png" -> "image/png";
            case "jpg","jpeg" -> "image/jpeg";
            case "gif" -> "image/gif";
            case "webp" -> "image/webp";
            case "vtt" -> "text/vtt";
            case "srt" -> "application/x-subrip";
            case "mp4","m4v" -> "video/mp4";
            case "webm" -> "video/webm";
            case "mov" -> "video/quicktime";
            default -> {String probed=null;try{probed=Files.probeContentType(path);}catch(IOException ignored){}yield probed==null?"application/octet-stream":probed;}
        };
    }
    private String hash(Path path)throws IOException{try(InputStream in=Files.newInputStream(path)){try{MessageDigest md=MessageDigest.getInstance("SHA-256");byte[] b=new byte[8192];for(int n;(n=in.read(b))>0;)md.update(b,0,n);return HexFormat.of().formatHex(md.digest());}catch(NoSuchAlgorithmException ex){throw new IllegalStateException(ex);}}}
    private String sign(String id,int part,long expires){try{javax.crypto.Mac mac=javax.crypto.Mac.getInstance("HmacSHA256");mac.init(new javax.crypto.spec.SecretKeySpec(signingKey,"HmacSHA256"));return HexFormat.of().formatHex(mac.doFinal((id+":"+part+":"+expires).getBytes(java.nio.charset.StandardCharsets.UTF_8)));}catch(GeneralSecurityException ex){throw new IllegalStateException(ex);}}
}
