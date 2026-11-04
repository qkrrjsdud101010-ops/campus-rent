package kr.ac.campusrent.catalog;
import java.util.Map;
import org.springframework.web.bind.annotation.*;
@RestController
public class CatalogController {
    private final CatalogService catalog;
    public CatalogController(CatalogService catalog){this.catalog=catalog;}
    @GetMapping("/api/catalog") public Map<String,Object> get(){return Map.of("resources",catalog.resources(),"purposes",catalog.purposes(),"reservations",catalog.reservations(),"restrictions",catalog.restrictions());}
}
