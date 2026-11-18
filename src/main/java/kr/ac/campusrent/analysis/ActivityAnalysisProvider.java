package kr.ac.campusrent.analysis;

import java.util.Map;

/** Provider boundary; its output remains a proposal for the student's explicit confirmation. */
public interface ActivityAnalysisProvider {
    String provider();
    boolean available();
    boolean externalProcessing();
    String unavailableReason();
    Outcome analyze(String activity);

    record Outcome(String reason, Map<String, Object> analysis) {
        static Outcome fallback(String reason) { return new Outcome(reason, null); }
    }
}
