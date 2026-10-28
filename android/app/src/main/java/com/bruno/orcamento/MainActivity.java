package com.bruno.orcamento;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;

/**
 * Casca do app Orçamento: uma tela com uma WebView que abre o app hospedado no GitHub Pages.
 *
 * Por que assim: tudo que aparece na tela (telas, cálculos, regras) vem da internet a cada
 * abertura. Quando você sobe uma versão nova para o GitHub, o celular pega sozinho, sem
 * reinstalar nada. Esta casca só precisa ser refeita se você mudar ESTE arquivo, o ícone ou
 * o endereço do app (que o GitHub Actions preenche sozinho a partir do seu repositório).
 *
 * Sem internet ou com sinal travado: abre a "abertura de emergência" (cópia do index.html que vai
 * dentro do APK, em assets/) e o próprio app usa a última versão que já tinha guardado. Só se nem
 * isso for possível (primeiro uso sem internet) aparece o aviso com o botão "Tentar de novo".
 *
 * Segurança desta casca (o app tem valores da família):
 *  - tela protegida: sem print, sem gravação de tela e sem miniatura na lista de apps recentes;
 *  - só o endereço do app abre aqui dentro; qualquer outro link vai para o navegador;
 *  - o próprio Android barra conexões para qualquer site que não seja o do app ou o Supabase;
 *  - sem acesso a arquivos do celular, sem janelas extras, sem depuração remota no APK final;
 *  - sem backup na nuvem nem transferência de dados para outro aparelho.
 */
public class MainActivity extends Activity {

    // Endereço do app. Vem do build (ORC_START_URL): no GitHub Actions é montado sozinho com o
    // seu usuário e o nome do repositório. Para mudar à mão, veja o LEIA-ME.
    private static final String START_URL = BuildConfig.START_URL;

    // true = a tela do app não aparece em print, gravação de tela nem na lista de apps recentes.
    // Se um dia quiser tirar print do app, troque por false e gere o APK de novo.
    private static final boolean TELA_PROTEGIDA = true;

    // Evita um laço de recriação se o motor da página cair de novo logo depois de reiniciar.
    private static long lastRendererLoss = 0L;

    private WebView web;
    private View offlineBox;
    private Uri startUri;
    private String startNoSlash;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;

    // "Abertura de emergência": cópia do index.html que vem dentro do APK (assets/index.html).
    private String launcherHtml;
    private boolean fallbackTried;
    private boolean pageFinished;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            // 10 s e a página inicial ainda não chegou (sinal travado): usa a abertura de emergência
            if (!pageFinished) loadLauncher();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (TELA_PROTEGIDA) {
            getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        }
        startUri = Uri.parse(START_URL);
        startNoSlash = START_URL.endsWith("/") ? START_URL.substring(0, START_URL.length() - 1) : START_URL;

        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        int paper = night ? 0xFF0E1912 : 0xFFE8EFE3;
        int ink = night ? 0xFFE3EDDD : 0xFF14241A;

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(paper);

        web = new WebView(this);
        web.setBackgroundColor(paper);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        configure(web);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        offlineBox = buildOfflineBox(paper, ink);
        offlineBox.setVisibility(View.GONE);
        root.addView(offlineBox, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
        connectivity = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        launcherHtml = readAsset("index.html");
        load();
    }

    private String readAsset(String name) {
        try {
            InputStream in = getAssets().open(name);
            try {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return out.toString("UTF-8");
            } finally {
                in.close();
            }
        } catch (IOException e) {
            return null;
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configure(WebView w) {
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // o login (sessão) fica guardado aqui
        // Nada de arquivos do celular, pastas de outros apps nem janelas extras.
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setGeolocationEnabled(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSafeBrowsingEnabled(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);   // chrome://inspect só em build de teste
        }
        // Única ponte com o Android: abrir a folha de compartilhar (WhatsApp etc.).
        // Só funciona nas páginas do endereço do app (a navegação é travada abaixo).
        w.addJavascriptInterface(new Bridge(), "OrcAndroid");
        w.setWebViewClient(new Client());
    }

    // ── abrir a página ─────────────────────────────────────────────────────

    private boolean isOnline() {
        try {
            if (connectivity == null) return true;
            Network n = connectivity.getActiveNetwork();
            if (n == null) return false;
            NetworkCapabilities c = connectivity.getNetworkCapabilities(n);
            return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (RuntimeException e) {
            return true;
        }
    }

    // Com internet: o modo normal (o app confere se há versão nova). Sem internet: usa o que
    // já foi baixado, mesmo que "vencido".
    private void applyCacheMode() {
        web.getSettings().setCacheMode(isOnline() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
    }

    private void load() {
        offlineBox.setVisibility(View.GONE);
        fallbackTried = false;
        pageFinished = false;
        handler.removeCallbacks(watchdog);
        applyCacheMode();
        if (!isOnline() && loadLauncher()) return;   // sem internet: nem tenta a rede
        web.loadUrl(START_URL);
        handler.postDelayed(watchdog, 10000L);
    }

    // Abre a página inicial que está dentro do APK, com o MESMO endereço-base do app: o login e a
    // cópia guardada continuam os mesmos, e o carregador da página resolve o resto (internet ou
    // última versão guardada). Só é usada quando a internet falha ou trava; uma vez por tentativa.
    private boolean loadLauncher() {
        if (launcherHtml == null || fallbackTried) return false;
        fallbackTried = true;
        handler.removeCallbacks(watchdog);
        web.stopLoading();
        web.loadDataWithBaseURL(START_URL, launcherHtml, "text/html", "UTF-8", START_URL);
        return true;
    }

    // ── tela de "sem conexão" (só aparece se não houver nada guardado) ─────

    private View buildOfflineBox(int paper, int ink) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(paper);
        box.setClickable(true);   // não deixa o toque passar para a página que está atrás
        int pad = dp(28);
        box.setPadding(pad, pad, pad, pad);

        TextView msg = new TextView(this);
        msg.setText("Não foi possível abrir o Orçamento.\nConfira a internet e tente de novo.");
        msg.setTextColor(ink);
        msg.setTextSize(18f);
        msg.setGravity(Gravity.CENTER);
        box.addView(msg, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button retry = new Button(this);
        retry.setText("Tentar de novo");
        retry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                load();
            }
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, dp(48));
        lp.topMargin = dp(20);
        box.addView(retry, lp);
        return box;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    // ── navegação: só o endereço do app abre aqui; o resto vai para o navegador ──

    /**
     * O endereço é do app? Compara o TEXTO do endereço (que o Chromium já entrega limpo: esquema e
     * site em minúsculas, "\" virado "/"), e não o "host" que o Uri.parse do Android calcula, que
     * pode ser enganado por endereços como https://site-ruim.com\@seu-site.github.io/.
     */
    static boolean isInternalUrl(String url, String start) {
        if (url == null || start == null) return false;
        String bare = start.endsWith("/") ? start.substring(0, start.length() - 1) : start;
        if (url.startsWith(start)) return true;
        return url.equals(bare) || url.startsWith(bare + "?") || url.startsWith(bare + "#");
    }

    /** Pode o app falar com este site? Só o site do app e o Supabase (*.supabase.co). */
    static boolean isAllowedHost(String host, String startHost) {
        if (host == null || host.length() == 0) return false;
        String h = host.toLowerCase(Locale.ROOT);
        if (startHost != null && h.equals(startHost.toLowerCase(Locale.ROOT))) return true;
        return h.endsWith(".supabase.co") && h.length() > ".supabase.co".length();
    }

    private boolean isInternal(Uri u) {
        return u != null && isInternalUrl(u.toString(), START_URL);
    }

    private void openExternal(Uri u) {
        String scheme = u.getScheme();
        if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)
                && !"mailto".equalsIgnoreCase(scheme) && !"tel".equalsIgnoreCase(scheme)) {
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (RuntimeException e) {
            // nenhum app para abrir esse tipo de link: ignora
        }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (isInternal(u)) return false;
            openExternal(u);
            return true;
        }

        // Segunda barreira (a primeira é a política de segurança dentro da página): qualquer pedido
        // de rede para um site que não seja o do app nem o Supabase é respondido com "proibido".
        // blob:, data: e about: (usados pelo próprio app) não passam por aqui.
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            String scheme = u == null ? null : u.getScheme();
            if (scheme == null || !("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))) return null;
            if (isAllowedHost(u.getHost(), startUri.getHost())) return null;
            return new WebResourceResponse("text/plain", "UTF-8", 403, "Bloqueado",
                    new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            offlineBox.setVisibility(View.GONE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pageFinished = true;
            handler.removeCallbacks(watchdog);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            // ERROR_UNKNOWN inclui "carregamento interrompido por outro"; não é falta de conexão.
            if (request.isForMainFrame() && error.getErrorCode() != WebViewClient.ERROR_UNKNOWN) {
                if (!loadLauncher()) offlineBox.setVisibility(View.VISIBLE);
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // O sistema encerrou o motor da página (pouca memória). Recria a tela em vez de fechar o app.
            long now = System.currentTimeMillis();
            boolean again = now - lastRendererLoss < 5000L;
            lastRendererLoss = now;
            if (again) finish(); else recreate();
            return true;
        }
    }

    // ── ponte para o Android ───────────────────────────────────────────────

    private class Bridge {
        @JavascriptInterface
        public void share(final String text) {
            if (text == null || text.length() == 0 || text.length() > 5000) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent send = new Intent(Intent.ACTION_SEND);
                        send.setType("text/plain");
                        send.putExtra(Intent.EXTRA_TEXT, text);
                        startActivity(Intent.createChooser(send, "Compartilhar"));
                    } catch (RuntimeException e) {
                        // sem app para compartilhar: o app web mostra a opção de copiar
                    }
                }
            });
        }
    }

    // ── ciclo de vida ──────────────────────────────────────────────────────

    @Override
    protected void onStart() {
        super.onStart();
        // Acompanha a internet: ajusta o modo do cache e, se a tela de "sem conexão" estiver
        // aberta, tenta de novo quando a conexão voltar.
        if (connectivity != null && networkCallback == null) {
            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (web == null) return;
                            if (offlineBox.getVisibility() == View.VISIBLE) load(); else applyCacheMode();
                        }
                    });
                }

                @Override
                public void onLost(Network network) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (web != null) applyCacheMode();
                        }
                    });
                }
            };
            try {
                connectivity.registerDefaultNetworkCallback(networkCallback);
            } catch (RuntimeException e) {
                networkCallback = null;
            }
        }
    }

    @Override
    protected void onStop() {
        if (connectivity != null && networkCallback != null) {
            try {
                connectivity.unregisterNetworkCallback(networkCallback);
            } catch (RuntimeException e) {
                // já tinha sido removido
            }
            networkCallback = null;
        }
        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        // Os painéis do app usam o histórico da página: voltar fecha o painel; sem painel, sai do app.
        if (offlineBox.getVisibility() != View.VISIBLE && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(watchdog);
        if (web != null) {
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
