package kr.ac.campusrent.analysis;

import java.time.Clock;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Semaphore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class ActivityAnalysisService {
    private final ActivityAnalysisProvider adapter;
    private final Semaphore concurrent = new Semaphore(2);
    private final Deque<Long> calls = new ArrayDeque<>();
    private final int callsPerMinute;
    private final Clock clock;

    @Autowired
    public ActivityAnalysisService(ActivityAnalysisProvider adapter,
                                   @Value("${campus.analysis.max-calls-per-minute:20}") int callsPerMinute) {
        this(adapter, callsPerMinute, Clock.systemUTC());
    }
    ActivityAnalysisService(ActivityAnalysisProvider adapter, int callsPerMinute, Clock clock) {
        this.adapter = adapter; this.callsPerMinute = Math.clamp(callsPerMinute, 1, 20); this.clock = clock;
    }

    public Map<String, Object> capabilities() {
        boolean available = adapter.available();
        return Map.of("available", available, "provider", adapter.provider(), "externalProcessing", available && adapter.externalProcessing());
    }

    public Map<String, Object> analyze(Map<String, Object> input) {
        String activity = AnalysisPolicy.activity(input);
        String unavailable = adapter.unavailableReason();
        if (!unavailable.isEmpty()) return fallback(unavailable);
        if (!concurrent.tryAcquire()) return fallback("busy");
        try {
            if (!takeRateSlot()) return fallback("rate-limited");
            ActivityAnalysisProvider.Outcome outcome = adapter.analyze(activity);
            if (outcome == null) return fallback("unavailable");
            if (outcome.analysis() == null) return fallback(outcome.reason());
            Map<String, Object> checked;
            try { checked = AnalysisPolicy.output(outcome.analysis()); }
            catch (IllegalArgumentException error) { return fallback("invalid-response"); }
            Map<String, Object> response = new LinkedHashMap<>();
            response.put("source", "ai"); response.put("reason", ""); response.put("analysis", checked);
            return response;
        } catch (RuntimeException error) {
            return fallback("unavailable");
        } finally {
            concurrent.release();
        }
    }

    private synchronized boolean takeRateSlot() {
        long now = clock.millis();
        while (!calls.isEmpty() && calls.getFirst() <= now - 60_000) calls.removeFirst();
        if (calls.size() >= callsPerMinute) return false;
        calls.addLast(now); return true;
    }

    private Map<String, Object> fallback(String reason) {
        if (reason == null || !Set.of("disabled", "unconfigured", "unavailable", "invalid-response", "busy", "rate-limited").contains(reason)) reason = "unavailable";
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("source", "rules"); response.put("reason", reason); response.put("analysis", null);
        return response;
    }
}
