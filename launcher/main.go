package main

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

//go:embed MTH-Editor-Server.exe
var server []byte

const createNoWindow = 0x08000000

func showError(err error) {
	title, _ := syscall.UTF16PtrFromString("Editor de posts")
	message, _ := syscall.UTF16PtrFromString(fmt.Sprintf("Não foi possível abrir o editor.\n\n%s", err))
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(
		0,
		uintptr(unsafe.Pointer(message)),
		uintptr(unsafe.Pointer(title)),
		0x10,
	)
}

func run() error {
	launcherPath, err := os.Executable()
	if err != nil {
		return err
	}

	file, err := os.CreateTemp("", "mth-editor-server-*.exe")
	if err != nil {
		return err
	}
	serverPath := file.Name()
	defer os.Remove(serverPath)
	if _, err = file.Write(server); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}

	args := append([]string{}, os.Args[1:]...)
	args = append(args, "--editor-dir", filepath.Dir(launcherPath))
	cmd := exec.Command(serverPath, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	if err = cmd.Start(); err != nil {
		return err
	}
	return cmd.Wait()
}

func main() {
	if err := run(); err != nil {
		showError(err)
		os.Exit(1)
	}
}
