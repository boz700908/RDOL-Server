package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"adofaionlineapi/internal/config"
	"adofaionlineapi/internal/database"
	"adofaionlineapi/internal/handler"
	"adofaionlineapi/internal/server"
	"adofaionlineapi/internal/service"
)

func main() {
	cfg := config.Load()

	var authHandler *handler.AuthHandler
	if missing := cfg.DB.MissingRequiredEnv(); len(missing) > 0 {
		log.Printf("Warning: database configuration is incomplete, auth disabled; missing: %s", strings.Join(missing, ", "))
		srv := server.New(cfg, nil, nil)
		runServer(srv)
		return
	}

	db, err := database.NewDB(&cfg.DB)
	if err != nil {
		log.Printf("Warning: database connection failed, auth disabled: %v", err)
		srv := server.New(cfg, nil, nil)
		runServer(srv)
		return
	}
	defer db.Close()

	authHandler = handler.NewAuthHandler(service.NewAuthService(db, &cfg.SMTP))
	srv := server.New(cfg, authHandler, db)

	runServer(srv)
}

func runServer(srv *server.Server) {

	go func() {
		if err := srv.Start(); err != nil {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	// 等待中断信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server shutdown failed: %v", err)
	}

	log.Println("Server stopped")
}
