package middleware

import (
	"log"
	"net/http"
	"time"
)

// responseWriter 包装器，用于捕获状态码
type responseWriter struct {
	http.ResponseWriter
	statusCode int
	written    bool
}

func (rw *responseWriter) WriteHeader(code int) {
	if !rw.written {
		rw.statusCode = code
		rw.written = true
		rw.ResponseWriter.WriteHeader(code)
	}
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	if !rw.written {
		rw.WriteHeader(http.StatusOK)
	}
	return rw.ResponseWriter.Write(b)
}

// Logger 请求日志中间件
func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// 包装 ResponseWriter 以捕获状态码
		wrapped := &responseWriter{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
		}

		// 记录请求信息
		log.Printf("[%s] %s %s - Content-Type: %s, Origin: %s",
			r.Method,
			r.URL.Path,
			r.RemoteAddr,
			r.Header.Get("Content-Type"),
			r.Header.Get("Origin"),
		)

		next.ServeHTTP(wrapped, r)

		// 记录响应信息
		duration := time.Since(start)
		log.Printf("[%s] %s - Status: %d, Duration: %v",
			r.Method,
			r.URL.Path,
			wrapped.statusCode,
			duration,
		)
	})
}
