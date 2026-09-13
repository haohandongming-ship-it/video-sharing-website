package com.videoshare.media;

import jakarta.persistence.*;import java.time.Instant;import org.hibernate.annotations.JdbcTypeCode;import org.hibernate.type.SqlTypes;
@Entity @Table(name="files",uniqueConstraints=@UniqueConstraint(columnNames={"sha256","file_size"}))
public class FileAsset {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY)private Long id;
    @JdbcTypeCode(SqlTypes.CHAR) @Column(nullable=false,length=64,columnDefinition="CHAR(64)")private String sha256;
    @Column(name="file_size",nullable=false)private long fileSize;
    @Column(nullable=false,length=64)private String bucket;
    @Column(name="object_key",nullable=false,length=512)private String objectKey;
    @Column(name="mime_type",nullable=false,length=64)private String mimeType;
    @Column(name="ref_count",nullable=false)private int refCount;
    @Column(nullable=false,length=16)private String status;
    @Column(name="created_at",nullable=false)private Instant createdAt;
    public void initialize(String sha,long size,String bucket,String key,String mime){this.sha256=sha;this.fileSize=size;this.bucket=bucket;this.objectKey=key;this.mimeType=mime;this.refCount=1;this.status="ACTIVE";this.createdAt=Instant.now();}
    public Long getId(){return id;}public String getSha256(){return sha256;}public long getFileSize(){return fileSize;}public String getBucket(){return bucket;}public String getObjectKey(){return objectKey;}public void reference(){refCount++;}
}
