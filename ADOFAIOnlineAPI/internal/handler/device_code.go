package handler

import (
	"database/sql"
	"encoding/json"
	"math/rand"
	"net/http"
	"strings"
	"unicode"

	"adofaionlineapi/internal/middleware"
)

// 六位设备码字符集（大写字母+数字，用于生成）
const deviceCodeCharset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// DeviceCodeItem 设备码项（列表项）
type DeviceCodeItem struct {
	DeviceCode string `json:"device_code"`
	CreatedAt  string `json:"created_at"`
}

// GetMyDeviceCodes 获取当前用户已绑定的设备码列表
// GET /me/devices
func GetMyDeviceCodes(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			jsonErrorDevice(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID, ok := middleware.GetUserID(r)
		if !ok {
			jsonErrorDevice(w, "用户信息获取失败", http.StatusInternalServerError)
			return
		}

		rows, err := db.Query(
			`SELECT device_code, created_at FROM device_codes WHERE user_id = ? ORDER BY created_at ASC`,
			userID)
		if err != nil {
			jsonErrorDevice(w, "查询设备码列表失败", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		list := []DeviceCodeItem{}
		for rows.Next() {
			var item DeviceCodeItem
			if err := rows.Scan(&item.DeviceCode, &item.CreatedAt); err != nil {
				continue
			}
			list = append(list, item)
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(list)
	}
}

// isSixDigit 判断是否为六位数字
func isSixDigit(s string) bool {
	if len(s) != 6 {
		return false
	}
	for _, r := range s {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

// isSixAlnum 判断是否为六位（大写字母+数字）
func isSixAlnum(s string) bool {
	if len(s) != 6 {
		return false
	}
	for _, r := range s {
		if (r < 'A' || r > 'Z') && (r < '0' || r > '9') {
			return false
		}
	}
	return true
}

// isValidDeviceCode 校验设备码格式：六位数字 或 六位大写字母+数字
func isValidDeviceCode(s string) bool {
	return isSixDigit(s) || isSixAlnum(s)
}

// generateDeviceCode 生成六位大写字母+数字设备码
func generateDeviceCode() string {
	b := make([]byte, 6)
	for i := range b {
		b[i] = deviceCodeCharset[rand.Intn(len(deviceCodeCharset))]
	}
	return string(b)
}

// deviceCodeExistsInDB 检查设备码是否已存在于库中
func deviceCodeExistsInDB(db *sql.DB, code string) (bool, error) {
	var n int
	err := db.QueryRow(`SELECT 1 FROM device_codes WHERE device_code = ? LIMIT 1`, code).Scan(&n)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// BindDeviceCodeReq 绑定设备码请求
type BindDeviceCodeReq struct {
	DeviceCode string `json:"device_code"`
}

// BindDeviceCode 绑定设备码（需已绑定 QQ 且账号未封禁，最多 2 个）
// POST /me/devices
func BindDeviceCode(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErrorDevice(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID, ok := middleware.GetUserID(r)
		if !ok {
			jsonErrorDevice(w, "用户信息获取失败", http.StatusInternalServerError)
			return
		}

		var req BindDeviceCodeReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErrorDevice(w, "请求格式错误", http.StatusBadRequest)
			return
		}

		req.DeviceCode = strings.TrimSpace(req.DeviceCode)
		if !isValidDeviceCode(req.DeviceCode) {
			jsonErrorDevice(w, "设备码必须为六位数字或六位大写字母与数字组合", http.StatusBadRequest)
			return
		}

		// 绑定前提：用户已绑定 QQ 且未封禁
		var qq sql.NullString
		var status int
		err := db.QueryRow(`SELECT qq, status FROM users WHERE id = ?`, userID).Scan(&qq, &status)
		if err == sql.ErrNoRows {
			jsonErrorDevice(w, "用户不存在", http.StatusNotFound)
			return
		}
		if err != nil {
			jsonErrorDevice(w, "查询用户信息失败", http.StatusInternalServerError)
			return
		}
		if !qq.Valid || qq.String == "" {
			jsonErrorDevice(w, "请先绑定 QQ 后再绑定设备码", http.StatusBadRequest)
			return
		}
		if status != 1 {
			jsonErrorDevice(w, "账号已封禁，无法绑定设备码", http.StatusForbidden)
			return
		}

		// 检查当前用户已绑定数量
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM device_codes WHERE user_id = ?`, userID).Scan(&count); err != nil {
			jsonErrorDevice(w, "查询设备码失败", http.StatusInternalServerError)
			return
		}
		if count >= 2 {
			jsonErrorDevice(w, "最多只能绑定两个设备码", http.StatusBadRequest)
			return
		}

		// 若已绑定过该设备码，幂等返回成功
		var exists int
		_ = db.QueryRow(`SELECT 1 FROM device_codes WHERE user_id = ? AND device_code = ?`, userID, req.DeviceCode).Scan(&exists)
		if exists == 1 {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"message": "该设备码已绑定"})
			return
		}

		_, err = db.Exec(`INSERT INTO device_codes (user_id, device_code) VALUES (?, ?)`, userID, req.DeviceCode)
		if err != nil {
			jsonErrorDevice(w, "绑定设备码失败", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "绑定成功"})
	}
}

// UnbindDeviceCodeReq 解绑设备码请求
type UnbindDeviceCodeReq struct {
	DeviceCode string `json:"device_code"`
}

// UnbindDeviceCode 解绑设备码（仅能解绑当前用户自己的）
// DELETE /me/devices
func UnbindDeviceCode(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			jsonErrorDevice(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID, ok := middleware.GetUserID(r)
		if !ok {
			jsonErrorDevice(w, "用户信息获取失败", http.StatusInternalServerError)
			return
		}

		var req UnbindDeviceCodeReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErrorDevice(w, "请求格式错误", http.StatusBadRequest)
			return
		}

		req.DeviceCode = strings.TrimSpace(req.DeviceCode)
		if !isValidDeviceCode(req.DeviceCode) {
			jsonErrorDevice(w, "设备码必须为六位数字或六位大写字母与数字组合", http.StatusBadRequest)
			return
		}

		result, err := db.Exec(`DELETE FROM device_codes WHERE user_id = ? AND device_code = ?`, userID, req.DeviceCode)
		if err != nil {
			jsonErrorDevice(w, "解绑失败", http.StatusInternalServerError)
			return
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			jsonErrorDevice(w, "该设备码未绑定或不属于当前账号", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "解绑成功"})
	}
}

// VerifyDeviceCode 校验设备码（无需认证）：无参数时生成并返回一个未占用的六位设备码；有参数时校验是否已绑定且用户可用
// GET /verify/device-code 或 GET /verify/device-code?device_code=123456
func VerifyDeviceCode(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			jsonErrorDevice(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		deviceCode := strings.TrimSpace(r.URL.Query().Get("device_code"))

		// 未携带设备码：生成一个与库中不重复的六位（大写字母+数字）设备码返回，不存库；重复则一直重试直到不重复
		if deviceCode == "" {
			for {
				code := generateDeviceCode()
				exists, err := deviceCodeExistsInDB(db, code)
				if err != nil {
					w.Header().Set("Content-Type", "application/json; charset=utf-8")
					w.WriteHeader(http.StatusInternalServerError)
					json.NewEncoder(w).Encode(map[string]string{"error": "生成设备码失败"})
					return
				}
				if !exists {
					w.Header().Set("Content-Type", "application/json; charset=utf-8")
					w.WriteHeader(http.StatusOK)
					json.NewEncoder(w).Encode(map[string]string{"device_code": code})
					return
				}
			}
		}

		// 携带设备码：校验格式与绑定状态
		if !isValidDeviceCode(deviceCode) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "设备码格式错误"})
			return
		}

		var userID int64
		err := db.QueryRow(`SELECT user_id FROM device_codes WHERE device_code = ? LIMIT 1`, deviceCode).Scan(&userID)
		if err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "设备码未绑定"})
			return
		}

		var qq sql.NullString
		var status int
		err = db.QueryRow(`SELECT qq, status FROM users WHERE id = ?`, userID).Scan(&qq, &status)
		if err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "设备码未绑定"})
			return
		}
		if status != 1 {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "您的账号被封"})
			return
		}
		if !qq.Valid || qq.String == "" {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "未绑定QQ"})
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
	}
}

func jsonErrorDevice(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
