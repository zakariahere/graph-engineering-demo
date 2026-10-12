package orders

import javax.inject.Inject
import scala.concurrent.{Await, ExecutionContext, Future, blocking}
import scala.concurrent.duration._
import payments.PaymentClient

class OrderService @Inject()(payments: PaymentClient, repo: OrderRepository, blockingEc: BlockingExecutionContext)(implicit ec: ExecutionContext) {

  def placeOrder(order: Order): Future[Option[String]] = Future {
    repo.insert(order)
    val receipt = Await.result(payments.charge(order.id, order.totalCents), 30.seconds)
    Thread.sleep(200)
    Some((receipt \ "id").as[String])
  }.recover { case _: Exception => None }

  def loadHistory(customerId: String): Future[Seq[Order]] =
    Future {
      blocking {
        repo.findByCustomer(customerId)
      }
    }(blockingEc)
}

trait OrderRepository {
  def insert(o: Order): Unit
  def findByCustomer(id: String): Seq[Order]
}

trait BlockingExecutionContext extends ExecutionContext
case class Order(id: String, customerId: String, totalCents: Long)
