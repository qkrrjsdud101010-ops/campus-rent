package kr.ac.campusrent.auth;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public final class AuthSupport {
    private AuthSupport() { }
    public static CurrentUser require(CurrentUser user) {
        if (user == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "로그인이 필요합니다.");
        return user;
    }
    public static CurrentUser requireRole(CurrentUser user, String role) {
        require(user);
        if (!role.equals(user.role())) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "이 작업을 수행할 권한이 없습니다.");
        return user;
    }
}
