import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Executors;

/** Local UI preview only. Replace with Spring MVC when server work begins. */
public final class PreviewServer {
    private static final Set<String> VIEWS = new HashSet<String>(Arrays.asList(
        "/", "/equipment", "/facilities", "/purpose", "/records", "/requests", "/history", "/admin"));

    public static void main(String[] args) throws IOException {
        final int port = args.length > 0 ? Integer.parseInt(args[0]) : 8080;
        final Path root = Paths.get(args.length > 1 ? args[1] : ".").toAbsolutePath().normalize();
        final Path assets = root.resolve("src/main/resources/static");
        final Path checks = root.resolve(".work/ui-checks");
        final Path view = root.resolve("src/main/resources/templates/index.html");
        if (!Files.isRegularFile(view)) throw new IOException("Run from the CampusRent repository root.");
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/", exchange -> {
            try {
                if (!"GET".equals(exchange.getRequestMethod()) && !"HEAD".equals(exchange.getRequestMethod())) {
                    exchange.getResponseHeaders().set("Allow", "GET, HEAD");
                    send(exchange, 405, "Method not allowed"); return;
                }
                String urlPath = URLDecoder.decode(exchange.getRequestURI().getRawPath().replace("+", "%2B"), "UTF-8");
                String route = urlPath.length() > 1 && urlPath.endsWith("/") ? urlPath.substring(0, urlPath.length() - 1) : urlPath;
                Path base = urlPath.startsWith("/_checks/") ? checks : assets;
                Path file = VIEWS.contains(route) ? view : base.resolve(urlPath.startsWith("/_checks/") ? urlPath.substring(9) : urlPath.substring(1)).normalize();
                if ((!file.equals(view) && !file.startsWith(base)) || !Files.isRegularFile(file)) {
                    send(exchange, 404, "Not found"); return;
                }
                exchange.getResponseHeaders().set("Content-Type", contentType(file.toString()));
                exchange.getResponseHeaders().set("Cache-Control", "no-store");
                exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
                exchange.getResponseHeaders().set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'");
                if ("HEAD".equals(exchange.getRequestMethod())) { exchange.sendResponseHeaders(200, -1); return; }
                byte[] body = Files.readAllBytes(file);
                exchange.sendResponseHeaders(200, body.length);
                exchange.getResponseBody().write(body);
            } catch (Exception error) {
                try { send(exchange, 500, "Preview request failed"); } catch (IOException ignored) { }
                System.err.println(error.getMessage());
            } finally { exchange.close(); }
        });
        server.setExecutor(Executors.newFixedThreadPool(4));
        server.start();
        System.out.println("CampusRent UI preview: http://127.0.0.1:" + port);
        System.out.println("Stop with Ctrl+C. This preview does not provide server authentication or a database.");
    }
    private static String contentType(String path) {
        if (path.endsWith(".html")) return "text/html; charset=utf-8";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (path.endsWith(".css")) return "text/css; charset=utf-8";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".ttf")) return "font/ttf";
        if (path.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }
    private static void send(HttpExchange exchange, int code, String text) throws IOException {
        byte[] body = text.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
        exchange.sendResponseHeaders(code, body.length);
        exchange.getResponseBody().write(body);
    }
}
