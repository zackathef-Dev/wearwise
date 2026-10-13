package expo.modules.pinnedwebsocket

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/*
 * A WebSocket (wss://) that trusts exactly ONE certificate: the sensor's own
 * self-signed one, identified by the SHA-256 of its DER encoding, which the app read
 * over the Bluetooth link it already trusts.
 *
 * No CA chain or hostname check applies — the pin is stricter than both: any other
 * certificate is refused, even one a public CA signed. (Hostnames can't apply anyway:
 * the phone connects to the sensor by its LAN IP address.)
 */
class PinnedWebSocketModule : Module() {
  private val sockets = ConcurrentHashMap<String, WebSocket>()
  private val base: OkHttpClient by lazy {
    OkHttpClient.Builder()
      .connectTimeout(6, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.MILLISECONDS) // the app's watchdog owns liveness
      .build()
  }

  override fun definition() = ModuleDefinition {
    Name("PinnedWebSocket")
    Events("onOpen", "onMessage", "onClose", "onError")

    Function("connect") { id: String, url: String, pinSha256Hex: String ->
      val trust = PinnedTrustManager(pinSha256Hex.lowercase())
      val tls = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), null) }
      val client = base.newBuilder()
        .sslSocketFactory(tls.socketFactory, trust)
        .hostnameVerifier { _, _ -> true } // identity = the pinned certificate (checked above)
        .build()
      sockets[id] = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          sendEvent("onOpen", mapOf("id" to id))
        }
        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
          sendEvent("onMessage", mapOf("id" to id, "data" to bytes.base64()))
        }
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
          webSocket.close(code, null)
        }
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          sockets.remove(id)
          sendEvent("onClose", mapOf("id" to id, "code" to code))
        }
        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
          sockets.remove(id)
          val pinMismatch = generateSequence(t) { it.cause }.any { it is CertificateException }
          sendEvent("onError", mapOf("id" to id, "message" to (t.message ?: t.javaClass.simpleName), "pinMismatch" to pinMismatch))
        }
      })
    }

    Function("send") { id: String, text: String ->
      sockets[id]?.send(text) ?: false
    }

    Function("close") { id: String ->
      sockets.remove(id)?.close(1000, null)
      Unit
    }
  }
}

private class PinnedTrustManager(private val pinHex: String) : X509TrustManager {
  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
    throw CertificateException("client certificates are not used")
  }

  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
    val leaf = chain.firstOrNull() ?: throw CertificateException("the sensor presented no certificate")
    val actual = MessageDigest.getInstance("SHA-256").digest(leaf.encoded)
      .joinToString("") { "%02x".format(it) }
    // Constant-time compare; both sides are 64 lowercase hex chars.
    if (!MessageDigest.isEqual(actual.toByteArray(), pinHex.toByteArray())) {
      throw CertificateException("certificate does not match the sensor's pinned fingerprint")
    }
  }

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}
