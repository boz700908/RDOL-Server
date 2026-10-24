package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// BannedEmailDomainItem 封禁邮箱域名列表项
type BannedEmailDomainItem struct {
	ID        int64  `json:"id"`
	Domain    string `json:"domain"`
	CreatedAt string `json:"created_at"`
}

// GetBannedEmailDomains 获取封禁邮箱域名列表（管理员）
// GET /admin/banned-email-domains?page=1&page_size=20
func GetBannedEmailDomains(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			jsonErrorAdmin(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
		if page <= 0 {
			page = 1
		}
		if pageSize <= 0 || pageSize > 100 {
			pageSize = 20
		}
		offset := (page - 1) * pageSize

		var total int
		if err := db.QueryRow(`SELECT COUNT(*) FROM banned_email_domains`).Scan(&total); err != nil {
			jsonErrorAdmin(w, "查询失败", http.StatusInternalServerError)
			return
		}

		rows, err := db.Query(
			`SELECT id, domain, created_at FROM banned_email_domains ORDER BY id DESC LIMIT ? OFFSET ?`,
			pageSize, offset)
		if err != nil {
			jsonErrorAdmin(w, "查询失败", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		list := []BannedEmailDomainItem{}
		for rows.Next() {
			var item BannedEmailDomainItem
			if err := rows.Scan(&item.ID, &item.Domain, &item.CreatedAt); err != nil {
				continue
			}
			list = append(list, item)
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"total":      total,
			"page":       page,
			"page_size":  pageSize,
			"total_page": (total + pageSize - 1) / pageSize,
			"data":       list,
		})
	}
}

// AddBannedEmailDomainReq 添加封禁域名请求
type AddBannedEmailDomainReq struct {
	Domain string `json:"domain"`
}

// AddBannedEmailDomain 添加封禁邮箱域名（管理员）
// POST /admin/banned-email-domains
func AddBannedEmailDomain(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErrorAdmin(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req AddBannedEmailDomainReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErrorAdmin(w, "请求格式错误", http.StatusBadRequest)
			return
		}
		domain := strings.TrimSpace(strings.ToLower(req.Domain))
		if domain == "" {
			jsonErrorAdmin(w, "domain 不能为空", http.StatusBadRequest)
			return
		}
		// 移除可能的 @ 前缀
		domain = strings.TrimPrefix(domain, "@")
		if strings.Contains(domain, "@") {
			jsonErrorAdmin(w, "domain 应为纯域名，如 ibymain.com", http.StatusBadRequest)
			return
		}
		_, err := db.Exec(`INSERT INTO banned_email_domains (domain) VALUES (?)`, domain)
		if err != nil {
			if strings.Contains(err.Error(), "Duplicate") || strings.Contains(err.Error(), "UNIQUE") {
				jsonErrorAdmin(w, "该域名已在封禁列表中", http.StatusBadRequest)
				return
			}
			jsonErrorAdmin(w, "添加失败", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "已添加"})
	}
}

// RemoveBannedEmailDomainReq 解除封禁请求
type RemoveBannedEmailDomainReq struct {
	Domain string `json:"domain"`
}

// RemoveBannedEmailDomain 解除邮箱域名封禁（管理员）
// DELETE /admin/banned-email-domains
func RemoveBannedEmailDomain(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			jsonErrorAdmin(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req RemoveBannedEmailDomainReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErrorAdmin(w, "请求格式错误", http.StatusBadRequest)
			return
		}
		domain := strings.TrimSpace(strings.ToLower(req.Domain))
		domain = strings.TrimPrefix(domain, "@")
		if domain == "" {
			jsonErrorAdmin(w, "domain 不能为空", http.StatusBadRequest)
			return
		}
		result, err := db.Exec(`DELETE FROM banned_email_domains WHERE domain = ?`, domain)
		if err != nil {
			jsonErrorAdmin(w, "操作失败", http.StatusInternalServerError)
			return
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			jsonErrorAdmin(w, "该域名不在封禁列表中", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "已解除"})
	}
}
