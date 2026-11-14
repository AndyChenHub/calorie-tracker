package expo.modules.loopbackoauth

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors

class ExpoLoopbackOAuthModule : Module() {
  private val lock = Any()
  private val executor = Executors.newCachedThreadPool()
  private var serverSocket: ServerSocket? = null
  private var capturedUrl: String? = null
  private var pendingPromise: Promise? = null
  private var sessionToken: Long = 0

  override fun definition() = ModuleDefinition {
    Name("ExpoLoopbackOAuth")

    AsyncFunction("startServerAsync") { preferredPort: Int, allowFallback: Boolean ->
      stopInternal()

      val sock = ServerSocket()
      sock.reuseAddress = true
      val loopback = InetAddress.getByName("127.0.0.1")
      val reqPort = if (preferredPort in 1..65535) preferredPort else 0
      try {
        sock.bind(InetSocketAddress(loopback, reqPort), 8)
      } catch (e: Exception) {
        if (reqPort != 0 && allowFallback) {
          sock.bind(InetSocketAddress(loopback, 0), 8)
        } else {
          sock.close()
          throw e
        }
      }

      val actualPort = sock.localPort
      val activeToken: Long
      synchronized(lock) {
        sessionToken += 1
        activeToken = sessionToken
        serverSocket = sock
        capturedUrl = null
        pendingPromise = null
      }

      executor.execute {
        acceptLoop(activeToken, sock, actualPort)
      }

      mapOf(
        "port" to actualPort,
        "redirectUri" to "http://localhost:$actualPort/auth/callback",
        "loopbackIpUri" to "http://127.0.0.1:$actualPort/auth/callback"
      )
    }

    AsyncFunction("waitForCallbackAsync") { timeoutMs: Int, promise: Promise ->
      val activeToken: Long
      synchronized(lock) {
        val existing = capturedUrl
        if (existing != null) {
          capturedUrl = null
          promise.resolve(existing)
          return@AsyncFunction
        }
        if (serverSocket == null) {
          promise.reject("ERR_LOOPBACK_NOT_RUNNING", "Loopback OAuth server is not running.", null)
          return@AsyncFunction
        }
        activeToken = sessionToken
        pendingPromise = promise
      }

      val clamped = timeoutMs.coerceIn(5000, 600_000).toLong()
      executor.execute {
        try {
          Thread.sleep(clamped)
        } catch (_: InterruptedException) {
          return@execute
        }
        var timedOutWaiter: Promise? = null
        synchronized(lock) {
          if (sessionToken == activeToken && pendingPromise != null) {
            timedOutWaiter = pendingPromise
            pendingPromise = null
          }
        }
        if (timedOutWaiter != null) {
          stopInternal()
          timedOutWaiter?.reject("ERR_LOOPBACK_TIMEOUT", "Timed out waiting for OAuth callback.", null)
        }
      }
    }

    AsyncFunction("stopServerAsync") {
      stopInternal()
    }

    OnDestroy {
      stopInternal()
    }
  }

  private fun acceptLoop(token: Long, sock: ServerSocket, port: Int) {
    sock.soTimeout = 250
    while (true) {
      synchronized(lock) {
        if (sessionToken != token || serverSocket !== sock) return
      }
      val client = try {
        sock.accept()
      } catch (_: SocketTimeoutException) {
        continue
      } catch (_: Exception) {
        return
      }

      client.use { c ->
        c.soTimeout = 2000
        val reader = BufferedReader(InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))
        val firstLine = reader.readLine() ?: return@use
        val parts = firstLine.split(" ")
        if (parts.size < 2 || parts[0].uppercase() != "GET") return@use
        val target = parts[1]
        if (target.startsWith("/favicon.ico")) {
          val resp = "HTTP/1.1 204 No Content\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
          c.getOutputStream().write(resp.toByteArray(StandardCharsets.UTF_8))
          c.getOutputStream().flush()
          return@use
        }
        val isCallback =
          target.startsWith("/auth/callback") ||
          target.startsWith("/callback") ||
          target.contains("code=") ||
          target.contains("error=")
        if (!isCallback) return@use

        val html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"/></head><body style=\"font-family:sans-serif;text-align:center;padding:40px;background:#F5F5F7;\"><h2>Connected to Plate</h2><p>Returning to Plate...</p><script>try{history.replaceState(null,'','/auth/callback');}catch(e){}</script></body></html>"
        val bodyBytes = html.toByteArray(StandardCharsets.UTF_8)
        val header =
          "HTTP/1.1 200 OK\r\n" +
          "Content-Type: text/html; charset=utf-8\r\n" +
          "Cache-Control: no-store, no-cache, must-revalidate\r\n" +
          "Referrer-Policy: no-referrer\r\n" +
          "X-Content-Type-Options: nosniff\r\n" +
          "X-Frame-Options: DENY\r\n" +
          "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'\r\n" +
          "Connection: close\r\n" +
          "Content-Length: ${bodyBytes.size}\r\n\r\n"
        c.getOutputStream().write(header.toByteArray(StandardCharsets.UTF_8))
        c.getOutputStream().write(bodyBytes)
        c.getOutputStream().flush()

        val normalized = if (target.startsWith("/")) target else "/$target"
        val fullUrl = "http://localhost:$port$normalized"
        var waiter: Promise? = null
        synchronized(lock) {
          if (sessionToken == token) {
            serverSocket = null
            waiter = pendingPromise
            pendingPromise = null
            if (waiter == null) {
              capturedUrl = fullUrl
            }
          }
        }
        try {
          sock.close()
        } catch (_: Exception) {
        }
        waiter?.resolve(fullUrl)
        return
      }
    }
  }

  private fun stopInternal() {
    var sock: ServerSocket?
    var waiter: Promise?
    synchronized(lock) {
      sock = serverSocket
      serverSocket = null
      waiter = pendingPromise
      pendingPromise = null
    }
    try {
      sock?.close()
    } catch (_: Exception) {
    }
    waiter?.reject("ERR_LOOPBACK_CANCELLED", "Loopback OAuth listener stopped.", null)
  }
}
