package kr.ac.campusrent.alternatives;

import java.util.Map;
import kr.ac.campusrent.auth.CurrentUser;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/equipment-alternatives")
public class AlternativeController {
    private final AlternativeService alternatives;
    public AlternativeController(AlternativeService alternatives) { this.alternatives = alternatives; }

    @GetMapping
    public Map<String, Object> list(@AuthenticationPrincipal CurrentUser user) { return alternatives.list(user); }

    @PutMapping("/{sourceId}")
    public Map<String, Object> update(@AuthenticationPrincipal CurrentUser user, @PathVariable long sourceId,
                                      @RequestBody Map<String, Object> input) {
        return alternatives.update(user, sourceId, input);
    }
}
