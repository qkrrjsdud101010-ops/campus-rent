package kr.ac.campusrent.analysis;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ActivityAnalysisController {
    private final ActivityAnalysisService analysis;
    public ActivityAnalysisController(ActivityAnalysisService analysis) { this.analysis = analysis; }
    @GetMapping("/api/recommendations/analysis-capabilities")
    public Map<String, Object> capabilities() { return analysis.capabilities(); }
    @PostMapping("/api/recommendations/analyze")
    public Map<String, Object> analyze(@RequestBody Map<String, Object> input) { return analysis.analyze(input); }
}
