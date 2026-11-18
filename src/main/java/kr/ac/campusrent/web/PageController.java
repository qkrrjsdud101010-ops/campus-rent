package kr.ac.campusrent.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class PageController {
    @GetMapping({"/", "/equipment", "/facilities", "/purpose", "/records", "/requests", "/history", "/admin", "/admin/equipment", "/admin/facilities", "/admin/alternatives"})
    public String index() { return "index"; }
}
