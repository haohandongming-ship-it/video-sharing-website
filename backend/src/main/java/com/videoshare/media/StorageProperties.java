package com.videoshare.media;
import org.springframework.boot.context.properties.ConfigurationProperties;
@ConfigurationProperties(prefix="app.storage")
public record StorageProperties(String mode,String localRoot,String publicBaseUrl,String endpoint,String publicEndpoint,String accessKey,String secretKey,String bucket,String signingSecret){}
