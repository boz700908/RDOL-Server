package middleware

import (
	"encoding/json"
	"net/http"
	"strings"
)

// RequireJSON 验证POST/PUT请求必须是JSON Content-Type
func RequireJSON(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 只检查POST和PUT请求
		if r.Method == http.MethodPost || r.Method == http.MethodPut {
			contentType := r.Header.Get("Content-Type")
			
			// 允许 application/json 或 application/json; charset=utf-8
			if !strings.HasPrefix(strings.ToLower(contentType), "application/json") {
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "Content-Type must be application/json",
				})
				return
			}
		}
		
		next.ServeHTTP(w, r)
	}
}
