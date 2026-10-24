package database

import (
	"database/sql"
	"fmt"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"adofaionlineapi/internal/config"
)

// NewDB 创建数据库连接
func NewDB(cfg *config.DBConfig) (*sql.DB, error) {
	// 添加超时设置，避免长时间等待
	dsn := fmt.Sprintf("%s:%s@tcp(%s)/%s?charset=%s&parseTime=true&timeout=5s&readTimeout=10s&writeTimeout=10s",
		cfg.User, cfg.Password, cfg.Host, cfg.Database, cfg.Charset)
	
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	
	// 设置连接池参数
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(time.Hour)
	db.SetConnMaxIdleTime(10 * time.Minute)
	
	// 测试连接
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}
	
	return db, nil
}
