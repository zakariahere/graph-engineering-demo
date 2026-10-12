package controllers

import javax.inject.Inject
import play.api.mvc._

class HealthController @Inject()(cc: ControllerComponents) extends AbstractController(cc) {
  def ping: Action[AnyContent] = Action { Ok("pong") }
}
