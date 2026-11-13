import UIKit
import WebKit

class ViewController: UIViewController, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {

    private var webView: WKWebView!

    override var prefersStatusBarHidden: Bool {
        return true
    }

    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge {
        return .all
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        return [.landscapeLeft, .landscapeRight]
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 9.0/255.0, green: 13.0/255.0, blue: 22.0/255.0, alpha: 1.0)

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        if #available(iOS 15.4, *) {
            config.preferences.isElementFullscreenEnabled = true
        }

        let contentController = WKUserContentController()
        contentController.add(self, name: "wptb")

        // Preload saved preferences from UserDefaults into window.__APPLE_PREFS__
        let defaults = UserDefaults.standard
        let lang = defaults.string(forKey: "wptb_lang") ?? "el"
        let customTactics = defaults.string(forKey: "wptb_custom_tactics_v1") ?? "[]"
        let escapedTactics = customTactics
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")

        let initScriptSource = """
        window.__APPLE_PREFS__ = {
            'wptb_lang': '\(lang)',
            'wptb_custom_tactics_v1': '\(escapedTactics)'
        };
        """
        let userScript = WKUserScript(source: initScriptSource, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        contentController.addUserScript(userScript)
        config.userContentController = contentController

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 9.0/255.0, green: 13.0/255.0, blue: 22.0/255.0, alpha: 1.0)
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.uiDelegate = self
        webView.navigationDelegate = self

        view.addSubview(webView)

        if let indexUrl = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "WebAssets") {
            let assetsDir = indexUrl.deletingLastPathComponent()
            webView.loadFileURL(indexUrl, allowingReadAccessTo: assetsDir)
        }
    }

    // MARK: - WKScriptMessageHandler (Save PNG, Save JSON, Save Preferences)
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "wptb", let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }

        if action == "setPref" {
            if let key = body["key"] as? String, let val = body["value"] as? String {
                UserDefaults.standard.set(val, forKey: key)
            }
        } else if action == "saveImage" {
            guard let dataUrl = body["dataUrl"] as? String,
                  let fileName = body["fileName"] as? String else { return }
            saveAndShareImage(dataUrl: dataUrl, fileName: fileName)
        } else if action == "saveJson" {
            guard let jsonContent = body["jsonContent"] as? String,
                  let fileName = body["fileName"] as? String else { return }
            saveAndShareJson(jsonContent: jsonContent, fileName: fileName)
        }
    }

    private func saveAndShareImage(dataUrl: String, fileName: String) {
        let base64Part: String
        if let commaRange = dataUrl.range(of: ",") {
            base64Part = String(dataUrl[commaRange.upperBound...])
        } else {
            base64Part = dataUrl
        }
        guard let data = Data(base64Encoded: base64Part, options: .ignoreUnknownCharacters) else { return }

        let tempUrl = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        try? data.write(to: tempUrl)

        presentShareSheet(fileUrl: tempUrl)
    }

    private func saveAndShareJson(jsonContent: String, fileName: String) {
        guard let data = jsonContent.data(using: .utf8) else { return }
        let tempUrl = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        try? data.write(to: tempUrl)

        presentShareSheet(fileUrl: tempUrl)
    }

    private func presentShareSheet(fileUrl: URL) {
        DispatchQueue.main.async {
            let activityVC = UIActivityViewController(activityItems: [fileUrl], applicationActivities: nil)
            if let popover = activityVC.popoverPresentationController {
                popover.sourceView = self.view
                popover.sourceRect = CGRect(x: self.view.bounds.midX, y: self.view.bounds.midY, width: 1, height: 1)
                popover.permittedArrowDirections = []
            }
            self.present(activityVC, animated: true)
        }
    }

    // MARK: - WKUIDelegate (Native iOS Alert, Confirm, Prompt Dialogs)
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "Πινακάκι Πόλο", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "Πινακάκι Πόλο", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Ναι", style: .default) { _ in completionHandler(true) })
        alert.addAction(UIAlertAction(title: "Άκυρο", style: .cancel) { _ in completionHandler(false) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: "Πινακάκι Πόλο", message: prompt, preferredStyle: .alert)
        alert.addTextField { textField in
            textField.text = defaultText
        }
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            completionHandler(alert.textFields?.first?.text)
        })
        alert.addAction(UIAlertAction(title: "Άκυρο", style: .cancel) { _ in
            completionHandler(nil)
        })
        present(alert, animated: true)
    }
}
