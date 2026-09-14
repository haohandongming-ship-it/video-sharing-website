package com.videoshare.realtime;

import com.videoshare.interaction.InteractionService;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 榜单实时推送。
 *
 * <p>早期实现为每个订阅者单独跑一次榜单查询，N 个连接 = N 次聚合查询。现在每次
 * 广播按「榜单类型」各算一次，再扇出给该类型的全部订阅者：数据库压力与在线人数解耦。</p>
 */
@RestController
@RequestMapping("/api/v1/sse")
public class RankingSseController {

    private static final long EMITTER_TIMEOUT_MILLIS = 180_000L;
    private static final Set<String> SUPPORTED_TYPES = Set.of("hot", "trend");

    private final InteractionService interactions;
    private final Map<String, Set<Subscription>> subscriptions = new ConcurrentHashMap<>();

    public RankingSseController(InteractionService interactions) {
        this.interactions = interactions;
    }

    @GetMapping("/ranking/{type}")
    public SseEmitter ranking(@PathVariable String type) {
        String normalized = SUPPORTED_TYPES.contains(type) ? type : "hot";
        SseEmitter emitter = new SseEmitter(EMITTER_TIMEOUT_MILLIS);
        Subscription subscription = new Subscription(normalized, emitter);
        subscriptions.computeIfAbsent(normalized, key -> ConcurrentHashMap.newKeySet()).add(subscription);
        emitter.onCompletion(() -> remove(subscription));
        emitter.onTimeout(() -> remove(subscription));
        emitter.onError(error -> remove(subscription));
        send(subscription, payload(normalized));
        return emitter;
    }

    @Scheduled(fixedDelay = 30_000)
    public void broadcast() {
        subscriptions.forEach((type, subscribers) -> {
            if (subscribers.isEmpty()) return;
            Map<String, Object> payload = payload(type);
            for (Subscription subscription : subscribers) send(subscription, payload);
        });
    }

    private Map<String, Object> payload(String type) {
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> row : interactions.ranking(type, "daily", null, null)) {
            @SuppressWarnings("unchecked")
            Map<String, Object> video = (Map<String, Object>) row.get("video");
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("rank", row.get("rank"));
            item.put("videoId", video.get("id"));
            item.put("title", video.get("title"));
            item.put("score", row.get("score"));
            item.put("delta", row.get("delta"));
            items.add(item);
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", type);
        payload.put("period", "daily");
        payload.put("updatedAt", Instant.now());
        payload.put("items", items);
        return payload;
    }

    private void send(Subscription subscription, Map<String, Object> payload) {
        try {
            subscription.emitter().send(SseEmitter.event().data(payload));
        } catch (IOException | RuntimeException ex) {
            remove(subscription);
            try {
                subscription.emitter().complete();
            } catch (RuntimeException ignored) {
                // 连接已经断开，无需处理。
            }
        }
    }

    private void remove(Subscription subscription) {
        Set<Subscription> subscribers = subscriptions.get(subscription.type());
        if (subscribers != null) subscribers.remove(subscription);
    }

    private record Subscription(String type, SseEmitter emitter) { }
}
