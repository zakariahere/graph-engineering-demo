package demo.shipping;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.springframework.retry.annotation.Retryable;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
public class ShippingGateway {

    private final RestTemplate rest = new RestTemplate();

    @Retryable(maxAttempts = 10)
    public String createShipment(String orderId, String address) {
        return rest.postForObject("http://carrier/api/shipments",
                new ShipmentRequest(orderId, address), String.class);
    }

    public String trackingStatus(String trackingId) throws Exception {
        CompletableFuture<String> f = CompletableFuture.supplyAsync(
                () -> rest.getForObject("http://carrier/api/track/" + trackingId, String.class));
        return f.get(2, TimeUnit.SECONDS);
    }

    record ShipmentRequest(String orderId, String address) {}
}
