package main

import (
	"bufio"
	_ "embed"
	"encoding/json"
	"fmt"
	"mth-blog-editor/launcher/internal/thumbnail"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	webview "github.com/webview/webview_go"
)

//go:embed server.bin
var server []byte

//go:embed app-icon.png
var applicationIcon []byte

func serverURL(line string) (string, error) {
	const prefix = "MTH_EDITOR_READY "
	if !strings.HasPrefix(line, prefix) {
		return "", nil
	}
	var ready struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal([]byte(strings.TrimPrefix(line, prefix)), &ready); err != nil {
		return "", err
	}
	u, err := url.Parse(ready.URL)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Port() == "" || u.User != nil {
		return "", fmt.Errorf("endereço inválido recebido do servidor")
	}
	return ready.URL, nil
}

func run() error {
	launcherPath, err := os.Executable()
	if err != nil {
		return err
	}

	tempDir, err := os.MkdirTemp("", "mth-editor-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tempDir)
	serverPath := filepath.Join(tempDir, "server"+executableExtension)
	if err := os.WriteFile(serverPath, server, 0700); err != nil {
		return err
	}

	args := append([]string{}, os.Args[1:]...)
	args = append(args, "--editor-dir", filepath.Dir(launcherPath), "--no-browser")
	cliMode := false
	for _, arg := range args {
		if arg == "--self-test" || arg == "--lifecycle-test" {
			cliMode = true
		}
	}
	if !cliMode {
		args = append(args, "--desktop")
	}
	cmd := exec.Command(serverPath, args...)
	cmd.Env = append(os.Environ(), "MTH_EDITOR_EXECUTABLE="+launcherPath)
	configureCommand(cmd)
	cmd.Stderr = os.Stderr
	if cliMode {
		cmd.Stdout = os.Stdout
		return cmd.Run()
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan struct{})
	var waitErr error
	go func() { waitErr = cmd.Wait(); close(done) }()
	defer func() { _ = cmd.Process.Kill(); <-done }()
	ready := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 4096), 1024*1024)
		for scanner.Scan() {
			address, err := serverURL(scanner.Text())
			if err == nil && address != "" {
				select {
				case ready <- address:
				default:
				}
			}
		}
	}()
	var address string
	select {
	case address = <-ready:
	case <-done:
		return fmt.Errorf("o servidor encerrou antes de iniciar: %v", waitErr)
	case <-time.After(30 * time.Second):
		return fmt.Errorf("o servidor não iniciou em 30 segundos")
	}
	client := &http.Client{Timeout: 5 * time.Second}
	response, err := client.Get(address)
	if err != nil {
		return fmt.Errorf("não foi possível conectar ao editor: %w", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("o servidor retornou HTTP %d", response.StatusCode)
	}

	w := webview.New(false)
	if w == nil || w.Window() == nil {
		return fmt.Errorf("não foi possível iniciar a WebView; verifique o runtime instalado")
	}
	defer w.Destroy()
	w.SetTitle("MTH Editor")
	setWindowIcon(w.Window())
	w.SetSize(1280, 850, webview.HintNone)
	w.SetSize(760, 540, webview.HintMin)
	if err := w.Bind("desktopClose", func() { w.Terminate() }); err != nil {
		return err
	}
	if err := w.Bind("desktopPickFolder", func() (string, error) { return pickFolder(w.Window()) }); err != nil {
		return err
	}
	if err := w.Bind("desktopOpenExternal", func(address string) error {
		u, err := url.Parse(address)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return fmt.Errorf("use um endereço http ou https válido")
		}
		return openExternal(u.String())
	}); err != nil {
		return err
	}
	w.Init("window.editorDesktop = true;")
	cleanup, err := installCloseHandler(w.Window(), func() {
		w.Eval("if (window.editorRequestClose) { window.editorRequestClose(); } else { desktopClose(); }")
	})
	if err != nil {
		return err
	}
	defer cleanup()
	w.Navigate(address)
	watchDone := make(chan struct{})
	defer close(watchDone)
	go func() {
		select {
		case <-done:
			w.Terminate()
		case <-watchDone:
		}
	}()
	w.Run()
	select {
	case <-done:
		return fmt.Errorf("o servidor encerrou durante o uso: %v", waitErr)
	default:
		return nil
	}
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--thumbnail" {
		if err := thumbnail.Write(os.Stdin, os.Stdout); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if err := run(); err != nil {
		showError(err)
		os.Exit(1)
	}
}
