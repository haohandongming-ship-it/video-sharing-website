package com.videoshare.config;

import com.videoshare.user.*;
import java.time.*;
import java.sql.Timestamp;
import java.util.List;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component @Profile({"dev","dev-infra"}) @org.springframework.core.annotation.Order(0)
public class DevDataSeeder implements ApplicationRunner {
    private final UserRepository users;private final PasswordEncoder encoder;private final JdbcTemplate jdbc;
    public DevDataSeeder(UserRepository users,PasswordEncoder encoder,JdbcTemplate jdbc){this.users=users;this.encoder=encoder;this.jdbc=jdbc;}
    @Override @Transactional public void run(ApplicationArguments args){
        if(users.count()>0)return;
        long admin=create("admin","admin@example.com","13800000001","管理员",Role.ADMIN,true);
        long moderator=create("moderator","moderator@example.com","13800000002","审核员",Role.MODERATOR,true);
        long creator=create("laowang","laowang@example.com","13800000003","架构师老王",Role.USER,true);
        long newbie=create("newbie","newbie@example.com","13800000011","新来的创作者",Role.USER,false);
        // Keep a small, representative seed set. Real uploads are persisted by the upload flow.
        for(int i=1;i<=4;i++){
            String sha=String.format("%064x",i);
            jdbc.update("INSERT INTO files(sha256,file_size,bucket,object_key,mime_type,ref_count,status) VALUES(?,?,?,?,?,?,?)",sha,20_000_000L+i,"videos","demo/"+i+".mp4","video/mp4",1,"ACTIVE");
            Long fileId=jdbc.queryForObject("SELECT id FROM files WHERE sha256=?",Long.class,sha);
            long author=i%4==0?moderator:creator;String type=i%4==0?"SHORT":"LONG";String status=i==3?"REVIEWING":i==4?"REJECTED":"PUBLISHED";
            jdbc.update("INSERT INTO videos(user_id,source_file_id,title,description,cover_url,hls_url,duration,file_size,video_type,category_id,visibility,status,download_enabled,view_count,like_count,comment_count,favorite_count,published_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",author,fileId,"光影视频示例 "+i,"用于前后端联调的示例视频内容。","https://picsum.photos/seed/video"+i+"/640/360","/api/v1/demo/hls/master.m3u8",i%5==0?45:300+i*37,20_000_000L+i,type,(i%3)+1,"PUBLIC",status,true,0L,0L,0L,0L,Timestamp.from(Instant.now().minus(Duration.ofDays(i))),Timestamp.from(Instant.now().minus(Duration.ofDays(i))),Timestamp.from(Instant.now()));
        }
        var videoIds=jdbc.query("SELECT id FROM videos ORDER BY id",(rs,n)->rs.getLong(1));
        jdbc.update("INSERT INTO follows(follower_id,followee_id) VALUES(?,?)",newbie,creator);
        jdbc.update("INSERT INTO follows(follower_id,followee_id) VALUES(?,?)",admin,creator);
        jdbc.update("INSERT INTO folders(user_id,name,visibility,system_type) VALUES(?,?,?,?)",creator,"默认收藏夹","PRIVATE","DEFAULT");
        Long folderId=jdbc.queryForObject("SELECT id FROM folders WHERE user_id=?",Long.class,creator);
        jdbc.update("INSERT INTO favorites(user_id,video_id,folder_id) VALUES(?,?,?)",creator,videoIds.get(1),folderId);
        jdbc.update("INSERT INTO play_records(user_id,video_id,progress,finished) VALUES(?,?,?,?)",creator,videoIds.get(0),120,false);
        jdbc.update("INSERT INTO comments(video_id,user_id,content,status) VALUES(?,?,?,?)",videoIds.get(0),newbie,"这个架构讲得很清楚，期待后续！","VISIBLE");
        jdbc.update("INSERT INTO feeds(user_id,content,type,like_count,comment_count,repost_count,status) VALUES(?,?,?,?,?,?,?)",creator,"新视频发布啦，聊聊一个视频平台从零到一的架构取舍。","ORIGINAL",0,0,0,"VISIBLE");
        jdbc.update("INSERT INTO feeds(user_id,content,type,like_count,comment_count,repost_count,status) VALUES(?,?,?,?,?,?,?)",moderator,"今日社区精选已经更新，欢迎分享你的创作。","ORIGINAL",0,0,0,"VISIBLE");
        jdbc.update("INSERT INTO notifications(user_id,actor_id,type,title,content,target_type,target_id) VALUES(?,?,?,?,?,?,?)",creator,newbie,"FOLLOW","新增关注","新来的创作者关注了你","USER",newbie);
        jdbc.update("INSERT INTO conversations(user_a_id,user_b_id) VALUES(?,?)",creator,admin);
        Long conversation=jdbc.queryForObject("SELECT id FROM conversations WHERE user_a_id=? AND user_b_id=?",Long.class,creator,admin);
        jdbc.update("INSERT INTO direct_messages(conversation_id,sender_id,content) VALUES(?,?,?)",conversation,admin,"欢迎来到光影视频平台，有问题可以随时联系管理员。");
        for(int index:List.of(2,3)){long videoId=videoIds.get(index);jdbc.update("INSERT INTO video_reviews(video_id,machine_result,machine_labels,risk_level,status) VALUES(?,?,?,?,?)",videoId,index==2?"PASS":"SUSPECT",index==2?"[]":"[封面]",index==2?"LOW":"MEDIUM","PENDING");}
        jdbc.update("UPDATE videos SET favorite_count=(SELECT COUNT(*) FROM favorites f WHERE f.video_id=videos.id),comment_count=(SELECT COUNT(*) FROM comments c WHERE c.video_id=videos.id AND c.status='VISIBLE')");
        for(String tag:List.of("架构","Spring Boot","React"))jdbc.update("INSERT INTO tags(tag_name) VALUES(?)",tag);
        var tagIds=jdbc.query("SELECT id FROM tags",(rs,n)->rs.getLong(1));for(Long tagId:tagIds)jdbc.update("INSERT INTO video_tags(video_id,tag_id) VALUES(?,?)",videoIds.get(0),tagId);
    }
    private long create(String username,String email,String phone,String nickname,Role role,boolean certified){User u=new User();u.register(username,email,phone,encoder.encode("123456"),nickname);u.changeRole(role);users.save(u);jdbc.update("INSERT INTO creator_profiles(user_id,auth_status,trust_score,certified_at) VALUES(?,?,?,?)",u.getId(),certified?"CERTIFIED":"NONE",certified?80:0,certified?java.sql.Timestamp.from(Instant.now()):null);return u.getId();}
}
