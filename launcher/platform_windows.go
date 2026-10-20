package main

import (
	"fmt"
	"os/exec"
	"syscall"
	"unsafe"
)

const executableExtension = ".exe"

var user32 = syscall.NewLazyDLL("user32.dll")

func setWindowIcon(window unsafe.Pointer) {
	module, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetModuleHandleW").Call(0)
	for _, size := range []uintptr{16, 32} {
		icon, _, _ := user32.NewProc("LoadImageW").Call(module, 1, 1, size, size, 0x8000)
		kind := uintptr(0)
		if size == 32 {
			kind = 1
		}
		if icon != 0 {
			user32.NewProc("SendMessageW").Call(uintptr(window), 0x80, kind, icon)
		}
	}
}

func configureCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}

func showError(err error) {
	title, _ := syscall.UTF16PtrFromString("MTH Editor")
	message, _ := syscall.UTF16PtrFromString(fmt.Sprintf("Não foi possível abrir o editor.\n\n%s", err))
	user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(title)), 0x10)
}

func openExternal(address string) error {
	cmd := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", address)
	configureCommand(cmd)
	return cmd.Run()
}

func pickFolder(window unsafe.Pointer) (string, error) {
	title, _ := syscall.UTF16PtrFromString("Selecione a pasta do editor")
	var display [260]uint16
	info := struct {
		Owner    uintptr
		Root     uintptr
		Display  *uint16
		Title    *uint16
		Flags    uint32
		Callback uintptr
		Param    uintptr
		Image    int32
	}{Owner: uintptr(window), Display: &display[0], Title: title, Flags: 0x41}
	shell := syscall.NewLazyDLL("shell32.dll")
	pidl, _, _ := shell.NewProc("SHBrowseForFolderW").Call(uintptr(unsafe.Pointer(&info)))
	if pidl == 0 {
		return "", nil
	}
	defer syscall.NewLazyDLL("ole32.dll").NewProc("CoTaskMemFree").Call(pidl)
	var path [32768]uint16
	ok, _, _ := shell.NewProc("SHGetPathFromIDListEx").Call(pidl, uintptr(unsafe.Pointer(&path[0])), uintptr(len(path)), 0)
	if ok == 0 {
		return "", fmt.Errorf("não foi possível ler a pasta selecionada")
	}
	return syscall.UTF16ToString(path[:]), nil
}

func installCloseHandler(window unsafe.Pointer, requestClose func()) (func(), error) {
	setProc := user32.NewProc("SetWindowLongPtrW")
	callProc := user32.NewProc("CallWindowProcW")
	var original uintptr
	callback := syscall.NewCallback(func(hwnd, message, wparam, lparam uintptr) uintptr {
		if message == 0x10 {
			requestClose()
			return 0
		} // WM_CLOSE
		result, _, _ := callProc.Call(original, hwnd, message, wparam, lparam)
		return result
	})
	original, _, err := setProc.Call(uintptr(window), ^uintptr(3), callback) // GWLP_WNDPROC = -4
	if original == 0 {
		return nil, fmt.Errorf("não foi possível configurar o fechamento da janela: %v", err)
	}
	return func() { setProc.Call(uintptr(window), ^uintptr(3), original) }, nil
}
