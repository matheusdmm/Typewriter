package main

import (
	"bufio"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestServerURL(t *testing.T) {
	for _, test := range []struct {
		line, want string
		invalid    bool
	}{
		{"Editor local: http://127.0.0.1:4177", "", false},
		{`MTH_EDITOR_READY {"url":"http://127.0.0.1:51324"}`, "http://127.0.0.1:51324", false},
		{`MTH_EDITOR_READY {"url":"https://example.com:443"}`, "", true},
		{`MTH_EDITOR_READY {"url":"http://127.0.0.1"}`, "", true},
		{`MTH_EDITOR_READY {"url":"http://user@127.0.0.1:4177"}`, "", true},
		{`MTH_EDITOR_READY {broken}`, "", true},
	} {
		got, err := serverURL(test.line)
		if got != test.want || (err != nil) != test.invalid {
			t.Errorf("serverURL(%q) = %q, %v", test.line, got, err)
		}
	}
}

func TestEmbeddedServerWithBusyPort(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	dir := t.TempDir()
	path := filepath.Join(dir, "server"+executableExtension)
	if err := os.WriteFile(path, server, 0700); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(path, "--desktop", "--no-browser", "--editor-dir", dir)
	cmd.Env = append(os.Environ(), fmt.Sprintf("EDITOR_PORT=%d", port))
	configureCommand(cmd)
	cmd.Stderr = os.Stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	ready := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if address, err := serverURL(scanner.Text()); err == nil && address != "" {
				ready <- address
				return
			}
		}
	}()
	select {
	case address := <-ready:
		if address == fmt.Sprintf("http://127.0.0.1:%d", port) {
			t.Fatal("server did not choose a free port")
		}
		client := &http.Client{Timeout: 5 * time.Second}
		for _, route := range []string{"/", "/photos", "/dialogs.js", "/api/config"} {
			response, err := client.Get(address + route)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != 200 {
				t.Errorf("GET %s = %d", route, response.StatusCode)
			}
		}
	case <-time.After(30 * time.Second):
		t.Fatal("server readiness timed out")
	}
}
