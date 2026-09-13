package com.videoshare;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class VideoPlatformApplication {
    public static void main(String[] args) { SpringApplication.run(VideoPlatformApplication.class, args); }
}
