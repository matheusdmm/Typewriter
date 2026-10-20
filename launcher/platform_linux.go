package main

/*
#cgo pkg-config: gtk+-3.0
#include <gtk/gtk.h>
#include <stdlib.h>
extern void editorCloseRequested(void);
static gboolean editor_delete_event(GtkWidget *widget, GdkEvent *event, gpointer data) {
  editorCloseRequested();
  return TRUE;
}
static gulong editor_connect_close(void *window) {
  return g_signal_connect(window, "delete-event", G_CALLBACK(editor_delete_event), NULL);
}
static void editor_disconnect_close(void *window, gulong id) {
  g_signal_handler_disconnect(window, id);
}
static char *editor_pick_folder(void *parent) {
  GtkWidget *dialog = gtk_file_chooser_dialog_new("Selecione a pasta do editor", GTK_WINDOW(parent),
    GTK_FILE_CHOOSER_ACTION_SELECT_FOLDER, "Cancelar", GTK_RESPONSE_CANCEL, "Selecionar", GTK_RESPONSE_ACCEPT, NULL);
  char *path = NULL;
  if (gtk_dialog_run(GTK_DIALOG(dialog)) == GTK_RESPONSE_ACCEPT)
    path = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
  gtk_widget_destroy(dialog);
  return path;
}
*/
import "C"

import (
	"fmt"
	"os"
	"os/exec"
	"unsafe"
)

const executableExtension = ""

func setWindowIcon(window unsafe.Pointer) {
	loader := C.gdk_pixbuf_loader_new()
	defer C.g_object_unref(C.gpointer(loader))
	if C.gdk_pixbuf_loader_write(loader, (*C.guchar)(unsafe.Pointer(&applicationIcon[0])), C.gsize(len(applicationIcon)), nil) != 0 {
		C.gdk_pixbuf_loader_close(loader, nil)
		if pixbuf := C.gdk_pixbuf_loader_get_pixbuf(loader); pixbuf != nil {
			C.gtk_window_set_icon((*C.GtkWindow)(window), pixbuf)
		}
	}
}

var closeRequested func()

//export editorCloseRequested
func editorCloseRequested() {
	if closeRequested != nil {
		closeRequested()
	}
}

func configureCommand(cmd *exec.Cmd)    {}
func showError(err error)               { fmt.Fprintln(os.Stderr, "Não foi possível abrir o editor:", err) }
func openExternal(address string) error { return exec.Command("xdg-open", address).Run() }

func pickFolder(window unsafe.Pointer) (string, error) {
	path := C.editor_pick_folder(window)
	if path == nil {
		return "", nil
	}
	defer C.g_free(C.gpointer(unsafe.Pointer(path)))
	return C.GoString(path), nil
}

func installCloseHandler(window unsafe.Pointer, requestClose func()) (func(), error) {
	closeRequested = requestClose
	id := C.editor_connect_close(window)
	return func() { C.editor_disconnect_close(window, id); closeRequested = nil }, nil
}
