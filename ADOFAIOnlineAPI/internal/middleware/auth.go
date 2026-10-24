package middleware

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

type contextKey string

const UserIDKey contextKey = "user_id"

// RequireAuth 验证token中间件
func RequireAuth(db *sql.DB) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			// 从Header获取token
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				jsonAuthError(w, "请先登录", http.StatusUnauthorized)
				return
			}

			// 支持 "Bearer token" 或直接 "token"
			token := strings.TrimPrefix(authHeader, "Bearer ")
			token = strings.TrimSpace(token)

			if token == "" {
				jsonAuthError(w, "请先登录", http.StatusUnauthorized)
				return
			}

			// 验证 token（从 users 表）
			var userID int64
			var expiresAt time.Time
			err := db.QueryRow(
				`SELECT id, token_expires_at FROM users WHERE token = ? AND token IS NOT NULL LIMIT 1`,
				token).Scan(&userID, &expiresAt)

			if err == sql.ErrNoRows {
				jsonAuthError(w, "登录已失效，请重新登录", http.StatusUnauthorized)
				return
			}

			if err != nil {
				jsonAuthError(w, "Token验证失败", http.StatusInternalServerError)
				return
			}

			// 检查是否过期
			if time.Now().After(expiresAt) {
				jsonAuthError(w, "登录已过期，请重新登录", http.StatusUnauthorized)
				return
			}

			// 将用户ID存入context
			ctx := context.WithValue(r.Context(), UserIDKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		}
	}
}

// GetUserID 从context获取用户ID
func GetUserID(r *http.Request) (int64, bool) {
	userID, ok := r.Context().Value(UserIDKey).(int64)
	return userID, ok
}

// RequireAdmin 验证管理员权限中间件
func RequireAdmin(db *sql.DB) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			// 先验证token
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				jsonAuthError(w, "请先登录", http.StatusUnauthorized)
				return
			}

			token := strings.TrimPrefix(authHeader, "Bearer ")
			token = strings.TrimSpace(token)

			if token == "" {
				jsonAuthError(w, "请先登录", http.StatusUnauthorized)
				return
			}

			// 验证 token 并获取用户角色（从 users 表一次查询）
			var userID int64
			var expiresAt time.Time
			var role int
			err := db.QueryRow(
				`SELECT id, token_expires_at, role FROM users WHERE token = ? AND token IS NOT NULL LIMIT 1`,
				token).Scan(&userID, &expiresAt, &role)

			if err == sql.ErrNoRows {
				jsonAuthError(w, "登录已失效，请重新登录", http.StatusUnauthorized)
				return
			}

			if err != nil {
				jsonAuthError(w, "Token验证失败", http.StatusInternalServerError)
				return
			}

			if time.Now().After(expiresAt) {
				jsonAuthError(w, "登录已过期，请重新登录", http.StatusUnauthorized)
				return
			}
			// role: 1=普通用户 2=管理员 3=超级管理员
			if role < 2 {
				jsonAuthError(w, "权限不足，需要管理员权限", http.StatusForbidden)
				return
			}

			// 将用户ID存入context
			ctx := context.WithValue(r.Context(), UserIDKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		}
	}
}

func jsonAuthError(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
