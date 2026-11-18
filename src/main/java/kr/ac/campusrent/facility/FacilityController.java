package kr.ac.campusrent.facility;

import java.util.Map;
import kr.ac.campusrent.auth.CurrentUser;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/facilities")
public class FacilityController {
    private final FacilityService facilities;

    public FacilityController(FacilityService facilities) { this.facilities = facilities; }

    @GetMapping
    public Map<String, Object> list(@AuthenticationPrincipal CurrentUser user) { return facilities.list(user); }

    @PostMapping
    public Map<String, Object> create(@AuthenticationPrincipal CurrentUser user,
                                      @RequestBody Map<String, Object> input) {
        return facilities.create(user, input);
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@AuthenticationPrincipal CurrentUser user, @PathVariable long id,
                                      @RequestBody Map<String, Object> input) {
        return facilities.update(user, id, input);
    }

    @PostMapping("/{id}/blocks")
    public Map<String, Object> createBlock(@AuthenticationPrincipal CurrentUser user, @PathVariable long id,
                                           @RequestBody Map<String, Object> input) {
        return facilities.createBlock(user, id, input);
    }

    @PutMapping("/{id}/blocks/{blockId}")
    public Map<String, Object> updateBlock(@AuthenticationPrincipal CurrentUser user, @PathVariable long id,
                                           @PathVariable long blockId, @RequestBody Map<String, Object> input) {
        return facilities.updateBlock(user, id, blockId, input);
    }

    @PostMapping("/{id}/blocks/{blockId}/remove")
    public Map<String, Object> removeBlock(@AuthenticationPrincipal CurrentUser user, @PathVariable long id,
                                           @PathVariable long blockId, @RequestBody Map<String, Object> input) {
        return facilities.removeBlock(user, id, blockId, input);
    }
}
