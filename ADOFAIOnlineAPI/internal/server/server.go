package server

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"time"

	"adofaionlineapi/internal/config"
	"adofaionlineapi/internal/handler"
	"adofaionlineapi/internal/middleware"
)

// Server HTTP 服务器
type Server struct {
	httpServer *http.Server
	config     *config.Config
}

// New 创建 HTTP 服务器
func New(cfg *config.Config, authHandler *handler.AuthHandler, db *sql.DB) *Server {
	mux := http.NewServeMux()

	// 注册路由
	mux.HandleFunc("/health", handler.Health)
	mux.HandleFunc("/checkupdate", handler.CheckUpdate(cfg.BundlesPath, cfg.BaseURL))
	mux.HandleFunc("/download/", handler.Download(cfg.BundlesPath))
	mux.HandleFunc("/upload/bundle", handler.UploadBundle(cfg.BundlesPath))
	mux.HandleFunc("/pan123/upload", handler.Pan123Upload(cfg.Pan123.ParentFileID))

	// Steam 游戏拥有情况调试接口（无需登录）
	mux.HandleFunc("/debug/check-steam-ownership", handler.CheckSteamOwnershipHandler(cfg.SteamAPIKey))

	// 文件访问（不需要认证）
	mux.HandleFunc("/files/", handler.ServeUploadedFile(cfg.UploadPath))
	
	// 获取用户信息、头像框列表、设备码校验（不需要认证）
	if db != nil {
		mux.HandleFunc("/users/", handler.GetUserByID(db))
		mux.HandleFunc("/avatar-frames", handler.GetAvatarFrames(db))
		mux.HandleFunc("/verify/device-code", handler.VerifyDeviceCode(db))
	}
	
	// 需要认证的路由
	if db != nil {
		requireAuth := middleware.RequireAuth(db)
		
		// 用户信息
		mux.HandleFunc("/me", func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet {
				requireAuth(handler.GetMe(db))(w, r)
			} else if r.Method == http.MethodPut {
				requireAuth(middleware.RequireJSON(handler.UpdateProfile(db)))(w, r)
			} else {
				w.WriteHeader(http.StatusMethodNotAllowed)
			}
		})
		
		// 修改密码
		mux.HandleFunc("/me/password", requireAuth(middleware.RequireJSON(handler.ChangePassword(db))))
		// 已解锁头像框
		mux.HandleFunc("/me/avatar-frames", requireAuth(handler.GetMyUnlockedAvatarFrames(db)))
		// 设备码（绑定/解绑/列表）
		mux.HandleFunc("/me/devices", func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet:
				requireAuth(handler.GetMyDeviceCodes(db))(w, r)
			case http.MethodPost:
				requireAuth(middleware.RequireJSON(handler.BindDeviceCode(db)))(w, r)
			case http.MethodDelete:
				requireAuth(middleware.RequireJSON(handler.UnbindDeviceCode(db)))(w, r)
			default:
				w.WriteHeader(http.StatusMethodNotAllowed)
			}
		})
		
		// 文件上传
		mux.HandleFunc("/upload/purchase-receipt", requireAuth(handler.UploadPurchaseReceipt(cfg.UploadPath, cfg.BaseURL)))
		
		// 正版验证申请
		mux.HandleFunc("/applications/submit", requireAuth(handler.SubmitApplication(db, cfg.NotifyAPIBaseURL, cfg.SteamAPIKey)))
		mux.HandleFunc("/applications/my", requireAuth(handler.GetMyApplications(db)))
		
		// DeepSeek AI 对话（需登录，需配置 DEEPSEEK_API_KEY）
		mux.HandleFunc("/ai/chat", requireAuth(middleware.RequireJSON(handler.DeepSeekChat(cfg.DeepSeekAPIKey))))
		
		// 管理员路由
		requireAdmin := middleware.RequireAdmin(db)
		mux.HandleFunc("/admin/applications", requireAdmin(handler.GetAllApplications(db)))
		mux.HandleFunc("/admin/applications/approve", requireAdmin(middleware.RequireJSON(handler.ApproveApplication(db, cfg.NotifyAPIBaseURL))))
		mux.HandleFunc("/admin/applications/reject", requireAdmin(middleware.RequireJSON(handler.RejectApplication(db, cfg.NotifyAPIBaseURL))))
		mux.HandleFunc("/admin/users", func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet {
				requireAdmin(handler.GetAllUsers(db))(w, r)
			} else if r.Method == http.MethodPut {
				requireAdmin(middleware.RequireJSON(handler.UpdateUser(db)))(w, r)
			} else {
				w.WriteHeader(http.StatusMethodNotAllowed)
			}
		})
		mux.HandleFunc("/admin/users/avatar-frames", func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet:
				requireAdmin(handler.GetUserUnlockedAvatarFrames(db))(w, r)
			case http.MethodPost:
				requireAdmin(middleware.RequireJSON(handler.UnlockUserAvatarFrame(db)))(w, r)
			case http.MethodDelete:
				requireAdmin(middleware.RequireJSON(handler.LockUserAvatarFrame(db)))(w, r)
			default:
				w.WriteHeader(http.StatusMethodNotAllowed)
			}
		})
		// 封禁邮箱域名管理
		mux.HandleFunc("/admin/banned-email-domains", func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet:
				requireAdmin(handler.GetBannedEmailDomains(db))(w, r)
			case http.MethodPost:
				requireAdmin(middleware.RequireJSON(handler.AddBannedEmailDomain(db)))(w, r)
			case http.MethodDelete:
				requireAdmin(middleware.RequireJSON(handler.RemoveBannedEmailDomain(db)))(w, r)
			default:
				w.WriteHeader(http.StatusMethodNotAllowed)
			}
		})
		
		log.Println("Protected routes registered with authentication")
	} else {
		unavailableHandler := func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"error":"服务暂时不可用，数据库未连接"}`))
		}
		mux.HandleFunc("/me", unavailableHandler)
		mux.HandleFunc("/me/password", unavailableHandler)
		mux.HandleFunc("/me/avatar-frames", unavailableHandler)
		mux.HandleFunc("/me/devices", unavailableHandler)
		mux.HandleFunc("/upload/purchase-receipt", unavailableHandler)
		mux.HandleFunc("/applications/submit", unavailableHandler)
		mux.HandleFunc("/applications/my", unavailableHandler)
		mux.HandleFunc("/admin/applications", unavailableHandler)
		mux.HandleFunc("/admin/applications/approve", unavailableHandler)
		mux.HandleFunc("/admin/applications/reject", unavailableHandler)
		mux.HandleFunc("/admin/users", unavailableHandler)
		mux.HandleFunc("/admin/users/avatar-frames", unavailableHandler)
		mux.HandleFunc("/admin/banned-email-domains", unavailableHandler)
		mux.HandleFunc("/ai/chat", unavailableHandler)
		log.Println("Warning: Protected routes registered with unavailable handler (database not connected)")
	}

	// 认证路由（需要验证Content-Type）
	if authHandler != nil {
		mux.HandleFunc("/auth/send-code", middleware.RequireJSON(authHandler.SendCode))
		mux.HandleFunc("/auth/register", middleware.RequireJSON(authHandler.Register))
		mux.HandleFunc("/auth/login", middleware.RequireJSON(authHandler.Login))
		log.Println("Auth routes registered successfully")
	} else {
		// 数据库未连接时，返回503服务不可用
		unavailableHandler := func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"error":"Authentication service is currently unavailable. Database connection failed."}`))
		}
		mux.HandleFunc("/auth/send-code", unavailableHandler)
		mux.HandleFunc("/auth/register", unavailableHandler)
		mux.HandleFunc("/auth/login", unavailableHandler)
		log.Println("Warning: Auth routes registered with unavailable handler (database not connected)")
	}

	// 应用全局中间件：日志 -> CORS
	handler := middleware.Logger(middleware.CORS(mux))

	return &Server{
		config: cfg,
		httpServer: &http.Server{
			Addr:         ":" + cfg.Server.Port,
			Handler:      handler,
			ReadTimeout:  5 * time.Minute,
			WriteTimeout: 5 * time.Minute,
			IdleTimeout:  60 * time.Second,
		},
	}
}

// Start 启动服务器
func (s *Server) Start() error {
	log.Printf("Server starting on port %s (env: %s)", s.config.Server.Port, s.config.Server.Env)
	log.Printf("Health check: http://localhost:%s/health", s.config.Server.Port)

	if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("server error: %w", err)
	}

	return nil
}

// Shutdown 优雅关闭服务器
func (s *Server) Shutdown(ctx context.Context) error {
	log.Println("Shutting down server...")
	return s.httpServer.Shutdown(ctx)
}
