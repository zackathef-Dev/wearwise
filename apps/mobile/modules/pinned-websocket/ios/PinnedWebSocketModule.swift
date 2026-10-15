import CryptoKit
import ExpoModulesCore
import Foundation

/*
 * iOS twin of the Android module: a wss:// WebSocket that trusts exactly ONE
 * certificate — the sensor's own self-signed one, identified by the SHA-256 of its
 * DER encoding, which the app read over Bluetooth. Any other certificate is refused.
 *
 * NOTE: written on Windows and not yet compiled; build and test it on a Mac (Xcode)
 * before relying on it. It mirrors the Android logic, which is device-tested.
 */
public class PinnedWebSocketModule: Module {
  private var sockets: [String: PinnedSocket] = [:]
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("PinnedWebSocket")
    Events("onOpen", "onMessage", "onClose", "onError")

    Function("connect") { (id: String, url: String, pinSha256Hex: String) in
      guard let target = URL(string: url) else {
        self.sendEvent("onError", ["id": id, "message": "invalid URL", "pinMismatch": false])
        return
      }
      let socket = PinnedSocket(id: id, url: target, pin: pinSha256Hex.lowercased(), module: self)
      self.lock.lock(); self.sockets[id] = socket; self.lock.unlock()
      socket.start()
    }

    Function("send") { (id: String, text: String) -> Bool in
      self.lock.lock(); let socket = self.sockets[id]; self.lock.unlock()
      socket?.send(text)
      return socket != nil
    }

    Function("close") { (id: String) in
      self.lock.lock(); let socket = self.sockets.removeValue(forKey: id); self.lock.unlock()
      socket?.close()
    }
  }

  fileprivate func emit(_ name: String, _ body: [String: Any]) { sendEvent(name, body) }
  fileprivate func forget(_ id: String) { lock.lock(); sockets.removeValue(forKey: id); lock.unlock() }
}

final class PinnedSocket: NSObject, URLSessionWebSocketDelegate {
  private let id: String
  private let url: URL
  private let pin: String
  private weak var module: PinnedWebSocketModule?
  private var session: URLSession?
  private var task: URLSessionWebSocketTask?
  private var pinMismatch = false

  init(id: String, url: URL, pin: String, module: PinnedWebSocketModule) {
    self.id = id; self.url = url; self.pin = pin; self.module = module
  }

  func start() {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 6
    let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    self.session = session
    let task = session.webSocketTask(with: url)
    self.task = task
    task.resume()
    receive()
  }

  private func receive() {
    task?.receive { [weak self] result in
      guard let self = self else { return }
      switch result {
      case .success(.data(let data)):
        self.module?.emit("onMessage", ["id": self.id, "data": data.base64EncodedString()])
        self.receive()
      case .success:
        self.receive() // text frames are not used by the sensor
      case .failure(let error):
        self.module?.emit("onError", ["id": self.id, "message": error.localizedDescription, "pinMismatch": self.pinMismatch])
        self.module?.forget(self.id)
        self.session?.invalidateAndCancel()
      }
    }
  }

  func send(_ text: String) {
    task?.send(.string(text)) { _ in }
  }

  func close() {
    task?.cancel(with: .normalClosure, reason: nil)
    session?.invalidateAndCancel()
  }

  // MARK: certificate pinning

  func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                  completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          let trust = challenge.protectionSpace.serverTrust,
          let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
          let leaf = chain.first else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    let der = SecCertificateCopyData(leaf) as Data
    let actual = SHA256.hash(data: der).map { String(format: "%02x", $0) }.joined()
    if actual == pin {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      pinMismatch = true
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }

  // MARK: lifecycle

  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
    module?.emit("onOpen", ["id": id])
  }

  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                  didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
    module?.emit("onClose", ["id": id, "code": closeCode.rawValue])
    module?.forget(id)
  }
}
