package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"adofaionlineapi/internal/middleware"
)

// AvatarFrameItem 头像框项（列表项）
type AvatarFrameItem struct {
	ID       int64  `json:"id"`
	ImageURL string `json:"image_url"`
}

// GetAvatarFrames 获取所有头像框列表（无需登录）
// GET /avatar-frames
func GetAvatarFrames(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			jsonErrorAvatarFrame(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		rows, err := db.Query(
			`SELECT id, image_url FROM avatar_frames ORDER BY sort_order ASC, id ASC`)
		if err != nil {
			jsonErrorAvatarFrame(w, "查询头像框列表失败", http.StatusInternalServerError)
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

// GetMyUnlockedAvatarFrames 获取当前用户已解锁的头像框列表（需登录）
// GET /me/avatar-frames
func GetMyUnlockedAvatarFrames(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			jsonErrorAvatarFrame(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID, ok := middleware.GetUserID(r)
		if !ok {
			jsonErrorAvatarFrame(w, "用户信息获取失败", http.StatusInternalServerError)
			return
		}

		rows, err := db.Query(
			`SELECT f.id, f.image_url
			 FROM avatar_frames f
			 INNER JOIN user_avatar_frames u ON u.avatar_frame_id = f.id AND u.user_id = ?
			 ORDER BY f.sort_order ASC, f.id ASC`,
			userID)
		if err != nil {
			jsonErrorAvatarFrame(w, "查询已解锁头像框失败", http.StatusInternalServerError)
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

func jsonErrorAvatarFrame(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
