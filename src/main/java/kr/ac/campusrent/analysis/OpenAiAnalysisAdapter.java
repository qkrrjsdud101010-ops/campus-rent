package kr.ac.campusrent.analysis;

import java.net.URI;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import static kr.ac.campusrent.analysis.AnalysisHttp.*;

@Component
@ConditionalOnProperty(name = "campus.analysis.provider", havingValue = "openai", matchIfMissing = true)
public class OpenAiAnalysisAdapter implements ActivityAnalysisProvider {
    private final Settings settings;
    private final Transport transport;

    @Autowired
    public OpenAiAnalysisAdapter(@Value("${campus.analysis.enabled:false}") boolean enabled,
                                 @Value("${campus.analysis.openai.api-key:}") String apiKey,
                                 @Value("${campus.analysis.openai.model:gpt-5.4-mini}") String model,
                                 @Value("${campus.analysis.timeout-ms:8000}") int timeoutMs) {
        this(new Settings(enabled, apiKey, model, timeoutMs), new JdkTransport());
    }
    OpenAiAnalysisAdapter(Settings settings, Transport transport) { this.settings = settings; this.transport = transport; }
    @Override public String provider() { return "openai"; }
    @Override public boolean externalProcessing() { return true; }
    @Override public boolean available() { return unavailableReason().isEmpty(); }
    @Override public String unavailableReason() {
        if (!settings.enabled()) return "disabled";
        return settings.configured() ? "" : "unconfigured";
    }
    @Override public Outcome analyze(String activity) {
        String reason = unavailableReason();
        if (!reason.isEmpty()) return Outcome.fallback(reason);
        try {
            Reply reply = transport.send(request(activity), settings.timeoutMs());
            if (reply.status() == 429) return Outcome.fallback("rate-limited");
            if (reply.status() != 200) return Outcome.fallback("unavailable");
            return new Outcome("", decode(reply.body()));
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt(); return Outcome.fallback("unavailable");
        } catch (InvalidResponse error) {
            return Outcome.fallback("invalid-response");
        } catch (Exception error) {
            return Outcome.fallback("unavailable");
        }
    }

    HttpRequest request(String activity) {
        String body = JSON.writeValueAsString(Map.of(
                "model", settings.model(), "instructions", AnalysisPolicy.INSTRUCTIONS, "input", activity,
                "store", false, "max_output_tokens", 768, "reasoning", Map.of("effort", "none"),
                "text", Map.of("format", Map.of("type", "json_schema", "name", "campus_activity_analysis",
                        "strict", true, "schema", AnalysisPolicy.schema()))));
        return HttpRequest.newBuilder(URI.create("https://api.openai.com/v1/responses"))
                .timeout(Duration.ofMillis(settings.timeoutMs()))
                .header("Content-Type", "application/json; charset=UTF-8")
                .header("Authorization", "Bearer " + settings.apiKey())
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build();
    }

    private Map<String, Object> decode(byte[] bytes) {
        try {
            Map<?, ?> envelope = AnalysisHttp.object(bytes);
            if (!"completed".equals(envelope.get("status")) || envelope.get("error") != null ||
                    envelope.get("incomplete_details") != null || !(envelope.get("output") instanceof List<?> output)) throw new InvalidResponse();
            String text = null;
            for (Object item : output) {
                if (!(item instanceof Map<?, ?> entry)) throw new InvalidResponse();
                if ("reasoning".equals(entry.get("type"))) continue;
                if (text != null || !"message".equals(entry.get("type")) || !"completed".equals(entry.get("status")) ||
                        !"assistant".equals(entry.get("role")) || !(entry.get("content") instanceof List<?> parts) ||
                        parts.size() != 1 || !(parts.getFirst() instanceof Map<?, ?> part) ||
                        !"output_text".equals(part.get("type")) || !(part.get("text") instanceof String value)) throw new InvalidResponse();
                text = value;
            }
            if (text == null) throw new InvalidResponse();
            return AnalysisPolicy.output(JSON.readValue(text, Map.class));
        } catch (Exception error) { throw new InvalidResponse(); }
    }

    record Settings(boolean enabled, String apiKey, String model, int timeoutMs) {
        Settings {
            apiKey = apiKey == null ? "" : apiKey.strip(); model = model == null ? "" : model.strip();
            timeoutMs = Math.clamp(timeoutMs, 1000, 8000);
        }
        boolean configured() {
            return !apiKey.isBlank() && apiKey.codePoints().allMatch(value -> value >= 33 && value <= 126) &&
                    model.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,99}");
        }
        @Override public String toString() { return "AnalysisSettings[enabled=" + enabled + ",provider=openai]"; }
    }
}
