package com.videoshare.media;
import java.util.Optional;import org.springframework.data.jpa.repository.JpaRepository;
public interface FileAssetRepository extends JpaRepository<FileAsset,Long>{Optional<FileAsset> findBySha256AndFileSize(String sha256,long fileSize);}
