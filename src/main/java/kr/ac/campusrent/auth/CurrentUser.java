package kr.ac.campusrent.auth;

public record CurrentUser(String id, String name, String email, String role) { }
