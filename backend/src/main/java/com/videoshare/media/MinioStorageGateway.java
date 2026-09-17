package com.videoshare.media;

import com.videoshare.common.*;import io.minio.*;import io.minio.http.Method;import io.minio.messages.DeleteObject;import io.minio.messages.Item;import jakarta.annotation.PostConstruct;import java.io.InputStream;import java.util.*;import java.util.concurrent.TimeUnit;import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;import org.springframework.stereotype.Component;

@Component @ConditionalOnProperty(name="app.storage.mode",havingValue="minio")
public class MinioStorageGateway implements StorageGateway {
    private final MinioClient client;private final MinioClient publicClient;private final StorageProperties p;
    private final String publicBase;private final tools.jackson.databind.ObjectMapper json;
    public MinioStorageGateway(StorageProperties p,tools.jackson.databind.ObjectMapper json){this.p=p;this.json=json;this.client=MinioClient.builder().endpoint(p.endpoint()).credentials(p.accessKey(),p.secretKey()).build();String publicEndpoint=p.publicEndpoint()==null||p.publicEndpoint().isBlank()?p.endpoint():p.publicEndpoint();this.publicClient=MinioClient.builder().endpoint(publicEndpoint).credentials(p.accessKey(),p.secretKey()).build();this.publicBase=publicEndpoint.replaceAll("/$","");}
    @PostConstruct void bucketReady(){
        try{
            if(!client.bucketExists(BucketExistsArgs.builder().bucket(p.bucket()).build()))client.makeBucket(MakeBucketArgs.builder().bucket(p.bucket()).build());
            // 头像这类小对象要让浏览器直连读取（公开读），因此下发仅含 s3:GetObject 的桶策略；
            // 写操作仍然必须持凭证，不会被这条策略放开。注意 presigned URL 的 7 天上限不适用于长期展示的头像。
            client.setBucketPolicy(SetBucketPolicyArgs.builder().bucket(p.bucket()).config(publicReadPolicy(p.bucket())).build());
        }catch(Exception ex){throw new IllegalStateException("MinIO 初始化失败",ex);}
    }
    private String publicReadPolicy(String bucket){
        try{
            var statement=json.createObjectNode();
            statement.put("Effect","Allow");
            statement.put("Principal","*");
            statement.put("Action","s3:GetObject");
            var resource=json.createArrayNode();
            resource.add("arn:aws:s3:::"+bucket);
            resource.add("arn:aws:s3:::"+bucket+"/*");
            statement.set("Resource",resource);
            var statements=json.createArrayNode();
            statements.add(statement);
            var policy=json.createObjectNode();
            policy.put("Version","2012-10-17");
            policy.set("Statement",statements);
            return json.writeValueAsString(policy);
        }catch(tools.jackson.core.JacksonException ex){throw new IllegalStateException("MinIO 桶策略生成失败",ex);}
    }
    public void putObject(String objectKey,InputStream input,long size,String contentType){
        try{client.putObject(PutObjectArgs.builder().bucket(p.bucket()).object(objectKey).stream(input,size,-1).contentType(contentType).build());}
        catch(Exception ex){throw new ApiException(ErrorCode.INTERNAL,"文件上传到对象存储失败");}
    }
    public String publicUrl(String objectKey){return publicBase+"/"+p.bucket()+"/"+objectKey;}
    public void deleteObject(String objectKey){
        try{client.removeObject(RemoveObjectArgs.builder().bucket(p.bucket()).object(objectKey).build());}
        catch(Exception ignored){}
    }
    public boolean manages(String objectKey){return objectKey!=null&&objectKey.startsWith("media/");}
    public String partUrl(String id,int part){try{return publicClient.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder().method(Method.PUT).bucket(p.bucket()).object(partKey(id,part)).expiry(2,TimeUnit.HOURS).build());}catch(Exception ex){throw new ApiException(ErrorCode.INTERNAL,"无法生成上传地址");}}
    public String complete(String id,String sha,List<Integer> parts,long expectedSize,String fileName){String object="source/"+sha+".bin";try{List<ComposeSource> sources=parts.stream().map(n->ComposeSource.builder().bucket(p.bucket()).object(partKey(id,n)).build()).toList();client.composeObject(ComposeObjectArgs.builder().bucket(p.bucket()).object(object).sources(sources).build());long actualSize=client.statObject(StatObjectArgs.builder().bucket(p.bucket()).object(object).build()).size();if(actualSize!=expectedSize){client.removeObject(RemoveObjectArgs.builder().bucket(p.bucket()).object(object).build());throw new ApiException(ErrorCode.VALIDATION,"合并后的文件大小不一致");}try(java.io.InputStream input=client.getObject(GetObjectArgs.builder().bucket(p.bucket()).object(object).offset(0L).length(32L).build())){StorageGateway.validateVideoHeader(input.readNBytes(32),fileName);}catch(ApiException ex){client.removeObject(RemoveObjectArgs.builder().bucket(p.bucket()).object(object).build());throw ex;}abort(id);return object;}catch(ApiException ex){throw ex;}catch(Exception ex){throw new ApiException(ErrorCode.INTERNAL,"MinIO 分片合并失败");}}
    public StorageGateway.StoredObject open(String bucket,String object,long offset,long length){try{StatObjectResponse stat=client.statObject(StatObjectArgs.builder().bucket(bucket).object(object).build());long available=Math.min(length,stat.size()-offset);if(offset<0||available<0)throw new ApiException(ErrorCode.NOT_FOUND,"视频文件不存在");InputStream stream=client.getObject(GetObjectArgs.builder().bucket(bucket).object(object).offset(offset).length(available).build());return new StorageGateway.StoredObject(stream,available,Objects.requireNonNullElse(stat.contentType(),"application/octet-stream"));}catch(ApiException ex){throw ex;}catch(Exception ex){throw new ApiException(ErrorCode.NOT_FOUND,"视频文件不存在");}}
    public void abort(String id){try{List<DeleteObject> objects=new ArrayList<>();for(Result<Item> item:client.listObjects(ListObjectsArgs.builder().bucket(p.bucket()).prefix("uploads/"+id+"/").build()))objects.add(new DeleteObject(item.get().objectName()));for(var result:client.removeObjects(RemoveObjectsArgs.builder().bucket(p.bucket()).objects(objects).build()))result.get();}catch(Exception ignored){}}
    public String bucket(){return p.bucket();}private String partKey(String id,int part){return "uploads/"+id+"/part-"+part;}
}
