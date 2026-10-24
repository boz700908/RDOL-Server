package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"adofaionlineapi/internal/middleware"
	"adofaionlineapi/internal/notify"
	"golang.org/x/crypto/bcrypt"
)

// GetAllApplications 获取所有申请（管理员）
// GET /admin/applications?page=1&page_size=20&search=username&status=0
func GetAllApplications(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			jsonErrorAdmin(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// 获取分页参数
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
		search := strings.TrimSpace(r.URL.Query().Get("search"))
		statusStr := r.URL.Query().Get("status")

		if page <= 0 {
			page = 1
		}
		if pageSize <= 0 || pageSize > 100 {
			pageSize = 20
		}

		offset := (page - 1) * pageSize

		// 构建查询条件
		whereClause := ""
		args := []interface{}{}
		countArgs := []interface{}{}

		if search != "" {
			whereClause = " WHERE u.username LIKE ?"
			searchPattern := "%" + search + "%"
			args = append(args, searchPattern)
			countArgs = append(countArgs, searchPattern)
		}

		if statusStr != "" {
			status, err := strconv.Atoi(statusStr)
			if err == nil && status >= 0 && status <= 2 {
				if whereClause == "" {
					whereClause = " WHERE a.status = ?"
				} else {
					whereClause += " AND a.status = ?"
				}
				args = append(args, status)
				countArgs = append(countArgs, status)
			}
		}

		// 查询总数
		var total int
		countSQL := "SELECT COUNT(*) FROM verification_applications a LEFT JOIN users u ON a.user_id = u.id" + whereClause
		err := db.QueryRow(countSQL, countArgs...).Scan(&total)
		if err != nil {
			jsonErrorAdmin(w, "查询申请总数失败", http.StatusInternalServerError)
			return
		}

		// 添加分页参数
		args = append(args, pageSize, offset)

		// 查询申请列表
		querySQL := `SELECT a.id, a.user_id, u.username, a.steam_link, a.screenshot_urls, 
			        a.status, a.reject_reason, a.created_at, a.updated_at, 
			        a.reviewed_by, a.reviewed_at 
			 FROM verification_applications a
			 LEFT JOIN users u ON a.user_id = u.id` + whereClause + `
			 ORDER BY a.created_at DESC
			 LIMIT ? OFFSET ?`
		
		rows, err := db.Query(querySQL, args...)

		if err != nil {
			jsonErrorAdmin(w, "查询申请记录失败", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type ApplicationWithUser struct {
			ID             int64    `json:"id"`
			UserID         int64    `json:"user_id"`
			Username       string   `json:"username"`
			SteamLink      string   `json:"steam_link"`
			ScreenshotURLs []string `json:"screenshot_urls"`
			Status         int      `json:"status"`
			RejectReason   string   `json:"reject_reason,omitempty"`
			CreatedAt      string   `json:"created_at"`
			UpdatedAt      string   `json:"updated_at"`
			ReviewedBy     *int64   `json:"reviewed_by,omitempty"`
			ReviewedAt     *string  `json:"reviewed_at,omitempty"`
		}

		applications := []ApplicationWithUser{}
		for rows.Next() {
			var app ApplicationWithUser
			var steamLink sql.NullString
			var screenshotJSON string
			var rejectReason sql.NullString
			var reviewedBy sql.NullInt64
			var reviewedAt sql.NullString

			err := rows.Scan(
				&app.ID, &app.UserID, &app.Username, &steamLink, &screenshotJSON,
				&app.Status, &rejectReason, &app.CreatedAt, &app.UpdatedAt,
				&reviewedBy, &reviewedAt)

			if err != nil {
				continue
			}

			if steamLink.Valid {
				app.SteamLink = steamLink.String
			}
			if rejectReason.Valid {
				app.RejectReason = rejectReason.String
			}
			if reviewedBy.Valid {
				app.ReviewedBy = &reviewedBy.Int64
			}
			if reviewedAt.Valid {
				app.ReviewedAt = &reviewedAt.String
			}

			// 解析截图URL数组
			if screenshotJSON != "" {
				json.Unmarshal([]byte(screenshotJSON), &app.ScreenshotURLs)
			}
			if app.ScreenshotURLs == nil {
				app.ScreenshotURLs = []string{}
			}

			applications = append(applications, app)
		}

		// 返回分页数据
		response := map[string]interface{}{
			"total":      total,
			"page":       page,
			"page_size":  pageSize,
			"total_page": (total + pageSize - 1) / pageSize,
			"data":       applications,
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(response)
	}
}

// ApproveApplicationReq 通过申请请求
type ApproveApplicationReq struct {
	ID int64 `json:"id"`
}

// ApproveApplication 通过申请（管理员）
// POST /admin/applications/approve
func ApproveApplication(db *sql.DB, notifyBaseURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErrorAdmin(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// 获取管理员ID
		adminID, ok := middleware.GetUserID(r)
		if !ok {
			jsonErrorAdmin(w, "管理员信息获取失败", http.StatusInternalServerError)
			return
		}

		// 解析请求
		var req ApproveApplicationReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErrorAdmin(w, "请求格式错误", http.StatusBadRequest)
			return
		}

		if req.ID <= 0 {
			jsonErrorAdmin(w, "申请ID无效", http.StatusBadRequest)
			return
		}

		// 检查申请是否存在并取 user_id
		var userID int64
		var status int
		err := db.QueryRow(`SELECT user_id, status FROM verification_applications WHERE id = ?`, req.ID).Scan(&userID, &status)
		if err == sql.ErrNoRows {
			jsonErrorAdmin(w, "申请不存在", http.StatusNotFound)
			return
		}
		if err != nil {
			jsonErrorAdmin(w, "查询申请失败", http.StatusInternalServerError)
			return
		}

		if status != 0 {
			jsonErrorAdmin(w, "只能审核状态为审核中的申请", http.StatusBadRequest)
			return
		}

		// 更新申请状态为已通过
		_, err = db.Exec(
			`UPDATE verification_applications 
			 SET status = 1, reviewed_by = ?, reviewed_at = NOW() 
			 WHERE id = ?`,
			adminID, req.ID)

		if err != nil {
			jsonErrorAdmin(w, "通过申请失败", http.StatusInternalServerError)
			return
		}

		// 通过申请后自动解封该用户（将 users.status 设为 1）
		_, _ = db.Exec(`UPDATE users SET status = 1 WHERE id = ?`, userID)

		notify.ApplyResult(notifyBaseURL, userID, true)

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "申请已通过"})
	}
}

// RejectApplicationReq 拒绝申请请求
type RejectApplicationReq struct {
	ID           int64  `json:"id"`
	RejectReason string `json:"reject_reason"`
}

// RejectApplication 拒绝申请（管理员）
// POST /admin/applications/reject
func RejectApplication(db *sql.DB, notifyBaseURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErrorAdmin(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// 获取管理员ID
		adminID, ok := middleware.GetUserID(r)
		if !ok {
			jsonErrorAdmin(w, "管理员信息获取失败", http.StatusInternalServerError)
			return
		}

		// 解析请求
		var req RejectApplicationReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErrorAdmin(w, "请求格式错误", http.StatusBadRequest)
			return
		}

		if req.ID <= 0 {
			jsonErrorAdmin(w, "申请ID无效", http.StatusBadRequest)
			return
		}

		req.RejectReason = strings.TrimSpace(req.RejectReason)
		if req.RejectReason == "" {
			jsonErrorAdmin(w, "拒绝原因不能为空", http.StatusBadRequest)
			return
		}

		// 检查申请是否存在并取 user_id
		var userID int64
		var status int
		err := db.QueryRow(`SELECT user_id, status FROM verification_applications WHERE id = ?`, req.ID).Scan(&userID, &status)
		if err == sql.ErrNoRows {
			jsonErrorAdmin(w, "申请不存在", http.StatusNotFound)
			return
		}
		if err != nil {
			jsonErrorAdmin(w, "查询申请失败", http.StatusInternalServerError)
			return
		}

		if status != 0 {
			jsonErrorAdmin(w, "只能审核状态为审核中的申请", http.StatusBadRequest)
			return
		}

		// 更新申请状态为已拒绝
		_, err = db.Exec(
			`UPDATE verification_applications 
			 SET status = 2, reject_reason = ?, reviewed_by = ?, reviewed_at = NOW() 
			 WHERE id = ?`,
			req.RejectReason, adminID, req.ID)

		if err != nil {
			jsonErrorAdmin(w, "拒绝申请失败", http.StatusInternalServerError)
			return
		}

		notify.ApplyResult(notifyBaseURL, userID, false)

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "申请已拒绝"})
	}
}

// AdminUserInfo 管理员查看的用户完整信息
type AdminUserInfo struct {
	UID         int64   `json:"uid"`
	Username    string  `json:"username"`
	Email       string  `json:"email"`
	Avatar      *string `json:"avatar"`
	AvatarFrame *string `json:"avatar_frame"`
	NameColor   *string `json:"name_color"`
	QQ          *string `json:"qq"`
	Role        int     `json:"role"`
	Status      int     `json:"status"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
}

// GetAllUsers 获取所有用户（管理员）
// GET /admin/users?page=1&page_size=20&search=username&role=1&status=1
func GetAllUsers(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			jsonErrorAdmin(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// 获取分页参数
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
		search := strings.TrimSpace(r.URL.Query().Get("search"))
		roleStr := r.URL.Query().Get("role")
		statusStr := r.URL.Query().Get("status")

		if page <= 0 {
			page = 1
		}
		if pageSize <= 0 || pageSize > 100 {
			pageSize = 20
		}

		offset := (page - 1) * pageSize

		// 构建查询条件
		whereClause := ""
		args := []interface{}{}
		countArgs := []interface{}{}

		conditions := []string{}

		if search != "" {
			conditions = append(conditions, "(username LIKE ? OR email LIKE ? OR qq LIKE ?)")
			searchPattern := "%" + search + "%"
			args = append(args, searchPattern, searchPattern, searchPattern)
			countArgs = append(countArgs, searchPattern, searchPattern, searchPattern)
		}

		if roleStr != "" {
			role, err := strconv.Atoi(roleStr)
			if err == nil && role >= 1 && role <= 3 {
				conditions = append(conditions, "role = ?")
				args = append(args, role)
				countArgs = append(countArgs, role)
			}
		}

		if statusStr != "" {
			status, err := strconv.Atoi(statusStr)
			if err == nil && (status == 0 || status == 1) {
				conditions = append(conditions, "status = ?")
				args = append(args, status)
				countArgs = append(countArgs, status)
			}
		}

		if len(conditions) > 0 {
			whereClause = " WHERE " + strings.Join(conditions, " AND ")
		}

		// 查询总数
		var total int
		countSQL := "SELECT COUNT(*) FROM users" + whereClause
		err := db.QueryRow(countSQL, countArgs...).Scan(&total)
		if err != nil {
			jsonErrorAdmin(w, "查询用户总数失败", http.StatusInternalServerError)
			return
		}

		// 添加分页参数
		args = append(args, pageSize, offset)

		// 查询用户列表
		querySQL := `SELECT id, username, email, avatar, avatar_frame, name_color, qq, role, status, created_at, updated_at 
			 FROM users` + whereClause + `
			 ORDER BY created_at DESC
			 LIMIT ? OFFSET ?`
		
		rows, err := db.Query(querySQL, args...)

		if err != nil {
			jsonErrorAdmin(w, "查询用户列表失败", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		users := []AdminUserInfo{}
		for rows.Next() {
			var user AdminUserInfo
			var avatar sql.NullString
			var avatarFrame sql.NullString
			var nameColor sql.NullString
			var qq sql.NullString

			err := rows.Scan(
				&user.UID, &user.Username, &user.Email, &avatar, &avatarFrame, &nameColor, &qq,
				&user.Role, &user.Status, &user.CreatedAt, &user.UpdatedAt)

			if err != nil {
				continue
			}

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

			users = append(users, user)
		}

		// 返回分页数据
		response := map[string]interface{}{
			"total":      total,
			"page":       page,
			"page_size":  pageSize,
			"total_page": (total + pageSize - 1) / pageSize,
			"data":       users,
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(response)
	}
}

// UpdateUserReq 管理员更新用户信息请求
type UpdateUserReq struct {
	UID         int64   `json:"uid"`
	Username    *string `json:"username"`
	Email       *string `json:"email"`
	Password    *string `json:"password"`
	Avatar      *string `json:"avatar"`
	AvatarFrame *string `json:"avatar_frame"`
	NameColor   *string `json:"name_color"`
	QQ          *string `json:"qq"`
	Role        *int    `json:"role"`
	Status      *int    `json:"status"`
}

// UpdateUser 更新用户信息（管理员）
// PUT /admin/users
func UpdateUser(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			jsonErrorAdmin(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// 获取当前管理员ID和角色
		adminID, ok := middleware.GetUserID(r)
		if !ok {
			jsonErrorAdmin(w, "管理员信息获取失败", http.StatusInternalServerError)
			return
		}

		var adminRole int
		err := db.QueryRow(`SELECT role FROM users WHERE id = ?`, adminID).Scan(&adminRole)
		if err != nil {
			jsonErrorAdmin(w, "查询管理员角色失败", http.StatusInternalServerError)
			return
		}

		// 解析请求
		var req UpdateUserReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErrorAdmin(w, "请求格式错误", http.StatusBadRequest)
			return
		}

		if req.UID <= 0 {
			jsonErrorAdmin(w, "用户ID无效", http.StatusBadRequest)
			return
		}

		// 检查用户是否存在并获取目标用户角色
		var targetUserRole int
		err = db.QueryRow(`SELECT role FROM users WHERE id = ?`, req.UID).Scan(&targetUserRole)
		if err == sql.ErrNoRows {
			jsonErrorAdmin(w, "用户不存在", http.StatusNotFound)
			return
		}
		if err != nil {
			jsonErrorAdmin(w, "查询用户失败", http.StatusInternalServerError)
			return
		}

		// 构建更新SQL
		updates := []string{}
		args := []interface{}{}

		// 权限检查：普通管理员(role=2)不能修改其他管理员或超级管理员的信息
		if adminRole == 2 && targetUserRole >= 2 && adminID != req.UID {
			jsonErrorAdmin(w, "权限不足，普通管理员不能修改其他管理员的信息", http.StatusForbidden)
			return
		}

		if req.Username != nil {
			username := strings.TrimSpace(*req.Username)
			if username == "" {
				jsonErrorAdmin(w, "用户名不能为空", http.StatusBadRequest)
				return
			}
			// 检查用户名是否重复
			var dupExists int
			err := db.QueryRow(`SELECT 1 FROM users WHERE username = ? AND id != ?`, username, req.UID).Scan(&dupExists)
			if err == nil {
				jsonErrorAdmin(w, "用户名已被占用", http.StatusBadRequest)
				return
			}
			updates = append(updates, "username = ?")
			args = append(args, username)
		}

		if req.Email != nil {
			email := strings.TrimSpace(*req.Email)
			if email == "" {
				jsonErrorAdmin(w, "邮箱不能为空", http.StatusBadRequest)
				return
			}
			// 检查邮箱是否重复
			var dupExists int
			err := db.QueryRow(`SELECT 1 FROM users WHERE email = ? AND id != ?`, email, req.UID).Scan(&dupExists)
			if err == nil {
				jsonErrorAdmin(w, "邮箱已被占用", http.StatusBadRequest)
				return
			}
			updates = append(updates, "email = ?")
			args = append(args, email)
		}

		if req.Password != nil {
			password := strings.TrimSpace(*req.Password)
			if password == "" {
				jsonErrorAdmin(w, "密码不能为空", http.StatusBadRequest)
				return
			}
			// 加密密码
			hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
			if err != nil {
				jsonErrorAdmin(w, "密码加密失败", http.StatusInternalServerError)
				return
			}
			updates = append(updates, "password = ?")
			args = append(args, string(hashed))
		}

		if req.Avatar != nil {
			updates = append(updates, "avatar = ?")
			args = append(args, *req.Avatar)
		}

		if req.AvatarFrame != nil {
			s := strings.TrimSpace(*req.AvatarFrame)
			if s == "" {
				updates = append(updates, "avatar_frame = NULL")
			} else {
				updates = append(updates, "avatar_frame = ?")
				args = append(args, s)
			}
		}

		if req.NameColor != nil {
			s := strings.TrimSpace(*req.NameColor)
			if s == "" {
				updates = append(updates, "name_color = NULL")
			} else {
				updates = append(updates, "name_color = ?")
				args = append(args, s)
			}
		}

		if req.QQ != nil {
			updates = append(updates, "qq = ?")
			args = append(args, *req.QQ)
		}

		if req.Role != nil {
			if *req.Role < 1 || *req.Role > 3 {
				jsonErrorAdmin(w, "角色值无效，必须是1-3", http.StatusBadRequest)
				return
			}

			// 权限检查：只有超级管理员(role=3)才能修改角色
			if adminRole != 3 {
				jsonErrorAdmin(w, "权限不足，只有超级管理员才能修改用户角色", http.StatusForbidden)
				return
			}

			// 不能修改自己的角色
			if req.UID == adminID {
				jsonErrorAdmin(w, "不能修改自己的角色", http.StatusForbidden)
				return
			}

			// 超级管理员不能修改其他超级管理员的角色
			if targetUserRole == 3 && adminID != req.UID {
				jsonErrorAdmin(w, "不能修改其他超级管理员的角色", http.StatusForbidden)
				return
			}

			updates = append(updates, "role = ?")
			args = append(args, *req.Role)
		}

		if req.Status != nil {
			if *req.Status < 0 || *req.Status > 1 {
				jsonErrorAdmin(w, "状态值无效，必须是0或1", http.StatusBadRequest)
				return
			}
			updates = append(updates, "status = ?")
			args = append(args, *req.Status)
		}

		if len(updates) == 0 {
			jsonErrorAdmin(w, "没有需要更新的字段", http.StatusBadRequest)
			return
		}

		// 添加用户ID
		args = append(args, req.UID)

		// 构建SQL
		sqlStr := "UPDATE users SET "
		for i, update := range updates {
			if i > 0 {
				sqlStr += ", "
			}
			sqlStr += update
		}
		sqlStr += " WHERE id = ?"

		// 执行更新
		_, err = db.Exec(sqlStr, args...)
		if err != nil {
			jsonErrorAdmin(w, "更新用户信息失败", http.StatusInternalServerError)
			return
		}

		// 若管理员修改了该用户密码，清除其 token，强制重新登录
		if req.Password != nil {
			_, _ = db.Exec(`UPDATE users SET token = NULL, token_expires_at = NULL WHERE id = ?`, req.UID)
		}

		// 如果封禁用户（status改为0），自动拒绝该用户所有审核中和已通过的申请
		if req.Status != nil && *req.Status == 0 {
			// 获取管理员ID
			adminID, _ := middleware.GetUserID(r)
			
			_, err = db.Exec(
				`UPDATE verification_applications 
				 SET status = 2, reject_reason = '您已被封禁', reviewed_by = ?, reviewed_at = NOW() 
				 WHERE user_id = ? AND status IN (0, 1)`,
				adminID, req.UID)
			
			if err != nil {
				// 不影响主流程，只记录错误
				// 用户信息已更新成功
			}
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "更新成功"})
	}
}

// GetUserUnlockedAvatarFrames 管理员获取某用户已解锁的头像框
// GET /admin/users/avatar-frames?uid=1
func GetUserUnlockedAvatarFrames(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			jsonErrorAdmin(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		uidStr := r.URL.Query().Get("uid")
		if uidStr == "" {
			jsonErrorAdmin(w, "缺少参数 uid", http.StatusBadRequest)
			return
		}
		uid, err := strconv.ParseInt(uidStr, 10, 64)
		if err != nil || uid <= 0 {
			jsonErrorAdmin(w, "uid 无效", http.StatusBadRequest)
			return
		}
		rows, err := db.Query(
			`SELECT f.id, f.image_url
			 FROM avatar_frames f
			 INNER JOIN user_avatar_frames u ON u.avatar_frame_id = f.id AND u.user_id = ?
			 ORDER BY f.sort_order ASC, f.id ASC`,
			uid)
		if err != nil {
			jsonErrorAdmin(w, "查询已解锁头像框失败", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		list := []AvatarFrameItem{}
		for rows.Next() {
			var item AvatarFrameItem
			if err := rows.Scan(&item.ID, &item.ImageURL); err != nil {
				continue
			}
			list = append(list, item)
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(list)
	}
}

// AdminAvatarFrameReq 管理员操作头像框请求
type AdminAvatarFrameReq struct {
	UID            int64 `json:"uid"`
	AvatarFrameID  int64 `json:"avatar_frame_id"`
}

// UnlockUserAvatarFrame 管理员为用户解锁某个头像框
// POST /admin/users/avatar-frames
func UnlockUserAvatarFrame(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErrorAdmin(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req AdminAvatarFrameReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErrorAdmin(w, "请求格式错误", http.StatusBadRequest)
			return
		}
		if req.UID <= 0 || req.AvatarFrameID <= 0 {
			jsonErrorAdmin(w, "uid 和 avatar_frame_id 必须大于 0", http.StatusBadRequest)
			return
		}
		var userExists, frameExists int
		if err := db.QueryRow(`SELECT 1 FROM users WHERE id = ?`, req.UID).Scan(&userExists); err != nil || userExists == 0 {
			jsonErrorAdmin(w, "用户不存在", http.StatusNotFound)
			return
		}
		if err := db.QueryRow(`SELECT 1 FROM avatar_frames WHERE id = ?`, req.AvatarFrameID).Scan(&frameExists); err != nil || frameExists == 0 {
			jsonErrorAdmin(w, "头像框不存在", http.StatusNotFound)
			return
		}
		_, err := db.Exec(
			`INSERT IGNORE INTO user_avatar_frames (user_id, avatar_frame_id) VALUES (?, ?)`,
			req.UID, req.AvatarFrameID)
		if err != nil {
			jsonErrorAdmin(w, "解锁失败", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "已解锁"})
	}
}

// LockUserAvatarFrame 管理员为用户加锁（取消）某个头像框
// DELETE /admin/users/avatar-frames
func LockUserAvatarFrame(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			jsonErrorAdmin(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req AdminAvatarFrameReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErrorAdmin(w, "请求格式错误", http.StatusBadRequest)
			return
		}
		if req.UID <= 0 || req.AvatarFrameID <= 0 {
			jsonErrorAdmin(w, "uid 和 avatar_frame_id 必须大于 0", http.StatusBadRequest)
			return
		}
		result, err := db.Exec(
			`DELETE FROM user_avatar_frames WHERE user_id = ? AND avatar_frame_id = ?`,
			req.UID, req.AvatarFrameID)
		if err != nil {
			jsonErrorAdmin(w, "加锁失败", http.StatusInternalServerError)
			return
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			jsonErrorAdmin(w, "该用户未解锁此头像框", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "已加锁"})
	}
}

func jsonErrorAdmin(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
