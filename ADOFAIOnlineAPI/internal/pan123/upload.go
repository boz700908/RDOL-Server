package pan123

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
)

type cliResponse struct {
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data"`
	Error *cliError       `json:"error"`
}

type cliError struct {
	Message string `json:"message"`
}

type uploadResult struct {
	FileID    int64 `json:"fileID"`
	Completed bool  `json:"completed"`
}

type directLinkResult struct {
	URL string `json:"url"`
}

// UploadTo123 调用 pan123 CLI 上传文件并返回直链
func UploadTo123(parentFileID int64, localPath, filename string) (downloadURL string, fileID int64, err error) {
	args := []string{"--json", "upload", localPath, "--parent", strconv.FormatInt(parentFileID, 10)}
	if filename != "" {
		args = append(args, "--name", filename)
	}

	out, err := exec.Command("pan123", args...).Output()
	if err != nil {
		return "", 0, fmt.Errorf("pan123 upload: %w (output: %s)", err, string(out))
	}

	var resp cliResponse
	if err := json.Unmarshal(out, &resp); err != nil {
		return "", 0, fmt.Errorf("pan123 upload: parse response: %w", err)
	}
	if !resp.OK {
		msg := "unknown error"
		if resp.Error != nil {
			msg = resp.Error.Message
		}
		return "", 0, fmt.Errorf("pan123 upload: %s", msg)
	}

	var upload uploadResult
	if err := json.Unmarshal(resp.Data, &upload); err != nil {
		return "", 0, fmt.Errorf("pan123 upload: parse data: %w", err)
	}

	if upload.FileID == 0 {
		return "", 0, fmt.Errorf("pan123 upload: fileID is 0")
	}

	fileID = upload.FileID

	linkOut, err := exec.Command("pan123", "--json", "direct-link", "url", strconv.FormatInt(fileID, 10)).Output()
	if err != nil {
		return "", fileID, fmt.Errorf("pan123 direct-link: %w (output: %s)", err, string(linkOut))
	}

	var linkResp cliResponse
	if err := json.Unmarshal(linkOut, &linkResp); err != nil {
		return "", fileID, fmt.Errorf("pan123 direct-link: parse response: %w", err)
	}
	if !linkResp.OK {
		msg := "unknown error"
		if linkResp.Error != nil {
			msg = linkResp.Error.Message
		}
		return "", fileID, fmt.Errorf("pan123 direct-link: %s", msg)
	}

	var link directLinkResult
	if err := json.Unmarshal(linkResp.Data, &link); err != nil {
		return "", fileID, fmt.Errorf("pan123 direct-link: parse data: %w", err)
	}

	return link.URL, fileID, nil
}
