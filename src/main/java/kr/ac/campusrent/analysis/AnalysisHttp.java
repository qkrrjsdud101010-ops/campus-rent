package kr.ac.campusrent.analysis;

import java.io.ByteArrayOutputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Bounded, non-redirecting provider transport. Does not log request or response data. */
final class AnalysisHttp {
    static final int MAX_RESPONSE_BYTES = 64 * 1024;
    static final JsonMapper JSON = JsonMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    private AnalysisHttp() { }

    static Map<?, ?> object(byte[] bytes) {
        try {
            if (bytes == null || bytes.length == 0 || bytes.length > MAX_RESPONSE_BYTES) throw new InvalidResponse();
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            return JSON.readValue(text, Map.class);
        } catch (Exception error) { throw new InvalidResponse(); }
    }

    record Reply(int status, byte[] body) { }
    interface Transport { Reply send(HttpRequest request, int timeoutMs) throws Exception; }
    static final class InvalidResponse extends RuntimeException {
        InvalidResponse() { super("Invalid provider response"); }
    }
    static final class JdkTransport implements Transport {
        private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3))
                .followRedirects(HttpClient.Redirect.NEVER).build();
        @Override public Reply send(HttpRequest request, int timeoutMs) throws Exception {
            CompletableFuture<HttpResponse<byte[]>> pending = client.sendAsync(request, info -> new LimitedBody());
            try {
                HttpResponse<byte[]> response = pending.get(timeoutMs, TimeUnit.MILLISECONDS);
                return new Reply(response.statusCode(), response.body());
            } catch (Exception error) {
                pending.cancel(true);
                for (Throwable cause = error; cause != null; cause = cause.getCause())
                    if (cause instanceof InvalidResponse) throw new InvalidResponse();
                throw error;
            }
        }
    }
    static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private Flow.Subscription subscription;
        @Override public CompletionStage<byte[]> getBody() { return result; }
        @Override public void onSubscribe(Flow.Subscription next) { subscription = next; next.request(1); }
        @Override public void onNext(List<ByteBuffer> buffers) {
            if (result.isDone()) return;
            for (ByteBuffer buffer : buffers) {
                if (buffer.remaining() > MAX_RESPONSE_BYTES - bytes.size()) {
                    subscription.cancel(); result.completeExceptionally(new InvalidResponse()); return;
                }
                byte[] chunk = new byte[buffer.remaining()]; buffer.get(chunk); bytes.writeBytes(chunk);
            }
            subscription.request(1);
        }
        @Override public void onError(Throwable error) { result.completeExceptionally(error); }
        @Override public void onComplete() { result.complete(bytes.toByteArray()); }
    }
}
