package handler

import (
	"encoding/json"
	"net/http"
	"unicode/utf8"

	"adofaionlineapi/internal/service"
)

// AuthHandler 认证相关 handler
type AuthHandler struct {
	auth *service.AuthService
}

// NewAuthHandler 创建认证 handler
func NewAuthHandler(auth *service.AuthService) *AuthHandler {
	return &AuthHandler{auth: auth}
}

// SendCodeReq 发送验证码请求
type SendCodeReq struct {
	Email string `json:"email"`
}

// RegisterReq 注册请求
type RegisterReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Email    string `json:"email"`
	Code     string `json:"code"`
}

// LoginReq 登录请求
type LoginReq struct {
	Username string `json:"username"` // 支持用户名或邮箱
	Password string `json:"password"`
}

// LoginResp 登录响应
type LoginResp struct {
	Token string `json:"token"`
	UID   int64  `json:"uid"`
}

// SendCode POST /auth/send-code 发送注册验证码
func (h *AuthHandler) SendCode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SendCodeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Email == "" {
		jsonError(w, "email required", http.StatusBadRequest)
		return
	}

	if err := h.auth.SendRegisterCode(r.Context(), req.Email); err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}

	jsonOK(w, map[string]string{"message": "verification code sent"})
}

// Register POST /auth/register 注册
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RegisterReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Username == "" || req.Password == "" || req.Email == "" || req.Code == "" {
		jsonError(w, "username, password, email, code required", http.StatusBadRequest)
		return
	}
	if utf8.RuneCountInString(req.Username) > 10 {
		jsonError(w, "用户名最多10个字符", http.StatusBadRequest)
		return
	}

	if err := h.auth.Register(r.Context(), req.Username, req.Password, req.Email, req.Code); err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}

	jsonOK(w, map[string]string{"message": "registered successfully"})
}

// Login POST /auth/login 登录
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req LoginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Username == "" || req.Password == "" {
		jsonError(w, "username and password required", http.StatusBadRequest)
		return
	}

	token, uid, err := h.auth.Login(r.Context(), req.Username, req.Password)
	if err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}

	jsonOK(w, LoginResp{Token: token, UID: uid})
}

func jsonOK(w http.ResponseWriter, body interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(body)
}

func jsonError(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
