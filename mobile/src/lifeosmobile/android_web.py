"""Android WebView file chooser and origin-scoped camera/microphone permissions."""
from android.content import Intent
from android.webkit import PermissionRequest, ValueCallback, WebChromeClient, WebView
from java import Override, jboolean, jvoid, static_proxy
from java.lang import String


class LifeOSChrome(static_proxy(WebChromeClient)):
    def __init__(self, app):
        self.app = app
        self.pending_file = None
        super().__init__()

    @Override(jboolean, [WebView, ValueCallback, WebChromeClient.FileChooserParams])
    def onShowFileChooser(self, webview, callback, params):
        if self.pending_file:
            self.pending_file.onReceiveValue(None)
        self.pending_file = callback
        intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
        intent.addCategory(Intent.CATEGORY_OPENABLE)
        types = [str(value) for value in params.getAcceptTypes() if value]
        intent.setType(types[0] if len(types) == 1 else '*/*')
        if len(types) > 1:
            from java import jarray
            intent.putExtra(Intent.EXTRA_MIME_TYPES, jarray(String)(types))
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == 1)

        def completed(result, data):
            callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data))
            self.pending_file = None
        self.app._impl.start_activity(intent, on_complete=completed)
        return True

    @Override(jvoid, [PermissionRequest])
    def onPermissionRequest(self, request):
        runtime = self.app.runtime
        if not runtime or str(request.getOrigin()).rstrip('/') != runtime.origin:
            request.deny()
            return
        permissions = []
        resources = [str(value) for value in request.getResources()]
        if PermissionRequest.RESOURCE_AUDIO_CAPTURE in resources:
            permissions.append('android.permission.RECORD_AUDIO')
        if PermissionRequest.RESOURCE_VIDEO_CAPTURE in resources:
            permissions.append('android.permission.CAMERA')
        if not permissions:
            request.deny()
            return

        def completed(names, results):
            if all(value == 0 for value in results):
                request.grant(request.getResources())
            else:
                request.deny()
        self.app._impl.request_permissions(permissions, on_complete=completed)


def configure(app):
    view = app.web._impl.native
    app.chrome = LifeOSChrome(app)
    view.setWebChromeClient(app.chrome)
    view.getSettings().setMediaPlaybackRequiresUserGesture(False)
    view.getSettings().setAllowFileAccess(False)
    view.getSettings().setAllowContentAccess(True)
