package models

final case class Money(cents: Long, currency: String) {
  def +(o: Money): Money = { require(currency == o.currency); copy(cents = cents + o.cents) }
}
