package com.videoshare.realtime;

import com.videoshare.interaction.InteractionService;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/v1/sse")
public class RankingSseController {
    private final InteractionService interactions;
    private final List<Subscription> subscriptions = new CopyOnWriteArrayList<>();

    public RankingSseController(InteractionService interactions) { this.interactions = interactions; }

    @GetMapping("/ranking/{type}")
    public SseEmitter ranking(@PathVariable String type) {
        if (!type.equals("hot") && !type.equals("trend")) type = "hot";
        SseEmitter emitter = new SseEmitter(180_000L);
        Subscription subscription = new Subscription(type, emitter);
        subscriptions.add(subscription);
        emitter.onCompletion(() -> subscriptions.remove(subscription));
        emitter.onTimeout(() -> subscriptions.remove(subscription));
        emitter.onError(error -> subscriptions.remove(subscription));
        send(subscription);
        return emitter;
    }

    @Scheduled(fixedDelay = 30_000)
    public void broadcast() { subscriptions.forEach(this::send); }

    private void send(Subscription subscription) {
        try {
            List<Map<String, Object>> source = interactions.ranking(subscription.type(), "daily", null, null);
            List<Map<String, Object>> items = new ArrayList<>();
            for (Map<String, Object> row : source) {
                @SuppressWarnings("unchecked") Map<String, Object> video = (Map<String, Object>) row.get("video");
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("rank", row.get("rank"));
                item.put("videoId", video.get("id"));
                item.put("title", video.get("title"));
                item.put("score", row.get("score"));
                item.put("delta", row.get("delta"));
                items.add(item);
            }
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("type", subscription.type());
            payload.put("period", "daily");
            payload.put("updatedAt", Instant.now());
            payload.put("items", items);
            subscription.emitter().send(SseEmitter.event().data(payload));
        } catch (IOException | RuntimeException ex) {
            subscriptions.remove(subscription);
            try { subscription.emitter().complete(); } catch (RuntimeException ignored) { }
        }
    }

    private record Subscription(String type, SseEmitter emitter) { }
}
