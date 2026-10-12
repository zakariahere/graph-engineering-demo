package payments

import javax.inject.Inject
import play.api.libs.json.{JsValue, Json}
import play.api.libs.ws.WSClient
import play.api.Logger
import scala.concurrent.{ExecutionContext, Future}

class PaymentClient @Inject()(ws: WSClient)(implicit ec: ExecutionContext) {
  private val log = Logger(getClass)
  private val baseUrl = "https://psp.example.com/v1"

  def charge(orderId: String, amountCents: Long): Future[JsValue] =
    chargeWithRetry(orderId, amountCents, attempt = 1)

  private def chargeWithRetry(orderId: String, amountCents: Long, attempt: Int): Future[JsValue] =
    ws.url(s"$baseUrl/charges")
      .post(Json.obj("order" -> orderId, "amount" -> amountCents))
      .map(_.json)
      .recoverWith { case _ =>
        log.warn(s"charge failed for $orderId, attempt $attempt, retrying")
        chargeWithRetry(orderId, amountCents, attempt + 1)
      }

  def refundStatus(refundId: String): Future[JsValue] =
    ws.url(s"$baseUrl/refunds/$refundId")
      .withRequestTimeout(scala.concurrent.duration.Duration(3, "seconds"))
      .get()
      .map(_.json)
      .recover { case e: Exception =>
        log.error(s"refund lookup failed for $refundId", e)
        throw e
      }
}
