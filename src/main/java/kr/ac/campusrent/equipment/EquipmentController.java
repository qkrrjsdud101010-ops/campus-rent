package kr.ac.campusrent.equipment;

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
@RequestMapping("/api/admin/equipment")
public class EquipmentController {
    private final EquipmentService equipment;

    public EquipmentController(EquipmentService equipment) { this.equipment = equipment; }

    @GetMapping
    public Map<String, Object> list(@AuthenticationPrincipal CurrentUser user) {
        return equipment.list(user);
    }

    @PostMapping("/types")
    public Map<String, Object> createType(@AuthenticationPrincipal CurrentUser user,
                                          @RequestBody Map<String, Object> input) {
        return equipment.createType(user, input);
    }

    @PostMapping("/models")
    public Map<String, Object> createModel(@AuthenticationPrincipal CurrentUser user,
                                           @RequestBody Map<String, Object> input) {
        return equipment.createModel(user, input);
    }

    @PostMapping
    public Map<String, Object> create(@AuthenticationPrincipal CurrentUser user,
                                      @RequestBody Map<String, Object> input) {
        return equipment.create(user, input);
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@AuthenticationPrincipal CurrentUser user, @PathVariable long id,
                                      @RequestBody Map<String, Object> input) {
        return equipment.update(user, id, input);
    }
}
