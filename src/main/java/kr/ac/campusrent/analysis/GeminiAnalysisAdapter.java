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
@ConditionalOnProperty(name = "campus.analysis.provider", havingValue = "gemini")
public class GeminiAnalysisAdapter implements ActivityAnalysisProvider {
    private final Settings settings;
    private final Transport transport;

    @Autowired
    public GeminiAnalysisAdapter(@Value("${campus.analysis.enabled:false}") boolean enabled,
                                 @Value("${campus.analysis.api-key:}") String apiKey,
                                 @Value("${campus.analysis.model:gemini-3.1-flash-lite}") String model,
                                 @Value("${campus.analysis.timeout-ms:8000}") int timeoutMs) {
        this(new Settings(enabled, apiKey, model, timeoutMs), new JdkTransport());
    }

    GeminiAnalysisAdapter(Settings settings, Transport transport) { this.settings = settings; this.transport = transport; }

    @Override public String provider() { return "gemini"; }
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
            Thread.currentThread().interrupt();
            return Outcome.fallback("unavailable");
        } catch (InvalidResponse error) {
            return Outcome.fallback("invalid-response");
        } catch (Exception error) {
            return Outcome.fallback("unavailable");
        }
    }

    HttpRequest request(String activity) {
        String body = JSON.writeValueAsString(Map.of(
                "systemInstruction", Map.of("parts", List.of(Map.of("text", AnalysisPolicy.INSTRUCTIONS))),
                "contents", List.of(Map.of("role", "user", "parts", List.of(Map.of("text", activity)))),
                "generationConfig", Map.of("responseMimeType", "application/json", "responseJsonSchema", AnalysisPolicy.schema(),
                        "candidateCount", 1, "maxOutputTokens", 768)));
        return HttpRequest.newBuilder(URI.create("https://generativelanguage.googleapis.com/v1beta/models/" + settings.model() + ":generateContent"))
                .timeout(Duration.ofMillis(settings.timeoutMs()))
                .header("Content-Type", "application/json; charset=UTF-8")
                .header("x-goog-api-key", settings.apiKey())
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build();
    }

    private Map<String, Object> decode(byte[] bytes) {
        try {
            Map<?, ?> envelope = AnalysisHttp.object(bytes);
            if (envelope.get("promptFeedback") instanceof Map<?, ?> feedback && feedback.get("blockReason") != null &&
                    !"BLOCK_REASON_UNSPECIFIED".equals(feedback.get("blockReason"))) throw new InvalidResponse();
            if (!(envelope.get("candidates") instanceof List<?> candidates) || candidates.size() != 1 ||
                    !(candidates.getFirst() instanceof Map<?, ?> candidate) || !"STOP".equals(candidate.get("finishReason")) ||
                    !(candidate.get("content") instanceof Map<?, ?> content) ||
                    !(content.get("parts") instanceof List<?> parts) || parts.size() != 1 ||
                    !(parts.getFirst() instanceof Map<?, ?> part) || Boolean.TRUE.equals(part.get("thought")) ||
                    part.containsKey("functionCall") || !(part.get("text") instanceof String output)) throw new InvalidResponse();
            return AnalysisPolicy.output(JSON.readValue(output, Map.class));
        } catch (Exception error) {
            throw new InvalidResponse();
        }
    }

    record Settings(boolean enabled, String apiKey, String model, int timeoutMs) {
        Settings {
            apiKey = apiKey == null ? "" : apiKey.strip(); model = model == null ? "" : model.strip();
            timeoutMs = Math.clamp(timeoutMs, 1000, 8000);
        }
        boolean configured() {
            return !apiKey.isBlank() && apiKey.codePoints().noneMatch(Character::isISOControl) &&
                    model.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,99}");
        }
        @Override public String toString() { return "AnalysisSettings[enabled=" + enabled + ",provider=gemini]"; }
    }

}
