package handler

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"adofaionlineapi/internal/middleware"
	"golang.org/x/crypto/bcrypt"
)

// UserInfo 用户信息响应
type UserInfo struct {
	UID         int64   `json:"uid"`
	Username    string  `json:"username"`
	Email       string  `json:"email"`
	Avatar      *string `json:"avatar"`
	AvatarFrame *string `json:"avatar_frame"`
	NameColor   *string `json:"name_color"` // 名字颜色，如 #RRGGBB
	QQ          *string `json:"qq"`
	Role        int     `json:"role"`
	Status      int     `json:"status"`
}

// GetMe 获取当前用户信息
// GET /me
func GetMe(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			jsonErrorUser(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// 从context获取用户ID
		userID, ok := middleware.GetUserID(r)
		if !ok {
			jsonErrorUser(w, "用户信息获取失败", http.StatusInternalServerError)
			return
		}

		// 查询用户信息
		var user UserInfo
		var avatar sql.NullString
		var avatarFrame sql.NullString
		var nameColor sql.NullString
		var qq sql.NullString
		
		err := db.QueryRow(
			`SELECT id, username, email, avatar, avatar_frame, name_color, qq, role, status FROM users WHERE id = ?`,
			userID).Scan(&user.UID, &user.Username, &user.Email, &avatar, &avatarFrame, &nameColor, &qq, &user.Role, &user.Status)

		if err == sql.ErrNoRows {
			jsonErrorUser(w, "用户不存在", http.StatusNotFound)
			return
		}

		if err != nil {
			jsonErrorUser(w, "查询用户信息失败", http.StatusInternalServerError)
			return
		}

		// 处理可空字段
		if avatar.Valid {
			user.Avatar = &avatar.String
		}
		if avatarFrame.Valid {
			user.AvatarFrame = &avatarFrame.String
		}
		if nameColor.Valid {
			user.NameColor = &nameColor.String
		}
		if qq.Valid {
			user.QQ = &qq.String
		}

		// 返回用户信息
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(user)
	}
}

// GetUserByID 获取指定用户信息
// GET /users/:id
func GetUserByID(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			jsonErrorUser(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// 从URL获取用户ID
		path := r.URL.Path
		// 移除 /users/ 前缀
		userIDStr := path[len("/users/"):]
		if userIDStr == "" {
			jsonErrorUser(w, "用户ID不能为空", http.StatusBadRequest)
			return
		}

		// 转换为int64
		var targetUserID int64
		if _, err := fmt.Sscanf(userIDStr, "%d", &targetUserID); err != nil {
			jsonErrorUser(w, "用户ID格式错误", http.StatusBadRequest)
			return
		}

		// 查询用户信息（只返回公开信息，不返回邮箱）
		var user struct {
			UID         int64   `json:"uid"`
			Username    string  `json:"username"`
			Avatar      *string `json:"avatar"`
			AvatarFrame *string `json:"avatar_frame"`
			NameColor   *string `json:"name_color"`
			QQ          *string `json:"qq"`
			Role        int     `json:"role"`
			Status      int     `json:"status"`
		}
		var avatar sql.NullString
		var avatarFrame sql.NullString
		var nameColor sql.NullString
		var qq sql.NullString

		err := db.QueryRow(
			`SELECT id, username, avatar, avatar_frame, name_color, qq, role, status FROM users WHERE id = ?`,
			targetUserID).Scan(&user.UID, &user.Username, &avatar, &avatarFrame, &nameColor, &qq, &user.Role, &user.Status)

		if err == sql.ErrNoRows {
			jsonErrorUser(w, "用户不存在", http.StatusNotFound)
			return
		}

		if err != nil {
			jsonErrorUser(w, "查询用户信息失败", http.StatusInternalServerError)
			return
		}

		// 处理可空字段
		if avatar.Valid {
			user.Avatar = &avatar.String
		}
		if avatarFrame.Valid {
			user.AvatarFrame = &avatarFrame.String
		}
		if nameColor.Valid {
			user.NameColor = &nameColor.String
		}
		if qq.Valid {
			user.QQ = &qq.String
		}

		// 返回用户信息
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(user)
	}
}

// UpdateProfileReq 更新用户信息请求（名字颜色仅管理员可改，此处不包含）
type UpdateProfileReq struct {
	Username    string  `json:"username"`
	AvatarFrame *string `json:"avatar_frame"` // 头像框 URL，传空字符串可清空
}

// ChangePasswordReq 修改密码请求
type ChangePasswordReq struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

// UpdateProfile 更新用户信息
// PUT /me
func UpdateProfile(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			jsonErrorUser(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// 获取用户ID
		userID, ok := middleware.GetUserID(r)
		if !ok {
			jsonErrorUser(w, "用户信息获取失败", http.StatusInternalServerError)
			return
		}

		// 解析请求
		var req UpdateProfileReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErrorUser(w, "请求格式错误", http.StatusBadRequest)
			return
		}

		// 验证用户名
		req.Username = strings.TrimSpace(req.Username)
		if req.Username == "" {
			jsonErrorUser(w, "用户名不能为空", http.StatusBadRequest)
			return
		}

		// 检查用户名长度（最多10个字符）
		if utf8.RuneCountInString(req.Username) > 10 {
			jsonErrorUser(w, "用户名最多10个字符", http.StatusBadRequest)
			return
		}

		// 检查用户名是否已被占用
		var exists int
		err := db.QueryRow(`SELECT 1 FROM users WHERE username = ? AND id != ?`, req.Username, userID).Scan(&exists)
		if err == nil {
			jsonErrorUser(w, "用户名已被占用", http.StatusBadRequest)
			return
		} else if err != sql.ErrNoRows {
			jsonErrorUser(w, "检查用户名失败", http.StatusInternalServerError)
			return
		}

		// 更新用户名，若提供 avatar_frame 则一并更新（空字符串表示清空）。名字颜色仅管理员可改。
		var execErr error
		if req.AvatarFrame != nil {
			s := strings.TrimSpace(*req.AvatarFrame)
			var frameVal interface{} = s
			if s == "" {
				frameVal = nil
			}
			_, execErr = db.Exec(
				`UPDATE users SET username = ?, avatar_frame = ?, profile_updated_at = NOW() WHERE id = ?`,
				req.Username, frameVal, userID)
		} else {
			_, execErr = db.Exec(
				`UPDATE users SET username = ?, profile_updated_at = NOW() WHERE id = ?`,
				req.Username, userID)
		}
		err = execErr

		if err != nil {
			jsonErrorUser(w, "更新用户名失败", http.StatusInternalServerError)
			return
		}

		// 返回成功
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "更新成功"})
	}
}

// ChangePassword 修改密码
// POST /me/password
func ChangePassword(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErrorUser(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// 获取用户ID
		userID, ok := middleware.GetUserID(r)
		if !ok {
			jsonErrorUser(w, "用户信息获取失败", http.StatusInternalServerError)
			return
		}

		// 解析请求
		var req ChangePasswordReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErrorUser(w, "请求格式错误", http.StatusBadRequest)
			return
		}

		if req.OldPassword == "" || req.NewPassword == "" {
			jsonErrorUser(w, "旧密码和新密码不能为空", http.StatusBadRequest)
			return
		}

		// 查询当前密码
		var currentPassword string
		err := db.QueryRow(`SELECT password FROM users WHERE id = ?`, userID).Scan(&currentPassword)
		if err != nil {
			jsonErrorUser(w, "查询用户信息失败", http.StatusInternalServerError)
			return
		}

		// 验证旧密码
		if err := bcrypt.CompareHashAndPassword([]byte(currentPassword), []byte(req.OldPassword)); err != nil {
			jsonErrorUser(w, "旧密码错误", http.StatusBadRequest)
			return
		}

		// 加密新密码
		hashed, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			jsonErrorUser(w, "密码加密失败", http.StatusInternalServerError)
			return
		}

		// 更新密码并清除当前 token，强制重新登录
		_, err = db.Exec(`UPDATE users SET password = ?, token = NULL, token_expires_at = NULL WHERE id = ?`, string(hashed), userID)
		if err != nil {
			jsonErrorUser(w, "修改密码失败", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "密码修改成功，请使用新密码重新登录"})
	}
}

func jsonErrorUser(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
