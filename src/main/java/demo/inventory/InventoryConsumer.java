package demo.inventory;

import java.time.Duration;
import java.util.concurrent.*;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

@Component
public class InventoryConsumer {

    private final ExecutorService workers = Executors.newCachedThreadPool();
    private final BlockingQueue<String> inbox = new LinkedBlockingQueue<>();
    private final RestTemplate http;

    public InventoryConsumer(RestTemplateBuilder builder) {
        this.http = builder
                .setConnectTimeout(Duration.ofSeconds(2))
                .setReadTimeout(Duration.ofSeconds(5))
                .build();
    }

    public void onMessage(String sku) {
        inbox.offer(sku);
        workers.submit(this::drain);
    }

    private void drain() {
        String sku;
        while ((sku = inbox.poll()) != null) {
            try {
                http.postForObject("http://stock/api/reserve/" + sku, null, Void.class);
            } catch (Exception e) {
            }
        }
    }
}
