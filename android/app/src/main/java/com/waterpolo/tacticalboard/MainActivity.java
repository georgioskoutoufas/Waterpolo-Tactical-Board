package com.waterpolo.tacticalboard;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {

    static final int FILE_CHOOSER_RESULT_CODE = 1001;
    private WebView webView;
    ValueCallback<Uri[]> filePathCallback;
    private long lastBackPressTime = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Force landscape orientation on Android launch
        try {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        } catch (Exception ignored) {}

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.parseColor("#090d16"));
        getWindow().setNavigationBarColor(Color.parseColor("#090d16"));
        enableImmersiveFullscreen();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#090d16"));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);

        String defaultUa = settings.getUserAgentString();
        if (defaultUa != null && defaultUa.contains("; wv")) {
            settings.setUserAgentString(defaultUa.replace("; wv", ""));
        }

        webView.clearCache(true);
        webView.addJavascriptInterface(new AndroidBridge(this), "AndroidApp");
        webView.setWebViewClient(new AppWebViewClient());
        webView.setWebChromeClient(new AppWebChromeClient(this));

        webView.loadUrl("file:///android_asset/index.html");

        if (Build.VERSION.SDK_INT >= 33) {
            try {
                getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    new AppBackInvokedCallback(this)
                );
            } catch (Exception ignored) {}
        }
    }

    static class AppWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return false;
        }
    }

    static class JsResultConfirmListener implements DialogInterface.OnClickListener {
        private final JsResult result;
        private final boolean confirm;

        JsResultConfirmListener(JsResult result, boolean confirm) {
            this.result = result;
            this.confirm = confirm;
        }

        @Override
        public void onClick(DialogInterface dialog, int which) {
            if (confirm) {
                result.confirm();
            } else {
                result.cancel();
            }
        }
    }

    static class JsResultCancelListener implements DialogInterface.OnCancelListener {
        private final JsResult result;

        JsResultCancelListener(JsResult result) {
            this.result = result;
        }

        @Override
        public void onCancel(DialogInterface dialog) {
            result.cancel();
        }
    }

    static class JsPromptClickListener implements DialogInterface.OnClickListener {
        private final JsPromptResult result;
        private final EditText input;
        private final boolean confirm;

        JsPromptClickListener(JsPromptResult result, EditText input, boolean confirm) {
            this.result = result;
            this.input = input;
            this.confirm = confirm;
        }

        @Override
        public void onClick(DialogInterface dialog, int which) {
            if (confirm) {
                result.confirm(input.getText().toString());
            } else {
                result.cancel();
            }
        }
    }

    static class AppWebChromeClient extends WebChromeClient {
        private final MainActivity activity;

        AppWebChromeClient(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
            WebView newWebView = new WebView(activity);
            WebSettings newSettings = newWebView.getSettings();
            newSettings.setJavaScriptEnabled(true);
            newSettings.setDomStorageEnabled(true);
            newSettings.setDatabaseEnabled(true);
            newSettings.setSupportZoom(true);
            newSettings.setBuiltInZoomControls(true);
            newSettings.setDisplayZoomControls(false);

            String ua = newSettings.getUserAgentString();
            if (ua != null && ua.contains("; wv")) {
                newSettings.setUserAgentString(ua.replace("; wv", ""));
            }

            final android.app.Dialog dialog = new android.app.Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
            dialog.setContentView(newWebView);
            dialog.show();

            newWebView.setWebChromeClient(new PopupWebChromeClient(dialog));
            newWebView.setWebViewClient(new PopupWebViewClient());

            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(newWebView);
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            new AlertDialog.Builder(activity)
                    .setTitle("Πινακάκι Πόλο")
                    .setMessage(message)
                    .setPositiveButton("OK", new JsResultConfirmListener(result, true))
                    .setOnCancelListener(new JsResultCancelListener(result))
                    .show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            new AlertDialog.Builder(activity)
                    .setTitle("Πινακάκι Πόλο")
                    .setMessage(message)
                    .setPositiveButton("Ναι", new JsResultConfirmListener(result, true))
                    .setNegativeButton("Άκυρο", new JsResultConfirmListener(result, false))
                    .setOnCancelListener(new JsResultCancelListener(result))
                    .show();
            return true;
        }

        @Override
        public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
            EditText input = new EditText(activity);
            input.setText(defaultValue != null ? defaultValue : "");
            input.setSingleLine(true);

            new AlertDialog.Builder(activity)
                    .setTitle("Πινακάκι Πόλο")
                    .setMessage(message)
                    .setView(input)
                    .setPositiveButton("OK", new JsPromptClickListener(result, input, true))
                    .setNegativeButton("Άκυρο", new JsPromptClickListener(result, input, false))
                    .setOnCancelListener(new JsResultCancelListener(result))
                    .show();
            return true;
        }

        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams fileChooserParams) {
            if (activity.filePathCallback != null) {
                activity.filePathCallback.onReceiveValue(null);
            }
            activity.filePathCallback = callback;

            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            String[] mimeTypes = {"application/json", "image/png", "image/*", "text/plain", "application/octet-stream"};
            intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);

            try {
                activity.startActivityForResult(Intent.createChooser(intent, "Επιλογή Αρχείου Τακτικής (.json / .png)"), FILE_CHOOSER_RESULT_CODE);
            } catch (Exception e) {
                activity.filePathCallback = null;
                return false;
            }
            return true;
        }
    }

    static class PopupWebChromeClient extends WebChromeClient {
        private final android.app.Dialog dialog;

        PopupWebChromeClient(android.app.Dialog dialog) {
            this.dialog = dialog;
        }

        @Override
        public void onCloseWindow(WebView window) {
            try {
                if (dialog != null && dialog.isShowing()) {
                    dialog.dismiss();
                }
            } catch (Exception ignored) {}
        }
    }

    static class PopupWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_RESULT_CODE) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                String dataString = data.getDataString();
                if (dataString != null) {
                    results = new Uri[]{Uri.parse(dataString)};
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    private void enableImmersiveFullscreen() {
        View decorView = getWindow().getDecorView();
        decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
        );
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableImmersiveFullscreen();
        }
    }

    private AlertDialog exitConfirmDialogInstance = null;

    static class AppBackInvokedCallback implements android.window.OnBackInvokedCallback {
        private final MainActivity activity;

        AppBackInvokedCallback(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public void onBackInvoked() {
            activity.handleBackAction();
        }
    }

    static class HandleBackActionRunnable implements Runnable {
        private final MainActivity activity;

        HandleBackActionRunnable(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public void run() {
            if (activity.webView != null) {
                activity.webView.loadUrl(
                    "javascript:(function(){\n" +
                    "  try {\n" +
                    "    if (typeof window.handleAndroidBack === 'function') {\n" +
                    "      window.handleAndroidBack();\n" +
                    "    } else if (window.AndroidApp && typeof window.AndroidApp.promptExitConfirm === 'function') {\n" +
                    "      window.AndroidApp.promptExitConfirm('Έξοδος από την Εφαρμογή', 'Είστε βέβαιοι ότι θέλετε να κλείσετε το Πινακάκι Τακτικής;', 'Έξοδος', 'Ακύρωση');\n" +
                    "    }\n" +
                    "  } catch(e) {\n" +
                    "    if (window.AndroidApp && typeof window.AndroidApp.promptExitConfirm === 'function') {\n" +
                    "      window.AndroidApp.promptExitConfirm('Έξοδος από την Εφαρμογή', 'Είστε βέβαιοι ότι θέλετε να κλείσετε το Πινακάκι Τακτικής;', 'Έξοδος', 'Ακύρωση');\n" +
                    "    }\n" +
                    "  }\n" +
                    "})()"
                );
            } else {
                activity.showExitConfirmDialog("Έξοδος από την Εφαρμογή", "Είστε βέβαιοι ότι θέλετε να κλείσετε το Πινακάκι Τακτικής;", "Έξοδος", "Ακύρωση");
            }
        }
    }

    public void handleBackAction() {
        runOnUiThread(new HandleBackActionRunnable(this));
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) {
                handleBackAction();
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            event.startTracking();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && event.isTracking() && !event.isCanceled()) {
            handleBackAction();
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    @Override
    public void onBackPressed() {
        handleBackAction();
    }

    static class PromptExitTask implements Runnable {
        private final MainActivity activity;
        private final String title;
        private final String msg;
        private final String exitBtn;
        private final String cancelBtn;

        PromptExitTask(MainActivity activity, String title, String msg, String exitBtn, String cancelBtn) {
            this.activity = activity;
            this.title = title;
            this.msg = msg;
            this.exitBtn = exitBtn;
            this.cancelBtn = cancelBtn;
        }

        @Override
        public void run() {
            activity.showExitConfirmDialog(title, msg, exitBtn, cancelBtn);
        }
    }

    static class FinishAppTask implements Runnable {
        private final MainActivity activity;

        FinishAppTask(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public void run() {
            activity.finish();
        }
    }

    static class ExitConfirmClickListener implements DialogInterface.OnClickListener {
        private final MainActivity activity;

        ExitConfirmClickListener(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public void onClick(DialogInterface dialog, int which) {
            activity.finish();
        }
    }

    static class ExitCancelClickListener implements DialogInterface.OnClickListener, DialogInterface.OnCancelListener {
        private final MainActivity activity;

        ExitCancelClickListener(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public void onClick(DialogInterface dialog, int which) {
            activity.enableImmersiveFullscreen();
        }

        @Override
        public void onCancel(DialogInterface dialog) {
            activity.enableImmersiveFullscreen();
        }
    }

    void showExitConfirmDialog(String title, String msg, String exitBtn, String cancelBtn) {
        if (exitConfirmDialogInstance != null && exitConfirmDialogInstance.isShowing()) {
            return;
        }
        ExitCancelClickListener cancelListener = new ExitCancelClickListener(this);
        exitConfirmDialogInstance = new AlertDialog.Builder(this)
                .setTitle(title != null && !title.isEmpty() ? title : "Έξοδος από την Εφαρμογή")
                .setMessage(msg != null && !msg.isEmpty() ? msg : "Είστε βέβαιοι ότι θέλετε να κλείσετε το Πινακάκι Τακτικής;")
                .setPositiveButton(exitBtn != null && !exitBtn.isEmpty() ? exitBtn : "Έξοδος", new ExitConfirmClickListener(this))
                .setNegativeButton(cancelBtn != null && !cancelBtn.isEmpty() ? cancelBtn : "Ακύρωση", cancelListener)
                .setOnCancelListener(cancelListener)
                .create();
        exitConfirmDialogInstance.show();
    }

    static class ShareTacticTask implements Runnable {
        private final MainActivity activity;
        private final String jsonContent;
        private final String fileName;
        private final String title;

        ShareTacticTask(MainActivity activity, String jsonContent, String fileName, String title) {
            this.activity = activity;
            this.jsonContent = jsonContent;
            this.fileName = fileName;
            this.title = title;
        }

        @Override
        public void run() {
            try {
                byte[] bytes = jsonContent.getBytes(StandardCharsets.UTF_8);
                String subFolder = "WaterPoloBoard/Tactics";
                Uri uri = null;

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                    values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + subFolder);

                    ContentResolver resolver = activity.getContentResolver();
                    uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        OutputStream out = resolver.openOutputStream(uri);
                        if (out != null) {
                            out.write(bytes);
                            out.flush();
                            out.close();
                        }
                    }
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), subFolder);
                    if (!dir.exists()) dir.mkdirs();
                    File file = new File(dir, fileName);
                    FileOutputStream fos = new FileOutputStream(file);
                    fos.write(bytes);
                    fos.flush();
                    fos.close();
                    uri = Uri.fromFile(file);
                }

                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType("*/*");
                if (uri != null) {
                    shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
                    shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                }
                shareIntent.putExtra(Intent.EXTRA_SUBJECT, "Τακτική Πόλο: " + title);
                shareIntent.putExtra(Intent.EXTRA_TEXT, "Τακτική Πόλο: " + title);

                Intent chooser = Intent.createChooser(shareIntent, "Κοινοποίηση Τακτικής μέσω:");
                activity.startActivity(chooser);

            } catch (Exception e) {
                Toast.makeText(activity, "Σφάλμα κοινοποίησης: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    }

    static class SaveJsonTask implements Runnable {
        private final MainActivity activity;
        private final String jsonContent;
        private final String fileName;

        SaveJsonTask(MainActivity activity, String jsonContent, String fileName) {
            this.activity = activity;
            this.jsonContent = jsonContent;
            this.fileName = fileName;
        }

        @Override
        public void run() {
            try {
                byte[] bytes = jsonContent.getBytes(StandardCharsets.UTF_8);
                String subFolder = "WaterPoloBoard/Tactics";
                String locationText = "Downloads > WaterPoloBoard > Tactics";

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                    values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + subFolder);

                    ContentResolver resolver = activity.getContentResolver();
                    Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        OutputStream out = resolver.openOutputStream(uri);
                        if (out != null) {
                            out.write(bytes);
                            out.flush();
                            out.close();
                        }
                    }
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), subFolder);
                    if (!dir.exists()) dir.mkdirs();
                    File file = new File(dir, fileName);
                    FileOutputStream fos = new FileOutputStream(file);
                    fos.write(bytes);
                    fos.flush();
                    fos.close();
                }

                new AlertDialog.Builder(activity)
                        .setTitle("💾 Αποθήκευση Τακτικής")
                        .setMessage("Η τακτική αποθηκεύτηκε επιτυχώς!\n\n📁 Φάκελος:\n" + locationText + "\n\n📄 Αρχείο:\n" + fileName)
                        .setPositiveButton("OK", null)
                        .show();

            } catch (Exception e) {
                Toast.makeText(activity, "Σφάλμα αποθήκευσης αρχείου: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    }

    public static class AndroidBridge {
        private final MainActivity activity;

        AndroidBridge(MainActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public void saveImage(String dataUrl, String fileName) {
            // Deprecated - image export removed in favor of native screenshots
        }

        @JavascriptInterface
        public void saveJson(String jsonContent, String fileName) {
            activity.runOnUiThread(new SaveJsonTask(activity, jsonContent, fileName));
        }

        @JavascriptInterface
        public void shareTactic(String jsonContent, String fileName, String title) {
            activity.runOnUiThread(new ShareTacticTask(activity, jsonContent, fileName, title));
        }

        @JavascriptInterface
        public void promptExitConfirm(String title, String msg, String exitBtn, String cancelBtn) {
            activity.runOnUiThread(new PromptExitTask(activity, title, msg, exitBtn, cancelBtn));
        }

        @JavascriptInterface
        public void exitApp() {
            activity.runOnUiThread(new FinishAppTask(activity));
        }

        @JavascriptInterface
        public String getPref(String key) {
            try {
                SharedPreferences prefs = activity.getSharedPreferences("WaterPoloPrefs", MODE_PRIVATE);
                return prefs.getString(key, "");
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void setPref(String key, String value) {
            try {
                SharedPreferences prefs = activity.getSharedPreferences("WaterPoloPrefs", MODE_PRIVATE);
                prefs.edit().putString(key, value != null ? value : "").apply();
            } catch (Exception e) {
            }
        }
    }
}
