package com.superessence.lastmarket;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Coque native : héberge le jeu (Three.js) dans une WebView accélérée matériellement,
 * servi depuis une origine https locale (WebViewAssetLoader) pour que les modules,
 * le stockage et les fetch fonctionnent comme sur le web.
 * Fournit un pont "SENative" pour les sauvegardes sur fichiers et l'export de mods.
 */
public class MainActivity extends Activity {
    private static final int REQ_FILE_CHOOSER = 41;
    private static final int REQ_EXPORT = 42;

    private WebView webView;
    private ValueCallback<Uri[]> pendingChooser;
    private String pendingExportContent;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setBackgroundColor(0xFF000000);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAsset(request.getUrl());
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingChooser != null) pendingChooser.onReceiveValue(null);
                pendingChooser = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Importer un pack de mods"), REQ_FILE_CHOOSER);
                } catch (Exception e) {
                    pendingChooser = null;
                    return false;
                }
                return true;
            }
        });
        webView.addJavascriptInterface(new NativeBridge(), "SENative");
        setContentView(webView);
        hideSystemUi();
        webView.loadUrl("https://appassets.androidplatform.net/assets/game/index.html");
    }

    private static final String ORIGIN_HOST = "appassets.androidplatform.net";

    /** Sert les fichiers du dossier assets/ sous une origine https locale (équivalent de WebViewAssetLoader). */
    private WebResourceResponse serveAsset(Uri uri) {
        if (!"https".equals(uri.getScheme()) || !ORIGIN_HOST.equals(uri.getHost())) return null;
        String path = uri.getPath();
        if (path == null || !path.startsWith("/assets/")) return null;
        String rel = path.substring("/assets/".length());
        if (rel.contains("..")) return null;
        try {
            InputStream is = getAssets().open(rel);
            WebResourceResponse r = new WebResourceResponse(mimeFor(rel), mimeFor(rel).startsWith("text") || rel.endsWith(".js") || rel.endsWith(".json") ? "utf-8" : null, is);
            java.util.Map<String, String> h = new java.util.HashMap<>();
            h.put("Access-Control-Allow-Origin", "*");
            h.put("Cache-Control", "no-cache");
            r.setResponseHeaders(h);
            return r;
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
        }
    }

    private static String mimeFor(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ogg")) return "audio/ogg";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".wav")) return "audio/wav";
        return "application/octet-stream";
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.evaluateJavascript("window.__SE_onPause && window.__SE_onPause()", null);
            webView.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript("window.__SE_onBack ? window.__SE_onBack() : false", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER && pendingChooser != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
            pendingChooser.onReceiveValue(result);
            pendingChooser = null;
        } else if (requestCode == REQ_EXPORT) {
            boolean ok = false;
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingExportContent != null) {
                try (OutputStream os = getContentResolver().openOutputStream(data.getData())) {
                    os.write(pendingExportContent.getBytes(StandardCharsets.UTF_8));
                    ok = true;
                } catch (Exception ignored) { }
            }
            pendingExportContent = null;
            webView.evaluateJavascript("window.__SE_onExportDone && window.__SE_onExportDone(" + ok + ")", null);
        }
    }

    private File savesDir(String sub) {
        File d = new File(getFilesDir(), sub);
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static String safeName(String name) {
        return name.replaceAll("[^A-Za-z0-9_.-]", "_");
    }

    /** Pont JS → natif. Tous les fichiers restent dans le stockage privé de l'application. */
    private class NativeBridge {
        @JavascriptInterface
        public boolean writeFile(String dir, String name, String content) {
            File target = new File(savesDir(safeName(dir)), safeName(name));
            File tmp = new File(target.getPath() + ".tmp");
            try (FileOutputStream fos = new FileOutputStream(tmp)) {
                fos.write(content.getBytes(StandardCharsets.UTF_8));
                fos.getFD().sync();
            } catch (Exception e) {
                return false;
            }
            // Écriture atomique : on remplace seulement une fois le fichier complet sur disque.
            return tmp.renameTo(target);
        }

        @JavascriptInterface
        public String readFile(String dir, String name) {
            File f = new File(savesDir(safeName(dir)), safeName(name));
            if (!f.exists()) return null;
            try (InputStream is = new FileInputStream(f)) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
                return bos.toString("UTF-8");
            } catch (Exception e) {
                return null;
            }
        }

        @JavascriptInterface
        public boolean deleteFile(String dir, String name) {
            return new File(savesDir(safeName(dir)), safeName(name)).delete();
        }

        @JavascriptInterface
        public String listFiles(String dir) {
            String[] names = savesDir(safeName(dir)).list();
            StringBuilder sb = new StringBuilder("[");
            if (names != null) {
                for (int i = 0; i < names.length; i++) {
                    if (i > 0) sb.append(',');
                    sb.append('"').append(names[i].replace("\"", "")).append('"');
                }
            }
            return sb.append(']').toString();
        }

        @JavascriptInterface
        public void exportText(String fileName, String content) {
            pendingExportContent = content;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/json");
            i.putExtra(Intent.EXTRA_TITLE, safeName(fileName));
            runOnUiThread(() -> startActivityForResult(i, REQ_EXPORT));
        }

        @JavascriptInterface
        public String platform() {
            return "android-" + Build.VERSION.SDK_INT;
        }
    }
}
