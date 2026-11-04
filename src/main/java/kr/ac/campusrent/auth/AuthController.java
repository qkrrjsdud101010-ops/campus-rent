package kr.ac.campusrent.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwords;
    private final TransactionTemplate transactions;
    private final HttpSessionSecurityContextRepository contexts;
    private final CsrfTokenRepository csrf;
    private final String dummyHash;
    public AuthController(JdbcTemplate jdbc, PasswordEncoder passwords, TransactionTemplate transactions,
            HttpSessionSecurityContextRepository contexts, CsrfTokenRepository csrf) {
        this.jdbc = jdbc; this.passwords = passwords; this.transactions = transactions;
        this.contexts = contexts; this.csrf = csrf;
        this.dummyHash = passwords.encode(java.util.UUID.randomUUID().toString());
    }
    @GetMapping("/csrf") public Map<String, String> token(CsrfToken token) {
        return Map.of("headerName", token.getHeaderName(), "token", token.getToken());
    }
    @GetMapping("/me") public Map<String, Object> me(@AuthenticationPrincipal CurrentUser user) {
        return Collections.singletonMap("user", user);
    }
    @PostMapping("/login") public Map<String, Object> login(@RequestBody Credentials input,
            HttpServletRequest request, HttpServletResponse response) {
        String email = email(input.email());
        String raw = input.password() == null ? "" : input.password();
        if (raw.isEmpty() || raw.getBytes(StandardCharsets.UTF_8).length > 72) throw unauthorized();
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT USER_ID, EMAIL, PASSWORD, USER_NAME, ROLE_CODE FROM APP_USER WHERE LOWER(EMAIL)=?", email);
        String hash = rows.isEmpty() ? dummyHash : String.valueOf(rows.getFirst().get("PASSWORD"));
        if (!passwords.matches(raw, hash) || rows.isEmpty()) throw unauthorized();
        Map<String, Object> row = rows.getFirst();
        CurrentUser user = new CurrentUser(String.valueOf(row.get("USER_ID")), String.valueOf(row.get("USER_NAME")),
                String.valueOf(row.get("EMAIL")), "ADMIN".equals(row.get("ROLE_CODE")) ? "admin" : "student");
        establish(user, request, response);
        return Map.of("user", user);
    }
    @PostMapping("/signup") public Map<String, Object> signup(@RequestBody Registration input,
            HttpServletRequest request, HttpServletResponse response) {
        String email = email(input.email());
        String name = input.name() == null ? "" : input.name().strip();
        validatePassword(input.password());
        if (name.isEmpty() || name.codePointCount(0, name.length()) > 50)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "이름은 1~50자로 입력해주세요.");
        String hash = passwords.encode(input.password());
        CurrentUser user;
        try {
            user = transactions.execute(status -> {
                Long id = jdbc.queryForObject("SELECT SQ_APP_USER.NEXTVAL FROM DUAL", Long.class);
                jdbc.update("INSERT INTO APP_USER(USER_ID,EMAIL,PASSWORD,USER_NAME,ROLE_CODE) VALUES(?,?,?,?, 'STUDENT')",
                        id, email, hash, name);
                return new CurrentUser(String.valueOf(id), name, email, "student");
            });
        } catch (DuplicateKeyException error) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 사용 중인 이메일입니다.");
        }
        establish(user, request, response);
        return Map.of("user", user);
    }
    @PostMapping("/logout") public Map<String, Object> logout(HttpServletRequest request, HttpServletResponse response) {
        csrf.saveToken(null, request, response);
        if (request.getSession(false) != null) request.getSession(false).invalidate();
        SecurityContextHolder.clearContext();
        return Collections.singletonMap("user", null);
    }
    private void establish(CurrentUser user, HttpServletRequest request, HttpServletResponse response) {
        request.getSession(true); request.changeSessionId();
        var authentication = UsernamePasswordAuthenticationToken.authenticated(user, null,
                List.of(new SimpleGrantedAuthority("ROLE_" + user.role().toUpperCase(Locale.ROOT))));
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication); SecurityContextHolder.setContext(context);
        contexts.saveContext(context, request, response);
        csrf.saveToken(null, request, response);
    }
    public static String email(String raw) {
        String email = raw == null ? "" : raw.strip().toLowerCase(Locale.ROOT);
        if (email.length() > 254 || !email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "올바른 이메일을 입력해주세요.");
        return email;
    }
    public static void validatePassword(String password) {
        if (password == null || password.length() < 8 || password.getBytes(StandardCharsets.UTF_8).length > 72 ||
                !password.matches("(?s).*[A-Za-z].*") || !password.matches("(?s).*\\d.*"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "비밀번호는 8자 이상 72바이트 이하, 영문과 숫자를 포함해주세요.");
    }
    private ResponseStatusException unauthorized() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "이메일 또는 비밀번호를 확인해주세요.");
    }
    public record Credentials(String email, String password) { }
    public record Registration(String name, String email, String password) { }
}
