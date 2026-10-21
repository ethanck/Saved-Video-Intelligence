import Social
import UniformTypeIdentifiers

/// Native iOS share-sheet entry point. Heavy processing stays in the backend.
/// The Xcode target and authenticated transport are intentionally wired in a later
/// milestone so this source can be reviewed independently of the Expo bundle.
final class ShareViewController: SLComposeServiceViewController {
    override func isContentValid() -> Bool {
        true
    }

    override func didSelectPost() {
        guard let extensionItem = extensionContext?.inputItems
            .compactMap({ $0 as? NSExtensionItem })
            .first,
            let provider = extensionItem.attachments?.first else {
            finish()
            return
        }

        let supportedTypes = [UTType.url.identifier, UTType.plainText.identifier]
        guard let typeIdentifier = supportedTypes.first(where: { provider.hasItemConformingToTypeIdentifier($0) }) else {
            finish()
            return
        }

        provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { [weak self] item, _ in
            let url: URL?
            let text: String?

            if let sharedURL = item as? URL {
                url = sharedURL
                text = nil
            } else if let sharedText = item as? String {
                url = nil
                text = sharedText
            } else {
                url = nil
                text = nil
            }

            // TODO: send `{ url, text, sourceApp: "ios-share-extension" }`
            // through an authenticated transport. Never put provider API keys in
            // this target; the API owns authentication and processing.
            _ = url
            _ = text
            DispatchQueue.main.async {
                self?.finish()
            }
        }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}
