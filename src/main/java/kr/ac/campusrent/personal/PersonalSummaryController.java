package kr.ac.campusrent.personal;

import java.util.Map;
import kr.ac.campusrent.auth.CurrentUser;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
public class PersonalSummaryController {
    private final PersonalSummaryService service;
    public PersonalSummaryController(PersonalSummaryService service) { this.service = service; }
    @GetMapping("/api/me/summary")
    public Map<String,Object> summary(@AuthenticationPrincipal CurrentUser user) { return service.summary(user); }
}
