# Stage 0 - Recon
Selected (4): app/payments/PaymentClient.scala, app/orders/OrderService.scala,
src/main/java/demo/inventory/InventoryConsumer.java, src/main/java/demo/shipping/ShippingGateway.java
Rejected (2): app/controllers/HealthController.scala (pure in-memory Ok), app/models/Money.scala (value object, no I/O)
Selection heuristic: grep for I/O + concurrency signals (ws.url, RestTemplate, Future, Await, Executors, Queue, @Retryable, catch/recover)
Agents: 0 (main session only)
