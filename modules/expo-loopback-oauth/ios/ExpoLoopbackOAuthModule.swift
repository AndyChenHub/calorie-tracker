import Darwin
import ExpoModulesCore
import Foundation
#if os(iOS)
import UIKit
#endif

private final class LoopbackOAuthServer {
  private let lock = NSLock()
  private var ipv4Fd: Int32 = -1
  private var ipv6Fd: Int32 = -1
  private var boundPort: UInt16 = 0
  private var running: Bool = false
  private var sessionToken: UInt64 = 0
  private var capturedUrl: String?
  private var pendingPromise: Promise?
  #if os(iOS)
  private var bgTaskId: UIBackgroundTaskIdentifier = .invalid
  #endif

  func start(preferredPort: Int, allowFallback: Bool) throws -> [String: Any] {
    stop()

    let fd4 = Darwin.socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
    guard fd4 >= 0 else {
      throw NSError(
        domain: "ExpoLoopbackOAuth",
        code: Int(Darwin.errno),
        userInfo: [NSLocalizedDescriptionKey: "Could not create IPv4 loopback socket."]
      )
    }

    configureSocketReuse(fd4)

    let requestedPort: UInt16 =
      preferredPort > 0 && preferredPort <= 65535 ? UInt16(preferredPort) : 0

    var bindResult = bindIpv4(fd: fd4, port: requestedPort)
    if bindResult != 0 && requestedPort != 0 && allowFallback {
      bindResult = bindIpv4(fd: fd4, port: 0)
    }
    if bindResult != 0 {
      let code = Int(Darwin.errno)
      Darwin.close(fd4)
      throw NSError(
        domain: "ExpoLoopbackOAuth",
        code: code,
        userInfo: [NSLocalizedDescriptionKey: "Could not bind loopback OAuth port \(preferredPort)."]
      )
    }

    var sockAddr = sockaddr_in()
    var sockLen = socklen_t(MemoryLayout<sockaddr_in>.size)
    let nameRes = withUnsafeMutablePointer(to: &sockAddr) { ptr in
      ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
        Darwin.getsockname(fd4, saPtr, &sockLen)
      }
    }
    if nameRes != 0 {
      let code = Int(Darwin.errno)
      Darwin.close(fd4)
      throw NSError(
        domain: "ExpoLoopbackOAuth",
        code: code,
        userInfo: [NSLocalizedDescriptionKey: "Could not read bound loopback port."]
      )
    }

    let actualPort = UInt16(bigEndian: sockAddr.sin_port)
    if Darwin.listen(fd4, 8) != 0 {
      let code = Int(Darwin.errno)
      Darwin.close(fd4)
      throw NSError(
        domain: "ExpoLoopbackOAuth",
        code: code,
        userInfo: [NSLocalizedDescriptionKey: "Could not listen on IPv4 loopback port \(actualPort)."]
      )
    }

    // Best-effort IPv6 loopback listener (::1) on the same port because iOS resolves `localhost` to ::1 first.
    var fd6: Int32 = Darwin.socket(AF_INET6, SOCK_STREAM, IPPROTO_TCP)
    if fd6 >= 0 {
      configureSocketReuse(fd6)
      var v6Only: Int32 = 1
      _ = Darwin.setsockopt(
        fd6,
        IPPROTO_IPV6,
        IPV6_V6ONLY,
        &v6Only,
        socklen_t(MemoryLayout<Int32>.size)
      )
      if bindIpv6(fd: fd6, port: actualPort) != 0 || Darwin.listen(fd6, 8) != 0 {
        Darwin.close(fd6)
        fd6 = -1
      }
    }

    lock.lock()
    sessionToken &+= 1
    let activeToken = sessionToken
    ipv4Fd = fd4
    ipv6Fd = fd6
    boundPort = actualPort
    running = true
    capturedUrl = nil
    pendingPromise = nil
    lock.unlock()

    beginBackgroundHold()

    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      self?.acceptLoop(token: activeToken, fd4: fd4, fd6: fd6, port: actualPort)
    }

    let portInt = Int(actualPort)
    return [
      "port": portInt,
      "redirectUri": "http://localhost:\(portInt)/auth/callback",
      "loopbackIpUri": "http://127.0.0.1:\(portInt)/auth/callback"
    ]
  }

  func waitForCallback(timeoutMs: Int, promise: Promise) {
    lock.lock()
    if let existingUrl = capturedUrl {
      capturedUrl = nil
      lock.unlock()
      promise.resolve(existingUrl)
      return
    }
    guard running else {
      lock.unlock()
      promise.reject("ERR_LOOPBACK_NOT_RUNNING", "Loopback OAuth server is not running.")
      return
    }
    let activeToken = sessionToken
    pendingPromise = promise
    lock.unlock()

    let clampedMs = max(5000, min(600_000, timeoutMs))
    DispatchQueue.global(qos: .utility).asyncAfter(
      deadline: .now() + .milliseconds(clampedMs)
    ) { [weak self] in
      guard let self else { return }
      self.lock.lock()
      guard self.sessionToken == activeToken, let waiter = self.pendingPromise else {
        self.lock.unlock()
        return
      }
      self.pendingPromise = nil
      self.lock.unlock()
      self.stop()
      waiter.reject("ERR_LOOPBACK_TIMEOUT", "Timed out waiting for OAuth callback.")
    }
  }

  func stop() {
    lock.lock()
    running = false
    let fd4 = ipv4Fd
    let fd6 = ipv6Fd
    ipv4Fd = -1
    ipv6Fd = -1
    let waiter = pendingPromise
    pendingPromise = nil
    lock.unlock()

    if fd4 >= 0 {
      Darwin.close(fd4)
    }
    if fd6 >= 0 {
      Darwin.close(fd6)
    }

    endBackgroundHold()
    waiter?.reject("ERR_LOOPBACK_CANCELLED", "Loopback OAuth listener stopped.")
  }

  private func isTokenActive(_ token: UInt64) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return running && sessionToken == token
  }

  private func acceptLoop(token: UInt64, fd4: Int32, fd6: Int32, port: UInt16) {
    while isTokenActive(token) {
      var pfds: [pollfd] = [pollfd(fd: fd4, events: Int16(POLLIN), revents: 0)]
      if fd6 >= 0 {
        pfds.append(pollfd(fd: fd6, events: Int16(POLLIN), revents: 0))
      }

      let ready = Darwin.poll(&pfds, nfds_t(pfds.count), 150)
      if ready <= 0 {
        continue
      }

      for item in pfds where (item.revents & Int16(POLLIN)) != 0 {
        let clientFd = Darwin.accept(item.fd, nil, nil)
        if clientFd < 0 {
          continue
        }
        if let matchedUrl = handleClient(clientFd: clientFd, port: port) {
          finishWithCallbackUrl(token: token, url: matchedUrl)
          return
        }
      }
    }
  }

  private func handleClient(clientFd: Int32, port: UInt16) -> String? {
    defer {
      Darwin.close(clientFd)
    }

    var noSigPipe: Int32 = 1
    _ = Darwin.setsockopt(
      clientFd,
      SOL_SOCKET,
      SO_NOSIGPIPE,
      &noSigPipe,
      socklen_t(MemoryLayout<Int32>.size)
    )

    var timeout = timeval(tv_sec: 2, tv_usec: 0)
    _ = Darwin.setsockopt(
      clientFd,
      SOL_SOCKET,
      SO_RCVTIMEO,
      &timeout,
      socklen_t(MemoryLayout<timeval>.size)
    )

    var buffer = [UInt8](repeating: 0, count: 8192)
    let bytesRead = buffer.withUnsafeMutableBytes { rawBuf -> Int in
      guard let base = rawBuf.baseAddress else { return -1 }
      return Darwin.recv(clientFd, base, rawBuf.count, 0)
    }

    guard bytesRead > 0 else {
      return nil
    }

    let requestText = String(decoding: buffer.prefix(bytesRead), as: UTF8.self)
    let firstLine = requestText.components(separatedBy: "\r\n").first ?? ""
    let parts = firstLine.split(separator: " ")
    guard parts.count >= 2 else {
      sendRawResponse(
        clientFd: clientFd,
        statusLine: "HTTP/1.1 204 No Content",
        contentType: "text/plain; charset=utf-8",
        body: ""
      )
      return nil
    }

    let target = String(parts[1])
    if target.hasPrefix("/favicon.ico") {
      sendRawResponse(
        clientFd: clientFd,
        statusLine: "HTTP/1.1 204 No Content",
        contentType: "text/plain; charset=utf-8",
        body: ""
      )
      return nil
    }

    let isOAuthCallback =
      target.hasPrefix("/auth/callback") ||
      target.hasPrefix("/callback") ||
      target.contains("code=") ||
      target.contains("error=")

    if !isOAuthCallback {
      sendRawResponse(
        clientFd: clientFd,
        statusLine: "HTTP/1.1 204 No Content",
        contentType: "text/plain; charset=utf-8",
        body: ""
      )
      return nil
    }

    let hasError = target.contains("error=")
    let htmlBody = Self.renderResultHtml(ok: !hasError)
    sendRawResponse(
      clientFd: clientFd,
      statusLine: "HTTP/1.1 200 OK",
      contentType: "text/html; charset=utf-8",
      body: htmlBody
    )
    _ = Darwin.shutdown(clientFd, SHUT_WR)

    let normalizedTarget = target.hasPrefix("/") ? target : "/\(target)"
    return "http://localhost:\(port)\(normalizedTarget)"
  }

  private func finishWithCallbackUrl(token: UInt64, url: String) {
    lock.lock()
    guard sessionToken == token else {
      lock.unlock()
      return
    }
    running = false
    let fd4 = ipv4Fd
    let fd6 = ipv6Fd
    ipv4Fd = -1
    ipv6Fd = -1
    let waiter = pendingPromise
    pendingPromise = nil
    if waiter == nil {
      capturedUrl = url
    }
    lock.unlock()

    if fd4 >= 0 {
      Darwin.close(fd4)
    }
    if fd6 >= 0 {
      Darwin.close(fd6)
    }
    endBackgroundHold()
    waiter?.resolve(url)
  }

  private func sendRawResponse(
    clientFd: Int32,
    statusLine: String,
    contentType: String,
    body: String
  ) {
    let bodyBytes = Array(body.utf8)
    let header =
      "\(statusLine)\r\n" +
      "Content-Type: \(contentType)\r\n" +
      "Cache-Control: no-store, no-cache, must-revalidate\r\n" +
      "Connection: close\r\n" +
      "Content-Length: \(bodyBytes.count)\r\n\r\n"
    let allBytes = Array(header.utf8) + bodyBytes
    allBytes.withUnsafeBytes { rawBuf in
      guard let base = rawBuf.baseAddress else { return }
      var sent = 0
      while sent < rawBuf.count {
        let written = Darwin.send(clientFd, base.advanced(by: sent), rawBuf.count - sent, 0)
        if written <= 0 {
          break
        }
        sent += written
      }
    }
  }

  private func configureSocketReuse(_ fd: Int32) {
    var yes: Int32 = 1
    _ = Darwin.setsockopt(
      fd,
      SOL_SOCKET,
      SO_REUSEADDR,
      &yes,
      socklen_t(MemoryLayout<Int32>.size)
    )
    _ = Darwin.setsockopt(
      fd,
      SOL_SOCKET,
      SO_NOSIGPIPE,
      &yes,
      socklen_t(MemoryLayout<Int32>.size)
    )
  }

  private func bindIpv4(fd: Int32, port: UInt16) -> Int32 {
    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = port.bigEndian
    addr.sin_addr = in_addr(s_addr: UInt32(INADDR_LOOPBACK).bigEndian)
    return withUnsafePointer(to: &addr) { ptr in
      ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
        Darwin.bind(fd, saPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
  }

  private func bindIpv6(fd: Int32, port: UInt16) -> Int32 {
    var addr6 = sockaddr_in6()
    addr6.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
    addr6.sin6_family = sa_family_t(AF_INET6)
    addr6.sin6_port = port.bigEndian
    addr6.sin6_addr = in6addr_loopback
    return withUnsafePointer(to: &addr6) { ptr in
      ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
        Darwin.bind(fd, saPtr, socklen_t(MemoryLayout<sockaddr_in6>.size))
      }
    }
  }

  private func beginBackgroundHold() {
    #if os(iOS)
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if self.bgTaskId != .invalid {
        UIApplication.shared.endBackgroundTask(self.bgTaskId)
        self.bgTaskId = .invalid
      }
      self.bgTaskId = UIApplication.shared.beginBackgroundTask(withName: "PlateOAuthLoopback") { [weak self] in
        guard let self else { return }
        if self.bgTaskId != .invalid {
          UIApplication.shared.endBackgroundTask(self.bgTaskId)
          self.bgTaskId = .invalid
        }
      }
    }
    #endif
  }

  private func endBackgroundHold() {
    #if os(iOS)
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if self.bgTaskId != .invalid {
        UIApplication.shared.endBackgroundTask(self.bgTaskId)
        self.bgTaskId = .invalid
      }
    }
    #endif
  }

  private static func renderResultHtml(ok: Bool) -> String {
    let badgeBg = ok ? "#DCFCE7" : "#FEE2E2"
    let badgeColor = ok ? "#16A34A" : "#DC2626"
    let symbol = ok ? "&#10003;" : "!"
    let title = ok ? "Connected to Plate" : "Sign-in Not Completed"
    let subtitle = ok
      ? "Finishing authorization automatically. You can return to Plate now."
      : "Return to Plate to try signing in again."
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Plate Sign-In</title>
      <style>
        body {
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #F5F5F7;
          color: #121216;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          padding: 24px;
          box-sizing: border-box;
        }
        .card {
          max-width: 340px;
          width: 100%;
          background: #FFFFFF;
          border-radius: 26px;
          padding: 28px 24px;
          text-align: center;
          box-shadow: 0 12px 32px rgba(18, 18, 22, 0.08);
        }
        .badge {
          width: 52px;
          height: 52px;
          border-radius: 26px;
          background: \(badgeBg);
          color: \(badgeColor);
          font-size: 24px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 14px;
        }
        h1 {
          margin: 0 0 8px;
          font-size: 20px;
          font-weight: 700;
          letter-spacing: -0.4px;
        }
        p {
          margin: 0 0 20px;
          font-size: 14px;
          line-height: 1.45;
          color: #6E6E77;
        }
        .btn {
          display: inline-block;
          background: #121216;
          color: #FFFFFF;
          text-decoration: none;
          font-weight: 600;
          font-size: 14px;
          padding: 12px 22px;
          border-radius: 999px;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="badge">\(symbol)</div>
        <h1>\(title)</h1>
        <p>\(subtitle)</p>
        <a class="btn" href="calorietracker://">Return to Plate</a>
      </div>
    </body>
    </html>
    """
  }
}

public final class ExpoLoopbackOAuthModule: Module {
  private let server = LoopbackOAuthServer()

  public func definition() -> ModuleDefinition {
    Name("ExpoLoopbackOAuth")

    AsyncFunction("startServerAsync") { (preferredPort: Int, allowFallback: Bool) throws -> [String: Any] in
      return try self.server.start(preferredPort: preferredPort, allowFallback: allowFallback)
    }

    AsyncFunction("waitForCallbackAsync") { (timeoutMs: Int, promise: Promise) in
      self.server.waitForCallback(timeoutMs: timeoutMs, promise: promise)
    }

    AsyncFunction("stopServerAsync") { () in
      self.server.stop()
    }

    OnDestroy {
      self.server.stop()
    }
  }
}
