package kr.ac.campusrent.rental;
import java.util.Map;
import kr.ac.campusrent.auth.CurrentUser;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
public class RentalController {
    private final RentalService service;
    public RentalController(RentalService service){this.service=service;}
    @GetMapping("/api/requests") public Map<String,Object> list(@AuthenticationPrincipal CurrentUser user){return service.list(user);}
    @PostMapping("/api/requests") public Map<String,Object> submit(@AuthenticationPrincipal CurrentUser user,@RequestBody Map<String,Object> body){return service.submit(user,body);}
    @PostMapping("/api/requests/{number}/items/{id}/cancel") public Map<String,Object> cancel(@AuthenticationPrincipal CurrentUser user,@PathVariable String number,@PathVariable long id,@RequestBody Map<String,Object> body){return service.change(user,number,id,"cancel",body);}
    @PostMapping("/api/requests/{number}/items/{id}/return-request") public Map<String,Object> returnRequest(@AuthenticationPrincipal CurrentUser user,@PathVariable String number,@PathVariable long id,@RequestBody Map<String,Object> body){return service.change(user,number,id,"request-return",body);}
    @SuppressWarnings("unchecked") @PostMapping("/api/admin/requests/{number}/items/{id}/actions") public Map<String,Object> action(@AuthenticationPrincipal CurrentUser user,@PathVariable String number,@PathVariable long id,@RequestBody Map<String,Object> body){return service.change(user,number,id,RentalPolicy.text(body.get("action"),40,"작업"),body.get("details") instanceof Map<?,?>?(Map<String,Object>)body.get("details"):Map.of());}
}
