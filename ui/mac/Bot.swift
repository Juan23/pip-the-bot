// Pip's menu bar app: a status item with a popover, and native windows for the chat and the journal.
// All content is the local server's web pages (ui/server.ts). Build: ui/mac/build.sh → ui/Bot.app.
import AppKit
import WebKit

let base = URL(string: "http://127.0.0.1:7377")!

final class App: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
  var item: NSStatusItem!
  let popover = NSPopover()
  var windows: [String: NSWindow] = [:]
  var server: Process?  // set only when this app started the server, so quitting never stops someone else's
  var retries: [WKWebView: Int] = [:]

  func applicationDidFinishLaunching(_ note: Notification) {
    if !serverAnswers() { startServer() }
    NSApp.mainMenu = mainMenu()

    item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    let button = item.button!
    button.image = robotIcon()
    button.setAccessibilityLabel("Pip")
    button.target = self
    button.action = #selector(statusClicked)
    button.sendAction(on: [.leftMouseUp, .rightMouseUp])

    let web = webView("/popover")
    let vc = NSViewController()
    vc.view = web
    popover.contentViewController = vc
    popover.contentSize = NSSize(width: 380, height: 560)
    popover.behavior = .transient
  }

  var quitting = false

  func applicationWillTerminate(_ note: Notification) {
    quitting = true
    server?.terminate()
  }

  // MARK: server

  func serverAnswers() -> Bool {
    var request = URLRequest(url: base.appendingPathComponent("api/state"))
    request.timeoutInterval = 1
    let done = DispatchSemaphore(value: 0)
    var ok = false
    URLSession.shared.dataTask(with: request) { _, response, _ in
      ok = (response as? HTTPURLResponse)?.statusCode == 200
      done.signal()
    }.resume()
    done.wait()
    return ok
  }

  func startServer() {
    // Bot.app lives in <bot>/ui/, next to the `bot` script's folder.
    let bot = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("bot")
    let p = Process()
    p.executableURL = bot
    p.arguments = ["serve"]
    // If the server dies (crash, killed), start it again unless the app is quitting or another server took the port.
    p.terminationHandler = { [weak self] _ in
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
        guard let self, !self.quitting else { return }
        self.server = nil
        if !self.serverAnswers() { self.startServer() }
      }
    }
    do { try p.run(); server = p } catch { NSLog("Bot: couldn't start \(bot.path) serve: \(error)") }
  }

  // MARK: web views

  func webView(_ path: String) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.userContentController.add(self, name: "bot")
    let web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.load(URLRequest(url: URL(string: path, relativeTo: base)!))
    return web
  }

  // The server may be starting or restarting: retry a failed load, quickly at first, then every 5 seconds.
  func webView(_ web: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) {
    let n = retries[web, default: 0]
    guard let url = (error as NSError).userInfo[NSURLErrorFailingURLErrorKey] as? URL else { return }
    retries[web] = n + 1
    DispatchQueue.main.asyncAfter(deadline: .now() + (n < 30 ? 0.5 : 5)) { web.load(URLRequest(url: url)) }
  }

  func webView(_ web: WKWebView, didFinish nav: WKNavigation!) { retries[web] = nil }

  // Pages ask for native windows with window.webkit.messageHandlers.bot.postMessage({ open: "/journal" }).
  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.frameInfo.securityOrigin.host == base.host,
          let path = (message.body as? [String: Any])?["open"] as? String,
          let url = URL(string: path, relativeTo: base), url.host == base.host, url.port == base.port
    else { return }
    popover.performClose(nil)
    open(url)
  }

  // MARK: windows

  func open(_ url: URL) {
    let key = url.path.isEmpty ? "/" : url.path
    if let w = windows[key] {
      w.makeKeyAndOrderFront(nil)
    } else {
      let journal = key == "/journal"
      let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: journal ? 1000 : 1100, height: 760),
                       styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
      w.title = journal ? "Pip · Journal" : "Pip"
      w.isReleasedWhenClosed = false
      w.contentView = webView(url.absoluteString)
      w.delegate = self
      w.setFrameAutosaveName("Bot " + key)
      if !w.setFrameUsingName("Bot " + key) { w.center() }
      windows[key] = w
      w.makeKeyAndOrderFront(nil)
    }
    NSApp.activate()
  }

  func windowWillClose(_ note: Notification) {
    let w = note.object as! NSWindow
    retries[w.contentView as! WKWebView] = nil
    windows = windows.filter { $0.value !== w }  // drop it so its page stops polling
  }

  // MARK: status item

  @objc func statusClicked(_ sender: NSStatusBarButton) {
    let event = NSApp.currentEvent
    if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true {
      popover.performClose(nil)
      let menu = NSMenu()
      menu.addItem(withTitle: "Open chat window", action: #selector(openChat), keyEquivalent: "").target = self
      menu.addItem(withTitle: "Open journal", action: #selector(openJournal), keyEquivalent: "").target = self
      menu.addItem(.separator())
      menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate), keyEquivalent: "q")
      menu.popUp(positioning: nil, at: NSPoint(x: 0, y: sender.bounds.maxY + 4), in: sender)
    } else if popover.isShown {
      popover.performClose(nil)
    } else {
      popover.show(relativeTo: sender.bounds, of: sender, preferredEdge: .minY)
      NSApp.activate()  // so the composer takes typing
      popover.contentViewController?.view.window?.makeKey()
    }
  }

  @objc func openChat() { open(base.appendingPathComponent("/")) }
  @objc func openJournal() { open(base.appendingPathComponent("journal")) }

  // An agent app shows no menu bar, but the menu's shortcuts still work: copy, paste, undo, close, quit.
  func mainMenu() -> NSMenu {
    let main = NSMenu()
    func submenu(_ title: String, _ items: [(String, Selector, String)]) {
      let menu = NSMenu(title: title)
      for (t, a, k) in items { menu.addItem(withTitle: t, action: a, keyEquivalent: k) }
      main.addItem(withTitle: title, action: nil, keyEquivalent: "").submenu = menu
    }
    submenu("Bot", [("Quit", #selector(NSApplication.terminate), "q")])
    submenu("Edit", [("Undo", Selector(("undo:")), "z"), ("Redo", Selector(("redo:")), "Z"),
                     ("Cut", #selector(NSText.cut), "x"), ("Copy", #selector(NSText.copy(_:)), "c"),
                     ("Paste", #selector(NSText.paste), "v"), ("Select All", #selector(NSText.selectAll), "a")])
    submenu("Window", [("Close", #selector(NSWindow.performClose), "w"), ("Minimize", #selector(NSWindow.performMiniaturize), "m")])
    return main
  }
}

// The mockup's robot glyph (24-pt grid), drawn as a template image so it follows the menu bar's color.
func robotIcon() -> NSImage {
  let image = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { _ in
    let t = NSAffineTransform()
    t.scale(by: 18.0 / 24.0)
    t.concat()
    NSColor.black.set()
    let head = NSBezierPath(roundedRect: NSRect(x: 4, y: 7, width: 16, height: 12), xRadius: 4, yRadius: 4)
    head.move(to: NSPoint(x: 12, y: 7))
    head.line(to: NSPoint(x: 12, y: 4))
    head.lineWidth = 1.8
    head.lineCapStyle = .round
    head.stroke()
    NSBezierPath(ovalIn: NSRect(x: 7.9, y: 11.9, width: 2.2, height: 2.2)).fill()
    NSBezierPath(ovalIn: NSRect(x: 13.9, y: 11.9, width: 2.2, height: 2.2)).fill()
    return true
  }
  image.isTemplate = true
  image.accessibilityDescription = "Pip"
  return image
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
